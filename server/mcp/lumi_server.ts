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
import { toolRegistry } from '../tools/registry';
import { personalityRegistry } from '../personality';
import { deviceRegistry } from '../devices';
import { canOutputHolographic, textToHolographicOutput } from '../output/holographic';
import { logger } from '../../logger';
import type { Request, Response } from 'express';

// Track active transports per session
const transports: Map<string, SSEServerTransport> = new Map();

export function createLumiMcpServer(): McpServer {
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
        const { systemPrompt } = personalityRegistry.buildSystemPrompt(pid, { mode: 'chat', sensory });

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

        const response = await runWithTools(
          messages,
          toolRegistry,
          {
            provider: 'qwen',
            model: personality.defaultModel || 'qwen-plus',
            maxTokens: 2048,
            userId: 'mcp_remote',
          },
          undefined, // onToolCall
          personality.toolPolicy.maxIterations || 3,
          () => null, () => null, () => null, () => null, () => null,
          undefined, // onStreamChunk
          { toolPolicy: personality.toolPolicy },
        );

        // Auto-extract memories from the interaction
        if (personality.memoryPolicy.autoExtract) {
          try {
            const { extractMemories } = await import('../memory/extractor');
            const result = await extractMemories(
              {
                userMessage: message,
                assistantResponse: response.text,
                existingMemories: memories.map(m => m.content),
                provider: 'qwen',
                model: 'qwen-plus',
                userId: 'mcp_remote',
              },
              () => null, () => null, () => null, () => null, () => null,
            );
            for (const mem of result.memories) {
              addMemory({
                userId: 'mcp_remote',
                type: mem.type,
                content: mem.content,
                keywords: mem.keywords,
                confidence: mem.confidence,
                sourceInteractionId: 'mcp_lumi_chat',
              });
            }
          } catch {
            // Memory extraction is best-effort
          }
        }

        const holo = canOutputHolographic(sensory)
          ? textToHolographicOutput(response.text)
          : undefined;
        return {
          content: [{ type: 'text' as const, text: response.text }],
          ...(holo && { holographic: holo }),
        };
      } catch (err: any) {
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

  // Tool: execute a Lumi tool
  mcp.registerTool(
    'lumi_tool_execute',
    {
      description: 'Execute a built-in Lumi tool (web_search, url_fetch, read_file, etc.) and get the result.',
      inputSchema: {
        tool: z.string().describe('Name of the tool to execute'),
        args: z.record(z.any()).describe('Arguments to pass to the tool'),
      },
    },
    async ({ tool, args }) => {
      try {
        const resolved = toolRegistry.resolveSecurity(tool);
        if (resolved.level === 'forbidden') {
          return { content: [{ type: 'text' as const, text: `Tool "${tool}" is forbidden.` }], isError: true };
        }
        if (resolved.level === 'confirm') {
          return { content: [{ type: 'text' as const, text: `Tool "${tool}" requires user confirmation. Not available via MCP.` }], isError: true };
        }
        const result = await toolRegistry.execute(tool, args);
        return {
          content: [{
            type: 'text' as const,
            text: typeof result === 'string' ? result : JSON.stringify(result, null, 2),
          }],
        };
      } catch (err: any) {
        return { content: [{ type: 'text' as const, text: `Tool error: ${err.message}` }], isError: true };
      }
    },
  );

  // Tool: list available tools
  mcp.registerTool(
    'lumi_tool_list',
    {
      description: 'List all available Lumi tools with descriptions.',
      inputSchema: {},
    },
    async () => {
      const tools = toolRegistry.list();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            security: toolRegistry.resolveSecurity(t.name).level,
          })), null, 2),
        }],
      };
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
