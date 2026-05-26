import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { ToolRegistry } from '../registry';

const MAX_FILES = 5;
const MAX_SIZE = 500_000; // 500KB per file
const PROJECT_ROOT = process.cwd();

const BLOCKED_SEGMENTS = [
  'node_modules', '.git', 'data', '.env',
  'C:\\Windows', 'C:\\Program Files', '/etc', '/sys', '/proc',
];

function isPathSafe(userPath: string): { ok: boolean; reason?: string } {
  const resolved = path.resolve(PROJECT_ROOT, userPath);
  const normalized = path.normalize(resolved);

  // Must be inside project root
  if (!normalized.startsWith(path.normalize(PROJECT_ROOT) + path.sep) && normalized !== path.normalize(PROJECT_ROOT)) {
    return { ok: false, reason: `Path "${userPath}" is outside project directory` };
  }

  // Block sensitive paths
  for (const seg of BLOCKED_SEGMENTS) {
    if (normalized.includes(path.normalize(seg))) {
      return { ok: false, reason: `Path "${userPath}" contains blocked segment: ${seg}` };
    }
  }

  return { ok: true };
}

async function selfUpgradeHandler(args: Record<string, any>): Promise<string> {
  const files: Array<{ path: string; content: string }> = args.files || [];

  if (!Array.isArray(files) || files.length === 0) {
    throw new Error('At least one file {path, content} is required.');
  }
  if (files.length > MAX_FILES) {
    throw new Error(`Max ${MAX_FILES} files per upgrade call. Got ${files.length}.`);
  }

  // Phase 1: Validate all paths and content
  const validated: Array<{ absPath: string; content: string; relPath: string }> = [];
  for (const f of files) {
    if (!f.path || typeof f.content !== 'string') {
      throw new Error(`Each file must have "path" and "content" (string).`);
    }
    if (f.content.length > MAX_SIZE) {
      throw new Error(`File "${f.path}" is ${(f.content.length / 1024).toFixed(1)}KB (max 500KB).`);
    }

    const safe = isPathSafe(f.path);
    if (!safe.ok) throw new Error(safe.reason);

    validated.push({
      absPath: path.resolve(PROJECT_ROOT, f.path),
      content: f.content,
      relPath: f.path,
    });
  }

  // Phase 2: Backup original contents for rollback
  const backups: Array<{ absPath: string; original: string | null }> = [];
  for (const v of validated) {
    try {
      backups.push({ absPath: v.absPath, original: fs.readFileSync(v.absPath, 'utf-8') });
    } catch {
      backups.push({ absPath: v.absPath, original: null }); // new file
    }
  }

  // Phase 3: Write all files
  for (const v of validated) {
    const dir = path.dirname(v.absPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(v.absPath, v.content, 'utf-8');
  }

  // Phase 4: Type-check
  let tscPassed = false;
  try {
    execSync('npx tsc --noEmit', {
      cwd: PROJECT_ROOT,
      timeout: 60_000,
      stdio: 'pipe',
    });
    tscPassed = true;
  } catch (tscErr: any) {
    const stderr = tscErr.stderr?.toString() || tscErr.stdout?.toString() || tscErr.message || '';
    const errors = stderr.split('\n').filter((l: string) => l.includes('error TS')).slice(0, 10).join('\n');

    // Rollback all files
    for (const b of backups) {
      try {
        if (b.original === null) {
          fs.unlinkSync(b.absPath);
        } else {
          fs.writeFileSync(b.absPath, b.original, 'utf-8');
        }
      } catch {
        // best-effort rollback
      }
    }

    return `UPGRADE REJECTED: TypeScript compilation failed.\n\nErrors:\n${errors || stderr.slice(0, 1000)}\n\nAll files have been rolled back. Fix the errors and try again.`;
  }

  if (!tscPassed) {
    return 'UPGRADE REJECTED: TypeScript check failed for unknown reason.';
  }

  // Phase 5: Git commit (rollback safety net)
  try {
    const fileList = validated.map(v => `"${v.relPath}"`).join(' ');
    execSync(`git add ${fileList}`, { cwd: PROJECT_ROOT, timeout: 10_000, stdio: 'pipe' });

    const changedFiles = validated.map(v => v.relPath).join(', ');
    execSync(`git commit -m "self_upgrade: ${changedFiles}"`, {
      cwd: PROJECT_ROOT,
      timeout: 10_000,
      stdio: 'pipe',
    });
  } catch (gitErr: any) {
    // Non-critical — the files are written and verified, git is just a safety net
    console.warn('[self_upgrade] Git commit failed (non-critical):', gitErr.message?.slice(0, 200));
  }

  // Phase 6: Schedule restart
  const summary = validated.map(v => `  - ${v.relPath} (${v.content.length} bytes)`).join('\n');
  console.log(`[self_upgrade] Upgrade applied:\n${summary}\nRestarting with exit code 42...`);

  setTimeout(() => {
    process.exit(42);
  }, 300);

  return `UPGRADE APPLIED (tsc OK). ${validated.length} file(s) changed:\n${summary}\n\nServer restarting with new code...`;
}

export function registerUpgradeTools(registry: ToolRegistry): void {
  registry.register({
    name: 'self_upgrade',
    description: `Apply code changes to Lumi's own source files. Accepts a batch of file edits, runs tsc --noEmit to verify, git-commits as backup, and triggers a server restart.

Use this to evolve any part of Lumi: memory, personality, tools, UI, MCP skills, etc.

After restart, the launcher watchdog picks up the new code. If the server crashes on restart, the launcher auto-rolls back to the previous git commit.

Example usage:
- "Add a new MCP tool that checks weather"
- "Refactor the memory retrieval to use embeddings"
- "Fix the bug in voice clone upload"

Max ${MAX_FILES} files per call. TypeScript verification is mandatory — bad code is rejected with the compiler errors.`,
    parameters: {
      type: 'object',
      properties: {
        files: {
          type: 'array',
          description: `Array of file changes to apply (max ${MAX_FILES}). Each entry has "path" (relative to project root) and "content" (full new file content).`,
          items: {
            type: 'object',
            properties: {
              path: { type: 'string', description: 'File path relative to project root (e.g. "server/memory/store.ts")' },
              content: { type: 'string', description: 'Complete new file contents' },
            },
            required: ['path', 'content'],
          },
        },
      },
      required: ['files'],
    },
    handler: selfUpgradeHandler,
    permission: 'admin',
    securityLevel: 'safe',
  });
}
