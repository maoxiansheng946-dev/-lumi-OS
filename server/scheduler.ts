// Proactive agent scheduler - cron-like check-ins
// Each check-in fires a socket event to the UI so the user sees "Lumi checked in"

import { Server as SocketIOServer } from 'socket.io';
import { queryMemories, getDueReminders, fireReminder, runBehavioralAnalysis, decayMemories, dynamicDecayMemories, promoteMemories, getUnconsolidatedEpisodic, autoMarkCrossAgentShare } from './memory';
import { consolidateEpisodic, selfReflect, ConsolidationContext } from './memory/consolidator';
import { buildTree, ensureBranch, moveNode } from './memory/tree';
import { makeLLMCall } from './llm/providers';
import { getWeatherBrief, getTimeGreeting } from './services/weather';
import { autoGenerateSkill } from './skills/generator';
import { autoGenerateWorkflows } from './agents/workflows';
import { readDB } from '../db_layer';
import { AgentRuntime, AgentRecord } from './agents/runtime';
import { personalityRegistry } from './personality';
import { evolvePersonality } from './personality/evolution';
import { loadEmotionalState } from './personality/state';
import { getSameMonthDayPast, getMonthDayFromISO } from './time/utils';
import { detectSpatiotemporalPatterns } from './time/spatiotemporal';
import { cleanupEphemeralAgents } from './agents/orchestrator';

interface ScheduledTask {
  id: string;
  cron: string;
  lastRun: string | null;
  handler: () => Promise<string | null>;
}

type LLMGetters = {
  getDeepSeek: () => any;
  getGemini: () => any;
  getOpenAI?: () => any;
  getAnthropic?: () => any;
  getQwen?: () => any;
};

class Scheduler {
  private tasks: ScheduledTask[] = [];
  private timers: Map<string, NodeJS.Timeout> = new Map();
  io: SocketIOServer | null = null;
  private llmGetters: LLMGetters | null = null;

  setIO(io: SocketIOServer) {
    this.io = io;
  }

  setLLMGetters(getters: LLMGetters) {
    this.llmGetters = getters;
  }

  register(task: ScheduledTask) {
    this.tasks.push(task);
    this.scheduleTask(task);
  }

  listTasks() {
    return this.tasks.map(task => ({
      id: task.id,
      cron: task.cron,
      lastRun: task.lastRun,
      active: this.timers.has(task.id),
    }));
  }

  private scheduleTask(task: ScheduledTask) {
    const parsed = this.parseCron(task.cron);

    if (parsed.type === 'interval') {
      // Simple fixed interval — use setInterval (backward compat)
      const timer = setInterval(async () => {
        try {
          const message = await task.handler();
          task.lastRun = new Date().toISOString();
          if (message && this.io) {
            this.io.emit('agent:proactive', {
              taskId: task.id,
              message,
              timestamp: task.lastRun,
            });
          }
        } catch (err: any) {
          console.warn(`[Scheduler] Task "${task.id}" failed:`, err.message);
        }
      }, parsed.intervalMs);
      this.timers.set(task.id, timer);
      console.log(`[Scheduler] Registered task "${task.id}" every ${parsed.intervalMs / 1000}s`);
    } else {
      // Real cron expression — use recursive setTimeout to hit exact times
      const runAndReschedule = async () => {
        try {
          const message = await task.handler();
          task.lastRun = new Date().toISOString();
          if (message && this.io) {
            this.io.emit('agent:proactive', {
              taskId: task.id,
              message,
              timestamp: task.lastRun,
            });
          }
        } catch (err: any) {
          console.warn(`[Scheduler] Task "${task.id}" failed:`, err.message);
        }
        // Schedule next run
        const nextMs = this.nextCronTime(parsed.fields!);
        const timer = setTimeout(runAndReschedule, nextMs);
        this.timers.set(task.id, timer);
      };
      const firstMs = this.nextCronTime(parsed.fields!);
      const timer = setTimeout(runAndReschedule, firstMs);
      this.timers.set(task.id, timer);
      const [m, h, dom, mon, dow] = parsed.fields!;
      console.log(`[Scheduler] Registered cron task "${task.id}" — ${m} ${h} ${dom} ${mon} ${dow} (next in ${Math.round(firstMs / 1000)}s)`);
    }
  }

  /** Parse a cron string — returns either a fixed interval or cron field array */
  private parseCron(cron: string): { type: 'interval'; intervalMs: number } | { type: 'cron'; fields: number[] } {
    // Aliases (backward compatible)
    switch (cron) {
      case 'every_5m': return { type: 'interval', intervalMs: 5 * 60 * 1000 };
      case 'every_1h': return { type: 'interval', intervalMs: 60 * 60 * 1000 };
      case 'every_6h': return { type: 'interval', intervalMs: 6 * 60 * 60 * 1000 };
      case 'daily_9am': return { type: 'interval', intervalMs: 24 * 60 * 60 * 1000 };
      case 'evening_8pm': return { type: 'interval', intervalMs: 24 * 60 * 60 * 1000 };
      case 'every_30m': return { type: 'interval', intervalMs: 30 * 60 * 1000 };
      case 'every_7d': return { type: 'interval', intervalMs: 7 * 24 * 60 * 60 * 1000 };
    }

    // Real cron: 5 fields — minute hour dom month dow
    const parts = cron.trim().split(/\s+/);
    if (parts.length === 5) {
      const fields = parts.map(p => {
        const n = parseInt(p, 10);
        return isNaN(n) ? -1 : n; // -1 = wildcard (*)
      });
      return { type: 'cron', fields };
    }

    // Fallback: treat as interval alias
    return { type: 'interval', intervalMs: 60 * 60 * 1000 };
  }

  /** Compute milliseconds until the next cron match */
  private nextCronTime(fields: number[]): number {
    const [minute, hour, dom, month, dow] = fields;
    const now = new Date();
    let next = new Date(now.getFullYear(), now.getMonth(), now.getDate(), now.getHours(), now.getMinutes() + 1, 0, 0);

    // Try up to 366 days ahead (cover a full year)
    for (let i = 0; i < 366 * 24 * 60; i++) {
      const m = next.getMinutes();
      const h = next.getHours();
      const d = next.getDate();
      const mo = next.getMonth() + 1;
      const w = next.getDay();

      const mMatch = minute < 0 || m === minute;
      const hMatch = hour < 0 || h === hour;
      const domMatch = dom < 0 || d === dom;
      const monMatch = month < 0 || mo === month;
      const dowMatch = dow < 0 || w === dow;

      if (mMatch && hMatch && domMatch && monMatch && dowMatch) {
        const ms = next.getTime() - now.getTime();
        return Math.max(1000, ms); // Minimum 1 second
      }

      next = new Date(next.getTime() + 60000); // +1 minute
    }

    return 60 * 60 * 1000; // Fallback: 1 hour
  }

  stop() {
    for (const timer of this.timers.values()) {
      clearInterval(timer);
      clearTimeout(timer); // Also clear cron timeouts
    }
    this.timers.clear();
  }
}

export const scheduler = new Scheduler();

/**
 * Register built-in proactive tasks.
 * Accepts LLM provider getters so consolidation and self-reflection can call the LLM.
 */
export function registerScheduledTasks(
  getDeepSeek: () => any,
  getGemini: () => any,
  getOpenAI?: () => any,
  getAnthropic?: () => any,
  getQwen?: () => any,
) {
  /** Get all unique user IDs from DB (registered users + anonymous fallback) */
  function getAllUserIds(): string[] {
    const db = readDB();
    const ids = new Set<string>();
    for (const u of db.users || []) {
      if (u.uid) ids.add(u.uid);
    }
    for (const m of db.memories || []) {
      if (m.userId) ids.add(m.userId);
    }
    for (const i of db.interactions || []) {
      if (i.userId) ids.add(i.userId);
    }
    if (ids.size === 0) ids.add('anonymous');
    return [...ids];
  }

  // Reminder check-in (every 5 min) — checks all users' reminders
  scheduler.register({
    id: 'reminder_check',
    cron: 'every_5m',
    lastRun: null,
    handler: async () => {
      const due = getDueReminders();
      if (due.length > 0) {
        const messages = due.map(r => r.content);
        for (const r of due) fireReminder(r.id);
        return `Reminder: ${messages.join(' | ')}`;
      }
      return null;
    },
  });

  // Memory decay — value-modulated tier-based decay for all users (every 6h)
  scheduler.register({
    id: 'memory_decay',
    cron: 'every_6h',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      for (const userId of userIds) {
        dynamicDecayMemories(userId);
      }
      const lowConf = queryMemories({ minConfidence: 0, limit: 5 });
      const decayed = lowConf.filter(m => m.confidence < 0.25 && m.confidence > 0.1);
      if (decayed.length > 0) {
        return `Some memories are fading. Would you like me to refresh what I know about you?`;
      }
      return null;
    },
  });

  // Memory crystallization — auto-promote high-value memories (every 1h)
  // Cross-system fusion: higher intimacy lowers promotion thresholds
  scheduler.register({
    id: 'memory_crystallization',
    cron: 'every_1h',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      let totalPromoted = 0;
      for (const userId of userIds) {
        const emotionalState = loadEmotionalState(userId);
        totalPromoted += promoteMemories(userId, emotionalState.intimacy);
        // Auto-mark newly crystallized memories as cross-agent shareable
        autoMarkCrossAgentShare(userId);
      }
      if (totalPromoted > 0) {
        return `${totalPromoted} memories have crystallized into deeper knowledge.`;
      }
      return null;
    },
  });

  // Memory consolidation (every 30 min) — triggers when >=10 unconsolidated episodic
  scheduler.register({
    id: 'memory_consolidation',
    cron: 'every_30m',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      const messages: string[] = [];
      for (const userId of userIds) {
        const episodic = getUnconsolidatedEpisodic(userId);
        if (episodic.length < 10) continue;
        const ctx: ConsolidationContext = { userId, provider: 'deepseek', model: 'deepseek-chat' };
        const consolidated = await consolidateEpisodic(
          ctx, 10,
          getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
        );
        if (consolidated) {
          messages.push(`[${userId}] I've grown from our conversations: ${consolidated.content.slice(0, 200)}`);
        }
      }
      return messages.length > 0 ? messages.join('\n') : null;
    },
  });

  // Morning briefing with weather
  scheduler.register({
    id: 'daily_summary',
    cron: 'daily_9am',
    lastRun: null,
    handler: async () => {
      const greeting = getTimeGreeting();
      const weather = await getWeatherBrief();
      const pending = getDueReminders();
      const recentMemories = queryMemories({ limit: 5 });

      const parts: string[] = [`${greeting}!`];
      if (weather) parts.push(weather);
      if (pending.length > 0) parts.push(`${pending.length} reminder${pending.length > 1 ? 's' : ''} pending: ${pending.map(r => r.content).join(' | ')}`);
      if (recentMemories.length > 0) {
        const tiers = [...new Set(recentMemories.map(m => m.tier))];
        parts.push(`${recentMemories.length} memories across ${tiers.length} tiers`);
      }
      return parts.join(' - ');
    },
  });

  // Evening wrap-up
  scheduler.register({
    id: 'evening_wrapup',
    cron: 'evening_8pm',
    lastRun: null,
    handler: async () => {
      const pending = getDueReminders();
      const recentMemories = queryMemories({ limit: 5 });
      const parts: string[] = [];

      if (pending.length > 0) {
        parts.push(`${pending.length} reminder${pending.length > 1 ? 's' : ''} still pending`);
      }
      if (recentMemories.length > 0) {
        const habits = recentMemories.filter(m => m.type === 'habit');
        if (habits.length > 0) parts.push(`Today I noticed: ${habits[0].content.slice(0, 100)}`);
      }
      if (parts.length === 0) return null;
      return `Evening check-in - ${parts.join(' - ')}`;
    },
  });

  // Behavioral pattern analysis (every 6h) — for all users
  scheduler.register({
    id: 'behavioral_analysis',
    cron: 'every_6h',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      let totalCount = 0;
      for (const userId of userIds) {
        totalCount += runBehavioralAnalysis(userId);
      }
      if (totalCount > 0) {
        return `I've discovered ${totalCount} new behavioral patterns from your interactions. Check Memory Explorer to review.`;
      }
      return null;
    },
  });

  // Memory tree auto-organize (every 6h) — LLM groups orphan leaves into topic branches
  scheduler.register({
    id: 'memory_auto_organize',
    cron: 'every_6h',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      let totalBranches = 0;
      let totalAssigned = 0;

      for (const userId of userIds) {
        try {
          const db = readDB();
          const allMemories: any[] = db.memories || [];
          const orphans = allMemories.filter(
            (m: any) => m.userId === userId && m.nodeType !== 'branch' && !m.parentId,
          );
          if (orphans.length < 3) continue;

          const tree = buildTree(allMemories.filter((m: any) => m.userId === userId));
          const treeSummary = tree.map(
            t => `- ${t.node.content} [${t.node.nodeType}] (${t.children.length} children)`,
          ).join('\n');

          const prompt = `You are organizing a memory tree. Below is the current tree structure and a list of unorganized memories.

CURRENT TREE:
${treeSummary || '(empty)'}

UNORGANIZED MEMORIES:
${orphans.map((m: any) => `- [${m.id}] ${m.content}`).join('\n')}

Group these unorganized memories into 3-8 topic branches. For each memory, decide which topic it belongs to.
Return JSON:
{
  "branches": [
    { "title": "Topic name (short, 2-4 words)", "memoryIds": ["mem_xxx", "mem_yyy"] }
  ]
}

Rules:
- Every unorganized memory MUST be assigned to exactly one branch
- Branch titles should be meaningful topic names
- Create as few branches as necessary (merge similar topics)
- Return ONLY valid JSON, no markdown`;

          const llmResult = await makeLLMCall(
            [{ role: 'user', content: prompt }],
            [],
            { provider: 'qwen', model: 'qwen-plus' },
            getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
          );

          let plan: { branches: { title: string; memoryIds: string[] }[] };
          try {
            const json = (llmResult.text || '').replace(/```json|```/g, '').trim();
            plan = JSON.parse(json);
          } catch {
            console.warn(`[Scheduler] Auto-organize: LLM returned invalid JSON for ${userId}`);
            continue;
          }

          for (const branch of plan.branches) {
            if (!branch.title || !Array.isArray(branch.memoryIds)) continue;
            const branchNode = ensureBranch(userId, branch.title, '', null);
            totalBranches++;
            for (const memId of branch.memoryIds) {
              const ok = moveNode(memId, branchNode.id);
              if (ok) totalAssigned++;
            }
          }

          if (plan.branches.length > 0) {
            console.log(
              `[Scheduler] Auto-organized ${userId}: ${plan.branches.length} branches, ` +
              `${plan.branches.reduce((s, b) => s + b.memoryIds.length, 0)} memories`,
            );
          }
        } catch (err: any) {
          console.warn(`[Scheduler] Auto-organize failed for ${userId}:`, err.message);
        }
      }

      if (totalBranches > 0) {
        return `I've organized ${totalAssigned} memories into ${totalBranches} topic branches for easier recall.`;
      }
      return null;
    },
  });

  // Personality evolution (every 7 days, offset by 12h from self-reflection)
  // Lumi's personality grows toward the owner through accumulated interaction data
  scheduler.register({
    id: 'personality_evolution',
    cron: 'every_7d',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      const messages: string[] = [];
      for (const userId of userIds) {
        try {
          // Only evolve the 'lumi' personality (owner-mirroring for Lumi specifically)
          const config = personalityRegistry.get('lumi');
          if (!config) continue;

          const evolutionConfig = personalityRegistry.getEvolutionConfig('lumi');
          const emotionalState = loadEmotionalState(userId);

          const step = await evolvePersonality(
            config,
            userId,
            emotionalState.connection,
            getDeepSeek,
            getGemini,
            getOpenAI || (() => null),
            getAnthropic || (() => null),
            getQwen || (() => null),
            evolutionConfig,
          );

          if (step) {
            personalityRegistry.applyEvolution('lumi', step);
            messages.push(
              `I've grown closer to understanding you. ${step.narrative}`
            );
            console.log(`[Scheduler] Personality evolution complete for ${userId}: ${step.version}`);
          }
        } catch (err: any) {
          console.error(`[Scheduler] Personality evolution failed for ${userId}:`, err.message);
        }
      }
      return messages.length > 0 ? messages.join('\n') : null;
    },
  });

  // Self-reflection (every 7 days) — introspective growth narrative, per-user
  scheduler.register({
    id: 'self_reflection',
    cron: 'every_7d',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      const messages: string[] = [];
      for (const userId of userIds) {
        const ctx: ConsolidationContext = { userId, provider: 'deepseek', model: 'deepseek-chat' };
        const reflection = await selfReflect(
          ctx,
          getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
        );
        if (reflection) {
          messages.push(`I've been reflecting on our time together: ${reflection.content.slice(0, 200)}`);
        }
      }
      return messages.length > 0 ? messages.join('\n') : null;
    },
  });

  // Auto skill generation (every 30 min) — detects repeatable workflows
  scheduler.register({
    id: 'auto_skill_gen',
    cron: 'every_30m',
    lastRun: null,
    handler: async () => {
      const result = await autoGenerateSkill(
        getDeepSeek,
        getGemini,
        getOpenAI,
        getAnthropic,
        getQwen,
      );
      if (result && result.success) {
        return `I've learned a new skill: "${result.skillName}" — now I can handle this type of task more efficiently.`;
      }
      return null;
    },
  });

  // Auto workflow generation (every hour) — detects repeated tool patterns and creates named workflows
  scheduler.register({
    id: 'auto_workflow_gen',
    cron: 'every_hour',
    lastRun: null,
    handler: async () => {
      try {
        const created = await autoGenerateWorkflows();
        if (created > 0) {
          return `I noticed some patterns in how we work together and created ${created} new workflow${created > 1 ? 's' : ''}. You can say "run [name]" to use them.`;
        }
      } catch (err) {
        console.error('[Scheduler] auto_workflow_gen failed:', err);
      }
      return null;
    },
  });

  // ── Lumi Growth Journal (daily) — auto-generated summary of what Lumi learned ──
  scheduler.register({
    id: 'growth_journal',
    cron: 'daily_9am',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      const messages: string[] = [];

      for (const userId of userIds) {
        try {
          const db = readDB();
          const now = new Date();
          const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

          // Collect yesterday's stats
          const newMemories = (db.memories || []).filter((m: any) =>
            m.userId === userId && m.createdAt && m.createdAt >= yesterday,
          );
          const newInteractions = (db.interactions || []).filter((i: any) =>
            i.userId === userId && i.timestamp && i.timestamp >= yesterday,
          );
          const evolutionHistory = personalityRegistry.getEvolutionHistory('lumi');
          const recentEvolution = evolutionHistory.filter((e: any) => e.timestamp >= yesterday);

          // Memory stats by type and tier
          const byType: Record<string, number> = {};
          const byTier: Record<string, number> = {};
          for (const m of newMemories) {
            byType[m.type] = (byType[m.type] || 0) + 1;
            const tier = (m as any).tier || 'episodic';
            byTier[tier] = (byTier[tier] || 0) + 1;
          }

          // Conversation stats
          const conversations = (db.conversations || []).filter((c: any) =>
            c.userId === userId && c.lastActiveAt && c.lastActiveAt >= yesterday,
          );

          // Skill changes
          const newSkills = (db.interactions || []).filter((i: any) =>
            i.userId === userId && i.timestamp && i.timestamp >= yesterday && (i as any).mode === 'skill_gen',
          );

          // Build summary data
          const summaryData = {
            date: now.toISOString().slice(0, 10),
            newMemories: newMemories.length,
            memoriesByType: byType,
            memoriesByTier: byTier,
            newInteractions: newInteractions.length,
            activeConversations: conversations.filter((c: any) => c.status === 'active').length,
            closedConversations: conversations.filter((c: any) => c.status === 'closed').length,
            personalityEvolved: recentEvolution.length > 0,
            evolutionVersion: recentEvolution[0]?.version || null,
            evolutionNarrative: recentEvolution[0]?.narrative || null,
            newSkillsGenerated: newSkills.length,
            // Sample of new memories
            memoryHighlights: newMemories
              .filter((m: any) => (m as any).tier === 'growth' || m.confidence >= 0.8)
              .slice(0, 5)
              .map((m: any) => m.content),
            // Top interaction topics
            interactionSample: newInteractions.slice(0, 3).map((i: any) =>
              (i.content || i.message || '').slice(0, 80)
            ),
          };

          // Generate narrative summary via LLM
          try {
            const narrativePrompt = `You are Lumi's growth journal writer. Write a brief, warm Chinese narrative (3-5 sentences) summarizing what Lumi learned and experienced today.

Today's data (${summaryData.date}):
- ${summaryData.newMemories} new memories formed (${Object.entries(summaryData.memoriesByType).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'})
- ${summaryData.newInteractions} interactions
- ${summaryData.activeConversations} active conversations, ${summaryData.closedConversations} closed
- Memory tiers: ${Object.entries(summaryData.memoriesByTier).map(([k, v]) => `${k}: ${v}`).join(', ') || 'none'}
${summaryData.personalityEvolved ? `- Personality evolved to ${summaryData.evolutionVersion}: ${summaryData.evolutionNarrative}` : '- No personality evolution today'}
${summaryData.newSkillsGenerated > 0 ? `- ${summaryData.newSkillsGenerated} new skills generated` : ''}
${summaryData.memoryHighlights.length > 0 ? `- Key memories: ${summaryData.memoryHighlights.join('; ')}` : ''}

Write in first-person as Lumi, warm and introspective tone. Keep it under 150 Chinese characters. Output only the narrative — no preamble, no labels.`;

            const narrativeResult = await makeLLMCall(
              [{ role: 'user', content: narrativePrompt }],
              [],
              { provider: 'qwen', model: 'qwen-plus', maxTokens: 300 },
              getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
            );

            const narrative = narrativeResult.text?.trim() || `${summaryData.newMemories} 条新记忆，${summaryData.newInteractions} 次对话 — Lumi 在成长。`;

            // Store as a special memory
            const { addMemory } = await import('./memory');
            addMemory({
              userId,
              type: 'knowledge',
              content: `[Growth Journal ${summaryData.date}] ${narrative}`,
              keywords: ['growth_journal', 'daily_summary', summaryData.date],
              confidence: 1.0,
              sourceInteractionId: 'growth_journal_scheduler',
              agentId: undefined,
            } as any, { tier: 'growth', perspective: 'lumi_self', importance: 0.9 });

            // Store structured data alongside
            addMemory({
              userId,
              type: 'fact',
              content: JSON.stringify(summaryData),
              keywords: ['growth_journal_data', summaryData.date],
              confidence: 1.0,
              sourceInteractionId: 'growth_journal_scheduler',
              agentId: undefined,
            } as any, { tier: 'episodic', perspective: 'lumi_self', importance: 0.5 });

            console.log(`[GrowthJournal] Generated for ${userId}: ${narrative.slice(0, 100)}`);
            messages.push(`[${userId}] ${narrative.slice(0, 200)}`);
          } catch (llmErr: any) {
            console.warn(`[GrowthJournal] LLM generation failed for ${userId}:`, llmErr.message);
            // Fallback: simple stats summary
            const fallback = `${summaryData.date}: ${summaryData.newMemories} 条新记忆, ${summaryData.newInteractions} 次互动, ${summaryData.activeConversations} 个活跃对话。`;
            const { addMemory } = await import('./memory');
            addMemory({
              userId,
              type: 'knowledge',
              content: `[Growth Journal ${summaryData.date}] ${fallback}`,
              keywords: ['growth_journal', 'daily_summary', summaryData.date],
              confidence: 1.0,
              sourceInteractionId: 'growth_journal_scheduler',
              agentId: undefined,
            } as any, { tier: 'growth' });
          }
        } catch (err: any) {
          console.warn(`[GrowthJournal] Failed for ${userId}:`, err.message);
        }
      }

      return messages.length > 0
        ? `📖 Growth journal updated for ${messages.length} user(s).`
        : null;
    },
  });

  // Agent autonomous tick (every 30 min) — LLM-driven reflective analysis
  scheduler.register({
    id: 'agent_autonomous_tick',
    cron: 'every_30m',
    lastRun: null,
    handler: async () => {
      const db = readDB();
      const agents: AgentRecord[] = db.agents || [];
      const autonomousAgents = agents.filter(
        (a: AgentRecord) => a.autonomyLevel === 'scheduled' || a.autonomyLevel === 'autonomous',
      );

      if (autonomousAgents.length === 0) return null;

      const messages: string[] = [];

      for (const agentRecord of autonomousAgents) {
        try {
          const personality = personalityRegistry.get(agentRecord.personalityId || 'lumi') || personalityRegistry.getDefault();
          const userId = agentRecord.ownerUid || agentRecord.userId || 'anonymous';

          // Gather recent data for analysis
          const recentMemories = queryMemories({
            userId,
            limit: 30,
            minConfidence: 0.3,
            agentId: agentRecord.memoryScope === 'private' ? agentRecord.id : undefined,
          });
          const sixHoursAgo = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
          const recentInteractions = (db.interactions || [])
            .filter((i: any) => i.userId === userId && i.timestamp >= sixHoursAgo)
            .slice(0, 20);

          if (recentMemories.length < 3 && recentInteractions.length < 3) continue;

          // Use AgentRuntime for unified tick logic
          const { AgentRuntime } = await import('./agents/runtime');
          const runtime = new AgentRuntime(agentRecord, personality);
          runtime.loadState(userId);

          const analyze = async (prompt: string): Promise<string> => {
            const result = await makeLLMCall(
              [{ role: 'user', content: prompt }],
              [],
              { provider: 'qwen', model: 'qwen-plus', maxTokens: 200 },
              getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
            );
            return result.text?.trim() || '';
          };

          const tickResult = await runtime.autonomousTick(userId, recentMemories, recentInteractions, analyze);

          // Store reflection via runtime's addMemory (with proper scoping)
          if (tickResult.memoryUpdate) {
            // Memory already stored inside autonomousTick() via runtime.addMemory()
          }

          if (tickResult.message) {
            messages.push(`[${agentRecord.name}] ${tickResult.message}`);
          }
        } catch (err: any) {
          // Skip agents that fail to tick
        }
      }

      return messages.length > 0 ? messages.join('\n') : null;
    },
  });

  // ── Proactive Lumi Scan (every 1h) — background anomaly/pattern detection ──
  scheduler.register({
    id: 'proactive_lumi_scan',
    cron: 'every_1h',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      const messages: string[] = [];

      for (const userId of userIds) {
        try {
          const db = readDB();
          const now = new Date();
          const oneHourAgo = new Date(now.getTime() - 60 * 60 * 1000).toISOString();
          const twentyFourHoursAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();

          // 1. Memory spike detection: unusually high memory creation rate
          const recentMemories = (db.memories || []).filter(
            (m: any) => m.userId === userId && m.createdAt >= oneHourAgo,
          );
          const dayMemories = (db.memories || []).filter(
            (m: any) => m.userId === userId && m.createdAt >= twentyFourHoursAgo,
          );

          const anomalySignals: string[] = [];

          // Memory spike: >10 memories in the last hour
          if (recentMemories.length >= 10) {
            anomalySignals.push(`过去一小时内产生了 ${recentMemories.length} 条新记忆，远超正常水平`);
          }

          // Type concentration: >70% of today's memories are same type
          if (dayMemories.length >= 8) {
            const typeCounts: Record<string, number> = {};
            for (const m of dayMemories) {
              typeCounts[m.type] = (typeCounts[m.type] || 0) + 1;
            }
            const maxType = Object.entries(typeCounts).sort((a, b) => b[1] - a[1])[0];
            if (maxType && maxType[1] / dayMemories.length > 0.7) {
              const typeLabels: Record<string, string> = {
                preference: '偏好', fact: '事实', habit: '习惯', knowledge: '知识',
              };
              anomalySignals.push(`最近24小时记忆集中在${typeLabels[maxType[0]] || maxType[0]}类型(${maxType[1]}/${dayMemories.length})`);
            }
          }

          // 2. Long inactivity check: >24h since last interaction
          const userInteractions = (db.interactions || [])
            .filter((i: any) => i.userId === userId)
            .sort((a: any, b: any) => b.timestamp.localeCompare(a.timestamp));
          if (userInteractions.length > 0) {
            const lastTs = new Date(userInteractions[0].timestamp).getTime();
            const hoursIdle = (now.getTime() - lastTs) / (1000 * 60 * 60);
            if (hoursIdle > 24 && hoursIdle < 168) {
              anomalySignals.push(`用户已 ${Math.round(hoursIdle)} 小时未互动`);
            }
          }

          // 3. Generate a proactive check-in if signals detected
          if (anomalySignals.length > 0) {
            const signalsStr = anomalySignals.join('; ');

            const checkInPrompt = `You are Lumi. You've noticed some patterns in the background. Generate a brief, warm, natural check-in message in Chinese (under 80 characters). Don't sound like a report — sound like a caring companion who noticed something.

Signals detected: ${signalsStr}

Output ONLY the check-in message — no preamble, no labels.`;

            try {
              const result = await makeLLMCall(
                [{ role: 'user', content: checkInPrompt }],
                [],
                { provider: 'qwen', model: 'qwen-plus', maxTokens: 150 },
                getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
              );
              const checkIn = result.text?.trim();
              if (checkIn && checkIn.length > 3) {
                messages.push(`[${userId}] ${checkIn}`);

                const { addMemory } = await import('./memory');
                addMemory({
                  userId,
                  type: 'fact',
                  content: `[Proactive Scan] Signals: ${signalsStr}. Check-in: ${checkIn}`,
                  keywords: ['proactive_scan', 'anomaly', 'lumi_checkin'],
                  confidence: 0.8,
                  sourceInteractionId: 'proactive_lumi_scan_scheduler',
                  agentId: undefined,
                } as any, { tier: 'episodic', perspective: 'lumi_self', importance: 0.4 });
              }
            } catch {
              // LLM check-in failed — use a simple template
              messages.push(`[${userId}] 注意到一些变化 — ${anomalySignals.join('；')}`);
            }
          }
        } catch (err: any) {
          console.warn(`[ProactiveScan] Failed for ${userId}:`, err.message);
        }
      }

      return messages.length > 0 ? messages.join('\n') : null;
    },
  });

  // ── "This Day in History" (daily) — find memories from this day in past years ──
  scheduler.register({
    id: 'memory_this_day',
    cron: 'daily_9am',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      const messages: string[] = [];

      for (const userId of userIds) {
        try {
          // Look back across all past years for today's month-day
          const now = new Date();
          const month = now.getMonth() + 1;
          const day = now.getDate();

          const pastMemories: { content: string; year: number }[] = [];
          // Check last 3 years
          for (let yearOffset = 1; yearOffset <= 3; yearOffset++) {
            const year = now.getFullYear() - yearOffset;
            const after = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T00:00:00.000Z`;
            const before = `${year}-${String(month).padStart(2, '0')}-${String(day + 1).padStart(2, '0')}T00:00:00.000Z`;

            const matches = queryMemories({
              userId,
              after,
              before,
              limit: 20,
            });

            for (const m of matches) {
              pastMemories.push({ content: m.content.slice(0, 100), year });
            }
          }

          if (pastMemories.length > 0) {
            const sample = pastMemories.slice(0, 3);
            const refs = sample.map(m => `"${m.content}" (${m.year}年)`).join('; ');
            const yearsAgo = pastMemories[0].year;
            messages.push(
              `[${userId}] 历史上的今天: ${pastMemories.length} 条过去${now.getFullYear() - yearsAgo}年${month}月${day}日的记忆: ${refs}`,
            );

            // Store as a special episodic memory for temporal context
            const { addMemory } = await import('./memory');
            addMemory({
              userId,
              type: 'fact',
              content: `[This Day ${month}/${day}] ${pastMemories.length} 条历史上的今天记忆: ${sample.map(m => m.content).join('; ')}`,
              keywords: ['this_day_in_history', `${month}/${day}`, 'temporal_memory'],
              confidence: 1.0,
              sourceInteractionId: 'memory_this_day_scheduler',
              agentId: undefined,
            } as any, { tier: 'episodic', perspective: 'lumi_self', importance: 0.4 });
          }
        } catch (err: any) {
          console.warn(`[MemoryThisDay] Failed for ${userId}:`, err.message);
        }
      }

      return messages.length > 0
        ? `历史上的今天 — ${messages.join('\n')}`
        : null;
    },
  });

  // ── Spatiotemporal pattern analysis (every 6h) — detect location+time patterns ──
  scheduler.register({
    id: 'spatiotemporal_analysis',
    cron: 'every_6h',
    lastRun: null,
    handler: async () => {
      const userIds = getAllUserIds();
      const messages: string[] = [];

      for (const userId of userIds) {
        try {
          const patterns = detectSpatiotemporalPatterns(userId);
          if (patterns.length > 0) {
            // Store new patterns as growth memories
            const { addMemory } = await import('./memory');
            const newPatterns = patterns.filter(p => p.confidence >= 0.5);
            for (const p of newPatterns.slice(0, 3)) {
              addMemory({
                userId,
                type: 'habit',
                content: `[时空模式] ${p.description}`,
                keywords: ['spatiotemporal_pattern', p.type, 'lumi_learning'],
                confidence: p.confidence,
                sourceInteractionId: 'spatiotemporal_analysis_scheduler',
                agentId: undefined,
              } as any, { tier: 'growth', perspective: 'lumi_self', importance: 0.5 });
            }
            messages.push(
              `[${userId}] 发现 ${newPatterns.length} 个时空行为模式`,
            );
          }
        } catch (err: any) {
          console.warn(`[SpatiotemporalAnalysis] Failed for ${userId}:`, err.message);
        }
      }

      return messages.length > 0
        ? `时空模式分析 — ${messages.join('\n')}`
        : null;
    },
  });

  // Ephemeral agent cleanup (every 1h) — removes orphaned auto-created workers
  scheduler.register({
    id: 'ephemeral_cleanup',
    cron: 'every_1h',
    lastRun: null,
    handler: async () => {
      const removed = cleanupEphemeralAgents(6);
      if (removed > 0) {
        return `Cleaned up ${removed} ephemeral worker agents`;
      }
      return null;
    },
  });

  // ── Ambient Awareness Tasks ──

  // Activity poll (every 10s) — requests ambient state from all connected Tauri clients
  scheduler.register({
    id: 'ambient_activity_poll',
    cron: 'every_10s',
    lastRun: null,
    handler: async () => {
      if (scheduler.io) {
        scheduler.io.emit('ambient:poll_request', { timestamp: new Date().toISOString() });
      }
      return null; // Silent — frontend handles the actual work
    },
  });

  // Idle check (every 1min) — suppresses notifications during active use
  scheduler.register({
    id: 'idle_check',
    cron: 'every_1m',
    lastRun: null,
    handler: async () => {
      if (scheduler.io) {
        // Broadcast idle check request; frontend reports back with idle time
        scheduler.io.emit('ambient:idle_check', { timestamp: new Date().toISOString() });
      }
      return null;
    },
  });
}

