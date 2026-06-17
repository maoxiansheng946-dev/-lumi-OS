// LumiOS Unified Server
// / → personal AI OS desktop
// /index.org.html → org workbench (create/manage orgs, legal tools)
import "dotenv/config";

// ── Global exception handlers (must be first — before any async setup) ──
process.on('uncaughtException', (err) => {
  console.error('[FATAL] Uncaught exception:', err.message);
  console.error(err.stack);
  process.exit(1);
});
process.on('unhandledRejection', (reason) => {
  console.error('[FATAL] Unhandled rejection:', reason);
  if (reason instanceof Error) console.error(reason.stack);
  process.exit(1);
});

import { fileURLToPath } from "url";
import path from "path";
import { execFile, execFileSync } from "child_process";
import { promisify } from "util";
import express from "express";
import { createApp } from "./server/runtime/core";
import { createLLMRuntime } from "./server/runtime/llm";
import { mountAllRoutes } from "./server/runtime/routes";
import { initSocketRuntime } from "./server/runtime/socket";
import { setupMcpServer } from "./server/runtime/mcp_server";
import { setupMessaging } from "./server/runtime/messaging";
import { setupStatic } from "./server/runtime/static";
import { bootstrap } from "./server/runtime/bootstrap";
import { lapRoutes } from "./server/lap/routes";
import voiceRoutes from "./routes/voice";
import fileRoutes from "./routes/files";
import { subscriptionRoutes } from "./server/subscription/routes";
import { resolveRole } from "./server/runtime/role";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ROLE = resolveRole();

const { app, server, io, apiRouter, PORT, HOST, JWT_SECRET, getCookieOptions } = createApp();
const llm = createLLMRuntime();

// ── Static serve for lumi_output (charts, images, generated files) ──
app.use('/lumi_output', express.static(path.join(process.cwd(), 'lumi_output')));

// ── Shared routes (both roles) ──
mountAllRoutes({ apiRouter, jwtSecret: JWT_SECRET, llm, getCookieOptions, io });
apiRouter.use("/", voiceRoutes);
apiRouter.use("/", fileRoutes);
apiRouter.use("/", subscriptionRoutes);
apiRouter.use("/", lapRoutes);

// ── NetEase ncm-cli login ──
let ncmLoginPolling: ReturnType<typeof setTimeout> | null = null;
let ncmLoginQrUrl: string | null = null;
let ncmLoginDone = false;
const execFileP = promisify(execFile);

function quoteNcmArg(value: string): string {
  const raw = String(value);
  if (/^[A-Za-z0-9_./:=@-]+$/.test(raw)) return raw;
  return `"${raw.replace(/"/g, '\\"').replace(/([&|<>^%])/g, '^$1')}"`;
}

async function runNcmCli(args: string[], timeout = 15000): Promise<{ stdout: string; stderr: string }> {
  if (process.platform === 'win32') {
    // MSYS2 bash PATH lacks .cmd entries — go through cmd.exe
    const cmdline = ['npx.cmd', '@music163/ncm-cli', ...args].map(quoteNcmArg).join(' ');
    try {
      const stdout = execFileSync('cmd.exe', ['/d', '/c', cmdline], { timeout, windowsHide: true, encoding: 'utf8' });
      return { stdout, stderr: '' };
    } catch (e: any) {
      throw new Error(e.stderr || e.message || String(e));
    }
  }
  const result = await execFileP('npx', ['@music163/ncm-cli', ...args], { timeout, maxBuffer: 1024 * 1024 });
  return { stdout: String(result.stdout || ''), stderr: String(result.stderr || '') };
}

function normalizeNcmAppId(value: unknown): string | null {
  const appId = String(value ?? '').trim();
  return /^\d{1,32}$/.test(appId) ? appId : null;
}

function normalizeNcmPrivateKey(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const privateKey = value.trim();
  if (privateKey.length < 16 || privateKey.length > 12000) return null;
  return privateKey.replace(/\r\n/g, '\n').replace(/\n/g, '\\n');
}

async function checkNcmLoginStatus(timeout = 8000): Promise<boolean> {
  try {
    const check = await runNcmCli(['login', '--check', '--output', 'json'], timeout);
    const data = JSON.parse(check.stdout || '{}');
    ncmLoginDone = Boolean(data.success || data.done || data.loggedIn);
    if (ncmLoginDone) {
      ncmLoginQrUrl = null;
      if (ncmLoginPolling) {
        clearInterval(ncmLoginPolling);
        ncmLoginPolling = null;
      }
    }
  } catch {
    // Keep the last known in-memory state if ncm-cli cannot answer right now.
  }
  return ncmLoginDone;
}

// Configure ncm-cli credentials (appId + privateKey from developer.music.163.com)
apiRouter.post('/ncm/configure', async (req, res) => {
  try {
    const { appId, privateKey } = req.body || {};
    const safeAppId = normalizeNcmAppId(appId);
    const safePrivateKey = normalizeNcmPrivateKey(privateKey);
    if (!safeAppId || !safePrivateKey) {
      return res.json({ success: false, error: 'appId and privateKey are required' });
    }
    await runNcmCli(['config', 'set', 'appId', safeAppId], 10000);
    await runNcmCli(['config', 'set', 'privateKey', safePrivateKey], 10000);
    const { saveKeys } = await import('./server/config/keys');
    saveKeys({ NETEASE_APP_ID: safeAppId, NETEASE_PRIVATE_KEY: safePrivateKey });
    console.log('[NCM] Credentials configured.');
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message || String(e) });
  }
});

apiRouter.get('/ncm/configure/status', async (_req, res) => {
  let hasStoredKeys = false;
  try {
    const { getKey } = await import('./server/config/keys');
    hasStoredKeys = Boolean(normalizeNcmAppId(getKey('NETEASE_APP_ID')) && normalizeNcmPrivateKey(getKey('NETEASE_PRIVATE_KEY')));
    const result = await runNcmCli(['config', 'list'], 8000);
    const stdout = result.stdout || '';
    const hasAppId = stdout.includes('appId:') && !stdout.includes('appId: (未配置)');
    const hasPrivateKey = stdout.includes('privateKey:') && !stdout.includes('privateKey: (未配置)');
    res.json({ configured: (hasAppId && hasPrivateKey) || hasStoredKeys });
  } catch {
    res.json({ configured: hasStoredKeys });
  }
});

apiRouter.post('/ncm/login', async (_req, res) => {
  try {
    if (await checkNcmLoginStatus(8000)) {
      return res.json({ success: true, done: true, qrUrl: null });
    }
    const result = await runNcmCli(['login', '--background', '--output', 'json'], 15000);
    const data = JSON.parse(result.stdout);
    ncmLoginQrUrl = data.qrCodeUrl || data.clickableUrl || null;
    ncmLoginDone = false;

    // Poll login status every 3s
    if (ncmLoginPolling) clearInterval(ncmLoginPolling);
    ncmLoginPolling = setInterval(async () => {
      try {
        await checkNcmLoginStatus(8000);
      } catch {}
    }, 3000);

    res.json({ success: true, qrUrl: ncmLoginQrUrl });
  } catch (e: any) {
    res.json({ success: false, error: e.message || String(e) });
  }
});

// On startup: configure ncm-cli (mpv path + credentials), then check login
(async () => {
  try {
    const fs = await import('fs');

    // Configure mpv player path so ncm-cli can find it
    const mpvPath = process.env.MPV_PATH
      || (fs.existsSync('C:/Program Files/MPV Player/mpv.exe') ? 'C:/Program Files/MPV Player/mpv.exe' : 'mpv');
    await runNcmCli(['config', 'set', 'player', mpvPath], 10000).catch(() => {});
    console.log(`[NCM] Player configured: ${mpvPath}`);

    const { getKey } = await import('./server/config/keys');
    const appId = normalizeNcmAppId(getKey('NETEASE_APP_ID'));
    const privateKey = normalizeNcmPrivateKey(getKey('NETEASE_PRIVATE_KEY'));
    if (appId && privateKey) {
      await runNcmCli(['config', 'set', 'appId', appId], 10000).catch(() => {});
      await runNcmCli(['config', 'set', 'privateKey', privateKey], 10000).catch(() => {});
    }
    if (await checkNcmLoginStatus(10000)) {
      console.log('[NCM] Already logged in from previous session.');
    }
  } catch {}
})();

// ── Auto-detect mpv for ncm-cli playback ──
(async () => {
  const fs = await import('fs');
  try {
    // Check if mpv is already configured
    const { stdout: existingPlayer } = await runNcmCli(['config', 'get', 'player'], 8000);
    if (existingPlayer.includes('mpv') || existingPlayer.includes('orpheus')) {
      console.log('[NCM] Player already configured:', existingPlayer.trim());
      return;
    }
  } catch {
    // config get failed — no player set, detect and configure
  }
  try {
    // Find mpv in PATH or common install locations
    try {
      await execFileP(process.platform === 'win32' ? 'where.exe' : 'which', ['mpv'], { timeout: 5000, windowsHide: true });
      await runNcmCli(['config', 'set', 'player', 'mpv'], 8000);
      console.log('[NCM] Auto-configured player: mpv');
      return;
    } catch {
      // mpv is not in PATH; continue with common install locations.
    }
    // Check common Windows install path
    if (process.platform === 'win32') {
      if (fs.existsSync('C:\\Program Files\\MPV Player\\mpv.exe')) {
        // Add to PATH for current process
        process.env.PATH = (process.env.PATH || '') + ';C:\\Program Files\\MPV Player';
        await runNcmCli(['config', 'set', 'player', 'mpv'], 8000);
        console.log('[NCM] Auto-configured player: mpv (C:\\Program Files\\MPV Player)');
        return;
      }
    }
    console.log('[NCM] mpv not found — music playback unavailable. Install mpv from https://mpv.io');
  } catch (e: any) {
    console.warn('[NCM] Failed to auto-configure player:', e.message || String(e));
  }
})();

apiRouter.get('/ncm/login/status', async (_req, res) => {
  const done = await checkNcmLoginStatus(8000);
  res.json({ done, qrUrl: ncmLoginQrUrl });
});

// ── Org routes ──
// Org routes are always mounted — personal and org coexist at different URLs.
// / → personal desktop, /index.org.html → org workbench.
{
  const { mountOrgRoutes } = await import("./server/org/routes");
  mountOrgRoutes(apiRouter, io);
  const { mountBranchRoutes } = await import("./server/org/main_api");
  const { attachOrgWs } = await import("./server/org/ws_sync");
  mountBranchRoutes(apiRouter);
  attachOrgWs(io);
  console.log('[Org] Routes mounted at /api/org/*');
  console.log('[Org] Branch API mounted at /api/branch/*');
  console.log('[Org] WebSocket sync attached');
}

// ── Infrastructure ──
setupMessaging(apiRouter, llm);
setupMcpServer(app, server, io, llm, path.join(__dirname, 'server'));
initSocketRuntime({ io, jwtSecret: JWT_SECRET, llm });

// Cleanup mpv on exit so music stops when server shuts down
process.on('exit', () => {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill.exe', ['/F', '/IM', 'mpv.exe'], { timeout: 3000, stdio: 'ignore' });
    }
  } catch {}
});
// SIGINT/SIGTERM are handled by bootstrap.ts with proper cleanup + flushDB

async function start() {
  await setupStatic(app, __filename, __dirname, ROLE);
  await bootstrap({ server, io, PORT, HOST, jwtSecret: JWT_SECRET, llm, __dirname });
}

start().catch((err) => {
  console.error('[FATAL] Server startup failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
