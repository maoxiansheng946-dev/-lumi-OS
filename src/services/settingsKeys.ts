export type KeyStatus = Record<string, boolean>;

export interface SaveKeysResult {
  success: boolean;
  saved: string[];
  deleted: string[];
}

async function readJsonSafely(response: Response): Promise<any> {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

export async function getSavedKeyStatus(): Promise<KeyStatus> {
  const response = await fetch('/api/settings/keys', { credentials: 'include' });
  const data = await readJsonSafely(response);
  if (!response.ok) {
    throw new Error(data.error || `Failed to load key status (${response.status})`);
  }
  return data as KeyStatus;
}

export async function saveServerKeys(keys: Record<string, string>): Promise<SaveKeysResult> {
  const response = await fetch('/api/settings/keys', {
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

  return { success: true, saved, deleted };
}
