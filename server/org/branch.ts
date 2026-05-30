/**
 * Branch Connection Manager — runs on each employee's LumiOS instance.
 *
 * Manages the branch↔company-server connection: domain switching,
 * work-domain data sync, KB cache, offline queue, and health checks.
 *
 * All personal-domain data stays local — only work-domain data syncs.
 */

import { readDB, writeDB } from '../../db_layer';
import * as EDB from './db';

// ── Connection state ────────────────────────────────────────────────────

export type BranchStatus = 'disconnected' | 'connecting' | 'connected' | 'reconnecting' | 'error';

export interface BranchState {
  orgId: string | null;
  companyUrl: string | null;
  connectionToken: string | null;
  status: BranchStatus;
  currentDomain: 'personal' | 'work';
  lastSyncAt: string | null;
  lastHeartbeatAt: string | null;
}

let _branchState: BranchState | null = null;

function bs(): BranchState {
  if (!_branchState) {
    try {
      const saved = (readDB() as any).branchState;
      if (saved) { _branchState = saved; return _branchState; }
    } catch {}
    _branchState = {
      orgId: null, companyUrl: null, connectionToken: null,
      status: 'disconnected', currentDomain: 'personal',
      lastSyncAt: null, lastHeartbeatAt: null,
    };
  }
  return _branchState;
}

function saveBranchState(): void {
  try {
    const db = readDB();
    (db as any).branchState = bs();
    writeDB(db);
  } catch {}
}

export function getBranchState(): Readonly<BranchState> {
  return bs();
}

// ── Connection lifecycle ────────────────────────────────────────────────

export async function connectToOrg(
  orgId: string,
  companyUrl: string,
  token: string
): Promise<{ success: boolean; error?: string }> {
  bs().status = 'connecting';
  saveBranchState();

  try {
    // Register this branch with the company server
    const res = await fetch(`${companyUrl}/api/branch/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ orgId }),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      bs().status = 'error';
      saveBranchState();
      return { success: false, error: err.error || 'Registration failed' };
    }

    bs().orgId = orgId;
    bs().companyUrl = companyUrl;
    bs().connectionToken = token;
    bs().status = 'connected';
    bs().lastHeartbeatAt = new Date().toISOString();
    saveBranchState();

    // Pull KB cache in background
    pullKbCache().catch(() => {});

    // Flush any offline actions
    flushOfflineQueue().catch(() => {});

    return { success: true };
  } catch (err: any) {
    bs().status = 'error';
    saveBranchState();
    return { success: false, error: err.message };
  }
}

export function disconnectFromOrg(): void {
  bs().orgId = null;
  bs().companyUrl = null;
  bs().connectionToken = null;
  bs().status = 'disconnected';
  bs().currentDomain = 'personal'; // revert to personal on disconnect
  saveBranchState();
}

// ── Domain switching ────────────────────────────────────────────────────

export function switchDomain(domain: 'personal' | 'work'): void {
  bs().currentDomain = domain;
  saveBranchState();
  console.log(`[Branch] Domain switched to: ${domain}`);
}

export function getCurrentDomain(): 'personal' | 'work' {
  return bs().currentDomain;
}

export function isWorkDomain(): boolean {
  return bs().currentDomain === 'work' && bs().status === 'connected';
}

// ── Work data sync ──────────────────────────────────────────────────────

export interface SyncPayload {
  memories: any[];
  interactions: any[];
  agents: any[];
}

export async function syncWorkData(): Promise<{ synced: number; errors: string[] }> {
  if (!bs().companyUrl || !bs().connectionToken || !bs().orgId) {
    return { synced: 0, errors: ['Not connected to organization'] };
  }

  const db = readDB();
  const orgId = bs().orgId;

  // Gather all work-domain data that hasn't been synced
  const payload: SyncPayload = {
    memories: (db.memories || []).filter((m: any) => m.domain === 'work' && m.orgId === orgId && !m._syncedAt),
    interactions: (db.interactions || []).filter((i: any) => i.domain === 'work' && i.orgId === orgId && !i._syncedAt),
    agents: (db.agents || []).filter((a: any) => a.domain === 'work' && a.orgId === orgId && !a._syncedAt),
  };

  const total = payload.memories.length + payload.interactions.length + payload.agents.length;
  if (total === 0) return { synced: 0, errors: [] };

  try {
    const res = await fetch(`${bs().companyUrl}/api/branch/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${bs().connectionToken}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({ error: res.statusText }));
      return { synced: 0, errors: [err.error || 'Sync rejected'] };
    }

    // Mark items as synced
    const allIds = [
      ...payload.memories.map((m: any) => m.id),
      ...payload.interactions.map((i: any) => i.id),
      ...payload.agents.map((a: any) => a.id),
    ];
    EDB.setDomain('memories', payload.memories.map((m: any) => m.id), 'work', orgId);

    // Add _syncedAt marker
    const now = new Date().toISOString();
    for (const arr of [db.memories, db.interactions, db.agents]) {
      if (!arr) continue;
      for (const item of arr) {
        if (allIds.includes(item.id)) {
          item._syncedAt = now;
        }
      }
    }
    writeDB(db);

    bs().lastSyncAt = now;
    saveBranchState();

    return { synced: total, errors: [] };
  } catch (err: any) {
    return { synced: 0, errors: [err.message] };
  }
}

// ── KB Cache ────────────────────────────────────────────────────────────

interface CachedArticle {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string;
  cachedAt: string;
}

let kbCache: CachedArticle[] = [];

export async function pullKbCache(): Promise<number> {
  if (!bs().companyUrl || !bs().connectionToken) return 0;

  try {
    const res = await fetch(`${bs().companyUrl}/api/branch/kb-cache`, {
      headers: { Authorization: `Bearer ${bs().connectionToken}` },
    });
    if (!res.ok) return 0;

    const data = await res.json();
    kbCache = (data.articles || []).map((a: any) => ({
      ...a,
      cachedAt: new Date().toISOString(),
    }));

    return kbCache.length;
  } catch {
    return 0;
  }
}

export function searchKbCache(query: string): CachedArticle[] {
  const lower = query.toLowerCase();
  return kbCache.filter(
    a =>
      a.title.toLowerCase().includes(lower) ||
      a.content.toLowerCase().includes(lower) ||
      (a.tags && a.tags.toLowerCase().includes(lower))
  );
}

export function getKbCacheStats(): { count: number; lastUpdated: string | null } {
  const timestamps = kbCache.map(a => a.cachedAt).sort();
  return {
    count: kbCache.length,
    lastUpdated: timestamps.length > 0 ? timestamps[timestamps.length - 1] : null,
  };
}

// ── Offline queue ───────────────────────────────────────────────────────

interface OfflineAction {
  id: string;
  type: 'sync' | 'agent_action' | 'kb_query';
  payload: any;
  queuedAt: string;
}

let offlineQueue: OfflineAction[] = [];

export function queueOfflineAction(type: OfflineAction['type'], payload: any): void {
  offlineQueue.push({
    id: Math.random().toString(36).substring(2, 10),
    type,
    payload,
    queuedAt: new Date().toISOString(),
  });
}

export async function flushOfflineQueue(): Promise<{ flushed: number; errors: string[] }> {
  if (offlineQueue.length === 0) return { flushed: 0, errors: [] };
  if (!bs().companyUrl || !bs().connectionToken) {
    return { flushed: 0, errors: ['Not connected'] };
  }

  let flushed = 0;
  const errors: string[] = [];

  for (const action of [...offlineQueue]) {
    try {
      if (action.type === 'sync') {
        await syncWorkData();
      } else if (action.type === 'kb_query') {
        // KB queries are served from cache — no replay needed
      }
      offlineQueue = offlineQueue.filter(a => a.id !== action.id);
      flushed++;
    } catch (err: any) {
      errors.push(`[${action.type}] ${err.message}`);
    }
  }

  return { flushed, errors };
}

export function getOfflineQueueLength(): number {
  return offlineQueue.length;
}

// ── Health check ────────────────────────────────────────────────────────

export async function checkConnection(): Promise<BranchStatus> {
  if (!bs().companyUrl || !bs().connectionToken) {
    bs().status = 'disconnected';
    saveBranchState();
    return 'disconnected';
  }

  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const res = await fetch(`${bs().companyUrl}/api/branch/status`, {
      headers: { Authorization: `Bearer ${bs().connectionToken}` },
      signal: controller.signal,
    }).finally(() => clearTimeout(timeout));

    if (res.ok) {
      bs().status = 'connected';
      bs().lastHeartbeatAt = new Date().toISOString();
    } else if (res.status === 401) {
      bs().status = 'error';
      disconnectFromOrg();
    } else {
      bs().status = 'reconnecting';
    }
  } catch {
    bs().status = 'reconnecting';
    // Queue sync for when reconnected
  }

  saveBranchState();
  return bs().status;
}

// ── Auto-sync timer ─────────────────────────────────────────────────────

let autoSyncTimer: ReturnType<typeof setInterval> | null = null;

export function startAutoSync(intervalMs: number = 30000): void {
  if (autoSyncTimer) return;
  autoSyncTimer = setInterval(async () => {
    if (bs().status === 'connected' && bs().currentDomain === 'work') {
      await syncWorkData();
      await checkConnection();
    }
  }, intervalMs);
}

export function stopAutoSync(): void {
  if (autoSyncTimer) {
    clearInterval(autoSyncTimer);
    autoSyncTimer = null;
  }
}
