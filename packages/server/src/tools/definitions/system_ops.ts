import { exec } from 'child_process';
import os from 'os';
import { ToolRegistry } from '../registry';

const DEFAULT_ALLOWED_COMMANDS = new Set([
  'ls', 'dir', 'cat', 'type', 'echo', 'find', 'grep',
  'node', 'npm', 'npx', 'git', 'python', 'python3', 'pip', 'pip3',
  'curl', 'wget', 'pwd', 'whoami', 'date', 'ps', 'netstat',
  'df', 'du', 'head', 'tail', 'wc', 'sort', 'uniq',
  'touch', 'mkdir', 'cp', 'mv', 'chmod', 'chown',
  'which', 'where', 'printenv', 'gh', 'docker',
]);

function getAllowedCommands(): Set<string> {
  const envOverride = process.env.LUMI_ALLOWED_COMMANDS;
  if (envOverride) {
    return new Set(envOverride.split(',').map(c => c.trim()).filter(Boolean));
  }
  return DEFAULT_ALLOWED_COMMANDS;
}

async function runCommandHandler(args: Record<string, any>): Promise<string> {
  const command = String(args.command || '');
  if (!command.trim()) {
    throw new Error('No command provided.');
  }

  const baseCommand = command.trim().split(/\s+/)[0];
  const pathParts = baseCommand.replace(/\\/g, '/').split('/');
  const cmdName = pathParts[pathParts.length - 1];

  const allowedCommands = getAllowedCommands();
  if (!allowedCommands.has(cmdName)) {
    throw new Error(
      `Command "${cmdName}" is not in the allowlist. ` +
      `Allowed commands: ${Array.from(allowedCommands).sort().join(', ')}`
    );
  }

  return new Promise((resolve) => {
    exec(command, {
      timeout: 30000,
      maxBuffer: 500 * 1024,
      cwd: process.cwd(),
    }, (error, stdout, stderr) => {
      if (error) {
        resolve(`Exit code: ${error.code}\n${stderr || stdout || error.message}`);
      } else {
        resolve(stdout || stderr || '(no output)');
      }
    });
  });
}

async function getSystemInfoHandler(): Promise<string> {
  const info = {
    platform: os.platform(),
    release: os.release(),
    arch: os.arch(),
    hostname: os.hostname(),
    totalMemoryMB: Math.round(os.totalmem() / (1024 * 1024)),
    freeMemoryMB: Math.round(os.freemem() / (1024 * 1024)),
    uptimeSeconds: Math.round(os.uptime()),
    cpuCount: os.cpus().length,
    homeDir: os.homedir(),
    cwd: process.cwd(),
    nodeVersion: process.version,
    pid: process.pid,
  };
  return JSON.stringify(info, null, 2);
}

export function registerSystemOpsTools(registry: ToolRegistry): void {
  registry.register({
    name: 'run_command',
    description: 'Execute a shell command. Only allowlisted commands can run. Use for git, npm, file ops, system queries.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute' },
      },
      required: ['command'],
    },
    handler: runCommandHandler,
    permission: 'user',
    securityLevel: 'confirm',
  });

  registry.register({
    name: 'get_system_info',
    description: 'Get system information including OS, CPU, memory, uptime, and Node.js version.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: getSystemInfoHandler,
    permission: 'public',
    securityLevel: 'safe',
  });
}
