/**
 * Lumi as an MCP Server — exposes Lumi's capabilities as MCP tools
 * so remote devices can connect and invoke Lumi via the MCP protocol.
 *
 * Transport: SSE (HTTP) — devices connect via POST to /mcp/message
 * and receive responses via SSE at /mcp/sse
 */
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { z } from 'zod';
import { queryMemories, addMemory, getDueReminders, buildNarrativeChain, borrowAgentMemories } from '../memory';
import { runWithTools } from '../llm/adapter';
import { toolRegistry, ToolRegistry } from '../tools/registry';
import { personalityRegistry } from '../personality';
import { deviceRegistry } from '../devices';
import { canOutputHolographic, textToHolographicOutput } from '../output/holographic';
import { setOfficeBroadcast } from '../tools/definitions/office_tools';
import { synthesizeSpeech, getActiveProvider } from '../tts/adapter';
import { classifyComplexity, decomposeTask, matchWorkers, executeWorkflow, aggregateWithLLM, getRoutingCacheStats } from '../agents/orchestrator';
import { readDB } from '../../db_layer';
import { formatLAPSelfPrompt } from '../lap/policy';
import os from 'os';
import fs from 'fs';
import path from 'path';
import { logger } from '../../logger';
import type { Request, Response } from 'express';

// Track active transports per session
const transports: Map<string, SSEServerTransport> = new Map();

export function createLumiMcpServer(llmGetters?: {
  getDeepSeek?: () => any;
  getGemini?: () => any;
  getOpenAI?: () => any;
  getAnthropic?: () => any;
  getQwen?: () => any;
}, toolReg?: ToolRegistry, broadcast?: (event: string, data: any) => void): McpServer {
  const g = llmGetters || {};
  const tr = toolReg || toolRegistry;
  const bc = broadcast || (() => {});
  setOfficeBroadcast(bc);
  const mcp = new McpServer({
    name: 'lumi-mcp',
    version: '2.0.0',
  }, {
    capabilities: { tools: {} },
  });

  // Tool: send a chat message to Lumi
  mcp.registerTool(
    'lumi_chat',
    {
      description: 'Send a message to Lumi and get an AI-powered response. Lumi will use its personality, memory, and tool capabilities.',
      inputSchema: {
        message: z.string().describe('The message to send to Lumi'),
        personalityId: z.string().optional().describe('Personality to use (default: "lumi")'),
      },
    },
    async ({ message, personalityId }) => {
      try {
        bc('mcp:activity', { device: 'xiaozhi', action: 'chat', status: 'received', message: message.slice(0, 200) });
        bc('agent:status', { status: 'thinking', agentName: 'Lumi' });
        const pid = personalityId || 'lumi';
        const personality = personalityRegistry.get(pid) || personalityRegistry.get('lumi')!;
        const ds = deviceRegistry.getSensoryContext('mcp_remote');
        const sensory = {
          audio: ds.hasAudio,
          visual: ds.hasVideo,
          spatial: ds.hasSpatial,
          haptic: ds.hasHaptic,
          holographic: ds.hasHolographic,
          activeDeviceTypes: ds.activeDeviceTypes,
          deviceCount: ds.deviceCount,
        };
        const { systemPrompt } = personalityRegistry.buildSystemPrompt(pid, { mode: 'task', sensory });

        const memories = queryMemories({
          limit: personality.memoryPolicy.retrieveLimit,
          minConfidence: personality.memoryPolicy.minConfidence,
        });
        const memoryContext = memories.length > 0
          ? memories.map(m => `[${m.type}] ${m.content}`).join('\n')
          : '';

        const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
          { role: 'system', content: systemPrompt + '\n\n' + formatLAPSelfPrompt() + (memoryContext ? `\n\n## User context (memories):\n${memoryContext}` : '') },
          { role: 'user', content: message },
        ];

        const MCP_TIMEOUT_MS = 25000;

        const responsePromise = runWithTools(
          messages,
          tr,
          {
            provider: 'deepseek',
            model: 'deepseek-v4-pro',
            maxTokens: 2048,
            userId: 'mcp_remote',
          },
          (record) => {
            const cid = `${record.name}-${Date.now()}`;
            bc('agent:tool_call', { correlationId: cid, name: record.name, arguments: record.arguments });
            if (record.error) {
              bc('agent:tool_call', { correlationId: cid, name: record.name, arguments: record.arguments, error: record.error });
            } else {
              bc('agent:tool_call', { correlationId: cid, name: record.name, arguments: record.arguments, result: (record.result || '').slice(0, 300) });
            }
          },
          personality.toolPolicy.maxIterations,
          g.getDeepSeek || (() => null),
          g.getGemini || (() => null),
          g.getOpenAI || (() => null),
          g.getAnthropic || (() => null),
          g.getQwen || (() => null),
          (chunk) => bc('mcp:chunk', { device: 'xiaozhi', text: chunk }),
          { toolPolicy: personality.toolPolicy },
        );

        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('MCP_TIMEOUT')), MCP_TIMEOUT_MS)
        );

        let response: Awaited<typeof responsePromise>;
        try {
          response = await Promise.race([responsePromise, timeoutPromise]);
        } catch (e: any) {
          if (e.message === 'MCP_TIMEOUT') {
            console.log('[MCP lumi_chat] Timeout — continuing in background');
            bc('mcp:activity', { device: 'xiaozhi', action: 'chat', status: 'timeout' });
            bc('agent:status', { status: 'idle', agentName: 'Lumi' });
            responsePromise.then(() => {
              bc('agent:status', { status: 'idle', agentName: 'Lumi' });
            }).catch(() => {});
            return {
              content: [{ type: 'text' as const, text: '正在处理中，稍等片刻...' }],
            };
          }
          throw e;
        }

        // Fire-and-forget memory extraction (non-blocking)
        if (personality.memoryPolicy.autoExtract) {
          const userMsg = message;
          const respText = response.text;
          const existingContents = memories.map(m => m.content);
          const gDeep = g.getDeepSeek || (() => null);
          const gGem = g.getGemini || (() => null);
          const gOAI = g.getOpenAI || (() => null);
          const gAnt = g.getAnthropic || (() => null);
          const gQw = g.getQwen || (() => null);
          (async () => {
            try {
              const { extractMemories } = await import('../memory/extractor');
              const result = await extractMemories(
                { userMessage: userMsg, assistantResponse: respText, existingMemories: existingContents, provider: 'deepseek', model: 'deepseek-v4-pro', userId: 'mcp_remote' },
                gDeep, gGem, gOAI, gAnt, gQw,
              );
              for (const mem of result.memories) {
                addMemory({ userId: 'mcp_remote', type: mem.type, content: mem.content, keywords: mem.keywords, confidence: mem.confidence, sourceInteractionId: 'mcp_lumi_chat' });
              }
            } catch { /* best-effort */ }
          })();
        }

        const holo = canOutputHolographic(sensory)
          ? textToHolographicOutput(response.text)
          : undefined;
        bc('mcp:activity', { device: 'xiaozhi', action: 'chat', status: 'responded', toolCalls: response.toolCalls.length });
        bc('agent:response', { text: response.text, agentName: 'Lumi' });
        bc('agent:status', { status: 'idle', agentName: 'Lumi' });
        console.log('[MCP lumi_chat] Response length:', response.text.length, 'chars, toolCalls:', response.toolCalls.length);

        // Synthesize TTS audio so xiaozhi can speak with Lumi's voice
        let audioBase64: string | undefined;
        let audioFormat: string | undefined;
        try {
          const provider = getActiveProvider();
          const voiceId = personality.ttsVoiceId || 'longxiaochun_v3';
          const ttsResult = await synthesizeSpeech(response.text, { provider, voiceId });
          audioBase64 = ttsResult.audioBuffer.toString('base64');
          audioFormat = ttsResult.format;
          bc('mcp:activity', { device: 'xiaozhi', action: 'tts', status: 'synthesized', bytes: ttsResult.audioBuffer.length });
        } catch (ttsErr: any) {
          console.error('[MCP TTS] Synthesis failed:', ttsErr.message);
        }

        return {
          content: [{ type: 'text' as const, text: response.text }],
          ...(holo && { holographic: holo }),
          ...(audioBase64 && { audio: audioBase64, audioFormat }),
        };
      } catch (err: any) {
        bc('mcp:activity', { device: 'xiaozhi', action: 'chat', status: 'failed', error: err.message });
        bc('agent:error', { message: err.message });
        bc('agent:status', { status: 'error', agentName: 'Lumi' });
        return {
          content: [{ type: 'text' as const, text: `[Lumi error]: ${err.message}` }],
          isError: true,
        };
      }
    },
  );

  // Tool: search memories
  mcp.registerTool(
    'lumi_memory_search',
    {
      description: 'Search Lumi\'s memory for facts, preferences, habits, and knowledge about the user.',
      inputSchema: {
        query: z.string().optional().describe('Search query (keyword match in content and keywords)'),
        type: z.enum(['preference', 'fact', 'habit', 'knowledge']).optional().describe('Filter by memory type'),
        limit: z.number().optional().default(10).describe('Max number of results (default 10)'),
      },
    },
    async ({ query, type, limit }) => {
      try {
        const memories = queryMemories({ query, type, limit });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify(memories.map(m => ({
              id: m.id,
              type: m.type,
              content: m.content,
              keywords: m.keywords,
              confidence: Math.round(m.confidence * 100) + '%',
              retrieved: m.retrieveCount + 'x',
            })), null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // Tool: add a memory
  mcp.registerTool(
    'lumi_memory_add',
    {
      description: 'Teach Lumi something new — add a memory entry about a user preference, fact, habit, or knowledge.',
      inputSchema: {
        type: z.enum(['preference', 'fact', 'habit', 'knowledge']).describe('Type of memory'),
        content: z.string().describe('What Lumi should remember'),
        keywords: z.array(z.string()).optional().describe('Search keywords for this memory'),
      },
    },
    async ({ type, content, keywords }) => {
      try {
        const kw = keywords || content.toLowerCase().split(/\s+/).filter(w => w.length > 2);
        const entry = addMemory({
          userId: 'mcp_remote',
          type,
          content,
          keywords: kw,
          confidence: 0.7,
          sourceInteractionId: 'mcp_manual',
        });
        return {
          content: [{
            type: 'text' as const,
            text: `Memory added: [${entry.type}] ${entry.content} (${kw.length} keywords)`,
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    },
  );

  // Tool: list reminders
  mcp.registerTool(
    'lumi_reminder_list',
    {
      description: 'Get all pending reminders that Lumi is tracking.',
      inputSchema: {},
    },
    async () => {
      try {
        const reminders = getDueReminders();
        return {
          content: [{
            type: 'text' as const,
            text: reminders.length === 0
              ? 'No pending reminders.'
              : JSON.stringify(reminders.map(r => ({
                  id: r.id,
                  content: r.content,
                  dueAt: r.dueAt,
                  status: r.status,
                })), null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Error: ${err.message}` }], isError: true };
      }
    },
  );


  // Tool: proactive speak — Lumi pushes TTS audio to xiaozhi
  mcp.registerTool(
    'lumi_speak',
    {
      description: 'Synthesize speech from text and return audio. Used for Lumi to proactively speak through the xiaozhi device — notifications, reminders, or unprompted comments.',
      inputSchema: {
        text: z.string().describe('The text Lumi should speak'),
        voiceId: z.string().optional().describe('TTS voice ID (default uses Lumi personality voice)'),
      },
    },
    async ({ text, voiceId }) => {
      try {
        const provider = getActiveProvider();
        const vid = voiceId || 'longxiaochun_v3';
        const ttsResult = await synthesizeSpeech(text, { provider, voiceId: vid });
        const audioBase64 = ttsResult.audioBuffer.toString('base64');
        bc('mcp:activity', { device: 'xiaozhi', action: 'speak', text: text.slice(0, 100), bytes: ttsResult.audioBuffer.length });
        bc('mcp:proactive', { text, audio: audioBase64, format: ttsResult.format });
        return {
          content: [{ type: 'text' as const, text: `Speech synthesized (${ttsResult.audioBuffer.length} bytes, ${ttsResult.format})` }],
          audio: audioBase64,
          audioFormat: ttsResult.format,
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Speech synthesis failed: ${err.message}` }], isError: true };
      }
    },
  );

  // Tool: memory narrative chain — weave related memories into a chronological story
  mcp.registerTool(
    'lumi_narrative',
    {
      description: '将分散的记忆片段按时间顺序编织成连贯的第一人称中文叙事。输入一个主题，Lumi 会搜索相关记忆并生成叙事故事。',
      inputSchema: {
        topic: z.string().describe('叙事主题，用于搜索相关记忆'),
        limit: z.number().optional().default(10).describe('最大记忆数量'),
      },
    },
    async ({ topic, limit }) => {
      try {
        const result = await buildNarrativeChain({
          userId: 'mcp_remote',
          topic,
          limit,
          getDeepSeek: g.getDeepSeek || (() => null),
          getGemini: g.getGemini || (() => null),
          getQwen: g.getQwen || (() => null),
        });
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              narrative: result.narrative,
              sourceMemoryIds: result.sourceMemoryIds,
              chainLength: result.memoryChain.length,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Narrative generation failed: ${err.message}` }], isError: true };
      }
    },
  );

  // Cross-agent memory sharing: borrow memories from other agents
  mcp.registerTool(
    'lumi_agent_share',
    {
      description: '从其他 Agent 借用与某个主题相关的高价值记忆。只返回标记为跨 Agent 共享的记忆（growth 层 + 高重要性 internalized 层）。',
      inputSchema: {
        requestingAgentId: z.string().describe('请求借用的 Agent ID'),
        topic: z.string().describe('搜索主题'),
        limit: z.number().optional().default(5).describe('返回的最大记忆数'),
      },
    },
    async ({ requestingAgentId, topic, limit }) => {
      try {
        const memories = borrowAgentMemories(requestingAgentId, topic, 'mcp_remote', limit);
        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              borrowed: memories.length,
              memories: memories.map(m => ({
                id: m.id,
                content: m.content,
                tier: m.tier,
                importance: m.importance,
                agentId: m.agentId,
                keywords: m.keywords,
              })),
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Agent share failed: ${err.message}` }], isError: true };
      }
    },
  );

  // ── Orchestrator management tools ──

  // List all worker agents with status, skills, and routing history
  mcp.registerTool(
    'lumi_list_workers',
    {
      description: '列出所有可用的 Worker Agent，包括状态、技能标签、知识域和路由缓存统计。用于监控 Lumi 主脑的工人池。',
      inputSchema: {
        statusFilter: z.enum(['active', 'idle', 'offline', 'all']).optional().default('all').describe('按状态过滤'),
      },
    },
    async ({ statusFilter }) => {
      try {
        const db = readDB();
        const agents = (db.agents || []).filter((a: any) => {
          if (statusFilter === 'all') return true;
          return a.status === statusFilter;
        });

        const routingStats = getRoutingCacheStats();

        const workers = agents.map((a: any) => {
          const agentRouting = routingStats.agents?.[a.id] || {};
          return {
            id: a.id,
            name: a.name,
            status: a.status || 'idle',
            skillTags: a.skillTags || [],
            executionMode: a.executionMode || 'lumi',
            knowledgeDomains: a.knowledgeDomains || [],
            memoryScope: a.memoryScope || 'shared',
            autonomyLevel: a.autonomyLevel || 'reactive',
            routingHistory: agentRouting,
            createdAt: a.createdAt,
          };
        });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              total: workers.length,
              routingCacheSummary: {
                totalSkillTags: routingStats.totalSkillTags || 0,
                totalRoutes: routingStats.totalRoutes || 0,
              },
              workers,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Worker list failed: ${err.message}` }], isError: true };
      }
    },
  );

  // Detailed worker status
  mcp.registerTool(
    'lumi_worker_status',
    {
      description: '获取指定 Worker Agent 的详细状态，包括关联记忆数、最近任务、路由命中率。',
      inputSchema: {
        agentId: z.string().describe('Worker Agent ID'),
      },
    },
    async ({ agentId }) => {
      try {
        const db = readDB();
        const agent = (db.agents || []).find((a: any) => a.id === agentId);
        if (!agent) {
          return { content: [{ type: 'text' as const, text: `Agent "${agentId}" not found` }], isError: true };
        }

        // Count memories owned by this agent
        const memoryCount = (db.memories || []).filter((m: any) => m.agentId === agentId).length;

        // Recent interactions for this agent
        const recentInteractions = (db.interactions || [])
          .filter((i: any) => i.agentId === agentId)
          .sort((a: any, b: any) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
          .slice(0, 5)
          .map((i: any) => ({
            content: (i.content || i.message || '').slice(0, 100),
            response: (i.response || '').slice(0, 100),
            timestamp: i.timestamp,
          }));

        // Routing stats
        const routingStats = getRoutingCacheStats();
        const agentRouting = routingStats.agents?.[agentId] || {};

        // Conversations
        const conversations = (db.conversations || []).filter((c: any) => c.agentId === agentId);

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              agent: {
                id: agent.id,
                name: agent.name,
                status: agent.status || 'idle',
                skillTags: agent.skillTags || [],
                executionMode: agent.executionMode || 'lumi',
                knowledgeDomains: agent.knowledgeDomains || [],
                memoryScope: agent.memoryScope || 'shared',
                autonomyLevel: agent.autonomyLevel || 'reactive',
                createdAt: agent.createdAt,
              },
              stats: {
                memoryCount,
                interactionCount: recentInteractions.length,
                conversationCount: conversations.length,
                activeConversations: conversations.filter((c: any) => c.status === 'active').length,
              },
              routing: agentRouting,
              recentTasks: recentInteractions,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Worker status failed: ${err.message}` }], isError: true };
      }
    },
  );

  // Manually route a task through the orchestrator
  mcp.registerTool(
    'lumi_route_task',
    {
      description: '通过 Lumi 主脑编排引擎手动路由一个任务。任务会被分解并分配给合适的 Worker Agent 执行，结果汇总后返回。',
      inputSchema: {
        task: z.string().describe('要执行的任务描述'),
        targetAgentId: z.string().optional().describe('指定目标 Agent ID（可选，不指定则自动匹配）'),
      },
    },
    async ({ task, targetAgentId }) => {
      try {
        bc('mcp:activity', { device: 'xiaozhi', action: 'route_task', status: 'received', task: task.slice(0, 200) });

        const complexity = classifyComplexity(task, { userId: 'mcp_remote', personalityId: 'lumi' });

        if (complexity !== 'complex') {
          // Simple task — let Lumi handle directly
          const personality = personalityRegistry.get('lumi') || personalityRegistry.getDefault();
          const { systemPrompt } = personalityRegistry.buildSystemPrompt('lumi', { mode: 'task', sensory: { audio: false, visual: false, spatial: false, haptic: false, holographic: false, activeDeviceTypes: [], deviceCount: 0 } });

          const messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }> = [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: task },
          ];

          const result = await runWithTools(
            messages, tr,
            { provider: 'deepseek', model: 'deepseek-v4-pro', maxTokens: 2048, userId: 'mcp_remote' },
            undefined, 2,
            g.getDeepSeek || (() => null), g.getGemini || (() => null), g.getOpenAI || (() => null),
            g.getAnthropic || (() => null), g.getQwen || (() => null),
          );

          return {
            content: [{
              type: 'text' as const,
              text: JSON.stringify({
                complexity: 'simple',
                handledBy: 'Lumi (direct)',
                result: result.text,
                toolCalls: result.toolCalls.length,
              }, null, 2),
            }],
          };
        }

        // Complex task — orchestrate
        const db = readDB();
        const availableAgents = (db.agents || []).filter((a: any) => a.status !== 'offline');

        if (targetAgentId) {
          // Direct routing to specified agent
          const targetAgent = availableAgents.find((a: any) => a.id === targetAgentId);
          if (!targetAgent) {
            return { content: [{ type: 'text' as const, text: `Target agent "${targetAgentId}" not found or offline` }], isError: true };
          }
        }

        if (availableAgents.length === 0) {
          return { content: [{ type: 'text' as const, text: 'No worker agents available. Create at least one agent first.' }], isError: true };
        }

        const subTasks = await decomposeTask(
          task,
          { provider: 'deepseek', model: 'deepseek-v4-pro' },
          { userId: 'mcp_remote', personalityId: 'lumi' },
          { getDeepSeek: g.getDeepSeek || (() => null), getGemini: g.getGemini || (() => null), getOpenAI: g.getOpenAI || (() => null), getAnthropic: g.getAnthropic || (() => null), getQwen: g.getQwen || (() => null) },
        );

        const assignments = matchWorkers(subTasks, availableAgents);
        const workflowResult = await executeWorkflow(
          assignments,
          { userId: 'mcp_remote', personalityId: 'lumi' },
          { provider: 'deepseek', model: 'deepseek-v4-pro' },
          { getDeepSeek: g.getDeepSeek || (() => null), getGemini: g.getGemini || (() => null), getOpenAI: g.getOpenAI || (() => null), getAnthropic: g.getAnthropic || (() => null), getQwen: g.getQwen || (() => null) },
        );

        const aggregated = await aggregateWithLLM(
          workflowResult, task,
          { provider: 'deepseek', model: 'deepseek-v4-pro' },
          { getDeepSeek: g.getDeepSeek || (() => null), getGemini: g.getGemini || (() => null), getOpenAI: g.getOpenAI || (() => null), getAnthropic: g.getAnthropic || (() => null), getQwen: g.getQwen || (() => null) },
        );

        bc('mcp:activity', { device: 'xiaozhi', action: 'route_task', status: 'completed', subTasks: subTasks.length, agentsUsed: workflowResult.totalAgentsUsed });

        return {
          content: [{
            type: 'text' as const,
            text: JSON.stringify({
              complexity: 'complex',
              handledBy: `Lumi Orchestrator → ${workflowResult.totalAgentsUsed} worker(s)`,
              subTasks: subTasks.map(s => ({ id: s.id, description: s.description, skill: s.requiredSkill, agentId: s.assignedAgentId })),
              assignments: assignments.map(a => ({ subTaskId: a.subTask.id, agentId: a.agent.id, agentName: a.agent.name })),
              result: aggregated,
              workflowSteps: workflowResult.subTaskResults.length,
            }, null, 2),
          }],
        };
      } catch (err: any) {
        bc('mcp:activity', { device: 'xiaozhi', action: 'route_task', status: 'failed', error: err.message });
        return { content: [{ type: 'text' as const, text: `Task routing failed: ${err.message}` }], isError: true };
      }
    },
  );

  return mcp;
}

/**
 * Handle SSE connection — create transport and add to the Lumi MCP server.
 */
export async function handleMcpSSE(mcpServer: McpServer, req: Request, res: Response) {
  try {
    const transport = new SSEServerTransport('/mcp/message', res);
    transports.set(transport.sessionId, transport);

    res.on('close', () => {
      transports.delete(transport.sessionId);
    });

    await mcpServer.connect(transport);
  } catch (err: any) {
    logger.error('[MCP Server] SSE connection error:', err.message);
    if (!res.headersSent) {
      res.status(500).json({ error: 'MCP SSE connection failed' });
    }
  }
}

/**
 * Handle incoming MCP messages (JSON-RPC via HTTP POST).
 */
export async function handleMcpMessage(req: Request, res: Response) {
  try {
    // Find the session by checking query param or a simple session routing
    const sessionId = req.query.sessionId as string;
    let transport: SSEServerTransport | undefined;

    if (sessionId) {
      transport = transports.get(sessionId);
    } else if (transports.size === 1) {
      // If only one session, use it
      transport = transports.values().next().value;
    }

    if (!transport) {
      // No active session — try to get sessionId from the MCP message body
      // MCP clients usually pass sessionId as a query parameter
      res.status(400).json({ error: 'No active MCP session. Connect to /mcp/sse first.' });
      return;
    }

    await transport.handlePostMessage(req, res);
  } catch (err: any) {
    logger.error('[MCP Server] Message error:', err.message);
    res.status(500).json({ error: 'MCP message handling failed' });
  }
}
