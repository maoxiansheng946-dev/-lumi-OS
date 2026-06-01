/**
 * agent:chat socket handler — the core conversational AI pipeline
 */
import { Socket } from "socket.io";
import { readDB, writeDB } from "../../db_layer";
import { NormalizedMessage, makeLLMCall, StreamCallback } from "../llm/providers";
import { LLMUsage } from "../tools/types";
import { toolRegistry } from "../tools/registry";
import { runWithTools } from "../llm/adapter";
import { queryMemories, queryMemoriesVector, addMemory, addReminder, extractMemories } from "../memory";
import { loadEmotionalState, saveEmotionalState, updateEmotionalState, generateContextualGreeting, vectorMemoryBias } from "../personality/state";
import { buildModeOverlay } from "../personality/engine";
import { personalityRegistry } from "../personality";
import { getOrCreateActiveConversation, addMessage, getMessages, getMessagesByTokenBudget, checkAutoSummary, setConversationSummary, getConversationSummary, setConversationMode, getUnclosedConversation, extractTopics, trackTopic, getTopicContext } from "../conversation/manager";
import { ensureBranch } from "../memory/tree";
import { retrieveChunks } from "../agents/rag";
import { getSensory } from "./shared";
import { processInput, handleLLMFailure, extractSentiment, CognitiveContext } from "../cognition";
import { matchQuickCommand } from "../cognition/quick_commands";
import { checkLLMAccess, recordUsage, estimateTokens } from "../subscription/proxy";
import { recordTokenUsage } from "../llm/token_tracker";
import { runOrchestratedTask, shouldDistillSkill, buildSkillDescription } from "../agents/orchestrator";
import { searchKnowledgeBase } from "../org/kb";
import { getWorkflow, recordWorkflowRun, listWorkflows } from "../agents/workflows";

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

  socket.on("agent:chat", async (data: { text: string; history: any[]; personalityId?: string; category?: string; agentId?: string; domain?: string; orgId?: string | null; mode?: string }) => {
    console.log('[ChatHandler] agent:chat RECEIVED:', JSON.stringify(data).slice(0, 300));
    const { text, history, personalityId = "lumi", category, agentId, domain, orgId, mode: payloadMode } = data;
    const uid = userIdFn(socket);
    console.log('[ChatHandler] uid:', uid, 'agentId:', agentId);

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
      if (domain === 'work' && orgId) {
        try {
          const kbResults = await searchKnowledgeBase(orgId, text, 3);
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
      console.log('[ChatHandler] emotionalState loaded');
      const isNovel = relevantMemories.length < 2;

      // ── Conversation mode: get/create conversation, apply mode from payload ──
      const conversation = agentId
        ? getOrCreateActiveConversation(uid, agentId)
        : null;
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

      // ── Desktop relay: enables 15 tools (mouse/keyboard/clipboard/screenshot/etc) in chat ──
      const desktopRelay = async (toolName: string, args: Record<string, any>): Promise<string> => {
        return new Promise((resolve, reject) => {
          const cid = crypto.randomUUID();
          const timeout = setTimeout(() => reject(new Error(`Desktop tool "${toolName}" timed out (30s)`)), 30000);
          socket.once(`tool:desktop_result:${cid}`, (data: { output?: string; error?: string }) => {
            clearTimeout(timeout);
            if (data.error) reject(new Error(data.error));
            else resolve(data.output || '');
          });
          socket.emit('tool:desktop_exec', { correlationId: cid, name: toolName, arguments: args });
        });
      };

      socket.emit("agent:status", { status: "thinking", agentName: personality.name });
      console.log('[ChatHandler] emitted agent:status thinking');

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
            try {
              const tcResult = await toolRegistry.execute(quickResult.toolCall.name, quickResult.toolCall.arguments, { userId: uid });
              socket.emit("agent:tool_call", { correlationId: `qc-${Date.now()}`, name: quickResult.toolCall.name, arguments: quickResult.toolCall.arguments, result: tcResult?.slice(0, 500) || '' });
            } catch (toolErr: any) {
              socket.emit("agent:tool_call", { correlationId: `qc-${Date.now()}`, name: quickResult.toolCall.name, arguments: quickResult.toolCall.arguments, error: toolErr.message });
            }
          }
          socket.emit("agent:response", { text: quickResult.responseText, agentName: personality.name, source: "quick_command" });
          socket.emit("agent:status", { status: "idle" });
          if (conversationId) {
            addMessage({ userId: uid, agentId: agentId || '', conversationId, role: 'user', content: text, personality: personality.id });
            addMessage({ userId: uid, agentId: agentId || '', conversationId, role: 'assistant', content: quickResult.responseText, personality: personality.id });
            socket.emit('chat:conversation_updated', { conversationId, agentId: agentId || '' });
            // Track topics for quick commands too
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
        activeModel = isComplex ? 'deepseek-v4-pro' : 'deepseek-v4-flash';
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
      } else if (!isSanctuary && (cognition.intent.category === 'command' || cognition.intent.category === 'code' || cognition.intent.category === 'question')) {
        // Path B: Orchestrator — decompose tasks into sub-tasks for worker agents
        // (Skipped for sanctuary agents — they stay in their territory)
        try {
          socket.emit("agent:status", { status: "thinking", agentName: "Lumi Orchestrator" });
          const orchResult = await runOrchestratedTask(
            text,
            { userId: uid, personalityId, desktopRelay },
            { provider: activeProvider, model: activeModel },
            llmGetters,
            (msg) => socket.emit("agent:chunk", { text: msg, agentName: "Lumi" }),
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
            }
          }
        } catch (orchErr: any) {
          console.error('[Orchestrator] Workflow failed, falling back to normal chat:', orchErr.message);
        }
      }

      if (!responseText) {
        // Path C: Normal LLM path (simple queries, or orchestrator fallback)

        // Load conversation history from persistence (survives page reload / reconnect)
        let persistedHistory: NormalizedMessage[] = [];
        if (agentId) {
          const conv = getOrCreateActiveConversation(uid, agentId);
          const msgs = getMessagesByTokenBudget(conv.id, 6000);
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
          console.log('[ChatHandler] Calling runWithTools (Path C) with provider:', activeProvider, 'model:', activeModel);
          const streamChunks: string[] = [];
          const onChunk: StreamCallback = (chunk) => {
            streamChunks.push(chunk);
            socket.emit("agent:chunk", { text: chunk, agentName: personality.name });
          };

          // Sanctuary agents get zero tool access — they can only talk
          const maxIterations = isSanctuary ? 0 : (personality.toolPolicy.maxIterations || 25);

          const result = await runWithTools(
            messages,
            toolRegistry,
            { provider: activeProvider, model: activeModel, userId: uid },
            isSanctuary ? undefined : (record) => {
              socket.emit("agent:tool", { name: record.name, args: record.arguments, result: record.result?.slice(0, 200), error: record.error });
            },
            maxIterations,
            llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
            onChunk,
            { desktopRelay, isCancelled: () => abortController.signal.aborted, ...(isSanctuary ? { toolPolicy: { allowedTools: [], requireConfirmation: [], forbiddenTools: ['*'], maxIterations: 0 } } : {}) },
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
            } else if (pct >= 0.8) {
              socket.emit('agent:notification', { type: 'token_warning', level: 'warning', message: `Token usage at ${Math.round(pct * 100)}%` });
            }
          }
        } catch (llmErr: any) {
          console.error(`[Cognition] LLM '${activeProvider}/${activeModel}' failed: ${llmErr.message}`);
          // Try fallback provider
          if (llmErr.message?.includes('not configured') && activeProvider !== 'gemini') {
            try {
              const fallback = await runWithTools(
                messages, toolRegistry,
                { provider: 'gemini', model: DEFAULT_MODELS.gemini, userId: uid },
                undefined, 1,
                llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
                undefined,
                { desktopRelay, isCancelled: () => abortController.signal.aborted },
              );
              responseText = fallback.text || '';
              llmWasCalled = true;
              for (const u of fallback.usageRecords) {
                recordTokenUsage(uid, u.provider, u.model, { promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens }, interactionId);
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
        addMessage({ userId: uid, agentId: agentId || '', conversationId, role: 'user', content: text, personality: personality.id });
        addMessage({ userId: uid, agentId: agentId || '', conversationId, role: 'assistant', content: responseText, personality: personality.id });
        socket.emit('chat:conversation_updated', { conversationId, agentId: agentId || '' });

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
        domain: domain || 'personal',
        orgId: orgId || '',
      });
      writeDB(db);

      socket.emit("agent:response", { text: responseText, agentName: personality.name, source: "chat" });
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
            } as any, { domain, orgId: orgId || '' });
          }
          console.log(`[ChatHandler] Correction learned: ${corrected.memories.length} memories with boosted confidence`);
        } catch (err: any) { console.warn('[ChatHandler] Correction extraction failed:', err.message); }
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
          } as any, { parentId, location: locationTag, domain, orgId: orgId || '' });
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
      saveEmotionalState(emotionKey, updatedState);

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



