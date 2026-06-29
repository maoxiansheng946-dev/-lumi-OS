/**
 * Skill translation cache — auto-translates skill metadata via LLM,
 * persists to DB so each skill is translated only once.
 */
import { readDB, writeDB } from '../../db_layer';
import { logger } from '../../logger';

const SUPPORTED_LANGS = ['zh', 'en'];
const FIELDS_TO_TRANSLATE = ['displayName', 'description', 'setupNote'] as const;

const BUILTIN_ZH_TRANSLATIONS: Record<string, TranslationEntry> = {
  'skill-cad-drafting': {
    displayName: 'CAD 制图包',
    description: '面向空间规划和装修方案的 CAD 工作流。可生成可编辑 DXF 草图、绘图检查清单和交付说明。',
  },
  'skill-calculator': {
    displayName: '高级计算器',
    description: '表达式计算、单位换算、统计分析等本地计算工具。',
  },
  'skill-code-sandbox': {
    displayName: '代码沙盒',
    description: '安全执行 Python 和 JavaScript 代码，用于计算、验证脚本和小型自动化。',
  },
  'skill-deep-crawler': {
    displayName: '深度网页采集',
    description: '支持认证场景、站内深度抓取和结构化内容提取的网页采集工具。',
  },
  'skill-design-studio-pack': {
    displayName: '设计工作室包',
    description: '面向品牌、UI、空间与视觉生产的设计工作流，支持创意简报、方向整理、审查清单和交付计划。',
  },
  'skill-desktop-automation': {
    displayName: '桌面指挥官',
    description: '控制鼠标、键盘、窗口和 OCR 的桌面自动化能力，用于在本机应用里执行可确认的操作。',
  },
  'skill-email-assistant': {
    displayName: '邮件助手',
    description: '解析邮件内容、附件和元数据，并辅助起草、摘要和归档。',
  },
  'skill-fetcher': {
    displayName: '网页读取专家',
    description: '把网页 URL 转换成干净可读的内容，方便 Lumi 阅读、摘要和引用。',
  },
  'skill-finance-office': {
    displayName: '财税办公包',
    description: '费用汇总、现金流预测、发票 VAT 复核、应收应付账龄、电商税务底稿和经营报告提纲等财税办公能力。',
  },
  'skill-ecommerce-ops': {
    displayName: '电商运营包',
    description: '商品标题与卖点优化、订单利润分析、库存补货、平台结算复核、广告 ROI 和售后风险分析等电商运营能力。',
  },
  'skill-education-teacher': {
    displayName: '教师教培包',
    description: '备课教案、评分量规、测验提纲、学生学习支持画像和家长沟通草稿等教师工作流能力。',
  },
  'skill-executive-ops': {
    displayName: '企业负责人经营包',
    description: '经营 KPI 简报、会议行动项、OKR 规划、决策备忘录、团队风险和现金跑道场景等管理能力。',
  },
  'skill-medical-admin': {
    displayName: '医疗文书与随访包',
    description: '病历结构化、就诊准备、患者说明草稿、随访计划和医学资料检索清单等医疗文书辅助能力，不替代医生诊疗。',
  },
  'skill-hermes': {
    displayName: 'Hermes 助手',
    description: '研究、写作和编码等通用智能体能力，可作为 Lumi 的团队成员接入。',
  },
  'skill-image': {
    displayName: '图片处理',
    description: '图片尺寸调整、格式转换和元数据读取等本地图片工具。',
  },
  'skill-legal-casework': {
    displayName: '法律案件工作包',
    description: '面向律师办案流程的案件辅助能力，支持会谈纪要、期限规划、文书提纲和案件分析，最终结论由律师确认。',
  },
  'skill-melody': {
    displayName: 'Lumi 旋律',
    description: '歌词创作、旋律构思和音乐主题设计工具。',
  },
  'skill-messaging-ops': {
    displayName: '飞书/微信协作包',
    description: '处理飞书、微信和企业微信里的远程请求、文件接收、消息分诊和回复草稿。',
  },
  'skill-minimax': {
    displayName: 'MiniMax 创作室',
    description: '接入 MiniMax 多模态能力，支持音乐、视频、图片和语音创作。',
  },
  'skill-nanobanana': {
    displayName: 'Nano Banana 图像',
    description: '基于 SiliconFlow 的轻量图像生成能力，适合快速出图和灵感草稿。',
  },
  'skill-neteasemusic': {
    displayName: '网易云音乐',
    description: '搜索歌曲、获取歌词、控制播放、读取歌单语境，并支持随聊天情绪播放音乐。',
  },
  'skill-notes': {
    displayName: '本地便签',
    description: '创建、搜索、列出和删除本地便签。',
  },
  'skill-openclaw': {
    displayName: 'OpenClaw 桌面自动化',
    description: '开源桌面自动化智能体，可控制鼠标、键盘和应用窗口。',
  },
  'skill-password': {
    displayName: '密码生成器',
    description: '生成高强度随机密码。',
  },
  'skill-pdftools': {
    displayName: 'PDF 工具',
    description: '合并 PDF、提取文档元数据等常用 PDF 处理能力。',
  },
  'skill-pixelle': {
    displayName: 'Pixelle 创作室',
    description: '基于 ComfyUI 的 AIGC 工作流，支持图像、视频、声音和创作流水线。',
  },
  'skill-qrcode': {
    displayName: '二维码生成器',
    description: '把文本或 URL 生成二维码图片。',
  },
  'skill-shorturl': {
    displayName: '短链接',
    description: '通过 is.gd 将长 URL 转成短链接。',
  },
  'skill-stockbot': {
    displayName: '股票助手',
    description: 'A 股行情、K 线图、资金流和市场数据辅助分析工具。',
  },
  'skill-timer': {
    displayName: '计时提醒',
    description: '设置倒计时、计时器和桌面提醒。',
  },
  'skill-translator': {
    displayName: '翻译助手',
    description: '支持多语言互译，并可自动检测源语言。',
  },
  'skill-video-editor': {
    displayName: '视频工坊',
    description: '视频和音频剪辑、合并、裁切、旋转、效果处理与交付辅助。',
  },
  'skill-weather': {
    displayName: '天气查询',
    description: '查询任意城市的实时天气。',
  },
  'skill-web-scraper': {
    displayName: '网页结构化抓取',
    description: '使用 CSS 选择器抽取网页结构化数据。',
  },
};

const CATEGORY_ZH: Record<string, string> = {
  Architecture: '建筑/CAD',
  Productivity: '效率办公',
  'Dev Tools': '开发工具',
  Web: '网页/数据',
  Design: '设计',
  System: '系统',
  Finance: '财务',
  Ecommerce: '电商',
  Education: '教育',
  Management: '管理',
  Healthcare: '医疗',
  Assistant: '助手',
  Media: '媒体',
  Legal: '法律',
  Creative: '创作',
  Messaging: '飞书/微信',
  Music: '音乐',
  Automation: '自动化',
  Security: '安全',
  Language: '语言',
  Featured: '精选',
  Generated: '生成技能',
  Other: '其他',
};

export interface TranslationEntry {
  displayName?: string;
  description?: string;
  setupNote?: string;
  translatedAt?: number;
}

interface TranslationCache {
  [skillId: string]: {
    [lang: string]: TranslationEntry;
  };
}

function loadCache(): TranslationCache {
  const db = readDB();
  return db.skillTranslations || {};
}

function saveCache(cache: TranslationCache) {
  const db = readDB();
  db.skillTranslations = cache;
  writeDB(db);
}

export function getTranslation(skillId: string, lang: string): TranslationEntry | null {
  if (lang === 'en') return null; // English is source
  const cache = loadCache();
  const entry = cache[skillId]?.[lang];
  if (!entry) return lang === 'zh' ? BUILTIN_ZH_TRANSLATIONS[skillId] || null : null;

  // Check staleness: re-translate after 7 days in case source changed
  if (Date.now() - entry.translatedAt > 7 * 24 * 3600 * 1000) {
    return lang === 'zh' ? BUILTIN_ZH_TRANSLATIONS[skillId] || null : null;
  }
  return entry;
}

export function translateCategory(category: string, lang?: string): string {
  if (lang !== 'zh') return category;
  return CATEGORY_ZH[category] || category;
}

export async function translateSkills(
  skills: Array<{
    id: string;
    displayName: string;
    description: string;
    setupNote?: string;
  }>,
  lang: string,
  llmCaller: (prompt: string) => Promise<string>,
): Promise<Map<string, TranslationEntry>> {
  if (lang === 'en' || !SUPPORTED_LANGS.includes(lang)) {
    return new Map();
  }

  const cache = loadCache();
  const results = new Map<string, TranslationEntry>();
  const untranslated: typeof skills = [];

  for (const s of skills) {
    const cached = getCached(cache, s.id, lang);
    if (cached) {
      results.set(s.id, cached);
    } else {
      untranslated.push(s);
    }
  }

  if (untranslated.length > 0) {
    logger.info(`[SkillI18n] Translating ${untranslated.length} skills to ${lang}...`);
    try {
      const prompt = buildTranslationPrompt(untranslated, lang);
      const raw = await llmCaller(prompt);
      const parsed = parseTranslationResponse(raw, untranslated, lang);

      for (const [skillId, trans] of parsed) {
        cache[skillId] = cache[skillId] || {};
        cache[skillId][lang] = { ...trans, translatedAt: Date.now() };
        results.set(skillId, trans);
      }
      saveCache(cache);
      logger.info(`[SkillI18n] Translated ${parsed.size} skills to ${lang}`);
    } catch (err: any) {
      logger.warn(`[SkillI18n] Translation failed: ${err.message}`);
    }
  }

  return results;
}

function getCached(cache: TranslationCache, skillId: string, lang: string): TranslationEntry | null {
  const entry = cache[skillId]?.[lang];
  if (!entry) return null;
  if (Date.now() - entry.translatedAt > 7 * 24 * 3600 * 1000) return null;
  return entry;
}

function buildTranslationPrompt(
  skills: Array<{ id: string; displayName: string; description: string; setupNote?: string }>,
  lang: string,
): string {
  const langName = lang === 'zh' ? 'Simplified Chinese (简体中文)' : lang;
  const items = skills.map(s => {
    let text = `[ID: ${s.id}]\nName: ${s.displayName}\nDescription: ${s.description}`;
    if (s.setupNote) text += `\nSetupNote: ${s.setupNote}`;
    return text;
  }).join('\n\n---\n\n');

  return `Translate the following software skill names, descriptions and setup notes to ${langName}.
Keep technical terms (OCR, API, CSS, LLM, Python, JavaScript, ComfyUI, etc.) untranslated.
Keep brand names (MiniMax, Pixelle, E2B, etc.) untranslated.
Output ONLY a JSON object like this:
{
  "skill-id-1": {
    "displayName": "中文名称",
    "description": "中文描述",
    "setupNote": "中文安装说明"
  }
}

${items}`;
}

function parseTranslationResponse(
  raw: string,
  skills: Array<{ id: string }>,
  lang: string,
): Map<string, TranslationEntry> {
  const map = new Map<string, TranslationEntry>();
  try {
    // Extract JSON from response (may have markdown fence)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return map;
    const parsed = JSON.parse(jsonMatch[0]);
    for (const skill of skills) {
      if (parsed[skill.id]) {
        map.set(skill.id, parsed[skill.id]);
      }
    }
  } catch {
    logger.warn('[SkillI18n] Failed to parse LLM translation response');
  }
  return map;
}
