import { Router } from "express";
import jwt from "jsonwebtoken";
import os from "os";
import { readDB, writeDB, isDbDirty } from "../data/db_layer";
import { logger } from "../utils/logger";
import { toolRegistry } from "../tools/registry";
import { scheduler } from "../scheduler";
import { loadKeys, saveKeys, getKey, getAllKeyNames } from "../config/keys";
import { getLatencyStats } from "../monitor/latency_store";

export function mountSystemRoutes(router: Router, jwtSecret: string) {
  // GitHub release proxy — avoids browser rate limits (60/hr vs 5000/hr with token)
  router.get("/release/latest", async (_req, res) => {
    try {
      const repo = process.env.RELEASE_REPO || 'maoxiansheng946-dev/-lumi-OS';
      const url = `https://api.github.com/repos/${repo}/releases/latest`;
      const headers: Record<string, string> = {
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'LumiOS',
      };
      const token = process.env.GITHUB_TOKEN;
      if (token) headers['Authorization'] = `Bearer ${token}`;

      const ghRes = await fetch(url, { headers });
      if (!ghRes.ok) throw new Error(`GitHub API returned ${ghRes.status}`);
      const data = await ghRes.json();

      const assets = (data.assets || []).map((a: any) => ({
        name: a.name,
        size: a.size,
        browser_download_url: a.browser_download_url,
      }));
      res.json({ tag_name: data.tag_name, assets });
    } catch (err: any) {
      res.status(502).json({ error: err.message });
    }
  });

  // Health Check
  router.get("/health", (req, res) => {
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

  // Tool list for security config
  router.get("/tools", (_req, res) => {
    const tools = toolRegistry.list().map(t => ({
      name: t.name,
      description: t.description.slice(0, 80),
      permission: t.permission,
      securityLevel: t.securityLevel,
    }));
    res.json(tools);
  });

  router.get("/scheduler/tasks", (_req, res) => {
    res.json({ tasks: scheduler.listTasks() });
  });

  // Token usage aggregation
  router.get("/llm/usage", (req, res) => {
    let token = req.cookies.token;
    // Fallback: WebView2 may not send httpOnly cookies, check Authorization header
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded: any = jwt.verify(token, jwtSecret);
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

  // Provider status
  router.get("/llm/providers", (_req, res) => {
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

  // LLM connection test
  router.post("/llm/test", async (req, res) => {
    const { provider, apiKey } = req.body || {};
    try {
      const stored = loadKeys();
      const keyMap: Record<string, string | undefined> = {
        deepseek: apiKey || process.env.DEEPSEEK_API_KEY || stored.DEEPSEEK_API_KEY,
        gemini: apiKey || process.env.GEMINI_API_KEY || stored.GEMINI_API_KEY,
        openai: apiKey || process.env.OPENAI_API_KEY || stored.OPENAI_API_KEY,
        anthropic: apiKey || process.env.ANTHROPIC_API_KEY || stored.ANTHROPIC_API_KEY,
        qwen: apiKey || process.env.QWEN_API_KEY || process.env.DASHSCOPE_API_KEY || stored.QWEN_API_KEY || stored.DASHSCOPE_API_KEY,
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

  // API Keys — read/write user-configured keys
  // LLM model preferences — read/write per user
  router.put("/preferences/llm", (req, res) => {
    try {
      const { provider, models } = req.body || {};
      if (!provider || !models || typeof models !== 'object') {
        return res.status(400).json({ error: 'Invalid payload' });
      }
      // Extract user ID from JWT cookie or header
      let uid = 'anonymous';
      const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
      if (token) {
        try {
          const decoded: any = jwt.verify(token, jwtSecret);
          uid = decoded.uid || 'anonymous';
        } catch {}
      }
      const db = readDB();
      const key = `llm_prefs_${uid}`;
      const payload = { provider, models, updatedAt: new Date().toISOString() };
      const existing = (db.settings || []).findIndex((s: any) => s.key === key);
      if (existing >= 0) {
        (db.settings as any[])[existing].value = JSON.stringify(payload);
      } else {
        if (!db.settings) (db as any).settings = [];
        db.settings.push({ key, value: JSON.stringify(payload) });
      }
      writeDB(db);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.get("/preferences/llm", (req, res) => {
    try {
      let uid = 'anonymous';
      const token = req.cookies?.token || (req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : null);
      if (token) {
        try {
          const decoded: any = jwt.verify(token, jwtSecret);
          uid = decoded.uid || 'anonymous';
        } catch {}
      }
      const key = `llm_prefs_${uid}`;
      const db = readDB();
      const row = (db.settings || []).find((s: any) => s.key === key);
      res.json(row ? JSON.parse(row.value) : { provider: '', models: {} });
    } catch {
      res.json({ provider: '', models: {} });
    }
  });

  router.get("/settings/keys", (_req, res) => {
    const stored = loadKeys();
    const masked: Record<string, boolean> = {};
    for (const name of getAllKeyNames()) {
      masked[name] = !!(process.env[name] || stored[name]);
    }
    res.json(masked);
  });

  router.post("/settings/keys", (req, res) => {
    const { keys } = req.body || {};
    if (!keys || typeof keys !== 'object') {
      return res.status(400).json({ error: 'Invalid keys payload' });
    }
    const allowed = new Set<string>(getAllKeyNames());
    const toSave: Record<string, string> = {};
    const toDelete: string[] = [];
    for (const [k, v] of Object.entries(keys)) {
      if (!allowed.has(k) || typeof v !== 'string') continue;
      if (v.trim().length > 0) {
        toSave[k] = v.trim();
      } else {
        toDelete.push(k);
      }
    }
    // For explicit deletes, pass empty strings to saveKeys so they get removed
    for (const k of toDelete) {
      (toSave as any)[k] = '';
    }
    saveKeys(toSave);
    res.json({ success: true, saved: Object.keys(toSave).filter(k => !toDelete.includes(k)), deleted: toDelete });
  });

  // System stats — real-time CPU / memory / platform info
  router.get("/system/stats", (_req: any, res: any) => {
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
  router.get("/monitor/latency", (_req: any, res: any) => {
    res.json(getLatencyStats());
  });
}
