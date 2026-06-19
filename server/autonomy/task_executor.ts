/**
 * Autonomous Task Executor — processes the autonomous task queue.
 * Executes tasks via runWithTools with tighter safety policy than user-initiated autonomous mode.
 */
import { dequeue, markRunning, markCompleted, markFailed, getRunningTask } from './task_queue';
import { isAutonomousWorkAllowed, isExternalAppAutomationAllowed, recordAutonomousTokens } from './safety_gate';
import { runWithTools } from '../llm/adapter';
import { toolRegistry } from '../tools/registry';
import { ToolContext } from '../tools/types';
import { Server as SocketIOServer } from 'socket.io';
import type { AutonomousTask } from './task_queue';
import { getUserPreferredLLMConfig } from '../llm/user_preferences';
import { formatLumiConstitutionForPrompt } from '../personality/constitution';

interface LLMGetters {
  getDeepSeek: () => any;
  getGemini: () => any;
  getOpenAI?: () => any;
  getAnthropic?: () => any;
  getQwen?: () => any;
  getXiaomi?: () => any;
  getKimi?: () => any;
  getGlm?: () => any;
  getRelay?: () => any;
}

/** Tight tool policy for autonomous background work — more conservative than user-initiated mode */
const AUTONOMOUS_POLICY = {
  allowedTools: ['*'],
  requireConfirmation: [],
  forbiddenTools: [
    'delete_file',
    'run_command',   // shell remains available but gated below
    'system_command',
  ],
  maxIterations: 15,
};

/** Desktop tools that are always safe for autonomous use */
const ALLOWED_DESKTOP_TOOLS = [
  'desktop_system_info',
  'desktop_list_files',
  'desktop_open',
  'capture_screen',
  'get_active_window_info',
  'get_running_processes',
  'read_clipboard',
  'mouse_move',
  'mouse_click',
  'mouse_drag',
  'keyboard_type',
  'keyboard_press',
  'ocr_screen',
  'ocr_region',
];

const pendingDesktopResults = new Map<string, {
  resolve: (output: string) => void;
  reject: (err: Error) => void;
  timeout: ReturnType<typeof setTimeout>;
}>();

export function handleAutonomousDesktopResult(
  correlationId: string,
  data: { output?: string; error?: string },
): boolean {
  const pending = pendingDesktopResults.get(correlationId);
  if (!pending) return false;

  pendingDesktopResults.delete(correlationId);
  clearTimeout(pending.timeout);
  if (data?.error) pending.reject(new Error(data.error));
  else pending.resolve(data?.output || '');
  return true;
}

function isDesktopTool(name: string): boolean {
  return /^(desktop_|mouse_|keyboard_|computer_|get_|capture_|read_|ocr_)/.test(name);
}

function isExternalAutomationTool(name: string): boolean {
  return name === 'desktop_open'
    || name.startsWith('mouse_')
    || name.startsWith('keyboard_')
    || name.startsWith('computer_');
}

export async function executeNextAutonomousTask(
  io: SocketIOServer,
  getters: LLMGetters,
): Promise<{ executed: boolean; taskId?: string; result?: string }> {
  // Don't start a new task if one is already running
  if (getRunningTask()) {
    return { executed: false, result: 'Task already running' };
  }

  const task = dequeue();
  if (!task) return { executed: false };

  const gate = isAutonomousWorkAllowed(task.userId);
  if (!gate.allowed) {
    return { executed: false, taskId: task.id, result: `Blocked by safety gate: ${gate.reason || 'not allowed'}` };
  }

  const running = markRunning(task.id);
  if (!running) return { executed: false };

  io.emit('autonomous:task_started', {
    taskId: task.id,
    title: task.title,
    mode: task.mode,
    timestamp: new Date().toISOString(),
  });

  try {
    // Build desktop relay using socket.io broadcast
    const desktopRelay = async (toolName: string, args: Record<string, any>): Promise<string> => {
      // Only allow safe desktop tools in autonomous mode
      if (!ALLOWED_DESKTOP_TOOLS.includes(toolName) && isDesktopTool(toolName)) {
        throw new Error(`Autonomous safety: desktop tool "${toolName}" is not allowed`);
      }
      if (isExternalAutomationTool(toolName) && !isExternalAppAutomationAllowed()) {
        throw new Error(`Autonomous safety: external app automation is disabled for "${toolName}"`);
      }
      return new Promise((resolve, reject) => {
        const cid = `autonomous_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
        const timeout = setTimeout(() => {
          pendingDesktopResults.delete(cid);
          reject(new Error(`Desktop tool "${toolName}" timed out (30s)`));
        }, 30000);

        pendingDesktopResults.set(cid, { resolve, reject, timeout });
        io.to(`user:${task.userId}`).emit('tool:desktop_exec', { correlationId: cid, name: toolName, arguments: args });
      });
    };

    let cancelled = false;

    const context: ToolContext = {
      userId: task.userId,
      desktopRelay: task.mode === 'desktop' ? desktopRelay : undefined,
      requestConfirmation: async () => true, // Auto-approve in autonomous mode
      toolPolicy: AUTONOMOUS_POLICY,
      isCancelled: () => cancelled,
      autonomous: true,
      source: 'autonomous',
    };

    const messages = [
      { role: 'system' as const, content: [
        `You are Lumi executing an autonomous background task. You work independently without user interaction. Be efficient and direct. Current task mode: ${task.mode}.`,
        formatLumiConstitutionForPrompt(),
        'For concrete deliverables, define the work product with work_product_plan, verify it with work_product_verify or domain-specific verification tools, repair failed criteria, and only then mark the task complete. If confirmation or missing input blocks progress, report the blocker.',
      ].join('\n\n') },
      { role: 'user' as const, content: task.description },
    ];

    const result = await runWithTools(
      messages,
      toolRegistry,
      getUserPreferredLLMConfig(task.userId, { maxTokens: 2000 }),
      undefined, // onToolCall
      15, // maxIterations
      getters.getDeepSeek, getters.getGemini,
      getters.getOpenAI || (() => null),
      getters.getAnthropic || (() => null),
      getters.getQwen || (() => null),
      undefined, // onStreamChunk
      context,
      undefined, undefined, // ollama, lmstudio
      undefined, // ark
      getters.getXiaomi, getters.getKimi, getters.getGlm, getters.getRelay,
    );

    const toolCallCount = result.toolCalls.length;
    const tokensUsed = result.usageRecords.reduce((sum, r) => sum + r.totalTokens, 0);
    recordAutonomousTokens(task.userId, tokensUsed);

    const summary = result.text || `Completed with ${toolCallCount} tool calls.`;
    markCompleted(task.id, summary, toolCallCount, tokensUsed);

    io.emit('autonomous:task_completed', {
      taskId: task.id,
      title: task.title,
      result: summary,
      toolCallsCount: toolCallCount,
      tokensUsed,
      timestamp: new Date().toISOString(),
    });

    console.log(`[AutoExecutor] Task "${task.title}" completed: ${toolCallCount} tools, ${tokensUsed} tokens`);
    return { executed: true, taskId: task.id, result: summary };
  } catch (err: any) {
    const errorMsg = err.message || 'Unknown error';
    markFailed(task.id, errorMsg);

    io.emit('autonomous:task_failed', {
      taskId: task.id,
      title: task.title,
      error: errorMsg,
      timestamp: new Date().toISOString(),
    });

    console.warn(`[AutoExecutor] Task "${task.title}" failed:`, errorMsg);
    return { executed: true, taskId: task.id, result: `Failed: ${errorMsg}` };
  }
}
