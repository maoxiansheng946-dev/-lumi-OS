import { readDB, writeDB } from '../../db_layer';

export type UserLLMProvider =
  | 'deepseek'
  | 'qwen'
  | 'openai'
  | 'gemini'
  | 'anthropic'
  | 'ark'
  | 'xiaomi'
  | 'kimi'
  | 'glm'
  | 'relay'
  | 'ollama'
  | 'lmstudio'
  | 'auto';

export interface UserLLMPrefs {
  provider: UserLLMProvider;
  model: string;
  models: Record<string, string>;
  source?: 'personal' | 'organization';
  inheritPersonal?: boolean;
}

export const DEFAULT_MODELS: Record<UserLLMProvider, string> = {
  deepseek: 'deepseek-chat',
  qwen: 'qwen-plus',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  anthropic: 'claude-sonnet-4-6',
  ark: 'doubao-1-5-pro-32k',
  xiaomi: 'xiaomi-chat',
  kimi: 'moonshot-v1-8k',
  glm: 'glm-4-plus',
  relay: 'gpt-4o',
  ollama: 'qwen2.5:7b',
  lmstudio: 'local-model',
  auto: 'qwen2.5:7b',
};

const VALID_PROVIDERS = new Set<UserLLMProvider>([
  'deepseek',
  'qwen',
  'openai',
  'gemini',
  'anthropic',
  'ark',
  'xiaomi',
  'kimi',
  'glm',
  'relay',
  'ollama',
  'lmstudio',
  'auto',
]);

function normalizeProvider(value: unknown): UserLLMProvider {
  return typeof value === 'string' && VALID_PROVIDERS.has(value as UserLLMProvider)
    ? value as UserLLMProvider
    : 'deepseek';
}

function parsePrefsRow(key: string): any {
  try {
    const db = readDB();
    const setting = (db.settings || []).find((s: any) => s.key === key);
    if (setting?.value) return JSON.parse(setting.value);
  } catch {}
  return null;
}

function resolvePrefs(raw: any, source: 'personal' | 'organization'): UserLLMPrefs {
  const provider = normalizeProvider(raw?.provider);
  const models = raw?.models && typeof raw.models === 'object' ? raw.models : {};
  const model = models[provider] || DEFAULT_MODELS[provider];
  return {
    provider,
    model,
    models,
    source,
    inheritPersonal: raw?.inheritPersonal === true,
  };
}

export function getUserPreferredLLM(userId: string): UserLLMPrefs {
  return resolvePrefs(parsePrefsRow(`llm_prefs_${userId}`), 'personal');
}

export function getOrgPreferredLLM(orgId: string): (UserLLMPrefs & { configured: boolean }) | null {
  if (!orgId) return null;
  const raw = parsePrefsRow(`org_llm_prefs_${orgId}`);
  if (!raw) return null;
  if (raw.inheritPersonal === true || !raw.provider) {
    return { ...resolvePrefs(raw, 'organization'), configured: false, inheritPersonal: true };
  }
  return { ...resolvePrefs(raw, 'organization'), configured: true, inheritPersonal: false };
}

export function getScopedPreferredLLM(
  userId: string,
  scope: { domain?: string; orgId?: string } = {},
): UserLLMPrefs {
  if (scope.domain === 'work' && scope.orgId) {
    const orgPrefs = getOrgPreferredLLM(scope.orgId);
    if (orgPrefs?.configured) return orgPrefs;
  }
  return getUserPreferredLLM(userId);
}

export function upsertOrgPreferredLLM(
  orgId: string,
  input: { inheritPersonal?: boolean; provider?: string; models?: Record<string, string> },
): UserLLMPrefs & { configured: boolean } {
  if (!orgId) throw new Error('orgId is required');
  const inheritPersonal = input.inheritPersonal === true;
  const provider = inheritPersonal ? '' : normalizeProvider(input.provider);
  const models = !inheritPersonal && input.models && typeof input.models === 'object' ? input.models : {};
  const payload = {
    inheritPersonal,
    provider,
    models,
    updatedAt: new Date().toISOString(),
  };
  const db = readDB();
  const key = `org_llm_prefs_${orgId}`;
  if (!db.settings) (db as any).settings = [];
  const idx = (db.settings || []).findIndex((s: any) => s.key === key);
  if (idx >= 0) {
    (db.settings as any[])[idx].value = JSON.stringify(payload);
  } else {
    db.settings.push({ key, value: JSON.stringify(payload) });
  }
  writeDB(db);
  return inheritPersonal
    ? { ...resolvePrefs(payload, 'organization'), configured: false, inheritPersonal: true }
    : { ...resolvePrefs(payload, 'organization'), configured: true, inheritPersonal: false };
}

export function getUserPreferredLLMConfig(
  userId: string,
  options: { maxTokens?: number; domain?: string; orgId?: string } = {},
): { provider: UserLLMProvider; model: string; userId: string; maxTokens?: number; domain?: string; orgId?: string } {
  const pref = getScopedPreferredLLM(userId, { domain: options.domain, orgId: options.orgId });
  return {
    provider: pref.provider,
    model: pref.model,
    userId,
    ...(options.maxTokens ? { maxTokens: options.maxTokens } : {}),
    ...(options.domain ? { domain: options.domain } : {}),
    ...(options.orgId ? { orgId: options.orgId } : {}),
  };
}
