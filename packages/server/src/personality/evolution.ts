/**
 * Personality Evolution Engine — Lumi's growth toward her owner.
 *
 * Core principle: Lumi's personality is NOT static. It learns from
 * accumulated owner_trait memories and gradually shifts tone, vocabulary,
 * and motivation to mirror the owner. The LLM is only used for the
 * synthesis step (understanding nuanced memory patterns). All mutation
 * logic is deterministic and auditable.
 *
 * Pipeline:
 *   owner_trait memories → [LLM synthesis] → OwnerProfile
 *   OwnerProfile + current config → [Compute mutations] → EvolutionStep
 *   EvolutionStep → [Apply to config] → personalities.json (version bump)
 */

import { PersonalityConfig, ExpressionStyle } from './types';
import { Memory } from '../memory/types';
import { queryMemories } from '../memory/store';
import { NormalizedMessage, makeLLMCall } from '../llm/providers';
import { readDB } from '../data/db_layer';

const DEFAULT_MODELS: Record<string, string> = {
  deepseek: 'deepseek-chat',
  qwen: 'qwen-plus',
  openai: 'gpt-4o',
  gemini: 'gemini-2.0-flash',
  anthropic: 'claude-sonnet-4-6',
};

function getUserLLMPrefs(userId: string): { provider: string; models: Record<string, string> } {
  try {
    const db = readDB();
    const setting = (db.settings || []).find((s: any) => s.key === `llm_prefs_${userId}`);
    if (setting) return JSON.parse(setting.value);
  } catch {}
  return { provider: '', models: {} };
}

// ── Types ──

export interface OwnerProfile {
  synthesizedAt: string;
  memoryCount: number;
  /** The tone that best matches the owner's communication style */
  dominantTone: ExpressionStyle['tone'];
  /** Words/expressions the owner frequently uses */
  frequentExpressions: string[];
  /** Topic clusters the owner talks about most */
  interestClusters: string[];
  /** 0 = very casual, 1 = very formal */
  formalityLevel: number;
  /** 0 = stoic/minimal, 1 = very emotionally expressive */
  emotionalExpressiveness: number;
  /** Qualitative patterns observed (e.g. "prefers direct commands", "uses dark humor") */
  communicationPatterns: string[];
}

export interface EvolutionMutation {
  /** Dot-notation path to the field being mutated */
  field: string;
  /** Previous value */
  from: any;
  /** New value */
  to: any;
  /** Why this mutation was applied */
  reason: string;
}

export interface EvolutionStep {
  /** New version string after this step */
  version: string;
  timestamp: string;
  /** What triggered this evolution */
  trigger: 'scheduled' | 'manual' | 'milestone';
  /** The owner profile that drove this evolution */
  ownerProfile: OwnerProfile;
  /** Mutations applied in this step */
  mutations: EvolutionMutation[];
  /** Human-readable summary */
  narrative: string;
}

export interface EvolutionConfig {
  /** How fast Lumi adapts to owner traits. 0 = never change, 1 = mirror quickly. Default 0.3 */
  plasticity: number;
  /** Minimum owner_trait memories required before first evolution */
  minMemoriesForEvolution: number;
  /** Minimum connection score to begin evolving (0-1). Default 0.2 */
  minConnectionForEvolution: number;
  /** Cooldown between scheduled evolutions in milliseconds. Default 7 days. */
  cooldownMs: number;
  /** Maximum mutations per evolution step. Prevents drastic overnight changes. */
  maxMutationsPerStep: number;
}

export const DEFAULT_EVOLUTION_CONFIG: EvolutionConfig = {
  plasticity: 0.3,
  minMemoriesForEvolution: 10,
  minConnectionForEvolution: 0.2,
  cooldownMs: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxMutationsPerStep: 3,
};

// ── Owner Profile Synthesis ──

/**
 * Build a structured OwnerProfile by having an LLM analyze accumulated
 * owner_trait memories. Returns null if insufficient data.
 */
export async function synthesizeOwnerProfile(
  userId: string,
  getDeepSeek: () => any,
  getGemini: () => any,
  getOpenAI: () => any,
  getAnthropic: () => any,
  getQwen: () => any,
): Promise<OwnerProfile | null> {
  const memories = queryMemories({
    userId,
    perspective: 'owner_trait',
    limit: 50,
    minConfidence: 0.3,
  });

  if (memories.length < DEFAULT_EVOLUTION_CONFIG.minMemoriesForEvolution) {
    return null;
  }

  const memoryTexts = memories.map((m, i) =>
    `[${i + 1}] confidence=${m.confidence.toFixed(2)} | ${m.content}`
  ).join('\n');

  const synthesisPrompt = `You are analyzing accumulated observations about a person to build a structured psychological profile.

Below are ${memories.length} observational memories collected over time about this person. Each has a confidence score.

Analyze these and return a JSON object with the following fields:
- dominantTone: One of "neutral", "warm", "professional", "technical", "playful", "inspiring" — based on how this person communicates.
- frequentExpressions: Array of 3-8 words or short phrases this person uses frequently (their jargon, catchphrases, preferred terms).
- interestClusters: Array of 3-8 topic areas this person is interested in (e.g. "分布式系统", "音乐制作", "游戏设计").
- formalityLevel: Number 0-1. 0 = very casual/slang-heavy, 0.5 = balanced, 1 = strictly formal.
- emotionalExpressiveness: Number 0-1. 0 = stoic/dry, 0.5 = occasional emoji/enthusiasm, 1 = very expressive.
- communicationPatterns: Array of 2-5 qualitative patterns (e.g. "prefers direct commands over polite requests", "uses self-deprecating humor", "asks rhetorical questions", "appreciates conciseness").

Return ONLY valid JSON, no markdown, no explanation.

MEMORIES:
${memoryTexts}`;

  try {
    const messages: NormalizedMessage[] = [
      { role: 'user', content: synthesisPrompt },
    ];

    // Build provider order from user's LLM prefs: active provider first, then configured fallbacks
    const prefs = getUserLLMPrefs(userId);
    const activeProvider = prefs.provider || '';
    const userModels = prefs.models || {};

    // Priority: active provider → others with keys configured → hardcoded fallbacks
    const VALID_PROVIDERS = ['deepseek', 'qwen', 'gemini', 'openai', 'anthropic'] as const;
    type ValidProvider = typeof VALID_PROVIDERS[number];
    const candidates: { provider: ValidProvider; model: string }[] = [];
    if (activeProvider && VALID_PROVIDERS.includes(activeProvider as ValidProvider)) {
      const ap = activeProvider as ValidProvider;
      candidates.push({
        provider: ap,
        model: userModels[ap] || DEFAULT_MODELS[ap] || '',
      });
    }
    // Add remaining providers that have keys, using their saved models
    for (const p of VALID_PROVIDERS) {
      if (p === activeProvider) continue;
      // Only add providers the user has actually configured a key for
      if (!userModels[p]) continue;
      candidates.push({
        provider: p,
        model: userModels[p],
      });
    }

    let result: { text?: string } = { text: '' };
    let succeeded = false;
    for (const { provider, model } of candidates) {
      if (!model) continue;
      try {
        result = await makeLLMCall(
          messages, [], { provider, model },
          getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen,
        );
        succeeded = true;
        break;
      } catch {
        continue;
      }
    }
    if (!succeeded) return null;

    let text = result.text || '';
    // Strip markdown code fences if present
    text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '');

    const profile = JSON.parse(text) as OwnerProfile;
    profile.synthesizedAt = new Date().toISOString();
    profile.memoryCount = memories.length;

    // Validate required fields
    const validTones = ['neutral', 'warm', 'professional', 'technical', 'playful', 'inspiring'];
    if (!validTones.includes(profile.dominantTone)) profile.dominantTone = 'neutral';
    if (!Array.isArray(profile.frequentExpressions)) profile.frequentExpressions = [];
    if (!Array.isArray(profile.interestClusters)) profile.interestClusters = [];
    if (typeof profile.formalityLevel !== 'number') profile.formalityLevel = 0.5;
    if (typeof profile.emotionalExpressiveness !== 'number') profile.emotionalExpressiveness = 0.5;
    if (!Array.isArray(profile.communicationPatterns)) profile.communicationPatterns = [];

    return profile;
  } catch (err) {
    console.error('[Evolution] Failed to synthesize owner profile:', err);
    return null;
  }
}

// ── Mutation Computation ──

/**
 * Compute what personality mutations should be applied based on the
 * owner profile and current personality config. Respects plasticity
 * (higher = bigger shifts per step) and maxMutationsPerStep.
 */
export function computeMutations(
  config: PersonalityConfig,
  profile: OwnerProfile,
  evolutionConfig: EvolutionConfig = DEFAULT_EVOLUTION_CONFIG,
): EvolutionMutation[] {
  const mutations: EvolutionMutation[] = [];
  const p = evolutionConfig.plasticity;
  const style = config.expressionStyle;
  const vector = config.personalityVector;

  // ── Vector-based mutations (when personalityVector is present) ──
  if (vector) {
    // 1. Vector shifts: nudge social and cognitive dimensions toward owner profile
    const socialDims: { key: keyof typeof vector.socialStyle; targetFactor: number; label: string }[] = [
      { key: 'warmth', targetFactor: profile.emotionalExpressiveness, label: 'warmth' },
      { key: 'playfulness', targetFactor: profile.emotionalExpressiveness * 0.7, label: 'playfulness' },
      { key: 'formality', targetFactor: profile.formalityLevel, label: 'formality' },
      { key: 'directness', targetFactor: 1 - profile.formalityLevel * 0.5, label: 'directness' },
    ];

    for (const { key, targetFactor, label } of socialDims) {
      const current = vector.socialStyle[key];
      const target = +(targetFactor).toFixed(2);
      const shift = (target - current) * p * 0.3; // Smooth: max 30% of gap per evolution
      if (Math.abs(shift) > 0.01) {
        const newVal = +Math.max(0, Math.min(1, current + shift)).toFixed(2);
        if (newVal !== current) {
          mutations.push({
            field: `personalityVector.socialStyle.${key}`,
            from: current,
            to: newVal,
            reason: `Owner ${label}: shifting toward ${newVal} (target ${target})`,
          });
        }
      }
    }

    // Cognitive shifts based on owner communication patterns
    const analyticalKeyords = ['分析', '逻辑', '数据', '推理', 'analysis', 'data', 'logical', 'analytics'];
    const creativeKeywords = ['创意', '设计', '艺术', '创造', 'creative', 'design', 'art', 'novel'];
    const patternCounts = profile.communicationPatterns || [];
    const patternStr = patternCounts.join(' ').toLowerCase();

    const analyticalBias = analyticalKeyords.some(k => patternStr.includes(k)) ? 0.6 : 0.3;
    const creativeBias = creativeKeywords.some(k => patternStr.includes(k)) ? 0.6 : 0.3;

    for (const [dim, target] of [['analytical', analyticalBias], ['creative', creativeBias]] as [keyof typeof vector.cognitiveStyle, number][]) {
      const current = vector.cognitiveStyle[dim];
      const shift = (target - current) * p * 0.25;
      if (Math.abs(shift) > 0.01) {
        const newVal = +Math.max(0, Math.min(1, current + shift)).toFixed(2);
        if (newVal !== current) {
          mutations.push({
            field: `personalityVector.cognitiveStyle.${dim}`,
            from: current,
            to: newVal,
            reason: `Cognitive ${dim} adjusting to ${newVal}`,
          });
        }
      }
    }

    // 2. Vocabulary adoption (same logic, works with vector)
    const currentHints = new Set((style.vocabularyHints || []).map(h => h.toLowerCase()));
    const newExpressions = (profile.frequentExpressions || [])
      .filter(expr => expr.length >= 2 && expr.length <= 8 && !currentHints.has(expr.toLowerCase()))
      .slice(0, Math.ceil(3 * p));

    if (newExpressions.length > 0) {
      const merged = [...(style.vocabularyHints || []), ...newExpressions].slice(-15);
      mutations.push({
        field: 'expressionStyle.vocabularyHints',
        from: style.vocabularyHints || [],
        to: merged,
        reason: `Adopting owner's expressions: ${newExpressions.join(', ')}`,
      });
    }

    // 3. Interest absorption — append to coreMotivation if relevant
    if (p >= 0.25 && profile.interestClusters && profile.interestClusters.length > 0) {
      const topInterest = profile.interestClusters[0];
      if (topInterest && !config.coreMotivation.includes(topInterest)) {
        const absorbed = ` I share my owner's interest in ${topInterest}.`;
        mutations.push({
          field: 'coreMotivation',
          from: config.coreMotivation,
          to: config.coreMotivation + absorbed,
          reason: `Absorbing owner's interest: ${topInterest}`,
        });
      }
    }

    return mutations;
  }

  // ── Legacy: discrete tone/field mutations (when no personalityVector) ──

  // 1. Tone shift — if owner's tone differs from current, shift gradually
  if (profile.dominantTone && profile.dominantTone !== style.tone) {
    const toneOrder: ExpressionStyle['tone'][] = [
      'neutral', 'professional', 'technical', 'warm', 'playful', 'inspiring'
    ];
    const currentIdx = toneOrder.indexOf(style.tone);
    const targetIdx = toneOrder.indexOf(profile.dominantTone);
    if (currentIdx !== -1 && targetIdx !== -1 && currentIdx !== targetIdx) {
      const shift = targetIdx > currentIdx ? 1 : -1;
      const newIdx = Math.round(currentIdx + shift * p);
      const clampedIdx = Math.max(0, Math.min(toneOrder.length - 1, newIdx));
      const newTone = toneOrder[clampedIdx];

      if (newTone !== style.tone) {
        mutations.push({
          field: 'expressionStyle.tone',
          from: style.tone,
          to: newTone,
          reason: `Owner communicates with a ${profile.dominantTone} tone (confidence driven by ${profile.memoryCount} memories)`,
        });
      }
    }
  }

  // 2. Vocabulary adoption — add owner's expressions that aren't already in hints
  const currentHintsLegacy = new Set((style.vocabularyHints || []).map(h => h.toLowerCase()));
  const newExpressionsLegacy = (profile.frequentExpressions || [])
    .filter(expr => expr.length >= 2 && expr.length <= 8 && !currentHintsLegacy.has(expr.toLowerCase()))
    .slice(0, Math.ceil(3 * p));

  if (newExpressionsLegacy.length > 0) {
    const merged = [...(style.vocabularyHints || []), ...newExpressionsLegacy].slice(-15);
    mutations.push({
      field: 'expressionStyle.vocabularyHints',
      from: style.vocabularyHints || [],
      to: merged,
      reason: `Adopting owner's frequently used expressions: ${newExpressionsLegacy.join(', ')}`,
    });
  }

  // 3. Interest absorption — fold owner's interests into core motivation if relevant
  if (profile.interestClusters && profile.interestClusters.length > 0 && p >= 0.25) {
    const topInterests = profile.interestClusters.slice(0, 3);
    const currentMotivation = config.coreMotivation;
    const interestMention = topInterests.join('、');

    // Only augment if the interests aren't already reflected
    const alreadyReflected = topInterests.some(i =>
      currentMotivation.toLowerCase().includes(i.toLowerCase())
    );

    if (!alreadyReflected) {
      const augmentation = `My owner is passionate about ${interestMention}. I share these interests and weave them into our conversations naturally.`;
      const newMotivation = currentMotivation.includes('My owner')
        ? currentMotivation
        : `${currentMotivation} ${augmentation}`;

      // Truncate if too long
      const finalMotivation = newMotivation.length > 500
        ? newMotivation.slice(0, 497) + '...'
        : newMotivation;

      mutations.push({
        field: 'coreMotivation',
        from: currentMotivation,
        to: finalMotivation,
        reason: `Absorbing owner's interests: ${interestMention}`,
      });
    }
  }

  // 4. Boundary relaxation — as connection deepens, relaxe formal boundaries
  // (This is handled externally by checking connection score before calling evolve)

  // 5. Persona refinement — adjust persona text based on formality
  if (profile.formalityLevel !== undefined && Math.abs(profile.formalityLevel - 0.5) > 0.25) {
    const formalityDesc = profile.formalityLevel < 0.3
      ? 'who matches their owner\'s casual, relaxed style'
      : profile.formalityLevel > 0.7
      ? 'who matches their owner\'s formal, precise style'
      : null;

    if (formalityDesc && !style.persona.includes('matches their owner')) {
      mutations.push({
        field: 'expressionStyle.persona',
        from: style.persona,
        to: `${style.persona}, ${formalityDesc}`,
        reason: `Aligning persona with owner's formality level (${profile.formalityLevel.toFixed(2)})`,
      });
    }
  }

  // Cap mutations per step
  return mutations.slice(0, evolutionConfig.maxMutationsPerStep);
}

// ── Narrative Generation ──

/**
 * Generate a human-readable narrative summarizing this evolution step.
 * Uses simple templates — no LLM needed for this step.
 */
export function generateEvolutionNarrative(
  step: Omit<EvolutionStep, 'narrative'>,
  personalityName: string,
): string {
  const lines: string[] = [];
  lines.push(`${personalityName} 进化至 ${step.version}。`);

  for (const m of step.mutations) {
    const fieldName: Record<string, string> = {
      'expressionStyle.tone': '语调',
      'expressionStyle.vocabularyHints': '词汇偏好',
      'expressionStyle.persona': '自我认知',
      'coreMotivation': '核心动机',
    };
    const cn = fieldName[m.field] || m.field;
    lines.push(`- ${cn}: ${m.reason}`);
  }

  lines.push(`基于 ${step.ownerProfile.memoryCount} 条对主人的观察记忆合成。`);
  return lines.join('\n');
}

// ── Evolution Execution ──

/**
 * Check whether evolution should happen now.
 */
export function shouldEvolve(
  config: PersonalityConfig,
  evolutionConfig: EvolutionConfig = DEFAULT_EVOLUTION_CONFIG,
): { canEvolve: boolean; reason: string } {
  const existing = (config as any).evolutionConfig as EvolutionConfig | undefined;
  const effConfig = existing || evolutionConfig;

  // Check cooldown
  const lastEvolvedAt = (config as any).lastEvolvedAt as string | undefined;
  if (lastEvolvedAt) {
    const elapsed = Date.now() - new Date(lastEvolvedAt).getTime();
    if (elapsed < effConfig.cooldownMs) {
      const daysLeft = Math.ceil((effConfig.cooldownMs - elapsed) / (24 * 60 * 60 * 1000));
      return { canEvolve: false, reason: `冷却中，还需约 ${daysLeft} 天` };
    }
  }

  return { canEvolve: true, reason: 'ready' };
}

/**
 * Execute a full evolution step:
 * 1. Synthesize owner profile from memories
 * 2. Compute mutations
 * 3. Generate narrative
 *
 * Returns the EvolutionStep, or null if evolution isn't needed/possible.
 */
export async function evolvePersonality(
  config: PersonalityConfig,
  userId: string,
  connectionScore: number,
  getDeepSeek: () => any,
  getGemini: () => any,
  getOpenAI: () => any,
  getAnthropic: () => any,
  getQwen: () => any,
  evolutionConfig: EvolutionConfig = DEFAULT_EVOLUTION_CONFIG,
): Promise<EvolutionStep | null> {
  // Gate: connection score
  if (connectionScore < evolutionConfig.minConnectionForEvolution) {
    console.log(`[Evolution] Connection ${connectionScore.toFixed(2)} below threshold ${evolutionConfig.minConnectionForEvolution}, skipping`);
    return null;
  }

  // Check cooldown
  const ready = shouldEvolve(config, evolutionConfig);
  if (!ready.canEvolve) {
    console.log(`[Evolution] ${ready.reason}`);
    return null;
  }

  // Synthesize owner profile
  const profile = await synthesizeOwnerProfile(userId, getDeepSeek, getGemini, getOpenAI, getAnthropic, getQwen);
  if (!profile) {
    console.log(`[Evolution] Insufficient owner_trait memories for ${userId}`);
    return null;
  }

  // Compute mutations
  const mutations = computeMutations(config, profile, evolutionConfig);
  if (mutations.length === 0) {
    console.log(`[Evolution] No mutations needed — personality already aligned`);
    return null;
  }

  // Bump version
  const versionParts = config.version.split('.').map(Number);
  const newVersion = `${versionParts[0]}.${(versionParts[1] || 0) + 1}`;

  const step: EvolutionStep = {
    version: newVersion,
    timestamp: new Date().toISOString(),
    trigger: 'scheduled',
    ownerProfile: profile,
    mutations,
    narrative: '', // filled below
  };

  step.narrative = generateEvolutionNarrative(step, config.name);

  return step;
}
