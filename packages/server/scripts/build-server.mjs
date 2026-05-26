import { build } from 'esbuild';
import { writeFileSync, mkdirSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { execSync } from 'node:child_process';

await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  platform: 'node',
  format: 'esm',
  outfile: 'dist-server/server.mjs',
  external: ['sqlite3'],
  banner: {
    js: "import { createRequire as __lumiCreateRequire } from 'module'; const require = __lumiCreateRequire(import.meta.url);",
  },
});

// Generate entry.cjs for CommonJS environments (Tauri node.exe, production serve)
mkdirSync('dist-server', { recursive: true });
writeFileSync('dist-server/entry.cjs', `// CJS entry point - dynamically imports the ESM server bundle.

// Monkey-patch child_process to hide console windows on Windows (desktop app)
if (process.platform === 'win32') {
  const cp = require('child_process');
  const origSpawn = cp.spawn;
  const origExec = cp.exec;
  const origExecSync = cp.execSync;
  const origFork = cp.fork;

  cp.spawn = function (cmd, args, opts) {
    if (!opts) opts = {};
    if (opts.windowsHide === undefined) opts.windowsHide = true;
    return origSpawn.call(this, cmd, args, opts);
  };
  cp.exec = function (cmd, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (!opts) opts = {};
    if (opts.windowsHide === undefined) opts.windowsHide = true;
    return origExec.call(this, cmd, opts, cb);
  };
  cp.execSync = function (cmd, opts) {
    if (!opts) opts = {};
    if (opts.windowsHide === undefined) opts.windowsHide = true;
    return origExecSync.call(this, cmd, opts);
  };
  cp.fork = function (mod, args, opts) {
    if (!opts) opts = {};
    if (opts.windowsHide === undefined) opts.windowsHide = true;
    return origFork.call(this, mod, args, opts);
  };
}

import('./server.mjs').catch(err => {
  console.error('Failed to start Lumi OS server:', err);
  process.exit(1);
});
`);

console.log('[build-server] Generated dist-server/server.mjs + dist-server/entry.cjs');

// Generate hide-console.cjs — loaded via NODE_OPTIONS=--require, monkey-patches
// child_process BEFORE entry.cjs runs so that any Node.js child processes spawned
// by the server also inherit hidden console windows on Windows.
writeFileSync('dist-server/hide-console.cjs', `// Hide console windows for ALL Node.js child processes on Windows.
// Loaded via NODE_OPTIONS=--require, inherited by every spawned Node process.
if (process.platform === 'win32') {
  var cp = require('child_process');
  var origSpawn = cp.spawn;
  var origExec = cp.exec;
  var origExecSync = cp.execSync;
  var origFork = cp.fork;

  cp.spawn = function (cmd, args, opts) {
    if (!opts) opts = {};
    if (opts.windowsHide === undefined) opts.windowsHide = true;
    return origSpawn.call(this, cmd, args, opts);
  };
  cp.exec = function (cmd, opts, cb) {
    if (typeof opts === 'function') { cb = opts; opts = {}; }
    if (!opts) opts = {};
    if (opts.windowsHide === undefined) opts.windowsHide = true;
    return origExec.call(this, cmd, opts, cb);
  };
  cp.execSync = function (cmd, opts) {
    if (!opts) opts = {};
    if (opts.windowsHide === undefined) opts.windowsHide = true;
    return origExecSync.call(this, cmd, opts);
  };
  cp.fork = function (mod, args, opts) {
    if (!opts) opts = {};
    if (opts.windowsHide === undefined) opts.windowsHide = true;
    return origFork.call(this, mod, args, opts);
  };
}
`);
console.log('[build-server] Generated dist-server/hide-console.cjs');

// Install production dependencies so native modules (sqlite3) have their full
// transitive dependency tree available at runtime in the bundled desktop app.
const pkg = JSON.parse(readFileSync('package.json', 'utf-8'));
const deployPkg = {
  name: "lumios-server-runtime",
  private: true,
  type: "module",
  dependencies: { sqlite3: pkg.dependencies.sqlite3 },
};
writeFileSync('dist-server/package.json', JSON.stringify(deployPkg, null, 2));

// Use npm (not pnpm) for flat install — avoids workspace interference, gives us
// a self-contained node_modules with all transitive deps.
const nodeModules = 'dist-server/node_modules';
if (existsSync(nodeModules)) rmSync(nodeModules, { recursive: true, force: true });
console.log('[build-server] Installing runtime dependencies (npm install --omit=dev)...');
execSync('npm install --omit=dev --no-optional --silent', { cwd: 'dist-server', stdio: 'inherit' });
console.log('[build-server] dist-server/node_modules ready');
