import vm from 'vm';
import { ToolRegistry } from '../registry';

async function codeExecutionHandler(args: Record<string, any>): Promise<string> {
  const code = String(args.code || '');
  const timeout = Math.min(Math.max(Number(args.timeout) || 10000, 1000), 30000);

  if (!code.trim()) throw new Error('Code is required.');

  // Capture console output
  const output: string[] = [];
  const sandboxConsole = {
    log: (...args: any[]) => { output.push(args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ')); },
    warn: (...args: any[]) => { output.push('[warn] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ')); },
    error: (...args: any[]) => { output.push('[error] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ')); },
    info: (...args: any[]) => { output.push('[info] ' + args.map(a => typeof a === 'string' ? a : JSON.stringify(a, null, 2)).join(' ')); },
  };

  const sandbox = {
    console: sandboxConsole,
    JSON,
    Math,
    Date,
    Array,
    Object,
    String,
    Number,
    Boolean,
    Map,
    Set,
    Promise,
    RegExp,
    Error,
    parseInt,
    parseFloat,
    isNaN,
    isFinite,
    setTimeout: undefined,
    setInterval: undefined,
    setImmediate: undefined,
    require: undefined,
    process: undefined,
    global: undefined,
    globalThis: undefined,
    __dirname: undefined,
    __filename: undefined,
    module: undefined,
    exports: undefined,
    fetch: undefined,
  };

  const context = vm.createContext(sandbox);

  try {
    const result = await Promise.race([
      vm.runInContext(code, context, {
        timeout,
        displayErrors: true,
      }),
      new Promise((_, reject) => setTimeout(() => reject(new Error('Execution timed out')), timeout)),
    ]);

    if (output.length > 0) {
      return output.join('\n');
    }

    if (result !== undefined) {
      return typeof result === 'string' ? result : JSON.stringify(result, null, 2);
    }

    return output.length > 0 ? output.join('\n') : '(code executed with no output)';
  } catch (err: any) {
    if (output.length > 0) {
      return output.join('\n') + `\n\nExecution error: ${err.message}`;
    }
    return `Execution error: ${err.message}`;
  }
}

export function registerCodeOpsTools(registry: ToolRegistry): void {
  registry.register({
    name: 'code_execution',
    description: 'Execute JavaScript code in a sandboxed environment. Returns stdout output or the last expression value. No access to filesystem, network, or Node.js APIs.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'JavaScript code to execute' },
        timeout: { type: 'number', description: 'Timeout in milliseconds (default 10000, max 30000)' },
      },
      required: ['code'],
    },
    handler: codeExecutionHandler,
    permission: 'user',
    securityLevel: 'confirm',
  });
}
