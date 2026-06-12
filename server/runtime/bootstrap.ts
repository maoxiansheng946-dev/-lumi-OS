import path from "path";
import fs from "fs";
import { spawn, ChildProcess } from "child_process";
import { readDB, writeDB, flushDB, ensureDatabaseInitialized } from "../../db_layer";
import { toolRegistry } from "../tools/registry";
import { registerAllTools } from "../tools/definitions/index";
import { mcpManager, registerMCPTools } from "../mcp";
import { scheduler, registerScheduledTasks } from "../scheduler";
import bcrypt from "bcryptjs";

interface BootstrapContext {
  server: any;
  io: any;
  PORT: number;
  HOST: string;
  jwtSecret: string;
  llm: {
    getDeepSeek: any; getGemini: any; getOpenAI: any; getAnthropic: any; getQwen: any;
  };
  __dirname: string;
}

export async function bootstrap(ctx: BootstrapContext) {
  const { server, io, PORT, HOST, jwtSecret, llm, __dirname } = ctx;

  if (!jwtSecret) {
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

  // Auto-create admin account for local/desktop use
  const adminPassword = process.env.AUTO_LOGIN_PASSWORD || 'lumi_admin_2026';
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


  // Register all agent tools
  registerAllTools(toolRegistry, { getDeepSeek: llm.getDeepSeek, getGemini: llm.getGemini, getOpenAI: llm.getOpenAI, getAnthropic: llm.getAnthropic, getQwen: llm.getQwen });
  console.log(`[Tools] Registered ${toolRegistry.list().length} built-in tools`);

  // Register MCP tools (non-blocking)
  registerMCPTools(io).then(mcpTools => {
    if (mcpTools.length > 0) {
      console.log(`[MCP] Registered ${mcpTools.length} MCP tools (total: ${toolRegistry.list().length})`);
    }
  }).catch(err => {
    console.warn('[MCP] Tool registration warning:', err.message);
  });

  // Start GPT-SoVITS API server (optional)
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

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[FATAL] Port ${PORT} is already in use. Please close the other process and try again.`);
    } else {
      console.error('[FATAL] Server error:', err.message);
    }
    process.exit(1);
  });

  server.listen(PORT, HOST, () => {
    console.log(`Server running on http://${HOST}:${PORT}`);
    scheduler.setIO(io);
    registerScheduledTasks(llm.getDeepSeek, llm.getGemini, llm.getOpenAI, llm.getAnthropic, llm.getQwen);

    // Clean up stale ephemeral agents on startup
    try {
      const db = readDB();
      if (db.agents) {
        const before = db.agents.length;
        db.agents = db.agents.filter((a: any) => !a.id.startsWith('ephemeral_'));
        if (before !== db.agents.length) {
          writeDB(db);
          console.log(`[Bootstrap] Cleaned ${before - db.agents.length} ephemeral agents`);
        }
      }
    } catch {}

    // Auto-install legal agent templates to all orgs
    import('../legal/templates').then(({ installLegalTemplates }) => {
      const db2 = readDB();
      const orgs = (db2 as any).organizations || [];
      let total = 0;
      for (const org of orgs) {
        total += installLegalTemplates(org.id);
      }
      if (total > 0) console.log(`[Org] Installed ${total} legal agent templates across ${orgs.length} org(s)`);
    }).catch((err: any) => {
      console.warn('[Org] Failed to install legal templates:', err.message);
    });
  });

  // Cleanup on exit
  const cleanup = async () => {
    console.log('[Shutdown] Cleaning up...');
    // Flush dirty in-memory database before exit
    try {
      await flushDB();
      console.log('[Shutdown] Database flushed');
    } catch {}
    try {
      await mcpManager.disconnectAll();
      console.log('[MCP] All servers disconnected');
    } catch (err: any) {
      console.warn('[MCP] Disconnect error:', err.message);
    }
    if (gptSovitsProcess && !gptSovitsProcess.killed) {
      console.log('[GPT-SoVITS] Stopping API server...');
      gptSovitsProcess.kill();
    }
    process.exit(0);
  };
  process.on('SIGINT', () => { cleanup(); });
  process.on('SIGTERM', () => { cleanup(); });
}
