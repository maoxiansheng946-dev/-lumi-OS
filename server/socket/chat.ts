/**
 * agent:chat socket handler — the core conversational AI pipeline
 */
import { Socket } from "socket.io";
import { readDB, writeDB } from "../../db_layer";
import { NormalizedMessage, makeLLMCall, StreamCallback } from "../llm/providers";
import { LLMUsage } from "../tools/types";
import { toolRegistry } from "../tools/registry";
import { runWithTools } from "../llm/adapter";
import { queryMemories, addMemory, addReminder, extractMemories } from "../memory";
import { loadEmotionalState, saveEmotionalState, updateEmotionalState } from "../personality/state";
import { personalityRegistry } from "../personality";
import { getOrCreateActiveConversation, addMessage, getMessages } from "../conversation/manager";
import { ensureBranch } from "../memory/tree";
import { retrieveChunks } from "../agents/rag";
import { getSensory } from "./shared";
import { processInput, handleLLMFailure, CognitiveContext } from "../cognition";
import { checkLLMAccess, recordUsage, estimateTokens } from "../subscription/proxy";

const immortalitySkills: Record<string, string> = {
  colleague: "【同事技能包】：你现在是一个专业且高效的同事。你拥有深厚的行业背景，熟悉办公流程，擅长团队协作。你说话直接、专业，注重结果。",
  family: "【祖先技能包】：你现在是一位充满智慧的家族长辈。你拥有丰富的家族历史知识，说话温和且富有哲理，致力于传承家族的价值观和智慧。",
  friend: "【知己技能包】：你现在是一个感性且富有同理心的知己。你擅长倾听，能够产生情感共鸣，并提供深度的心理支持。你说话温暖、真诚。",
  lover: "【前任技能包】：你现在是一个复杂且充满情感张力的'前任'。你拥有共同的回忆，说话时而怀旧、时而克制，致力于在对话中寻找情感的终结或升华。"
};

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
  socket.on("agent:chat", async (data: { text: string; history: any[]; personalityId?: string; category?: string; agentId?: string }) => {
    const { text, history, personalityId = "lumi", category, agentId } = data;
    const uid = userIdFn(socket);

    // Look up agent record for memory/emotion isolation
    const agentRecord = agentId
      ? readDB().agents.find((a: any) => a.id === agentId) || null
      : null;
    const memoryScope = agentRecord?.memoryScope || 'shared';
    const agentMemoryFilter = memoryScope === 'private' ? agentId : undefined;

    const relevantMemories = queryMemories({ userId: uid, query: text, limit: 5, minConfidence: 0.4, agentId: agentMemoryFilter });

    // RAG: retrieve relevant knowledge chunks from agent's ingested documents
    let ragChunks: string[] = [];
    if (agentId) {
      const chunks = retrieveChunks(uid, agentId, text, 3);
      ragChunks = chunks.map((c: any) => c.content);
    }

    const emotionKey = agentMemoryFilter ? `${uid}_agent_${agentId}` : uid;
    const emotionalState = loadEmotionalState(emotionKey);
    const isNovel = relevantMemories.length < 2;

    const sensory = sensoryFn(uid);
    const { config: personality, systemPrompt: systemInstruction } = personalityRegistry.buildSystemPrompt(
      personalityId,
      { mode: 'chat', sensory },
      {
        skillOverride: category ? immortalitySkills[category] : undefined,
        memories: relevantMemories.length > 0 ? relevantMemories : undefined,
        ragKnowledge: ragChunks.length > 0 ? ragChunks : undefined,
        emotionalState,
      },
    );

    const interactionId = crypto.randomUUID();

    try {
      socket.emit("agent:status", { status: "thinking", agentName: personality.name });

      const resolveProvider = (model: string) =>
        model.startsWith('deepseek') ? 'deepseek' as const
        : model.startsWith('qwen') ? 'qwen' as const
        : 'gemini' as const;

      let provider = resolveProvider(personality.defaultModel);
      let activeModel = personality.defaultModel;

      // ── Subscription enforcement (with fallback) ──
      const access = checkLLMAccess({ userId: uid, provider, model: activeModel });
      if (!access.allowed) {
        const fallbackModel = personality.fallbackModel || 'qwen-plus';
        const fallbackProvider = resolveProvider(fallbackModel);
        if (fallbackProvider !== provider && personality.fallbackModel) {
          const fallbackAccess = checkLLMAccess({ userId: uid, provider: fallbackProvider, model: fallbackModel });
          if (fallbackAccess.allowed) {
            provider = fallbackProvider;
            activeModel = fallbackModel;
            console.log(`[Chat] Subscription fallback: ${personality.defaultModel} → ${fallbackModel} for user ${uid}`);
          } else {
            socket.emit("agent:error", {
              message: access.reason,
              code: access.tokenLimitReached ? 'TOKEN_LIMIT' : 'PROVIDER_RESTRICTED',
            });
            socket.emit("agent:status", { status: "error" });
            return;
          }
        } else {
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
        llmProvider: provider,
        llmModel: activeModel,
        isLLMAvailable: true,
      };
      const cognition = await processInput(text, cognitiveCtx);

      let responseText = '';
      let llmWasCalled = false;

      if (cognition.directToolExecuted && cognition.responseText) {
        // Path A: Lumi handled this directly — no LLM needed
        responseText = cognition.responseText;
        console.log(`[Cognition] Direct tool '${cognition.intent.directToolCall?.name}' handled without LLM`);
      } else {
        // Path B: Needs LLM for text generation or complex reasoning

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

        const messages: NormalizedMessage[] = [
          { role: 'system', content: systemInstruction },
          ...conversationHistory,
          { role: 'user', content: text },
        ];

        try {
          const streamChunks: string[] = [];
          const onChunk: StreamCallback = (chunk) => {
            streamChunks.push(chunk);
            socket.emit("agent:chunk", { text: chunk, agentName: personality.name });
          };

          const result = await runWithTools(
            messages,
            toolRegistry,
            { provider, model: activeModel, userId: uid },
            (record) => {
              socket.emit("agent:tool", { name: record.name, args: record.arguments, result: record.result?.slice(0, 200), error: record.error });
            },
            3, // max 3 tool iterations for chat
            llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
            onChunk,
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
          console.error(`[Cognition] LLM '${provider}/${activeModel}' failed: ${llmErr.message}`);
          // Try fallback provider
          if (llmErr.message?.includes('not configured') && provider !== 'gemini') {
            try {
              const fallback = await runWithTools(
                messages, toolRegistry,
                { provider: 'gemini', model: personality.fallbackModel || 'gemini-pro', userId: uid },
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

      // Save to conversation via conversation manager
      const conversationId = agentId
        ? getOrCreateActiveConversation(uid, agentId).id
        : undefined;

      if (conversationId) {
        addMessage({ userId: uid, agentId: agentId || '', conversationId, role: 'user', content: text, personality: personality.id });
        addMessage({ userId: uid, agentId: agentId || '', conversationId, role: 'assistant', content: responseText, personality: personality.id });
      }

      // Log interaction
      const db = readDB();
      db.interactions.push({
        id: interactionId, userId: uid, agentId: agentId || '',
        conversationId: conversationId || '', content: text, response: responseText,
        role: "user", personality: personality.id, timestamp: new Date().toISOString(),
        cognitiveIntent: cognition.intent.category,
        llmWasCalled,
      });
      writeDB(db);

      socket.emit("agent:response", { text: responseText, agentName: personality.name, source: "chat" });
      socket.emit("agent:status", { status: "idle" });

      // Async memory extraction
      const branchNodes = queryMemories({ userId: uid, nodeType: 'branch', limit: 50 });
      const treeBranches = branchNodes.map(b => b.content);
      extractMemories(
        { userMessage: text, assistantResponse: responseText, existingMemories: relevantMemories.map(m => m.content), provider, model: activeModel, treeBranches },
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
          } as any, { parentId });
        }
        for (const rem of extracted.reminders) {
          addReminder({ userId: uid, content: rem.content, dueAt: rem.dueAt, sourceInteractionId: interactionId });
        }
      }).catch(err => console.error('[Memory] Extraction failed:', err));

      // Update emotional state
      let updatedState = updateEmotionalState(emotionalState, { type: 'interaction', userId: uid, timestamp: new Date().toISOString() });
      if (isNovel) {
        updatedState = updateEmotionalState(updatedState, { type: 'novel_topic', userId: uid, timestamp: new Date().toISOString() });
      }
      saveEmotionalState(emotionKey, updatedState);

    } catch (error: any) {
      console.error("[Socket Agent Error]:", error);
      socket.emit("agent:error", { message: error.message });
      socket.emit("agent:status", { status: "error" });
    }
  });
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
