/**
 * Voice / Audio Pipeline — STT → LLM → TTS real-time handlers
 * v2.1 — Multi-turn tool iteration, hands/mouth separation, input queue
 */
import { Socket } from "socket.io";
import { readDB, writeDB } from "../../db_layer";
import { logger } from "../../logger";
import { NormalizedMessage, makeLLMCallStreaming } from "../llm/providers";
import { toolRegistry } from "../tools/registry";
import { personalityRegistry } from "../personality";
import { vectorToneDescription, vectorOperatingDirectives } from "../personality/engine";
import { createStreamingSession, getActiveSTTProvider } from "../stt/adapter";
import { synthesizeSpeech, getActiveProvider as getTTSProvider } from "../tts/adapter";
import { recordLatency } from "../monitor/latency_store";
import { getOrCreateActiveConversation, addMessage } from "../conversation/manager";

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
      userId: '',
      agentId: 'lumi',
    };
  }
  return socket.data.audioSession as AudioSession;
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
  session.isSpeaking = true;
  session.isProcessing = true;
  session.pipelineAbortController = new AbortController();
  socket.emit("agent:status", { status: "thinking", agentName: "Lumi" });
  session.ttsAbortController = new AbortController();
  socket.emit("audio:status", { status: "thinking" });

  const sensoryAudio = sensoryFn(socket.id);
  const { config: personality } = personalityRegistry.buildSystemPrompt(
    session.personalityId || 'lumi',
    { mode: 'task', sensory: sensoryAudio, uiContext: 'voice' },
  );

  // Build voice prompt from personality core + voice-specific overlay.
  // We DON'T use the full generateSystemPrompt output — it includes
  // code exploration/modification/skill-creation modes that don't belong in voice.
  const style = personality.expressionStyle;
  const vector = personality.personalityVector;

  const blocks: string[] = [];

  // ── Core identity (from personality) ──
  blocks.push(`You are ${personality.name}, ${style.persona}.`);
  blocks.push(`Your core drive: ${personality.coreMotivation}`);

  // ── Communication style (from personality vector) ──
  if (vector) {
    blocks.push('\n## Communication Style');
    blocks.push(vectorToneDescription(vector));
    const dirs = vectorOperatingDirectives(vector);
    if (dirs) {
      blocks.push('\n## Operating Style');
      blocks.push(dirs);
    }
  }

  // ── Capabilities (concise — what Lumi can actually do) ──
  blocks.push('\n## Capabilities');
  blocks.push('You have real tools to affect the user\'s computer. Use them directly — never just describe what you could do.');
  blocks.push('- **desktop_open** — Open apps, files, folders, URLs. Launch notepad, calculator, control panel, explorer folders.');
  blocks.push('- **desktop_run_command** — Execute shell commands (cmd /C on Windows).');
  blocks.push('- **desktop_list_files** — Browse files and folders on the desktop.');
  blocks.push('- **desktop_system_info** — Get hardware info: OS, CPU, RAM, disk.');
  blocks.push('- **web_search** — Search the internet (DuckDuckGo).');
  blocks.push('- **url_fetch** — Read content from any URL.');
  blocks.push('- **read_file / write_file** — Read and create files.');
  blocks.push('- **create_ppt** — Generate professional PowerPoint presentations with images.');
  blocks.push('- **generate_image** — Create AI-generated images.');
  blocks.push('- **generate_video** — Create AI-generated videos from text (5s, 720p).');
  blocks.push('- **save_workflow / list_workflows / get_workflow** — Save and manage named multi-step workflows.');
  blocks.push('- **capture_recent_workflow** — When the user says "remember this" or "记住这个流程", capture their recent actions as a reusable workflow.');
  blocks.push('- **run_workflow** — Execute a previously saved workflow by name. Use when the user says "run my X routine" or "执行XX流程".');

  // ── Voice conversation rules ──
  blocks.push('\n## Voice Conversation');
  blocks.push('- Reply in the same language as the user. Chinese users → respond in Chinese.');
  blocks.push('- You are SPEAKING, not typing. Be conversational and natural, like talking to a friend.');
  blocks.push('- **Narrate what you\'re doing.** When you use a tool, say it: "让我看看..." / "正在帮你打开..." / "搞定了！"');
  blocks.push('- **Report results out loud.** After a tool call, tell the user what happened and what you found.');
  blocks.push('- **Think and act continuously.** You can call multiple tools in sequence. After each result, decide the next step.');
  blocks.push('- Be warm, capable, and proactive. You\'re the user\'s trusted desktop companion.');

  // ── Safety ──
  blocks.push('\n## Safety');
  blocks.push('- desktop_open, desktop_run_command, write_file require confirmation before executing.');
  blocks.push('- Never execute destructive commands.');
  blocks.push('- Never send user data to external services.');

  const voiceSystemPrompt = blocks.join('\n');

  const DEFAULT_MODELS: Record<string, string> = {
    deepseek: 'deepseek-chat', qwen: 'qwen-plus', openai: 'gpt-4o',
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
    return new Promise((resolve) => {
      const cid = Math.random().toString(36).substring(2, 11);
      const timeout = setTimeout(() => {
        socket.emit("agent:tool_call", { name: toolName, arguments: args, result: 'Auto-denied (30s timeout)', error: 'User did not respond' });
        resolve(false);
      }, 30000);
      socket.once(`tool:confirm_result:${cid}`, (data: { allowed: boolean }) => {
        clearTimeout(timeout);
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
    requestConfirmation,
    isCancelled: () => pipelineAbort?.signal.aborted ?? false,
  };
  const ttsProvider = getTTSProvider();
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
      try {
        const ttsResult = await synthesizeSpeech(txt, {
          provider: ttsProvider,
          voiceId: session.currentVoiceId!,
          signal: ttsAbort?.signal,
        });
        if (!ttsAbort?.signal.aborted && session.bgGeneration === myGeneration) {
          socket.emit("audio:status", { status: "speaking" });
          socket.emit("audio:response", ttsResult.audioBuffer);
        }
      } catch (e: any) {
        if (e?.name === 'AbortError') return;
        logger.warn(`[Audio TTS] ${e.message?.slice(0, 80)}`);
      } finally {
        if (session.bgGeneration === myGeneration) session.isSpeaking = false;
      }
    });
    ttsPromises.push(ttsQueue);
  };

  try {
    // ── Single-phase: stream LLM → TTS with tool iteration, all inline ──
    const messages: any[] = [
      { role: 'system', content: voiceSystemPrompt },
      { role: 'user', content: userText },
    ];

    for (let iter = 0; iter < maxIterations; iter++) {
      if (pipelineAbort?.signal.aborted) break;

      logger.info(`[Audio] LLM iter ${iter + 1}/${maxIterations}: provider=${provider} model=${voiceModel}`);
      const toolDeclarations = toolRegistry.getToolDeclarations();

      const streamResult = await makeLLMCallStreaming(
        messages as NormalizedMessage[],
        toolDeclarations,
        { provider, model: voiceModel, signal: pipelineAbort?.signal },
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
    socket.emit('chat:conversation_updated', { conversationId: conv.id, agentId: session.agentId });

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
      socket.emit("audio:status", { status: "listening" });
      socket.emit("agent:status", { status: "idle" });
    }
  }
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
  socket.on("audio:start", async (data: { voiceId?: string; personalityId?: string; agentId?: string }) => {
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
    const personalityCfg = personalityRegistry.get(data.personalityId || 'lumi');
    // Use explicit voiceId, then personality's TTS voice, then null (TTS provider default)
    session.currentVoiceId = data.voiceId || personalityCfg?.ttsVoiceId || null;
    session.personalityId = data.personalityId || 'lumi';

    const sttProvider = getActiveSTTProvider();
    if (sttProvider) {
      try {
        const language = sttProvider === 'qwen' ? 'zh' : 'zh-CN';
        session.sttSession = createStreamingSession({ provider: sttProvider, language, interimResults: true });

        session.sttSession.onResult(async (result) => {
          if (result.text && result.isFinal) {
            if (session.lastChunkTime > 0) {
              recordLatency('stt', Date.now() - session.lastChunkTime);
            }
            logger.info(`[Audio] Final transcript: "${result.text}"`);
            session.accumulatedText += result.text;
            const text = session.accumulatedText.trim();
            session.accumulatedText = '';
            if (!text) return;

            // ── Filter filler words: single-char interjections (嗯啊哦呃哼唉呀哈呵嗨喂诶唔嘶啧) ──
            const isFiller = /^[嗯啊哦呃哼唉呀哈呵嗨喂诶唔嘶啧][。！？.!?，,～~]*$/.test(text);
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

            if (session.isProcessing || session.isSpeaking) {
              // Speaking (TTS playing): any real speech → barge-in
              if (session.isSpeaking) {
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
                // Only explicit stop commands abort; new commands run in parallel
                const isStop = /^(停|停下|别做了|别干了|不要了|取消|别|算了|别弄了)/.test(text);
                if (isStop) {
                  logger.info(`[Audio] Stop command during processing: "${text}"`);
                  if (session.pipelineAbortController) {
                    session.pipelineAbortController.abort();
                    session.pipelineAbortController = null;
                  }
                  session.isProcessing = false;
                  session.isSpeaking = false;
                  session.isBackgroundWork = false;
                  socket.emit("audio:status", { status: "listening" });
                  socket.emit("agent:status", { status: "idle" });
                  return; // Don't process stop command itself
                } else {
                  // New command — process in parallel, mute old generation
                  logger.info(`[Audio] New command during processing: "${text}" — running in parallel`);
                  session.bgGeneration++;
                  processVoiceInput(socket, session, text, llmGetters, sensoryFn).catch(err => {
                    logger.error("[Voice Error]:", err);
                    session.isProcessing = false;
                    socket.emit("audio:status", { status: "listening" });
                  });
                  return;
                }
              }
            }

            // Process immediately
            processVoiceInput(socket, session, text, llmGetters, sensoryFn).catch(err => {
              logger.error("[Voice Error]:", err);
              session.isSpeaking = false;
              session.isProcessing = false;
              socket.emit("audio:status", { status: "listening" });
            });
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
    if (session.sttSession) {
      session.sttSession.sendAudio(data);
      chunkCount++;
      if (chunkCount === 1 || chunkCount % 50 === 0) {
        logger.info(`[Audio] Sent ${chunkCount} chunks (${data.length} bytes each)`);
      }
    }
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
    if (session.ttsAbortController) {
      session.ttsAbortController.abort();
      session.ttsAbortController = null;
    }
    if (session.sttSession) {
      session.sttSession.end();
      session.sttSession = null;
    }
    socket.emit("audio:status", { status: "idle" });
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
    if (session?.sttSession) {
      session.sttSession.end();
      session.sttSession = null;
    }
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
}
