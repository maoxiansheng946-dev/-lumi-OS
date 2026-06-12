// LumiOS Unified Server
// / → personal AI OS desktop
// /index.org.html → org workbench (create/manage orgs, legal tools)
import "dotenv/config";
import { fileURLToPath } from "url";
import path from "path";
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

// Configure ncm-cli credentials (appId + privateKey from developer.music.163.com)
apiRouter.post('/ncm/configure', async (req, res) => {
  try {
    const { appId, privateKey } = req.body || {};
    if (!appId?.trim() || !privateKey?.trim()) {
      return res.json({ success: false, error: 'appId and privateKey are required' });
    }
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execP = promisify(exec);
    await execP(`npx @music163/ncm-cli config set appId "${appId.trim()}"`, { timeout: 10000 });
    await execP(`npx @music163/ncm-cli config set privateKey "${privateKey.trim().replace(/\n/g, '\\n')}"`, { timeout: 10000 });
    console.log('[NCM] Credentials configured.');
    res.json({ success: true });
  } catch (e: any) {
    res.json({ success: false, error: e.message || String(e) });
  }
});

apiRouter.get('/ncm/configure/status', async (_req, res) => {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execP = promisify(exec);
    const result = await execP('npx @music163/ncm-cli config list', { timeout: 8000 });
    const stdout = result.stdout || '';
    const hasAppId = stdout.includes('appId:') && !stdout.includes('appId: (未配置)');
    const hasPrivateKey = stdout.includes('privateKey:') && !stdout.includes('privateKey: (未配置)');
    res.json({ configured: hasAppId && hasPrivateKey });
  } catch {
    res.json({ configured: false });
  }
});

apiRouter.post('/ncm/login', async (_req, res) => {
  try {
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execP = promisify(exec);
    const result = await execP('npx @music163/ncm-cli login --background --output json', { timeout: 15000 });
    const data = JSON.parse(result.stdout);
    ncmLoginQrUrl = data.qrCodeUrl || data.clickableUrl || null;
    ncmLoginDone = false;

    // Poll login status every 3s
    if (ncmLoginPolling) clearInterval(ncmLoginPolling);
    ncmLoginPolling = setInterval(async () => {
      try {
        const check = await execP('npx @music163/ncm-cli login --check --output json', { timeout: 8000 });
        const cd = JSON.parse(check.stdout);
        if (cd.success) {
          ncmLoginDone = true;
          ncmLoginQrUrl = null;
          if (ncmLoginPolling) { clearInterval(ncmLoginPolling); ncmLoginPolling = null; }
        }
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
    const { exec } = await import('child_process');
    const { promisify } = await import('util');
    const execP = promisify(exec);
    const fs = await import('fs');

    // Configure mpv player path so ncm-cli can find it
    const mpvPath = process.env.MPV_PATH
      || (fs.existsSync('C:/Program Files/MPV Player/mpv.exe') ? 'C:/Program Files/MPV Player/mpv.exe' : 'mpv');
    await execP(`npx @music163/ncm-cli config set player "${mpvPath}"`, { timeout: 10000 }).catch(() => {});
    console.log(`[NCM] Player configured: ${mpvPath}`);

    const { getKey } = await import('./server/config/keys');
    const appId = getKey('NETEASE_APP_ID');
    const privateKey = getKey('NETEASE_PRIVATE_KEY');
    if (appId && privateKey) {
      await execP(`npx @music163/ncm-cli config set appId "${appId}"`, { timeout: 10000 }).catch(() => {});
      await execP(`npx @music163/ncm-cli config set privateKey "${privateKey.replace(/\n/g, '\\n')}"`, { timeout: 10000 }).catch(() => {});
      const check = await execP('npx @music163/ncm-cli login --check --output json', { timeout: 10000 });
      const data = JSON.parse(check.stdout);
      if (data.success) {
        ncmLoginDone = true;
        console.log('[NCM] Already logged in from previous session.');
      }
    }
  } catch {}
})();

// ── Auto-detect mpv for ncm-cli playback ──
(async () => {
  const { exec: execCb } = await import('child_process');
  const { promisify: utilPromisify } = await import('util');
  const execP = utilPromisify(execCb);
  try {
    // Check if mpv is already configured
    const { stdout: existingPlayer } = await execP('npx @music163/ncm-cli config get player', { timeout: 8000 });
    if (existingPlayer.includes('mpv') || existingPlayer.includes('orpheus')) {
      console.log('[NCM] Player already configured:', existingPlayer.trim());
      return;
    }
  } catch {
    // config get failed — no player set, detect and configure
  }
  try {
    // Find mpv in PATH or common install locations
    const { stdout: whichOut } = await execP(process.platform === 'win32' ? 'where mpv 2>nul || echo NOT_FOUND' : 'which mpv 2>/dev/null || echo NOT_FOUND', { timeout: 5000 });
    if (!whichOut.includes('NOT_FOUND')) {
      await execP('npx @music163/ncm-cli config set player mpv', { timeout: 8000 });
      console.log('[NCM] Auto-configured player: mpv');
      return;
    }
    // Check common Windows install path
    if (process.platform === 'win32') {
      const { stdout: checkPath } = await execP('dir "C:\\Program Files\\MPV Player\\mpv.exe" 2>nul && echo FOUND || echo NOT_FOUND', { timeout: 5000 });
      if (checkPath.includes('FOUND')) {
        // Add to PATH for current process
        process.env.PATH = (process.env.PATH || '') + ';C:\\Program Files\\MPV Player';
        await execP('npx @music163/ncm-cli config set player mpv', { timeout: 8000 });
        console.log('[NCM] Auto-configured player: mpv (C:\\Program Files\\MPV Player)');
        return;
      }
    }
    console.log('[NCM] mpv not found — music playback unavailable. Install mpv from https://mpv.io');
  } catch (e: any) {
    console.warn('[NCM] Failed to auto-configure player:', e.message || String(e));
  }
})();

apiRouter.get('/ncm/login/status', (_req, res) => {
  res.json({ done: ncmLoginDone, qrUrl: ncmLoginQrUrl });
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

// ── Global exception handlers (must be registered first) ──
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

// Cleanup mpv on exit so music stops when server shuts down
process.on('exit', () => {
  try { require('child_process').execSync('taskkill //F //IM "mpv.exe"', { timeout: 3000, stdio: 'ignore' }); } catch {}
});
process.on('SIGINT', () => process.exit());
process.on('SIGTERM', () => process.exit());

async function start() {
  await setupStatic(app, __filename, __dirname, ROLE);
  await bootstrap({ server, io, PORT, HOST, jwtSecret: JWT_SECRET, llm, __dirname });
}

start().catch((err) => {
  console.error('[FATAL] Server startup failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
