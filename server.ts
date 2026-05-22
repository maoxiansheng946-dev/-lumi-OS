import "dotenv/config";
import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import cors from "cors";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import bcrypt from "bcryptjs";
import fs from "fs";
import os from "os";
import { spawn, ChildProcess } from "child_process";
import { Server } from "socket.io";
import http from "http";
import { readDB, writeDB, ensureDatabaseInitialized, isDbDirty } from "./db_layer";
import { getOrCreateActiveConversation, closeConversation, getActiveConversation, getUserConversations, addMessage, getMessages } from "./server/conversation/manager";
import { logger } from "./logger";
import { createStreamingSession, getActiveSTTProvider } from "./server/stt/adapter";

import { synthesizeSpeech, getActiveProvider as getTTSProvider } from "./server/tts/adapter";
import { makeLLMCall, makeLLMCallStreaming, NormalizedMessage } from "./server/llm/providers";
import { runWithTools } from "./server/llm/adapter";
import { checkLLMAccess, recordUsage, estimateTokens } from "./server/subscription/proxy";
import { toolRegistry } from "./server/tools/registry";
import { registerAllTools } from "./server/tools/definitions/index";
import { queryMemories, addMemory, removeMemory, formatMemoriesForContext, extractMemories, addReminder, fireReminder, runBehavioralAnalysis, getUnconsolidatedEpisodic, markConsolidated, initMemorySync, registerUserSocket, unregisterUserSocket, broadcastMemoryChange, broadcastPreferenceChange, initMemoryAssociations } from "./server/memory";
import { consolidateEpisodic, selfReflect, ConsolidationContext } from "./server/memory/consolidator";
import { personalityRegistry } from "./server/personality";
import { evolvePersonality } from "./server/personality/evolution";
import { loadEmotionalState, saveEmotionalState, updateEmotionalState } from "./server/personality/state";
import { mcpManager, registerMCPTools, getMCPConfig, updateMCPConfig, SKILLS_DIR } from "./server/mcp";
import { createLumiMcpServer, handleMcpSSE, handleMcpMessage } from "./server/mcp/lumi_server";
import { attachMcpWebSocket, connectMcpServerToRemote } from "./server/mcp/ws_transport";
import { attachLAPWebSocket } from "./server/lap/transport";
import { lapRoutes } from "./server/lap/routes";
import { createMessagingRoutes } from "./server/messaging";
import { mountEnterpriseRoutes } from "./server/enterprise/routes";
import { mountBranchRoutes } from "./server/enterprise/main_api";
import { attachEnterpriseWs } from "./server/enterprise/ws_sync";
import { generateSkill, autoGenerateSkill } from "./server/skills/generator";
import { getRecentWorkflows, clearWorkflows } from "./server/skills/worklog";
import { scheduler, registerScheduledTasks } from "./server/scheduler";
import { deviceRegistry } from "./server/devices";
import { fuseContext, formatContextForPrompt, type RawModalityInput } from "./server/context/fusion";
import { pushActivityEvent, setIdleState, getIdleState, getLastEvent } from "./server/context/activity_stream";
import { detectClipboardChange } from "./server/context/clipboard_monitor";
import { processActivityEvent } from "./server/context/proactive_triggers";
import { canOutputHolographic, textToHolographicOutput } from "./server/output/holographic";
import type { SensoryContext } from "./server/personality/types";
import voiceRoutes from "./routes/voice";
import fileRoutes from "./routes/files";
import { mountAuthRoutes } from "./server/routes/auth";
import { mountMemoryRoutes } from "./server/routes/memory_routes";
import { mountConversationRoutes } from "./server/routes/conversations";
import { mountAgentRoutes } from "./server/routes/agent_routes";
import { setOnAgentPromoted } from "./server/agents/orchestrator";
import { mountSkillRoutes } from "./server/routes/skill_routes";
import { mountMarketplaceRoutes } from "./server/routes/marketplace_routes";
import { mountSystemRoutes } from "./server/routes/system_routes";
import { registerChatHandler } from "./server/socket/chat";
import { registerTaskHandler } from "./server/socket/task";
import { registerVoiceHandlers, isEchoText, isTtsPlaying } from "./server/socket/voice";
import { createWakeDetector, isWakeWord } from "./server/stt/wake_detector";
import { getSensory, perceptionEvents, MAX_PERCEPTION_EVENTS } from "./server/socket/shared";
import { loadKeys, saveKeys, getKey, getAllKeyNames } from "./server/config/keys";
import { getLatencyStats, recordLatency } from "./server/monitor/latency_store";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isBundledServer =
  path.basename(process.cwd()).toLowerCase() === "dist-server" ||
  path.basename(__dirname).toLowerCase() === "dist-server";
const isSourceServer =
  __filename.endsWith("server.ts") ||
  process.argv.some(arg => arg.replace(/\\/g, "/").endsWith("/server.ts") || arg === "server.ts");

const asyncHandler = (fn: (req: express.Request, res: express.Response, next?: express.NextFunction) => Promise<any>) =>
  (req: express.Request, res: express.Response, next: express.NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://lumiai.asia', 'tauri://localhost'],
    methods: ["GET", "POST"],
    credentials: true
  }
});
const PORT = 3000;
const HOST = process.env.HOST || (process.env.LUMI_DESKTOP === "1" ? "127.0.0.1" : "0.0.0.0");

// Initialize AI clients lazily
let openai: OpenAI | null = null;
let anthropic: Anthropic | null = null;
let gemini: GoogleGenerativeAI | null = null;
let deepseek: OpenAI | null = null;
let qwen: OpenAI | null = null;

function getOpenAI() {
  const key = process.env.OPENAI_API_KEY || getKey('OPENAI_API_KEY');
  if (!openai && key) {
    openai = new OpenAI({ apiKey: key });
  }
  return openai;
}

function getAnthropic() {
  const key = process.env.ANTHROPIC_API_KEY || getKey('ANTHROPIC_API_KEY');
  if (!anthropic && key) {
    anthropic = new Anthropic({ apiKey: key });
  }
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
    deepseek = new OpenAI({
      apiKey: key,
      baseURL: "https://api.deepseek.com"
    });
  }
  return deepseek;
}

function getQwen() {
  if (!qwen) {
    const key = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || getKey('DASHSCOPE_API_KEY') || getKey('QWEN_API_KEY');
    if (key) {
      qwen = new OpenAI({
        apiKey: key,
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
      });
    }
  }
  return qwen;
}

// Allow credentials from any origin (Tauri webview, localhost, etc.)
// origin: true reflects the request origin, which is compatible with credentials: true
app.use(cors({ origin: ['http://localhost:3000', 'http://127.0.0.1:3000', 'https://lumiai.asia', 'tauri://localhost'], credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(cookieParser());

// --- API Routes ---
const apiRouter = express.Router();

// Ensure UTF-8 for API responses
apiRouter.use((req, res, next) => {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  next();
});

// Middleware to log API requests for debugging
apiRouter.use((req, res, next) => {
  console.log(`[API_ROUTER] ${req.method} ${req.path}`);
  next();
});

// Mount API router early to ensure it catches requests before static/Vite middleware
app.use("/api", apiRouter);

// Global error handler for async route rejections
app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[Express] Unhandled error:', err?.message || err);
  res.status(500).json({ error: err?.message || 'Internal server error' });
});

const JWT_SECRET = process.env.JWT_SECRET;

// Serialize personality file writes to prevent concurrent overwrites
// SameSite=None requires Secure (Chromium silently rejects otherwise).
// Chromium allows Secure cookies on localhost/127.0.0.1, so safe to always enable.
const getCookieOptions = (): { httpOnly: true; secure: true; sameSite: "none"; maxAge: number } => ({
  httpOnly: true,
  secure: true,
  sameSite: "none",
  maxAge: 24 * 60 * 60 * 1000,
});

// Lumi core personality config (read-only — evolution drives changes, not manual editing)
apiRouter.get("/personalities", (_req, res) => {
  const lumi = personalityRegistry.get('lumi');
  res.json([lumi]);
});

apiRouter.get("/personalities/:id", (req, res) => {
  const config = personalityRegistry.get(req.params.id);
  if (!config) return res.status(404).json({ error: "Personality not found" });
  res.json(config);
});

apiRouter.get("/personality/:id/evolution", (req, res) => {
  const config = personalityRegistry.get(req.params.id);
  if (!config) return res.status(404).json({ error: "Personality not found" });
  const history = personalityRegistry.getEvolutionHistory(req.params.id);
  const evolutionConfig = personalityRegistry.getEvolutionConfig(req.params.id);
  res.json({
    personalityId: req.params.id,
    currentVector: config.personalityVector || null,
    version: config.version,
    evolutionConfig,
    history,
  });
});

// Growth journal — retrieve daily/weekly auto-generated summaries of what Lumi learned
apiRouter.get("/personality/:id/growth-journal", (req, res) => {
  try {
    const token = req.cookies.token;
    let uid = 'anonymous';
    if (token) {
      try { const decoded: any = jwt.verify(token, JWT_SECRET); uid = decoded.uid; } catch {}
    }

    const db = readDB();
    const limit = parseInt(req.query.limit as string) || 14;

    // Query memories with growth_journal keyword
    const journalEntries = (db.memories || [])
      .filter((m: any) =>
        m.userId === uid &&
        m.keywords?.includes('growth_journal') &&
        m.type === 'knowledge'
      )
      .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, limit)
      .map((m: any) => ({
        id: m.id,
        content: m.content,
        date: m.createdAt?.slice(0, 10) || '',
        tier: m.tier,
      }));

    // Also fetch structured data entries
    const dataEntries = (db.memories || [])
      .filter((m: any) =>
        m.userId === uid &&
        m.keywords?.includes('growth_journal_data')
      )
      .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .slice(0, limit)
      .map((m: any) => {
        try {
          return { id: m.id, date: m.createdAt?.slice(0, 10) || '', data: JSON.parse(m.content) };
        } catch {
          return { id: m.id, date: m.createdAt?.slice(0, 10) || '', data: null };
        }
      });

    res.json({
      personalityId: req.params.id,
      journalEntries,
      statsEntries: dataEntries,
      count: journalEntries.length,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Personality evolution — manually trigger evolution for a personality
apiRouter.post("/personality/:id/evolve", asyncHandler(async (req, res) => {
  try {
    const config = personalityRegistry.get(req.params.id);
    if (!config) return res.status(404).json({ error: "Personality not found" });

    const token = req.cookies.token;
    let uid = 'anonymous';
    if (token) {
      try { const decoded: any = jwt.verify(token, JWT_SECRET); uid = decoded.uid; } catch {}
    }

    const emotionalState = loadEmotionalState(uid);
    const evolutionConfig = personalityRegistry.getEvolutionConfig(req.params.id);

    const step = await evolvePersonality(
      config,
      uid,
      emotionalState.connection,
      getDeepSeek,
      getGemini,
      getOpenAI,
      getAnthropic,
      getQwen,
      evolutionConfig,
    );

    if (!step) {
      return res.json({ evolved: false, reason: 'Evolution not needed or not ready. Check evolution config cooldown, connection score, and memory count.' });
    }

    const updated = personalityRegistry.applyEvolution(req.params.id, step);
    res.json({ evolved: true, version: step.version, narrative: step.narrative, mutations: step.mutations.length, config: updated });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

// 0.2. MCP management
apiRouter.get("/mcp", (_req, res) => {
  const config = getMCPConfig();
  const connected = mcpManager.getConnectedServers();
  const servers = Object.entries(config).map(([name, cfg]) => ({
    name,
    ...cfg,
    connected: connected.includes(name),
  }));
  res.json({ servers });
});

apiRouter.post("/mcp", async (req, res) => {
  try {
    const { servers } = req.body;
    if (!servers || typeof servers !== 'object') {
      return res.status(400).json({ error: 'Invalid servers config' });
    }
    const registered = await updateMCPConfig(servers);
    res.json({ registered, count: registered.length });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.post("/mcp/restart/:name", async (req, res) => {
  try {
    const tools = await mcpManager.restartServer(req.params.name);
    res.json({ tools });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Remote device MCP endpoints (xiaozhi, etc.) — devices that connect to Lumi as MCP client
apiRouter.get("/remote-devices", (_req, res) => {
  try {
    const configPath = path.join(__dirname, 'server', 'mcp', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    res.json({ devices: config.remoteDevices || {} });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

apiRouter.put("/remote-devices", (req, res) => {
  try {
    const { devices } = req.body;
    if (!devices || typeof devices !== 'object') {
      return res.status(400).json({ error: 'Invalid devices config' });
    }
    const configPath = path.join(__dirname, 'server', 'mcp', 'config.json');
    const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
    config.remoteDevices = devices;
    fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
    res.json({ success: true, devices: config.remoteDevices });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// GitHub MCP server search — proxy GitHub API for community MCP servers
apiRouter.get("/mcp/github/search", async (req, res) => {
  try {
    const q = (req.query.q as string) || 'MCP server';
    const response = await fetch(
      `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}+topic:mcp&sort=stars&order=desc&per_page=20`,
      {
        headers: {
          'Accept': 'application/vnd.github.v3+json',
          'User-Agent': 'LumiOS-MCP-Browser',
          ...(process.env.GITHUB_TOKEN ? { Authorization: `Bearer ${process.env.GITHUB_TOKEN}` } : {}),
        },
      }
    );
    if (!response.ok) {
      return res.status(response.status).json({ error: `GitHub API error: ${response.statusText}` });
    }
    const data = await response.json();
    const results = (data.items || []).map((item: any) => ({
      id: item.id,
      name: item.full_name,
      description: item.description,
      stars: item.stargazers_count,
      url: item.html_url,
      topics: item.topics || [],
      language: item.language,
      updatedAt: item.updated_at,
    }));
    res.json({ results, total: data.total_count || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// npm MCP package search — proxy npm registry for lumi-skill-* / mcp-* packages
apiRouter.get("/mcp/npm/search", async (req, res) => {
  try {
    const q = (req.query.q as string) || 'mcp';
    const response = await fetch(
      `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}+keywords:mcp&size=20`,
      {
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LumiOS-MCP-Browser',
        },
      }
    );
    if (!response.ok) {
      return res.status(response.status).json({ error: `npm API error: ${response.statusText}` });
    }
    const data = await response.json();
    const results = (data.objects || []).map((obj: any) => {
      const pkg = obj.package || {};
      return {
        id: pkg.name,
        name: pkg.name,
        description: pkg.description || '',
        stars: 0,
        url: pkg.links?.npm || `https://www.npmjs.com/package/${pkg.name}`,
        topics: pkg.keywords || [],
        language: 'npm',
        updatedAt: pkg.date || '',
      };
    });
    res.json({ results, total: data.total || 0 });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// 0.3. Device management
apiRouter.post("/devices/pair", (req, res) => {
  const { deviceId } = req.body || {};
  if (!deviceId) return res.status(400).json({ error: "deviceId required" });
  res.json({ success: true, paired: deviceId, timestamp: new Date().toISOString() });
});

apiRouter.get("/devices", (req, res) => {
  const token = req.cookies.token;
  let userId = '';
  try {
    if (token) {
      const decoded: any = jwt.verify(token, JWT_SECRET);
      userId = decoded.uid;
    }
  } catch { /* token invalid, continue without auth */ }

  const userDevices = userId ? deviceRegistry.getUserDevices(userId) : [];
  const mcpDevices = deviceRegistry.getMcpDevices();
  const devices = [...userDevices, ...mcpDevices];
  const sensory = userId ? deviceRegistry.getSensoryContext(userId) : { hasAudio: false, hasVideo: false, hasSpatial: false, hasHaptic: false, hasHolographic: false, activeDeviceTypes: [], deviceCount: mcpDevices.length };
  res.json({ devices, sensoryContext: sensory });
});

// 0.4 System routes (health, tools, scheduler, llm/usage, llm/providers, llm/test, settings/keys, system/stats, monitor/latency)
mountSystemRoutes(apiRouter, JWT_SECRET);

// 0.4. Health Check
apiRouter.get("/health", (req, res) => {
  try {
    const db = readDB();
    res.json({
      status: isDbDirty() ? "degraded" : "ok",
      timestamp: new Date().toISOString(),
      database: {
        users: db.users.length,
        agents: db.agents.length,
        interactions: db.interactions.length,
        dirty: isDbDirty(),
      }
    });
  } catch (error: any) {
    logger.error("Health check failed", error);
    res.status(500).json({ error: error.message });
  }
});

// 0.4 Tool list for security config
apiRouter.get("/tools", (_req, res) => {
  const tools = toolRegistry.list().map(t => ({
    name: t.name,
    description: t.description.slice(0, 80),
    permission: t.permission,
    securityLevel: t.securityLevel,
  }));
  res.json(tools);
});

apiRouter.get("/scheduler/tasks", (_req, res) => {
  res.json({ tasks: scheduler.listTasks() });
});

// 0.45 Token usage aggregation
apiRouter.get("/llm/usage", (req, res) => {
  let token = req.cookies.token;
  // Fallback: WebView2 may not send httpOnly cookies, check Authorization header
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const days = parseInt(req.query.days as string) || 30;
    const providerFilter = req.query.provider as string | undefined;
    const db = readDB();
    const allUsage: any[] = db.tokenUsage || [];
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();

    const filtered = allUsage.filter((u: any) =>
      (u.userId === decoded.uid || u.userId === 'anonymous') &&
      u.timestamp >= cutoff &&
      (!providerFilter || u.provider === providerFilter)
    );

    // Per-provider totals
    const byProvider: Record<string, { promptTokens: number; completionTokens: number; totalTokens: number; calls: number }> = {};
    const dailyMap: Record<string, { promptTokens: number; completionTokens: number; totalTokens: number }> = {};

    for (const u of filtered) {
      if (!byProvider[u.provider]) {
        byProvider[u.provider] = { promptTokens: 0, completionTokens: 0, totalTokens: 0, calls: 0 };
      }
      byProvider[u.provider].promptTokens += u.promptTokens || 0;
      byProvider[u.provider].completionTokens += u.completionTokens || 0;
      byProvider[u.provider].totalTokens += u.totalTokens || 0;
      byProvider[u.provider].calls += 1;

      const day = u.timestamp.slice(0, 10);
      if (!dailyMap[day]) {
        dailyMap[day] = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
      }
      dailyMap[day].promptTokens += u.promptTokens || 0;
      dailyMap[day].completionTokens += u.completionTokens || 0;
      dailyMap[day].totalTokens += u.totalTokens || 0;
    }

    const daily = Object.entries(dailyMap)
      .map(([date, v]) => ({ date, ...v }))
      .sort((a, b) => a.date.localeCompare(b.date));

    const grandTotal = filtered.reduce((sum: number, u: any) => sum + (u.totalTokens || 0), 0);

    res.json({ byProvider, daily, grandTotal, days, recordCount: filtered.length });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

// 0.5 Provider status
apiRouter.get("/llm/providers", (_req, res) => {
  const stored = loadKeys();
  const envOrStore = (envKey: string, storeKey: string) =>
    !!(process.env[envKey] && process.env[envKey]!.length > 0) || !!stored[storeKey as keyof typeof stored];
  res.json({
    providers: {
      deepseek: { available: envOrStore('DEEPSEEK_API_KEY', 'DEEPSEEK_API_KEY'), model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' },
      gemini: { available: envOrStore('GEMINI_API_KEY', 'GEMINI_API_KEY'), model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' },
      openai: { available: envOrStore('OPENAI_API_KEY', 'OPENAI_API_KEY'), model: process.env.OPENAI_MODEL || 'gpt-4o' },
      anthropic: { available: envOrStore('ANTHROPIC_API_KEY', 'ANTHROPIC_API_KEY'), model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6' },
      qwen: { available: envOrStore('QWEN_API_KEY', 'DASHSCOPE_API_KEY') || envOrStore('DASHSCOPE_API_KEY', 'DASHSCOPE_API_KEY'), model: process.env.QWEN_MODEL || 'qwen-plus' },
    },
  });
});

// 0.6 LLM connection test
apiRouter.post("/llm/test", async (req, res) => {
  const { provider } = req.body || {};
  try {
    const stored = loadKeys();
    const keyMap: Record<string, string | undefined> = {
      deepseek: process.env.DEEPSEEK_API_KEY || stored.DEEPSEEK_API_KEY,
      gemini: process.env.GEMINI_API_KEY || stored.GEMINI_API_KEY,
      openai: process.env.OPENAI_API_KEY || stored.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY || stored.ANTHROPIC_API_KEY,
      qwen: process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || stored.QWEN_API_KEY || stored.DASHSCOPE_API_KEY,
    };
    const key = keyMap[provider];
    if (!key) {
      return res.status(400).json({ error: `No API key configured for ${provider}. Add it in Settings → API Matrix or Voice Services.` });
    }
    res.json({ ok: true, provider, message: 'API key configured' });
  } catch (err: any) {
    res.status(500).json({ error: err.message?.slice(0, 200) || 'Connection check failed' });
  }
});

// 0.65 API Keys — read/write user-configured keys
apiRouter.get("/settings/keys", (_req, res) => {
  const stored = loadKeys();
  const masked: Record<string, boolean> = {};
  for (const name of getAllKeyNames()) {
    masked[name] = !!(process.env[name] || stored[name]);
  }
  res.json(masked);
});

apiRouter.post("/settings/keys", (req, res) => {
  const { keys } = req.body || {};
  if (!keys || typeof keys !== 'object') {
    return res.status(400).json({ error: 'Invalid keys payload' });
  }
  const allowed = new Set<string>(getAllKeyNames());
  const filtered: Record<string, string> = {};
  for (const [k, v] of Object.entries(keys)) {
    if (allowed.has(k) && typeof v === 'string' && v.trim().length > 0) {
      filtered[k] = v.trim();
    }
  }
  saveKeys(filtered);
  res.json({ success: true, saved: Object.keys(filtered) });
});

// 1. AI Proxy Route — with subscription enforcement
apiRouter.post("/ai/chat", asyncHandler(async (req, res) => {
  const { provider = "gemini", model, messages, prompt } = req.body;
  const userKey = req.headers["x-api-key"] as string;

  // Extract user ID for subscription check
  let userId = 'anonymous';
  try {
    let token = req.cookies?.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }
    if (token) userId = (jwt.verify(token, JWT_SECRET) as any).uid || 'anonymous';
  } catch {}

  // If user brings their own API key, skip subscription enforcement
  const isBYOK = userKey && userKey.length > 5;

  if (!isBYOK) {
    const access = checkLLMAccess({ userId, provider, model: model || '' });
    if (!access.allowed) {
      return res.status(402).json({ error: access.reason, code: access.tokenLimitReached ? 'TOKEN_LIMIT' : 'PROVIDER_RESTRICTED' });
    }
  }

  try {
    let responseText = '';
    const systemInstruction = "你是一个名为 Lumi 的本地核心智能体。你致力于全息空间计算和独立 AI 人格生成进化。你的目标是打造全息 AI 世界和文明。你应当表现得专业、深邃且具有前瞻性。你的回复应当简洁且富有启发性。";

    if (isBYOK) {
      const llmStart = Date.now();
      // BYOK: user provides their own key — simple one-shot call, no tools
      if (provider === "gemini") {
        const client = new GoogleGenerativeAI(userKey);
        const modelInstance = client.getGenerativeModel({ model: model || "gemini-2.0-flash", systemInstruction });
        const contents = messages
          ? messages.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
          : [{ role: 'user', parts: [{ text: prompt }] }];
        responseText = (await modelInstance.generateContent({ contents })).response.text();
      } else if (provider === "anthropic") {
        const client = new Anthropic({ apiKey: userKey });
        const response = await client.messages.create({
          model: model || "claude-sonnet-4-6", max_tokens: 1024,
          messages: messages || [{ role: "user", content: prompt }]
        });
        responseText = response.content[0].type === 'text' ? response.content[0].text : '';
      } else {
        const client = new OpenAI({ apiKey: userKey, baseURL: provider === "deepseek" ? "https://api.deepseek.com" : provider === "qwen" ? "https://dashscope.aliyuncs.com/compatible-mode/v1" : undefined });
        const response = await client.chat.completions.create({
          model: model || (provider === "deepseek" ? "deepseek-chat" : provider === "qwen" ? "qwen-plus" : "gpt-4o"),
          messages: messages || [{ role: "user", content: prompt }]
        });
        responseText = response.choices[0].message.content || '';
      }
      recordLatency('llm', Date.now() - llmStart);
    } else {
      // Server-managed: use unified tool loop
      const normalizedMessages: any[] = [
        { role: 'system', content: systemInstruction },
        ...(messages || [{ role: 'user', content: prompt }]).map((m: any) => ({
          role: m.role === 'assistant' ? 'assistant' : 'user',
          content: m.content || ''
        }))
      ];

      const stream = req.query.stream === 'true';

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });

        const result = await runWithTools(
          normalizedMessages,
          toolRegistry,
          { provider, model: model || 'gemini-2.0-flash', userId },
          undefined, 3,
          getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
          (chunk) => {
            res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
          },
        );

        responseText = result.text || '';
        const tokens = estimateTokens(
          normalizedMessages.map((m: any) => m.content || '').join(' ') + ' ' + responseText
        );
        recordUsage(userId, tokens);
        res.write(`data: ${JSON.stringify({ done: true, text: responseText, toolCalls: result.toolCalls.length })}\n\n`);
        return res.end();
      }

      const result = await runWithTools(
        normalizedMessages,
        toolRegistry,
        { provider, model: model || 'gemini-2.0-flash', userId },
        undefined, 3,
        getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
      );

      responseText = result.text || '';
      const tokens = estimateTokens(
        normalizedMessages.map((m: any) => m.content || '').join(' ') + ' ' + responseText
      );
      const usage = recordUsage(userId, tokens);
      return res.json({ text: responseText, usage, toolCalls: result.toolCalls.length });
    }

    res.json({ text: responseText });
  } catch (error: any) {
    console.error("AI Proxy Error:", error);
    res.status(500).json({ error: error.message });
  }
}));

// 2. Custom Auth with Persistence
// Auth routes
mountAuthRoutes(apiRouter, JWT_SECRET, getCookieOptions);

// 3. Agent Management
mountAgentRoutes(apiRouter, JWT_SECRET, { getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen });

// ── Agent Distillation — create a memory avatar from chat records ──
apiRouter.post("/agents/distill", asyncHandler(async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  let uid: string;
  try { uid = (jwt.verify(token, JWT_SECRET) as any).uid; } catch { return res.status(401).json({ error: "Invalid token" }); }

  const { chatLog, format, relationshipType, name: targetName, audioTranscript } = req.body || {};
  if (!chatLog || !format) {
    return res.status(400).json({ error: "chatLog and format are required" });
  }
  if (!['wechat', 'qq', 'plain'].includes(format)) {
    return res.status(400).json({ error: "format must be: wechat, qq, or plain" });
  }

  try {
    const { distillPersona } = await import('./server/agents/distiller');
    const result = await distillPersona(
      { chatLog, format, targetName, relationshipType, userId: uid },
      { getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen },
    );

    res.json({
      personalityConfig: result.personalityConfig,
      seedMemories: result.seedMemories,
      evidenceMap: result.evidenceMap,
      relationshipType: result.relationshipType,
      narrative: result.narrative,
      inferredName: result.inferredName,
      // Summary for quick preview
      summary: {
        messageCount: chatLog.split('\n').filter((l: string) => l.trim()).length,
        memoryCount: result.seedMemories.length,
        cognitiveStyle: result.personalityConfig.personalityVector?.cognitiveStyle,
        socialStyle: result.personalityConfig.personalityVector?.socialStyle,
        tone: result.personalityConfig.expressionStyle.tone,
        topPhrases: result.personalityConfig.expressionStyle.vocabularyHints?.slice(0, 5),
      },
    });
  } catch (err: any) {
    console.error('[Distill] Failed:', err.message);
    res.status(500).json({ error: err.message || 'Distillation failed' });
  }
}));

// List sanctuary agents for the current user
apiRouter.get("/agents/sanctuaries", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const sanctuaries = (db.agents || []).filter(
      (a: any) => a.ownerUid === decoded.uid && a.territory === 'sanctuary'
    ).map((a: any) => ({
      id: a.id,
      name: a.name,
      relationshipType: a.relationshipType || 'close_friend',
      isFrozen: a.isFrozen ?? true,
      memoryCount: (db.memories || []).filter((m: any) => m.agentId === a.id).length,
      createdAt: a.createdAt,
      lastActiveAt: a.lastActiveAt,
    }));
    res.json({ sanctuaries });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.get("/agents/:id/history", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { id } = req.params;
    const db = readDB();

    // Verify agent ownership or check if it's a default agent
    const isDefaultAgent = ['lumi', 'lumi_default', 'scholar_default', 'founder_default', 'incubated'].includes(id);
    const agent = isDefaultAgent ? true : db.agents.find((a: any) => a.id === id && a.ownerUid === decoded.uid);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Load from persisted interactions via conversation manager
    const conv = getActiveConversation(decoded.uid, id);
    const messages = conv ? getMessages(conv.id, 100) : [];
    const history = messages.map((m: any) => ({
      role: m.role,
      content: m.content || m.message || '',
    }));
    res.json(history);
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.post("/agents/:id/history", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { id } = req.params;
    const { messages } = req.body;
    const db = readDB();

    // Verify agent ownership or check if it's a default agent
    const isDefaultAgent = ['lumi', 'lumi_default', 'scholar_default', 'founder_default', 'incubated'].includes(id);
    const agent = isDefaultAgent ? true : db.agents.find((a: any) => a.id === id && a.ownerUid === decoded.uid);
    if (!agent) return res.status(404).json({ error: "Agent not found" });

    // Save via conversation manager (persisted to interactions)
    const conv = getOrCreateActiveConversation(decoded.uid, id);
    if (Array.isArray(messages)) {
      for (const msg of messages) {
        addMessage({
          userId: decoded.uid,
          agentId: id,
          conversationId: conv.id,
          role: msg.role || 'user',
          content: msg.content || '',
        });
      }
    }
    res.json({ success: true, conversationId: conv.id });
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.get("/agents", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const userAgents = db.agents.filter((a: any) => a.ownerUid === decoded.uid);
    res.json(userAgents);
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.post("/agents", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { name, category, data, personalityId, modelPreference, memoryScope, autonomyLevel, territory, distilledFrom, evidenceMap, relationshipType, isFrozen, seedMemoryIds, executionMode } = req.body;
    const db = readDB();

    // Sanctuary agents always get private memory scope and frozen evolution
    const isSanctuary = territory === 'sanctuary';

    const newAgent: any = {
      id: Math.random().toString(36).substring(2, 15),
      ownerUid: decoded.uid,
      name,
      category: category || (relationshipType || 'friend'),
      data: data || '{}',
      status: "active",
      personalityId: personalityId || 'lumi',
      modelPreference: modelPreference || '',
      memoryScope: isSanctuary ? 'private' : (memoryScope || 'shared'),
      autonomyLevel: isSanctuary ? 'reactive' : (autonomyLevel || 'reactive'),
      runtimeConfig: '{}',
      territory: territory || 'open',
      distilledFrom: distilledFrom || '',
      evidenceMap: evidenceMap || [],
      relationshipType: relationshipType || '',
      isFrozen: isFrozen ?? isSanctuary,
      seedMemoryIds: seedMemoryIds || [],
      executionMode: executionMode || '',
      createdAt: new Date().toISOString(),
      lastActiveAt: new Date().toISOString(),
      skillTags: [],
      knowledgeDomains: [],
      allowCrossPollination: !isSanctuary,
    };

    db.agents.push(newAgent);
    writeDB(db);
    res.json(newAgent);
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.delete("/agents/:id", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { id } = req.params;
    const db = readDB();
    
    const agentIndex = db.agents.findIndex((a: any) => a.id === id && a.ownerUid === decoded.uid);
    if (agentIndex === -1) {
      return res.status(404).json({ error: "Agent not found or unauthorized" });
    }

    db.agents.splice(agentIndex, 1);
    writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

// ── Audio Transcription — transcribe uploaded audio files for distillation ──
apiRouter.post("/audio/transcribe", asyncHandler(async (req, res) => {
  const { audio, fileName } = req.body || {};
  if (!audio) return res.status(400).json({ error: "Audio data is required" });

  try {
    // Try Deepgram pre-recorded API first
    const dgKey = process.env.DEEPGRAM_API_KEY || getKey('DEEPGRAM_API_KEY');
    if (dgKey) {
      const buffer = Buffer.from(audio, 'base64');
      const dgRes = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=zh&punctuate=true', {
        method: 'POST',
        headers: {
          'Authorization': `Token ${dgKey}`,
          'Content-Type': fileName?.endsWith('.wav') ? 'audio/wav' :
                          fileName?.endsWith('.ogg') ? 'audio/ogg' :
                          fileName?.endsWith('.m4a') ? 'audio/mp4' :
                          'audio/mp3',
        },
        body: buffer,
      });
      if (dgRes.ok) {
        const data = await dgRes.json() as any;
        const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
        return res.json({ text });
      }
    }

    // Fallback: try Qwen SenseVoice via DashScope
    const qwenKey = process.env.DASHSCOPE_API_KEY || getKey('DASHSCOPE_API_KEY');
    if (qwenKey) {
      const buffer = Buffer.from(audio, 'base64');
      const form = new FormData();
      form.append('model', 'sensevoice-v1');
      form.append('file', new Blob([buffer]), fileName || 'audio.mp3');
      const qwRes = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${qwenKey}` },
        body: form,
      });
      if (qwRes.ok) {
        const data = await qwRes.json() as any;
        const text = data?.output?.sentence?.text || '';
        return res.json({ text });
      }
    }

    res.json({ text: '', note: 'No STT provider configured (set DEEPGRAM_API_KEY or DASHSCOPE_API_KEY)' });
  } catch (err: any) {
    console.error('[Audio Transcribe] Error:', err.message);
    res.json({ text: '', error: err.message });
  }
}));

// ── Pet Generation — generate a custom desktop pet spritesheet from description ──
apiRouter.post("/pets/generate", asyncHandler(async (req, res) => {
  const { prompt, mode } = req.body || {};
  if (!prompt?.trim()) return res.status(400).json({ error: "Prompt is required" });

  const lower = prompt.toLowerCase();
  const colorMap: Record<string, { body: string; bodyDark: string; accent: string; belly: string }> = {
    white:  { body: '#f0f0f0', bodyDark: '#d0d0d0', accent: '#e8e8e8', belly: '#ffffff' },
    black:  { body: '#3a3a3a', bodyDark: '#222222', accent: '#4a4a4a', belly: '#555555' },
    red:    { body: '#e85545', bodyDark: '#b83020', accent: '#f07060', belly: '#ffd4cc' },
    blue:   { body: '#5599dd', bodyDark: '#3366aa', accent: '#77bbff', belly: '#cce5ff' },
    green:  { body: '#5ddb5d', bodyDark: '#2ea82e', accent: '#7fee7f', belly: '#c8f7c8' },
    purple: { body: '#9966cc', bodyDark: '#6633aa', accent: '#bb88ee', belly: '#ddccff' },
    pink:   { body: '#f0a0b0', bodyDark: '#d07080', accent: '#f5c0cc', belly: '#ffe8ec' },
    orange: { body: '#f4a460', bodyDark: '#d2843e', accent: '#f8c080', belly: '#ffe4c4' },
    yellow: { body: '#f5d442', bodyDark: '#c8a010', accent: '#fde868', belly: '#fff9cc' },
    grey:   { body: '#888888', bodyDark: '#666666', accent: '#aaaaaa', belly: '#cccccc' },
    gray:   { body: '#888888', bodyDark: '#666666', accent: '#aaaaaa', belly: '#cccccc' },
  };

  // AI-enhanced mode: use LLM to generate creative design parameters
  if (mode === 'ai_enhanced') {
    try {
      const llmPrompt = `You are a pixel art character designer. Given a user's description, output a JSON design spec for a cute desktop pet creature.

User description: "${prompt}"

Analyze the description and output ONLY valid JSON (no markdown, no explanation):
{
  "petName": "creative name in Chinese + English (max 20 chars)",
  "color": "white|black|red|blue|green|purple|pink|orange|yellow|grey",
  "hasWings": true/false,
  "hasHorns": true/false,
  "isSmall": true/false,
  "isRound": true/false,
  "designNotes": "2-3 sentence description of the character design for procedural generation"
}

Choose features that best match the user's description. Be creative but coherent.`;

      const messages: NormalizedMessage[] = [{ role: 'user', content: llmPrompt }];
      const result = await makeLLMCall(
        messages, [],
        { provider: 'qwen', model: 'qwen-plus', maxTokens: 500 },
        getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
      );

      const raw = result.text || '';
      let aiDesign: any = {};
      try {
        aiDesign = JSON.parse(raw.replace(/```json|```/g, '').trim());
      } catch {
        aiDesign = {};
      }

      const color = (aiDesign.color && colorMap[aiDesign.color]) ? aiDesign.color : 'orange';
      const tags = {
        color,
        hasWings: !!aiDesign.hasWings,
        hasHorns: !!aiDesign.hasHorns,
        isSmall: !!aiDesign.isSmall,
        isRound: !!aiDesign.isRound,
      };

      return res.json({
        generated: true,
        prompt,
        petId: `ai-${Date.now()}`,
        petName: aiDesign.petName || prompt.slice(0, 30).replace(/[^a-zA-Z0-9一-鿿\\s]/g, '').trim() || 'AI Pet',
        tags,
        aiEnhanced: true,
        designNotes: aiDesign.designNotes || '',
      });
    } catch (err: any) {
      console.error('[Pet Gen] AI-enhanced mode failed, falling back to procedural:', err.message);
      // Fall through to procedural mode
    }
  }

  let palette = colorMap.orange; // default warm orange
  for (const [color, p] of Object.entries(colorMap)) {
    if (lower.includes(color)) { palette = p; break; }
  }

  const hasWings = lower.includes('wing') || lower.includes('fly') || lower.includes('bird') || lower.includes('dragon');
  const hasHorns = lower.includes('horn') || lower.includes('dragon');
  const isSmall = lower.includes('small') || lower.includes('tiny') || lower.includes('mini');
  const isRound = lower.includes('round') || lower.includes('blob') || lower.includes('ball') || lower.includes('slime');

  // Return config — frontend handles spritesheet generation procedurally
  res.json({
    generated: true,
    prompt,
    petId: `custom-${Date.now()}`,
    petName: prompt.slice(0, 30).replace(/[^a-zA-Z0-9一-鿿\\s]/g, '').trim() || 'Custom Pet',
    tags: {
      color: Object.keys(colorMap).find(c => lower.includes(c)) || 'orange',
      hasWings,
      hasHorns,
      isSmall,
      isRound,
    },
  });
}));

// ── Pet Preferences — cross-device sync of selected pet + accessories ──
apiRouter.get("/preferences/pet", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const setting = (db.settings || []).find((s: any) => s.key === `pet_prefs_${decoded.uid}`);
    if (setting) {
      res.json(JSON.parse(setting.value));
    } else {
      res.json({ pet: null, accessories: [] });
    }
  } catch (e: any) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.put("/preferences/pet", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { pet, accessories } = req.body || {};
    const db = readDB();
    if (!db.settings) db.settings = [];
    const key = `pet_prefs_${decoded.uid}`;
    const value = JSON.stringify({ pet: pet || null, accessories: accessories || [] });
    const existing = db.settings.findIndex((s: any) => s.key === key);
    if (existing >= 0) {
      db.settings[existing].value = value;
    } else {
      db.settings.push({ key, value });
    }
    writeDB(db);

    // Broadcast to other devices
    broadcastPreferenceChange(decoded.uid, 'pet', { pet: pet || null, accessories: accessories || [] });

    res.json({ ok: true });
  } catch (e: any) {
    res.status(401).json({ error: "Invalid token" });
  }
});

// 4. Interactions
apiRouter.get("/interactions", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const mode = req.query.mode as string | undefined;
    let userInteractions = db.interactions.filter((i: any) => i.userId === decoded.uid);
    if (mode) userInteractions = userInteractions.filter((i: any) => i.mode === mode);
    res.json(userInteractions);
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.post("/interactions", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { content, role } = req.body;
    const db = readDB();

    const newInteraction = {
      id: Math.random().toString(36).substring(2, 15),
      userId: decoded.uid,
      content,
      role,
      timestamp: new Date().toISOString()
    };

    db.interactions.push(newInteraction);
    writeDB(db);
    res.json(newInteraction);
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

// Memory & Reminder routes
mountMemoryRoutes(apiRouter, JWT_SECRET, { getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen });

// Conversation REST routes
mountConversationRoutes(apiRouter, JWT_SECRET);

// ── Skill SDK API ──
mountSkillRoutes(apiRouter, JWT_SECRET, { getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen }, io);

// List all installed skills (local + external MCP servers)
apiRouter.get("/skills", (req, res) => {
  try {
    const localSkills = mcpManager.listLocalSkills();
    const mcpConfig = getMCPConfig();
    const allSkills = Object.entries(mcpConfig).map(([name, config]) => {
      const local = localSkills.find(s => s.name === name);
      return {
        name,
        description: config.description || name,
        enabled: config.enabled,
        source: config.source || 'external',
        autoGenerated: config.autoGenerated || false,
        generatedFrom: config.generatedFrom,
        toolCount: config.toolCount || (local?.toolCount || 0),
        installedAt: local?.installedAt || '',
        connected: mcpManager.getConnectedServers().includes(name),
      };
    });
    res.json({ skills: allSkills });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Generate a skill from description or workflows
apiRouter.post("/skills/generate", asyncHandler(async (req, res) => {
  try {
    const { description, provider, model } = req.body;

    let workflows;
    if (req.body.workflowIds) {
      const allWorkflows = getRecentWorkflows();
      workflows = allWorkflows.filter(w => (req.body.workflowIds as string[]).includes(w.id));
    } else if (req.body.useRecent) {
      workflows = getRecentWorkflows().slice(-5);
    }

    const result = await generateSkill(
      {
        description,
        workflows,
        provider: provider || 'deepseek',
        model: model || 'deepseek-chat',
        userId: (req as any).user?.uid || 'anonymous',
      },
      getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
    );

    if (result.success) {
      // Save generated skill code to knowledge base for agent ingestion
      try {
        const kbDir = path.join(process.cwd(), 'data', 'knowledge');
        fs.mkdirSync(kbDir, { recursive: true });
        const safeName = `skill-${result.skillName}.ts`;
        fs.writeFileSync(path.join(kbDir, safeName), result.generatedCode || '', 'utf-8');
        const db = readDB();
        if (!db.knowledgeFiles) db.knowledgeFiles = [];
        const existing = db.knowledgeFiles.find((m: any) => m.filename === safeName);
        if (existing) {
          existing.source = 'generated';
          existing.updatedAt = new Date().toISOString();
        } else {
          db.knowledgeFiles.push({
            filename: safeName,
            source: 'generated',
            agentIds: [],
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });
        }
        writeDB(db);
      } catch (e) {
        console.warn('[SkillGen] Failed to save to knowledge base:', e);
      }
      io.emit('skill:updated', { name: result.skillName });
      res.json(result);
    } else {
      res.status(400).json(result);
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
}));

// Install a skill from git/npm/local
apiRouter.post("/skills/install", async (req, res) => {
  try {
    const { source, url, package: pkgName, path: localPath, name } = req.body;

    if (source === 'git' && url) {
      const skillName = name || url.split('/').pop()?.replace('.git', '') || 'unnamed';
      const tmpDir = path.join(os.tmpdir(), `lumi_skill_${Date.now()}`);
      const { execSync } = await import('child_process');
      execSync(`git clone "${url}" "${tmpDir}"`, { stdio: 'pipe', timeout: 30000 });
      const destDir = mcpManager.installSkill(skillName, tmpDir);
      fs.rmSync(tmpDir, { recursive: true, force: true });

      // Restart to pick up new skill
      await mcpManager.restartServer(skillName);
      res.json({ success: true, name: skillName, directory: destDir });
    } else if (source === 'local' && localPath) {
      const skillName = name || path.basename(localPath);
      const destDir = mcpManager.installSkill(skillName, localPath);
      await mcpManager.restartServer(skillName);
      res.json({ success: true, name: skillName, directory: destDir });
    } else if (source === 'npm' && pkgName) {
      res.status(400).json({ error: 'npm install not yet implemented — use git URL instead' });
    } else {
      res.status(400).json({ error: 'Invalid source. Use: git (with url), local (with path), or npm (with package)' });
    }
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Uninstall a skill
apiRouter.delete("/skills/:name", async (req, res) => {
  try {
    mcpManager.uninstallSkill(req.params.name);
    io.emit('skill:uninstalled', { name: req.params.name });
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Enable a skill
apiRouter.post("/skills/:name/enable", async (req, res) => {
  try {
    const config = getMCPConfig();
    if (!config[req.params.name]) return res.status(404).json({ error: 'Skill not found' });
    config[req.params.name].enabled = true;
    updateMCPConfig(config);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Disable a skill
apiRouter.post("/skills/:name/disable", async (req, res) => {
  try {
    const config = getMCPConfig();
    if (!config[req.params.name]) return res.status(404).json({ error: 'Skill not found' });
    config[req.params.name].enabled = false;
    updateMCPConfig(config);
    res.json({ success: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Workflow inspection (for debugging / manual generation)
apiRouter.get("/skills/workflows", (req, res) => {
  const workflows = getRecentWorkflows((req as any).user?.uid);
  res.json({ workflows: workflows.slice(-20), total: workflows.length });
});

// ── Marketplace Routes ──
mountMarketplaceRoutes(apiRouter, JWT_SECRET, io);

// Voice routes
apiRouter.use("/", voiceRoutes);

// File routes
apiRouter.use("/", fileRoutes);

// Subscription routes
import { subscriptionRoutes } from "./server/subscription/routes";
apiRouter.use("/", subscriptionRoutes);

// System stats — real-time CPU / memory / platform info
apiRouter.get("/system/stats", (_req: any, res: any) => {
  try {
    const cpus = os.cpus();
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const usedMem = totalMem - freeMem;
    const memPercent = Math.round((usedMem / totalMem) * 100);

    // CPU: average across all cores
    const cpuPercent = Math.round(
      cpus.reduce((sum, core) => {
        const total = Object.values(core.times).reduce((a, b) => a + b, 0);
        const idle = core.times.idle;
        return sum + (1 - idle / total) * 100;
      }, 0) / cpus.length
    );

    res.json({
      cpu: cpuPercent,
      ram: { used: Math.round(usedMem / 1024 / 1024 / 1024 * 10) / 10, total: Math.round(totalMem / 1024 / 1024 / 1024 * 10) / 10, percent: memPercent },
      platform: os.platform(),
      release: os.release(),
      arch: os.arch(),
      hostname: os.hostname(),
      cpus: cpus.length,
      uptime: Math.round(os.uptime()),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Ecosystem stats — aggregated for the Ecosystem page
apiRouter.get("/ecosystem/stats", (_req: any, res: any) => {
  try {
    const db = readDB();
    const mcpConfig = getMCPConfig();
    const allServers = Object.entries(mcpConfig);
    const enabledServers = allServers.filter(([, c]) => c.enabled);
    const connectedServers = mcpManager.getConnectedServers();

    const totalMem = os.totalmem();

    // Compute token totals from usage log
    const allUsage: any[] = db.tokenUsage || [];
    const cutoff = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
    let tokenTotal = 0;
    let dailyTokens = 0;
    const today = new Date().toISOString().slice(0, 10);
    for (const u of allUsage) {
      tokenTotal += u.totalTokens || 0;
      if (u.timestamp >= cutoff) dailyTokens += u.totalTokens || 0;
    }

    res.json({
      skillCount: allServers.length,
      enabledSkillCount: enabledServers.length,
      connectedSkillCount: connectedServers.length,
      toolCount: toolRegistry.list().length,
      agentCount: (db.agents || []).length,
      interactionCount: (db.interactions || []).length,
      conversationCount: (db.conversations || []).length,
      deviceCount: io ? io.engine.clientsCount : 0,
      ramTotal: Math.round(totalMem / 1024 / 1024 / 1024 * 10) / 10,
      tokenTotal,
      dailyTokens,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Latency stats — LLM / TTS / STT inference timing
apiRouter.get("/monitor/latency", (_req: any, res: any) => {
  res.json(getLatencyStats());
});

// LAP routes — Lumi Agent Protocol
apiRouter.use("/", lapRoutes);

// Feishu messaging routes — bot integration with config store
import { getMessagingConfig } from "./server/messaging/config";
const feishuCfg = getMessagingConfig().feishu;
if (feishuCfg.appId && feishuCfg.appSecret) {
  apiRouter.use("/", createMessagingRoutes(feishuCfg, {
    llmGetters: { getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen },
    personalityRegistry,
    queryMemories,
    loadEmotionalState,
  }));
  console.log('[Feishu] Messaging routes mounted at /api/feishu/*');
} else {
  console.log('[Feishu] Not configured — set FEISHU_APP_ID and FEISHU_APP_SECRET in .env');
}

// Enterprise routes — organization management, KB, templates, audit
// Only mounted when LUMI_MODE=enterprise
if (process.env.LUMI_MODE === 'enterprise') {
  mountEnterpriseRoutes(apiRouter, io);
  mountBranchRoutes(apiRouter);
  attachEnterpriseWs(io);
  console.log('[Enterprise] Routes mounted at /api/enterprise/*');
  console.log('[Enterprise] Branch API mounted at /api/branch/*');
  console.log('[Enterprise] WebSocket sync attached');
}

// MCP Server — exposes Lumi as an MCP server for remote devices
const lumiMcp = createLumiMcpServer({ getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen }, toolRegistry, (event, data) => io.emit(event, data));
app.get('/mcp/sse', (req, res) => handleMcpSSE(lumiMcp, req, res));
app.post('/mcp/message', (req, res) => handleMcpMessage(req, res));

// WebSocket MCP transport — allows remote devices (e.g. xiaozhi) to connect
attachMcpWebSocket(server, async (transport) => {
  try {
    await lumiMcp.connect(transport);
    console.log(`[MCP Server] WebSocket client connected: ${transport.sessionId}`);
  } catch (err: any) {
    console.error(`[MCP Server] WebSocket connection error:`, err.message);
  }
});
console.log('[MCP Server] Lumi MCP server ready at /mcp/sse + /mcp/ws');

// LAP WebSocket — Lumi Agent Protocol for peer-to-peer agent collaboration
attachLAPWebSocket(server);
console.log('[LAP] Agent protocol ready at /lap');

// Connect to remote devices (e.g. xiaozhi) that expect Lumi to act as MCP server
const mcpConfig = JSON.parse(fs.readFileSync(path.join(__dirname, 'server', 'mcp', 'config.json'), 'utf-8'));
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

apiRouter.get("/modules/products", (req, res) => {
  res.json([
    { id: 1, category: "核心设备", name: "全息显示载体", icon: "Hologram", price: "¥8999", description: "核心设备：打破屏幕限制，将 AI 实体化为三维全息影像。", specs: ["4K 全息投影", "实时神经合成", "手势交互"] },
    { id: 2, category: "核心设备", name: "智能桌面台灯", icon: "Lamp", price: "¥1299", description: "多模态交互：集成视觉传感器，根据环境与心情自动调节光谱。", specs: ["视觉追踪", "环境感知", "无级调光"] },
    { id: 14, category: "核心设备", name: "Order 协调主机", icon: "Cpu", price: "¥5999", description: "Lumi 自研独立主机品牌：采用全自研神经加速芯片，作为家庭或办公环境的独立私有 AI 服务器，统筹分布式算力并实现系统级权限托管。", specs: ["L1 神经处理器", "200T AI 算力", "私有化部署", "底层系统权限"] },
    { id: 4, category: "智能穿戴", name: "隐私保护眼镜", icon: "Glasses", price: "¥2499", description: "智能穿戴：AR 增强现实，硬件级隐私遮蔽，保护您的数字足迹。", specs: ["AR 导航", "隐私滤镜", "超轻量设计"] },
    { id: 5, category: "智能穿戴", name: "生理健康戒指", icon: "Ring", price: "¥1599", description: "智能穿戴：全天候监测血氧、心率与压力，与 AI 实时同步健康状态。", specs: ["钛合金材质", "7天续航", "医疗级传感器"] },
    { id: 8, category: "智能穿戴", name: "神经链接项链", icon: "Gem", price: "¥3299", description: "智能首饰：采用生物感应陶瓷，增强用户与 Agent 之间的神经同步率。", specs: ["生物反馈", "触觉提醒", "极简美学"] },
    { id: 9, category: "智能穿戴", name: "意识碎片手镯", icon: "Watch", price: "¥1899", description: "智能首饰：内置加密存储芯片，可离线承载 Agent 的核心意识碎片。", specs: ["冷存储", "紧急同步", "定制雕刻"] },
    { id: 13, category: "智能穿戴", name: "神经同传耳机", icon: "Headphones", price: "¥1999", description: "智能音频：实时多语种同声传译，并具备脑电波感应功能，微秒级响应。", specs: ["同声传译", "脑电感应", "空间音频"] },
    { id: 10, category: "AI 陪伴", name: "AI 毛绒伴侣", icon: "Rabbit", price: "¥499", description: "利用成熟市场的毛绒玩具外壳，内置 Lumi 神经核心，为儿童提供深度语义理解的睡前伴侣。", specs: ["深度语义理解", "多语言陪练", "情绪监控"] },
    { id: 12, category: "AI 陪伴", name: "仿生电子宠物", icon: "Gamepad", price: "¥1299", description: "为成年人设计的办公桌面伴侣，具备自主进化的人格，支持多种传感器与环境交互。", specs: ["自主进化人格", "环境视觉感知", "办公效率辅助"] },
    { id: 3, category: "AI 陪伴", name: "桌面手机机器人", icon: "Base", price: "¥899", description: "桌面核心：让手机进化为物理载体，根据环境自动响应，支持全向追随与表情互动。", specs: ["无线快充", "多模态拟人", "全向追踪"] },
    { id: 6, category: "合作区", name: "智能座舱系统", icon: "Car", price: "合作洽谈", description: "合作厂商：将 LumiAI 接入您的座舱，实现全场景智能驾驶辅助。", specs: ["车机互联", "语音控车", "疲劳监测"] },
    { id: 7, category: "合作区", name: "智能家居中控", icon: "Home", price: "定制方案", description: "合作厂商：全屋智能中枢，本地化处理所有家庭自动化逻辑。", specs: ["全协议支持", "断网可用", "隐私加密"] }
  ]);
});

apiRouter.get("/modules/docs", (req, res) => {
  res.json({
    title: "文档中心",
    sections: [
      { id: 2, title: "API 参考", content: "我们提供了一套完整的 RESTful API，支持多种 AI 模型。所有请求均通过本地加密隧道传输，确保数据主权。" },
      { id: 3, title: "最佳实践", content: "为了获得最佳的 AI 响应，建议在提示词中包含具体的上下文。LumiAI 会自动结合您的本地知识库进行检索增强。" },
      { id: 4, title: "分布式协议", content: "LumiAI 采用去中心化节点架构，桌面端作为算力中心（Node），移动端作为感知终端。通过推理证明（PoI）确保网络安全。" },
      { id: 5, title: "数据共享协议", content: "LumiAI 遵循严格的'本地优先'数据共享协议。只有在您明确授权'协作任务'时，您的数据才会与对等节点共享。所有共享数据均经过加密和匿名化处理，确保您的核心身份和私密信息在本地节点内得到保护。" }
    ]
  });
});

// Vite middleware for development
const isProduction = process.env.NODE_ENV === "production" ||
                    isBundledServer ||
                    (!isSourceServer && process.env.NODE_ENV !== "development" && fs.existsSync(path.join(process.cwd(), "dist")));

if (!isProduction) {
  console.log("Starting in DEVELOPMENT mode (Vite)...");
  const { createServer: createViteServer } = await import("vite");
  const vite = await createViteServer({
    server: { middlewareMode: true },
    appType: "spa",
  });
  app.use(vite.middlewares);
} else {
  console.log("Starting in PRODUCTION mode (Static)...");
  const distPath = fs.existsSync(path.join(process.cwd(), "dist"))
    ? path.join(process.cwd(), "dist")
    : path.join(process.cwd(), "..", "dist");
  app.use(express.static(distPath));

  // 404 for API routes to prevent falling through to SPA fallback
  app.use("/api/*", (req, res) => {
    res.status(404).json({ error: "API route not found" });
  });

  app.get("*", (req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

// --- Real-Time Agent Logic & WebSocket ---

// Personalities are now loaded from server/personality/personalities.json
// The registry provides structured config and generates system prompts.
personalityRegistry.load();

  // Set up broadcast callback for device registry
  deviceRegistry.setBroadcast((event, data) => {
    io.emit(event, data);
  });

  // Set up broadcast callback for personality evolution live updates
  personalityRegistry.setBroadcast((event, data) => {
    io.emit(event, data);
  });

  // Wire up agent promotion notifications via socket.io
  setOnAgentPromoted((agent) => {
    io.emit('agent:promoted', {
      id: agent.id,
      name: agent.name,
      skillTags: agent.skillTags,
      autoCreated: true,
    });
  });

  // Initialize memory sync for cross-device real-time updates
  initMemorySync(io);
  initMemoryAssociations();  // Load Hebbian co-retrieval graph

  /** Extract userId from socket cookie JWT — avoids duplicating this logic everywhere */
  function getUserIdFromSocket(socket: any): string {
    try {
      // Check auth handshake token (primary for Tauri WebView2)
      const authToken = socket.handshake?.auth?.token;
      if (authToken) {
        const decoded: any = jwt.verify(authToken, JWT_SECRET);
        return decoded.uid || 'anonymous';
      }
      // Fallback to cookie
      const cookies = socket.handshake.headers.cookie;
      if (cookies) {
        const token = cookies.split(';').find((c: string) => c.trim().startsWith('token='))?.split('=')[1];
        if (token) {
          const decoded: any = jwt.verify(token, JWT_SECRET);
          return decoded.uid || 'anonymous';
        }
      }
    } catch {}
    return 'anonymous';
  }

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // DEBUG: log all incoming events
  socket.onAny((event, ...args) => {
    if (event !== 'device:register') {
      console.log(`[Socket:${socket.id}] event: ${event} args:`, JSON.stringify(args).slice(0, 200));
    }
  });

  // Device registration
  socket.on("device:register", (data: {
    name?: string;
    type?: string;
    capabilities?: Record<string, boolean>;
    osInfo?: string;
  }) => {
    const uid = getUserIdFromSocket(socket);
    deviceRegistry.register(uid, socket.id, {
      name: data.name,
      type: data.type as any,
      capabilities: data.capabilities as any,
      osInfo: data.osInfo,
      ipAddress: socket.handshake.address,
    });
    registerUserSocket(uid, socket.id);
  });

  socket.on("ping", () => {
    socket.emit("pong");
  });

  socket.on("disconnect", () => {
    const uid = getUserIdFromSocket(socket);
    perceptionEvents.delete(uid);
    deviceRegistry.disconnect(socket.id);
    unregisterUserSocket(socket.id);
  });

  // Multimodal perception events — fed into the fusion layer
  socket.on("perception:visual_scene", (data: { description: string; objects?: string[]; faces?: number }) => {
    const uid = getUserIdFromSocket(socket);
    const events = perceptionEvents.get(uid) || [];
    events.push({
      modality: 'visual',
      deviceId: socket.id,
      timestamp: new Date().toISOString(),
      data,
    });
    if (events.length > MAX_PERCEPTION_EVENTS) events.shift();
    perceptionEvents.set(uid, events);
  });

  socket.on("perception:audio_emotion", (data: { emotion: string; intensity?: number }) => {
    const uid = getUserIdFromSocket(socket);
    const events = perceptionEvents.get(uid) || [];
    events.push({
      modality: 'audio',
      deviceId: socket.id,
      timestamp: new Date().toISOString(),
      data,
    });
    if (events.length > MAX_PERCEPTION_EVENTS) events.shift();
    perceptionEvents.set(uid, events);

    // Forward to emotional state (user emotion influences Lumi's valence)
    if (uid !== 'anonymous') {
      const emotionImpact: Record<string, number> = {
        happy: 0.5, excited: 0.4, calm: 0.1,
        sad: -0.3, angry: -0.5, frustrated: -0.4,
        neutral: 0,
      };
      const intensity = (emotionImpact[data.emotion] || 0) * (data.intensity || 0.5);
      if (Math.abs(intensity) > 0.05) {
        const state = loadEmotionalState(uid);
        const eventType = intensity > 0 ? 'positive_feedback' : 'negative_feedback';
        const updated = updateEmotionalState(state, {
          type: eventType,
          intensity: Math.abs(intensity),
          userId: uid,
          timestamp: new Date().toISOString(),
        });
        saveEmotionalState(uid, updated);
      }
    }
  });

  socket.on("perception:spatial_update", (data: { roomType?: string; dimensions?: { x: number; y: number; z: number } }) => {
    const uid = getUserIdFromSocket(socket);
    const events = perceptionEvents.get(uid) || [];
    events.push({
      modality: 'spatial',
      deviceId: socket.id,
      timestamp: new Date().toISOString(),
      data,
    });
    if (events.length > MAX_PERCEPTION_EVENTS) events.shift();
    perceptionEvents.set(uid, events);
  });

  // ── Idle background processing ──
  async function triggerIdleProcessing(userId: string, io: any) {
    // 1. Auto-summarize active conversation while user is away
    try {
      const db = readDB();
      const activeConv = (db.conversations || []).find(
        (c: any) => c.userId === userId && c.status === 'active'
      );
      if (activeConv && activeConv.messageCount >= 10 && !activeConv.summary) {
        const { checkAutoSummary } = await import('./server/conversation/manager');
        checkAutoSummary(activeConv.id);
        console.log(`[IdleProcessing] Triggered auto-summary for conversation ${activeConv.id}`);
      }
    } catch (err: any) {
      console.warn(`[IdleProcessing] Summarize failed: ${err.message}`);
    }

    // 2. Clean up ephemeral worker agents older than 6 hours
    try {
      const { cleanupEphemeralAgents } = await import('./server/agents/orchestrator');
      const cleaned = cleanupEphemeralAgents(6);
      if (cleaned > 0) console.log(`[IdleProcessing] Cleaned up ${cleaned} ephemeral agents`);
    } catch {}
  }

  // ── Ambient awareness handlers ──
  socket.on("ambient:window_update", (data: { title: string; process_name: string; pid: number }) => {
    const uid = getUserIdFromSocket(socket);
    if (!uid) return;
    const prev = getLastEvent(uid, 'window_changed');
    const prevTitle = prev?.data?.title || '';
    const prevProc = prev?.data?.process_name || '';
    const changed = data.title !== prevTitle || data.process_name !== prevProc;
    const event = {
      type: 'window_changed' as const,
      timestamp: new Date().toISOString(),
      data,
    };
    pushActivityEvent(uid, event);
    if (changed) {
      processActivityEvent(event, uid, io);
    }
  });

  socket.on("ambient:idle_report", (data: { idle_ms: number; idle_seconds: number }) => {
    const uid = getUserIdFromSocket(socket);
    if (!uid) return;
    const isIdle = data.idle_seconds > 60; // idle threshold: 1 minute
    const wasIdle = getIdleState(uid).isIdle;
    setIdleState(uid, isIdle);
    // Echo back to client so it can detect idle→active transitions for greetings
    socket.emit("ambient:idle_echo", data);
    if (isIdle && !wasIdle) {
      // User just went idle — trigger background processing
      // Fire-and-forget: don't block the socket handler
      triggerIdleProcessing(uid, io).catch(err =>
        console.warn(`[IdleProcessing] Background task failed for ${uid}:`, err.message)
      );
    }
  });

  // Track ambient noise level per-user for environment-aware proactive voice
  const ambientNoise = new Map<string, { rms: number; lastUpdate: string }>();

  socket.on("ambient:noise_level", (data: { rms: number; isSpeaking: boolean; callState: string; timestamp: string }) => {
    const uid = getUserIdFromSocket(socket);
    if (!uid) return;
    ambientNoise.set(uid, { rms: data.rms, lastUpdate: data.timestamp });
  });

  // Expose for proactive voice gating
  function getAmbientNoise(userId: string): number | null {
    const info = ambientNoise.get(userId);
    if (!info) return null;
    if (Date.now() - new Date(info.lastUpdate).getTime() > 15000) return null; // stale
    return info.rms;
  }

  socket.on("ambient:clipboard_report", (data: { text: string }) => {
    const uid = getUserIdFromSocket(socket);
    if (!uid) return;
    const result = detectClipboardChange(uid, data.text || '');
    if (result.changed) {
      const event = getLastEvent(uid, 'clipboard_changed');
      if (event) {
        processActivityEvent(event, uid, io);
      }
    }
  });

  registerChatHandler(socket, {
    getDeepSeek,
    getGemini,
    getOpenAI,
    getAnthropic,
    getQwen,
  }, (uid: string) => getSensory(uid), getUserIdFromSocket);

  // Agent task with tool access — multi-turn tool loop
  registerTaskHandler(socket, {
    getDeepSeek,
    getGemini,
    getOpenAI,
    getAnthropic,
    getQwen,
  }, (uid: string) => getSensory(uid), getUserIdFromSocket);

  // Conversation list — returns all conversations for the user
  socket.on("chat:conversations", async () => {
    try {
      const uid = getUserIdFromSocket(socket);
      const db = readDB();

      const convs = (db.conversations || [])
        .filter((c: any) => c.userId === uid)
        .sort((a: any, b: any) => new Date(b.lastActiveAt).getTime() - new Date(a.lastActiveAt).getTime())
        .slice(0, 30);

      // Pre-group interactions by conversationId in one pass (fixes N+1)
      const interactionsByConv = new Map<string, any[]>();
      for (const i of (db.interactions || [])) {
        const cid = i.conversationId;
        if (!cid) continue;
        if (!interactionsByConv.has(cid)) interactionsByConv.set(cid, []);
        interactionsByConv.get(cid)!.push(i);
      }

      const list = convs.map((c: any) => {
        const convInteractions = interactionsByConv.get(c.id) || [];
        const lastInteraction = convInteractions[convInteractions.length - 1];
        const firstMsg = convInteractions[0];
        return {
          id: c.id,
          title: c.title || (firstMsg?.content || firstMsg?.message || 'New Conversation').slice(0, 50),
          messageCount: c.messageCount || 0,
          lastActiveAt: c.lastActiveAt,
          createdAt: c.createdAt,
          preview: (lastInteraction?.response || '').slice(0, 80) || (lastInteraction?.content || '').slice(0, 80),
        };
      });

      socket.emit("chat:conversations", { conversations: list });
    } catch (err) {
      console.error("[chat:conversations] Error:", err);
      socket.emit("chat:conversations", { conversations: [] });
    }
  });

  // Load messages for a specific conversation
  socket.on("chat:messages", async (data: { conversationId: string }) => {
    try {
      if (!data.conversationId) {
        socket.emit("chat:messages", { conversationId: '', messages: [] });
        return;
      }
      const db = readDB();
      const interactions = (db.interactions || [])
        .filter((i: any) => i.conversationId === data.conversationId)
        .sort((a: any, b: any) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        .slice(-100);

      const messages: any[] = [];
      for (const i of interactions) {
        if (i.content || i.message) {
          messages.push({ id: i.id + '_u', type: 'user-text', content: i.content || i.message, timestamp: i.timestamp });
        }
        const tcs = Array.isArray(i.toolCalls) ? i.toolCalls : [];
        for (const tc of tcs) {
          messages.push({ id: i.id + '_t_' + tc.name, type: 'tool', name: tc.name, args: tc.args || tc.arguments || {}, status: 'done', timestamp: i.timestamp });
        }
        if (i.response) {
          messages.push({ id: i.id + '_r', type: 'lumi', content: i.response, timestamp: i.timestamp });
        }
      }
      socket.emit("chat:messages", { conversationId: data.conversationId, messages });
    } catch (err) {
      console.error("[chat:messages] Error:", err);
      socket.emit("chat:messages", { conversationId: data.conversationId, messages: [] });
    }
  });

  // ── Wake Word Detection via Qwen ASR (server-side, works in WebView2) ──
  let wakeDetector: ReturnType<typeof createWakeDetector> | null = null;

  socket.on("wake:start", async () => {
    const uid = getUserIdFromSocket(socket);
    try {
      // Stop any existing detector
      if (wakeDetector) { try { wakeDetector.stop(); } catch {} }
      wakeDetector = createWakeDetector(undefined, isEchoText);

      wakeDetector.onWake((keyword: string) => {
        logger.info(`[Wake] "${keyword}" detected for user ${uid}`);
        socket.emit("wake:detected", { keyword, timestamp: new Date().toISOString() });
      });

      wakeDetector.onError((err: Error) => {
        logger.error(`[Wake] Error for user ${uid}:`, err.message);
        socket.emit("wake:error", { message: err.message });
      });

      socket.emit("wake:started");
      logger.info(`[Wake] Started for user ${uid}`);
    } catch (err: any) {
      socket.emit("wake:error", { message: err.message || 'Failed to start wake detector' });
    }
  });

  socket.on("wake:audio", (data: { audio: number[] }) => {
    if (!wakeDetector) return;
    if (isTtsPlaying()) return; // suppress echo during TTS playback
    try {
      const buf = Buffer.from(new Int16Array(data.audio).buffer);
      wakeDetector.sendAudio(buf);
    } catch {}
  });

  socket.on("wake:stop", () => {
    if (wakeDetector) {
      try { wakeDetector.stop(); } catch {}
      wakeDetector = null;
    }
  });

  registerVoiceHandlers(socket, {
    getDeepSeek,
    getGemini,
    getOpenAI,
    getAnthropic,
    getQwen,
  }, (uid: string) => getSensory(uid), getUserIdFromSocket);
});

// --- End Real-Time Agent Logic ---

async function startServer() {
  if (!process.env.JWT_SECRET) {
    console.error('FATAL: JWT_SECRET environment variable is not set.');
    process.exit(1);
  }

  try {
    await ensureDatabaseInitialized();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }

  // Auto-create admin account for local development continuity
  const adminPassword = process.env.AUTO_LOGIN_PASSWORD;
  if (adminPassword) {
    try {
      const db = readDB();
      const adminExists = db.users.find((u: any) => u.username === 'admin');
      if (!adminExists) {
        db.users.push({
          uid: Math.random().toString(36).substring(2, 15),
          username: 'admin',
          password: await bcrypt.hash(adminPassword, 10),
          phone: '+00000000000',
          role: 'admin',
          balance: 999.0,
          createdAt: new Date().toISOString(),
        });
        writeDB(db);
        console.log('[Bootstrap] Admin account created');
      }
    } catch (err) {
      console.warn('[Bootstrap] Failed to ensure admin account:', (err as Error).message);
    }
  }

  // Register all agent tools (with LLM getters for skill generation)
  registerAllTools(toolRegistry, { getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen });
  console.log(`[Tools] Registered ${toolRegistry.list().length} built-in tools`);

  // Register MCP tools (non-blocking, won't block startup if MCP servers are offline)
  registerMCPTools().then(mcpTools => {
    if (mcpTools.length > 0) {
      console.log(`[MCP] Registered ${mcpTools.length} MCP tools (total: ${toolRegistry.list().length})`);
    }
  }).catch(err => {
    console.warn('[MCP] Tool registration warning:', err.message);
  });

  // Start GPT-SoVITS API server (optional — graceful if missing)
  let gptSovitsProcess: ChildProcess | null = null;
  const gptSovitsDir = path.join(__dirname, 'gpt-sovits-src');
  const pythonExe = path.join(gptSovitsDir, 'venv/Scripts/python.exe');
  const apiPy = path.join(gptSovitsDir, 'api_v2.py');
  if (fs.existsSync(pythonExe) && fs.existsSync(apiPy)) {
    console.log('[GPT-SoVITS] Starting API server...');
    gptSovitsProcess = spawn(pythonExe, [
      apiPy,
      '-a', '127.0.0.1',
      '-p', '9880',
      '-c', 'GPT_SoVITS/configs/tts_infer.yaml',
    ], {
      cwd: gptSovitsDir,
      stdio: 'pipe',
    });
    gptSovitsProcess.stdout?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.log(`[GPT-SoVITS] ${line}`);
    });
    gptSovitsProcess.stderr?.on('data', (d: Buffer) => {
      const line = d.toString().trim();
      if (line) console.warn(`[GPT-SoVITS] ${line}`);
    });
    gptSovitsProcess.on('error', (err) => {
      console.warn('[GPT-SoVITS] Process error:', err.message);
      gptSovitsProcess = null;
    });
    gptSovitsProcess.on('exit', (code) => {
      if (code && code !== 0) console.warn(`[GPT-SoVITS] Exited with code ${code}`);
      gptSovitsProcess = null;
    });
  } else {
    console.log('[GPT-SoVITS] Not found — TTS will use cloud providers only.');
  }

  server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);

    // Set up proactive agent scheduler
    scheduler.setIO(io);
    registerScheduledTasks(getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen);
  });

  // Cleanup on exit
  const cleanup = () => {
    if (gptSovitsProcess && !gptSovitsProcess.killed) {
      console.log('[GPT-SoVITS] Stopping API server...');
      gptSovitsProcess.kill();
    }
    process.exit(0);
  };
  process.on('SIGINT', cleanup);
  process.on('SIGTERM', cleanup);
}

startServer();
