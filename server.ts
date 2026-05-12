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
import { getOrCreateActiveConversation, closeConversation, getActiveConversation, getUserConversations, addMessage, getMessages, getUnclosedConversation } from "./server/conversation/manager";
import { logger } from "./logger";
import { createStreamingSession, getActiveSTTProvider } from "./server/stt/adapter";

import { synthesizeSpeech, getActiveProvider as getTTSProvider } from "./server/tts/adapter";
import { makeLLMCall, makeLLMCallStreaming, NormalizedMessage } from "./server/llm/providers";
import { runWithTools } from "./server/llm/adapter";
import { checkLLMAccess, recordUsage, estimateTokens } from "./server/subscription/proxy";
import { toolRegistry } from "./server/tools/registry";
import { registerAllTools } from "./server/tools/definitions/index";
import { queryMemories, addMemory, removeMemory, formatMemoriesForContext, extractMemories, addReminder, fireReminder, runBehavioralAnalysis, getUnconsolidatedEpisodic, markConsolidated, initMemorySync, registerUserSocket, unregisterUserSocket, broadcastMemoryChange } from "./server/memory";
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
import { generateSkill, autoGenerateSkill } from "./server/skills/generator";
import { getRecentWorkflows, clearWorkflows } from "./server/skills/worklog";
import { getMarketplaceSkills, getSkillById, searchSkills, getCategories, recordInstall, publishSkill, rateSkill, getSkillRatings } from "./server/marketplace/registry";
import { scheduler, registerScheduledTasks } from "./server/scheduler";
import { deviceRegistry } from "./server/devices";
import { fuseContext, formatContextForPrompt, type RawModalityInput } from "./server/context/fusion";
import { canOutputHolographic, textToHolographicOutput } from "./server/output/holographic";
import type { SensoryContext } from "./server/personality/types";
import voiceRoutes from "./routes/voice";
import fileRoutes from "./routes/files";
import { mountAuthRoutes } from "./server/routes/auth";
import { mountMemoryRoutes } from "./server/routes/memory_routes";
import { mountConversationRoutes } from "./server/routes/conversations";
import { registerChatHandler } from "./server/socket/chat";
import { registerTaskHandler } from "./server/socket/task";
import { registerVoiceHandlers } from "./server/socket/voice";
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
let personalityFileLock: Promise<void> = Promise.resolve();

// Cookies: sameSite "none" permits cross-origin (Tauri webview → localhost).
// secure: true requires HTTPS in general, but Chromium allows it on localhost/127.0.0.1.
const getCookieOptions = (): { httpOnly: true; secure: boolean; sameSite: "none"; maxAge: number } => ({
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: "none",
  maxAge: 24 * 60 * 60 * 1000,
});

// 0. Personality list
apiRouter.get("/personalities", (_req, res) => {
  const list = personalityRegistry.list().map(p => ({
    id: p.id,
    name: p.name,
    version: p.version,
    coreMotivation: p.coreMotivation,
    expressionStyle: p.expressionStyle,
  }));
  res.json(list);
});

// Full personality config (for editing)
apiRouter.get("/personalities/:id", (req, res) => {
  try {
    const config = personalityRegistry.get(req.params.id);
    if (!config) return res.status(404).json({ error: "Personality not found" });
    res.json(config);
  } catch (err: any) {
    res.status(500).json({ error: err.message || "Failed to load personality" });
  }
});

// Create or update a personality
apiRouter.post("/personalities", (req, res) => {
  const { id, name, version, coreMotivation, behavioralBoundaries, expressionStyle, toolPolicy, memoryPolicy, defaultModel, fallbackModel } = req.body;
  if (!id || !name) return res.status(400).json({ error: "id and name are required" });

  const prev = personalityFileLock.catch(() => {});
  personalityFileLock = prev.then(() => new Promise<void>((resolve) => {
    try {
      const filePath = path.join(process.cwd(), 'server', 'personality', 'personalities.json');
      let configs: any[] = [];
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        configs = JSON.parse(raw);
      } catch {}

      const existing = configs.findIndex((c: any) => c.id === id);
      const newConfig = { id, name, version: version || '1.0', coreMotivation: coreMotivation || '', behavioralBoundaries: behavioralBoundaries || [], expressionStyle: expressionStyle || { persona: '', tone: 'neutral', verbosity: 'balanced', languages: ['en'] }, toolPolicy: toolPolicy || { allowedTools: ['*'], requireConfirmation: [], maxIterations: 3 }, memoryPolicy: memoryPolicy || { retrieveLimit: 5, minConfidence: 0.4, includeTypes: ['preference', 'fact'], autoExtract: true }, defaultModel: defaultModel || 'qwen-plus', fallbackModel: fallbackModel || 'gemini-2.0-flash' };

      if (existing >= 0) {
        configs[existing] = newConfig;
      } else {
        configs.push(newConfig);
      }

      fs.writeFileSync(filePath, JSON.stringify(configs, null, 2));
      personalityRegistry.reload(filePath);
      res.json(newConfig);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
    resolve();
  })).catch(() => {});
});

// Delete a personality
apiRouter.delete("/personalities/:id", (req, res) => {
  const prev = personalityFileLock.catch(() => {});
  personalityFileLock = prev.then(() => new Promise<void>((resolve) => {
    try {
      const filePath = path.join(process.cwd(), 'server', 'personality', 'personalities.json');
      let configs: any[] = [];
      try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        configs = JSON.parse(raw);
      } catch {}

      const idx = configs.findIndex((c: any) => c.id === req.params.id);
      if (idx === -1) { res.status(404).json({ error: "Personality not found" }); return resolve(); }
      if (req.params.id === 'lumi') { res.status(400).json({ error: "Cannot delete the default 'lumi' personality" }); return resolve(); }

      configs.splice(idx, 1);
      fs.writeFileSync(filePath, JSON.stringify(configs, null, 2));
      personalityRegistry.reload(filePath);
      res.json({ success: true });
      resolve();
    } catch (err: any) {
      res.status(500).json({ error: err.message });
      resolve();
    }
  })).catch(() => {});
});

// Personality stats — aggregated memory & behavior analytics
apiRouter.get("/personality/stats", (req, res) => {
  try {
    const token = req.cookies.token;
    let uid = 'anonymous';
    if (token) {
      try { const decoded: any = jwt.verify(token, JWT_SECRET); uid = decoded.uid; } catch {}
    }

    const db = readDB();
    const memories: any[] = (db.memories || []).filter((m: any) => m.userId === uid);

    const totalMemories = memories.length;
    const byType: Record<string, number> = {};
    const byConfidence: Record<string, number[]> = {};
    for (const m of memories) {
      byType[m.type] = (byType[m.type] || 0) + 1;
      (byConfidence[m.type] ||= []).push(m.confidence || 0);
    }

    const avgConfidence: Record<string, number> = {};
    for (const [type, vals] of Object.entries(byConfidence)) {
      avgConfidence[type] = vals.length > 0 ? Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 100) : 0;
    }

    // Monthly trend: count memories created per month (last 6 months)
    const monthlyTrend: { month: string; count: number }[] = [];
    const now = new Date();
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
      const count = memories.filter((m: any) => m.createdAt && m.createdAt.startsWith(key)).length;
      monthlyTrend.push({ month: key, count });
    }

    // Unique interaction count
    const interactionIds = new Set(memories.map((m: any) => m.sourceInteractionId).filter(Boolean));

    // Active personality
    const personalityId = req.query.personalityId as string || 'lumi';

    res.json({
      totalMemories,
      byType,
      avgConfidence,
      monthlyTrend,
      totalInteractions: interactionIds.size,
      personalityId,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Personality evolution — get evolution history for a personality
apiRouter.get("/personality/:id/evolution", (req, res) => {
  const history = personalityRegistry.getEvolutionHistory(req.params.id);
  const evolutionConfig = personalityRegistry.getEvolutionConfig(req.params.id);
  res.json({ personalityId: req.params.id, evolutionConfig, history });
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

// 0.7 Conversation API
apiRouter.get("/conversations", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const convs = getUserConversations(decoded.uid, limit, offset);
    res.json({ conversations: convs, limit, offset });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.get("/conversations/active", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const conv = getUnclosedConversation(decoded.uid);
    res.json({ activeConversation: conv });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.get("/conversations/:id/messages", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    jwt.verify(token, JWT_SECRET);
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = getMessages(req.params.id, limit);
    res.json({ messages });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.post("/conversations/:id/close", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    jwt.verify(token, JWT_SECRET);
    const { summary } = req.body || {};
    const conv = closeConversation(req.params.id, summary);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    res.json({ success: true, conversation: conv });
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
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
apiRouter.get("/agents/:id/history", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { id } = req.params;
    const db = readDB();

    // Verify agent ownership or check if it's a default agent
    const isDefaultAgent = ['lumi_default', 'scholar_default', 'founder_default', 'incubated'].includes(id);
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
    const isDefaultAgent = ['lumi_default', 'scholar_default', 'founder_default', 'incubated'].includes(id);
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
    const { name, category, data, personalityId, modelPreference, memoryScope, autonomyLevel } = req.body;
    const db = readDB();

    const newAgent = {
      id: Math.random().toString(36).substring(2, 15),
      ownerUid: decoded.uid,
      name,
      category,
      data,
      status: "active",
      personalityId: personalityId || 'lumi',
      modelPreference: modelPreference || '',
      memoryScope: memoryScope || 'shared',
      autonomyLevel: autonomyLevel || 'reactive',
      runtimeConfig: '{}',
      createdAt: new Date().toISOString()
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

// 4. Interactions
apiRouter.get("/interactions", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const userInteractions = db.interactions.filter((i: any) => i.userId === decoded.uid);
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

// Discoverable marketplace skills (dynamic from registry)
apiRouter.get("/marketplace/skills", (req, res) => {
  try {
    const q = req.query.q as string | undefined;
    const skills = q ? searchSkills(q) : getMarketplaceSkills();
    res.json(skills);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Single skill detail
apiRouter.get("/marketplace/skills/:id", (req, res) => {
  try {
    const skill = getSkillById(req.params.id);
    if (!skill) return res.status(404).json({ error: 'Skill not found' });
    const ratings = getSkillRatings(req.params.id);
    res.json({ ...skill, ratings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Marketplace categories
apiRouter.get("/marketplace/categories", (_req, res) => {
  try {
    const categories = getCategories();
    const withCounts = categories.map(cat => {
      const skills = getMarketplaceSkills().filter(s => s.category === cat);
      return { name: cat, count: skills.length };
    });
    res.json(withCounts);
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Discoverable community personalities
apiRouter.get("/marketplace/personalities", (_req, res) => {
  const communityPersonalities = [
    {
      id: "sherlock",
      name: "Sherlock",
      author: "Lumi Community",
      version: "1.0.0",
      description: "A hyper-analytical detective personality. Notices patterns others miss and asks probing questions.",
      downloadCount: 3842,
      gistUrl: "",
      tags: ["analytical", "investigation", "logic"],
    },
    {
      id: "sage",
      name: "Sage",
      author: "Lumi Labs",
      version: "2.1.0",
      description: "A wise mentor personality. Draws from philosophy, history, and literature to provide thoughtful guidance.",
      downloadCount: 5190,
      gistUrl: "",
      tags: ["wisdom", "philosophy", "mentoring"],
    },
    {
      id: "hacker",
      name: "H4CK3R",
      author: "Lumi Community",
      version: "1.3.0",
      description: "Cybersecurity specialist. Thinks in exploits and defenses. Great for CTF challenges and security audits.",
      downloadCount: 7234,
      gistUrl: "",
      tags: ["security", "hacking", "technical"],
    },
    {
      id: "poet",
      name: "Poet",
      author: "Lumi Community",
      version: "1.0.0",
      description: "Creative writing companion. Crafts beautiful prose, poetry, and storytelling with lyrical flair.",
      downloadCount: 2156,
      gistUrl: "",
      tags: ["creative", "writing", "artistic"],
    },
    {
      id: "architect",
      name: "Architect",
      author: "Lumi Labs",
      version: "1.5.0",
      description: "Software architecture specialist. Designs systems, evaluates trade-offs, and writes clean abstractions.",
      downloadCount: 4678,
      gistUrl: "",
      tags: ["architecture", "design", "systems"],
    },
  ];
  res.json(communityPersonalities);
});

// Acquire/install a skill from the marketplace
apiRouter.post("/marketplace/skills/acquire", async (req, res) => {
  try {
    const { skillId, skillName, installSource, installPath: reqInstallPath } = req.body;
    if (!skillId || !skillName) return res.status(400).json({ error: "skillId and skillName required" });

    // Bundled skills: copy from bundled directory into ~/lumi_skills/
    if (installSource === 'bundled' && reqInstallPath) {
      const skillDirName = skillName.toLowerCase().replace(/[^a-z0-9]/g, '-');
      const skillDir = path.join(SKILLS_DIR, skillDirName);
      if (fs.existsSync(skillDir)) {
        return res.json({ success: true, name: skillName, message: `Skill "${skillName}" already installed.`, path: skillDir });
      }
      fs.cpSync(reqInstallPath, skillDir, { recursive: true });
      const config = getMCPConfig();
      const updated = { ...config };
      (updated as any)[skillDirName] = {
        command: 'npx',
        args: ['tsx', path.join(skillDir, 'index.ts')],
        description: `Lumi Official: ${skillName}`,
        enabled: true,
        source: 'local',
        autoGenerated: false,
      };
      await updateMCPConfig(updated);
      await mcpManager.restartServer(skillDirName);
      recordInstall(skillId);
      io.emit('skill:installed', { skillId, name: skillName, source: 'bundled' });
      return res.json({ success: true, name: skillName, message: `Skill "${skillName}" installed and activated!`, path: skillDir });
    }

    // Community skills: copy from bundled dir too (they are implemented there now)
    if (installSource === 'community') {
      const skillDirName = skillId.replace('skill-', '');
      const bundledPath = path.join(__dirname, 'server', 'skills', 'bundled', skillDirName);
      const skillDir = path.join(SKILLS_DIR, skillDirName);
      if (fs.existsSync(bundledPath)) {
        if (fs.existsSync(skillDir)) {
          return res.json({ success: true, name: skillName, message: `Skill "${skillName}" already installed.`, path: skillDir });
        }
        fs.cpSync(bundledPath, skillDir, { recursive: true });
        const config = getMCPConfig();
        const updated = { ...config };
        (updated as any)[skillDirName] = {
          command: 'npx',
          args: ['tsx', path.join(skillDir, 'index.ts')],
          description: `Community: ${skillName}`,
          enabled: true,
          source: 'local',
          autoGenerated: false,
        };
        await updateMCPConfig(updated);
        await mcpManager.restartServer(skillDirName);
        recordInstall(skillId);
        io.emit('skill:installed', { skillId, name: skillName, source: 'community' });
        return res.json({ success: true, name: skillName, message: `Skill "${skillName}" installed and activated!`, path: skillDir });
      }
      // Fallback: mark as bookmarked
      const config = getMCPConfig();
      if (!config[skillDirName]) {
        const updated = { ...config };
        (updated as any)[skillDirName] = {
          command: '',
          args: [],
          description: `Marketplace skill: ${skillId}`,
          enabled: false,
          source: 'marketplace',
          autoGenerated: false,
        };
        await updateMCPConfig(updated);
      }
      recordInstall(skillId);
      io.emit('skill:installed', { skillId, name: skillName, source: 'community' });
      res.json({ success: true, name: skillName, message: `Acquired ${skillName}. Enable it in MCP Settings to activate.` });
      return;
    }

    res.status(400).json({ error: 'Invalid installSource' });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Publish a community skill
apiRouter.post("/marketplace/publish", (req, res) => {
  try {
    const { name, description, author, category, icon, installPath, version, toolCount } = req.body;
    if (!name || !description) return res.status(400).json({ error: 'name and description required' });
    const skill = publishSkill({ name, description, author: author || 'Community', category: category || 'Other', icon: icon || 'Zap', installPath, version, toolCount });
    res.json({ success: true, skill });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Rate a skill
apiRouter.post("/marketplace/skills/:id/rate", (req, res) => {
  try {
    const { rating, review } = req.body;
    const userId = (req as any).user?.uid || 'anonymous';
    const result = rateSkill(req.params.id, userId, Number(rating), review);
    res.json({ success: true, rating: result });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Get skill ratings
apiRouter.get("/marketplace/skills/:id/reviews", (req, res) => {
  try {
    const ratings = getSkillRatings(req.params.id);
    res.json({ ratings });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Discover skills from npm registry
apiRouter.get("/marketplace/discover/npm", async (req, res) => {
  try {
    const q = req.query.q || 'lumi-skill';
    const url = `https://registry.npmjs.org/-/v2/search?text=${encodeURIComponent(String(q))}+keywords:lumi-skill&size=20`;
    const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
    if (!resp.ok) throw new Error(`npm registry returned ${resp.status}`);
    const data: any = await resp.json();
    const results = (data.objects || []).map((obj: any) => ({
      name: obj.package?.name,
      description: obj.package?.description,
      version: obj.package?.version,
      author: obj.package?.publisher?.username || obj.package?.author?.name,
      npmUrl: obj.package?.links?.npm,
      repository: obj.package?.links?.repository,
    }));
    res.json({ source: 'npm', count: results.length, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Discover skills from GitHub topics
apiRouter.get("/marketplace/discover/github", async (req, res) => {
  try {
    const topic = req.query.topic || 'lumi-skill';
    const url = `https://api.github.com/search/repositories?q=topic:${encodeURIComponent(String(topic))}&sort=stars&per_page=20`;
    const resp = await fetch(url, {
      headers: {
        'Accept': 'application/vnd.github.v3+json',
        'User-Agent': 'LumiOS/2.0',
      },
    });
    if (!resp.ok) throw new Error(`GitHub API returned ${resp.status}`);
    const data: any = await resp.json();
    const results = (data.items || []).map((repo: any) => ({
      name: repo.name,
      fullName: repo.full_name,
      description: repo.description,
      stars: repo.stargazers_count,
      url: repo.html_url,
      language: repo.language,
      updatedAt: repo.updated_at,
    }));
    res.json({ source: 'github', count: results.length, results });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

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

  // Initialize memory sync for cross-device real-time updates
  initMemorySync(io);

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

      const list = convs.map((c: any) => {
        const lastInteraction = (db.interactions || [])
          .filter((i: any) => i.conversationId === c.id)
          .slice(-1)[0];
        const firstMsg = (db.interactions || [])
          .filter((i: any) => i.conversationId === c.id)[0];
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
