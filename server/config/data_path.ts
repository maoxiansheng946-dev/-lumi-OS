// Centralized data directory resolver.
// All persisted files (DB, keys, config, voice samples, KB) live here.
// Default: ~/LumiOS/data/ — survives code/upgrade overwrites.
// Override: set LUMI_DATA_DIR env var.

import fs from 'fs';
import path from 'path';
import os from 'os';

const ENV_KEY = 'LUMI_DATA_DIR';

function defaultDataRoot(): string {
  return path.join(os.homedir(), 'LumiOS');
}

export function getDataRoot(): string {
  return process.env[ENV_KEY] || defaultDataRoot();
}

export function getDataPath(relativePath: string): string {
  const full = path.join(getDataRoot(), 'data', relativePath);
  const dir = path.dirname(full);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return full;
}
