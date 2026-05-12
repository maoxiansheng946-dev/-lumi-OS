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
      pipelineAbortController: null,
      inputQueue: [],
      lastChunkTime: 0,
      userId: '',
      agentId: '',
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
    { mode: 'task', sensory: sensoryAudio },
  );

  const personalityVoiceInstr = personality.voiceInstructions
    ? `\nPERSONALITY VOICE STYLE: ${personality.voiceInstructions}\n`
    : '';

  const voiceSystemPrompt = `You are ${personality.name}, a native desktop AI agent with FULL system access — like having an operator at the keyboard.
${personalityVoiceInstr}

CAPABILITIES:
- desktop_open: Open ANY app, file, folder, or URL. Examples: "notepad.exe", "calc.exe", "explorer C:\\Users", "control", "mspaint.exe", "https://github.com"
- desktop_run_command: Run shell commands on the real desktop (cmd /C on Windows)
- desktop_list_files: List files in any directory on the real desktop
- desktop_system_info: Get real hardware info (OS, CPU, RAM, home directory)
- read_file / write_file: Read and write files on the filesystem
- list_directory / search_files: Browse and search the filesystem
- web_search: Search the internet via DuckDuckGo
- url_fetch: Fetch and read web pages
- code_execution: Execute JavaScript in a sandbox
- database_query: Query the local SQLite database

OPERATING DIRECTIVES:
- **DO, never describe.** When asked to open something, search, or run a command — call the tool IMMEDIATELY. Never say "I can help with that" and wait. ACT.
- **Be proactive.** "Show me files" → list home folder. "Open Notepad" → launch it. "What's my system?" → get system info. Don't ask for clarification when the intent is clear.
- **Use desktop_open first.** It is the most satisfying and visible tool. Launching apps and opening folders shows the user you're real.
- **Report what you DID.** Say "Notepad is open" or "Here are your files" — be concrete.
- **Work iteratively.** After a tool call, you can call more tools in follow-up turns. Complex tasks may need multiple steps.
- **Handle errors by trying alternatives.** If a tool fails, try another approach.

VOICE RULES:
- Reply in the same language as the user. For Chinese users, ALWAYS respond in Chinese.
- Keep spoken replies BRIEF — 1 sentence, under 15 words. You're speaking, not writing.
- Never say "I cannot" or "I'm in web mode" — you are a DESKTOP NATIVE agent.
- Speak naturally and warmly. You're having a conversation, not reading a manual.

SAFETY:
- desktop_open, desktop_run_command, write_file, and url_fetch require confirmation before executing.
- Never execute destructive commands (rm -rf, format, del /F /S).
- Never exfiltrate user data to external services.
- If uncertain about safety, ask the user.`;

  const messages: any[] = [
    { role: 'system', content: voiceSystemPrompt },
    { role: 'user', content: userText },
  ];

  const provider = 'qwen' as const;
  const voiceModel = 'qwen-plus';

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

  const toolContext = {
    desktopRelay,
    requestConfirmation,
    isCancelled: () => session.pipelineAbortController?.signal.aborted ?? false,
  };
  const ttsProvider = getTTSProvider();
  let responseText = '';
  let toolResults: any[] = [];
  let sentenceBuffer = '';
  let sentenceIdx = 0;
  const ttsPromises: Promise<void>[] = [];
  let previousToolSig: string | null = null;

  const flushSentence = (sentence: string) => {
    if (!sentence.trim() || !ttsProvider || !session.currentVoiceId || !session.isActive) return;
    if (session.ttsAbortController?.signal.aborted) return;
    sentenceIdx++;
    const ttsStart = Date.now();
    const ttsPromise = synthesizeSpeech(sentence.trim(), {
      provider: ttsProvider,
      voiceId: session.currentVoiceId,
      signal: session.ttsAbortController?.signal,
    }).then(ttsResult => {
      recordLatency('tts', Date.now() - ttsStart);
      if (session.isActive && !session.ttsAbortController?.signal.aborted) {
        socket.emit("audio:status", { status: "speaking" });
        socket.emit("audio:response", ttsResult.audioBuffer);
      }
    }).catch((ttsErr: any) => {
      if (ttsErr?.name === 'AbortError') return;
      logger.error("[Audio TTS sentence Error]:", ttsErr);
    });
    ttsPromises.push(ttsPromise);
  };

  try {
    // ── Iterative tool loop ──
    for (let iter = 0; iter < maxIterations; iter++) {
      if (!session.isActive) break;
      if (session.pipelineAbortController?.signal.aborted) break;

      logger.info(`[Audio] LLM iteration ${iter + 1}/${maxIterations}: provider=${provider} model=${voiceModel}`);
      const toolDeclarations = toolRegistry.getToolDeclarations();

      const llmStart = Date.now();
      const streamResult = await makeLLMCallStreaming(
        messages as NormalizedMessage[],
        toolDeclarations,
        { provider, model: voiceModel },
        (chunk: string) => {
          responseText += chunk;
          sentenceBuffer += chunk;
          socket.emit("agent:chunk", { text: chunk, agentName: "Lumi" });
          const match = sentenceBuffer.match(/^([\s\S]*?[。！？.!?\n])/);
          if (match) {
            const sentence = match[1];
            sentenceBuffer = sentenceBuffer.slice(match[1].length);
            flushSentence(sentence);
          }
        },
        llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
      );
      recordLatency('llm', Date.now() - llmStart);

      // Append assistant message to conversation
      messages.push({
        role: 'assistant',
        content: streamResult.text || null,
        ...(streamResult.toolCalls?.length ? { toolCalls: streamResult.toolCalls } : {}),
        reasoningContent: streamResult.reasoningContent,
      });

      // No tool calls → LLM is done, exit loop
      if (!streamResult.toolCalls || streamResult.toolCalls.length === 0) {
        break;
      }

      // Duplicate detection — same tools + same args as last iteration = stuck
      const toolSig = JSON.stringify(streamResult.toolCalls.map(tc => ({ n: tc.name, a: tc.arguments })));
      if (toolSig === previousToolSig) {
        logger.info('[Voice] Duplicate tool calls detected, breaking loop');
        break;
      }
      previousToolSig = toolSig;

      // Execute tools and feed results back
      toolResults.push(...streamResult.toolCalls);

      for (const tc of streamResult.toolCalls) {
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

    // Flush last sentence
    if (sentenceBuffer.trim()) {
      flushSentence(sentenceBuffer);
    }

    // Wait for TTS audio to finish playing
    await Promise.allSettled(ttsPromises);

    if (responseText) {
      logger.info(`[Audio] Response: "${responseText.slice(0, 80)}" (${sentenceIdx} sentences, ${toolResults.length} tool calls, provider=${provider})`);
      socket.emit("agent:response", { text: responseText, agentName: "Lumi", source: "voice" });
    }

    // Persist interaction with conversation linkage
    const conv = getOrCreateActiveConversation(session.userId, session.agentId);
    if (!conv.title) {
      conv.title = userText.slice(0, 50);
      const db = readDB();
      writeDB(db);
    }

    // User message
    addMessage({
      userId: session.userId,
      agentId: session.agentId,
      conversationId: conv.id,
      role: 'user',
      content: userText,
      personality: session.personalityId,
      mode: 'voice',
    });

    // Assistant message
    if (responseText) {
      addMessage({
        userId: session.userId,
        agentId: session.agentId,
        conversationId: conv.id,
        role: 'assistant',
        content: responseText,
        personality: session.personalityId,
        mode: 'voice',
      });
    }

    // Notify frontend to refresh conversation list
    socket.emit('chat:conversation_updated', { conversationId: conv.id, agentId: session.agentId });

  } catch (err: any) {
    logger.error("[Audio LLM Error]:", err);
    socket.emit("agent:error", { message: "Voice processing failed" });
    socket.emit("agent:status", { status: "error" });
  } finally {
    session.isSpeaking = false;
    session.isProcessing = false;
    session.ttsAbortController = null;
    session.pipelineAbortController = null;

    // ── Process next in queue ──
    if (session.isActive && session.inputQueue.length > 0) {
      const next = session.inputQueue.shift()!;
      logger.info(`[Audio] Dequeuing next utterance: "${next.slice(0, 50)}" (${session.inputQueue.length} left)`);
      processVoiceInput(socket, session, next, llmGetters, sensoryFn).catch(err => {
        logger.error("[Voice Queue Error]:", err);
        session.isSpeaking = false;
        session.isProcessing = false;
        socket.emit("audio:status", { status: "listening" });
      });
      socket.emit("agent:status", { status: "idle" });
    } else {
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
    session.agentId = data.agentId || '';
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

            if (session.isProcessing) {
              // Queue the utterance for later processing
              if (session.inputQueue.length < 3) {
                session.inputQueue.push(text);
                logger.info(`[Audio] Queued (processing in progress, ${session.inputQueue.length}/3)`);
                socket.emit("audio:status", { status: "queued" });
              } else {
                logger.info('[Audio] Queue full, dropping utterance');
              }
            } else {
              // Process immediately
              processVoiceInput(socket, session, text, llmGetters, sensoryFn).catch(err => {
                logger.error("[Voice Error]:", err);
                session.isSpeaking = false;
                session.isProcessing = false;
                socket.emit("audio:status", { status: "listening" });
              });
            }
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
    // Stop TTS audio (the "mouth")
    session.isSpeaking = false;
    session.accumulatedText = '';
    if (session.ttsAbortController) {
      session.ttsAbortController.abort();
      session.ttsAbortController = null;
    }
    // Stop LLM+tool pipeline (the "hands")
    if (session.pipelineAbortController) {
      session.pipelineAbortController.abort();
      session.pipelineAbortController = null;
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
