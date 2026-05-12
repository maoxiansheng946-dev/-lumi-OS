import { readDB, writeDB } from '../../db_layer';
import { Memory, MemoryQuery, MemoryType, MemoryTier, MemoryPerspective } from './types';

function getMemoryStore(): Memory[] {
  const db = readDB();
  if (!db.memories) db.memories = [];
  return db.memories;
}

// ── Dedup index (lazy, invalidated on write) ──

let dedupIndex: Map<string, Map<string, Memory[]>> | null = null;

function getDedupIndex(): Map<string, Map<string, Memory[]>> {
  if (dedupIndex) return dedupIndex;
  dedupIndex = new Map();
  for (const m of getMemoryStore()) {
    if (!dedupIndex.has(m.userId)) dedupIndex.set(m.userId, new Map());
    const typeMap = dedupIndex.get(m.userId)!;
    if (!typeMap.has(m.type)) typeMap.set(m.type, []);
    typeMap.get(m.type)!.push(m);
  }
  return dedupIndex;
}

function saveMemoryStore(memories: Memory[]): void {
  dedupIndex = null; // invalidate index on write
  const db = readDB();
  db.memories = memories;
  writeDB(db);
}

function generateId(): string {
  return `mem_${crypto.randomUUID()}`;
}

// Match CJK characters for language-aware tokenization
const CJK_RE = /[一-鿿㐀-䶿]/;

function tokenize(text: string): string[] {
  const tokens: string[] = [];
  const lower = text.toLowerCase();
  // Extract CJK character bigrams (overlapping pairs: 名字 → 名字)
  let cjkRun = '';
  for (const ch of lower) {
    if (CJK_RE.test(ch)) {
      cjkRun += ch;
      if (cjkRun.length >= 2) {
        tokens.push(cjkRun.slice(-2));
      }
    } else {
      if (cjkRun.length === 1) tokens.push(cjkRun); // lone CJK char
      cjkRun = '';
    }
  }
  if (cjkRun.length === 1) tokens.push(cjkRun);
  // Also split by whitespace for English/numbers
  const words = lower.split(/[\s,，。！？、；：""''（）\(\)\[\]【】]+/).filter(w => w.length > 1);
  for (const w of words) {
    if (!CJK_RE.test(w)) tokens.push(w);
    else if (w.length > 2) tokens.push(w); // keep full CJK words too
  }
  return [...new Set(tokens)];
}

/** Score query against memory using language-aware token overlap */
function relevanceScore(query: string, memory: Memory): number {
  const qTokens = tokenize(query);
  if (qTokens.length === 0) return memory.confidence;

  const contentLower = memory.content.toLowerCase();
  let hits = 0;
  for (const t of qTokens) {
    if (contentLower.includes(t)) { hits += 2; continue; }
    let kwHit = false;
    for (const kw of memory.keywords) {
      if (kw.toLowerCase().includes(t) || t.includes(kw.toLowerCase())) { kwHit = true; break; }
    }
    if (kwHit) hits += 1;
  }
  return (hits / (qTokens.length * 2)) * memory.confidence;
}

export function queryMemories(q: MemoryQuery): Memory[] {
  const all = getMemoryStore();

  const cutoff = q.before ? new Date(q.before).getTime() : 0;

  // Single-pass filter combining all conditions
  let memories = all.filter(m => {
    if (q.userId && m.userId !== q.userId) return false;
    if (q.agentId !== undefined && (m.agentId || '') !== q.agentId) return false;
    if (q.type && m.type !== q.type) return false;
    if (q.minConfidence !== undefined && m.confidence < q.minConfidence) return false;
    if (q.tier && m.tier !== q.tier) return false;
    if (q.perspective && m.perspective !== q.perspective) return false;
    if (q.minImportance !== undefined && m.importance < q.minImportance) return false;
    if (q.unconsolidatedOnly && m.parentId) return false;
    if (q.parentId !== undefined && m.parentId !== q.parentId) return false;
    if (q.nodeType && m.nodeType !== q.nodeType) return false;
    if (q.before && new Date(m.createdAt).getTime() > cutoff) return false;
    return true;
  });

  // Tier-based priority: core_identity always first, then growth, then internalized, then episodic
  const tierPriority: Record<string, number> = {
    core_identity: 0,
    growth: 1,
    internalized: 2,
    episodic: 3,
  };

  if (q.query) {
    const scored = memories
      .map(m => ({ m, score: relevanceScore(q.query!, m) }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => {
        // Tier priority overrides score within same magnitude
        const tierDiff = (tierPriority[a.m.tier] || 3) - (tierPriority[b.m.tier] || 3);
        if (Math.abs(tierDiff) >= 2) return tierDiff;
        return b.score - a.score;
      });
    memories = scored.map(({ m }) => m);
  } else {
    // Sort by tier priority, then importance, then confidence, then recency
    memories.sort((a, b) => {
      const tierDiff = (tierPriority[a.tier] || 3) - (tierPriority[b.tier] || 3);
      if (tierDiff !== 0) return tierDiff;
      if (b.importance !== a.importance) return b.importance - a.importance;
      // self-perspective memories take priority over owner traits
      const perspA = a.perspective === 'lumi_self' || a.perspective === 'lumi_growth' ? 0 : 1;
      const perspB = b.perspective === 'lumi_self' || b.perspective === 'lumi_growth' ? 0 : 1;
      if (perspA !== perspB) return perspA - perspB;
      if (b.confidence !== a.confidence) return b.confidence - a.confidence;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }

  const limit = q.limit || 10;
  const result = memories.slice(0, limit);

  // Mark as retrieved
  const now = new Date().toISOString();
  const store = getMemoryStore();
  for (const m of result) {
    const stored = store.find(s => s.id === m.id);
    if (stored) {
      stored.lastRetrievedAt = now;
      stored.retrieveCount = (stored.retrieveCount || 0) + 1;
    }
  }
  if (result.length > 0) saveMemoryStore(store);

  return result;
}

// ── Reminders ──

export interface Reminder {
  id: string;
  userId: string;
  content: string;
  dueAt: string | null;
  status: 'pending' | 'fired';
  sourceInteractionId: string;
  createdAt: string;
  firedAt: string | null;
}

function getReminderStore(): Reminder[] {
  const db = readDB();
  if (!db.reminders) db.reminders = [];
  return db.reminders;
}

function saveReminderStore(reminders: Reminder[]): void {
  const db = readDB();
  db.reminders = reminders;
  writeDB(db);
}

export function addReminder(reminder: Omit<Reminder, 'id' | 'createdAt' | 'status' | 'firedAt'>): Reminder {
  const all = getReminderStore();
  const now = new Date().toISOString();
  const newReminder: Reminder = {
    id: `rem_${crypto.randomUUID()}`,
    ...reminder,
    status: 'pending',
    createdAt: now,
    firedAt: null,
  };
  all.push(newReminder);
  saveReminderStore(all);
  return newReminder;
}

export function getDueReminders(): Reminder[] {
  const all = getReminderStore();
  const now = new Date().toISOString();
  return all
    .filter(r => r.status === 'pending' && r.dueAt && r.dueAt <= now)
    .slice(0, 10);
}

export function fireReminder(id: string): void {
  const all = getReminderStore();
  const r = all.find(r => r.id === id);
  if (r) {
    r.status = 'fired';
    r.firedAt = new Date().toISOString();
    saveReminderStore(all);
  }
}

// ── Memories ──

export function addMemory(
  memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt' | 'lastRetrievedAt' | 'retrieveCount' | 'tier' | 'perspective' | 'importance' | 'parentId' | 'agentId' | 'nodeType'>,
  overrides?: { tier?: Memory['tier']; perspective?: Memory['perspective']; importance?: number; parentId?: string | null; agentId?: string; nodeType?: Memory['nodeType'] },
): Memory {
  const all = getMemoryStore();

  // Deduplicate using index — only scan same userId + type
  const idx = getDedupIndex();
  const candidates = idx.get(memory.userId)?.get(memory.type) || [];
  const existing = candidates.find(m =>
    contentSimilarity(m.content, memory.content) > 0.7,
  );

  const now = new Date().toISOString();

  if (existing) {
    // Merge: increase confidence, update content if new one has higher confidence
    existing.content = memory.confidence > existing.confidence ? memory.content : existing.content;
    existing.keywords = dedupeKeywords([...existing.keywords, ...memory.keywords]);
    existing.confidence = Math.min(1, existing.confidence + 0.1);
    existing.importance = Math.max(existing.importance, overrides?.importance ?? 0.3);
    existing.updatedAt = now;
    saveMemoryStore(all);
    return existing;
  }

  const newMemory: Memory = {
    id: generateId(),
    ...memory,
    createdAt: now,
    updatedAt: now,
    lastRetrievedAt: null,
    retrieveCount: 0,
    tier: overrides?.tier ?? 'episodic',
    perspective: overrides?.perspective ?? 'owner_trait',
    importance: overrides?.importance ?? 0.3,
    parentId: overrides?.parentId ?? null,
    agentId: overrides?.agentId ?? '',
    nodeType: overrides?.nodeType ?? 'leaf',
  };

  all.push(newMemory);
  saveMemoryStore(all);
  return newMemory;
}

export function removeMemory(id: string): boolean {
  const all = getMemoryStore();
  const idx = all.findIndex(m => m.id === id);
  if (idx === -1) return false;
  all.splice(idx, 1);
  saveMemoryStore(all);
  return true;
}

/** Tier-based decay: core_identity never decays, episodic decays fast */
export function decayMemories(userId: string): void {
  const all = getMemoryStore();
  let changed = false;

  const decayRates: Record<MemoryTier, { amount: number; min: number }> = {
    core_identity: { amount: 0, min: 0.9 },     // Never decays
    growth: { amount: 0.02, min: 0.6 },          // Very slow
    internalized: { amount: 0.03, min: 0.3 },    // Slow
    episodic: { amount: 0.05, min: 0.1 },        // Fast
  };

  for (const m of all) {
    if (m.userId !== userId) continue;
    const rate = decayRates[m.tier] || decayRates.episodic;
    if (rate.amount === 0) continue;
    if (m.confidence <= rate.min) continue;
    m.confidence = Math.max(rate.min, +(m.confidence - rate.amount).toFixed(2));
    changed = true;
  }

  if (changed) saveMemoryStore(all);
}

/** Get episodic memories that are ready for consolidation (unconsolidated, count >= threshold) */
export function getUnconsolidatedEpisodic(userId: string): Memory[] {
  return getMemoryStore().filter(m =>
    m.userId === userId &&
    m.tier === 'episodic' &&
    !m.parentId &&
    m.confidence >= 0.2,
  );
}

/** Mark episodic memories as consolidated by setting parentId */
export function markConsolidated(ids: string[], parentId: string): void {
  const all = getMemoryStore();
  for (const m of all) {
    if (ids.includes(m.id)) {
      m.parentId = parentId;
      // Promote consolidated memories — they're now part of something bigger
      m.importance = Math.min(1, m.importance + 0.2);
    }
  }
  saveMemoryStore(all);
}

export function formatMemoriesForContext(memories: Memory[]): string {
  if (memories.length === 0) return '';

  // Separate branches and leaves
  const branches = memories.filter(m => m.nodeType === 'branch');
  const leaves = memories.filter(m => m.nodeType !== 'branch');

  const lines: string[] = [];

  // Group leaves by parent
  const byParent = new Map<string | null, Memory[]>();
  for (const leaf of leaves) {
    const key = leaf.parentId || null;
    if (!byParent.has(key)) byParent.set(key, []);
    byParent.get(key)!.push(leaf);
  }

  // Sort branches by importance
  branches.sort((a, b) => b.importance - a.importance || b.confidence - a.confidence);

  // Output branch sections
  for (const branch of branches) {
    const children = byParent.get(branch.id) || [];
    if (children.length === 0) continue;
    lines.push(`### ${branch.content}`);
    children.sort((a, b) => b.importance - a.importance || b.confidence - a.confidence);
    for (const m of children) {
      lines.push(`- ${m.content}`);
    }
  }

  // Output ungrouped leaves (no parent branch)
  const orphans = byParent.get(null) || [];
  if (orphans.length > 0) {
    for (const m of orphans) {
      // Filter out branches from the root display
      if (m.nodeType !== 'branch') {
        lines.push(`- ${m.content}`);
      }
    }
  }

  return lines.join('\n');
}

// ── Helpers ──

function contentSimilarity(a: string, b: string): number {
  const tokensA = new Set(tokenize(a));
  const tokensB = new Set(tokenize(b));
  if (tokensA.size === 0 || tokensB.size === 0) return 0;
  let overlap = 0;
  for (const w of tokensA) {
    if (tokensB.has(w)) overlap++;
  }
  return overlap / Math.max(tokensA.size, tokensB.size);
}

function dedupeKeywords(keywords: string[]): string[] {
  return [...new Set(keywords.map(k => k.toLowerCase()))].slice(0, 10);
}
