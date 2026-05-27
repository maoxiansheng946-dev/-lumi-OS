import os from 'os';
import path from 'path';
import fs from 'fs';

/** Writable data directory that survives app updates. */
export function getDataDir(): string {
  // Allow override via env (useful for testing / Docker)
  if (process.env.LUMI_DATA_DIR) return process.env.LUMI_DATA_DIR;

  const platform = process.platform;
  const home = os.homedir();

  let base: string;
  if (platform === 'win32') {
    base = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
  } else if (platform === 'darwin') {
    base = path.join(home, 'Library', 'Application Support');
  } else {
    // Linux / BSD
    const xdg = process.env.XDG_DATA_HOME || path.join(home, '.local', 'share');
    base = xdg;
  }

  const dir = path.join(base, 'LumiOS');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}
