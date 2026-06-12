/**
 * Skill Auto-Installer — detects uninstalled OR outdated skills matching the user's task
 * and silently installs/upgrades them so Lumi can use them immediately.
 */
import path from 'path';
import os from 'os';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { mcpManager } from '../mcp';
import { getMarketplaceSkills, recordInstall } from '../marketplace/registry';
import { createAgentForSkill } from './skill_agent';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BUNDLED_DIR = path.join(__dirname, '..', 'skills', 'bundled');
const SKILLS_DIR = path.join(os.homedir(), 'lumi_skills');

export interface InstallResult {
  skillId: string;
  skillName: string;
  action: 'installed' | 'upgraded' | 'skipped';
  reason: string;
}

const SKILL_KEYWORD_MAP: Array<{ keywords: RegExp[]; skillId: string; category: string }> = [
  { keywords: [/股票|行情|股价|A股|涨停|跌停|K线|大盘|板块|同花顺|炒股|上证|深证|创业板|沪深|PE|市值|换手率|涨了|跌了|什么价/i], skillId: 'skill-stockbot', category: 'Finance' },
  { keywords: [/视频.*剪|剪.*视频|字幕|配音|剪辑|moviepy|ffmpeg/i], skillId: 'skill-video-editor', category: 'Creative' },
  { keywords: [/AI.*画|画.*AI|文生图|生成.*图|图片.*生成|comfyui|stable.diffusion/i], skillId: 'skill-pixelle', category: 'Creative' },
  { keywords: [/nanobanana|nano.banana|香蕉|硅基流动|siliconflow|纳米香蕉|轻量.*生图|快速.*生图/i], skillId: 'skill-nanobanana', category: 'Creative' },
  { keywords: [/二维码|QR|qrcode/i], skillId: 'skill-qrcode', category: 'Productivity' },
  { keywords: [/翻译|translate|英文.*转|中文.*转|多语言/i], skillId: 'skill-translator', category: 'Language' },
  { keywords: [/邮件.*解析|email.*pars|邮件.*附件|mailparser/i], skillId: 'skill-email-assistant', category: 'Productivity' },
  { keywords: [/短链接|短网址|url.*short|缩短/i], skillId: 'skill-shorturl', category: 'Web' },
  { keywords: [/PPT|演示文稿|幻灯片|presentation|ppt/i], skillId: 'skill-pdftools', category: 'Productivity' },
  { keywords: [/密码|password|生成.*密码|随机/i], skillId: 'skill-password', category: 'Security' },
  { keywords: [/天气|weather|气温|下雨|晴天/i], skillId: 'skill-weather', category: 'Productivity' },
  { keywords: [/计时|倒计时|timer|提醒.*时间|定时/i], skillId: 'skill-timer', category: 'Productivity' },
  { keywords: [/爬虫|crawl|爬取|抓取.*网页|网页.*数据|deep.crawl/i], skillId: 'skill-deep-crawler', category: 'Web' },
  { keywords: [/沙箱|sandbox|在线.*运行|在线.*执行|远程.*代码/i], skillId: 'skill-code-sandbox', category: 'Dev Tools' },
  { keywords: [/桌面.*自动化|自动.*点击|自动.*操作|maa/i], skillId: 'skill-desktop-automation', category: 'System' },
  { keywords: [/音乐|作曲|写歌|唱歌|旋律|和弦|和声|歌词|乐理|编曲|midi|谱曲|音阶|五声音阶|作词/i], skillId: 'skill-melody', category: 'Creative' },
  { keywords: [/网易云|网易音乐|netease|播放.*歌|搜.*歌|每日推荐|歌单|推荐.*歌曲|听.*歌|什么歌|放.*歌/i], skillId: 'skill-neteasemusic', category: 'Music' },
];

function getInstalledNames(): Set<string> {
  const names = new Set<string>();
  try {
    if (fs.existsSync(SKILLS_DIR)) {
      for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) names.add(entry.name);
      }
    }
  } catch {}
  return names;
}

/**
 * Read the installed version from a skill's package.json
 */
function getInstalledVersion(name: string): string {
  try {
    const pkgPath = path.join(SKILLS_DIR, name, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.lumi?.installedVersion || pkg.version || '0.0.0';
    }
  } catch {}
  return '0.0.0';
}

/**
 * Read the bundled source version
 */
function getBundledVersion(name: string): string {
  try {
    const pkgPath = path.join(BUNDLED_DIR, name, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      return pkg.version || '0.0.0';
    }
  } catch {}
  return '0.0.0';
}

/**
 * Auto-install or upgrade matching skills for the user's task.
 * Returns which skills were newly installed or upgraded.
 */
export async function autoInstallForTask(userText: string, io?: { emit: (event: string, data: any) => void }): Promise<InstallResult[]> {
  const installed = getInstalledNames();
  const results: InstallResult[] = [];

  for (const entry of SKILL_KEYWORD_MAP) {
    const matched = entry.keywords.some(k => k.test(userText));
    if (!matched) continue;

    const dirName = entry.skillId.replace('skill-', '');
    const bundledPath = path.join(BUNDLED_DIR, dirName);
    if (!fs.existsSync(bundledPath)) continue;

    const isAlreadyInstalled = installed.has(dirName);
    const skill = getMarketplaceSkills().find(s => s.id === entry.skillId);
    const displayName = skill?.name || dirName;

    // Check if upgrade is available
    let action: 'installed' | 'upgraded' | 'skipped' = 'skipped';
    if (isAlreadyInstalled) {
      const installedVer = getInstalledVersion(dirName);
      const bundledVer = getBundledVersion(dirName);
      if (installedVer === bundledVer) {
        continue; // Already latest, skip
      }
      action = 'upgraded';
    } else {
      action = 'installed';
    }

    try {
      const actionVerb = action === 'upgraded' ? '升级' : '安装';
      console.log(`[AutoInstall] ${actionVerb} "${displayName}" for task: "${userText.slice(0, 80)}"`);


      // Install or upgrade — allowUpgrade=true handles both cases
      const installDir = mcpManager.installSkill(dirName, bundledPath, true);
      console.log(`[AutoInstall] ${actionVerb}完成: ${installDir}`);

      // Restart MCP server to pick up changed tools
      const tools = await mcpManager.restartServer(dirName);
      console.log(`[AutoInstall] Server ready with ${tools.length} tools`);

      // Record install (even for upgrades, to update stats)
      recordInstall(entry.skillId);

      // Create or refresh team agent
      createAgentForSkill(displayName, {
        description: skill?.description,
        category: entry.category,
        toolCount: skill?.toolCount || tools.length,
        installSource: 'bundled',
      }, io);

      results.push({
        skillId: entry.skillId,
        skillName: displayName,
        action,
        reason: action === 'upgraded' ? `已自动升级 ${displayName}` : `已自动安装 ${displayName}`,
      });

      console.log(`[AutoInstall] Done: ${displayName} (${action})`);
    } catch (err: any) {
      console.warn(`[AutoInstall] Failed: "${displayName}": ${err.message}`);
      results.push({
        skillId: entry.skillId,
        skillName: displayName,
        action: 'skipped',
        reason: `失败: ${err.message}`,
      });
    }
  }

  return results;
}
