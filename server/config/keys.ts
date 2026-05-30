import fs from 'fs';
import path from 'path';
import { getDataPath } from './data_path';

const KEYS_FILE = getDataPath('keys.json');

interface KeyStore {
  DEEPGRAM_API_KEY?: string;
  DASHSCOPE_API_KEY?: string;
  OPENAI_API_KEY?: string;
  ANTHROPIC_API_KEY?: string;
  GEMINI_API_KEY?: string;
  DEEPSEEK_API_KEY?: string;
  QWEN_API_KEY?: string;
  MINIMAX_API_KEY?: string;
  E2B_API_KEY?: string;
}

export function loadKeys(): KeyStore {
  try {
    if (fs.existsSync(KEYS_FILE)) {
      return JSON.parse(fs.readFileSync(KEYS_FILE, 'utf-8'));
    }
  } catch {}
  return {};
}

export function saveKeys(keys: Partial<KeyStore>): void {
  const dir = path.dirname(KEYS_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const existing = loadKeys();
  const merged = { ...existing, ...keys };
  for (const [k, v] of Object.entries(merged)) {
    if (!v || (typeof v === 'string' && v.trim().length === 0)) {
      delete (merged as Record<string, unknown>)[k];
    }
  }
  fs.writeFileSync(KEYS_FILE, JSON.stringify(merged, null, 2));
}

export function getKey(name: keyof KeyStore): string | undefined {
  const keys = loadKeys();
  return keys[name];
}

export function getAllKeyNames(): (keyof KeyStore)[] {
  return [
    'DEEPGRAM_API_KEY',
    'DASHSCOPE_API_KEY',
    'OPENAI_API_KEY',
    'ANTHROPIC_API_KEY',
    'GEMINI_API_KEY',
    'DEEPSEEK_API_KEY',
    'QWEN_API_KEY',
    'MINIMAX_API_KEY',
    'E2B_API_KEY',
  ];
}
