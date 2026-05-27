/**
 * Messaging config store — initialized from .env, mutable at runtime, persisted to disk.
 * This allows the Feishu settings UI to update config without restarting the server.
 */
import fs from 'fs';
import path from 'path';
import { getDataDir } from '../utils/paths';

const CONFIG_FILE = path.join(getDataDir(), 'messaging.json');

export interface MessagingConfig {
  feishu: {
    appId: string;
    appSecret: string;
    verificationToken?: string;
    enabled: boolean;
  };
}

function loadFromEnv(): MessagingConfig {
  return {
    feishu: {
      appId: process.env.FEISHU_APP_ID || '',
      appSecret: process.env.FEISHU_APP_SECRET || '',
      verificationToken: process.env.FEISHU_VERIFICATION_TOKEN || undefined,
      enabled: !!(process.env.FEISHU_APP_ID && process.env.FEISHU_APP_SECRET),
    },
  };
}

function loadFromFile(): MessagingConfig | null {
  try {
    if (fs.existsSync(CONFIG_FILE)) {
      return JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf-8'));
    }
  } catch {}
  return null;
}

function saveToFile(config: MessagingConfig): void {
  const dir = path.dirname(CONFIG_FILE);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
}

// Init: file overrides env (so user changes persist across restarts)
const fileConfig = loadFromFile();
let _config: MessagingConfig = fileConfig || loadFromEnv();
let _configured = _config.feishu.appId && _config.feishu.appSecret ? true : false;

export function getMessagingConfig(): MessagingConfig {
  return _config;
}

export function isMessagingConfigured(): boolean {
  return _configured;
}

export function updateMessagingConfig(partial: Partial<MessagingConfig['feishu']>): MessagingConfig {
  _config = {
    feishu: { ..._config.feishu, ...partial },
  };
  _config.feishu.enabled = !!(_config.feishu.appId && _config.feishu.appSecret);
  _configured = _config.feishu.enabled;
  saveToFile(_config);
  return _config;
}
