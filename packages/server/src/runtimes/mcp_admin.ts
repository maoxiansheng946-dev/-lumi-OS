import { Router } from "express";
import fs from "fs";
import path from "path";
import { mcpManager, getMCPConfig, updateMCPConfig } from "../mcp";

export function mountMcpAdminRuntime(router: Router) {
  // MCP config
  router.get("/mcp", (_req, res) => {
    const config = getMCPConfig();
    const connected = mcpManager.getConnectedServers();
    const servers = Object.entries(config).map(([name, cfg]) => ({
      name,
      ...cfg,
      connected: connected.includes(name),
    }));
    res.json({ servers });
  });

  router.post("/mcp", async (req, res) => {
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

  router.get("/mcp/health", (_req, res) => {
    res.json({ servers: mcpManager.getServerHealth() });
  });

  router.post("/mcp/restart/:name", async (req, res) => {
    try {
      const tools = await mcpManager.restartServer(req.params.name);
      res.json({ tools });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Remote devices
  router.get("/remote-devices", (_req, res) => {
    try {
      const configPath = path.join(process.cwd(), 'packages', 'server', 'src', 'mcp', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      res.json({ devices: config.remoteDevices || {} });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.put("/remote-devices", (req, res) => {
    try {
      const { devices } = req.body;
      if (!devices || typeof devices !== 'object') {
        return res.status(400).json({ error: 'Invalid devices config' });
      }
      const configPath = path.join(process.cwd(), 'packages', 'server', 'src', 'mcp', 'config.json');
      const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
      config.remoteDevices = devices;
      fs.writeFileSync(configPath, JSON.stringify(config, null, 2));
      res.json({ success: true, devices: config.remoteDevices });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // GitHub MCP search
  router.get("/mcp/github/search", async (req, res) => {
    const q = (req.query.q as string) || '';
    if (!q) return res.json([]);
    try {
      const apiUrl = `https://api.github.com/search/repositories?q=${encodeURIComponent(q)}+topic:mcp-server&sort=stars&order=desc&per_page=20`;
      const response = await fetch(apiUrl, {
        headers: { 'Accept': 'application/vnd.github.v3+json', 'User-Agent': 'LumiOS' },
      });
      const data: any = await response.json();
      const items = (data.items || []).map((item: any) => ({
        name: item.full_name,
        description: item.description,
        url: item.html_url,
        stars: item.stargazers_count,
        language: item.language,
        topics: item.topics,
      }));
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // NPM MCP search
  router.get("/mcp/npm/search", async (req, res) => {
    const q = (req.query.q as string) || 'mcp';
    try {
      const apiUrl = `https://registry.npmjs.org/-/v1/search?text=${encodeURIComponent(q)}+mcp&size=20`;
      const response = await fetch(apiUrl);
      const data: any = await response.json();
      const items = (data.objects || []).map((obj: any) => ({
        name: obj.package.name,
        description: obj.package.description,
        version: obj.package.version,
        url: `https://www.npmjs.com/package/${obj.package.name}`,
        downloads: obj.downloads?.weekly || 0,
      }));
      res.json(items);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
