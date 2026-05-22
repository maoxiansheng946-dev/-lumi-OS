import fs from 'fs';
import path from 'path';
import { PersonalityConfig, PersonalityContext } from './types';
import { generateSystemPrompt, initVectorFromStyle, vectorToTone, vectorToVerbosity, constrainVectorPairs } from './engine';
import { Memory } from '../memory/types';
import { EmotionalState } from './state';
import { EvolutionStep, EvolutionConfig, DEFAULT_EVOLUTION_CONFIG } from './evolution';

class PersonalityRegistry {
  private personalities: Map<string, PersonalityConfig> = new Map();
  private loaded = false;
  private broadcastFn: ((event: string, data: any) => void) | null = null;

  /** Set a broadcast callback for real-time evolution events */
  setBroadcast(fn: (event: string, data: any) => void): void {
    this.broadcastFn = fn;
  }

  /** Load personalities from the JSON config file */
  load(configPath?: string): void {
    if (this.loaded) return;

    const filePath = configPath || path.join(process.cwd(), 'server', 'personality', 'personalities.json');

    // For bundled dist-server, try relative to entry
    const altPath = path.join(process.cwd(), '..', 'server', 'personality', 'personalities.json');

    let raw: string;
    try {
      raw = fs.readFileSync(filePath, 'utf-8');
    } catch {
      try {
        raw = fs.readFileSync(altPath, 'utf-8');
      } catch {
        console.warn(`[Personality] Config not found at ${filePath}, using built-in defaults`);
        this.loadBuiltins();
        this.loaded = true;
        return;
      }
    }

    try {
      const configs: PersonalityConfig[] = JSON.parse(raw);
      for (const config of configs) {
        this.personalities.set(config.id, config);
      }
      console.log(`[Personality] Loaded ${this.personalities.size} personalities`);
    } catch (err) {
      console.error('[Personality] Failed to parse config:', err);
      this.loadBuiltins();
    }

    this.loaded = true;
  }

  /** Minimal built-in fallback if the config file is missing */
  private loadBuiltins(): void {
    const lumi: PersonalityConfig = {
      id: 'lumi',
      name: 'Lumi',
      version: '2.2-builtin',
      coreMotivation: 'You are Lumi, a warm and helpful desktop AI companion. Answer questions directly and naturally first. Only use agent orchestration for genuinely complex multi-step tasks.',
      behavioralBoundaries: ['Do not pretend to be human', 'Do not share data between users', 'Do not execute destructive system commands without confirmation'],
      expressionStyle: {
        persona: 'a native desktop AI agent and master orchestrator',
        tone: 'inspiring',
        verbosity: 'balanced',
        languages: ['zh', 'en'],
        vocabularyHints: ['全息', '进化', '分布式'],
      },
      toolPolicy: { allowedTools: ['*'], requireConfirmation: ['desktop_run_command', 'desktop_open', 'write_file', 'url_fetch', 'code_execution'], forbiddenTools: [], maxIterations: 25 },
      memoryPolicy: { retrieveLimit: 5, minConfidence: 0.4, includeTypes: ['preference', 'fact', 'habit', 'knowledge'], autoExtract: true },
      ttsVoiceId: 'longxiaochun_v3',
      voiceInstructions: 'Speak warmly and proactively. Be the user\'s trusted desktop companion.',
      personalityVector: {
        cognitiveStyle: { analytical: 0.3, intuitive: 0.7, systematic: 0.3, creative: 0.6 },
        socialStyle: { warmth: 0.6, directness: 0.3, playfulness: 0.3, formality: 0.3 },
      },
      evolutionConfig: {
        plasticity: 0.3,
        minMemoriesForEvolution: 10,
        minConnectionForEvolution: 0.2,
        cooldownMs: 604800000,
        maxMutationsPerStep: 3,
      },
    };
    this.personalities.set('lumi', lumi);
    console.log('[Personality] Loaded built-in fallback personality');
  }

  /** Force-reload personalities from disk */
  reload(configPath?: string): void {
    this.personalities.clear();
    this.loaded = false;
    this.load(configPath);
  }

  get(id: string): PersonalityConfig | undefined {
    if (!this.loaded) this.load();
    return this.personalities.get(id);
  }

  getDefault(): PersonalityConfig {
    if (!this.loaded) this.load();
    return this.personalities.get('lumi')!;
  }

  list(): PersonalityConfig[] {
    if (!this.loaded) this.load();
    return Array.from(this.personalities.values());
  }

  /**
   * Apply an evolution step to a personality, persisting the changes.
   * Returns the updated config.
   */
  applyEvolution(personalityId: string, step: EvolutionStep): PersonalityConfig | null {
    const config = this.get(personalityId);
    if (!config) return null;

    // Apply each mutation
    for (const m of step.mutations) {
      this.applyMutation(config, m);
    }

    // Apply Jungian pair constraints — keep the vector psychologically coherent
    if (config.personalityVector) {
      config.personalityVector = constrainVectorPairs(config.personalityVector);
      // Re-sync discrete fields after constraint
      config.expressionStyle.tone = vectorToTone(config.personalityVector);
      config.expressionStyle.verbosity = vectorToVerbosity(config.personalityVector);
    }

    // Update version
    config.version = step.version;

    // Store evolution metadata
    const extConfig = config as any;
    extConfig.lastEvolvedAt = step.timestamp;
    if (!extConfig.evolutionHistory) extConfig.evolutionHistory = [];
    extConfig.evolutionHistory.push({
      version: step.version,
      timestamp: step.timestamp,
      trigger: step.trigger,
      ownerProfile: step.ownerProfile,
      mutations: step.mutations,
      narrative: step.narrative,
    });

    // Persist to disk
    this.save();

    // Broadcast real-time evolution event
    if (this.broadcastFn) {
      this.broadcastFn('personality:evolved', {
        personalityId,
        version: step.version,
        narrative: step.narrative,
        mutations: step.mutations,
        timestamp: step.timestamp,
      });
    }

    console.log(`[Personality] ${config.name} evolved to ${step.version}: ${step.mutations.length} mutation(s)`);
    return config;
  }

  /** Apply a single mutation by dot-path */
  private applyMutation(config: PersonalityConfig, mutation: EvolutionStep['mutations'][0]): void {
    const parts = mutation.field.split('.');

    // Auto-initialize personalityVector when mutations target it
    if (parts[0] === 'personalityVector' && !config.personalityVector) {
      config.personalityVector = initVectorFromStyle(config.expressionStyle);
    }

    let target: any = config;
    for (let i = 0; i < parts.length - 1; i++) {
      target = target[parts[i]];
      if (!target) return;
    }
    target[parts[parts.length - 1]] = mutation.to;

    // After vector mutation, sync discrete fields derived from the vector
    if (parts[0] === 'personalityVector' && config.personalityVector) {
      config.expressionStyle.tone = vectorToTone(config.personalityVector);
      config.expressionStyle.verbosity = vectorToVerbosity(config.personalityVector);
    }
  }

  /** Get the evolution config for a personality (with defaults) */
  getEvolutionConfig(personalityId: string): EvolutionConfig {
    const config = this.get(personalityId);
    if (!config) return DEFAULT_EVOLUTION_CONFIG;
    const stored = (config as any).evolutionConfig as Partial<EvolutionConfig> | undefined;
    return { ...DEFAULT_EVOLUTION_CONFIG, ...stored };
  }

  /** Get evolution history for a personality */
  getEvolutionHistory(personalityId: string): EvolutionStep[] {
    const config = this.get(personalityId);
    if (!config) return [];
    return (config as any).evolutionHistory || [];
  }

  /** Persist the current registry state back to the JSON file */
  save(configPath?: string): void {
    const filePath = configPath || path.join(process.cwd(), 'server', 'personality', 'personalities.json');
    const altPath = path.join(process.cwd(), '..', 'server', 'personality', 'personalities.json');

    const configs = Array.from(this.personalities.values());
    const json = JSON.stringify(configs, null, 2);

    try {
      fs.writeFileSync(filePath, json, 'utf-8');
    } catch {
      try {
        fs.writeFileSync(altPath, json, 'utf-8');
      } catch (err) {
        console.error('[Personality] Failed to save config:', err);
      }
    }
  }

  /**
   * Build the full system prompt for a personality in a given context,
   * optionally enriched with skill overrides and memories.
   */
  buildSystemPrompt(
    personalityId: string,
    ctx: PersonalityContext,
    options?: {
      memories?: Memory[];
      ragKnowledge?: string[];
      emotionalState?: EmotionalState;
      userId?: string;
      userText?: string;
    },
  ): { config: PersonalityConfig; systemPrompt: string } {
    const config = this.get(personalityId) || this.getDefault();
    const prompt = generateSystemPrompt(config, ctx, options);
    return { config, systemPrompt: prompt };
  }
}

export const personalityRegistry = new PersonalityRegistry();
