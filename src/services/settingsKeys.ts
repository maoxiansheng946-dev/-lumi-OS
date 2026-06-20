import { apiFetch } from './apiClient';

export type KeyStatus = Record<string, boolean>;

export interface SaveKeysResult {
  success: boolean;
  saved: string[];
  deleted: string[];
  ignored?: string[];
}

async function readJsonSafely(response: Response): Promise<any> {
  try {
    const text = await response.text();
    if (!text) return {};
    try {
      return JSON.parse(text);
    } catch {
      return { error: text.slice(0, 300) };
    }
  } catch {
    return {};
  }
}

export async function getSavedKeyStatus(): Promise<KeyStatus> {
  const response = await apiFetch('/api/settings/keys');
  const data = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(data.error || `Failed to load key status (${response.status})`);
  }
  return data as KeyStatus;
}

export async function saveServerKeys(keys: Record<string, string>): Promise<SaveKeysResult> {
  const response = await apiFetch('/api/settings/keys', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ keys }),
  });
  const data = await readJsonSafely(response);
  if (!response.ok || data.success === false) {
    throw new Error(data.error || `Failed to save key settings (${response.status})`);
  }
  const saved = Array.isArray(data.saved) ? data.saved : [];
  const deleted = Array.isArray(data.deleted) ? data.deleted : [];
  const ignored = Array.isArray(data.ignored) ? data.ignored : [];
  if (ignored.length > 0) {
    throw new Error(`Unsupported key name(s): ${ignored.join(', ')}`);
  }

  const status = await getSavedKeyStatus();
  for (const [name, value] of Object.entries(keys)) {
    const shouldExist = value.trim().length > 0;
    if (shouldExist && !status[name]) {
      throw new Error(`${name} was not persisted by the backend`);
    }
    if (!shouldExist && status[name]) {
      throw new Error(`${name} is still configured after removal`);
    }
  }

  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('lumi:keys-changed', {
      detail: { saved, deleted },
    }));
  }

  return { success: true, saved, deleted, ignored };
}
