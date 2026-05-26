import { exec } from 'child_process';
import { ToolRegistry } from '../registry';

const REPO_ROOT = process.cwd();

async function typeCheckHandler(args: Record<string, any>): Promise<string> {
  const projectPath = args.path ? String(args.path) : REPO_ROOT;

  return new Promise((resolve) => {
    exec('npx tsc --noEmit', {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      cwd: projectPath,
    }, (error, stdout, stderr) => {
      const output = (stdout + '\n' + stderr).trim();

      if (!error && !output) {
        resolve('Type check passed. No errors.');
        return;
      }

      if (!output) {
        resolve('Type check failed with no output.');
        return;
      }

      // Group errors by file for readability
      const lines = output.split('\n');
      const byFile = new Map<string, string[]>();
      const filePattern = /^(.+?\.(ts|tsx))\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)/;

      for (const line of lines) {
        const match = line.match(filePattern);
        if (match) {
          const file = match[1];
          const lineNum = match[3];
          const severity = match[5];
          const code = match[6];
          const msg = match[7];
          if (!byFile.has(file)) byFile.set(file, []);
          byFile.get(file)!.push(`  L${lineNum}: ${severity} ${code}: ${msg}`);
        }
      }

      if (byFile.size === 0) {
        resolve(output.slice(0, 2000));
        return;
      }

      const result: string[] = [`Type check found errors in ${byFile.size} file(s):\n`];
      for (const [file, msgs] of byFile) {
        result.push(`${file}:`);
        result.push(...msgs.slice(0, 15)); // max 15 errors per file
        if (msgs.length > 15) result.push(`  ... and ${msgs.length - 15} more errors`);
        result.push('');
      }
      resolve(result.join('\n'));
    });
  });
}

async function runTestsHandler(args: Record<string, any>): Promise<string> {
  const testCommand = args.command ? String(args.command) : 'npm test';
  const projectPath = args.path ? String(args.path) : REPO_ROOT;

  return new Promise((resolve) => {
    exec(testCommand, {
      timeout: 120000,
      maxBuffer: 1024 * 1024,
      cwd: projectPath,
    }, (error, stdout, stderr) => {
      const output = (stdout + '\n' + stderr).trim();

      if (error && !output) {
        resolve(`Tests failed: ${error.message}`);
        return;
      }

      const maxLen = 3000;
      const truncated = output.length > maxLen
        ? output.slice(output.length - maxLen)
        : output;

      if (error) {
        resolve(`Tests FAILED (exit code: ${error.code})\n\n${truncated}`);
      } else {
        resolve(`Tests PASSED\n\n${truncated}`);
      }
    });
  });
}

export function registerVerifyTools(registry: ToolRegistry): void {
  registry.register({
    name: 'type_check',
    description: 'Run TypeScript type checker (npx tsc --noEmit). Returns errors grouped by file with line numbers. Use after modifying code to verify correctness.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Path to the project root. Defaults to current directory.' },
      },
      required: [],
    },
    handler: typeCheckHandler,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'run_tests',
    description: 'Run the test suite and report results. Defaults to "npm test". Use "command" to run a specific test (e.g. "npx vitest run path/to/test.test.ts").',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'Test command to run. Defaults to "npm test".' },
        path: { type: 'string', description: 'Path to the project root. Defaults to current directory.' },
      },
      required: [],
    },
    handler: runTestsHandler,
    permission: 'user',
    securityLevel: 'safe',
  });
}
