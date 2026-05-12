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
import { queryMemories, addMemory, getDueReminders } from '../memory';
import { runWithTools } from '../llm/adapter';
import { toolRegistry, ToolRegistry } from '../tools/registry';
import { personalityRegistry } from '../personality';
import { deviceRegistry } from '../devices';
import { canOutputHolographic, textToHolographicOutput } from '../output/holographic';
import { setOfficeBroadcast } from '../tools/definitions/office_tools';
import { synthesizeSpeech, getActiveProvider } from '../tts/adapter';
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
          { role: 'system', content: systemPrompt + (memoryContext ? `\n\n## User context (memories):\n${memoryContext}` : '') },
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
          const voiceId = personality.ttsVoiceId || 'longxiaochun';
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
        const vid = voiceId || 'longxiaochun';
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
