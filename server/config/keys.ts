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
  ARK_API_KEY?: string;
  DOUBAO_SPEECH_KEY?: string;
  NETEASE_APP_ID?: string;
  NETEASE_PRIVATE_KEY?: string;
  ALIYUN_AK_ID?: string;
  ALIYUN_AK_SECRET?: string;
  SILICONFLOW_API_KEY?: string;
}

/** Which circuit-breaker provider(s) a given key name affects */
const KEY_TO_CIRCUIT: Partial<Record<keyof KeyStore, string[]>> = {
  DASHSCOPE_API_KEY: ['qwen'],
  QWEN_API_KEY: ['qwen'],
  DEEPGRAM_API_KEY: ['deepgram'],
  OPENAI_API_KEY: ['openai'],
  ANTHROPIC_API_KEY: ['anthropic'],
  GEMINI_API_KEY: ['gemini'],
  DEEPSEEK_API_KEY: ['deepseek'],
};

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

  // Reset circuit breakers for affected providers so updated keys take effect immediately
  try {
    const { resetCircuit } = require('../cloud/circuit_breaker');
    for (const keyName of Object.keys(keys)) {
      const circuits = KEY_TO_CIRCUIT[keyName as keyof KeyStore];
      if (circuits) {
        for (const c of circuits) {
          resetCircuit(c);
        }
      }
    }
  } catch {}
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
    'ARK_API_KEY',
    'DOUBAO_SPEECH_KEY',
    'NETEASE_APP_ID',
    'NETEASE_PRIVATE_KEY',
    'ALIYUN_AK_ID',
    'ALIYUN_AK_SECRET',
    'SILICONFLOW_API_KEY',
  ];
}
