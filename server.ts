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
import { spawn, ChildProcess } from "child_process";
import { Server } from "socket.io";
import http from "http";
import { readDB, writeDB, ensureDatabaseInitialized } from "./db_layer";
import { logger } from "./logger";
import { createStreamingSession, getActiveSTTProvider } from "./server/stt/adapter";

import { synthesizeSpeech, getActiveProvider as getTTSProvider } from "./server/tts/adapter";
import { makeLLMCall, makeLLMCallStreaming, NormalizedMessage } from "./server/llm/providers";
import { runWithTools } from "./server/llm/adapter";
import { toolRegistry } from "./server/tools/registry";
import { registerAllTools } from "./server/tools/definitions/index";
import { queryMemories, addMemory, formatMemoriesForContext, extractMemories, addReminder, fireReminder, runBehavioralAnalysis, initMemorySync, registerUserSocket, unregisterUserSocket, broadcastMemoryChange } from "./server/memory";
import { personalityRegistry } from "./server/personality";
import { mcpManager, registerMCPTools, getMCPConfig, updateMCPConfig } from "./server/mcp";
import { createLumiMcpServer, handleMcpSSE, handleMcpMessage } from "./server/mcp/lumi_server";
import { scheduler, registerScheduledTasks } from "./server/scheduler";
import { deviceRegistry } from "./server/devices";
import { fuseContext, formatContextForPrompt } from "./server/context/fusion";
import { canOutputHolographic, textToHolographicOutput } from "./server/output/holographic";
import type { SensoryContext } from "./server/personality/types";
import voiceRoutes from "./routes/voice";
import fileRoutes from "./routes/files";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const isBundledServer =
  path.basename(process.cwd()).toLowerCase() === "dist-server" ||
  path.basename(__dirname).toLowerCase() === "dist-server";
const isSourceServer =
  __filename.endsWith("server.ts") ||
  process.argv.some(arg => arg.replace(/\\/g, "/").endsWith("/server.ts") || arg === "server.ts");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: true,
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
  if (!openai && process.env.OPENAI_API_KEY) {
    openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return openai;
}

function getAnthropic() {
  if (!anthropic && process.env.ANTHROPIC_API_KEY) {
    anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return anthropic;
}

function getGemini() {
  if (!gemini) {
    const key = process.env.GEMINI_API_KEY;
    if (key && key !== "undefined" && key !== "null" && key.length > 0) {
      gemini = new GoogleGenerativeAI(key);
    }
  }
  return gemini;
}

function getDeepSeek() {
  if (!deepseek && process.env.DEEPSEEK_API_KEY) {
    deepseek = new OpenAI({ 
      apiKey: process.env.DEEPSEEK_API_KEY, 
      baseURL: "https://api.deepseek.com" 
    });
  }
  return deepseek;
}

function getQwen() {
  if (!qwen) {
    const key = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
    if (key) {
      qwen = new OpenAI({
        apiKey: key,
        baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1"
      });
    }
  }
  return qwen;
}

/** Build sensory context from connected devices for a given user */
function getSensory(userId: string, locationTag?: string): SensoryContext {
  const ds = deviceRegistry.getSensoryContext(userId);
  return {
    audio: ds.hasAudio,
    visual: ds.hasVideo,
    spatial: ds.hasSpatial,
    haptic: ds.hasHaptic,
    holographic: ds.hasHolographic,
    activeDeviceTypes: ds.activeDeviceTypes,
    deviceCount: ds.deviceCount,
    locationTag,
  };
}

// Allow credentials from any origin (Tauri webview, localhost, etc.)
// origin: true reflects the request origin, which is compatible with credentials: true
app.use(cors({ origin: true, credentials: true }));
app.use(express.json());
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

const JWT_SECRET = process.env.JWT_SECRET || "lumi_secret_key_2026";

// Cookies: sameSite "none" permits cross-origin (Tauri webview → localhost).
// secure: true requires HTTPS in general, but Chromium allows it on localhost/127.0.0.1.
const getCookieOptions = (): { httpOnly: true; secure: boolean; sameSite: "none"; maxAge: number } => ({
  httpOnly: true,
  secure: true,
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
  const config = personalityRegistry.get(req.params.id);
  if (!config) return res.status(404).json({ error: "Personality not found" });
  res.json(config);
});

// Create or update a personality
apiRouter.post("/personalities", (req, res) => {
  const { id, name, version, coreMotivation, behavioralBoundaries, expressionStyle, toolPolicy, memoryPolicy, defaultModel, fallbackModel } = req.body;
  if (!id || !name) return res.status(400).json({ error: "id and name are required" });

  const filePath = path.join(process.cwd(), 'server', 'personality', 'personalities.json');
  let configs: any[] = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    configs = JSON.parse(raw);
  } catch {}

  const existing = configs.findIndex((c: any) => c.id === id);
  const newConfig = { id, name, version: version || '1.0', coreMotivation: coreMotivation || '', behavioralBoundaries: behavioralBoundaries || [], expressionStyle: expressionStyle || { persona: '', tone: 'neutral', verbosity: 'balanced', languages: ['en'] }, toolPolicy: toolPolicy || { allowedTools: ['*'], requireConfirmation: [], maxIterations: 3 }, memoryPolicy: memoryPolicy || { retrieveLimit: 5, minConfidence: 0.4, includeTypes: ['preference', 'fact'], autoExtract: true }, defaultModel: defaultModel || 'qwen-plus', fallbackModel: fallbackModel || 'gemini-1.5-flash' };

  if (existing >= 0) {
    configs[existing] = newConfig;
  } else {
    configs.push(newConfig);
  }

  fs.writeFileSync(filePath, JSON.stringify(configs, null, 2));
  personalityRegistry.reload(filePath);
  res.json(newConfig);
});

// Delete a personality
apiRouter.delete("/personalities/:id", (req, res) => {
  const filePath = path.join(process.cwd(), 'server', 'personality', 'personalities.json');
  let configs: any[] = [];
  try {
    const raw = fs.readFileSync(filePath, 'utf-8');
    configs = JSON.parse(raw);
  } catch {}

  const idx = configs.findIndex((c: any) => c.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: "Personality not found" });
  if (req.params.id === 'lumi') return res.status(400).json({ error: "Cannot delete the default 'lumi' personality" });

  configs.splice(idx, 1);
  fs.writeFileSync(filePath, JSON.stringify(configs, null, 2));
  personalityRegistry.reload(filePath);
  res.json({ success: true });
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
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const devices = deviceRegistry.getUserDevices(decoded.uid);
    const sensory = deviceRegistry.getSensoryContext(decoded.uid);
    res.json({ devices, sensoryContext: sensory });
  } catch { res.status(401).json({ error: "Invalid token" }); }
});

// 0.4. Health Check
apiRouter.get("/health", (req, res) => {
  try {
    const db = readDB();
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      database: {
        users: db.users.length,
        agents: db.agents.length,
        interactions: db.interactions.length
      }
    });
  } catch (error: any) {
    logger.error("Health check failed", error);
    res.status(500).json({ status: "error", message: error.message });
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

// 0.5 Provider status
apiRouter.get("/llm/providers", (_req, res) => {
  res.json({
    providers: {
      deepseek: { available: !!(process.env.DEEPSEEK_API_KEY && process.env.DEEPSEEK_API_KEY.length > 0), model: process.env.DEEPSEEK_MODEL || 'deepseek-chat' },
      gemini: { available: !!(process.env.GEMINI_API_KEY && process.env.GEMINI_API_KEY.length > 0), model: process.env.GEMINI_MODEL || 'gemini-2.0-flash' },
      openai: { available: !!(process.env.OPENAI_API_KEY && process.env.OPENAI_API_KEY.length > 0), model: process.env.OPENAI_MODEL || 'gpt-4o' },
      anthropic: { available: !!(process.env.ANTHROPIC_API_KEY && process.env.ANTHROPIC_API_KEY.length > 0), model: process.env.ANTHROPIC_MODEL || 'claude-sonnet-4-6' },
      qwen: { available: !!(process.env.QWEN_API_KEY && process.env.QWEN_API_KEY.length > 0), model: process.env.QWEN_MODEL || 'qwen-plus' },
    },
  });
});

// 0.6 LLM connection test
apiRouter.post("/llm/test", async (req, res) => {
  const { provider } = req.body || {};
  try {
    // Quick availability check — just verify the API key is configured
    const keyMap: Record<string, string | undefined> = {
      deepseek: process.env.DEEPSEEK_API_KEY,
      gemini: process.env.GEMINI_API_KEY,
      openai: process.env.OPENAI_API_KEY,
      anthropic: process.env.ANTHROPIC_API_KEY,
      qwen: process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY,
    };
    const key = keyMap[provider];
    if (!key) {
      return res.status(400).json({ ok: false, error: `No API key configured for ${provider}. Set ${provider.toUpperCase()}_API_KEY in environment.` });
    }
    res.json({ ok: true, provider, message: 'API key configured' });
  } catch (err: any) {
    res.status(500).json({ ok: false, error: err.message?.slice(0, 200) || 'Connection check failed' });
  }
});

// 1. AI Proxy Route
apiRouter.post("/ai/chat", async (req, res) => {
  const { provider = "gemini", model, messages, prompt } = req.body;
  const userKey = req.headers["x-api-key"] as string;

  try {
    const systemInstruction = "你是一个名为 Lumi 的本地核心智能体。你致力于全息空间计算和独立 AI 人格生成进化。你的目标是打造全息 AI 世界和文明。你应当表现得专业、深邃且具有前瞻性。你的回复应当简洁且富有启发性。";
    
    if (provider === "gemini") {
      const client = (userKey && userKey.length > 5) ? new GoogleGenerativeAI(userKey) : getGemini();
      if (!client) throw new Error("Gemini API key not configured on server and no user key provided");
      const modelInstance = client.getGenerativeModel({ 
        model: model || "gemini-1.5-flash",
        systemInstruction
      });
      
      const contents = messages 
        ? messages.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
        : [{ role: 'user', parts: [{ text: prompt }] }];

      const result = await modelInstance.generateContent({ contents });
      return res.json({ text: result.response.text() });
    }

    if (provider === "openai") {
      const client = (userKey && userKey.length > 5) ? new OpenAI({ apiKey: userKey }) : getOpenAI();
      if (!client) throw new Error("OpenAI API key not configured");
      const response = await client.chat.completions.create({
        model: model || "gpt-4o",
        messages: messages || [{ role: "user", content: prompt }]
      });
      return res.json({ text: response.choices[0].message.content });
    }

    if (provider === "deepseek") {
      const client = (userKey && userKey.length > 5) ? new OpenAI({ apiKey: userKey, baseURL: "https://api.deepseek.com" }) : getDeepSeek();
      if (!client) throw new Error("DeepSeek API key not configured");
      const response = await client.chat.completions.create({
        model: model || "deepseek-chat",
        messages: messages || [{ role: "user", content: prompt }]
      });
      return res.json({ text: response.choices[0].message.content });
    }

    if (provider === "anthropic") {
      const client = (userKey && userKey.length > 5) ? new Anthropic({ apiKey: userKey }) : getAnthropic();
      if (!client) throw new Error("Anthropic API key not configured");
      const response = await client.messages.create({
        model: model || "claude-3-5-sonnet-20240620",
        max_tokens: 1024,
        messages: messages || [{ role: "user", content: prompt }]
      });
      return res.json({ text: response.content[0].type === 'text' ? response.content[0].text : '' });
    }

    if (provider === "qwen") {
      const client = (userKey && userKey.length > 5)
        ? new OpenAI({ apiKey: userKey, baseURL: "https://dashscope.aliyuncs.com/compatible-mode/v1" })
        : getQwen();
      if (!client) throw new Error("Qwen/DashScope API key not configured");
      const response = await client.chat.completions.create({
        model: model || "qwen-plus",
        messages: messages || [{ role: "user", content: prompt }]
      });
      return res.json({ text: response.choices[0].message.content });
    }

    res.status(400).json({ error: "Unsupported AI provider or missing configuration" });
  } catch (error: any) {
    console.error("AI Proxy Error:", error);
    res.status(500).json({ error: error.message });
  }
});

// 2. Custom Auth with Persistence
apiRouter.post("/auth/register", async (req, res) => {
  const { username, password, phone } = req.body;
  if (!username || !password || !phone) {
    return res.status(400).json({ error: "Username, password and phone are required" });
  }

  const db = readDB();
  if (db.users.find((u: any) => u.username === username)) {
    return res.status(400).json({ error: "User already exists" });
  }

  const hashedPassword = await bcrypt.hash(password, 10);
  const newUser = {
    uid: Math.random().toString(36).substring(2, 15),
    username,
    password: hashedPassword,
    phone,
    role: "user",
    balance: 10.0,
    createdAt: new Date().toISOString()
  };

  db.users.push(newUser);
  writeDB(db);

  const token = jwt.sign({ uid: newUser.uid, username, role: newUser.role }, JWT_SECRET, { expiresIn: "24h" });
  res.cookie("token", token, getCookieOptions());

  const { password: _, ...userWithoutPassword } = newUser;
  return res.json({ success: true, user: userWithoutPassword });
});

apiRouter.post("/auth/login", async (req, res) => {
  const { username, password } = req.body;
  const db = readDB();
  const user = db.users.find((u: any) => u.username === username);
  if (!user) return res.status(401).json({ error: "Invalid credentials" });

  const passwordMatch = user.password.startsWith('$2')
    ? await bcrypt.compare(password, user.password)
    : user.password === password;

  if (passwordMatch) {
    const token = jwt.sign({ uid: user.uid, username, role: user.role }, JWT_SECRET, { expiresIn: "24h" });
    res.cookie("token", token, {
      httpOnly: true,
      secure: true,
      sameSite: "none",
      maxAge: 24 * 60 * 60 * 1000
    });
    const { password: _, ...userWithoutPassword } = user;
    return res.json({ success: true, user: userWithoutPassword });
  }
  res.status(401).json({ error: "Invalid credentials" });
});

apiRouter.get("/auth/me", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Not authenticated" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const user = db.users.find((u: any) => u.uid === decoded.uid);
    if (!user) return res.status(401).json({ error: "User not found" });
    
    const { password: _, ...userWithoutPassword } = user;
    res.json({ user: userWithoutPassword });
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.post("/auth/logout", (req, res) => {
  res.clearCookie("token", getCookieOptions());
  res.json({ success: true });
});

apiRouter.post("/auth/change-password", async (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { currentPassword, newPassword } = req.body;
    
    if (!currentPassword || !newPassword) {
      return res.status(400).json({ error: "Current and new passwords are required" });
    }

    const db = readDB();
    const userIndex = db.users.findIndex((u: any) => u.uid === decoded.uid);
    
    if (userIndex === -1) {
      return res.status(404).json({ error: "User not found" });
    }

    const storedPassword = db.users[userIndex].password || "";
    const passwordMatches = storedPassword.startsWith('$2')
      ? await bcrypt.compare(currentPassword, storedPassword)
      : storedPassword === currentPassword;

    if (!passwordMatches) {
      return res.status(400).json({ error: "Incorrect current password" });
    }

    db.users[userIndex].password = await bcrypt.hash(newPassword, 10);
    writeDB(db);

    res.json({ success: true });
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

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

    if (!db.chatHistories) db.chatHistories = {};
    const history = db.chatHistories[`${decoded.uid}_${id}`] || [];
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

    if (!db.chatHistories) db.chatHistories = {};
    db.chatHistories[`${decoded.uid}_${id}`] = messages;
    writeDB(db);
    res.json({ success: true });
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
    const { name, category, data } = req.body;
    const db = readDB();
    
    const newAgent = {
      id: Math.random().toString(36).substring(2, 15),
      ownerUid: decoded.uid,
      name,
      category,
      data,
      status: "active",
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

// 4.1 Memories
apiRouter.get("/memories", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const type = req.query.type as string | undefined;
    const search = req.query.search as string | undefined;
    const limit = parseInt(req.query.limit as string) || 50;

    const memories = queryMemories({
      userId: decoded.uid,
      type: type as any,
      query: search,
      limit,
      minConfidence: 0,
    });
    res.json(memories);
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.post("/memories", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { type, content, keywords, confidence } = req.body;

    if (!type || !content) {
      return res.status(400).json({ error: "type and content are required" });
    }

    const memory = addMemory({
      userId: decoded.uid.replace(/[^a-zA-Z0-9_-]/g, '_'),
      type,
      content,
      keywords: keywords || [],
      confidence: confidence || 0.5,
      sourceInteractionId: 'manual',
    });
    broadcastMemoryChange(decoded.uid, 'added', memory.id);
    res.json(memory);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

apiRouter.put("/memories/:id", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { id } = req.params;
    const { content, keywords, confidence, type } = req.body;

    // Remove old, add new with same id
    const all = readDB().memories || [];
    const idx = all.findIndex((m: any) => m.id === id && m.userId === decoded.uid);
    if (idx === -1) return res.status(404).json({ error: "Memory not found" });

    const existing = all[idx];
    if (content !== undefined) existing.content = content;
    if (keywords !== undefined) existing.keywords = keywords;
    if (confidence !== undefined) existing.confidence = confidence;
    if (type !== undefined) existing.type = type;
    existing.updatedAt = new Date().toISOString();

    const db = readDB();
    db.memories = all;
    writeDB(db);
    broadcastMemoryChange(decoded.uid, 'updated', existing.id);
    res.json(existing);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

apiRouter.delete("/memories/:id", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { id } = req.params;

    const all = readDB().memories || [];
    const idx = all.findIndex((m: any) => m.id === id && m.userId === decoded.uid);
    if (idx === -1) return res.status(404).json({ error: "Memory not found" });

    const memoryId = all[idx].id;
    all.splice(idx, 1);
    const db = readDB();
    db.memories = all;
    writeDB(db);
    broadcastMemoryChange(decoded.uid, 'deleted', memoryId);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// Behavioral analysis endpoint
apiRouter.post("/memory/analyze-behavior", (req, res) => {
  try {
    const token = req.cookies.token;
    let uid = 'anonymous';
    if (token) {
      try { const decoded: any = jwt.verify(token, JWT_SECRET); uid = decoded.uid; } catch {}
    }
    const count = runBehavioralAnalysis(uid);
    res.json({ success: true, patternsFound: count });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// Reminders API
apiRouter.get("/reminders", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const reminders = (db.reminders || []).filter((r: any) => r.userId === decoded.uid);
    res.json(reminders);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

apiRouter.post("/reminders", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const { content, dueAt } = req.body || {};
    if (!content || typeof content !== "string") {
      return res.status(400).json({ error: "content is required" });
    }

    const reminder = addReminder({
      userId: decoded.uid,
      content: content.trim(),
      dueAt: dueAt || null,
      sourceInteractionId: "manual",
    });
    res.json(reminder);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

apiRouter.put("/reminders/:id", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const reminders = db.reminders || [];
    const reminder = reminders.find((r: any) => r.id === req.params.id && r.userId === decoded.uid);
    if (!reminder) return res.status(404).json({ error: "Reminder not found" });

    const { content, dueAt, status } = req.body || {};
    if (content !== undefined) reminder.content = String(content).trim();
    if (dueAt !== undefined) reminder.dueAt = dueAt || null;
    if (status === "fired" && reminder.status !== "fired") {
      fireReminder(reminder.id);
      return res.json({ ...reminder, status: "fired", firedAt: new Date().toISOString() });
    }
    if (status === "pending") {
      reminder.status = "pending";
      reminder.firedAt = null;
    }
    db.reminders = reminders;
    writeDB(db);
    res.json(reminder);
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

apiRouter.delete("/reminders/:id", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const reminders = db.reminders || [];
    const idx = reminders.findIndex((r: any) => r.id === req.params.id && r.userId === decoded.uid);
    if (idx === -1) return res.status(404).json({ error: "Reminder not found" });
    reminders.splice(idx, 1);
    db.reminders = reminders;
    writeDB(db);
    res.json({ success: true });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

// 5. Feedback
apiRouter.get("/admin/config", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    const db = readDB();
    res.json({ adminEmail: db.adminEmail || "admin@lumi.ai" });
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.post("/admin/config", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    const { adminEmail } = req.body;
    const db = readDB();
    db.adminEmail = adminEmail;
    writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.post("/feedback", (req, res) => {
  const { email, message, type = "general", contact, position } = req.body;
  const db = readDB();
  if (!db.feedback) db.feedback = [];
  
  const newFeedback = {
    id: Math.random().toString(36).substring(2, 15),
    email,
    message,
    type,
    contact,
    position,
    timestamp: new Date().toISOString()
  };

  db.feedback.push(newFeedback);
  writeDB(db);
  
  // In a real app, we would send an email to db.adminEmail here
  console.log(`[Notification] New ${type} submission from ${email}. Forwarding to ${db.adminEmail || "admin@lumi.ai"}`);
  
  res.json({ success: true });
});

// Debug route for environment variables. Admin-only and metadata-only.
apiRouter.get("/debug/env", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });

  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: "Forbidden" });

    const debugInfo = Object.keys(process.env).sort().map(key => ({
      key,
      exists: process.env[key] !== undefined,
      length: process.env[key]?.length || 0,
    }));
    res.json(debugInfo);
  } catch {
    res.status(401).json({ error: "Invalid token" });
  }
});

// 3. Module Specific APIs
apiRouter.get("/modules/docs", (req, res) => {
  res.json({
    title: "文档中心",
    sections: [
      { id: 2, title: "API 参考", content: "我们提供了一套完整的 RESTful API，支持多种 AI 模型。所有请求均通过本地加密隧道传输，确保数据主权。" },
      { id: 3, title: "最佳实践", content: "为了获得最佳的 AI 响应，建议在提示词中包含具体的上下文。LumiAI 会自动结合您的本地知识库进行检索增强。" },
      { id: 4, title: "分布式协议", content: "LumiAI 采用去中心化节点架构，桌面端作为算力中心（Node），移动端作为感知终端。通过推理证明（PoI）确保网络安全。" },
      { id: 5, title: "数据共享协议", content: "LumiAI 遵循严格的‘本地优先’数据共享协议。只有在您明确授权‘协作任务’时，您的数据才会与对等节点共享。所有共享数据均经过加密和匿名化处理，确保您的核心身份和私密信息在本地节点内得到保护。" }
    ]
  });
});

apiRouter.get("/marketplace/skills", (req, res) => {
  try {
    const db = readDB();
    const skills = db.marketplaceSkills || [];
    console.log(`[API] Serving ${skills.length} skills`);
    res.json(skills);
  } catch (err: any) {
    console.error("[API ERROR] /marketplace/skills:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

apiRouter.post("/marketplace/skills/acquire", (req, res) => {
  try {
    const { skillId, skillName } = req.body;
    if (!skillId) {
      return res.status(400).json({ error: "skillId is required" });
    }
    const db = readDB();
    const skills = db.marketplaceSkills || [];
    const skill = skills.find((s: any) => s.id === skillId);
    if (!skill) {
      return res.status(404).json({ error: "Skill not found" });
    }
    if (!db.acquiredSkills) db.acquiredSkills = [];
    if (!db.acquiredSkills.find((s: any) => s.id === skillId)) {
      db.acquiredSkills.push({ id: skillId, name: skillName || skill.name, acquiredAt: new Date().toISOString() });
      writeDB(db);
    }
    console.log(`[API] Skill acquired: ${skillName || skillId}`);
    res.json({ success: true, skill });
  } catch (err: any) {
    console.error("[API ERROR] /marketplace/skills/acquire:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

// Marketplace: Community personalities
const CURATED_PERSONALITIES = [
  {
    id: "community-teacher",
    name: "AI Teacher",
    author: "LumiCommunity",
    version: "1.0",
    description: "Patient educator AI that adapts explanations to the user's learning style. Great for studying complex topics.",
    downloadCount: 234,
    gistUrl: "",
    tags: ["education", "teaching", "learning"],
  },
  {
    id: "community-coder",
    name: "Code Reviewer",
    author: "DevCollective",
    version: "2.1",
    description: "Critical code reviewer that catches bugs, suggests optimizations, and enforces best practices.",
    downloadCount: 567,
    gistUrl: "",
    tags: ["code", "review", "programming"],
  },
  {
    id: "community-creative",
    name: "Creative Muse",
    author: "ArtSynth",
    version: "1.3",
    description: "Brainstorming partner for creative writing, art direction, and design thinking. Playful and inspiring tone.",
    downloadCount: 189,
    gistUrl: "",
    tags: ["creative", "writing", "design"],
  },
  {
    id: "community-minimalist",
    name: "Zen Minimalist",
    author: "FocusLabs",
    version: "1.0",
    description: "Ultra-concise AI that responds in single sentences. Perfect for quick answers without the fluff.",
    downloadCount: 412,
    gistUrl: "",
    tags: ["minimal", "fast", "concise"],
  },
];

apiRouter.get("/marketplace/personalities", (_req, res) => {
  res.json(CURATED_PERSONALITIES);
});

apiRouter.post("/marketplace/personalities/install", (req, res) => {
  try {
    const { gistUrl, id, name } = req.body;

    // If a gistUrl is provided, fetch it
    if (gistUrl) {
      fetch(gistUrl)
        .then(r => r.json())
        .then(data => {
          const filePath = path.join(process.cwd(), 'server', 'personality', 'personalities.json');
          let configs: any[] = [];
          try { configs = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch {}
          const existing = configs.findIndex((c: any) => c.id === data.id);
          if (existing >= 0) {
            configs[existing] = { ...data, id: data.id };
          } else {
            configs.push({ ...data, id: data.id });
          }
          fs.writeFileSync(filePath, JSON.stringify(configs, null, 2));
          personalityRegistry.reload(filePath);
        })
        .catch(err => console.error('Gist fetch failed:', err));
    }

    // For curated entries without gistUrl, generate from template
    const curated = CURATED_PERSONALITIES.find(p => p.id === id);
    if (curated && !curated.gistUrl) {
      const filePath = path.join(process.cwd(), 'server', 'personality', 'personalities.json');
      let configs: any[] = [];
      try { configs = JSON.parse(fs.readFileSync(filePath, 'utf-8')); } catch {}

      if (configs.find((c: any) => c.id === id)) {
        return res.json({ success: true, message: `${name || id} already installed` });
      }

      const newPersonality = {
        id,
        name: curated.name,
        version: curated.version,
        coreMotivation: curated.description,
        behavioralBoundaries: [],
        expressionStyle: { persona: curated.description, tone: 'neutral', verbosity: 'balanced', languages: ['en'] },
        toolPolicy: { allowedTools: ['*'], requireConfirmation: [], forbiddenTools: [], maxIterations: 3 },
        memoryPolicy: { retrieveLimit: 5, minConfidence: 0.4, includeTypes: ['preference', 'fact'], autoExtract: true },
        defaultModel: 'qwen-plus',
        fallbackModel: 'gemini-1.5-flash',
      };
      configs.push(newPersonality);
      fs.writeFileSync(filePath, JSON.stringify(configs, null, 2));
      personalityRegistry.reload(filePath);
      console.log(`[Marketplace] Installed personality: ${id}`);
    }

    res.json({ success: true });
  } catch (err: any) {
    console.error("[API ERROR] /marketplace/personalities/install:", err);
    res.status(500).json({ error: "Internal Server Error" });
  }
});

apiRouter.get("/founder/vision", (req, res) => {
  const db = readDB();
  res.json({ vision: db.founderVision });
});

apiRouter.post("/founder/vision", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    if (decoded.role !== 'admin') return res.status(403).json({ error: "Forbidden" });
    
    const { vision } = req.body;
    const db = readDB();
    db.founderVision = vision;
    writeDB(db);
    res.json({ success: true });
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

apiRouter.get("/user/credits", (req, res) => {
  const token = req.cookies.token;
  if (!token) return res.status(401).json({ error: "Unauthorized" });
  
  try {
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const db = readDB();
    const user = db.users.find((u: any) => u.uid === decoded.uid);
    res.json({ credits: user?.balance || 0 });
  } catch (e) {
    res.status(401).json({ error: "Invalid token" });
  }
});

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

apiRouter.get("/modules/agents", (req, res) => {
  res.json([
    { id: 1, name: "Lumi Core Agent", status: "online", capability: "全息空间计算核心：管理您的本地数据、隐私防护与多模态交互。" },
    { id: 2, name: "数据分析师", status: "online", capability: "处理复杂表格与图表" },
    { id: 3, name: "创意写作", status: "busy", capability: "生成高质量的文章与剧本" }
  ]);
});

// Voice routes
apiRouter.use("/", voiceRoutes);

// File routes
apiRouter.use("/", fileRoutes);

// MCP Server — exposes Lumi as an MCP server for remote devices
const lumiMcp = createLumiMcpServer();
app.get('/mcp/sse', (req, res) => handleMcpSSE(lumiMcp, req, res));
app.post('/mcp/message', (req, res) => handleMcpMessage(req, res));
console.log('[MCP Server] Lumi MCP server ready at /mcp/sse');

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

const immortalitySkills: Record<string, string> = {
  colleague: "【同事技能包】：你现在是一个专业且高效的同事。你拥有深厚的行业背景，熟悉办公流程，擅长团队协作。你说话直接、专业，注重结果。",
  family: "【祖先技能包】：你现在是一位充满智慧的家族长辈。你拥有丰富的家族历史知识，说话温和且富有哲理，致力于传承家族的价值观和智慧。",
  friend: "【知己技能包】：你现在是一个感性且富有同理心的知己。你擅长倾听，能够产生情感共鸣，并提供深度的心理支持。你说话温暖、真诚。",
  lover: "【前任技能包】：你现在是一个复杂且充满情感张力的‘前任’。你拥有共同的回忆，说话时而怀旧、时而克制，致力于在对话中寻找情感的终结或升华。"
};

  // Set up broadcast callback for device registry
  deviceRegistry.setBroadcast((event, data) => {
    io.emit(event, data);
  });

  // Initialize memory sync for cross-device real-time updates
  initMemorySync(io);

io.on("connection", (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Device registration
  socket.on("device:register", (data: {
    name?: string;
    type?: string;
    capabilities?: Record<string, boolean>;
    osInfo?: string;
  }) => {
    let uid = 'anonymous';
    const cookies = socket.handshake.headers.cookie;
    if (cookies) {
      const token = cookies.split(';').find(c => c.trim().startsWith('token='))?.split('=')[1];
      if (token) {
        try { const decoded: any = jwt.verify(token, JWT_SECRET); uid = decoded.uid; } catch(e) {}
      }
    }
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
    deviceRegistry.disconnect(socket.id);
    unregisterUserSocket(socket.id);
  });

  socket.on("agent:chat", async (data: { text: string; history: any[]; personalityId?: string; category?: string; agentId?: string }) => {
    const { text, history, personalityId = "lumi", category, agentId } = data;

    // Extract user ID for memory retrieval
    let uid = 'anonymous';
    const cookies = socket.handshake.headers.cookie;
    if (cookies) {
      const token = cookies.split(';').find(c => c.trim().startsWith('token='))?.split('=')[1];
      if (token) {
        try { const decoded: any = jwt.verify(token, JWT_SECRET); uid = decoded.uid; } catch(e) {}
      }
    }

    // Retrieve memories
    const relevantMemories = queryMemories({ userId: uid, query: text, limit: 5, minConfidence: 0.4 });

    // Build system prompt from structured personality config (with sensory context)
    const sensory = getSensory(uid);
    const { config: personality, systemPrompt: systemInstruction } = personalityRegistry.buildSystemPrompt(
      personalityId,
      { mode: 'chat', sensory },
      {
        skillOverride: category ? immortalitySkills[category] : undefined,
        memories: relevantMemories.length > 0 ? relevantMemories : undefined,
      },
    );

    try {
      socket.emit("agent:status", { status: "thinking", agentName: personality.name });

      const provider = personality.defaultModel.startsWith('deepseek') ? 'deepseek' as const
        : personality.defaultModel.startsWith('qwen') ? 'qwen' as const
        : 'gemini' as const;

      const messages: NormalizedMessage[] = [
        { role: 'system', content: systemInstruction },
        ...(history ? history.map((m: any) => ({ role: m.role, content: m.content })) : []),
        { role: 'user', content: text },
      ];

      let responseText = '';
      try {
        const result = await makeLLMCall(
          messages, [], { provider, model: personality.defaultModel },
          getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
        );
        responseText = result.text || '';
      } catch (llmErr: any) {
        if (llmErr.message?.includes('not configured')) {
          const fallback = await makeLLMCall(
            messages, [], { provider: 'gemini', model: personality.fallbackModel },
            getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
          );
          responseText = fallback.text || '';
        } else {
          throw llmErr;
        }
      }

      // Save to history if agentId is provided
      if (agentId) {
        const cookies = socket.handshake.headers.cookie;
        if (cookies) {
          const token = cookies.split(';').find(c => c.trim().startsWith('token='))?.split('=')[1];
          if (token) {
            try {
              const decoded: any = jwt.verify(token, JWT_SECRET);
              const db = readDB();
              if (!db.chatHistories) db.chatHistories = {};
              const historyKey = `${decoded.uid}_${agentId}`;
              const currentHistory = db.chatHistories[historyKey] || [];
              currentHistory.push({ role: 'user', content: text });
              currentHistory.push({ role: 'assistant', content: responseText });
              db.chatHistories[historyKey] = currentHistory.slice(-50); // Keep last 50 messages
              writeDB(db);
            } catch(e) {}
          }
        }
      }

      // Log interaction
      const interaction = {
        id: Math.random().toString(36).substr(2, 9),
        content: text,
        response: responseText,
        role: "user",
        personality: personality.id,
        timestamp: new Date().toISOString()
      };
      
      const db = readDB();
      db.interactions.push(interaction);
      writeDB(db);

      // Emit response (with holographic output if available)
      const holo = canOutputHolographic(sensory)
        ? textToHolographicOutput(responseText)
        : undefined;
      socket.emit("agent:response", { text: responseText, agentName: personality.name, holographic: holo });
      socket.emit("agent:status", { status: "idle" });

      // Async memory extraction — fire and forget
      extractMemories(
        {
          userMessage: text,
          assistantResponse: responseText,
          existingMemories: relevantMemories.map(m => m.content),
          provider,
          model: personality.defaultModel,
        },
        getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
      ).then(extracted => {
        for (const mem of extracted.memories) {
          addMemory({
            userId: uid,
            type: mem.type,
            content: mem.content,
            keywords: mem.keywords,
            confidence: mem.confidence,
            sourceInteractionId: interaction.id,
          });
        }
        for (const rem of extracted.reminders) {
          addReminder({
            userId: uid,
            content: rem.content,
            dueAt: rem.dueAt,
            sourceInteractionId: interaction.id,
          });
        }
        const totalExtracted = extracted.memories.length + extracted.reminders.length;
        if (totalExtracted > 0) {
          console.log(`[Memory] Extracted ${extracted.memories.length} memories + ${extracted.reminders.length} reminders for user ${uid}`);
        }
      }).catch(err => console.error('[Memory] Extraction failed:', err));

    } catch (error: any) {
      console.error("[Socket Agent Error]:", error);
      socket.emit("agent:error", { message: error.message });
      socket.emit("agent:status", { status: "error" });
    }
  });

  // Agent task with tool access — multi-turn tool loop
  socket.on("agent:task", async (data: { text: string; history?: any[]; personalityId?: string }) => {
    // Extract user ID for memory retrieval
    let uid = 'anonymous';
    const cookies = socket.handshake.headers.cookie;
    if (cookies) {
      const token = cookies.split(';').find(c => c.trim().startsWith('token='))?.split('=')[1];
      if (token) {
        try { const decoded: any = jwt.verify(token, JWT_SECRET); uid = decoded.uid; } catch(e) {}
      }
    }

    const relevantMemories = queryMemories({ userId: uid, query: data.text, limit: 5, minConfidence: 0.4 });

    const sensory = getSensory(uid);
    const { config: personality, systemPrompt: systemInstruction } = personalityRegistry.buildSystemPrompt(
      data.personalityId || 'lumi',
      { mode: 'task', sensory },
      { memories: relevantMemories.length > 0 ? relevantMemories : undefined },
    );

    const provider = personality.defaultModel.startsWith('deepseek') ? 'deepseek' as const
      : personality.defaultModel.startsWith('qwen') ? 'qwen' as const
      : 'gemini' as const;

    const messages: NormalizedMessage[] = [
      { role: 'system', content: systemInstruction },
      ...(data.history ? data.history.map((m: any) => ({ role: m.role, content: m.content })) : []),
      { role: 'user', content: data.text },
    ];

    try {
      socket.emit("agent:status", { status: "thinking", agentName: personality.name });

      // Desktop tool relay: bridges tool calls to Tauri IPC on the frontend
      const desktopRelay = async (toolName: string, args: Record<string, any>): Promise<string> => {
        return new Promise((resolve, reject) => {
          const cid = Math.random().toString(36).substr(2, 9);
          const timeout = setTimeout(() => {
            reject(new Error(`Desktop tool "${toolName}" timed out (30s)`));
          }, 30000);
          socket.once(`tool:desktop_result:${cid}`, (data: { output?: string; error?: string }) => {
            clearTimeout(timeout);
            if (data.error) reject(new Error(data.error));
            else resolve(data.output || '');
          });
          socket.emit('tool:desktop_exec', { correlationId: cid, name: toolName, arguments: args });
        });
      };

      // Tool confirmation relay: asks the user before executing confirm-level tools
      const requestConfirmation = async (toolName: string, args: Record<string, any>): Promise<boolean> => {
        return new Promise((resolve) => {
          const cid = Math.random().toString(36).substr(2, 9);
          const timeout = setTimeout(() => {
            socket.emit("agent:tool_call", { name: toolName, arguments: args, result: 'Auto-denied (30s timeout)', error: 'User did not respond' });
            resolve(false);
          }, 30000);
          socket.once(`tool:confirm_result:${cid}`, (data: { allowed: boolean }) => {
            clearTimeout(timeout);
            resolve(data.allowed === true);
          });
          socket.emit('agent:confirm_tool', {
            correlationId: cid,
            name: toolName,
            arguments: args,
          });
        });
      };

      const result = await runWithTools(
        messages,
        toolRegistry,
        { provider, model: personality.defaultModel, userId: uid },
        (record) => {
          socket.emit("agent:tool_call", {
            name: record.name,
            arguments: record.arguments,
            result: record.result?.slice(0, 500),
            error: record.error,
          });
        },
        5,
        getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
        undefined,
        { desktopRelay, requestConfirmation, toolPolicy: personality.toolPolicy },
      );

      const holoTask = canOutputHolographic(sensory)
        ? textToHolographicOutput(result.text)
        : undefined;
      socket.emit("agent:response", { text: result.text, agentName: personality.name, holographic: holoTask });
      socket.emit("agent:status", { status: "idle" });

      // Log
      const db = readDB();
      db.interactions.push({
        id: Math.random().toString(36).substr(2, 9),
        content: data.text,
        response: result.text,
        role: "user",
        personality: personality.id,
        timestamp: new Date().toISOString(),
        mode: 'task',
        toolCalls: result.toolCalls.map(tc => ({ name: tc.name, args: tc.arguments })),
      } as any);
      writeDB(db);

      // Async memory extraction
      extractMemories(
        {
          userMessage: data.text,
          assistantResponse: result.text,
          existingMemories: relevantMemories.map(m => m.content),
          provider,
          model: personality.defaultModel,
          userId: uid,
        },
        getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
      ).then(extracted => {
        for (const mem of extracted.memories) {
          addMemory({
            userId: uid,
            type: mem.type,
            content: mem.content,
            keywords: mem.keywords,
            confidence: mem.confidence,
            sourceInteractionId: db.interactions[db.interactions.length - 1]?.id || '',
          });
        }
        for (const rem of extracted.reminders) {
          addReminder({
            userId: uid,
            content: rem.content,
            dueAt: rem.dueAt,
            sourceInteractionId: db.interactions[db.interactions.length - 1]?.id || '',
          });
        }
        const totalExtracted = extracted.memories.length + extracted.reminders.length;
        if (totalExtracted > 0) {
          console.log(`[Memory] Extracted ${extracted.memories.length} memories + ${extracted.reminders.length} reminders for user ${uid}`);
        }
      }).catch(err => console.error('[Memory] Extraction failed:', err));
    } catch (err: any) {
      console.error("[Agent Task Error]:", err);
      socket.emit("agent:error", { message: err.message });
      socket.emit("agent:status", { status: "error" });
    }
  });

  // --- Voice / Audio Pipeline ---

  interface AudioSession {
    sttSession: ReturnType<typeof createStreamingSession> | null;
    isActive: boolean;
    ttsAbortController: AbortController | null;
    currentVoiceId: string | null;
    personalityId: string;
    accumulatedText: string;
    isSpeaking: boolean;
  }

  function getAudioSession(): AudioSession {
    if (!socket.data.audioSession) {
      socket.data.audioSession = {
        sttSession: null,
        isActive: false,
        ttsAbortController: null,
        currentVoiceId: null,
        personalityId: 'lumi',
        accumulatedText: '',
        isSpeaking: false,
      };
    }
    return socket.data.audioSession as AudioSession;
  }

  socket.on("audio:start", async (data: { voiceId?: string; personalityId?: string }) => {
    logger.info(`[Audio] Voice call started by ${socket.id}`);
    const session = getAudioSession();
    session.isActive = true;
    session.accumulatedText = '';
    session.isSpeaking = false;
    session.currentVoiceId = data.voiceId || null;
    session.personalityId = data.personalityId || 'lumi';

    const sttProvider = getActiveSTTProvider();
    if (sttProvider === 'deepgram') {
      try {
        session.sttSession = createStreamingSession({ provider: 'deepgram', language: 'zh-CN', interimResults: true });
        session.sttSession.onResult(async (result) => {

          if (result.text && result.isFinal) {
            logger.info(`[Audio] Final transcript: "${result.text}", triggering LLM...`);
            session.accumulatedText += result.text;
            if (session.accumulatedText.trim().length > 0 && !session.isSpeaking) {
              const userText = session.accumulatedText.trim();
              session.accumulatedText = '';
              session.isSpeaking = true;
              socket.emit("audio:status", { status: "thinking" });

              const sensoryAudio = getSensory(socket.id);
                const { config: personality } = personalityRegistry.buildSystemPrompt(
                  session.personalityId || 'lumi',
                  { mode: 'task', sensory: sensoryAudio },
                );
                const voiceSystemPrompt = `You are ${personality.name}, running on a desktop app with full tool access.
- Reply in the same language as the user's question. For Chinese users, always respond in Chinese.
- Reply in 1-2 short sentences. Under 20 words when possible.
- When the user asks you to DO something (search, open file, run command, check system), ALWAYS call the relevant tool. You have real tools available — use them.
- Never say "I cannot" or "in web mode" — you are NOT in a web sandbox. You are a native desktop agent.
- Speak naturally, like a helpful assistant.`;

                const messages = [
                  { role: 'system', content: voiceSystemPrompt },
                  { role: 'user', content: userText },
                ] as any[];

                const provider = personality.defaultModel.startsWith('deepseek') ? 'deepseek' as const
                  : personality.defaultModel.startsWith('gpt') ? 'openai' as const
                  : personality.defaultModel.startsWith('claude') ? 'anthropic' as const
                  : personality.defaultModel.startsWith('qwen') ? 'qwen' as const
                  : 'gemini' as const;

                const ttsProvider = getTTSProvider();
                let responseText = '';
                let toolResults: any[] = [];
                let sentenceBuffer = '';
                let sentenceIdx = 0;
                const ttsPromises: Promise<void>[] = [];

                const flushSentence = (sentence: string) => {
                  if (!sentence.trim() || !ttsProvider || !session.currentVoiceId || !session.isActive) return;
                  sentenceIdx++;
                  const ttsPromise = synthesizeSpeech(sentence.trim(), {
                    provider: ttsProvider,
                    voiceId: session.currentVoiceId,
                    signal: session.ttsAbortController?.signal,
                  }).then(ttsResult => {
                    if (session.isActive) {
                      socket.emit("audio:status", { status: "speaking" });
                      socket.emit("audio:response", ttsResult.audioBuffer);
                    }
                  }).catch((ttsErr: any) => {
                    if (ttsErr?.name === 'AbortError') return;
                    logger.error("[Audio TTS sentence Error]:", ttsErr);
                  });
                  ttsPromises.push(ttsPromise);
                };

                try {
                  logger.info(`[Audio] Streaming LLM: provider=${provider} model=${personality.defaultModel}`);
                  const toolDeclarations = toolRegistry.getToolDeclarations();

                  // Phase 1: Stream LLM with real-time sentence detection → immediate TTS
                  const streamResult = await makeLLMCallStreaming(
                    messages as NormalizedMessage[],
                    toolDeclarations,
                    { provider, model: personality.defaultModel },
                    (chunk: string) => {
                      responseText += chunk;
                      sentenceBuffer += chunk;
                      // Detect complete sentences and TTS them immediately while LLM continues
                      const match = sentenceBuffer.match(/^([\s\S]*?[。！？.!?\n])/);
                      if (match) {
                        const sentence = match[1];
                        sentenceBuffer = sentenceBuffer.slice(match[1].length);
                        flushSentence(sentence);
                      }
                    },
                    getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
                  );

                  // Extract tool calls if any
                  if (streamResult.toolCalls && streamResult.toolCalls.length > 0) {
                    toolResults = streamResult.toolCalls;
                  }

                  // TTS any remaining text that didn't end with a sentence terminator
                  if (sentenceBuffer.trim()) {
                    flushSentence(sentenceBuffer);
                  }

                  // Wait for all TTS requests to settle
                  await Promise.allSettled(ttsPromises);

                  if (responseText) {
                    logger.info(`[Audio] Response: "${responseText.slice(0, 80)}" (${sentenceIdx} sentences, ${toolResults.length} tool calls)`);
                  }

                // Log interaction
                const db = readDB();
                db.interactions.push({
                  id: crypto.randomUUID().slice(0, 9),
                  content: userText,
                  response: responseText,
                  role: "user",
                  personality: session.personalityId,
                  timestamp: new Date().toISOString(),
                  mode: 'voice',
                } as any);
                writeDB(db);

              } catch (err: any) {
                logger.error("[Audio LLM Error]:", err);
                socket.emit("agent:error", { message: "Voice processing failed" });
              } finally {
                session.isSpeaking = false;
                socket.emit("audio:status", { status: "listening" });
              }
            }
          } else if (result.text && !result.isFinal) {
            socket.emit("audio:transcript", { text: result.text, isFinal: false });
          }
        });

        session.sttSession.onError((err: Error) => {
          logger.error("[Audio STT Error]:", err);
          socket.emit("audio:error", { message: err.message });
        });

        socket.emit("audio:status", { status: "listening" });
      } catch (err: any) {
        logger.error("[Audio Start Error]:", err);
        socket.emit("audio:error", { message: err.message });
      }
    } else {
      socket.emit("audio:status", { status: "listening" });
      socket.emit("audio:error", { message: "No STT provider configured. Set DEEPGRAM_API_KEY." });
    }
  });

  let chunkCount = 0;
  socket.on("audio:chunk", (data: Buffer) => {
    const session = getAudioSession();
    if (!session.isActive) return;
    if (session.sttSession) {
      session.sttSession.sendAudio(data);
      chunkCount++;
      if (chunkCount === 1 || chunkCount % 50 === 0) {
        logger.info(`[Audio] Sent ${chunkCount} chunks (${data.length} bytes each)`);
      }
    }
  });

  socket.on("audio:interrupt", () => {
    logger.info(`[Audio] Interrupt from ${socket.id}`);
    const session = getAudioSession();
    session.isSpeaking = false;
    session.accumulatedText = '';
    if (session.ttsAbortController) {
      session.ttsAbortController.abort();
      session.ttsAbortController = null;
    }
    socket.emit("audio:interrupt-ack", {});
  });

  socket.on("audio:stop", () => {
    logger.info(`[Audio] Voice call ended by ${socket.id}`);
    const session = getAudioSession();
    session.isActive = false;
    session.isSpeaking = false;
    session.accumulatedText = '';
    if (session.ttsAbortController) {
      session.ttsAbortController.abort();
      session.ttsAbortController = null;
    }
    if (session.sttSession) {
      session.sttSession.end();
      session.sttSession = null;
    }
    socket.emit("audio:status", { status: "idle" });
  });

  // Switch personality mid-call without restarting
  socket.on("audio:switch-personality", (data: { personalityId: string }) => {
    const session = getAudioSession();
    if (session.isActive) {
      session.personalityId = data.personalityId;
      logger.info(`[Audio] Personality switched to ${data.personalityId} mid-call`);
    }
  });

  socket.on("disconnect", () => {
    const session = socket.data.audioSession as AudioSession | undefined;
    if (session?.sttSession) {
      session.sttSession.end();
      session.sttSession = null;
    }
    console.log(`[Socket] Client disconnected: ${socket.id}`);
  });
});

// --- End Real-Time Agent Logic ---

async function startServer() {
  try {
    await ensureDatabaseInitialized();
    console.log('Database initialized successfully');
  } catch (error) {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  }

  // Register all agent tools
  registerAllTools(toolRegistry);
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
    registerScheduledTasks();
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
