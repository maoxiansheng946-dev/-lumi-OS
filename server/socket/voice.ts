/**
 * Voice / Audio Pipeline — STT → LLM → TTS real-time handlers
 * v2.1 — Multi-turn tool iteration, hands/mouth separation, input queue
 */
import { Socket } from "socket.io";
import { readDB, writeDB } from "../../db_layer";
import { logger } from "../../logger";
import { NormalizedMessage, makeLLMCallStreaming, makeLLMCall } from "../llm/providers";
import { toolRegistry } from "../tools/registry";
import { personalityRegistry } from "../personality";
import { loadEmotionalState, updateEmotionalState, saveEmotionalState, loadHIMState, saveHIMState } from "../personality/state";
import { himTick } from "../personality/him";
import { createStreamingSession, getActiveSTTProvider } from "../stt/adapter";
import { synthesizeSpeech, getActiveProvider as getTTSProvider, resolveEmotionVoice } from "../tts/adapter";
import { recordLatency } from "../monitor/latency_store";
import { getOrCreateActiveConversation, addMessage, getMessagesByTokenBudget, extractTopics, trackTopic, getTopicContext } from "../conversation/manager";
import { processInput, CognitiveContext, extractSentiment } from "../cognition";
import { runOrchestratedTask, classifyComplexity } from "../agents/orchestrator";
import { queryMemories, addMemory } from "../memory/store";
import { matchQuickCommand } from "../cognition/quick_commands";
import { recordTokenUsage } from "../llm/token_tracker";
import { getOperationModeConfig, parseStoredOperationMode } from "../cognition/operation_modes";
import { hasClientActionIntent, shouldAllowToolUseForTurn, shouldExposeAgentWork } from "../cognition/tool_intent";
import { updatePresence } from "../biometrics/presence";
import { getVoiceprints } from "../biometrics/store";
import { formatClientSelfPrompt } from "../client/self_model";

interface AudioSession {
  sttSession: ReturnType<typeof createStreamingSession> | null;
  isActive: boolean;
  ttsAbortController: AbortController | null;
  currentVoiceId: string | null;
  personalityId: string;
  userId: string;
  agentId: string;
  accumulatedText: string;
  /** TTS is actively playing audio — user can barge-in */
  isSpeaking: boolean;
  /** Tool iteration loop is running — new input is queued, not dropped */
  isProcessing: boolean;
  /** True during orchestrator multi-agent execution — status checks get quick ack */
  isOrchestrating: boolean;
  /** AbortController for the full LLM+tool pipeline — aborted on barge-in */
  pipelineAbortController: AbortController | null;
  /** Queue of pending utterances while isProcessing=true */
  inputQueue: string[];
  /** True when background agent is executing tools (barge-in requires wake word) */
  isBackgroundWork: boolean;
  /** Incremented on each new command — only latest generation gets TTS output */
  bgGeneration: number;
  /** Timestamp of last audio chunk for STT latency measurement */
  lastChunkTime: number;
  /** Timer to auto-close STT session after prolonged silence (5min) */
  silenceTimer: ReturnType<typeof setTimeout> | null;
  /** Tracked TTS decay timers — cleared on stop/disconnect to prevent post-session mutations */
  ttsDecayTimers: ReturnType<typeof setTimeout>[];
  /** Barge-in confirmation delay timer — cleared on stop/disconnect */
  bargeinTimer: ReturnType<typeof setTimeout> | null;
  /** Voiceprint verification: true when owner's voice is recognized */
  voiceprintMatched: boolean;
  voiceprintConfidence: number;
  voiceprintRequired: boolean;
  voiceprintLastAt: number;
  /** Meeting mode: STT only, no LLM/TTS/tool processing. */
  transcriptionOnly: boolean;
}

// Module-level ambient noise tracking — used by both processVoiceInput and registerVoiceHandlers
let ambientRms = 0;
let ambientRmsLastUpdate = 0;

// TTS playback flag — shared with wake detector to suppress echo during speech
let ttsSpeakingCount = 0;
export function isTtsPlaying(): boolean { return ttsSpeakingCount > 0; }

// ── Module-level TTS echo tracker (shared with wake detector) ──

/** Simple character-overlap ratio for echo detection. > 0.5 = likely echo. */
function charOverlap(a: string, b: string): number {
  const an = a.replace(/\s/g, '').toLowerCase();
  const bn = b.replace(/\s/g, '').toLowerCase();
  if (!an || !bn) return 0;
  const setA = new Set(an);
  const setB = new Set(bn);
  let overlap = 0;
  for (const c of setA) { if (setB.has(c)) overlap++; }
  return overlap / Math.max(setA.size, setB.size);
}

const MAX_ECHO_ENTRIES = 50;
const recentTtsTexts: { text: string; until: number }[] = [];

/** Record a TTS sentence for echo cancellation (shared with wake detector). */
export function addEchoText(text: string): void {
  recentTtsTexts.push({ text, until: Date.now() + 10000 });
  if (recentTtsTexts.length > MAX_ECHO_ENTRIES) recentTtsTexts.shift();
}

/** Check if a transcript matches recent TTS output (speaker → mic echo). */
export function isEchoText(transcript: string): boolean {
  const now = Date.now();
  // Purge stale entries
  for (let i = recentTtsTexts.length - 1; i >= 0; i--) {
    if (recentTtsTexts[i].until <= now) recentTtsTexts.splice(i, 1);
  }
  if (recentTtsTexts.length === 0) return false;
  const tNorm = transcript.replace(/\s/g, '').toLowerCase();
  if (tNorm.length < 2) return true;
  for (const r of recentTtsTexts) {
    if (r.text.includes(transcript) || transcript.includes(r.text)) return true;
    if (charOverlap(transcript, r.text) > 0.5) return true;
  }
  return false;
}

function getAmbientNoise(): number | null {
  if (Date.now() - ambientRmsLastUpdate > 15000) return null; // stale
  return ambientRms;
}

function computeVolumeGain(): number {
  let gain = 1.0;
  const noise = getAmbientNoise();
  if (noise !== null) {
    if (noise > 0.15) gain = 1.2;
    else if (noise > 0.08) gain = 1.1;
    else if (noise < 0.02) gain = 0.85;
  }
  const hour = new Date().getHours();
  if (hour >= 22 || hour < 7) gain = Math.min(gain, 0.8);
  else if (hour >= 7 && hour < 9) gain = Math.min(gain, 0.9);
  return Math.max(0.5, Math.min(1.3, gain));
}

function getAudioSession(socket: Socket): AudioSession {
  if (!socket.data.audioSession) {
    socket.data.audioSession = {
      sttSession: null,
      isActive: false,
      ttsAbortController: null,
      currentVoiceId: null,
      personalityId: 'lumi',
      accumulatedText: '',
      isSpeaking: false,
      isProcessing: false,
      isBackgroundWork: false,
      bgGeneration: 0,
      pipelineAbortController: null,
      inputQueue: [],
      lastChunkTime: 0,
      silenceTimer: null,
      ttsDecayTimers: [],
      bargeinTimer: null,
      userId: '',
      agentId: 'lumi',
      voiceprintMatched: true,  // default: allow (no voiceprints enrolled yet)
      voiceprintConfidence: 0,
      voiceprintRequired: false,
      voiceprintLastAt: 0,
      transcriptionOnly: false,
    };
  }
  return socket.data.audioSession as AudioSession;
}

function isVoiceprintGateOpen(session: AudioSession): boolean {
  if (!session.voiceprintRequired || session.transcriptionOnly) return true;
  const fresh = Date.now() - session.voiceprintLastAt < 3500;
  return fresh && session.voiceprintMatched && session.voiceprintConfidence >= 0.55;
}

function blockUnverifiedVoice(socket: Socket, session: AudioSession, reason: string): void {
  logger.info(`[Voiceprint] ${reason} (required=${session.voiceprintRequired}, matched=${session.voiceprintMatched}, conf=${session.voiceprintConfidence.toFixed(2)})`);
  session.isSpeaking = false;
  session.isProcessing = false;
  session.accumulatedText = '';
  socket.emit('audio:status', { status: 'listening' });
}

async function processVoiceInput(
  socket: Socket,
  session: AudioSession,
  userText: string,
  llmGetters: {
    getDeepSeek: () => any;
    getGemini: () => any;
    getOpenAI: () => any;
    getAnthropic: () => any;
    getQwen: () => any;
  },
  sensoryFn: (uid: string) => any,
): Promise<void> {
  if (!isVoiceprintGateOpen(session)) {
    blockUnverifiedVoice(socket, session, 'Rejected voice command from unverified speaker');
    return;
  }

  // ── Voiceprint gate: ignore speech from unrecognized speakers ──
  // Only active when voiceprints are enrolled for this user AND at least one
  // recent voiceprint:result has been received with confidence data.
  if (session.voiceprintRequired && session.voiceprintMatched === false && session.voiceprintConfidence > 0) {
    logger.info(`[Voiceprint] Stranger voice detected (conf=${session.voiceprintConfidence.toFixed(2)}) — ignoring`);
    session.isSpeaking = false;
    session.isProcessing = false;
    session.accumulatedText = '';
    socket.emit('audio:status', { status: 'idle' });
    // Send a silent response so the UI doesn't hang in "thinking" state
    socket.emit('agent:response', { text: '' });
    return;
  }

  session.isSpeaking = true;
  session.isProcessing = true;
  session.pipelineAbortController = new AbortController();
  socket.emit("agent:status", { status: "thinking", agentName: "Lumi" });
  session.ttsAbortController = new AbortController();
  socket.emit("audio:status", { status: "thinking" });

  // Cross-session memory retrieval — voice now has access to what was discussed before
  let voiceMemories: any[] = [];
  try {
    voiceMemories = queryMemories({
      userId: session.userId,
      query: userText,
      limit: 5,
      minConfidence: 0.4,
    });
  } catch {}

  const sensoryAudio = sensoryFn(socket.id);
  const { config: personality, systemPrompt: fullPersonalityPrompt } = personalityRegistry.buildSystemPrompt(
    session.personalityId || 'lumi',
    { mode: 'task', sensory: sensoryAudio, uiContext: 'voice' },
    {
      userId: session.userId,
      memories: voiceMemories.length > 0 ? voiceMemories : undefined,
      userText,
    },
  );

  // ── Unified personality prompt + voice-specific overlay ──
  // Same core prompt as text chat — one Lumi, one framework.
  const toolVoiceOverlay = [
    '\n## Voice Mode',
    '- You are SPEAKING, not typing. Be conversational and natural, like talking to a friend.',
    '- Keep spoken responses concise — the user is listening, not reading.',
    '',
    '## Your Tools — Use Them, Don\'t Just Talk About Them',
    '- **web_search** — Search the internet for real-time information, facts, and data.',
    '- **url_fetch** — Read and extract content from any URL/webpage.',
    '- **desktop_open** — Open apps, files, folders, URLs on the user\'s computer.',
    '- **desktop_run_command** — Execute shell commands (cmd /C on Windows) for system operations.',
    '- **desktop_list_files** — Browse files and folders on the desktop.',
    '- **read_file / write_file** — Read existing files or create new ones.',
    '- **create_ppt** — Generate professional PowerPoint presentations. Provide images array for visuals.',
    '- **generate_image** — Create AI-generated images (provide local file paths as slide images).',
    '- **run_workflow** — Execute previously saved multi-step workflows.',
    '',
    '## CRITICAL: You MUST Call Tools to Do Real Work',
    '- When the user asks you to CREATE, SEARCH, OPEN, or DO anything: CALL THE TOOL.',
    '- Saying "好的" or "我帮你做" without calling the tool = the user gets NOTHING. This is a FAILURE.',
    '- **Narrate WHILE acting.** Say "正在搜索..." as you call web_search. Say "正在生成PPT..." as you call create_ppt.',
    '- Only when all tool actions are complete should you summarize the results.',
  ].join('\n');

  const baseVoiceOverlay = [
    '\n## Voice Mode',
    '- You are SPEAKING, not typing. Be conversational and natural, like talking to a friend.',
    '- Keep spoken responses concise; the user is listening, not reading.',
  ].join('\n');

  // Inject topic context if available
  let topicContext = '';
  try {
    const convForTopic = getOrCreateActiveConversation(session.userId, session.agentId);
    const tc = getTopicContext(convForTopic.id);
    if (tc) topicContext = tc;
  } catch {}

  const operationMode = (() => {
    try {
      const db = readDB();
      const setting = (db.settings || []).find((s: any) => s.key === `op_mode_${session.userId}`);
      if (setting) return parseStoredOperationMode(setting.value);
    } catch {}
    return 'assistant';
  })();

  const opModeConfigV = getOperationModeConfig(operationMode);
  const allowToolUseForTurn = shouldAllowToolUseForTurn(userText, undefined, operationMode);
  const clientActionOnlyTurn = hasClientActionIntent(userText) && (operationMode === 'chat' || operationMode === 'meeting' || operationMode === 'music');
  const clientActionToolPolicy = clientActionOnlyTurn
    ? { allowedTools: ['client_get_state', 'client_action'], requireConfirmation: [], forbiddenTools: [], maxIterations: 4 }
    : null;
  const exposeAgentWork = shouldExposeAgentWork(userText);
  logger.info(`[Audio] tool gate: ${allowToolUseForTurn ? 'enabled' : 'chat-only'} mode=${operationMode} clientActionOnly=${clientActionOnlyTurn}`);
  const opModeOverlay = clientActionOnlyTurn
    ? '\n\n## Client Mode Control\nThe user is asking Lumi to change client mode or open a client-native surface. You may only use client_get_state and client_action. Do not use file, terminal, desktop mouse/keyboard, web, team, or external-app tools. For music requests, switch to music mode before opening the music center or mood layer. For meeting/autonomous mode, use the client action confirmation flow when required.'
    : (opModeConfigV && (allowToolUseForTurn || operationMode === 'music' || operationMode === 'meeting') ? '\n\n' + opModeConfigV.promptOverlay : '');
  const interactionOverlay = allowToolUseForTurn
    ? toolVoiceOverlay
    : baseVoiceOverlay + '\n\n## Interaction Mode\nThis turn is chat-only. Do not call tools, operate the desktop, assemble a team, or claim that you are taking actions. Answer naturally unless the user gives an explicit command.';

  const clientSelfPrompt = '\n\n' + formatClientSelfPrompt(session.userId);
  const voiceSystemPrompt = fullPersonalityPrompt + interactionOverlay + opModeOverlay + clientSelfPrompt + topicContext;

  const DEFAULT_MODELS: Record<string, string> = {
    deepseek: 'deepseek-v4-pro', qwen: 'qwen-plus', openai: 'gpt-4o',
    gemini: 'gemini-2.0-flash', anthropic: 'claude-sonnet-4-6',
  };
  const userLLMPrefs = (() => {
    try {
      const db = readDB();
      const setting = (db.settings || []).find((s: any) => s.key === `llm_prefs_${session.userId}`);
      if (setting) return JSON.parse(setting.value);
    } catch {}
    return { provider: '', models: {} };
  })();

  const provider = (userLLMPrefs.provider || 'deepseek') as 'deepseek' | 'gemini' | 'openai' | 'anthropic' | 'qwen';
  const voiceModel = (userLLMPrefs.models || {})[provider] || DEFAULT_MODELS[provider] || 'deepseek-chat';

  const maxIterations = personality.toolPolicy.maxIterations || 5;

  const desktopRelay = async (toolName: string, args: Record<string, any>): Promise<string> => {
    return new Promise((resolve, reject) => {
      const cid = Math.random().toString(36).substring(2, 11);
      const timeout = setTimeout(() => {
        reject(new Error(`Desktop tool "${toolName}" timed out (30s)`));
      }, 30000);
      socket.once(`tool:desktop_result:${cid}`, (data: { output?: string; error?: string }) => {
        clearTimeout(timeout);
        if (data.error) reject(new Error(data.error));
        else resolve(data.output || '');
      });
      socket.emit('tool:desktop_exec', { correlationId: cid, name: toolName, arguments: args });
    });
  };

  const requestConfirmation = async (toolName: string, args: Record<string, any>): Promise<boolean> => {
    // Tool trust learning: auto-approve tools the user has trusted
    const { getTrustedTools, recordToolApprove, recordToolDeny } = await import("../personality/tool_trust");
    if (getTrustedTools(session.userId).includes(toolName)) {
      socket.emit("agent:tool_call", { name: toolName, arguments: args, result: 'Auto-approved (trusted)', error: undefined });
      return true;
    }
    return new Promise((resolve) => {
      const cid = Math.random().toString(36).substring(2, 11);
      const timeout = setTimeout(() => {
        socket.emit("agent:tool_call", { name: toolName, arguments: args, result: 'Auto-denied (30s timeout)', error: 'User did not respond' });
        resolve(false);
      }, 30000);
      socket.once(`tool:confirm_result:${cid}`, (data: { allowed: boolean }) => {
        clearTimeout(timeout);
        if (data.allowed) {
          const promoted = recordToolApprove(session.userId, toolName);
          if (promoted) {
            socket.emit("agent:notification", { type: 'trust', level: 'info', message: `Tool "${toolName}" is now trusted — future uses will be auto-approved.` });
          }
        } else {
          recordToolDeny(session.userId, toolName);
        }
        resolve(data.allowed === true);
      });
      socket.emit('agent:confirm_tool', { correlationId: cid, name: toolName, arguments: args });
    });
  };

  // ── Capture abort controller refs BEFORE anything that checks them ──
  // Must NOT look up session.pipelineAbortController / session.ttsAbortController
  // in the loop or flushSentence because a new processVoiceInput will overwrite them.
  const pipelineAbort = session.pipelineAbortController;
  const ttsAbort = session.ttsAbortController;

  const toolContext = {
    desktopRelay,
    llmGetters,
    ...(operationMode === 'assistant' || operationMode === 'autonomous' || clientActionOnlyTurn ? { requestConfirmation } : {}),
    isCancelled: () => pipelineAbort?.signal.aborted ?? false,
    ...(clientActionToolPolicy
      ? { toolPolicy: clientActionToolPolicy }
      : allowToolUseForTurn && opModeConfigV
      ? { toolPolicy: opModeConfigV.toolPolicy }
      : { toolPolicy: { allowedTools: [], requireConfirmation: [], forbiddenTools: ['*'], maxIterations: 0 } }),
  };
  const ttsProvider = getTTSProvider();
  // Emotion-adaptive voice: map mood to speech parameters, preserve user's chosen voiceId
  const emotionVoice = ((): { voiceId: string; speechRate?: number; pitch?: number; volume?: number } => {
    try {
      const es = loadEmotionalState(session.userId);
      if (es) return resolveEmotionVoice(session.currentVoiceId || 'longxiaochun_v3', es);
    } catch {}
    return { voiceId: session.currentVoiceId || 'longxiaochun_v3' };
  })();
  let responseText = '';
  let toolResults: any[] = [];
  let sentenceBuffer = '';
  let sentenceIdx = 0;
  const ttsPromises: Promise<void>[] = [];
  let previousToolSig: string | null = null;

  // ── Generation gating: only latest command gets TTS output ──
  session.bgGeneration++;
  const myGeneration = session.bgGeneration;
  let ttsQueue: Promise<void> = Promise.resolve();

  const flushSentence = (sentence: string) => {
    const txt = sentence.trim();
    if (!txt || txt.length <= 1 || !ttsProvider || !session.currentVoiceId || !session.isActive) return;
    if (!/[a-zA-Z一-鿿㐀-䶿\d]/.test(txt)) return;
    if (ttsAbort?.signal.aborted) return;
    if (session.bgGeneration !== myGeneration) return;
    sentenceIdx++;
    // Serialize TTS to avoid 429 rate limits
    ttsQueue = ttsQueue.then(async () => {
      if (ttsAbort?.signal.aborted) return;
      if (session.bgGeneration !== myGeneration) return;
      session.isSpeaking = true;
      ttsSpeakingCount++;
      try {
        const ttsResult = await synthesizeSpeech(txt, {
          provider: ttsProvider,
          voiceId: emotionVoice.voiceId,
          speechRate: emotionVoice.speechRate,
          pitch: emotionVoice.pitch,
          volume: emotionVoice.volume,
          signal: ttsAbort?.signal,
        });
        if (!ttsAbort?.signal.aborted && session.bgGeneration === myGeneration) {
          socket.emit("audio:status", { status: "speaking" });
          addEchoText(txt);
          const volumeGain = computeVolumeGain();
          socket.emit("audio:response", { buffer: ttsResult.audioBuffer, volumeGain });
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        logger.warn(`[Audio TTS] ${e.message?.slice(0, 80)}`);
      } finally {
        if (session.bgGeneration === myGeneration) session.isSpeaking = false;
        // Keep ttsSpeakingCount elevated for 3s after synthesis — client playback continues
        const decay = () => { ttsSpeakingCount = Math.max(0, ttsSpeakingCount - 1); };
        const t = setTimeout(decay, 3000);
        session.ttsDecayTimers.push(t);
      }
    });
    ttsPromises.push(ttsQueue);
  };

  // ── Quick Command Fast-Path: deterministic commands skip LLM entirely ──
  try {
    const quickResult = await matchQuickCommand(userText, session.userId);
    if (quickResult?.matched) {
      logger.info(`[Audio] Quick command: "${userText}" → "${quickResult.responseText.slice(0, 50)}"`);
      if (quickResult.toolCall && session.isActive) {
        const correlationId = `qc-${Date.now()}`;
        try {
          const tcResult = await toolRegistry.execute(quickResult.toolCall.name, quickResult.toolCall.arguments, toolContext);
          socket.emit("agent:tool_call", {
            correlationId,
            name: quickResult.toolCall.name,
            arguments: quickResult.toolCall.arguments,
            result: tcResult?.slice(0, 500) || '',
          });
        } catch (toolErr: any) {
          socket.emit("agent:tool_call", {
            correlationId,
            name: quickResult.toolCall.name,
            arguments: quickResult.toolCall.arguments,
            error: toolErr.message,
          });
        }
      }
      flushSentence(quickResult.responseText);
      await Promise.allSettled(ttsPromises);
      responseText = quickResult.responseText;
      const conv = getOrCreateActiveConversation(session.userId, session.agentId);
      addMessage({ userId: session.userId, agentId: session.agentId, conversationId: conv.id, role: 'user', content: userText, personality: session.personalityId, mode: 'voice' });
      addMessage({ userId: session.userId, agentId: session.agentId, conversationId: conv.id, role: 'assistant', content: responseText, personality: session.personalityId, mode: 'voice' });
      session.isProcessing = false;
      session.isSpeaking = false;
      session.pipelineAbortController = null;
      socket.emit('chat:conversation_updated', { conversationId: conv.id, agentId: session.agentId, source: 'voice' });
      socket.emit("audio:status", { status: "listening" });
      socket.emit("agent:status", { status: "idle" });
      socket.emit("agent:response", { text: responseText, agentName: "Lumi", source: "quick_command" });
      return;
    }
  } catch (qcErr: any) {
    logger.warn(`[Audio] Quick command check failed, falling through to LLM: ${qcErr.message}`);
  }

  try {
    // ── Lumi Cognitive Engine: classify intent BEFORE calling any LLM ──
    // Same cognitive layer as text chat — one Lumi, one framework.
    const cognitiveCtx: CognitiveContext = {
      userId: session.userId,
      agentId: session.agentId,
      personalityId: session.personalityId || 'lumi',
      personalityName: personality.name,
      llmProvider: provider,
      llmModel: voiceModel,
      isLLMAvailable: true,
    };
    const llmClassifier = async (prompt: string, userText: string): Promise<string> => {
      const classifierModel = provider === 'deepseek' ? 'deepseek-v4-flash' : voiceModel;
      const result = await makeLLMCall(
        [{ role: 'system', content: prompt }, { role: 'user', content: userText }],
        [],
        { provider, model: classifierModel, userId: session.userId, maxTokens: 60 },
        llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
      );
      recordTokenUsage(session.userId, provider, classifierModel, result.usage, `voice_cls_${Date.now()}`, 'voice');
      return result.text || '{"category":"unknown","confidence":0.5,"entities":{}}';
    };

    const cognition = await processInput(userText, cognitiveCtx, llmClassifier);

    if (cognition.directToolExecuted && cognition.responseText) {
      // Path A: Cognitive engine handled this directly — no LLM needed
      responseText = cognition.responseText;
      flushSentence(responseText);
      await Promise.allSettled(ttsPromises);
      // Persist
      const conv = getOrCreateActiveConversation(session.userId, session.agentId);
      addMessage({ userId: session.userId, agentId: session.agentId, conversationId: conv.id, role: 'user', content: userText, personality: session.personalityId, mode: 'voice' });
      addMessage({ userId: session.userId, agentId: session.agentId, conversationId: conv.id, role: 'assistant', content: responseText, personality: session.personalityId, mode: 'voice' });
      session.isProcessing = false;
      session.isSpeaking = false;
      session.pipelineAbortController = null;
      socket.emit('chat:conversation_updated', { conversationId: conv.id, agentId: session.agentId, source: 'voice' });
      socket.emit("audio:status", { status: "listening" });
      socket.emit("agent:status", { status: "idle" });
      return;
    }

    // Auto-select model based on cognitive intent
    const complexCategories = ['command', 'code', 'question', 'analysis'];
    const isComplex = complexCategories.includes(cognition.intent.category);
    let effectiveModel = voiceModel;
    if (provider === 'deepseek') {
      effectiveModel = isComplex ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
    }
    logger.info(`[Audio] Cognition: ${cognition.intent.category} (confidence: ${cognition.intent.confidence}), model: ${effectiveModel}`);

    // ── Music intent shortcut — intercept before LLM tool-call loop ──
    if (/放.*歌|放.*音乐|来首歌|播放|听.*歌|来点音乐|给我放|随便放点|我想听|搜.*歌|换.*歌|切.*歌/.test(userText)) {
      logger.info('[Audio] Music intent matched, attempting shortcut...');
      try {
        void desktopRelay('client_action', { action: 'set_client_mode', mode: 'music' }).catch((err: any) => {
          logger.warn('[Audio] Failed to sync music client mode:', err.message);
        });
        const { searchAndPlay } = await import('../music/search_play');
        const result = await searchAndPlay(session.userId, socket, userText);
        if (result.success && result.text) {
          responseText = result.text;
          flushSentence(responseText);
          await Promise.allSettled(ttsPromises);
          const conv = getOrCreateActiveConversation(session.userId, session.agentId);
          addMessage({ userId: session.userId, agentId: session.agentId, conversationId: conv.id, role: 'user', content: userText, personality: session.personalityId, mode: 'voice' });
          addMessage({ userId: session.userId, agentId: session.agentId, conversationId: conv.id, role: 'assistant', content: responseText, personality: session.personalityId, mode: 'voice' });
          session.isProcessing = false;
          session.isSpeaking = false;
          session.pipelineAbortController = null;
          socket.emit('chat:conversation_updated', { conversationId: conv.id, agentId: session.agentId, source: 'voice' });
          socket.emit("audio:status", { status: "listening" });
          socket.emit("agent:status", { status: "idle" });
          return;
        }
      } catch (musicErr: any) {
        logger.warn('[Audio] Music intent shortcut failed, falling through to LLM:', musicErr.message);
      }
    }

    // ── Orchestrator: complex/moderate tasks → multi-agent decomposition ──
    let usedOrchestrator = false;
    const complexity = classifyComplexity(userText, { userId: session.userId, personalityId: session.personalityId });
    if (allowToolUseForTurn && !clientActionOnlyTurn && (complexity === 'complex' || complexity === 'moderate')) {
      try {
        socket.emit("agent:status", { status: "thinking", agentName: "Lumi", phase: exposeAgentWork ? 'orchestrator' : 'background' });
        const voiceLeadIn = exposeAgentWork
          ? "\u6536\u5230\uff0c\u6b63\u5728\u8ba9\u56e2\u961f\u534f\u4f5c\u5904\u7406\u8fd9\u4e2a\u4efb\u52a1\u3002"
          : "\u6536\u5230\uff0c\u6211\u6765\u5904\u7406\u3002";
        flushSentence(voiceLeadIn);
        session.isOrchestrating = true;

        const orchResult = await runOrchestratedTask(
          userText,
          { userId: session.userId, personalityId: session.personalityId, desktopRelay },
          { provider, model: effectiveModel },
          {
            getDeepSeek: llmGetters.getDeepSeek,
            getGemini: llmGetters.getGemini,
            getOpenAI: llmGetters.getOpenAI,
            getAnthropic: llmGetters.getAnthropic,
            getQwen: llmGetters.getQwen,
          },
          exposeAgentWork ? (msg) => socket.emit("agent:chunk", { text: msg, agentName: "Lumi" }) : undefined,
        );
        if (orchResult) {
          usedOrchestrator = true;
          responseText = orchResult.responseText;
          // Flush orchestrator result to TTS sentence by sentence
          const rawSentences = responseText.split(/(?<=[。！？.!?\n])/);
          for (const s of rawSentences) {
            if (pipelineAbort?.signal.aborted) break;
            flushSentence(s);
          }
          logger.info(`[Audio] Orchestrator response: "${responseText.slice(0, 80)}" (${rawSentences.length} sentences)`);
        }
        session.isOrchestrating = false;
      } catch (e) {
        session.isOrchestrating = false;
        logger.warn('[Audio] Orchestrator failed, falling back to LLM:', (e as Error).message);
      }
    }

    if (!usedOrchestrator) {
      // ── Single-phase: stream LLM → TTS with tool iteration, all inline ──
      // Load recent conversation history for context continuity
      // Include both user & assistant messages with correct roles
      const conv = getOrCreateActiveConversation(session.userId, session.agentId);
      const recentMsgs = getMessagesByTokenBudget(conv.id);
      const voiceHistory: NormalizedMessage[] = [];
      for (const m of recentMsgs) {
        if (m.message) voiceHistory.push({ role: 'user', content: m.message });
        if (m.response) voiceHistory.push({ role: 'assistant', content: m.response });
      }

      const messages: any[] = [
        { role: 'system', content: voiceSystemPrompt },
        ...voiceHistory,
        { role: 'user', content: userText },
      ];

      for (let iter = 0; iter < maxIterations; iter++) {
      if (pipelineAbort?.signal.aborted) break;

      logger.info(`[Audio] LLM iter ${iter + 1}/${maxIterations}: provider=${provider} model=${effectiveModel}`);
      const toolDeclarations = allowToolUseForTurn
        ? toolRegistry.getToolDeclarations().filter((declaration) => {
            if (!clientActionToolPolicy) return true;
            return clientActionToolPolicy.allowedTools.includes(declaration.function.name);
          })
        : [];

      const streamResult = await makeLLMCallStreaming(
        messages as NormalizedMessage[],
        toolDeclarations,
        { provider, model: effectiveModel, signal: pipelineAbort?.signal },
        (chunk: string) => {
          responseText += chunk;
          sentenceBuffer += chunk;
          socket.emit("agent:chunk", { text: chunk, agentName: "Lumi" });
          const match = sentenceBuffer.match(/^([\s\S]*?[。！？.!?\n])/);
          if (match) {
            sentenceBuffer = sentenceBuffer.slice(match[1].length);
            flushSentence(match[1]);
          }
        },
        llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
      );

      messages.push({
        role: 'assistant',
        content: streamResult.text || null,
        ...(streamResult.toolCalls?.length ? { toolCalls: streamResult.toolCalls } : {}),
        reasoningContent: streamResult.reasoningContent,
      });

      // Record token usage for this streaming call
      recordTokenUsage(session.userId, provider, effectiveModel, streamResult.usage, `voice_stream_${Date.now()}`, 'voice');

      if (!streamResult.toolCalls || streamResult.toolCalls.length === 0) break;

      const toolSig = JSON.stringify(streamResult.toolCalls.map(tc => ({ n: tc.name, a: tc.arguments })));
      if (toolSig === previousToolSig) { logger.info('[Audio] Duplicate tools, breaking'); break; }
      previousToolSig = toolSig;
      toolResults.push(...streamResult.toolCalls);

      for (const tc of streamResult.toolCalls) {
        if (pipelineAbort?.signal.aborted) break;
        const cid = `${tc.name}-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        socket.emit("agent:tool_call", { correlationId: cid, name: tc.name, arguments: tc.arguments });

        let execResult: string;
        let execError: string | undefined;
        try {
          execResult = await toolRegistry.execute(tc.name, tc.arguments, toolContext);
        } catch (execErr: any) {
          execResult = '';
          execError = execErr.message?.slice(0, 200) || 'Tool execution failed';
        }

        if (execError) {
          socket.emit("agent:tool_call", { correlationId: cid, name: tc.name, arguments: tc.arguments, error: execError });
        } else {
          const short = typeof execResult === 'string' ? execResult.slice(0, 500) : JSON.stringify(execResult).slice(0, 500);
          socket.emit("agent:tool_call", { correlationId: cid, name: tc.name, arguments: tc.arguments, result: short });
        }

        messages.push({
          role: 'tool',
          content: execError ? `Error: ${execError}` : execResult,
          toolCallId: tc.id,
          name: tc.name,
        });
      }
    }
    } // end if (!usedOrchestrator)

    // Flush remaining text
    if (sentenceBuffer.trim()) flushSentence(sentenceBuffer);
    await Promise.allSettled(ttsPromises);

    if (responseText) {
      logger.info(`[Audio] Response: "${responseText.slice(0, 80)}" (${sentenceIdx} sentences, ${toolResults.length} tool calls)`);
      socket.emit("agent:response", { text: responseText, agentName: "Lumi", source: "voice" });
    }

    // Persist
    const conv = getOrCreateActiveConversation(session.userId, session.agentId);
    if (!conv.title) {
      conv.title = userText.slice(0, 50);
      writeDB(readDB());
    }
    addMessage({ userId: session.userId, agentId: session.agentId, conversationId: conv.id, role: 'user', content: userText, personality: session.personalityId, mode: 'voice' });
    if (responseText) {
      addMessage({ userId: session.userId, agentId: session.agentId, conversationId: conv.id, role: 'assistant', content: responseText, personality: session.personalityId, mode: 'voice' });
    }
    // Topic tracking — extract and record topics for cross-session continuity
    try {
      const topics = extractTopics(userText + ' ' + responseText);
      for (const topic of topics) {
        trackTopic(conv.id, topic);
      }
    } catch {}
    // Text sentiment analysis on user input (matching chat.ts behavior)
    const textSentiment = extractSentiment(userText);
    if (textSentiment.valence !== 0 || textSentiment.urgency > 0 || textSentiment.frustration > 0) {
      try {
        const es = loadEmotionalState(session.userId);
        const updated = updateEmotionalState(es, {
          type: 'sentiment_analysis',
          timestamp: new Date().toISOString(),
          userId: session.userId,
          sentiment: {
            valence: textSentiment.valence,
            frustration: textSentiment.frustration,
            urgency: textSentiment.urgency,
          },
        });
        saveEmotionalState(session.userId, updated);
        try { const hm = loadHIMState(session.userId); const { him: nh } = himTick(updated, hm); saveHIMState(session.userId, nh); } catch {}
      } catch { /* best-effort */ }
    }
    socket.emit('chat:conversation_updated', { conversationId: conv.id, agentId: session.agentId, source: 'voice' });

  } catch (err: any) {
    if (err?.name === 'AbortError') {
      logger.info('[Audio] Pipeline aborted (barge-in or stop)');
    } else {
      logger.error("[Audio Error]:", err);
      socket.emit("agent:error", { message: "Voice processing failed" });
    }
  } finally {
    session.isSpeaking = false;
    session.isProcessing = false;
    session.isBackgroundWork = false;
    session.ttsAbortController = null;

    if (session.isActive) {
      resetSilenceTimer(session, socket);
      socket.emit("audio:status", { status: "listening" });
      socket.emit("agent:status", { status: "idle" });
    }
  }
}

function resetSilenceTimer(session: AudioSession, socket: Socket) {
  if (session.silenceTimer) { clearTimeout(session.silenceTimer); session.silenceTimer = null; }
  session.silenceTimer = setTimeout(() => {
    if (session.isActive && !session.isProcessing) {
      logger.info('[Audio] Silence timeout (5min) — closing STT session');
      if (session.sttSession) {
        session.sttSession.end();
        session.sttSession = null;
      }
      socket.emit("audio:status", { status: "idle" });
    }
  }, 5 * 60 * 1000);
}

export function registerVoiceHandlers(
  socket: Socket,
  llmGetters: {
    getDeepSeek: () => any;
    getGemini: () => any;
    getOpenAI: () => any;
    getAnthropic: () => any;
    getQwen: () => any;
  },
  sensoryFn: (uid: string) => any,
  getUserId: (s: Socket) => string,
) {
  socket.on("audio:start", async (data: { voiceId?: string; personalityId?: string; agentId?: string; transcriptionOnly?: boolean }) => {
    logger.info(`[Audio] Voice call started by ${socket.id}`);
    const session = getAudioSession(socket);
    session.isActive = true;
    session.accumulatedText = '';
    session.isSpeaking = false;
    session.isProcessing = false;
    session.inputQueue = [];
    session.lastChunkTime = 0;
    session.userId = getUserId(socket);
    session.agentId = data.agentId || 'lumi';
    session.transcriptionOnly = data.transcriptionOnly === true;
    const enrolledVoiceprints = session.userId ? getVoiceprints(session.userId) : [];
    session.voiceprintRequired = !session.transcriptionOnly && enrolledVoiceprints.length > 0;
    session.voiceprintMatched = !session.voiceprintRequired;
    session.voiceprintConfidence = 0;
    session.voiceprintLastAt = 0;
    const personalityCfg = personalityRegistry.get(data.personalityId || 'lumi');
    // Use explicit voiceId, then personality's TTS voice, then null (TTS provider default)
    session.currentVoiceId = data.voiceId || personalityCfg?.ttsVoiceId || null;
    session.personalityId = data.personalityId || 'lumi';

    // End previous STT session if re-starting without explicit stop
    if (session.sttSession) { try { session.sttSession.end(); } catch {} session.sttSession = null; }

    const sttProvider = getActiveSTTProvider();
    if (sttProvider) {
      try {
        const language = sttProvider === 'qwen' ? 'zh' : 'zh-CN';
        session.sttSession = createStreamingSession({ provider: sttProvider, language, interimResults: true });
        resetSilenceTimer(session, socket);

        session.sttSession.onResult(async (result) => {
          if (result.text && result.isFinal) {
            if (session.lastChunkTime > 0) {
              recordLatency('stt', Date.now() - session.lastChunkTime);
            }
            logger.info(`[Audio] Final transcript: "${result.text}"`);
            // Feed voice sentiment from Deepgram into emotional state
            if (result.sentiment && session.userId) {
              try {
                const es = loadEmotionalState(session.userId);
                const updated = updateEmotionalState(es, {
                  type: 'sentiment_analysis',
                  timestamp: new Date().toISOString(),
                  userId: session.userId,
                  sentiment: {
                    valence: result.sentiment.sentiment_score,
                    frustration: result.sentiment.sentiment === 'negative' ? 0.6 : 0,
                    urgency: 0,
                  },
                });
                saveEmotionalState(session.userId, updated);
                try { const hm2 = loadHIMState(session.userId); const { him: nh2 } = himTick(updated, hm2); saveHIMState(session.userId, nh2); } catch {}
              } catch { /* best-effort sentiment tracking */ }
            }
            session.accumulatedText += result.text;
            const text = session.accumulatedText.trim();
            session.accumulatedText = '';
            if (!text) return;

            // ── Filter filler words: single-char interjections ──
            const isFiller = /^[嗯啊哦呃哼唉呀哈呵嗨喂诶唔嘶啧哎哦哟嘿嘛哇啦嘞][。！？.!?，,～~]*$/.test(text);
            if (isFiller) {
              logger.info(`[Audio] Ignored filler: "${text}"`);
              return;
            }
            // ── Filter pure noise (no CJK, no letters, no digits) ──
            const hasContent = /[a-zA-Z一-鿿㐀-䶿\d]/.test(text);
            if (!hasContent) {
              logger.info(`[Audio] Ignored pure noise: "${text}"`);
              return;
            }

            if (!isVoiceprintGateOpen(session)) {
              blockUnverifiedVoice(socket, session, 'Ignored transcript before command/barge-in');
              resetSilenceTimer(session, socket);
              return;
            }

            if (session.isProcessing || session.isSpeaking) {
              // Speaking (TTS playing): only long or explicit speech → barge-in
              // Short fragments (< 4 chars) are likely speaker echo, not user speech
              if (session.isSpeaking) {
                if (isEchoText(text)) {
                  logger.info(`[Audio] Echo cancelled during speech: "${text}"`);
                  return;
                }
                logger.info(`[Audio] Barge-in during speech: "${text}" — aborting`);
                if (session.ttsAbortController) {
                  session.ttsAbortController.abort();
                  session.ttsAbortController = null;
                }
                if (session.pipelineAbortController) {
                  session.pipelineAbortController.abort();
                  session.pipelineAbortController = null;
                }
                session.isSpeaking = false;
                session.isProcessing = false;
                socket.emit("audio:status", { status: "interrupted" });
                socket.emit("audio:interrupt-ack", {});
              } else {
                // Processing but not speaking (LLM thinking / tool exec):
                // Any real speech → barge-in, abort current pipeline
                logger.info(`[Audio] Barge-in during processing: "${text}" — aborting`);
                if (session.pipelineAbortController) {
                  session.pipelineAbortController.abort();
                  session.pipelineAbortController = null;
                }
                session.isProcessing = false;
                session.isSpeaking = false;
                socket.emit("audio:status", { status: "interrupted" });
                socket.emit("audio:interrupt-ack", {});
                // Fall through to processInput with new speech
              }
            }

            // Echo confirmation — brief window for user to see what was heard and interrupt if wrong
            socket.emit("audio:confirm", { text });
            logger.info(`[Audio] Heard: "${text}"`);

            if (session.transcriptionOnly) {
              socket.emit("audio:transcript", { text, isFinal: true });
              socket.emit("audio:status", { status: "listening" });
              resetSilenceTimer(session, socket);
              return;
            }

            // Brief delay before processing (user can barge-in during this window)
            session.bargeinTimer = setTimeout(() => {
              session.bargeinTimer = null;
              if (!session.isActive) return;
              processVoiceInput(socket, session, text, llmGetters, sensoryFn).catch(err => {
                logger.error("[Voice Error]:", err);
                session.isSpeaking = false;
                session.isProcessing = false;
                socket.emit("audio:status", { status: "listening" });
              });
            }, 600);
          } else if (result.text && !result.isFinal) {
            socket.emit("audio:transcript", { text: result.text, isFinal: false });
          }
        });

        session.sttSession.onError((err: Error) => {
          logger.error("[Audio STT Error]:", err);
          socket.emit("audio:error", { message: err.message });
        });

        socket.emit("audio:status", { status: "listening" });
      } catch (err: any) {
        logger.error("[Audio Start Error]:", err);
        socket.emit("audio:error", { message: err.message });
      }
    } else {
      socket.emit("audio:status", { status: "listening" });
      socket.emit("audio:error", { message: "No STT provider configured. Set DASHSCOPE_API_KEY or DEEPGRAM_API_KEY." });
    }
  });

  let chunkCount = 0;
  socket.on("audio:chunk", (data: Buffer) => {
    const session = getAudioSession(socket);
    if (!session.isActive) return;
    session.lastChunkTime = Date.now();
    resetSilenceTimer(session, socket);
    if (session.sttSession) {
      session.sttSession.sendAudio(data);
      chunkCount++;
      if (chunkCount === 1 || chunkCount % 50 === 0) {
        logger.info(`[Audio] Sent ${chunkCount} chunks (${data.length} bytes each)`);
      }
    }
  });

  // ── Voiceprint: receive MFCC match results from frontend hook ──
  socket.on("voiceprint:result", (data: { isOwnerSpeaking: boolean; confidence: number }) => {
    const session = getAudioSession(socket);
    session.voiceprintMatched = data.isOwnerSpeaking;
    session.voiceprintConfidence = data.confidence;
    session.voiceprintLastAt = Date.now();
  });

  // ── Presence: periodic heartbeat from usePresence hook ──
  socket.on("presence:heartbeat", (data: { facePresent: boolean; faceConfidence: number; voiceprintMatched: boolean; voiceprintConfidence: number; userId: string }) => {
    const state = updatePresence(data.userId, data);
    const status = state.isAway ? 'away' : (state.facePresent || state.voiceprintMatched ? 'present' : 'uncertain');
    socket.emit('presence:state_change', { isAway: state.isAway, status });
  });

  socket.on("audio:interrupt", () => {
    logger.info(`[Audio] Interrupt from ${socket.id}`);
    const session = getAudioSession(socket);
    session.isSpeaking = false;
    session.accumulatedText = '';
    if (session.ttsAbortController) {
      session.ttsAbortController.abort();
      // DON'T null — the TTS flushSentence queue checks signal.aborted
    }
    if (session.pipelineAbortController) {
      session.pipelineAbortController.abort();
      // DON'T null — the LLM iteration loop checks signal.aborted
    }
    socket.emit("audio:interrupt-ack", {});
  });

  socket.on("audio:stop", () => {
    logger.info(`[Audio] Voice call ended by ${socket.id}`);
    const session = getAudioSession(socket);
    session.isActive = false;
    session.isSpeaking = false;
    session.isProcessing = false;
    session.inputQueue = [];
    session.accumulatedText = '';
    session.transcriptionOnly = false;
    if (session.silenceTimer) { clearTimeout(session.silenceTimer); session.silenceTimer = null; }
    if (session.ttsAbortController) {
      session.ttsAbortController.abort();
      session.ttsAbortController = null;
    }
    if (session.sttSession) {
      session.sttSession.end();
      session.sttSession = null;
    }
    // Clear tracked timers to prevent post-session mutations
    if (session.bargeinTimer) { clearTimeout(session.bargeinTimer); session.bargeinTimer = null; }
    for (const t of session.ttsDecayTimers) { clearTimeout(t); }
    session.ttsDecayTimers = [];
    socket.emit("audio:status", { status: "idle" });
  });

  // Track ambient noise level for environment-gated proactive speech
  socket.on("ambient:noise_level", (data: { rms: number; isSpeaking: boolean; callState: string }) => {
    ambientRms = data.rms;
    ambientRmsLastUpdate = Date.now();
  });

  /**
   * Night / Focus quiet mode: determine whether Lumi should suppress proactive speech.
   */
  function shouldStayQuiet(userId: string): { quiet: boolean; reason: string } {
    const hour = new Date().getHours();
    const nightHours = hour >= 23 || hour < 7;

    if (nightHours) {
      return { quiet: true, reason: 'night_hours' };
    }

    try {
      const { getIdleState } = require('../context/activity_stream');
      const idleState = getIdleState(userId);
      if (idleState.isIdle && idleState.idleSince) {
        const idleMs = Date.now() - new Date(idleState.idleSince).getTime();
        const idleHours = idleMs / (1000 * 60 * 60);
        if (idleHours > 2) {
          return { quiet: true, reason: 'user_flow_state' };
        }
      }
    } catch {}

    const noise = getAmbientNoise();
    if (noise !== null && noise > 0.15) {
      return { quiet: true, reason: 'meeting_detected' };
    }

    return { quiet: false, reason: '' };
  }

  socket.on("proactive:request_speak", async (data: { message: string }) => {
    const session = getAudioSession(socket);
    const userId = getUserId(socket);
    if (!userId || !data.message) return;

    session.isSpeaking = true;
    const resetSpeaking = () => { session.isSpeaking = false; };

    // Gate: night/focus/meeting quiet mode
    const quietCheck = shouldStayQuiet(userId);
    if (quietCheck.quiet) {
      resetSpeaking();
      logger.info(`[ProactiveVoice] Suppressed for ${userId}: ${quietCheck.reason}`);
      return;
    }

    // Resolve voiceId: session first, then personality config, then give up
    let voiceId = session.currentVoiceId;
    if (!voiceId) {
      const personalityCfg = personalityRegistry.get(session.personalityId || 'lumi');
      voiceId = personalityCfg?.ttsVoiceId || null;
    }
    if (!voiceId) { resetSpeaking(); return; }

    // Gate: check initiative level — Lumi only speaks first when comfortable enough
    const es = loadEmotionalState(userId);
    if (es.initiative < 0.4) { resetSpeaking(); return; }

    // Gate: don't interrupt when environment is noisy (user likely in a meeting)
    const noise = getAmbientNoise();
    if (noise !== null && noise > 0.08) { resetSpeaking(); return; }

    const ttsProvider = getTTSProvider();
    if (!ttsProvider) { resetSpeaking(); return; }

    const proactiveVoice = resolveEmotionVoice(voiceId, es);

    try {
      ttsSpeakingCount++;
      addEchoText(data.message);
      const result = await synthesizeSpeech(data.message, {
        provider: ttsProvider,
        voiceId: proactiveVoice.voiceId,
        speechRate: proactiveVoice.speechRate,
        pitch: proactiveVoice.pitch,
        volume: proactiveVoice.volume,
      });
      ttsSpeakingCount = Math.max(0, ttsSpeakingCount - 1);
      const proactiveGain = computeVolumeGain();
      socket.emit("audio:proactive_speak", {
        audioBuffer: result.audioBuffer,
        text: data.message,
        timestamp: new Date().toISOString(),
        volumeGain: proactiveGain,
      });
      logger.info(`[ProactiveVoice] Spoke to ${userId}: "${data.message.slice(0, 60)}"`);
      resetSpeaking();
    } catch (err: any) {
      resetSpeaking();
      logger.warn(`[ProactiveVoice] TTS failed: ${err.message}`);
    }
  });

  // LLM-generated greeting — replaces hardcoded templates with personalized, scene-aware greetings
  socket.on("greeting:generate", async (data: { scene?: string }) => {
    const userId = getUserId(socket);
    if (!userId) return;

    const session = getAudioSession(socket);
    let voiceId = session.currentVoiceId;
    if (!voiceId) {
      const personalityCfg = personalityRegistry.get(session.personalityId || 'lumi');
      voiceId = personalityCfg?.ttsVoiceId || null;
    }
    if (!voiceId) return;

    const es = loadEmotionalState(userId);
    if (es.initiative < 0.3) return; // Lower gate for greetings

    // Build temporal context for scene-aware generation
    let temporalBlock = '';
    try {
      const { generateTemporalContext } = await import('../time/temporal_context');
      temporalBlock = generateTemporalContext(userId);
    } catch {}

    // Fetch a few recent memories for personalization
    let memoryContext = '';
    try {
      const recentMemories = queryMemories({ userId, limit: 3, minConfidence: 0.5 });
      if (recentMemories.length > 0) {
        memoryContext = recentMemories.map(m => `- ${m.content.slice(0, 150)}`).join('\n');
      }
    } catch {}

    // Fetch recent greetings to avoid repetition (greeting dedup)
    let dedupContext = '';
    try {
      const recentGreetings = queryMemories({
        userId,
        query: 'greeting',
        limit: 8,
        minConfidence: 0.5,
      });
      const greetingTexts = recentGreetings
        .filter(m => m.content.includes('[Greeting]') || m.keywords.includes('greeting'))
        .map(m => m.content.replace(/^\[Greeting\]\s*/, '').slice(0, 80));
      if (greetingTexts.length > 0) {
        dedupContext = `\nRecently used greetings (DO NOT repeat these — be completely fresh):\n${greetingTexts.map(g => `- "${g}"`).join('\n')}`;
      }
    } catch {}

    const scene = data.scene || 'return';
    const intimacy = es.intimacy || 0.3;
    const tone = intimacy > 0.6 ? 'warm and intimate' : intimacy > 0.3 ? 'friendly and natural' : 'polite and gentle';

    const greetingPrompt = [
      `Generate a brief, natural spoken greeting in Chinese (under 60 characters).`,
      `Scene: user just ${scene === 'return' ? 'returned to their computer after being away' : scene === 'morning' ? 'started their day' : scene === 'evening' ? 'is winding down' : ' needs a check-in'}.`,
      `Tone: ${tone}.`,
      temporalBlock ? `\nCurrent context:\n${temporalBlock}` : '',
      memoryContext ? `\nRecent topics:\n${memoryContext}\nReference one naturally if relevant.` : '',
      dedupContext,
      `\nDo NOT sound like a report or template. Sound like a friend who noticed they're back. Vary your phrasing — never repeat the same greeting.`,
    ].filter(Boolean).join('\n');

    try {
      const getQwen = llmGetters?.getQwen;
      if (!getQwen) {
        // Fallback to template
        const hour = new Date().getHours();
        const fallback = hour < 6 ? '夜深了，还在忙吗？' : hour < 12 ? '早上好，欢迎回来。' : hour < 18 ? '下午好，继续吧。' : '晚上好，欢迎回来。';
        const result = await synthesizeSpeech(fallback, { provider: getTTSProvider()!, voiceId });
        socket.emit("audio:proactive_speak", { audioBuffer: result.audioBuffer, text: fallback, timestamp: new Date().toISOString(), volumeGain: computeVolumeGain() });
        return;
      }

      const response = await makeLLMCall(
        [{ role: 'user', content: greetingPrompt }],
        [],
        { provider: 'qwen', model: 'qwen-turbo', maxTokens: 120 },
        llmGetters.getDeepSeek,
        llmGetters.getGemini,
        llmGetters.getOpenAI,
        llmGetters.getAnthropic,
        llmGetters.getQwen,
      );

      recordTokenUsage(session.userId, 'qwen', 'qwen-turbo', response.usage, `voice_greet_${Date.now()}`, 'voice');

      const greeting = response.text?.trim() || '';
      if (!greeting) throw new Error('Empty LLM response');

      const ttsProvider = getTTSProvider();
      if (!ttsProvider) return;

      const result = await synthesizeSpeech(greeting, { provider: ttsProvider, voiceId });
      socket.emit("audio:proactive_speak", {
        audioBuffer: result.audioBuffer,
        text: greeting,
        timestamp: new Date().toISOString(),
        volumeGain: computeVolumeGain(),
      });
      // Store greeting in memory for dedup
      addMemory({
        userId,
        type: 'fact',
        content: `[Greeting] ${greeting}`,
        keywords: ['greeting', scene, new Date().toISOString().slice(0, 10)],
        confidence: 1.0,
        sourceInteractionId: `greeting_${Date.now()}`,
        agentId: undefined,
      } as any, { tier: 'episodic', perspective: 'shared_memory', importance: 0.2, source: 'voice' });
      logger.info(`[Greeting] LLM-generated for ${userId}: "${greeting}"`);
    } catch (err: any) {
      logger.warn(`[Greeting] LLM generation failed, using fallback: ${err.message}`);
      const hour = new Date().getHours();
      const fallback = hour < 6 ? '夜深了，还在忙吗？' : hour < 12 ? '早上好，欢迎回来。' : hour < 18 ? '下午好，继续吧。' : '晚上好，欢迎回来。';
      try {
        const ttsProvider = getTTSProvider();
        if (ttsProvider) {
          const result = await synthesizeSpeech(fallback, { provider: ttsProvider, voiceId });
          socket.emit("audio:proactive_speak", { audioBuffer: result.audioBuffer, text: fallback, timestamp: new Date().toISOString(), volumeGain: computeVolumeGain() });
        }
      } catch {}
    }
  });

  socket.on("audio:switch-personality", (data: { personalityId: string }) => {
    const session = getAudioSession(socket);
    if (session.isActive) {
      session.personalityId = data.personalityId;
      logger.info(`[Audio] Personality switched to ${data.personalityId} mid-call`);
    }
  });

  socket.on("disconnect", () => {
    const session = socket.data.audioSession as AudioSession | undefined;
    if (session) {
      if (session.silenceTimer) { clearTimeout(session.silenceTimer); session.silenceTimer = null; }
      if (session.bargeinTimer) { clearTimeout(session.bargeinTimer); session.bargeinTimer = null; }
      for (const t of session.ttsDecayTimers) { clearTimeout(t); }
      session.ttsDecayTimers = [];
      if (session.sttSession) {
        session.sttSession.end();
        session.sttSession = null;
      }
    }
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
}
