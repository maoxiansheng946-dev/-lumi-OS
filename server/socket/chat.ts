/**
 * agent:chat socket handler — the core conversational AI pipeline
 */
import { Socket } from "socket.io";
import jwt from "jsonwebtoken";
import { readDB, writeDB } from "../../db_layer";
import { pushNotification } from "../routes/notifications";
import { NormalizedMessage, makeLLMCall, makeLLMCallStreaming, StreamCallback } from "../llm/providers";
import { LLMUsage } from "../tools/types";
import { toolRegistry } from "../tools/registry";
import { runWithTools } from "../llm/adapter";
import { getOperationModeConfig, parseStoredOperationMode } from "../cognition/operation_modes";
import { shouldAllowToolUseForTurn, shouldExposeAgentWork } from "../cognition/tool_intent";
import { formatClientSelfPrompt } from "../client/self_model";
import { queryMemories, queryMemoriesVector, addMemory, addReminder, extractMemories } from "../memory";
import { loadEmotionalState, saveEmotionalState, updateEmotionalState, updateEmotionalStateWithHIM, loadHIMState, saveHIMState, generateContextualGreeting, vectorMemoryBias } from "../personality/state";
import { buildModeOverlay } from "../personality/engine";
import { personalityRegistry } from "../personality";
import { lightweightEvolve } from "../personality/evolution";
import { getOrCreateActiveConversation, addMessage, getMessages, getMessagesByTokenBudget, checkAutoSummary, setConversationSummary, getConversationSummary, setConversationMode, getUnclosedConversation, extractTopics, trackTopic, getTopicContext } from "../conversation/manager";
import { ensureBranch } from "../memory/tree";
import { retrieveChunks } from "../agents/rag";
import { getSensory } from "./shared";
import { processInput, handleLLMFailure, extractSentiment, CognitiveContext } from "../cognition";
import { matchQuickCommand } from "../cognition/quick_commands";
import { checkLLMAccess, recordUsage, estimateTokens } from "../subscription/proxy";
import { recordTokenUsage } from "../llm/token_tracker";
import { runOrchestratedTask, shouldDistillSkill, buildSkillDescription } from "../agents/orchestrator";
import { runNLChainer, shouldChainTask } from "../agents/nl_chainer";
import { autoInstallForTask } from "../agents/auto_installer";
import { emitMusicAtmosphere } from "../socket/music";
import { searchKnowledgeBase } from "../org/kb";
import { getWorkflow, recordWorkflowRun, listWorkflows } from "../agents/workflows";
import { buildProfessionOverlay } from "../autonomy/professions";

const JWT_SECRET = process.env.JWT_SECRET || 'lumiOS_default_jwt_secret_2026_local';

export function registerChatHandler(
  socket: Socket,
  llmGetters: {
    getDeepSeek: () => any;
    getGemini: () => any;
    getOpenAI: () => any;
    getAnthropic: () => any;
    getQwen: () => any;
    getOllama: () => any;
    isOllamaAvailable: () => boolean;
    getLmStudio: () => any;
    isLmStudioAvailable: () => boolean;
  },
  sensoryFn: (uid: string) => any,
  userIdFn: (s: Socket) => string,
) {
  const chatSessionMap = new Map<string, AbortController>();

  // Handle abort requests
  socket.on("agent:abort_chat", () => {
    const uid = userIdFn(socket);
    const controller = chatSessionMap.get(uid);
    if (controller) {
      controller.abort();
      chatSessionMap.delete(uid);
      socket.emit("agent:status", { status: "idle" });
      socket.emit("agent:response", { text: "[Cancelled]", agentName: "Lumi", source: "chat" });
    }
  });

  socket.on("agent:chat", async (data: { text: string; history: any[]; personalityId?: string; category?: string; agentId?: string; domain?: string; orgId?: string | null; mode?: string; source?: string }) => {
    console.log('[ChatHandler] agent:chat RECEIVED:', JSON.stringify(data).slice(0, 300));
    const { text, history, personalityId = "lumi", category, agentId, mode: payloadMode, source } = data;
    const conversationAgentId = agentId || 'lumi';
    const uid = userIdFn(socket);
    console.log('[ChatHandler] uid:', uid, 'agentId:', agentId, 'source:', source);

    // Work context comes from the authenticated socket token. Personal mode can be
    // explicitly requested by the desktop UI to avoid a stale org token leaking into
    // local personal conversations.
    let resolvedDomain = 'personal';
    let resolvedOrgId = '';
    try {
      const authToken = socket.handshake?.auth?.token;
      if (authToken) {
        const decoded: any = jwt.verify(authToken, JWT_SECRET);
        if (data.domain === 'personal') {
          resolvedDomain = 'personal';
          resolvedOrgId = '';
        } else if (decoded.orgId) {
          resolvedDomain = 'work';
          resolvedOrgId = decoded.orgId;
        }
      }
    } catch {}
    console.log('[ChatHandler] domain:', resolvedDomain, 'orgId:', resolvedOrgId);

    // Abort any previous chat session for this user
    const prevController = chatSessionMap.get(uid);
    if (prevController) prevController.abort();
    const abortController = new AbortController();
    chatSessionMap.set(uid, abortController);

    try {
      // Look up agent record for memory/emotion isolation
      const agentRecord = agentId
        ? readDB().agents.find((a: any) => a.id === agentId) || null
        : null;
      console.log('[ChatHandler] agentRecord found:', !!agentRecord);
      const memoryScope = agentRecord?.memoryScope || 'shared';
      const agentMemoryFilter = memoryScope === 'private' ? agentId : undefined;
      const isSanctuary = agentRecord?.territory === 'sanctuary';

      // Retrieve personality vector early to bias memory retrieval (cross-system fusion: vector→memory)
      const personalityConfig = personalityRegistry.get(personalityId);
      console.log('[ChatHandler] personalityConfig:', !!personalityConfig);
      const retrievalBiases = personalityConfig?.personalityVector
        ? vectorMemoryBias(personalityConfig.personalityVector)
        : { typeWeights: {}, perspectiveWeights: {} };

      // Vector semantic search with keyword fallback
      const relevantMemories = await queryMemoriesVector({
        userId: uid, query: text, limit: 5, minConfidence: 0.4, agentId: agentMemoryFilter,
        retrievalTypeWeights: retrievalBiases.typeWeights,
        retrievalPerspectiveWeights: retrievalBiases.perspectiveWeights,
        domain: resolvedDomain,
        orgId: resolvedOrgId,
        useVector: true,
      });
      console.log('[ChatHandler] relevantMemories (vector):', relevantMemories.length);

      // RAG: retrieve relevant knowledge chunks from agent's ingested documents
      let ragChunks: string[] = [];
      if (agentId) {
        const chunks = retrieveChunks(uid, agentId, text, 3);
        ragChunks = chunks.map((c: any) => c.content);
      }

      // Org: search company KB when in work domain
      let kbContext: string | undefined;
      if (resolvedDomain === 'work' && resolvedOrgId) {
        try {
          const kbResults = await searchKnowledgeBase(resolvedOrgId, text, 3);
          if (kbResults.length > 0) {
            kbContext = kbResults
              .map(r => `[${r.title}] ${r.chunk}`)
              .join('\n');
            console.log('[ChatHandler] KB search results:', kbResults.length, 'articles found');
          }
        } catch (err: any) {
          console.warn('[ChatHandler] KB search failed:', err.message);
        }
      }

      const emotionKey = agentMemoryFilter ? `${uid}_agent_${agentId}` : uid;
      const emotionalState = loadEmotionalState(emotionKey);
      const himState = loadHIMState(emotionKey);
      console.log('[ChatHandler] emotionalState loaded');
      const isNovel = relevantMemories.length < 2;

      // ── Conversation mode: get/create conversation, apply mode from payload ──
      const conversation = getOrCreateActiveConversation(uid, conversationAgentId, resolvedDomain, resolvedOrgId);
      const conversationId = conversation?.id;
      // Cross-session continuity: inject previous conversation context if starting fresh
      let previousSessionContext: string | null = null;
      if (!conversationId) {
        const prevConv = getUnclosedConversation(uid);
        if (prevConv && prevConv.id !== conversationId) {
          const prevSummary = getConversationSummary(prevConv.id);
          if (prevSummary) {
            previousSessionContext = `## Previous Session (${prevConv.lastActiveAt?.slice(0, 10) || 'recent'})\nYou and the user were discussing: ${prevSummary}\n\nContinue naturally. The user may want to pick up where you left off.`;
          }
        }
      }
      const conversationMode = payloadMode || conversation?.mode || undefined;
      if (conversation && payloadMode && payloadMode !== conversation.mode) {
        setConversationMode(conversation.id, payloadMode);
      }
      console.log('[ChatHandler] conversationId:', conversationId, 'mode:', conversationMode);

      const sensory = sensoryFn(uid);
      console.log('[ChatHandler] sensory loaded');
      const { config: personality, systemPrompt: systemInstruction } = personalityRegistry.buildSystemPrompt(
        personalityId,
        { mode: 'chat', sensory },
        {
          memories: relevantMemories.length > 0 ? relevantMemories : undefined,
          ragKnowledge: ragChunks.length > 0 ? ragChunks : undefined,
          emotionalState,
          userId: uid,
          userText: text,
        },
      );
      console.log('[ChatHandler] systemPrompt built, personality name:', personality?.name);

      // Inject conversation summary chain for long-running conversations (anti-entropy)
      let effectiveSystemPrompt = systemInstruction;
      if (conversationId) {
        const summaryContext = getConversationSummary(conversationId);
        if (summaryContext) {
          effectiveSystemPrompt += `\n\n## Conversation Context\n${summaryContext}`;
        }
      }
      // Cross-session: inject previous conversation context when starting fresh
      if (previousSessionContext) {
        effectiveSystemPrompt += `\n\n${previousSessionContext}`;
      }

      // Topic continuity: inject recent conversation topics
      if (conversationId) {
        const topicCtx = getTopicContext(conversationId);
        if (topicCtx) {
          effectiveSystemPrompt += topicCtx;
        }
      }

      // Inject conversation mode overlay (shapes interaction style without changing personality)
      if (conversationMode) {
        const modeOverlay = buildModeOverlay(conversationMode);
        if (modeOverlay) {
          effectiveSystemPrompt += '\n\n' + modeOverlay;
        }
      }

      // Inject company knowledge base context when in work domain
      if (kbContext) {
        effectiveSystemPrompt += `\n\n## Company Knowledge Base\n${kbContext}\n\nUse the above company knowledge to inform your response. Cite article titles when referencing company policy.`;
      }

      // Inject profession context — adapt language and expertise to user's trade
      try {
        const professionOverlay = buildProfessionOverlay();
        if (professionOverlay) {
          effectiveSystemPrompt += professionOverlay;
        }
      } catch {}

      // Inject contact context when user mentions people they know
      try {
        const { matchContactsFromText } = await import('../contacts/store');
        const { formatContactsForContext } = await import('../contacts/context');
        const mentioned = matchContactsFromText(uid, text);
        if (mentioned.length > 0) {
          effectiveSystemPrompt += '\n\n' + formatContactsForContext(mentioned);
          effectiveSystemPrompt += '\n\nYou know these people personally. Use this information to provide relevant, contextual responses when the user asks about them.';
        }
      } catch {}

      const interactionId = crypto.randomUUID();

      const emitToolLifecycle = (payload: {
        correlationId: string;
        name: string;
        arguments: Record<string, any>;
        args?: Record<string, any>;
        result?: string;
        error?: string;
      }) => {
        const normalized = { ...payload, args: payload.args ?? payload.arguments };
        socket.emit("agent:tool_call", normalized);
        socket.emit("agent:tool", normalized);
      };

      const isDirectDesktopTool = (toolName: string) => toolName.startsWith('desktop_');

      // ── Desktop relay: enables 15 tools (mouse/keyboard/clipboard/screenshot/etc) in chat ──
      const desktopRelay = ((toolName: string, args: Record<string, any>): Promise<string> => {
        return new Promise((resolve, reject) => {
          const cid = crypto.randomUUID();
          const uiCid = `desktop-${cid}`;
          const eventName = `tool:desktop_result:${cid}`;
          let settled = false;
          let timeout: ReturnType<typeof setTimeout> | undefined;

          emitToolLifecycle({ correlationId: uiCid, name: toolName, arguments: args });

          const finishWithError = (message: string) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            socket.off(eventName, onResult);
            emitToolLifecycle({ correlationId: uiCid, name: toolName, arguments: args, error: message });
            reject(new Error(message));
          };

          const onResult = (data: { output?: string; error?: string }) => {
            if (settled) return;
            settled = true;
            if (timeout) clearTimeout(timeout);
            if (data.error) {
              emitToolLifecycle({ correlationId: uiCid, name: toolName, arguments: args, error: data.error });
              reject(new Error(data.error));
              return;
            }
            const output = data.output || '';
            emitToolLifecycle({ correlationId: uiCid, name: toolName, arguments: args, result: output.slice(0, 500) });
            resolve(output);
          };

          timeout = setTimeout(() => finishWithError(`Desktop tool "${toolName}" timed out (30s)`), 30000);
          socket.once(eventName, onResult);
          socket.emit('tool:desktop_exec', { correlationId: cid, name: toolName, arguments: args });
        });
      });

      socket.emit("agent:status", { status: "thinking", agentName: personality.name });
      console.log('[ChatHandler] emitted agent:status thinking');

      // Read user's operation mode from DB
      const operationMode = (() => {
        try {
          const db = readDB();
          const setting = (db.settings || []).find((s: any) => s.key === `op_mode_${uid}`);
          if (setting) return parseStoredOperationMode(setting.value);
        } catch {}
        return 'assistant';
      })();

      // Inject operation mode prompt overlay
      const opModeConfig = getOperationModeConfig(operationMode);
      const allowToolUseForTurn = shouldAllowToolUseForTurn(text, source, operationMode);
      const exposeAgentWork = shouldExposeAgentWork(text);
      effectiveSystemPrompt += '\n\n' + formatClientSelfPrompt(uid);
      console.log('[ChatHandler] tool gate:', allowToolUseForTurn ? 'enabled' : 'chat-only', 'operationMode:', operationMode);
      if (opModeConfig && (allowToolUseForTurn || operationMode === 'music' || operationMode === 'meeting')) {
        effectiveSystemPrompt += '\n\n' + opModeConfig.promptOverlay;
      } else {
        effectiveSystemPrompt += '\n\n## Interaction Mode\nThis turn is chat-only. Do not call tools, operate the desktop, or claim that you are taking actions. Answer naturally unless the user gives an explicit command.';
      }

      // Canvas mode: full-power assistant with visual plan-first workflow
      if (source === 'canvas') {
        effectiveSystemPrompt += '\n\n## Canvas Workbench\nYou are working inside the Canvas Workbench — a visual workspace where the user sees your thought process as cards.\n- You have FULL access to all tools including desktop control, file system, commands, mouse/keyboard.\n- Before executing destructive or desktop-modifying actions, show a plan card first so the user can see what you intend to do.\n- After each major step, summarize the result as a card.\n- When generating code, assets, or analysis, put the final output in the canvas as well.\n- The canvas is your visual trace — not a sandbox.';
      }

      // Read user's LLM prefs from settings (synced from API Matrix)
      const userLLMPrefs = (() => {
        try {
          const db = readDB();
          const setting = (db.settings || []).find((s: any) => s.key === `llm_prefs_${uid}`);
          if (setting) return JSON.parse(setting.value);
        } catch {}
        return { provider: '', models: {} };
      })();
      const DEFAULT_MODELS: Record<string, string> = {
        deepseek: 'deepseek-chat', qwen: 'qwen-plus', openai: 'gpt-4o',
        gemini: 'gemini-2.0-flash', anthropic: 'claude-sonnet-4-6',
      };
      const resolveProvider = (model: string) =>
        model.startsWith('deepseek') ? 'deepseek' as const
        : model.startsWith('qwen') ? 'qwen' as const
        : model.startsWith('gpt') || model.startsWith('o1') ? 'openai' as const
        : model.startsWith('claude') ? 'anthropic' as const
        : 'gemini' as const;

      let activeProvider = userLLMPrefs.provider || 'deepseek';
      let activeModel = (userLLMPrefs.models || {})[activeProvider] || DEFAULT_MODELS[activeProvider] || 'deepseek-chat';

      // ── Hybrid dispatch: if Ollama is available and no explicit cloud provider, use auto ──
      if (llmGetters.isOllamaAvailable() && (!userLLMPrefs.provider || userLLMPrefs.provider === 'auto')) {
        activeProvider = 'auto';
        activeModel = 'qwen2.5:7b';
        console.log('[Chat] Hybrid mode enabled — local Ollama → cloud DeepSeek');
      }

      // ── Subscription enforcement (with fallback) ──
      const access = checkLLMAccess({ userId: uid, provider: activeProvider, model: activeModel });
      if (!access.allowed) {
        // Try each other configured provider from prefs
        const fallbackCandidates = Object.entries(userLLMPrefs.models || {})
          .filter(([p]) => p !== activeProvider)
          .map(([p, m]) => ({ provider: p, model: m as string }));
        let found = false;
        for (const { provider: fbProvider, model: fbModel } of fallbackCandidates) {
          const fbAccess = checkLLMAccess({ userId: uid, provider: fbProvider, model: fbModel });
          if (fbAccess.allowed) {
            activeProvider = fbProvider;
            activeModel = fbModel;
            console.log(`[Chat] Subscription fallback: ${activeProvider} → ${fbProvider} for user ${uid}`);
            found = true;
            break;
          }
        }
        if (!found) {
          socket.emit("agent:error", {
            message: access.reason,
            code: access.tokenLimitReached ? 'TOKEN_LIMIT' : 'PROVIDER_RESTRICTED',
          });
          socket.emit("agent:status", { status: "error" });
          return;
        }
      }

      // ── Named Workflow Quick-Path: "run my X" / "跑XX流程" ──
      const runWorkflowMatch = text.match(/(?:run|执行|跑|运行)\s+(?:my\s+)?(.+?)(?:\s*(?:routine|workflow|流程|工作流))?\s*$/i);
      let workflowQuickResult: string | null = null;
      if (runWorkflowMatch) {
        const wfName = runWorkflowMatch[1].trim().toLowerCase();
        const allWfs = listWorkflows(uid);
        const matched = allWfs.find(w => w.name.toLowerCase().includes(wfName));
        if (matched) {
          console.log('[ChatHandler] Workflow quick-path matched:', matched.name);
          const steps: string[] = [];
          for (let i = 0; i < matched.steps.length; i++) {
            const step = matched.steps[i];
            if (step.tool) {
              try {
                const result = await toolRegistry.execute(step.tool, step.args || {}, { userId: uid });
                steps.push(`Step ${i + 1} (${step.tool}): ${(result || 'OK').slice(0, 200)}`);
              } catch (e: any) {
                steps.push(`Step ${i + 1} (${step.tool}): Error - ${e.message}`);
                break;
              }
            } else {
              steps.push(`Step ${i + 1}: ${step.description} (no tool bound — use this as a guide)`);
            }
          }
          recordWorkflowRun(uid, matched.name);
          workflowQuickResult = `Ran workflow "${matched.name}" (${matched.steps.length} steps):\n${steps.join('\n')}`;
        }
      }

      if (workflowQuickResult) {
        socket.emit("agent:status", { status: "responding" });
        socket.emit("agent:response", { text: workflowQuickResult, agentName: personality.name, source: "chat" });
        socket.emit("agent:status", { status: "idle" });
        return;
      }

      // ── Quick Command Fast-Path: deterministic commands skip LLM entirely ──
      try {
        const quickResult = await matchQuickCommand(text, uid);
        if (quickResult?.matched) {
          console.log('[ChatHandler] Quick command:', text.slice(0, 60));
          if (quickResult.toolCall) {
            const toolCid = `qc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
            const shouldEmitQuickTool = !isDirectDesktopTool(quickResult.toolCall.name);
            if (shouldEmitQuickTool) {
              emitToolLifecycle({
                correlationId: toolCid,
                name: quickResult.toolCall.name,
                arguments: quickResult.toolCall.arguments,
              });
            }
            try {
              const tcResult = await toolRegistry.execute(quickResult.toolCall.name, quickResult.toolCall.arguments, { userId: uid, desktopRelay, llmGetters });
              if (shouldEmitQuickTool) {
                emitToolLifecycle({
                  correlationId: toolCid,
                  name: quickResult.toolCall.name,
                  arguments: quickResult.toolCall.arguments,
                  result: tcResult?.slice(0, 500) || '',
                });
              }
            } catch (toolErr: any) {
              if (shouldEmitQuickTool) {
                emitToolLifecycle({
                  correlationId: toolCid,
                  name: quickResult.toolCall.name,
                  arguments: quickResult.toolCall.arguments,
                  error: toolErr.message,
                });
              }
            }
          }
          socket.emit("agent:response", { text: quickResult.responseText, agentName: personality.name, source: "quick_command" });
          if (conversationId) {
            addMessage({ userId: uid, agentId: conversationAgentId, conversationId, role: 'user', content: text, personality: personality.id, domain: resolvedDomain, orgId: resolvedOrgId });
            if (quickResult.toolCall) {
              addMessage({ userId: uid, agentId: conversationAgentId, conversationId, role: 'tool', content: `[Tool: ${quickResult.toolCall.name}] Called`, domain: resolvedDomain, orgId: resolvedOrgId });
            }
            addMessage({ userId: uid, agentId: conversationAgentId, conversationId, role: 'assistant', content: quickResult.responseText, personality: personality.id, domain: resolvedDomain, orgId: resolvedOrgId });
            socket.emit('chat:conversation_updated', { conversationId, agentId: conversationAgentId, source: source === 'canvas' ? 'canvas' : 'chat' });
          }
          socket.emit("agent:status", { status: "idle" });
          // Track topics for quick commands too
          if (conversationId) {
            try {
              const topics = extractTopics(text);
              for (const topic of topics) trackTopic(conversationId, topic);
            } catch {}
          }
          chatSessionMap.delete(uid);
          return;
        }
      } catch (qcErr: any) {
        console.warn('[ChatHandler] Quick command check failed, falling through:', qcErr.message);
      }

      // ── Lumi Cognitive Engine: classify intent BEFORE calling any LLM ──
      const cognitiveCtx: CognitiveContext = {
        userId: uid,
        agentId: agentId || undefined,
        personalityId: personality.id,
        personalityName: personality.name,
        llmProvider: activeProvider,
        llmModel: activeModel,
        isLLMAvailable: true,
      };
      // LLM classifier for ambiguous intents — fast tiny call (50 tokens max)
      const llmClassifier = async (prompt: string, userText: string): Promise<string> => {
        const messages: NormalizedMessage[] = [
          { role: 'system', content: prompt },
          { role: 'user', content: userText },
        ];
        const result = await makeLLMCall(
          messages,
          [],
          { provider: activeProvider, model: activeProvider === 'deepseek' ? 'deepseek-v4-flash' : activeModel, userId: uid, maxTokens: 60 },
          llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
        );
        return result.text || '{"category":"unknown","confidence":0.5,"entities":{}}';
      };

      const cognition = await processInput(text, cognitiveCtx, llmClassifier);
      console.log('[ChatHandler] cognition result:', cognition.intent.category, 'directToolExecuted:', cognition.directToolExecuted, 'responseText:', cognition.responseText?.slice(0, 100));

      // ── Sentiment analysis: detect emotional charge in user input ──
      const sentiment = extractSentiment(text);
      if (sentiment.valence !== 0 || sentiment.urgency > 0 || sentiment.frustration > 0) {
        console.log('[ChatHandler] sentiment:', sentiment);
      }

      // Auto-select model: flash for simple chat, pro for complex tasks
      const complexCategories = ['command', 'code', 'question', 'analysis'];
      const isComplex = complexCategories.includes(cognition.intent.category);
      if (activeProvider === 'deepseek') {
        activeModel = isComplex ? 'deepseek-v4-pro' : 'deepseek-chat';
      } else if (activeProvider === 'qwen') {
        activeModel = isComplex ? 'qwen-max' : 'qwen-plus';
      } else if (activeProvider === 'gemini') {
        activeModel = isComplex ? 'gemini-2.5-pro' : 'gemini-2.0-flash';
      } else if (activeProvider === 'openai') {
        activeModel = isComplex ? 'gpt-4o' : 'gpt-4o-mini';
      }
      console.log('[ChatHandler] Model auto-selected:', activeProvider, '/', activeModel, 'for category:', cognition.intent.category);

      let responseText = '';
      let llmWasCalled = false;

      if (cognition.directToolExecuted && cognition.responseText) {
        // Path A: Lumi handled this directly — no LLM needed
        responseText = cognition.responseText;
        console.log(`[Cognition] Direct tool '${cognition.intent.directToolCall?.name}' handled without LLM`);
      }

      // Path A2: Music intent — detect and handle BEFORE orchestrator (so LLM doesn't use desktop_open)
      if (!responseText && /放.*歌|放.*音乐|来首歌|播放|听.*歌|来点音乐|给我放|随便放点|我想听|搜.*歌|换.*歌|切.*歌/.test(text)) {
        try {
          const { searchAndPlay } = await import('../music/search_play');
          const result = await searchAndPlay(uid, socket, text);
          if (result.success && result.text) {
            responseText = result.text;
            llmWasCalled = true;
          }
        } catch (musicErr: any) {
          console.warn('[Music Intent] Failed:', musicErr.message);
        }
      }

      if (!responseText && allowToolUseForTurn && !isSanctuary && (cognition.intent.category === 'command' || cognition.intent.category === 'code' || cognition.intent.category === 'question')) {
        // Path B: Orchestrator — decompose tasks into sub-tasks for worker agents
        // (Skipped for sanctuary agents — they stay in their territory)
        try {
          socket.emit("agent:status", { status: "thinking", agentName: exposeAgentWork ? "Lumi Orchestrator" : personality.name, phase: exposeAgentWork ? 'orchestrator' : 'background' });
          const orchResult = await runOrchestratedTask(
            text,
            { userId: uid, personalityId, desktopRelay },
            { provider: activeProvider, model: activeModel },
            llmGetters,
            exposeAgentWork ? (msg) => socket.emit("agent:chunk", { text: msg, agentName: "Lumi" }) : undefined,
          );
          if (orchResult) {
            responseText = orchResult.responseText;
            llmWasCalled = true;

            // Check if this pattern should be auto-distilled into a skill
            if (shouldDistillSkill(text) && orchResult.workflowResult.totalAgentsUsed >= 2) {
              const skillDesc = buildSkillDescription(text, orchResult.workflowResult);
              console.log('[Orchestrator] Pattern detected — candidate for skill distillation:', skillDesc.slice(0, 100));
              socket.emit("agent:proactive", {
                type: 'distill_hint',
                message: 'I notice this type of task is recurring. I can create an automated skill for this — would you like me to?',
                skillDescription: skillDesc,
                timestamp: new Date().toISOString(),
              });
              pushNotification(uid, { type: 'distill_hint', title: 'Skill Distillation', message: 'I notice this type of task is recurring. I can create an automated skill for this.' });
            }
          }
        } catch (orchErr: any) {
          console.error('[Orchestrator] Workflow failed, falling back to normal chat:', orchErr.message);
        }
      }

      const allToolRecords: { name: string; args: string; result?: string; error?: string }[] = [];

      // Path B2: NL Task Chainer — for office workflows that chain tools (search→read→create etc.)
      if (!responseText && allowToolUseForTurn && shouldChainTask(text)) {
        // Pre-flight: auto-install any matching uninstalled/outdated skills
        await autoInstallForTask(text, { emit: (event, data) => socket.emit(event, data) });

        try {
          socket.emit("agent:status", { status: "thinking", agentName: personality.name, phase: 'background' });
          const chainerResult = await runNLChainer(
            text,
            { userId: uid, provider: activeProvider, model: activeModel, desktopRelay, context: { isCancelled: () => abortController.signal.aborted, toolPolicy: personality.toolPolicy } },
            llmGetters,
            (step, total, desc) => {
              socket.emit("agent:status", { status: "thinking", agentName: personality.name, phase: 'background', detail: `Step ${step}/${total}: ${desc}` });
            },
          );
          if (chainerResult.finalResponse) {
            responseText = chainerResult.finalResponse;
            llmWasCalled = true;
            console.log('[NLChainer] Completed with', chainerResult.stepResults.length, 'steps. Goal:', chainerResult.plan.goal);
          }
        } catch (chainErr: any) {
          console.error('[NLChainer] Failed, falling back to normal chat:', chainErr.message);
        }
      }

      if (!responseText) {
        // Path C: Normal LLM path (simple queries, or orchestrator fallback)

        // Load conversation history from persistence (survives page reload / reconnect)
        let persistedHistory: NormalizedMessage[] = [];
        if (conversationAgentId) {
          const conv = getOrCreateActiveConversation(uid, conversationAgentId, resolvedDomain, resolvedOrgId);
          const msgs = getMessagesByTokenBudget(conv.id);
          persistedHistory = msgs
            .filter((m: any) => m.message || m.response)
            .flatMap((m: any) => {
              const entries: NormalizedMessage[] = [];
              if (m.message) entries.push({ role: m.role || 'user', content: m.message });
              if (m.response) entries.push({ role: 'assistant', content: m.response });
              return entries;
            });
        }

        const conversationHistory = persistedHistory.length > 0
          ? persistedHistory
          : (history ? history.map((m: any) => ({ role: m.role, content: m.content })) : []);

        // Tell Lumi which model is currently active so it can self-identify correctly
        const selfAwareness = `\n\n[System note: You are currently running on ${activeProvider} provider, model: ${activeModel}. If asked, mention this exact model.]`;
        const messages: NormalizedMessage[] = [
          { role: 'system', content: effectiveSystemPrompt + selfAwareness },
          ...conversationHistory,
          { role: 'user', content: text },
        ];

        try {
          console.log('[ChatHandler] Calling Path C with provider:', activeProvider, 'model:', activeModel, 'tools:', allowToolUseForTurn && !isSanctuary ? 'enabled' : 'off');
          const streamChunks: string[] = [];
          const onChunk: StreamCallback = (chunk) => {
            streamChunks.push(chunk);
            socket.emit("agent:chunk", { text: chunk, agentName: personality.name });
          };

          // Sanctuary agents get zero tool access — they can only talk
          if (!allowToolUseForTurn || isSanctuary) {
            const response = await makeLLMCallStreaming(
              messages,
              [],
              { provider: activeProvider, model: activeModel, userId: uid, signal: abortController.signal },
              onChunk,
              llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
              llmGetters.getOllama, llmGetters.getLmStudio,
            );

            responseText = response.text || streamChunks.join('') || '';
            llmWasCalled = true;
            if (response.usage) {
              recordTokenUsage(uid, activeProvider, activeModel, {
                promptTokens: response.usage.promptTokens,
                completionTokens: response.usage.completionTokens,
                totalTokens: response.usage.totalTokens,
              }, interactionId);
            }
            const tokens = estimateTokens(text + ' ' + responseText);
            const subStatus = recordUsage(uid, tokens);
            const totalUsage = response.usage?.totalTokens || 0;
            socket.emit('token:usage_update', {
              userId: uid,
              provider: activeProvider,
              totalTokens: totalUsage,
              mode: 'chat',
              timestamp: new Date().toISOString(),
            });
            if (subStatus) {
              socket.emit('token:quota_update', { used: subStatus.used, cap: subStatus.cap, remaining: subStatus.remaining });
              const pct = subStatus.used / subStatus.cap;
              if (pct >= 0.9) {
                socket.emit('agent:notification', { type: 'token_warning', level: 'critical', message: `Token usage at ${Math.round(pct * 100)}% (${subStatus.used.toLocaleString()} / ${subStatus.cap.toLocaleString()})` });
                pushNotification(uid, { type: 'token_warning', title: 'Token Quota Critical', message: `Token usage at ${Math.round(pct * 100)}% (${subStatus.used.toLocaleString()} / ${subStatus.cap.toLocaleString()})` });
              } else if (pct >= 0.8) {
                socket.emit('agent:notification', { type: 'token_warning', level: 'warning', message: `Token usage at ${Math.round(pct * 100)}%` });
                pushNotification(uid, { type: 'token_warning', title: 'Token Quota Warning', message: `Token usage at ${Math.round(pct * 100)}%` });
              }
            }
          } else {
            const maxIterations = personality.toolPolicy.maxIterations || 25;

          // Collect tool calls for persistence

          const result = await runWithTools(
            messages,
            toolRegistry,
            { provider: activeProvider, model: activeModel, userId: uid },
            isSanctuary ? undefined : (record) => {
              allToolRecords.push({ name: record.name, args: JSON.stringify(record.arguments || {}), result: record.result?.slice(0, 500), error: record.error });
              if (isDirectDesktopTool(record.name)) return;
              const toolPayload = {
                correlationId: record.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                name: record.name,
                arguments: record.arguments,
                args: record.arguments,
                result: record.result?.slice(0, 500),
                error: record.error,
              };
              socket.emit("agent:tool_call", toolPayload);
              socket.emit("agent:tool", toolPayload);
            },
            maxIterations,
            llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
            onChunk,
            {
              desktopRelay,
              llmGetters,
              isCancelled: () => abortController.signal.aborted,
              onToolStart: (call) => {
                if (isDirectDesktopTool(call.name)) return;
                emitToolLifecycle({
                  correlationId: call.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                  name: call.name,
                  arguments: call.arguments,
                });
              },
              onProgress: (step: string) => {
                socket.emit("agent:chunk", { text: `[${step}]\n`, agentName: "Lumi" });
              },
              ...(isSanctuary
                ? { toolPolicy: { allowedTools: [], requireConfirmation: [], forbiddenTools: ['*'], maxIterations: 0 } }
                : source === 'canvas'
                  ? { toolPolicy: { allowedTools: ['*'], requireConfirmation: ['file_delete', 'delete_file', 'rm', 'unlink', 'format', 'rmdir', 'uninstall'], forbiddenTools: [], maxIterations: 25 } }
                  : (opModeConfig ? { toolPolicy: opModeConfig.toolPolicy } : {})
              ),
              ...(operationMode === 'assistant' || operationMode === 'autonomous' ? {
                requestConfirmation: async (toolName: string, args: Record<string, any>): Promise<boolean> => {
                  return new Promise((resolve) => {
                    const cid = crypto.randomUUID();
                    const timeout = setTimeout(() => resolve(false), 30000);
                    socket.once(`tool:confirm_result:${cid}`, (data: { allowed: boolean }) => {
                      clearTimeout(timeout);
                      resolve(data.allowed === true);
                    });
                    socket.emit('agent:confirm_tool', { correlationId: cid, name: toolName, arguments: args });
                  });
                }
              } : {}),
            },
          );

          responseText = result.text || '';
          llmWasCalled = true;
          // Record analytics + subscription
          for (const u of result.usageRecords) {
            recordTokenUsage(uid, u.provider, u.model, { promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens }, interactionId);
          }
          const tokens = estimateTokens(text + ' ' + responseText);
          const subStatus = recordUsage(uid, tokens);

          // Real-time token push + threshold alerts
          const totalUsage = result.usageRecords.reduce((s: number, r: any) => s + (r.totalTokens || 0), 0);
          socket.emit('token:usage_update', {
            userId: uid,
            provider: activeProvider,
            totalTokens: totalUsage,
            mode: 'chat',
            timestamp: new Date().toISOString(),
          });
          if (subStatus) {
            socket.emit('token:quota_update', { used: subStatus.used, cap: subStatus.cap, remaining: subStatus.remaining });
            const pct = subStatus.used / subStatus.cap;
            if (pct >= 0.9) {
              socket.emit('agent:notification', { type: 'token_warning', level: 'critical', message: `Token usage at ${Math.round(pct * 100)}% (${subStatus.used.toLocaleString()} / ${subStatus.cap.toLocaleString()})` });
              pushNotification(uid, { type: 'token_warning', title: 'Token Quota Critical', message: `Token usage at ${Math.round(pct * 100)}% (${subStatus.used.toLocaleString()} / ${subStatus.cap.toLocaleString()})` });
            } else if (pct >= 0.8) {
              socket.emit('agent:notification', { type: 'token_warning', level: 'warning', message: `Token usage at ${Math.round(pct * 100)}%` });
              pushNotification(uid, { type: 'token_warning', title: 'Token Quota Warning', message: `Token usage at ${Math.round(pct * 100)}%` });
            }
          }
          }
        } catch (llmErr: any) {
          console.error(`[Cognition] LLM '${activeProvider}/${activeModel}' failed: ${llmErr.message}`);
          // Try fallback provider
          if (llmErr.message?.includes('not configured') && activeProvider !== 'gemini') {
            try {
              if (!allowToolUseForTurn || isSanctuary) {
                const fallbackChunks: string[] = [];
                const fallback = await makeLLMCallStreaming(
                  messages,
                  [],
                  { provider: 'gemini', model: DEFAULT_MODELS.gemini, userId: uid, signal: abortController.signal },
                  (chunk) => {
                    fallbackChunks.push(chunk);
                    socket.emit("agent:chunk", { text: chunk, agentName: personality.name });
                  },
                  llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
                  llmGetters.getOllama, llmGetters.getLmStudio,
                );
                responseText = fallback.text || fallbackChunks.join('') || '';
                llmWasCalled = true;
                if (fallback.usage) {
                  recordTokenUsage(uid, 'gemini', DEFAULT_MODELS.gemini, {
                    promptTokens: fallback.usage.promptTokens,
                    completionTokens: fallback.usage.completionTokens,
                    totalTokens: fallback.usage.totalTokens,
                  }, interactionId);
                }
              } else {
              const fallback = await runWithTools(
                messages, toolRegistry,
                { provider: 'gemini', model: DEFAULT_MODELS.gemini, userId: uid },
                (record) => {
                  allToolRecords.push({ name: record.name, args: JSON.stringify(record.arguments || {}), result: record.result?.slice(0, 500), error: record.error });
                  if (isDirectDesktopTool(record.name)) return;
                  emitToolLifecycle({
                    correlationId: record.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                    name: record.name,
                    arguments: record.arguments,
                    result: record.result?.slice(0, 500),
                    error: record.error,
                  });
                },
                1,
                llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
                undefined,
                {
                  desktopRelay,
                  llmGetters,
                  isCancelled: () => abortController.signal.aborted,
                  onToolStart: (call) => {
                    if (isDirectDesktopTool(call.name)) return;
                    emitToolLifecycle({
                      correlationId: call.id || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                      name: call.name,
                      arguments: call.arguments,
                    });
                  },
                  ...(opModeConfig ? { toolPolicy: opModeConfig.toolPolicy } : {}),
                },
              );
              responseText = fallback.text || '';
              llmWasCalled = true;
              for (const u of fallback.usageRecords) {
                recordTokenUsage(uid, u.provider, u.model, { promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens }, interactionId);
              }
              }
            } catch (fallbackErr: any) {
              // Both primary and fallback LLMs failed — use cognitive fallback
              const cf = handleLLMFailure(cognition.intent, fallbackErr);
              responseText = cf.responseText;
            }
          } else {
            // LLM failed for other reasons — use cognitive fallback
            const cf = handleLLMFailure(cognition.intent, llmErr);
            responseText = cf.responseText;
          }
        }
      }

      // Save to conversation via conversation manager (reuse conversationId from setup)

      if (conversationId) {
        addMessage({ userId: uid, agentId: conversationAgentId, conversationId, role: 'user', content: text, personality: personality.id, domain: resolvedDomain, orgId: resolvedOrgId });
        // Persist tool calls interleaved before the assistant response
        for (const tc of allToolRecords) {
          const tcSummary = tc.error
            ? `[Tool: ${tc.name}] Error: ${tc.error}`
            : `[Tool: ${tc.name}] Done`;
          addMessage({ userId: uid, agentId: conversationAgentId, conversationId, role: 'tool', content: tcSummary, domain: resolvedDomain, orgId: resolvedOrgId });
        }
        addMessage({ userId: uid, agentId: conversationAgentId, conversationId, role: 'assistant', content: responseText, personality: personality.id, domain: resolvedDomain, orgId: resolvedOrgId });
        // (conversation_updated NOW emitted AFTER agent:response — see below)

        // Topic tracking — extract and record topics for cross-session continuity
        try {
          const topics = extractTopics(text + ' ' + responseText);
          for (const topic of topics) trackTopic(conversationId, topic);
        } catch {}

        // Auto-summarize long conversations (anti-entropy: prevents context overflow)
        const { needed, recentMessages } = checkAutoSummary(conversationId);
        if (needed && recentMessages.length > 0) {
          summarizeConversationAsync(conversationId, recentMessages, llmGetters, activeProvider, activeModel).catch(
            () => {} // Non-critical
          );
        }
      }

      // Log interaction
      const db = readDB();
      db.interactions.push({
        id: interactionId, userId: uid, agentId: agentId || '',
        conversationId: conversationId || '', content: text, response: responseText,
        role: "user", personality: personality.id, timestamp: new Date().toISOString(),
        cognitiveIntent: cognition.intent.category,
        llmWasCalled,
        domain: resolvedDomain,
        orgId: resolvedOrgId,
      });
      writeDB(db);

      // Emit response BEFORE conversation_updated so the client finalizes streaming first
      socket.emit("agent:response", { text: responseText, agentName: personality.name, source: "chat" });
      // Re-emit conversation_updated AFTER response so the client syncs from API with complete data
      if (conversationId) {
        socket.emit('chat:conversation_updated', { conversationId, agentId: conversationAgentId, source: source === 'canvas' ? 'canvas' : 'chat' });
      }
      socket.emit("agent:status", { status: "idle" });

      // Clean up abort session
      chatSessionMap.delete(uid);

      // Auto-learn from corrections: when user corrects Lumi, extract high-confidence memories
      const correctionPatterns = [/不是/, /不对/, /错了/, /wrong/i, /incorrect/i, /actually/i, /no,?\s/i, /你弄错了/, /不是这样的/];
      const isCorrection = correctionPatterns.some(p => p.test(text));
      if (isCorrection && responseText) {
        try {
          const corrected = await extractMemories(
            { userMessage: text, assistantResponse: responseText, existingMemories: relevantMemories.map(m => m.content), provider: activeProvider, model: activeModel, treeBranches: [] },
            llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
          );
          for (const mem of corrected.memories) {
            addMemory({
              userId: uid, type: mem.type, content: mem.content,
              keywords: mem.keywords, confidence: Math.min((mem.confidence || 0.5) + 0.2, 1.0),
              sourceInteractionId: interactionId, agentId: agentId || '',
            } as any, { domain: resolvedDomain, orgId: resolvedOrgId });
          }
          console.log(`[ChatHandler] Correction learned: ${corrected.memories.length} memories with boosted confidence`);

          // Real-time identity correction: when user contradicts a claim Lumi makes about the user
          // (e.g. "我不做自动驾驶" → remove from coreMotivation immediately, no 7-day wait)
          try {
            const identityCheck = await makeLLMCall(
              [
                {
                  role: 'system',
                  content: `Detect identity corrections. Lumi's coreMotivation:\n"${personalityConfig.coreMotivation}"\nLumi's belief about owner's interests: ${JSON.stringify((personalityConfig as any).ownerProfile?.interestClusters || [])}\n\nUser said: "${text}"\nLumi said: "${responseText.slice(0, 300)}"\n\nIs the user denying something Lumi believes about them (interest, trait, name, profession)? If YES, return JSON: {"correctsIdentity": true, "removeInterest": "exact text from coreMotivation to remove", "rewriteMotivation": "rewrite coreMotivation without the false claim, preserving everything else, or null"}. If NO, return {"correctsIdentity": false}.\nReturn ONLY JSON.`,
                },
              ],
              [],
              { provider: 'deepseek', model: 'deepseek-v4-flash', userId: uid, maxTokens: 300 },
              llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
            );
            const identityResult = JSON.parse((identityCheck.text || '').replace(/```json|```/g, '').trim() || '{}');
            if (identityResult.correctsIdentity) {
              const removed = await personalityRegistry.correctIdentity(personalityId, {
                removeInterest: identityResult.removeInterest || undefined,
                removeFromMotivation: identityResult.removeInterest || undefined,
                newMotivation: identityResult.rewriteMotivation || undefined,
              });
              if (removed) {
                console.log(`[ChatHandler] Identity corrected in real-time: removed "${identityResult.removeInterest}"`);
              }
            }
          } catch (idErr: any) {
            console.warn('[ChatHandler] Identity correction check failed:', idErr.message);
          }
        } catch (err: any) { console.warn('[ChatHandler] Correction extraction failed:', err.message); }
      }

      // Lightweight per-conversation evolution — micro-shifts after meaningful chats
      // Fires if enough owner_trait memories have accumulated, no 7-day wait needed
      if (!isSanctuary && responseText && cognition.intent.category !== 'command') {
        try {
          const evolutionConfig = personalityRegistry.getEvolutionConfig(personalityId);
          const step = await lightweightEvolve(
            personalityConfig,
            uid,
            evolutionConfig,
            llmGetters.getDeepSeek,
            llmGetters.getGemini,
            llmGetters.getOpenAI,
            llmGetters.getAnthropic,
            llmGetters.getQwen,
          );
          if (step) {
            personalityRegistry.applyEvolution(personalityId, step);
            console.log(`[ChatHandler] Lightweight evolution: v${step.version}, ${step.mutations.length} mutation(s)`);
          }
        } catch (evErr: any) {
          console.warn('[ChatHandler] Lightweight evolution failed:', evErr.message);
        }
      }

      // Async memory extraction — skip trivial/command messages to reduce noise
      const skipExtractionCategories = ['command', 'file', 'unknown'];
      if (text.length >= 10 && !skipExtractionCategories.includes(cognition.intent.category)) {
      const branchNodes = queryMemories({ userId: uid, nodeType: 'branch', limit: 50 });
      const treeBranches = branchNodes.map(b => b.content);
      const locationTag = sensory.locationTag || undefined;
      extractMemories(
        { userMessage: text, assistantResponse: responseText, existingMemories: relevantMemories.map(m => m.content), provider: activeProvider, model: activeModel, treeBranches, locationTag },
        llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
      ).then(extracted => {
        for (const mem of extracted.memories) {
          let parentId: string | null = null;
          if ((mem as any).branchHint) {
            const branch = ensureBranch(uid, (mem as any).branchHint, agentId || '');
            parentId = branch.id;
          }
          addMemory({
            userId: uid, type: mem.type, content: mem.content,
            keywords: mem.keywords, confidence: mem.confidence, sourceInteractionId: interactionId,
            agentId: agentId || '',
          } as any, { parentId, location: locationTag, domain: resolvedDomain, orgId: resolvedOrgId });
        }
        for (const rem of extracted.reminders) {
          addReminder({ userId: uid, content: rem.content, dueAt: rem.dueAt, sourceInteractionId: interactionId });
        }
      }).catch(err => console.error('[Memory] Extraction failed:', err));
      }

      // Update emotional state — reconnect if user was away for a while
      const hoursSinceLast = emotionalState.lastInteractionAt
        ? (Date.now() - new Date(emotionalState.lastInteractionAt).getTime()) / (1000 * 60 * 60)
        : 24;
      const isReconnect = hoursSinceLast > 1;
      let updatedState = updateEmotionalState(emotionalState, { type: 'interaction', userId: uid, timestamp: new Date().toISOString() });
      // Apply sentiment analysis results to emotional state
      if (sentiment.valence !== 0 || sentiment.frustration > 0 || sentiment.urgency > 0) {
        updatedState = updateEmotionalState(updatedState, { type: 'sentiment_analysis', sentiment, userId: uid, timestamp: new Date().toISOString() });
      }
      if (isReconnect) {
        updatedState = updateEmotionalState(updatedState, { type: 'reconnect', intensity: Math.min(1, hoursSinceLast / 72), userId: uid, timestamp: new Date().toISOString() });
      }
      if (isNovel) {
        updatedState = updateEmotionalState(updatedState, { type: 'novel_topic', userId: uid, timestamp: new Date().toISOString() });
      }
      // HIM: comfort-gradient drive → dynamic initiative + curiosity
      const { state: himUpdated, him: newHim } = updateEmotionalStateWithHIM(updatedState, { type: 'self_reflection', userId: uid }, himState, text.slice(0, 40));
      saveEmotionalState(emotionKey, himUpdated);
      saveHIMState(emotionKey, newHim);

      // Emit contextual greeting on reconnect (sanctuary agents don't initiate)
      if (!isSanctuary && isReconnect && updatedState.intimacy > 0.2) {
        const greeting = generateContextualGreeting(updatedState, uid);
        if (greeting) {
          const greetingTs = new Date().toISOString();
          // Save to chat log
          const greetingDb = readDB();
          greetingDb.interactions.push({
            id: `greeting-${uid}-${Date.now()}`,
            userId: uid,
            agentId: agentId || '',
            conversationId: conversationId || '',
            content: greeting,
            response: '',
            role: 'agent',
            personality: personality.id,
            timestamp: greetingTs,
            cognitiveIntent: 'greeting',
            llmWasCalled: false,
          });
          writeDB(greetingDb);

          // Emit to chat window and notification center
          socket.emit('agent:proactive', {
            type: 'greeting',
            message: greeting,
            agentName: personality.name,
            intimacy: updatedState.intimacy,
            timestamp: greetingTs,
          });
          pushNotification(uid, { type: 'greeting', title: `Welcome back`, message: greeting });
        }
      }

    } catch (error: any) {
      console.error("[Socket Agent Error]:", error);
      socket.emit("agent:error", { message: error.message });
      socket.emit("agent:status", { status: "error" });
    } finally {
      chatSessionMap.delete(uid);
    }
  });
}

async function summarizeConversationAsync(
  conversationId: string,
  recentMessages: any[],
  llmGetters: any,
  provider: string,
  model: string,
) {
  try {
    const transcript = recentMessages.slice(-30)
      .map((m: any) => `${m.role || 'user'}: ${(m.message || m.content || '').slice(0, 200)}`)
      .join('\n');
    const summaryPrompt = `Summarize this conversation in 2-3 concise sentences. Focus on key decisions, topics discussed, and user preferences revealed. Output only the summary — no preamble.\n\n${transcript}`;
    const result = await makeLLMCall(
      [{ role: 'user', content: summaryPrompt }],
      [],
      { provider: provider as any, model, maxTokens: 300 },
      llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
    );
    const summary = result.text.trim();
    if (summary) {
      setConversationSummary(conversationId, summary);
      console.log(`[Conversation] Auto-summary generated for ${conversationId}`);
    }
  } catch (err) {
    // Non-critical — conversation continues without summary
  }
}



