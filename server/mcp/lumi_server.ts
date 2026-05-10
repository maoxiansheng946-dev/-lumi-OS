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
            provider: 'deepseek',
            model: 'deepseek-v4-pro',
            maxTokens: 1024,
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
          2, // maxIterations: keep MCP fast
          g.getDeepSeek || (() => null),
          g.getGemini || (() => null),
          g.getOpenAI || (() => null),
          g.getAnthropic || (() => null),
          g.getQwen || (() => null),
          undefined, // onStreamChunk
          { toolPolicy: personality.toolPolicy },
        );

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
        return {
          content: [{ type: 'text' as const, text: response.text }],
          ...(holo && { holographic: holo }),
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
      const tools = tr.list();
      return {
        content: [{
          type: 'text' as const,
          text: JSON.stringify(tools.map(t => ({
            name: t.name,
            description: t.description,
            parameters: t.parameters,
            security: tr.resolveSecurity(t.name).level,
          })), null, 2),
        }],
      };
    },
  );

  // Tool: create a PowerPoint presentation via COM automation (Windows)
  mcp.registerTool(
    'lumi_create_ppt',
    {
      description: 'Create a PowerPoint .pptx presentation file on this computer. Provide a title and an array of slides (each with title and bullet points). Saves to the Desktop.',
      inputSchema: {
        title: z.string().describe('Presentation title'),
        slides: z.array(z.object({
          title: z.string().describe('Slide title'),
          bullets: z.array(z.string()).describe('Bullet points for this slide'),
        })).describe('Array of slides'),
        filename: z.string().optional().describe('Output filename (default: title.pptx)'),
      },
    },
    async ({ title, slides, filename }) => {
      try {
        const os = require('os');
        const fs = require('fs');
        const path = require('path');
        const safeName = (filename || title).replace(/[\\/:*?"<>|]/g, '_');

        bc('mcp:activity', { device: 'xiaozhi', action: 'create_ppt', status: 'started', title, slidesCount: slides.length });

        const psLines: string[] = [
          '$ppt = New-Object -ComObject PowerPoint.Application',
          '$ppt.Visible = $true',
          '$pres = $ppt.Presentations.Add()',
        ];

        for (let i = 0; i < slides.length; i++) {
          const s = slides[i];
          const st = s.title.replace(/'/g, "''");
          psLines.push(`$s${i} = $pres.Slides.Add(${i + 1}, 1)`);
          psLines.push(`$s${i}.Shapes.Item(1).TextFrame.TextRange.Text = '${st}'`);
          if (s.bullets.length > 0) {
            const bullets = s.bullets.map(b => b.replace(/'/g, "''")).join('`n');
            psLines.push(`if ($s${i}.Shapes.Count -ge 2) { $s${i}.Shapes.Item(2).TextFrame.TextRange.Text = '${bullets}' }`);
          }
          psLines.push(`Start-Sleep -Milliseconds 800`);
        }

        psLines.push(`$desktop = [Environment]::GetFolderPath('Desktop')`);
        psLines.push(`$out = Join-Path $desktop '${safeName}.pptx'`);
        psLines.push(`$pres.SaveAs($out)`);
        psLines.push(`$pres.Close()`);
        psLines.push(`$ppt.Quit()`);
        psLines.push(`Write-Output $out`);

        const tmpFile = path.join(os.tmpdir(), `lumi_ppt_${Date.now()}.ps1`);
        fs.writeFileSync(tmpFile, psLines.join('\n'), 'utf-8');

        const { execSync } = await import('child_process');
        const result = execSync(`powershell -NoProfile -ExecutionPolicy Bypass -File "${tmpFile}"`, {
          timeout: 60000,
          encoding: 'utf-8',
        });
        fs.unlinkSync(tmpFile);
        const savedPath = result.trim();

        bc('mcp:activity', { device: 'xiaozhi', action: 'create_ppt', status: 'completed', path: savedPath, slidesCount: slides.length });

        try { execSync(`start "" "${savedPath}"`, { timeout: 5000 }); } catch {}

        return {
          content: [{ type: 'text' as const, text: `PPT created and opened: ${savedPath} (${slides.length} slides)` }],
        };
      } catch (err: any) {
        bc('mcp:activity', { device: 'xiaozhi', action: 'create_ppt', status: 'failed', error: err.message });
        return { content: [{ type: 'text' as const, text: `PPT failed: ${err.message}. PowerPoint may not be installed.` }], isError: true };
      }
    },
  );

  // Auto-register ALL "safe" internal tools as direct MCP tools
  // so remote devices (xiaozhi, etc.) see a rich tool set
  const safeTools = tr.list().filter(t => tr.resolveSecurity(t.name).level === 'safe');
  for (const tool of safeTools) {
    const mcpToolName = `lumi_${tool.name}`;

    // Build Zod schema from the tool's JSON Schema parameters
    let inputSchema: Record<string, any> = {};
    const params = tool.parameters;
    if (params?.properties) {
      for (const [key, def] of Object.entries(params.properties)) {
        const d = def as Record<string, any>;
        if (d.type === 'string') {
          inputSchema[key] = z.string().optional().describe(d.description || '');
        } else if (d.type === 'number' || d.type === 'integer') {
          inputSchema[key] = z.number().optional().describe(d.description || '');
        } else if (d.type === 'boolean') {
          inputSchema[key] = z.boolean().optional().describe(d.description || '');
        } else if (d.type === 'array') {
          inputSchema[key] = z.array(z.any()).optional().describe(d.description || '');
        } else {
          inputSchema[key] = z.any().optional().describe(d.description || '');
        }
      }
    }

    mcp.registerTool(
      mcpToolName,
      {
        description: tool.description,
        inputSchema,
      },
      async (args) => {
        try {
          const result = await tr.execute(tool.name, args || {});
          return {
            content: [{ type: 'text' as const, text: typeof result === 'string' ? result : JSON.stringify(result, null, 2) }],
          };
        } catch (err: any) {
          return { content: [{ type: 'text' as const, text: `${tool.name} error: ${err.message}` }], isError: true };
        }
      },
    );
  }

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
