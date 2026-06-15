/**
 * Operation modes describe how much autonomy Lumi has.
 * Desktop control, terminal commands, tools, skills, teams, and sub-agents are
 * execution capabilities selected inside assistant/auto mode, not top-level modes.
 */
import { ToolPolicy } from '../personality/types';

export type OperationMode = 'chat' | 'assistant' | 'autonomous';

export interface OperationModeConfig {
  id: OperationMode;
  label: string;
  labelCN: string;
  description: string;
  promptOverlay: string;
  toolPolicy: ToolPolicy;
}

export const OPERATION_MODE_CONFIGS: Record<OperationMode, OperationModeConfig> = {
  chat: {
    id: 'chat',
    label: 'Chat',
    labelCN: 'Chat',
    description: 'Conversation only. Lumi answers naturally and does not call tools or open workspaces.',
    promptOverlay: 'This turn is chat-only. Do not call tools, operate the desktop, open the canvas, assemble agents, or claim that you are taking actions. Answer naturally and keep the interaction conversational.',
    toolPolicy: {
      allowedTools: [],
      requireConfirmation: [],
      forbiddenTools: ['*'],
      maxIterations: 0,
    },
  },

  assistant: {
    id: 'assistant',
    label: 'Assistant',
    labelCN: 'Assistant',
    description: 'Guided assistance. Lumi can use desktop, terminal, tools, skills, and teams when the request asks for action.',
    promptOverlay: [
      'You are in assistant mode.',
      'Choose the least disruptive execution capability for the user request: normal reply, tool, skill, file action, terminal command, mouse/keyboard desktop control, team/sub-agent, or canvas.',
      'Do not open the canvas unless the user asks for it or the UI has already moved the task into the canvas.',
      'For visible desktop work, explain what you are about to do and use mouse/keyboard tools naturally.',
      'For command/file/network actions, keep the user informed and respect confirmations.',
    ].join('\n'),
    toolPolicy: {
      allowedTools: ['*'],
      requireConfirmation: [
        'desktop_run_command',
        'run_command',
        'write_file',
        'web_search',
        'url_fetch',
        'read_file',
        'read_files_batch',
        'search_files',
        'grep_files',
        'computer_use',
      ],
      forbiddenTools: [],
      maxIterations: 25,
    },
  },

  autonomous: {
    id: 'autonomous',
    label: 'Auto Execute',
    labelCN: 'Auto Execute',
    description: 'Multi-step execution. Lumi can plan, use tools, operate the desktop, open canvas, and coordinate agents with visible progress.',
    promptOverlay: [
      'You are in auto execution mode.',
      'Work through the task end-to-end when the user gives an actionable request.',
      'Use the appropriate capabilities: desktop mouse/keyboard, terminal, files, skills, tools, MCP, canvas, team agents, and sub-agents.',
      'Keep progress visible, summarize major steps, and do not hide failures.',
      'Dangerous or destructive actions still require confirmation.',
    ].join('\n'),
    toolPolicy: {
      allowedTools: ['*'],
      requireConfirmation: [
        'file_delete',
        'delete_file',
        'rm',
        'unlink',
        'format',
        'rmdir',
        'uninstall',
        'desktop_run_command',
        'computer_use',
      ],
      forbiddenTools: [],
      securityOverrides: {
        desktop_run_command: 'safe',
        run_command: 'safe',
        write_file: 'safe',
      },
      maxIterations: 50,
    },
  },
};

export function normalizeOperationMode(mode?: string): OperationMode {
  if (mode === 'chat' || mode === 'assistant' || mode === 'autonomous') return mode;
  if (mode === 'desktop_control' || mode === 'terminal') return 'assistant';
  return 'assistant';
}

export function parseStoredOperationMode(value: unknown): OperationMode {
  if (typeof value !== 'string') return normalizeOperationMode((value as any)?.mode);
  try {
    const parsed = JSON.parse(value);
    return normalizeOperationMode(parsed?.mode ?? parsed);
  } catch {
    return normalizeOperationMode(value);
  }
}

export function getOperationModeConfig(mode?: string): OperationModeConfig {
  return OPERATION_MODE_CONFIGS[normalizeOperationMode(mode)];
}
