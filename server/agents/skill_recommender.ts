/**
 * Skill Auto-Recommender — detects when a user task could benefit from an
 * uninstalled marketplace skill and proactively suggests installation.
 */
import { getMarketplaceSkills } from '../marketplace/registry';
import fs from 'fs';
import path from 'path';
import os from 'os';

const SKILLS_DIR = path.join(os.homedir(), 'lumi_skills');

interface Recommendation {
  skillId: string;
  skillName: string;
  matchReason: string;
  confidence: number;
}

const SKILL_KEYWORD_MAP: Array<{ keywords: RegExp[]; skillId: string; reason: string }> = [
  {
    keywords: [/股票|行情|股价|A股|涨停|跌停|K线|大盘|板块|同花顺|炒股|上证|深证|创业板|沪深|PE|市值|换手率/i],
    skillId: 'skill-stockbot',
    reason: 'StockBot 可以实时查询 A 股行情、K 线、大盘指数和个股资讯',
  },
  {
    keywords: [/视频.*剪|剪.*视频|字幕|配音|剪辑|moviepy|ffmpeg/i],
    skillId: 'skill-video-editor',
    reason: '视频编辑器可以剪辑、加字幕、配音，支持 moviepy + yt-dlp',
  },
  {
    keywords: [/AI.*画|画.*AI|文生图|生成.*图|图片.*生成|comfyui|stable.diffusion/i],
    skillId: 'skill-pixelle',
    reason: 'Pixelle Studio 可以用 ComfyUI 文生图、图生视频、音效生成',
  },
  {
    keywords: [/二维码|QR|qrcode/i],
    skillId: 'skill-qrcode',
    reason: '二维码生成器可以快速生成二维码图片',
  },
  {
    keywords: [/翻译|translate|英文.*转|中文.*转|多语言/i],
    skillId: 'skill-translator',
    reason: '翻译器支持 50+ 语言互译',
  },
  {
    keywords: [/邮件.*解析|email.*pars|邮件.*附件|mailparser/i],
    skillId: 'skill-email-assistant',
    reason: '邮件助手可以解析邮件内容和附件',
  },
  {
    keywords: [/短链接|短网址|url.*short|缩短/i],
    skillId: 'skill-shorturl',
    reason: '短链接工具可以生成短网址便于分享',
  },
  {
    keywords: [/OCR|图片.*文字|识别.*文字|提取.*文字|文字.*识别/i],
    skillId: 'skill-pdftools',
    reason: 'PDF 工具箱支持 OCR 提取图片中的文字',
  },
  {
    keywords: [/PPT|演示文稿|幻灯片|presentation|ppt/i],
    skillId: 'skill-pdftools',
    reason: 'PDF 工具箱可以生成 PDF 幻灯片',
  },
  {
    keywords: [/密码|password|生成.*密码|随机/i],
    skillId: 'skill-password',
    reason: '密码生成器可以创建高强度随机密码',
  },
  {
    keywords: [/天气|weather|气温|下雨|晴天/i],
    skillId: 'skill-weather',
    reason: '天气查询可以实时获取全球城市天气',
  },
  {
    keywords: [/计时|倒计时|timer|提醒.*时间|定时/i],
    skillId: 'skill-timer',
    reason: '定时器可以设置倒计时和桌面提醒',
  },
  {
    keywords: [/爬虫|crawl|爬取|抓取.*网页|网页.*数据|deep.crawl/i],
    skillId: 'skill-deep-crawler',
    reason: '深度爬虫可以 BFS/DFS 遍历网站 + LLM 提取结构化数据',
  },
  {
    keywords: [/沙箱|sandbox|在线.*运行|在线.*执行|远程.*代码/i],
    skillId: 'skill-code-sandbox',
    reason: '代码沙箱可以在 E2B 云端安全执行代码',
  },
  {
    keywords: [/桌面.*自动化|自动.*点击|自动.*操作|maa/i],
    skillId: 'skill-desktop-automation',
    reason: '桌面自动化可以通过 MaaFramework 操控应用窗口',
  },
];

function getInstalledSkillIds(): Set<string> {
  const ids = new Set<string>();
  try {
    if (fs.existsSync(SKILLS_DIR)) {
      for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
        if (entry.isDirectory()) {
          ids.add(`skill-${entry.name}`);
        }
      }
    }
  } catch {}
  return ids;
}

/**
 * Scan user's message for skill recommendations.
 * Returns up to 2 recommendations for uninstalled skills.
 */
export function recommendSkills(userText: string): Recommendation[] {
  const installed = getInstalledSkillIds();
  const recs: Recommendation[] = [];

  for (const entry of SKILL_KEYWORD_MAP) {
    if (installed.has(entry.skillId)) continue;
    const matchCount = entry.keywords.filter(k => k.test(userText)).length;
    if (matchCount > 0) {
      const allSkills = getMarketplaceSkills();
      const skill = allSkills.find(s => s.id === entry.skillId);
      recs.push({
        skillId: entry.skillId,
        skillName: skill?.name || entry.skillId,
        matchReason: entry.reason,
        confidence: Math.min(matchCount / entry.keywords.length, 1),
      });
    }
  }

  // Sort by confidence descending, return top 2
  recs.sort((a, b) => b.confidence - a.confidence);
  return recs.slice(0, 2);
}

/**
 * Get a friendly recommendation message to append to the response.
 */
export function formatRecommendations(recs: Recommendation[]): string {
  if (recs.length === 0) return '';
  const lines = recs.map(r => `- **${r.skillName}**: ${r.matchReason}`);
  return `\n\n💡 技能建议：你的任务可以用这些市场技能更高效地完成，要安装吗？\n${lines.join('\n')}`;
}
