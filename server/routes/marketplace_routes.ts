import { Router } from "express";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import { mcpManager, getMCPConfig, updateMCPConfig, SKILLS_DIR } from "../mcp";
import { getMarketplaceSkills, getSkillById, searchSkills, getCategories, recordInstall, publishSkill, rateSkill, getSkillRatings } from "../marketplace/registry";
import { translateSkills } from "../skills/translations";

const QWEN_BASE = "https://dashscope.aliyuncs.com/compatible-mode/v1";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export function mountMarketplaceRoutes(
  router: Router,
  jwtSecret: string,
  io: { emit: (event: string, data: any) => void },
) {
  // Discoverable marketplace skills (dynamic from registry)
  router.get("/marketplace/skills", (req, res) => {
    try {
      const q = req.query.q as string | undefined;
      const lang = req.query.lang as string | undefined;
      const skills = q ? searchSkills(q, lang) : getMarketplaceSkills(lang);
      res.json(skills);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Single skill detail
  router.get("/marketplace/skills/:id", (req, res) => {
    try {
      const lang = req.query.lang as string | undefined;
      const skill = getSkillById(req.params.id, lang);
      if (!skill) return res.status(404).json({ error: 'Skill not found' });
      const ratings = getSkillRatings(req.params.id);
      res.json({ ...skill, ratings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Marketplace categories
  router.get("/marketplace/categories", (_req, res) => {
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
  router.get("/marketplace/personalities", (_req, res) => {
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
  router.post("/marketplace/skills/acquire", async (req, res) => {
    try {
      const { skillId, skillName, installSource, installPath: reqInstallPath } = req.body;
      if (!skillId || !skillName) return res.status(400).json({ error: "skillId and skillName required" });

      // Bundled skills: copy from bundled directory into ~/lumi_skills/
      if (installSource === 'bundled' && reqInstallPath) {
        const skillDirName = skillName.toLowerCase().replace(/[^a-z0-9]/g, '-');
        io.emit('skill:installing', { skillId, name: skillName, stage: 'copying' });
        try {
          const skillDir = mcpManager.installSkill(skillDirName, reqInstallPath);
          io.emit('skill:installing', { skillId, name: skillName, stage: 'connecting' });
          await mcpManager.restartServer(skillDirName);
        } catch (err: any) {
          return res.status(500).json({ error: `Install failed: ${err.message}` });
        }
        recordInstall(skillId);
        io.emit('skill:installed', { skillId, name: skillName, source: 'bundled' });
        return res.json({ success: true, name: skillName, message: `Skill "${skillName}" installed and activated!` });
      }

      // Community skills: copy from bundled dir too (they are implemented there now)
      if (installSource === 'community') {
        const skillDirName = skillId.replace('skill-', '');
        const bundledPath = path.join(__dirname, '..', 'skills', 'bundled', skillDirName);
        if (fs.existsSync(bundledPath)) {
          io.emit('skill:installing', { skillId, name: skillName, stage: 'copying' });
          try {
            mcpManager.installSkill(skillDirName, bundledPath);
            io.emit('skill:installing', { skillId, name: skillName, stage: 'connecting' });
            await mcpManager.restartServer(skillDirName);
          } catch (err: any) {
            return res.status(500).json({ error: `Install failed: ${err.message}` });
          }
          recordInstall(skillId);
          io.emit('skill:installed', { skillId, name: skillName, source: 'community' });
          return res.json({ success: true, name: skillName, message: `Skill "${skillName}" installed and activated!` });
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

      // npm package install — e.g. "lumi-skill-nanobanana" from npm registry
      if (installSource === 'npm' && req.body.npmPackage) {
        const npmPkg = req.body.npmPackage;
        io.emit('skill:installing', { skillId, name: npmPkg, stage: 'downloading' });
        let skillDirName: string;
        try {
          skillDirName = path.basename(await mcpManager.installFromNpm(npmPkg));
          io.emit('skill:installing', { skillId, name: skillName, stage: 'connecting' });
          await mcpManager.restartServer(skillDirName);
        } catch (err: any) {
          return res.status(500).json({ error: `npm install failed: ${err.message}` });
        }
        recordInstall(skillId);
        io.emit('skill:installed', { skillId, name: skillName, source: 'npm' });
        return res.json({ success: true, name: skillName, message: `Skill "${skillName}" installed from npm and activated!` });
      }

      // GitHub repo install — clone + npm install + register
      if (installSource === 'github' && req.body.repoUrl) {
        const repoUrl = req.body.repoUrl;
        io.emit('skill:installing', { skillId, name: skillName, stage: 'cloning' });
        let skillDirName: string;
        try {
          skillDirName = path.basename(await mcpManager.installFromGitHub(repoUrl));
          io.emit('skill:installing', { skillId, name: skillName, stage: 'connecting' });
          await mcpManager.restartServer(skillDirName);
        } catch (err: any) {
          return res.status(500).json({ error: `GitHub install failed: ${err.message}` });
        }
        recordInstall(skillId);
        io.emit('skill:installed', { skillId, name: skillName, source: 'github' });
        return res.json({ success: true, name: skillName, message: `Skill "${skillName}" installed from GitHub and activated!` });
      }

      res.status(400).json({ error: 'Invalid installSource' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Publish a community skill
  router.post("/marketplace/publish", (req, res) => {
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
  router.post("/marketplace/skills/:id/rate", (req, res) => {
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
  router.get("/marketplace/skills/:id/reviews", (req, res) => {
    try {
      const ratings = getSkillRatings(req.params.id);
      res.json({ ratings });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Trigger batch translation of skill metadata
  router.post("/marketplace/translate", async (req, res) => {
    try {
      const lang = (req.query.lang as string) || (req.body?.lang) || 'zh';
      if (lang === 'en') return res.json({ ok: true, message: 'English is source language' });

      const skills = getMarketplaceSkills().map(s => ({
        id: s.id,
        displayName: s.name,
        description: s.description,
        setupNote: s.setupNote,
      }));

      const translated = await translateSkills(skills, lang, async (prompt: string) => {
        const apiKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY;
        if (!apiKey) throw new Error("DASHSCOPE_API_KEY or QWEN_API_KEY required for translation");
        const resp = await fetch(`${QWEN_BASE}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${apiKey}`,
          },
          body: JSON.stringify({
            model: "qwen-turbo",
            messages: [
              { role: "system", content: "You are a translator. Output ONLY valid JSON." },
              { role: "user", content: prompt },
            ],
            max_tokens: 4096,
            temperature: 0.1,
          }),
        });
        if (!resp.ok) throw new Error(`Qwen API returned ${resp.status}`);
        const data: any = await resp.json();
        return data.choices?.[0]?.message?.content || "";
      });

      res.json({ ok: true, translated: translated.size, lang });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Discover skills from npm registry
  router.get("/marketplace/discover/npm", async (req, res) => {
    try {
      const q = req.query.q || 'lumi-skill';
      const url = `https://registry.npmjs.org/-/v2/search?text=${encodeURIComponent(String(q))}+keywords:lumi-skill&size=20`;
      const resp = await fetch(url, { headers: { 'Accept': 'application/json' } });
      if (!resp.ok) throw new Error(`npm registry returned ${resp.status}`);
      const data: any = await resp.json();
      const results = (data.objects || []).map((obj: any) => ({
        id: `npm-${obj.package?.name}`,
        name: obj.package?.name,
        description: obj.package?.description || '',
        version: obj.package?.version,
        author: obj.package?.publisher?.username || obj.package?.author?.name || '',
        npmUrl: obj.package?.links?.npm,
        repository: obj.package?.links?.repository,
        installSource: 'npm' as const,
        npmPackage: obj.package?.name,
        source: 'npm',
      }));
      res.json({ source: 'npm', count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Discover skills from GitHub topics
  router.get("/marketplace/discover/github", async (req, res) => {
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
        id: `gh-${repo.full_name}`,
        name: repo.name,
        fullName: repo.full_name,
        description: repo.description || '',
        stars: repo.stargazers_count,
        url: repo.html_url,
        cloneUrl: repo.clone_url,
        language: repo.language,
        updatedAt: repo.updated_at,
        installSource: 'github' as const,
        repoUrl: repo.clone_url,
        source: 'github',
      }));
      res.json({ source: 'github', count: results.length, results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });
}
