import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), '..');
const outDir = path.join(root, 'packages', 'desktop', 'desktop-resources');
const serverDistDir = path.join(root, 'packages', 'server', 'dist-server');
const includeLocalVoice = process.env.LUMI_DESKTOP_WITH_LOCAL_VOICE === '1';

const runtimeNodeModules = ['sqlite3', 'bindings', 'file-uri-to-path'];
const ignoredNames = new Set([
  '.git',
  '.github',
  '.cache',
  '.mypy_cache',
  '.pytest_cache',
  '.ruff_cache',
  '__pycache__',
  '.ipynb_checkpoints',
]);

function shouldCopy(src) {
  const name = path.basename(src);
  if (ignoredNames.has(name)) return false;
  if (name === '.env' || name.startsWith('.env.')) return false;
  if (name.endsWith('.pyc') || name.endsWith('.pyo') || name.endsWith('.log')) return false;
  return true;
}

async function copyIfExists(src, dest) {
  if (!existsSync(src)) return;
  await fs.mkdir(path.dirname(dest), { recursive: true });
  await fs.copyFile(src, dest);
}

async function copyDir(src, dest, filter = shouldCopy) {
  if (!existsSync(src)) return;
  await fs.cp(src, dest, {
    recursive: true,
    force: true,
    filter,
  });
}

async function prepareServer() {
  const src = serverDistDir;
  const dest = path.join(outDir, 'dist-server');
  const isWindows = process.platform === 'win32';

  await fs.mkdir(dest, { recursive: true });
  await copyIfExists(path.join(src, isWindows ? 'node.exe' : 'node'), path.join(dest, isWindows ? 'node.exe' : 'node'));
  await copyIfExists(path.join(src, 'entry.cjs'), path.join(dest, 'entry.cjs'));
  await copyIfExists(path.join(src, 'server.mjs'), path.join(dest, 'server.mjs'));
  await copyIfExists(path.join(src, 'server.cjs'), path.join(dest, 'server.cjs'));
  await copyIfExists(path.join(src, 'package.json'), path.join(dest, 'package.json'));
  await copyIfExists(path.join(src, '.env'), path.join(dest, '.env'));
  if (isWindows) await copyIfExists(path.join(src, 'hide-console.cjs'), path.join(dest, 'hide-console.cjs'));
  await copyDir(path.join(src, 'server'), path.join(dest, 'server'));

  for (const moduleName of runtimeNodeModules) {
    await copyDir(
      path.join(src, 'node_modules', moduleName),
      path.join(dest, 'node_modules', moduleName),
    );
  }
}

async function prepareGptSovits() {
  const dest = path.join(outDir, 'gpt-sovits-src');
  await fs.mkdir(dest, { recursive: true });

  if (includeLocalVoice) {
    await copyDir(path.join(root, 'gpt-sovits-src'), dest);
  } else {
    await fs.writeFile(path.join(dest, '.keep'), '');
  }
}

async function prepareVoiceTrainingData() {
  const dest = path.join(outDir, 'data', 'voice_training');
  await fs.mkdir(dest, { recursive: true });

  if (includeLocalVoice) {
    await copyDir(path.join(root, 'data', 'voice_training'), dest);
  } else {
    await fs.writeFile(path.join(dest, '.keep'), '');
  }
}

/**
 * Copy WebView2Loader.dll if it exists (post-cargo-build). If not (pre-cargo-build),
 * create a placeholder so resource path checks pass; beforeBundleCommand replaces it.
 */
async function prepareWebView2Dll() {
  const dllDest = path.join(outDir, 'WebView2Loader.dll');
  await fs.mkdir(outDir, { recursive: true });
  const dllSrc = path.join(root, 'packages', 'desktop', 'src-tauri', 'target', 'release', 'WebView2Loader.dll');
  if (existsSync(dllSrc)) {
    await fs.copyFile(dllSrc, dllDest);
  } else {
    // Placeholder — real DLL will be copied by beforeBundleCommand
    await fs.writeFile(dllDest, '');
  }
}

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(outDir, { recursive: true });
await prepareServer();
await prepareGptSovits();
await prepareVoiceTrainingData();
await prepareWebView2Dll();

console.log(`Prepared desktop resources at ${path.relative(root, outDir)}`);
if (!includeLocalVoice) {
  console.log('Local GPT-SoVITS resources skipped. Set LUMI_DESKTOP_WITH_LOCAL_VOICE=1 for the large offline voice bundle.');
}
