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
import { personalityRegistry } from "../personality";
import { getOrCreateActiveConversation, addMessage, getMessages, checkAutoSummary, setConversationSummary, getConversationSummary } from "../conversation/manager";
import { ensureBranch } from "../memory/tree";
import { retrieveChunks } from "../agents/rag";
import { getSensory } from "./shared";
import { processInput, handleLLMFailure, CognitiveContext } from "../cognition";
import { checkLLMAccess, recordUsage, estimateTokens } from "../subscription/proxy";
import { classifyComplexity, decomposeTask, matchWorkers, executeWorkflow, aggregateWithLLM, recordWorkflowPattern, shouldDistillSkill, buildSkillDescription } from "../agents/orchestrator";
import { searchKnowledgeBase } from "../enterprise/kb";

export function registerChatHandler(
  socket: Socket,
  llmGetters: {
    getDeepSeek: () => any;
    getGemini: () => any;
    getOpenAI: () => any;
    getAnthropic: () => any;
    getQwen: () => any;
  },
  sensoryFn: (uid: string) => any,
  userIdFn: (s: Socket) => string,
) {
  socket.on("agent:chat", async (data: { text: string; history: any[]; personalityId?: string; category?: string; agentId?: string; domain?: string; orgId?: string | null }) => {
    console.log('[ChatHandler] agent:chat RECEIVED:', JSON.stringify(data).slice(0, 300));
    const { text, history, personalityId = "lumi", category, agentId, domain, orgId } = data;
    const uid = userIdFn(socket);
    console.log('[ChatHandler] uid:', uid, 'agentId:', agentId);

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

      // Enterprise: search company KB when in work domain
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

      const sensory = sensoryFn(uid);
      console.log('[ChatHandler] sensory loaded');
      const { config: personality, systemPrompt: systemInstruction } = personalityRegistry.buildSystemPrompt(
        personalityId,
        { mode: 'chat', sensory },
        {
          memories: relevantMemories.length > 0 ? relevantMemories : undefined,
          ragKnowledge: ragChunks.length > 0 ? ragChunks : undefined,
          emotionalState,
        },
      );
      console.log('[ChatHandler] systemPrompt built, personality name:', personality?.name);

      // Inject conversation summary chain for long-running conversations (anti-entropy)
      let effectiveSystemPrompt = systemInstruction;
      const conversationId = agentId
        ? getOrCreateActiveConversation(uid, agentId).id
        : undefined;
      console.log('[ChatHandler] conversationId:', conversationId);
      if (conversationId) {
        const summaryContext = getConversationSummary(conversationId);
        if (summaryContext) {
          effectiveSystemPrompt += `\n\n## Conversation Context\n${summaryContext}`;
        }
      }

      // Inject company knowledge base context when in work domain
      if (kbContext) {
        effectiveSystemPrompt += `\n\n## Company Knowledge Base\n${kbContext}\n\nUse the above company knowledge to inform your response. Cite article titles when referencing company policy.`;
      }

      const interactionId = crypto.randomUUID();

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
      const cognition = await processInput(text, cognitiveCtx);
      console.log('[ChatHandler] cognition result:', cognition.intent.category, 'directToolExecuted:', cognition.directToolExecuted, 'responseText:', cognition.responseText?.slice(0, 100));

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
        const complexity = classifyComplexity(text, { userId: uid, personalityId });
        if (complexity === 'complex' || complexity === 'moderate') {
          const db = readDB();
          const availableAgents = (db.agents || []).filter((a: any) => a.status !== 'offline');
          if (availableAgents.length >= 1) {
            try {
              socket.emit("agent:status", { status: "thinking", agentName: "Lumi Orchestrator" });

              const subTasks = await decomposeTask(text, { provider: activeProvider, model: activeModel }, { userId: uid, personalityId }, llmGetters);
              // Cap sub-tasks: moderate complexity → max 2, complex → max 5
              const capped = complexity === 'moderate'
                ? subTasks.slice(0, Math.min(2, subTasks.length))
                : subTasks;
              socket.emit("agent:chunk", { text: `[Orchestrator] Decomposed into ${capped.length} sub-tasks\n`, agentName: "Lumi" });

              const assignments = matchWorkers(capped, availableAgents);
              socket.emit("agent:chunk", { text: `[Orchestrator] Assigned to ${assignments.length} worker(s)\n`, agentName: "Lumi" });

              const workflowResult = await executeWorkflow(assignments, { userId: uid, personalityId }, { provider: activeProvider, model: activeModel }, llmGetters, availableAgents);

              // For moderate tasks with ≤2 results, simple concatenation is enough — no LLM aggregation needed
              const aggregated = complexity === 'moderate' && capped.length <= 2
                ? workflowResult.aggregatedOutput
                : await aggregateWithLLM(workflowResult, text, { provider: activeProvider, model: activeModel }, llmGetters);
              responseText = aggregated;
              llmWasCalled = true;

              // Record workflow pattern for future skill distillation
              const skillTags = capped.map(s => s.requiredSkill);
              recordWorkflowPattern(text, capped.length, skillTags, uid);

              // Check if this pattern should be auto-distilled into a skill
              if (shouldDistillSkill(text) && capped.length >= 2) {
                const skillDesc = buildSkillDescription(text, workflowResult);
                console.log('[Orchestrator] Pattern detected — candidate for skill distillation:', skillDesc.slice(0, 100));
                socket.emit("agent:proactive", {
                  type: 'distill_hint',
                  message: 'I notice this type of task is recurring. I can create an automated skill for this — would you like me to?',
                  skillDescription: skillDesc,
                  timestamp: new Date().toISOString(),
                });
              }

              socket.emit("agent:chunk", { text: `\n[Orchestrator] Workflow complete — ${workflowResult.totalAgentsUsed} agent(s) used\n`, agentName: "Lumi" });
            } catch (orchErr: any) {
              console.error('[Orchestrator] Workflow failed, falling back to normal chat:', orchErr.message);
              // Fall through to normal LLM path below
            }
          }
        }
      }

      if (!responseText) {
        // Path C: Normal LLM path (simple queries, or orchestrator fallback)

        // Load conversation history from persistence (survives page reload / reconnect)
        let persistedHistory: NormalizedMessage[] = [];
        if (agentId) {
          const conv = getOrCreateActiveConversation(uid, agentId);
          const msgs = getMessages(conv.id, 30);
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
          const maxIterations = isSanctuary ? 0 : 3;

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
            isSanctuary ? { toolPolicy: { allowedTools: [], requireConfirmation: [], forbiddenTools: ['*'], maxIterations: 0 } } : undefined,
          );

          responseText = result.text || '';
          llmWasCalled = true;
          // Record analytics + subscription
          for (const u of result.usageRecords) {
            recordTokenUsage(uid, u.provider, u.model, { promptTokens: u.promptTokens, completionTokens: u.completionTokens, totalTokens: u.totalTokens }, interactionId);
          }
          const tokens = estimateTokens(text + ' ' + responseText);
          recordUsage(uid, tokens);
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

function recordTokenUsage(
  userId: string,
  provider: string,
  model: string,
  usage: LLMUsage | undefined,
  interactionId: string,
) {
  if (!usage || (usage.promptTokens === 0 && usage.completionTokens === 0)) return;
  const db = readDB();
  if (!db.tokenUsage) db.tokenUsage = [];
  db.tokenUsage.push({
    id: crypto.randomUUID(),
    userId,
    provider,
    model,
    promptTokens: usage.promptTokens,
    completionTokens: usage.completionTokens,
    totalTokens: usage.totalTokens,
    mode: 'chat',
    interactionId,
    timestamp: new Date().toISOString(),
  });
  writeDB(db);
}
