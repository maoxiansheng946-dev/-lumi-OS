import { ToolRegistry } from '../registry';
import { computerUseLoop } from '../../agents/computer_use';

async function computerUse(args: Record<string, any>, context?: any): Promise<string> {
  if (!context?.desktopRelay) {
    throw new Error('Computer use requires the Tauri desktop app.');
  }

  if (!context?.llmGetters) {
    throw new Error('Computer use requires a vision-capable model (OpenAI GPT-4o or Gemini).');
  }

  const task = args.task || args.prompt || '';
  if (!task.trim()) {
    throw new Error('The "task" parameter is required. Describe what you want Lumi to do on the desktop.');
  }

  const maxIterations = args.max_steps || args.maxIterations || 12;

  return computerUseLoop(task, {
    desktopRelay: context.desktopRelay,
    llmGetters: context.llmGetters,
    maxIterations: Math.min(maxIterations, 15),
    onProgress: context.onProgress || ((step: string) => {
      console.log(`[ComputerUse] ${step}`);
    }),
    isCancelled: context.isCancelled,
  });
}

export function registerComputerUseTool(registry: ToolRegistry): void {
  registry.register({
    name: 'computer_use',
    description:
      'Take control of the user desktop to complete a task after confirmation. This tool uses screenshot capture and vision AI to understand what is on screen, then controls the mouse and keyboard step by step. Use this for opening applications, navigating websites, filling forms, closing dialogs, moving files, managing windows, or other visible desktop interactions. Each iteration takes a screenshot, analyzes it, executes one mouse/keyboard action, and repeats. Default 12 iterations, hard-capped at 15. It does not enter wallpaper mode.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Natural language description of what to do on the desktop. Be specific and sequential. Examples: "Open Chrome, go to github.com, and search for react hooks", "Close all error dialogs on screen", "Open Notepad and type Hello World".',
        },
        max_steps: {
          type: 'number',
          description: 'Maximum number of screenshot/action iterations. Default 12, hard cap 15.',
        },
      },
      required: ['task'],
    },
    handler: computerUse,
    permission: 'user',
    securityLevel: 'confirm',
  });
}
