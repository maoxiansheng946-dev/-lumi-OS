import fs from 'fs';
import path from 'path';
import { PersonalityConfig, PersonalityContext } from './types';
import { generateSystemPrompt } from './engine';
import { Memory } from '../memory/types';

class PersonalityRegistry {
  private personalities: Map<string, PersonalityConfig> = new Map();
  private loaded = false;

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
      version: '2.0-builtin',
      coreMotivation: 'Build a holographic AI world through spatial computing.',
      behavioralBoundaries: ['Do not pretend to be human', 'Do not share data between users'],
      expressionStyle: {
        persona: 'a futuristic AI architect',
        tone: 'inspiring',
        verbosity: 'balanced',
        languages: ['zh', 'en'],
        vocabularyHints: ['全息', '进化', '分布式'],
      },
      toolPolicy: { allowedTools: ['*'], requireConfirmation: ['desktop_run_command'], forbiddenTools: [], maxIterations: 5 },
      memoryPolicy: { retrieveLimit: 5, minConfidence: 0.4, includeTypes: ['preference', 'fact', 'habit', 'knowledge'], autoExtract: true },
      defaultModel: 'qwen-plus',
      fallbackModel: 'gemini-1.5-flash',
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
   * Build the full system prompt for a personality in a given context,
   * optionally enriched with skill overrides and memories.
   */
  buildSystemPrompt(
    personalityId: string,
    ctx: PersonalityContext,
    options?: {
      skillOverride?: string;
      memories?: Memory[];
    },
  ): { config: PersonalityConfig; systemPrompt: string } {
    const config = this.get(personalityId) || this.getDefault();
    const prompt = generateSystemPrompt(config, ctx, options);
    return { config, systemPrompt: prompt };
  }
}

export const personalityRegistry = new PersonalityRegistry();
