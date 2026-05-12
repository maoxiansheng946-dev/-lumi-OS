/**
 * agent:task socket handler — multi-turn tool-augmented AI pipeline
 */
import { Socket } from "socket.io";
import { readDB, writeDB } from "../../db_layer";
import { NormalizedMessage } from "../llm/providers";
import { runWithTools, LLMUsageRecord } from "../llm/adapter";
import { toolRegistry } from "../tools/registry";
import { queryMemories, addMemory, addReminder, extractMemories } from "../memory";
import { loadEmotionalState, saveEmotionalState, updateEmotionalState } from "../personality/state";
import { personalityRegistry } from "../personality";
import { canOutputHolographic, textToHolographicOutput } from "../output/holographic";
import { getOrCreateActiveConversation } from "../conversation/manager";
import { processInput, handleLLMFailure, CognitiveContext, CognitiveResult } from "../cognition";

export function registerTaskHandler(
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
  socket.on("agent:task", async (data: { text: string; history?: any[]; personalityId?: string; conversationId?: string }) => {
    const uid = userIdFn(socket);
    const interactionId = crypto.randomUUID();

    const relevantMemories = queryMemories({ userId: uid, query: data.text, limit: 5, minConfidence: 0.4 });

    const emotionalState = loadEmotionalState(uid);
    const isNovelTask = relevantMemories.length < 2;

    const sensory = sensoryFn(uid);
    const { config: personality, systemPrompt: systemInstruction } = personalityRegistry.buildSystemPrompt(
      data.personalityId || 'lumi',
      { mode: 'task', sensory },
      {
        memories: relevantMemories.length > 0 ? relevantMemories : undefined,
        emotionalState,
      },
    );

    const provider = personality.defaultModel.startsWith('deepseek') ? 'deepseek' as const
      : personality.defaultModel.startsWith('qwen') ? 'qwen' as const
      : 'gemini' as const;

    const messages: NormalizedMessage[] = [
      { role: 'system', content: systemInstruction },
      ...(data.history ? data.history.map((m: any) => ({ role: m.role, content: m.content })) : []),
      { role: 'user', content: data.text },
    ];

    let cognition: CognitiveResult | undefined;
    let cancelled = false;

    // Support interrupting a running task via agent:task_cancel
    const onCancel = () => {
      cancelled = true;
      console.log(`[Task] Cancelled by user for ${uid}`);
    };
    socket.once('agent:task_cancel', onCancel);

    try {
      socket.emit("agent:status", { status: "thinking", agentName: personality.name });

      // ── Lumi Cognitive Engine: classify intent BEFORE calling any LLM ──
      const cognitiveCtx: CognitiveContext = {
        userId: uid,
        personalityId: personality.id,
        personalityName: personality.name,
        llmProvider: provider,
        llmModel: personality.defaultModel,
        isLLMAvailable: true,
      };
      cognition = await processInput(data.text, cognitiveCtx);

      // If cognitive engine handled directly (simple command), skip LLM entirely
      if (cognition.directToolExecuted && cognition.responseText) {
        console.log(`[Cognition] Task handled directly: ${cognition.intent.category}/${cognition.intent.subIntent}`);
        socket.emit("agent:response", { text: cognition.responseText, agentName: personality.name });
        socket.emit("agent:status", { status: "idle" });

        // Still log the interaction
        const db = readDB();
        db.interactions.push({
          id: interactionId,
          content: data.text,
          response: cognition.responseText,
          role: "user",
          personality: personality.id,
          timestamp: new Date().toISOString(),
          mode: 'task',
          cognitiveIntent: cognition.intent.category,
          llmWasCalled: false,
        } as any);
        writeDB(db);
        socket.off('agent:task_cancel', onCancel);
        return;
      }

      const desktopRelay = async (toolName: string, args: Record<string, any>): Promise<string> => {
        return new Promise((resolve, reject) => {
          const cid = crypto.randomUUID();
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
          const cid = crypto.randomUUID();
          const timeout = setTimeout(() => {
            socket.emit("agent:tool_call", { name: toolName, arguments: args, result: 'Auto-denied (30s timeout)', error: 'User did not respond' });
            resolve(false);
          }, 30000);
          socket.once(`tool:confirm_result:${cid}`, (data: { allowed: boolean }) => {
            clearTimeout(timeout);
            resolve(data.allowed === true);
          });
          socket.emit('agent:confirm_tool', {
            correlationId: cid,
            name: toolName,
            arguments: args,
          });
        });
      };

      const result = await runWithTools(
        messages,
        toolRegistry,
        { provider, model: personality.defaultModel, userId: uid },
        (record) => {
          socket.emit("agent:tool_call", {
            name: record.name,
            arguments: record.arguments,
            result: record.result?.slice(0, 500),
            error: record.error,
          });
        },
        5,
        llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
        (chunk) => {
          if (!cancelled) socket.emit("task:chunk", { text: chunk, agentName: personality.name });
        },
        { desktopRelay, requestConfirmation, toolPolicy: personality.toolPolicy, isCancelled: () => cancelled },
      );

      // Persist token usage
      for (const u of result.usageRecords) {
        recordTaskTokenUsage(uid, u, interactionId);
      }

      if (cancelled) {
        socket.emit("agent:response", { text: result.text || '任务已取消。', agentName: personality.name });
        socket.emit("agent:status", { status: "idle" });
        return;
      }

      const holoTask = canOutputHolographic(sensory)
        ? textToHolographicOutput(result.text)
        : undefined;
      socket.emit("agent:response", { text: result.text, agentName: personality.name, holographic: holoTask });
      socket.emit("agent:status", { status: "idle" });

      // Log with conversation linkage
      const db = readDB();
      const conv = data.conversationId
        ? (db.conversations || []).find((c: any) => c.id === data.conversationId) || getOrCreateActiveConversation(uid)
        : getOrCreateActiveConversation(uid);
      if (!conv.title) {
        conv.title = data.text.slice(0, 50);
        writeDB(db);
      }
      db.interactions.push({
        id: interactionId,
        content: data.text,
        response: result.text,
        role: "user",
        personality: personality.id,
        timestamp: new Date().toISOString(),
        mode: 'task',
        toolCalls: result.toolCalls.map((tc: any) => ({ name: tc.name, args: tc.arguments })),
        conversationId: conv.id,
      } as any);
      writeDB(db);

      // Async memory extraction
      extractMemories(
        {
          userMessage: data.text,
          assistantResponse: result.text,
          existingMemories: relevantMemories.map(m => m.content),
          provider,
          model: personality.defaultModel,
          userId: uid,
        },
        llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
      ).then(extracted => {
        for (const mem of extracted.memories) {
          addMemory({
            userId: uid,
            type: mem.type,
            content: mem.content,
            keywords: mem.keywords,
            confidence: mem.confidence,
            sourceInteractionId: db.interactions[db.interactions.length - 1]?.id || '',
          });
        }
        for (const rem of extracted.reminders) {
          addReminder({
            userId: uid,
            content: rem.content,
            dueAt: rem.dueAt,
            sourceInteractionId: db.interactions[db.interactions.length - 1]?.id || '',
          });
        }
        const totalExtracted = extracted.memories.length + extracted.reminders.length;
        if (totalExtracted > 0) {
          console.log(`[Memory] Extracted ${extracted.memories.length} memories + ${extracted.reminders.length} reminders for user ${uid}`);
        }
      }).catch(err => console.error('[Memory] Extraction failed:', err));

      // Update emotional state
      let updatedState = updateEmotionalState(emotionalState, {
        type: 'interaction',
        userId: uid,
        timestamp: new Date().toISOString(),
      });
      if (isNovelTask) {
        updatedState = updateEmotionalState(updatedState, {
          type: 'novel_topic',
          userId: uid,
          timestamp: new Date().toISOString(),
        });
      }
      saveEmotionalState(uid, updatedState);

    } catch (err: any) {
      console.error("[Agent Task Error]:", err);
      const cf = handleLLMFailure(cognition?.intent || { category: 'unknown', confidence: 0, entities: {}, needsLLM: true }, err);
      socket.emit("agent:response", { text: cf.responseText, agentName: personality.name });
      socket.emit("agent:status", { status: "error" });
    } finally {
      socket.off('agent:task_cancel', onCancel);
    }
  });
}

function recordTaskTokenUsage(userId: string, record: LLMUsageRecord, interactionId: string) {
  if (record.promptTokens === 0 && record.completionTokens === 0) return;
  const db = readDB();
  if (!db.tokenUsage) db.tokenUsage = [];
  db.tokenUsage.push({
    id: crypto.randomUUID(),
    userId,
    provider: record.provider,
    model: record.model,
    promptTokens: record.promptTokens,
    completionTokens: record.completionTokens,
    totalTokens: record.totalTokens,
    mode: 'task',
    interactionId,
    timestamp: new Date().toISOString(),
  });
  writeDB(db);
}
