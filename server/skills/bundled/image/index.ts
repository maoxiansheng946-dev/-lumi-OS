import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import sharp from 'sharp';
import path from 'path';

async function handler(args: any) {
  const { action, input, width, height, format, quality } = args;
  try {
    let image = sharp(input);

    if (action === 'resize') {
      if (!width && !height) throw new Error('width or height required for resize');
      image = image.resize(width || undefined, height || undefined, { fit: 'inside', withoutEnlargement: true });
    } else if (action === 'convert') {
      if (!format) throw new Error('target format required for convert');
      const fmt = format.toLowerCase();
      const supported = ['jpeg', 'jpg', 'png', 'webp', 'avif', 'tiff', 'gif'];
      if (!supported.includes(fmt)) throw new Error(`Unsupported format: ${fmt}. Use: ${supported.join(', ')}`);
      image = image.toFormat(fmt as any, { quality: quality || 85 });
    } else if (action === 'info') {
      const meta = await image.metadata();
      const result = JSON.stringify({
        format: meta.format,
        width: meta.width,
        height: meta.height,
        channels: meta.channels,
        hasAlpha: meta.hasAlpha,
        sizeBytes: meta.size,
      }, null, 2);
      return { content: [{ type: 'text' as const, text: result }] };
    } else {
      throw new Error(`Unknown action: ${action}. Use: resize, convert, or info.`);
    }

    const buf = await image.toBuffer();
    const base64 = buf.toString('base64');
    const ext = format || 'png';
    const result = JSON.stringify({
      action,
      outputSize: buf.length,
      format: ext,
      dataUri: `data:image/${ext};base64,${base64}`,
    }, null, 2);
    return { content: [{ type: 'text' as const, text: result }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `Image processing failed: ${e.message}` }], isError: true };
  }
}

const server = new McpServer({ name: 'image', version: '1.0.0' }, { capabilities: { tools: {} } });
server.registerTool('process_image', {
  description: 'Process images: resize, convert format, or get info. Input must be a file path to a local image.',
  inputSchema: {
    action: z.enum(['resize', 'convert', 'info']).describe('Action: resize, convert format, or get info'),
    input: z.string().describe('Path to the input image file'),
    width: z.number().optional().describe('Target width in pixels (for resize)'),
    height: z.number().optional().describe('Target height in pixels (for resize)'),
    format: z.enum(['jpeg', 'png', 'webp', 'avif', 'tiff']).optional().describe('Target format (for convert)'),
    quality: z.number().optional().describe('Output quality 1-100 (default 85, for convert)'),
  },
}, handler);

const transport = new StdioServerTransport();
await server.connect(transport);
