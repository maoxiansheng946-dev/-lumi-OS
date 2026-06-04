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
    throw new Error('The "task" parameter is required — describe what you want Lumi to do on the desktop.');
  }

  const maxIterations = args.max_steps || args.maxIterations || 15;

  return computerUseLoop(task, {
    desktopRelay: context.desktopRelay,
    llmGetters: context.llmGetters,
    maxIterations: Math.min(maxIterations, 25), // hard cap at 25
    onProgress: (step: string) => {
      console.log(`[ComputerUse] ${step}`);
    },
    isCancelled: context.isCancelled,
  });
}

export function registerComputerUseTool(registry: ToolRegistry): void {
  registry.register({
    name: 'computer_use',
    description:
      'Take control of the user\'s desktop to complete a task autonomously. This tool uses screenshot capture + vision AI (GPT-4o or Gemini) to understand what\'s on screen, then controls the mouse and keyboard step by step until the task is complete. Use this for: opening applications, navigating websites, filling out forms, closing dialogs, moving files, managing windows, or any multi-step desktop interaction. Each iteration: takes a screenshot → analyzes with vision AI → executes one mouse/keyboard action → repeats. Max 15 iterations by default. The tool returns a summary of what was accomplished.',
    parameters: {
      type: 'object',
      properties: {
        task: {
          type: 'string',
          description:
            'Natural language description of what to do on the desktop. Be specific and sequential. Examples: "Open Chrome, go to github.com, and search for \'react hooks\'", "Close all error dialogs on screen", "Open Notepad and type \'Hello World\' then save it to Desktop as hello.txt", "Find the Settings window and turn on dark mode".',
        },
        max_steps: {
          type: 'number',
          description: 'Maximum number of screenshot+action iterations. Default 15. Increase for complex multi-step tasks.',
        },
      },
      required: ['task'],
    },
    handler: computerUse,
    permission: 'user',
    securityLevel: 'confirm',
  });
}
