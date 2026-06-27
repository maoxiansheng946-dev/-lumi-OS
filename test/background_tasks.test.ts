import { beforeEach, describe, expect, it } from 'vitest';
import {
  cancelBackgroundTask,
  completeBackgroundTask,
  failBackgroundTask,
  getBackgroundTask,
  incrementBackgroundTaskToolCalls,
  isBackgroundTaskCancellationRequested,
  listBackgroundTasks,
  markBackgroundTaskRunning,
  registerBackgroundTask,
  requestCancelBackgroundTask,
  resetBackgroundTasksForTest,
} from '../server/agents/background_tasks';

describe('background task registry', () => {
  beforeEach(() => {
    resetBackgroundTasksForTest();
  });

  it('tracks a delegated task from queue to completion', () => {
    const created = registerBackgroundTask({
      userId: 'u1',
      title: 'Draft a legal memo',
      prompt: 'Read files and draft a memo',
      complexity: 'complex',
      workers: [{ id: 'legal', name: 'Legal Agent', category: 'law' }],
    });

    expect(created.status).toBe('queued');
    expect(created.workerNames).toEqual(['Legal Agent']);
    expect(listBackgroundTasks('u1')).toHaveLength(1);

    expect(markBackgroundTaskRunning(created.id)?.status).toBe('running');
    expect(incrementBackgroundTaskToolCalls(created.id)?.toolCallsCount).toBe(1);

    const completed = completeBackgroundTask(created.id, 'Done');
    expect(completed?.status).toBe('completed');
    expect(completed?.resultPreview).toBe('Done');
    expect(getBackgroundTask(created.id, 'u2')).toBeNull();
  });

  it('preserves cancellation when completion races with cancel', () => {
    const created = registerBackgroundTask({
      userId: 'u1',
      title: 'Background work',
      prompt: 'Do the work',
    });

    const cancelling = requestCancelBackgroundTask(created.id, 'u1');
    expect(cancelling?.status).toBe('cancelling');
    expect(isBackgroundTaskCancellationRequested(created.id)).toBe(true);

    const completed = completeBackgroundTask(created.id, 'Late success');
    expect(completed?.status).toBe('cancelled');
    expect(getBackgroundTask(created.id, 'u1')?.resultPreview).toBeUndefined();
  });

  it('marks failures and explicit cancellations', () => {
    const failed = registerBackgroundTask({
      userId: 'u1',
      title: 'Failure task',
      prompt: 'fail',
    });
    expect(failBackgroundTask(failed.id, 'boom')?.status).toBe('failed');
    expect(getBackgroundTask(failed.id, 'u1')?.error).toBe('boom');

    const cancelled = registerBackgroundTask({
      userId: 'u1',
      title: 'Cancel task',
      prompt: 'cancel',
    });
    expect(cancelBackgroundTask(cancelled.id)?.status).toBe('cancelled');
  });
});
