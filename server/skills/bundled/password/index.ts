import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import crypto from 'crypto';

async function handler(args: any) {
  const length = Math.min(Math.max(Number(args.length) || 20, 8), 128);
  const useUpper = args.uppercase !== false;
  const useLower = args.lowercase !== false;
  const useDigits = args.digits !== false;
  const useSymbols = args.symbols || false;
  try {
    let charset = '';
    if (useLower) charset += 'abcdefghijklmnopqrstuvwxyz';
    if (useUpper) charset += 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    if (useDigits) charset += '0123456789';
    if (useSymbols) charset += '!@#$%^&*()-_=+[]{}|;:,.<>?';
    if (!charset) charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';

    const bytes = crypto.randomBytes(length);
    let password = '';
    for (let i = 0; i < length; i++) {
      password += charset[bytes[i] % charset.length];
    }

    const strength = (() => {
      let score = 0;
      if (length >= 16) score += 2; else if (length >= 12) score += 1;
      if (useUpper && useLower) score += 2;
      if (useDigits) score += 1;
      if (useSymbols) score += 2;
      if (score >= 6) return 'strong';
      if (score >= 4) return 'medium';
      return 'weak';
    })();

    const result = JSON.stringify({ password, length, strength, charset: { uppercase: useUpper, lowercase: useLower, digits: useDigits, symbols: useSymbols } }, null, 2);
    return { content: [{ type: 'text' as const, text: result }] };
  } catch (e: any) {
    return { content: [{ type: 'text' as const, text: `Password generation failed: ${e.message}` }], isError: true };
  }
}

const server = new McpServer({ name: 'password', version: '1.0.0' }, { capabilities: { tools: {} } });
server.registerTool('generate_password', {
  description: 'Generate a cryptographically strong random password. Configure length and character sets.',
  inputSchema: {
    length: z.number().optional().describe('Password length (8-128, default 20)'),
    uppercase: z.boolean().optional().describe('Include uppercase letters (default true)'),
    lowercase: z.boolean().optional().describe('Include lowercase letters (default true)'),
    digits: z.boolean().optional().describe('Include digits (default true)'),
    symbols: z.boolean().optional().describe('Include special symbols (default false)'),
  },
}, handler);

const transport = new StdioServerTransport();
await server.connect(transport);
