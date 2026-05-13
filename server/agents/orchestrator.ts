/**
 * Lumi Master Brain Orchestrator
 *
 * Lumi receives tasks → judges complexity → handles simple ones directly →
 * decomposes complex ones into sub-tasks → dispatches to worker agents →
 * aggregates results → optionally distills pattern into a reusable skill.
 *
 * Anti-entropy design:
 * - Each worker loads only its own memory + sub-task context (context isolation)
 * - Complex reusable patterns are auto-distilled into MCP skills (skill distillation)
 * - Valuable outputs crystallize into growth-tier memories (memory crystallization)
 */

import { readDB, writeDB } from "../../db_layer";
import { NormalizedMessage, makeLLMCall } from "../llm/providers";
import { runWithTools } from "../llm/adapter";
import { toolRegistry } from "../tools/registry";
import { queryMemories, addMemory } from "../memory/store";
import { Memory } from "../memory/types";
import { AgentRecord } from "./runtime";
import { recordWorkflow } from "../skills/worklog";
import { personalityRegistry } from "../personality";

type LLMProvider = 'deepseek' | 'gemini' | 'openai' | 'anthropic' | 'qwen';

export interface LlmGetters {
  getDeepSeek: () => any;
  getGemini: () => any;
  getOpenAI?: () => any;
  getAnthropic?: () => any;
  getQwen?: () => any;
}

// ── Types ──

export type TaskComplexity = 'simple' | 'moderate' | 'complex';

export interface SubTask {
  id: string;
  description: string;
  requiredSkill: 'code' | 'writing' | 'analysis' | 'search' | 'general';
  executionMode: 'lumi' | 'scholar' | 'founder';
  dependsOn?: string[];
  assignedAgentId?: string;
}

export interface WorkerAssignment {
  subTask: SubTask;
  agent: AgentRecord;
}

export interface WorkflowResult {
  subTaskResults: Array<{ subTaskId: string; output: string; agentId: string }>;
  aggregatedOutput: string;
  totalAgentsUsed: number;
}

export interface OrchestrationContext {
  userId: string;
  personalityId?: string;
  availableAgentIds?: string[];
}

// ── Complexity classification ──

/**
 * Signals are organized by WHAT they reveal about task structure,
 * not just keyword matching.
 */

// Multi-step sequential markers: the user is describing a chain of actions
const SEQUENTIAL_MARKERS = [
  '先', '再', '然后', '接着', '之后', '最后',
  '第一步', '第二步', '第三步', '首先', '其次', '最后',
  'first', 'then', 'next', 'finally', 'after that',
  'step 1', 'step 2', 'step 3',
];

// Parallel markers: the user explicitly wants things done concurrently
const PARALLEL_MARKERS = [
  '同时', '并行', '一边', '各自', '分别', '分开',
  'simultaneously', 'in parallel', 'at the same time', 'concurrently',
  'both', 'each', 'separately',
];

// Numbered/bulleted list: user already decomposed the task themselves
const LIST_PATTERN = /(?:^|\n)\s*(?:\d+[.、)]|[-*+•])\s+/gm;

// Cross-domain verb pairs: one message touching fundamentally different domains
// Each pair = [domain1_verb, domain2_verb] — both must appear
const CROSS_DOMAIN_PAIRS: [string[], string[]][] = [
  [['写', '开发', '实现', 'build', 'code', 'implement', 'create'], ['部署', '上线', '发布', 'deploy', 'release', 'publish']],
  [['分析', '研究', 'analyze', 'research', 'investigate'], ['写', '生成', '报告', 'write', 'generate', 'report']],
  [['设计', 'design', 'plan'], ['实现', '开发', '搭建', 'implement', 'build', 'code']],
  [['修复', '排查', 'debug', 'fix', 'troubleshoot'], ['测试', '验证', '部署', 'test', 'verify', 'deploy']],
  [['查', '搜索', 'search', 'find', 'look up'], ['整理', '汇总', '对比', 'organize', 'summarize', 'compare']],
];

// High-depth verbs: these verbs imply multiple implicit sub-steps
const DEEP_VERBS = [
  '搭建', '重构', '架构', '迁移', '集成', '部署方案',
  'build a', 'set up a', 'architect', 'refactor', 'migrate', 'bootstrap',
  '从零', 'from scratch', '整套', '完整的', '完整的',
  'end-to-end', 'full stack', 'pipeline', 'workflow',
];

// Pure Q&A / single-step verbs — these stay with Lumi directly
const SIMPLE_VERBS = [
  '是什么', '什么是', '什么意思', '怎么用', '用法',
  'what is', 'how do i', 'how to', 'why is',
  '解释一下', 'explain', '查一下', 'find', 'search for',
  '哪个', 'which', 'when', 'where',
];

/**
 * Classify task complexity using structural heuristics.
 *
 * The goal: only send a task to the orchestrator when it genuinely
 * benefits from decomposition + parallel worker execution.
 *
 * Simple: single question or action, one domain, one step.
 * Moderate: 2-3 related steps, possible tool use but single domain.
 * Complex: multi-step + multi-domain, or explicit parallelism, or deep-task verbs.
 */
export function classifyComplexity(
  text: string,
  _context: OrchestrationContext,
): TaskComplexity {
  const lower = text.toLowerCase();
  const trimmed = text.trim();

  // ── Structural checks ──

  // 1. Explicit list: user already broke it down → complex
  const listMatches = trimmed.match(LIST_PATTERN);
  if (listMatches && listMatches.length >= 3) return 'complex';
  if (listMatches && listMatches.length >= 2) return 'moderate';

  // 2. Sequential chain: "先X, 再Y, 然后Z" → complex
  const seqMatches = SEQUENTIAL_MARKERS.filter(s => lower.includes(s));
  if (seqMatches.length >= 3) return 'complex';
  if (seqMatches.length >= 2) return 'moderate';

  // 3. Explicit parallelism → at least moderate, usually complex
  const paraMatches = PARALLEL_MARKERS.filter(s => lower.includes(s));
  if (paraMatches.length >= 2) return 'complex';
  if (paraMatches.length >= 1) return 'moderate';

  // 4. Cross-domain detection: e.g., "写代码" + "部署"
  let crossDomainHits = 0;
  for (const [domain1, domain2] of CROSS_DOMAIN_PAIRS) {
    const hit1 = domain1.some(v => lower.includes(v));
    const hit2 = domain2.some(v => lower.includes(v));
    if (hit1 && hit2) crossDomainHits++;
  }
  if (crossDomainHits >= 2) return 'complex';
  if (crossDomainHits >= 1) return 'moderate';

  // 5. Deep verbs that imply multi-step work
  const deepHits = DEEP_VERBS.filter(s => lower.includes(s));
  if (deepHits.length >= 1) return 'complex';

  // 6. Pure Q&A — single question, single domain → simple
  const simpleHits = SIMPLE_VERBS.filter(s => lower.includes(s));
  const clauseCount = trimmed.split(/[.。!！?？\n]+/).filter(s => s.trim().length > 0).length;
  if (simpleHits.length >= 1 && clauseCount <= 1) return 'simple';

  // ── Fallback size-based heuristics ──
  const chineseChars = (text.match(/[一-鿿]/g) || []).length;
  const wordCount = text.split(/\s+/).length;

  // Very short → simple
  if (chineseChars < 20 && wordCount < 15) return 'simple';

  // Very long → at least moderate
  if (chineseChars > 200 || wordCount > 80) return 'complex';
  if (chineseChars > 80 || wordCount > 40) return 'moderate';

  return 'simple';
}

// ── Task decomposition (LLM-powered) ──

const DECOMPOSE_PROMPT = `You are a task decomposition engine. Break the user's request into independent sub-tasks that can be executed by separate worker agents.

Rules:
- Each sub-task should be self-contained and independently executable
- If sub-tasks have dependencies, mark them with dependsOn
- Assign each sub-task a requiredSkill: code, writing, analysis, search, or general
- Assign an executionMode: scholar (technical/analytical), founder (creative/strategic), or lumi (default)
- Produce 2-5 sub-tasks. Do NOT over-decompose.
- Output ONLY valid JSON array — no explanation, no markdown fences.

User request: {task}

Output format:
[
  {
    "id": "sub_1",
    "description": "what this worker should do",
    "requiredSkill": "code",
    "executionMode": "scholar",
    "dependsOn": []
  }
]`;

/**
 * Decompose a complex task into sub-tasks via LLM.
 */
export async function decomposeTask(
  text: string,
  config: { provider: LLMProvider; model: string },
  context: OrchestrationContext,
  llmGetters: LlmGetters,
): Promise<SubTask[]> {
  const prompt = DECOMPOSE_PROMPT.replace('{task}', text);

  try {
    const messages: NormalizedMessage[] = [{ role: 'user', content: prompt }];
    const result = await makeLLMCall(
      messages,
      [],
      { provider: config.provider, model: config.model, maxTokens: 2000 },
      llmGetters.getDeepSeek,
      llmGetters.getGemini,
      llmGetters.getOpenAI,
      llmGetters.getAnthropic,
      llmGetters.getQwen,
    );

    // Parse JSON from the response (handle markdown code fences)
    let json = result.text.trim();
    if (json.startsWith('```')) {
      json = json.replace(/```(?:json)?\n?/g, '').trim();
    }
    const parsed = JSON.parse(json);
    if (!Array.isArray(parsed)) throw new Error('Expected array');

    return parsed.map((item: any, idx: number) => ({
      id: item.id || `sub_${idx + 1}`,
      description: item.description || '',
      requiredSkill: item.requiredSkill || 'general',
      executionMode: item.executionMode || 'lumi',
      dependsOn: item.dependsOn || [],
    }));
  } catch (err) {
    console.error('[Orchestrator] Decomposition failed, treating as simple:', err);
    // Fallback: single sub-task = the original request
    return [{
      id: 'sub_1',
      description: text,
      requiredSkill: 'general',
      executionMode: 'lumi',
    }];
  }
}

// ── Worker matching ──

const SKILL_TO_CATEGORY: Record<string, string> = {
  code: 'code',
  writing: 'content',
  analysis: 'analysis',
  search: 'search',
  general: 'general',
};

// ── Smart routing cache: remembers which agent succeeded at which skill ──
// skillTag → { agentId → successCount }
const routingCache = new Map<string, Map<string, number>>();
const ROUTING_CACHE_MAX_AGE_MS = 7 * 86400000; // 7 days

let onAgentPromoted: ((agent: AgentRecord) => void) | null = null;
export function setOnAgentPromoted(cb: (agent: AgentRecord) => void) { onAgentPromoted = cb; }

const PROMOTION_THRESHOLD = 5; // Same skill successfully executed N times → promote

function recordRoutingSuccess(skillTag: string, agentId: string): void {
  if (!routingCache.has(skillTag)) {
    routingCache.set(skillTag, new Map());
  }
  const agentScores = routingCache.get(skillTag)!;
  const newCount = (agentScores.get(agentId) || 0) + 1;
  agentScores.set(agentId, newCount);

  // Check if this ephemeral agent should be promoted to permanent
  if (agentId.startsWith('ephemeral_') && newCount >= PROMOTION_THRESHOLD) {
    promoteEphemeralAgent(agentId, skillTag);
  }
}

function promoteEphemeralAgent(agentId: string, skillTag: string): void {
  const db = readDB();
  const idx = db.agents.findIndex((a: any) => a.id === agentId);
  if (idx === -1) return;

  const agent = db.agents[idx];
  const newId = `worker_${skillTag}_${Date.now().toString(36)}`;
  agent.id = newId;
  agent.name = `${skillTag}-specialist`;
  agent.status = 'active';
  agent.autoCreated = true;
  agent.promotedAt = new Date().toISOString();

  // Update routing cache to point to new ID
  for (const [, agentScores] of routingCache) {
    if (agentScores.has(agentId)) {
      const score = agentScores.get(agentId)!;
      agentScores.delete(agentId);
      agentScores.set(newId, score);
    }
  }

  writeDB(db);
  console.log(`[Orchestrator] Promoted ephemeral agent "${agentId}" → "${newId}" (${skillTag} specialist)`);
  if (onAgentPromoted) onAgentPromoted(agent);
}

function getRoutingScore(skillTag: string, agentId: string): number {
  const agentScores = routingCache.get(skillTag);
  return agentScores?.get(agentId) || 0;
}

/** Export routing cache stats for MCP management tools */
export function getRoutingCacheStats(): { totalSkillTags: number; totalRoutes: number; agents: Record<string, Record<string, number>> } {
  const agents: Record<string, Record<string, number>> = {};
  let totalRoutes = 0;
  for (const [skillTag, agentScores] of routingCache.entries()) {
    for (const [agentId, count] of agentScores.entries()) {
      if (!agents[agentId]) agents[agentId] = {};
      agents[agentId][skillTag] = count;
      totalRoutes += count;
    }
  }
  return {
    totalSkillTags: routingCache.size,
    totalRoutes,
    agents,
  };
}

/**
 * Match sub-tasks to available worker agents by skill compatibility.
 * If no suitable agent exists, returns the best generalist agent.
 */
export function matchWorkers(
  subTasks: SubTask[],
  availableAgents: AgentRecord[],
): WorkerAssignment[] {
  const assignments: WorkerAssignment[] = [];

  for (const subTask of subTasks) {
    const targetCategory = SKILL_TO_CATEGORY[subTask.requiredSkill] || 'general';
    const taskTokens = subTask.description.toLowerCase().split(/\s+/);

    // Score every available agent, pick the best
    let bestAgent: AgentRecord | null = null;
    let bestScore = -1;

    for (const agent of availableAgents) {
      let score = 0;

      // Category match (primary, weight 10)
      if (agent.category === targetCategory) score += 10;
      // Idle bonus
      if (agent.status === 'idle') score += 3;

      // Skill tag overlap (secondary, weight 5 per match)
      if (agent.skillTags && agent.skillTags.length > 0) {
        for (const tag of agent.skillTags) {
          for (const token of taskTokens) {
            if (tag.toLowerCase().includes(token) || token.includes(tag.toLowerCase())) {
              score += 5;
            }
          }
        }
      }

      // Routing cache bonus: prefer agents that succeeded at this skill before
      const routingBonus = getRoutingScore(subTask.requiredSkill, agent.id);
      if (routingBonus > 0) score += Math.min(routingBonus * 2, 8);

      if (score > bestScore) {
        bestScore = score;
        bestAgent = agent;
      }
    }

    if (!bestAgent) {
      // Auto-create ephemeral worker agent when none matches
      bestAgent = createEphemeralAgent(targetCategory, subTask.requiredSkill);
    }

    if (bestAgent) {
      assignments.push({ subTask, agent: bestAgent });
    }
  }

  return assignments;
}

/** Auto-create a minimal ephemeral agent for a one-shot task */
function createEphemeralAgent(category: string, skillTag: string): AgentRecord {
  const id = `ephemeral_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const agent: AgentRecord = {
    id,
    name: `${category}-worker`,
    category,
    config: '{}',
    data: '{}',
    createdAt: new Date().toISOString(),
    status: 'idle',
    modelPreference: 'qwen-plus',
    memoryScope: 'private',
    autonomyLevel: 'reactive',
    runtimeConfig: '{}',
    skillTags: [skillTag],
    executionMode: 'lumi',
    allowCrossPollination: false,
  };
  // Persist to DB so it's visible
  try {
    const db = readDB();
    if (!db.agents) db.agents = [];
    db.agents.push(agent as any);
    // Note: ephemeral agents are cleaned up by the scheduler or on restart
  } catch (err) {
    // Non-critical — agent works in-memory even without DB persistence
  }
  return agent;
}

// ── Workflow execution ──

/**
 * Resolve a topological execution order respecting dependsOn.
 * Returns groups of sub-tasks that can run in parallel.
 */
function topologicalGroups(assignments: WorkerAssignment[]): WorkerAssignment[][] {
  const completed = new Set<string>();
  const remaining = [...assignments];
  const groups: WorkerAssignment[][] = [];

  while (remaining.length > 0) {
    const ready: WorkerAssignment[] = [];
    const stillWaiting: WorkerAssignment[] = [];

    for (const a of remaining) {
      const deps = a.subTask.dependsOn || [];
      if (deps.every(d => completed.has(d))) {
        ready.push(a);
      } else {
        stillWaiting.push(a);
      }
    }

    if (ready.length === 0 && stillWaiting.length > 0) {
      // Circular dependency or all deps unresolved — execute remaining as a batch
      groups.push(stillWaiting);
      break;
    }

    groups.push(ready);
    for (const a of ready) completed.add(a.subTask.id);
    remaining.length = 0;
    remaining.push(...stillWaiting);
  }

  return groups;
}

/**
 * Execute a single worker task with retry and fallback.
 * - Attempt 1: primary agent
 * - Attempt 2: retry same agent (transient errors)
 * - Attempt 3: try a different fallback agent
 * Each worker loads only its own context (anti-entropy: context isolation).
 */
async function executeWorkerTask(
  assignment: WorkerAssignment,
  context: OrchestrationContext,
  llmConfig: { provider: LLMProvider; model: string },
  llmGetters: LlmGetters,
  fallbackAgents: AgentRecord[],
): Promise<{ subTaskId: string; output: string; agentId: string }> {
  const { subTask, agent } = assignment;
  const agentsToTry = [
    agent,
    ...fallbackAgents.filter(a => a.id !== agent.id).slice(0, 2),
  ];

  for (let attempt = 0; attempt < agentsToTry.length; attempt++) {
    const currentAgent = agentsToTry[attempt];
    const isRetry = attempt > 0;

    const workerMemories = queryMemories({
      userId: context.userId,
      query: subTask.description,
      limit: 3,
      minConfidence: 0.3,
      agentId: currentAgent.id,
    });

    const memoryContext = workerMemories.length > 0
      ? workerMemories.map(m => `- ${m.content.slice(0, 200)}`).join('\n')
      : '';

    let modeDirective = '';
    if (subTask.executionMode !== 'lumi') {
      const lumiConfig = personalityRegistry.get('lumi');
      const mode = lumiConfig?.executionModes?.[subTask.executionMode];
      if (mode?.promptExtension) {
        modeDirective = mode.promptExtension;
      }
    }

    const retryHint = isRetry
      ? `\n(Retry attempt ${attempt + 1}/${agentsToTry.length} — previous attempt failed. Try a different approach or be more concise.)`
      : '';

    const workerPrompt = [
      `You are worker agent "${currentAgent.name}" (${currentAgent.category}). You have tool access — use tools to complete the task, don't just describe what to do.`,
      `Task: ${subTask.description}${retryHint}`,
      modeDirective,
      memoryContext ? `Relevant memories:\n${memoryContext}` : '',
      'Complete this sub-task using available tools. Output the final result.',
    ].filter(Boolean).join('\n\n');

    try {
      const messages: NormalizedMessage[] = [{ role: 'user', content: workerPrompt }];
      const result = await runWithTools(
        messages,
        toolRegistry,
        { provider: llmConfig.provider, model: llmConfig.model, maxTokens: 2000, userId: context.userId },
        undefined,
        isRetry ? 3 : 2, // More iterations on retry
        llmGetters.getDeepSeek,
        llmGetters.getGemini,
        llmGetters.getOpenAI,
        llmGetters.getAnthropic,
        llmGetters.getQwen,
      );

      if (isRetry) {
        console.log(`[Orchestrator] Worker '${agent.name}' failed on attempt ${attempt}, succeeded with '${currentAgent.name}'`);
      }

      return {
        subTaskId: subTask.id,
        output: result.text.trim(),
        agentId: currentAgent.id,
      };
    } catch (err) {
      if (attempt < agentsToTry.length - 1) {
        console.warn(`[Orchestrator] Worker '${currentAgent.name}' failed (attempt ${attempt + 1}/${agentsToTry.length}), trying next...`, String(err).slice(0, 80));
        continue;
      }
      return {
        subTaskId: subTask.id,
        output: `[Worker failed after ${agentsToTry.length} attempt(s): ${String(err).slice(0, 200)}]`,
        agentId: agent.id,
      };
    }
  }

  // Unreachable but TypeScript needs it
  return {
    subTaskId: subTask.id,
    output: '[Worker failed: all agents exhausted]',
    agentId: agent.id,
  };
}

/**
 * Execute the full workflow: topological sort → parallel groups → aggregate.
 * Workers that fail are automatically retried with fallback agents.
 */
export async function executeWorkflow(
  assignments: WorkerAssignment[],
  context: OrchestrationContext,
  llmConfig: { provider: LLMProvider; model: string },
  llmGetters: LlmGetters,
  fallbackAgents: AgentRecord[] = [],
): Promise<WorkflowResult> {
  const groups = topologicalGroups(assignments);

  const allResults: Array<{ subTaskId: string; output: string; agentId: string }> = [];
  const usedAgentIds = new Set<string>();

  for (const group of groups) {
    // Execute group in parallel
    const groupResults = await Promise.all(
      group.map(a => {
        usedAgentIds.add(a.agent.id);
        return executeWorkerTask(a, context, llmConfig, llmGetters, fallbackAgents);
      }),
    );
    // Record routing successes for future matching
    for (const a of group) {
      recordRoutingSuccess(a.subTask.requiredSkill, a.agent.id);
    }
    allResults.push(...groupResults);
  }

  // Aggregate results
  const aggregatedOutput = aggregateResults(allResults, assignments);

  // Crystallize workflow result as a growth memory for future reuse
  try {
    const usedAgentIdsArr = Array.from(usedAgentIds);
    const mem = addMemory({
      userId: context.userId,
      type: 'knowledge',
      content: `[Orchestrated Workflow] ${aggregatedOutput.slice(0, 400)}`,
      keywords: ['orchestrated', 'workflow', ...assignments.map(a => a.subTask.requiredSkill)],
      confidence: 0.75,
      sourceInteractionId: `orch_${Date.now()}`,
    }, {
      tier: 'growth',
      perspective: 'lumi_growth',
      importance: 0.7,
    });
    // Mark for cross-agent sharing so other agents can learn from this workflow
    mem.crossAgentShare = true;
    mem.sharedToAgentIds = usedAgentIdsArr;
  } catch (err) {
    // Non-critical — workflow succeeded even if crystallization fails
  }

  return {
    subTaskResults: allResults,
    aggregatedOutput,
    totalAgentsUsed: usedAgentIds.size,
  };
}

// ── Result aggregation ──

const AGGREGATE_PROMPT = `You are Lumi, the master orchestrator. Synthesize the following worker outputs into a single, coherent response for the user.

Original task: {task}

Worker outputs:
{workerOutputs}

Synthesize these results. Fill in gaps. Resolve contradictions. Output the final answer directly — no meta-commentary about workers or aggregation.`;

function aggregateResults(
  results: Array<{ subTaskId: string; output: string; agentId: string }>,
  assignments: WorkerAssignment[],
): string {
  if (results.length === 0) return 'No results produced.';
  if (results.length === 1) return results[0].output;

  // For now, concatenate with clear separation. LLM aggregation happens in the chat pipeline.
  return results
    .map((r, i) => {
      const subTask = assignments.find(a => a.subTask.id === r.subTaskId)?.subTask;
      return `### ${subTask?.description?.slice(0, 60) || r.subTaskId}\n${r.output}`;
    })
    .join('\n\n');
}

/**
 * Full LLM aggregation — call this from the chat pipeline after executeWorkflow.
 */
export async function aggregateWithLLM(
  workflowResult: WorkflowResult,
  originalTask: string,
  llmConfig: { provider: LLMProvider; model: string },
  llmGetters: LlmGetters,
): Promise<string> {
  const workerOutputs = workflowResult.subTaskResults
    .map(r => `[${r.subTaskId}] ${r.output}`)
    .join('\n\n---\n\n');

  const prompt = AGGREGATE_PROMPT
    .replace('{task}', originalTask)
    .replace('{workerOutputs}', workerOutputs);

  try {
    const messages: NormalizedMessage[] = [{ role: 'user', content: prompt }];
    const result = await makeLLMCall(
      messages,
      [],
      { provider: llmConfig.provider, model: llmConfig.model, maxTokens: 2000 },
      llmGetters.getDeepSeek,
      llmGetters.getGemini,
      llmGetters.getOpenAI,
      llmGetters.getAnthropic,
      llmGetters.getQwen,
    );
    return result.text.trim();
  } catch (err) {
    console.error('[Orchestrator] LLM aggregation failed:', err);
    return workflowResult.aggregatedOutput;
  }
}

// ── Skill distillation ──

interface WorkflowPattern {
  taskPrefix: string;
  subTaskCount: number;
  skillTags: string[];
  timestamp: string;
}

/** In-memory store of recent workflow patterns for distillation heuristics */
const recentPatterns: WorkflowPattern[] = [];

/**
 * After a complex workflow completes, record it to the worklog for pattern detection
 * and check if the pattern is reusable (≥ 2 times in 7 days = candidate for skill generation).
 */
export function recordWorkflowPattern(
  task: string,
  subTaskCount: number,
  skillTags: string[],
  userId?: string,
): void {
  // Feed the worklog-based skill distillation pipeline
  if (userId && subTaskCount >= 2) {
    try {
      recordWorkflow({
        userId,
        userIntent: task.slice(0, 120),
        toolSequence: skillTags.map(tag => ({
          name: `orchestrator_${tag}`,
          args: { skillTag: tag },
          resultSummary: `Worker executed ${tag} sub-task`,
        })),
        conversationExcerpt: task.slice(0, 200),
      });
    } catch (err) {
      // Worklog recording is non-critical
    }
  }

  const prefix = task.slice(0, 80).toLowerCase();
  recentPatterns.push({
    taskPrefix: prefix,
    subTaskCount,
    skillTags,
    timestamp: new Date().toISOString(),
  });

  // Keep only last 30 days
  const cutoff = Date.now() - 30 * 86400000;
  while (recentPatterns.length > 0 && new Date(recentPatterns[0].timestamp).getTime() < cutoff) {
    recentPatterns.shift();
  }

  // Cap at 100 entries
  while (recentPatterns.length > 100) {
    recentPatterns.shift();
  }
}

/**
 * Check if the current task pattern has been seen recently.
 * Returns true if the same pattern appeared ≥ 2 times in the last 7 days.
 */
export function shouldDistillSkill(task: string): boolean {
  const prefix = task.slice(0, 80).toLowerCase();
  const sevenDaysAgo = Date.now() - 7 * 86400000;

  const similarPatterns = recentPatterns.filter(
    p => p.taskPrefix === prefix && new Date(p.timestamp).getTime() > sevenDaysAgo,
  );

  return similarPatterns.length >= 2;
}

/**
 * Build a skill description suitable for passing to autoGenerateSkill().
 */
export function buildSkillDescription(
  task: string,
  workflowResult: WorkflowResult,
): string {
  const subTaskDescriptions = workflowResult.subTaskResults
    .map(r => `- ${r.subTaskId}: ${r.output.slice(0, 100)}`)
    .join('\n');

  return [
    `Auto-generated skill for recurring task pattern.`,
    `Task: ${task}`,
    `Sub-tasks (${workflowResult.totalAgentsUsed} agents used):`,
    subTaskDescriptions,
    `\nThis skill automates the full workflow. Input: task description. Output: aggregated result.`,
  ].join('\n');
}

/** Clean up ephemeral agents older than the TTL (default 6 hours) */
export function cleanupEphemeralAgents(ttlHours: number = 6): number {
  try {
    const db = readDB();
    if (!db.agents || db.agents.length === 0) return 0;

    const cutoff = Date.now() - ttlHours * 60 * 60 * 1000;
    const before = db.agents.length;

    db.agents = db.agents.filter((a: any) => {
      if (!a.id || !a.id.startsWith('ephemeral_')) return true;
      const created = new Date(a.createdAt || 0).getTime();
      return created > cutoff;
    });

    const removed = before - db.agents.length;
    if (removed > 0) {
      // Clean up orphaned interactions for removed agents
      const removedIds = new Set<string>();
      // We already filtered, so we'd need to track removed IDs differently
      if (db.interactions) {
        db.interactions = db.interactions.filter((i: any) => {
          if (!i.agentId || !i.agentId.startsWith('ephemeral_')) return true;
          const created = new Date(i.timestamp || 0).getTime();
          return created > cutoff;
        });
      }
      // Clean up orphaned memories
      if (db.memories) {
        db.memories = db.memories.filter((m: any) => {
          if (!m.agentId || !m.agentId.startsWith('ephemeral_')) return true;
          const created = new Date(m.createdAt || 0).getTime();
          return created > cutoff;
        });
      }
      writeDB(db);
      console.log(`[Orchestrator] Cleaned up ${removed} ephemeral agents`);
    }
    return removed;
  } catch (err) {
    console.warn('[Orchestrator] Ephemeral cleanup failed:', err);
    return 0;
  }
}
