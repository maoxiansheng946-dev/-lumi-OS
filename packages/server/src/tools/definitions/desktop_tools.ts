import { ToolRegistry } from '../registry';

async function desktopSystemInfo(_args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) {
    throw new Error('Desktop tools require a Tauri frontend relay (not available in web mode)');
  }
  return context.desktopRelay('desktop_system_info', {});
}

async function desktopListFiles(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) {
    throw new Error('Desktop tools require a Tauri frontend relay (not available in web mode)');
  }
  return context.desktopRelay('desktop_list_files', {
    path: args.path || '',
    limit: args.limit || 100,
  });
}

async function desktopOpen(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) {
    throw new Error('Desktop tools require a Tauri frontend relay (not available in web mode)');
  }
  return context.desktopRelay('desktop_open', {
    target: args.target || '',
  });
}

async function desktopRunCommand(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) {
    throw new Error('Desktop tools require a Tauri frontend relay (not available in web mode)');
  }
  return context.desktopRelay('desktop_run_command', {
    command: args.command || '',
    cwd: args.cwd || '',
  });
}

export function registerDesktopTools(registry: ToolRegistry): void {
  registry.register({
    name: 'desktop_system_info',
    description:
      'Get real host system info (OS, CPU, memory, home directory) from the desktop machine. Use this instead of get_system_info when you need actual hardware details, not just the server process view.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: desktopSystemInfo,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'desktop_list_files',
    description:
      'List files and directories on the user\'s real desktop machine at the given path. Defaults to the home directory. Returns name, path, and type (file/directory).',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Directory path to list. Leave empty for home directory.' },
        limit: { type: 'number', description: 'Maximum entries to return (default 100).' },
      },
      required: [],
    },
    handler: desktopListFiles,
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'desktop_open',
    description:
      'Open a file, folder, application, or URL using the OS default handler. Use this to launch apps (e.g., "notepad.exe", "calc.exe"), open folders (e.g., "C:\\Users"), open files with their default app, or open URLs in the browser. This is the preferred way to visibly launch something on the user\'s desktop.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', description: 'The file, folder, app name, or URL to open. Examples: "notepad.exe", "calc.exe", "C:\\Users", "https://github.com"' },
      },
      required: ['target'],
    },
    handler: desktopOpen,
    permission: 'user',
    securityLevel: 'confirm',
  });

  registry.register({
    name: 'desktop_run_command',
    description:
      'Execute a shell command on the user\'s real desktop machine. Supports cmd.exe /C on Windows and sh -c on Linux/macOS. Use this for system operations that need real desktop access.',
    parameters: {
      type: 'object',
      properties: {
        command: { type: 'string', description: 'The shell command to execute on the host machine.' },
        cwd: { type: 'string', description: 'Working directory for the command. Leave empty for default.' },
      },
      required: ['command'],
    },
    handler: desktopRunCommand,
    permission: 'user',
    securityLevel: 'confirm',
  });
}
