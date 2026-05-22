/**
 * Skill translation cache — auto-translates skill metadata via LLM,
 * persists to DB so each skill is translated only once.
 */
import { readDB, writeDB } from '../../db_layer';
import { logger } from '../../logger';

const SUPPORTED_LANGS = ['zh', 'en'];
const FIELDS_TO_TRANSLATE = ['displayName', 'description', 'setupNote'] as const;

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
  if (!entry) return null;

  // Check staleness: re-translate after 7 days in case source changed
  if (Date.now() - entry.translatedAt > 7 * 24 * 3600 * 1000) {
    return null;
  }
  return entry;
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
