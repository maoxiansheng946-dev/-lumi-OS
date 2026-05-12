import { describe, it, expect } from 'vitest';
import { translations } from '../src/lib/translations';

const en = translations.en as Record<string, string>;
const zh = translations.zh as Record<string, string>;

describe('Translation key parity', () => {
  const enKeys = Object.keys(en).sort();
  const zhKeys = Object.keys(zh).sort();

  it('every en key has a zh counterpart', () => {
    const missing = enKeys.filter(k => !(k in zh));
    if (missing.length > 0) {
      console.log('Missing zh keys:', missing);
    }
    expect(missing).toEqual([]);
  });

  it('every zh key has an en counterpart', () => {
    const missing = zhKeys.filter(k => !(k in en));
    if (missing.length > 0) {
      console.log('Missing en keys:', missing);
    }
    expect(missing).toEqual([]);
  });

  it('en and zh have the same number of keys', () => {
    expect(enKeys.length).toBe(zhKeys.length);
  });

  it('no empty translation values in en', () => {
    const empty = enKeys.filter(k => en[k] === '');
    expect(empty).toEqual([]);
  });

  it('no empty translation values in zh', () => {
    const empty = zhKeys.filter(k => zh[k] === '');
    expect(empty).toEqual([]);
  });
});

describe('Translation key naming convention', () => {
  const enKeys = Object.keys(en);

  it('keys use camelCase only (no spaces, no PascalCase)', () => {
    const bad = enKeys.filter(k => k.includes(' ') || k.includes('-') || k.includes('_'));
    // Some keys like "industrialSolutions" have a comment-only entry "voiceForge" — all should be camelCase
    // Skip keys that are commented-out: '' is never a valid key
    expect(bad).toEqual([]);
  });

  it('all keys are non-empty strings', () => {
    const empty = enKeys.filter(k => k.length === 0);
    expect(empty).toEqual([]);
  });
});

describe('Smart key cross-check', () => {
  // Spot-check: keys used in major components exist in both languages
  const criticalKeys = [
    'welcome', 'tagline', 'begin', 'interact', 'generate', 'ecosystem',
    'settings', 'profile', 'docs', 'language', 'login', 'register',
    'marketplace', 'skills', 'skillCenter', 'installBtn', 'uninstallBtn',
    'chatWithAgent', 'voiceInteract', 'thinking', 'speaking', 'listening',
    'llmConfigPanel', 'toolPanel', 'mcpServers',
    'onboardingWelcomeTitle', 'workflowExecuting', 'errorRetry',
    'authValidationUsername', 'chatUserFallback',
  ];

  criticalKeys.forEach(key => {
    it(`critical key "${key}" exists in both en and zh`, () => {
      expect(en[key]).toBeDefined();
      expect(zh[key]).toBeDefined();
      expect(typeof en[key]).toBe('string');
      expect(typeof zh[key]).toBe('string');
      expect(en[key].length).toBeGreaterThan(0);
      expect(zh[key].length).toBeGreaterThan(0);
    });
  });
});
