import { execFile, execFileSync } from 'child_process';
import fs from 'fs';
import path from 'path';
import { promisify } from 'util';

const execFileP = promisify(execFile);

export type NcmCliResult = {
  ok: boolean;
  stdout: string;
  stderr?: string;
  error?: string;
};

export function normalizeNcmAppId(value: unknown): string | null {
  const appId = String(value ?? '').trim();
  return /^[A-Za-z0-9_-]{4,64}$/.test(appId) ? appId : null;
}

export function normalizeNcmPrivateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  let privateKey = value
    .replace(/^\uFEFF/, '')
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\r\n/g, '\n')
    .trim();

  if (privateKey.length < 16 || privateKey.length > 12000) return null;
  if (/-----BEGIN [A-Z ]*PRIVATE KEY-----/.test(privateKey)) {
    return `${privateKey}\n`;
  }

  const compact = privateKey.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(compact) || compact.length < 800) return null;
  const body = compact.match(/.{1,64}/g)?.join('\n');
  return body ? `-----BEGIN PRIVATE KEY-----\n${body}\n-----END PRIVATE KEY-----\n` : null;
}

export function looksLikeNcmFailure(text: string): boolean {
  return /(api\s*key|login|required|failed|failure|error|cannot|not\s+found|mpv|player|RSA\s*SHA256|DECODER|签名失败|未设置|未配置|未登录|失败|错误|无法)/i.test(text);
}

export function quoteNcmArg(value: string): string {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '\\"').replace(/([&|<>^%])/g, '^$1')}"`;
}

function shouldAppendJsonOutput(args: string[]): boolean {
  if (args.includes('--output')) return false;
  return args[0] !== 'config';
}

function withJsonOutput(args: string[]): string[] {
  return shouldAppendJsonOutput(args) ? [...args, '--output', 'json'] : args;
}

function getLocalNcmCliPath(): string | null {
  const cliPath = path.join(process.cwd(), 'node_modules', '@music163', 'ncm-cli', 'dist', 'index.js');
  return fs.existsSync(cliPath) ? cliPath : null;
}

function getNcmCliExec(args: string[]): { file: string; args: string[] } {
  const finalArgs = withJsonOutput(args);
  const localCli = getLocalNcmCliPath();
  if (localCli) return { file: process.execPath, args: [localCli, ...finalArgs] };
  if (process.platform === 'win32') return { file: 'cmd.exe', args: ['/d', '/c', makeWinCmdline(args)] };
  return { file: 'npx', args: ['@music163/ncm-cli', ...finalArgs] };
}

function makeWinCmdline(args: string[]): string {
  return ['npx.cmd', '@music163/ncm-cli', ...withJsonOutput(args)]
    .map(quoteNcmArg)
    .join(' ');
}

export function runNcmCliSync(args: string[], timeout = 15000): NcmCliResult {
  try {
    const command = getNcmCliExec(args);
    const stdout = execFileSync(command.file, command.args, {
      timeout,
      windowsHide: true,
      encoding: 'utf8',
      maxBuffer: 1024 * 1024,
    });
    return { ok: true, stdout };
  } catch (e: any) {
    const stdout = String(e.stdout || '');
    const stderr = String(e.stderr || '');
    const message = String(e.message || '');
    const combined = `${stdout}\n${stderr}\n${message}`;
    return {
      ok: Boolean(stdout.trim()) && !looksLikeNcmFailure(combined),
      stdout,
      stderr,
      error: stderr || message || stdout,
    };
  }
}

export async function runNcmCliAsync(args: string[], timeout = 15000, maxBuffer = 1024 * 1024): Promise<NcmCliResult> {
  try {
    const command = getNcmCliExec(args);
    const result = await execFileP(command.file, command.args, {
      timeout,
      windowsHide: true,
      maxBuffer,
      encoding: 'utf8',
    } as any);
    return { ok: true, stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
  } catch (e: any) {
    const stdout = String(e.stdout || '');
    const stderr = String(e.stderr || '');
    const message = String(e.message || '');
    const combined = `${stdout}\n${stderr}\n${message}`;
    return {
      ok: Boolean(stdout.trim()) && !looksLikeNcmFailure(combined),
      stdout,
      stderr,
      error: stderr || message || stdout,
    };
  }
}

export async function configureNcmCredentials(appId: string, privateKeyPem: string, _timeout = 10000): Promise<void> {
  const safeAppId = normalizeNcmAppId(appId);
  const safePrivateKey = normalizeNcmPrivateKey(privateKeyPem);
  if (!safeAppId || !safePrivateKey) throw new Error('Invalid NetEase appId or privateKey');

  process.env.NETEASE_APP_ID = safeAppId;
  process.env.NETEASE_PRIVATE_KEY = safePrivateKey;

  const appResult = await runNcmCliAsync(['config', 'set', 'appId', safeAppId], _timeout);
  if (!appResult.ok) throw new Error(appResult.error || 'Failed to configure NetEase appId');

  const keyResult = await runNcmCliAsync(['config', 'set', 'privateKey', '--', safePrivateKey], _timeout);
  if (!keyResult.ok) throw new Error(keyResult.error || 'Failed to configure NetEase privateKey');
}

function tryParse(text: string): any {
  try { return JSON.parse(text); } catch { return null; }
}

export function getNcmPlaybackStateSync(timeout = 8000): any | null {
  const result = runNcmCliSync(['state'], timeout);
  if (!result.ok) return null;
  const parsed = tryParse(result.stdout);
  return parsed?.state || parsed || null;
}

export async function getNcmPlaybackStateAsync(timeout = 8000): Promise<any | null> {
  const result = await runNcmCliAsync(['state'], timeout);
  if (!result.ok) return null;
  const parsed = tryParse(result.stdout);
  return parsed?.state || parsed || null;
}
