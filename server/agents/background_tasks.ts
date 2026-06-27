import type { TaskComplexity } from './orchestrator';

export type BackgroundDelegationStatus =
  | 'queued'
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface BackgroundDelegationWorker {
  id?: string;
  name: string;
  category?: string;
}

export interface BackgroundDelegationTask {
  id: string;
  userId: string;
  title: string;
  prompt: string;
  status: BackgroundDelegationStatus;
  reason?: string;
  complexity?: TaskComplexity;
  workers: BackgroundDelegationWorker[];
  workerNames: string[];
  toolCallsCount: number;
  cancelRequested: boolean;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
  resultPreview?: string;
  error?: string;
}

interface RegisterBackgroundTaskInput {
  id?: string;
  userId: string;
  title: string;
  prompt: string;
  reason?: string;
  complexity?: TaskComplexity;
  workers?: BackgroundDelegationWorker[];
}

const tasks = new Map<string, BackgroundDelegationTask>();
const MAX_TASKS = 120;

function nowIso(): string {
  return new Date().toISOString();
}

function cloneTask(task: BackgroundDelegationTask): BackgroundDelegationTask {
  return {
    ...task,
    workers: task.workers.map(worker => ({ ...worker })),
    workerNames: [...task.workerNames],
  };
}

function trimTasks(): void {
  if (tasks.size <= MAX_TASKS) return;
  const ordered = Array.from(tasks.values()).sort((a, b) => {
    return new Date(a.updatedAt).getTime() - new Date(b.updatedAt).getTime();
  });
  for (const task of ordered.slice(0, tasks.size - MAX_TASKS)) {
    tasks.delete(task.id);
  }
}

export function registerBackgroundTask(input: RegisterBackgroundTaskInput): BackgroundDelegationTask {
  const timestamp = nowIso();
  const id = input.id || `bg_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
  const workers = (input.workers || []).slice(0, 8).map(worker => ({
    id: worker.id,
    name: String(worker.name || worker.id || 'Worker'),
    category: worker.category,
  }));
  const task: BackgroundDelegationTask = {
    id,
    userId: input.userId,
    title: input.title.slice(0, 160) || 'Background task',
    prompt: input.prompt,
    status: 'queued',
    reason: input.reason,
    complexity: input.complexity,
    workers,
    workerNames: workers.map(worker => worker.name),
    toolCallsCount: 0,
    cancelRequested: false,
    createdAt: timestamp,
    updatedAt: timestamp,
  };
  tasks.set(id, task);
  trimTasks();
  return cloneTask(task);
}

export function getBackgroundTask(id: string, userId?: string): BackgroundDelegationTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  if (userId && task.userId !== userId) return null;
  return cloneTask(task);
}

export function listBackgroundTasks(userId?: string): BackgroundDelegationTask[] {
  return Array.from(tasks.values())
    .filter(task => !userId || task.userId === userId)
    .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
    .map(cloneTask);
}

export function markBackgroundTaskRunning(id: string): BackgroundDelegationTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  if (task.cancelRequested) return cancelBackgroundTask(id);
  const timestamp = nowIso();
  task.status = 'running';
  task.startedAt = task.startedAt || timestamp;
  task.updatedAt = timestamp;
  return cloneTask(task);
}

export function incrementBackgroundTaskToolCalls(id: string): BackgroundDelegationTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  task.toolCallsCount += 1;
  task.updatedAt = nowIso();
  return cloneTask(task);
}

export function requestCancelBackgroundTask(id: string, userId?: string): BackgroundDelegationTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  if (userId && task.userId !== userId) return null;
  if (task.status === 'completed' || task.status === 'failed' || task.status === 'cancelled') {
    return cloneTask(task);
  }
  task.cancelRequested = true;
  task.status = 'cancelling';
  task.updatedAt = nowIso();
  return cloneTask(task);
}

export function isBackgroundTaskCancellationRequested(id: string): boolean {
  const task = tasks.get(id);
  return task?.cancelRequested === true || task?.status === 'cancelling' || task?.status === 'cancelled';
}

export function completeBackgroundTask(id: string, result: string): BackgroundDelegationTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  if (task.cancelRequested) return cancelBackgroundTask(id);
  const timestamp = nowIso();
  task.status = 'completed';
  task.resultPreview = result.slice(0, 500);
  task.updatedAt = timestamp;
  task.completedAt = timestamp;
  return cloneTask(task);
}

export function failBackgroundTask(id: string, error: string): BackgroundDelegationTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  if (task.cancelRequested) return cancelBackgroundTask(id);
  const timestamp = nowIso();
  task.status = 'failed';
  task.error = error.slice(0, 500);
  task.updatedAt = timestamp;
  task.completedAt = timestamp;
  return cloneTask(task);
}

export function cancelBackgroundTask(id: string): BackgroundDelegationTask | null {
  const task = tasks.get(id);
  if (!task) return null;
  const timestamp = nowIso();
  task.cancelRequested = true;
  task.status = 'cancelled';
  task.updatedAt = timestamp;
  task.completedAt = timestamp;
  return cloneTask(task);
}

export function resetBackgroundTasksForTest(): void {
  tasks.clear();
}
