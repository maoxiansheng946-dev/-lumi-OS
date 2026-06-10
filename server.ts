// LumiOS Unified Server
// LUMI_ROLE=personal (default) → personal AI OS
// LUMI_ROLE=org         → org server with org management
// A personal instance can upgrade: create org → restart with LUMI_ROLE=org
import "dotenv/config";
import { fileURLToPath } from "url";
import path from "path";
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

// On startup: restore ncm-cli credentials from stored keys, then check login
(async () => {
  try {
    const { getKey } = await import('./server/config/keys');
    const appId = getKey('NETEASE_APP_ID');
    const privateKey = getKey('NETEASE_PRIVATE_KEY');
    if (appId && privateKey) {
      const { exec } = await import('child_process');
      const { promisify } = await import('util');
      const execP = promisify(exec);
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

apiRouter.get('/ncm/login/status', (_req, res) => {
  res.json({ done: ncmLoginDone, qrUrl: ncmLoginQrUrl });
});

// ── Org routes ──
// Org creation is always available (personal→org upgrade path).
// Full org routes mount only when ROLE=org.
{
  const { mountOrgRoutes } = await import("./server/org/routes");
  mountOrgRoutes(apiRouter, io); // POST /org/org always works
  if (ROLE === 'org') {
    const { mountBranchRoutes } = await import("./server/org/main_api");
    const { attachOrgWs } = await import("./server/org/ws_sync");
    mountBranchRoutes(apiRouter);
    attachOrgWs(io);
    console.log('[Org] Routes mounted at /api/org/*');
    console.log('[Org] Branch API mounted at /api/branch/*');
    console.log('[Org] WebSocket sync attached');
  }
}

// ── Infrastructure ──
setupMessaging(apiRouter, llm);
setupMcpServer(app, server, io, llm, path.join(__dirname, 'server'));
initSocketRuntime({ io, jwtSecret: JWT_SECRET, llm });

// Org: redirect root to workbench; personal: root to web app
if (ROLE === 'org') {
  app.get('/', (_req, res) => res.redirect('/index.org.html'));
}

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
