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

async function start() {
  await setupStatic(app, __filename, __dirname, ROLE);
  await bootstrap({ server, io, PORT, HOST, jwtSecret: JWT_SECRET, llm, __dirname });
}

start().catch((err) => {
  console.error('[FATAL] Server startup failed:', err.message);
  console.error(err.stack);
  process.exit(1);
});
