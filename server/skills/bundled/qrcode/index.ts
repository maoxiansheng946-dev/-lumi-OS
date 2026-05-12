import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

async function handler(args: any) {
  const text = String(args.text || '');
  const size = Number(args.size) || 256;
  try {
    const url = `https://api.qrserver.com/v1/create-qr-code/?size=${size}x${size}&data=${encodeURIComponent(text)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`QR API returned ${res.status}`);
    const buf = await res.arrayBuffer();
    const base64 = Buffer.from(buf).toString('base64');
    const result = JSON.stringify({
      text,
      size: `${size}x${size}`,
      format: 'png',
      dataUri: `data:image/png;base64,${base64}`,
    }, null, 2);
    return { content: [{ type: 'text' as const, text: result }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `QR generation failed: ${e.message}` }], isError: true };
  }
}

const server = new McpServer({ name: 'qrcode', version: '1.0.0' }, { capabilities: { tools: {} } });
server.registerTool('generate_qrcode', {
  description: 'Generate a QR code PNG image from text or URL. Returns a base64 data URI.',
  inputSchema: {
    text: z.string().describe('Text or URL to encode in the QR code'),
    size: z.number().optional().describe('Image size in pixels (default 256)'),
  },
}, handler);

const transport = new StdioServerTransport();
await server.connect(transport);
