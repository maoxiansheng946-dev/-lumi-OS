import path from "path";
import { fileURLToPath } from "url";
import dotenv from "dotenv";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// Walk up from packages/server/src/ to repo root where .env lives (dev mode)
const repoRoot = path.join(__dirname, '..', '..', '..');

// Try multiple locations for .env — bundled desktop app has it alongside server.mjs
function loadEnv() {
  const candidates = [
    path.join(__dirname, '.env'),           // Bundled: dist-server/.env
    path.join(process.cwd(), '.env'),       // CWD fallback
    path.join(repoRoot, '.env'),            // Dev: monorepo root
  ];
  for (const envPath of candidates) {
    if (fs.existsSync(envPath)) {
      const result = dotenv.config({ path: envPath, quiet: true });
      if (!result.error || process.env.JWT_SECRET) break;
    }
  }
  // Fallback: manually parse .env (handles dotenv v17 dotenvx quirks)
  if (!process.env.JWT_SECRET) {
    for (const envPath of candidates) {
      if (!fs.existsSync(envPath)) continue;
      const raw = fs.readFileSync(envPath, 'utf-8');
      for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) continue;
        const eqIdx = trimmed.indexOf('=');
        if (eqIdx === -1) continue;
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) process.env[key] = val;
      }
      if (process.env.JWT_SECRET) break;
    }
  }
}
loadEnv();
import express from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import fs from "fs";
import http from "http";
import { Server } from "socket.io";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { getKey } from "./config/keys";
import { getMessagingConfig } from "./messaging/config";

import { mountSystemRoutes } from "./routes/system_routes";
import { mountAuthRoutes } from "./routes/auth";
import { mountAgentRoutes } from "./routes/agent_routes";
import { mountMemoryRoutes } from "./routes/memory_routes";
import { mountConversationRoutes } from "./routes/conversations";
import { mountSkillRoutes } from "./routes/skill_routes";
import { mountMarketplaceRoutes } from "./routes/marketplace_routes";
import { mountPersonalityRuntime } from "./runtimes/personality";
import { mountMcpAdminRuntime } from "./runtimes/mcp_admin";
import { mountDeviceRuntime } from "./runtimes/device";
import { mountAiChatRuntime } from "./runtimes/ai_chat";
import { mountUserDataRuntime } from "./runtimes/user_data";
import { mountContentRuntime } from "./runtimes/content";

import { deviceRegistry } from "./devices";
import { mcpManager, registerMCPTools } from "./mcp";
import { createLumiMcpServer, handleMcpSSE, handleMcpMessage } from "./mcp/lumi_server";
import { attachMcpWebSocket, connectMcpServerToRemote } from "./mcp/ws_transport";
import { attachLAPWebSocket } from "./lap/transport";
import { lapRoutes } from "./lap/routes";
import { createMessagingRoutes } from "./messaging";
import { subscriptionRoutes } from "./subscription/routes";
import { mountEnterpriseRoutes } from "./enterprise/routes";
import { mountBranchRoutes } from "./enterprise/main_api";
import { attachEnterpriseWs } from "./enterprise/ws_sync";
import { registerAllSocketHandlers } from "./socket/index";
import { bootstrap } from "./startup";
import { toolRegistry } from "./tools/registry";
import { registerUserSocket, unregisterUserSocket } from "./memory";

import voiceRoutes from "./routes/voice";
import fileRoutes from "./routes/files";

const isBundledServer =
  path.basename(process.cwd()).toLowerCase() === "dist-server" ||
  path.basename(__dirname).toLowerCase() === "dist-server";
const isSourceServer =
  __filename.endsWith("index.ts") ||
  process.argv.some(arg => arg.replace(/\\/g, "/").endsWith("/index.ts") || arg === "index.ts");

// JWT_SECRET must survive restarts (login tokens depend on it). If .env didn't
// provide one, check the writable data dir first, then generate a new one.
if (!process.env.JWT_SECRET) {
  try {
    const { getDataDir } = await import('./utils/paths');
    const envFile = path.join(getDataDir(), '.env');
    if (fs.existsSync(envFile)) {
      const content = fs.readFileSync(envFile, 'utf-8');
      const match = content.match(/^JWT_SECRET=(.+)$/m);
      if (match) process.env.JWT_SECRET = match[1].trim();
    }
  } catch {}
}
if (!process.env.JWT_SECRET) {
  const crypto = await import('crypto');
  const generated = crypto.randomBytes(32).toString('hex');
  process.env.JWT_SECRET = generated;
  // Persist to writable data directory so it survives restarts
  try {
    const { getDataDir } = await import('./utils/paths');
    const envFile = path.join(getDataDir(), '.env');
    fs.appendFileSync(envFile, `JWT_SECRET=${generated}\n`);
    console.log('[Server] Generated new JWT_SECRET — persisted to data dir');
  } catch (e: any) {
    console.warn('[Server] Could not persist JWT_SECRET to data dir:', e.message);
  }
}
const JWT_SECRET = process.env.JWT_SECRET!;

// LLM provider getters (lazy init)
let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;
let gemini: GoogleGenerativeAI | null = null;
let deepseek: OpenAI | null = null;
let qwen: OpenAI | null = null;

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY || getKey('OPENAI_API_KEY');
  if (!openai && key) openai = new OpenAI({ apiKey: key });
  return openai;
}
function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY || getKey('ANTHROPIC_API_KEY');
  if (!anthropic && key) anthropic = new Anthropic({ apiKey: key });
  return anthropic;
}
function getGemini() {
  if (!gemini) {
    const key = process.env.GEMINI_API_KEY || getKey('GEMINI_API_KEY');
    if (key && key !== "undefined" && key !== "null" && key.length > 0) {
      gemini = new GoogleGenerativeAI(key);
    }
  }
  return gemini;
}
function getDeepSeek() {
  const key = process.env.DEEPSEEK_API_KEY || getKey('DEEPSEEK_API_KEY');
  if (!deepseek && key) {
    deepseek = new OpenAI({ apiKey: key, baseURL: "https://api.deepseek.com" });
  }
  return deepseek;
}
function getQwen() {
  if (!qwen) {
    const key = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || getKey('DASHSCOPE_API_KEY') || getKey('QWEN_API_KEY');
    if (key) {
      qwen = new OpenAI({ apiKey: key, baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" });
    }
  }
  return qwen;
}

const llmGetters = { getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen };

const ALLOWED_ORIGINS = ['http://localhost:3000', 'http://127.0.0.1:3000', 'http://localhost:5173', 'http://localhost:5174', 'http://127.0.0.1:5173', 'http://127.0.0.1:5174', 'https://lumiai.asia', 'tauri://localhost', 'https://tauri.localhost'];

// Express + HTTP + Socket.IO
const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ALLOWED_ORIGINS,
    methods: ["GET", "POST"],
    credentials: true
  }
});

const PORT = 3000;
const HOST = process.env.HOST || (process.env.LUMI_DESKTOP === "1" ? "127.0.0.1" : "0.0.0.0");

// Middleware
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// API Router
const apiRouter = express.Router();
apiRouter.use((_req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});
apiRouter.use((req, _res, next) => {
  console.log(`[API] ${req.method} ${req.path}`);
  next();
});
app.use("/api", apiRouter);

// Authentication helper
const getCookieOptions = (): { httpOnly: true; secure: true; sameSite: "none"; maxAge: number } => ({
  httpOnly: true, secure: true, sameSite: "none", maxAge: 24 * 60 * 60 * 1000,
});

// ── Mount all runtime modules ──

// 1. Personality
mountPersonalityRuntime(apiRouter, { jwtSecret: JWT_SECRET, ...llmGetters });

// 2. System routes (health, tools, llm/usage, providers, settings/keys, etc.)
mountSystemRoutes(apiRouter, JWT_SECRET);

// 3. MCP admin (config, health, restart, remote devices, GitHub/NPM search)
mountMcpAdminRuntime(apiRouter);

// 4. Device pairing + listing
mountDeviceRuntime(apiRouter, JWT_SECRET);

// 5. Auth
mountAuthRoutes(apiRouter, JWT_SECRET, getCookieOptions);

// 6. Agent routes (distill, sanctuaries, history, audio/transcribe, pets/generate)
mountAgentRoutes(apiRouter, JWT_SECRET, llmGetters);

// 7. AI Chat (the big one)
mountAiChatRuntime(apiRouter, { jwtSecret: JWT_SECRET, ...llmGetters });

// 8. Memory routes
mountMemoryRoutes(apiRouter, JWT_SECRET, llmGetters);

// 9. Conversation routes
mountConversationRoutes(apiRouter, JWT_SECRET);

// 10. User data (pet preferences, interactions)
mountUserDataRuntime(apiRouter, JWT_SECRET);

// 11. Skill routes
mountSkillRoutes(apiRouter, JWT_SECRET, llmGetters, io);

// 12. Marketplace routes
mountMarketplaceRoutes(apiRouter, JWT_SECRET, io);

// 13. Content (ecosystem stats, modules/products, modules/docs)
mountContentRuntime(apiRouter);

// 14. Subscription (plans, status, tokens)
apiRouter.use("/", subscriptionRoutes);

// 15. Voice + File routes
apiRouter.use("/", voiceRoutes);
apiRouter.use("/", fileRoutes);

  // 16. LAP REST routes
  apiRouter.use("/", lapRoutes);

// ── Messaging (Feishu) ──
const feishuCfg = getMessagingConfig().feishu;
if (feishuCfg.appId && feishuCfg.appSecret) {
  apiRouter.use("/", createMessagingRoutes(feishuCfg, {
    llmGetters,
    personalityRegistry: (await import("./personality")).personalityRegistry,
    queryMemories: (await import("./memory")).queryMemories,
    loadEmotionalState: (await import("./personality/state")).loadEmotionalState,
  }));
  console.log('[Feishu] Messaging routes mounted at /api/feishu/*');
} else {
  console.log('[Feishu] Not configured — set FEISHU_APP_ID and FEISHU_APP_SECRET in .env');
}

// ── Enterprise routes ──
if (process.env.LUMI_MODE === 'enterprise') {
  mountEnterpriseRoutes(apiRouter, io);
  mountBranchRoutes(apiRouter);
  attachEnterpriseWs(io);
  console.log('[Enterprise] Routes mounted');
}

// ── MCP Server (Lumi as MCP server for remote devices) ──
const lumiMcp = createLumiMcpServer(llmGetters, toolRegistry, (event, data) => io.emit(event, data));
app.get('/mcp/sse', (req, res) => handleMcpSSE(lumiMcp, req, res));
app.post('/mcp/message', (req, res) => handleMcpMessage(req, res));

// MCP WebSocket transport
attachMcpWebSocket(server, async (transport) => {
  try {
    await lumiMcp.connect(transport);
    console.log(`[MCP Server] WebSocket client connected: ${transport.sessionId}`);
  } catch (err: any) {
    console.error(`[MCP Server] WebSocket connection error:`, err.message);
  }
});
console.log('[MCP Server] Lumi MCP server ready at /mcp/sse + /mcp/ws');

// LAP WebSocket
attachLAPWebSocket(server);
console.log('[LAP] Agent protocol ready at /lap');

// Connect to remote devices
const mcpConfigPath = path.join(__dirname, 'mcp', 'config.json');
if (fs.existsSync(mcpConfigPath)) {
  const mcpConfig = JSON.parse(fs.readFileSync(mcpConfigPath, 'utf-8'));
  if (mcpConfig.remoteDevices) {
    for (const [name, url] of Object.entries(mcpConfig.remoteDevices)) {
      console.log(`[MCP Server] Connecting to remote device: ${name}`);
      connectMcpServerToRemote(
        url as string, lumiMcp, name as string,
        (sessionId) => { deviceRegistry.registerMcpDevice(name as string, 'mcp_remote', { audio: true, video: false, spatial: false, haptic: false, holographic: false }); },
        () => { deviceRegistry.unregisterMcpDevice(name as string); },
      );
    }
  }
}

// ── Static / Vite ──
const isProduction = process.env.NODE_ENV === "production" ||
                      isBundledServer ||
                      (!isSourceServer && process.env.NODE_ENV !== "development" && fs.existsSync(path.join(repoRoot, "packages", "web", "dist")));

// Serve landing page assets + download page
const landingDist = path.join(repoRoot, 'packages', 'landing', 'dist');
if (fs.existsSync(landingDist)) {
  app.use('/_astro', express.static(path.join(landingDist, '_astro')));
  const downloadPage = path.join(landingDist, 'download', 'index.html');
  if (fs.existsSync(downloadPage)) {
    app.get('/download', (_req, res) => res.sendFile(downloadPage));
  }
}

if (!isProduction) {
  // Web frontend served by Vite middleware
  const webRoot = path.join(repoRoot, 'packages', 'web');
  if (fs.existsSync(path.join(webRoot, 'index.html'))) {
    console.log(`Starting in DEVELOPMENT mode (Vite + API) — web root: ${webRoot}`);
    const { createServer: createViteServer } = await import("vite");
    const vite = await createViteServer({ root: webRoot, server: { middlewareMode: true }, appType: "spa" });
    app.use(vite.middlewares);
  } else {
    console.log("Starting in DEVELOPMENT mode (API-only) — no web frontend found");
    app.get("/", (_req, res) => {
      res.json({ status: "LumiOS API", mode: "development", frontends: { web: "http://localhost:5173", desktop: "http://localhost:5174" } });
    });
  }
} else {
  console.log("Starting in PRODUCTION mode (Static)...");
  const distPath = fs.existsSync(path.join(repoRoot, "packages", "web", "dist"))
    ? path.join(repoRoot, "packages", "web", "dist")
    : path.join(process.cwd(), "dist");
  app.use("/api/*", (_req, res) => { res.status(404).json({ error: "API route not found" }); });
  app.get("*", (_req, res) => { res.sendFile(path.join(distPath, "index.html")); });
}

// ── Socket.IO ──
registerAllSocketHandlers(io, {
  jwtSecret: JWT_SECRET,
  deviceRegistry,
  llmGetters,
  registerUserSocket,
  unregisterUserSocket,
});

// ── Global error handler ──
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Express] Unhandled error:', err?.message || err);
  res.status(500).json({ error: err?.message || 'Internal server error' });
});

// ── Bootstrap & Start ──
await bootstrap(io, { llmGetters });

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
