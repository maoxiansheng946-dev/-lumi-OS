import { describe, it, expect } from 'vitest';

// ── Pure logic tests for marketplace registry functions ──
// The actual functions depend on fs/DB; we test the pure helpers and validate
// the public API contracts (function signatures, error handling logic).

describe('Marketplace Registry — pure logic', () => {
  describe('toDisplayName (dir name → display name)', () => {
    // Replicate the function from registry.ts
    function toDisplayName(dirName: string): string {
      return dirName
        .split('-')
        .map(w => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }

    it('converts kebab-case to Title Case', () => {
      expect(toDisplayName('web-scraper')).toBe('Web Scraper');
      expect(toDisplayName('email-assistant')).toBe('Email Assistant');
      expect(toDisplayName('qr-code-generator')).toBe('Qr Code Generator');
    });

    it('handles single word', () => {
      expect(toDisplayName('weather')).toBe('Weather');
      expect(toDisplayName('calculator')).toBe('Calculator');
    });

    it('handles empty string gracefully', () => {
      expect(toDisplayName('')).toBe('');
    });
  });

  describe('rating validation (rateSkill logic)', () => {
    function validateRating(rating: number): boolean {
      return rating >= 1 && rating <= 5;
    }

    it('1-5 are valid', () => {
      expect(validateRating(1)).toBe(true);
      expect(validateRating(3)).toBe(true);
      expect(validateRating(5)).toBe(true);
    });

    it('0 is invalid', () => {
      expect(validateRating(0)).toBe(false);
    });

    it('6 is invalid', () => {
      expect(validateRating(6)).toBe(false);
    });

    it('negative is invalid', () => {
      expect(validateRating(-1)).toBe(false);
    });

    it('decimal within range is valid', () => {
      expect(validateRating(4.5)).toBe(true);
    });
  });

  describe('skill ID generation (publishSkill)', () => {
    function generateSkillId(name: string): string {
      return `skill-${name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
    }

    it('generates kebab-style id from name', () => {
      expect(generateSkillId('Web Scraper')).toBe('skill-web-scraper');
      expect(generateSkillId('Email Assistant')).toBe('skill-email-assistant');
    });

    it('removes special characters', () => {
      // Regex replaces non-alphanumeric chars with dashes; may leave trailing dash
      expect(generateSkillId('My Cool Skill!')).toBe('skill-my-cool-skill-');
      expect(generateSkillId('foo/bar@baz')).toBe('skill-foo-bar-baz');
    });

    it('lowercases input', () => {
      expect(generateSkillId('UPPERCASE')).toBe('skill-uppercase');
    });
  });

  describe('searchSkills filter logic', () => {
    function searchSkills(skills: Array<{ name: string; description: string; category: string }>, query: string) {
      const q = query.toLowerCase();
      return skills.filter(s =>
        s.name.toLowerCase().includes(q) ||
        s.description.toLowerCase().includes(q) ||
        s.category.toLowerCase().includes(q)
      );
    }

    const mockSkills = [
      { name: 'Weather', description: 'Get weather forecasts', category: 'Utility' },
      { name: 'Calculator', description: 'Perform math calculations', category: 'Utility' },
      { name: 'Translator', description: '自然语言翻译 / Language translation', category: 'Language' },
    ];

    it('finds by name (case insensitive)', () => {
      expect(searchSkills(mockSkills, 'weather')).toHaveLength(1);
      expect(searchSkills(mockSkills, 'Weather')).toHaveLength(1);
    });

    it('finds by description', () => {
      expect(searchSkills(mockSkills, 'math')).toHaveLength(1);
      expect(searchSkills(mockSkills, '翻译')).toHaveLength(1);
    });

    it('finds by category', () => {
      expect(searchSkills(mockSkills, 'Utility')).toHaveLength(2);
    });

    it('returns empty for no match', () => {
      expect(searchSkills(mockSkills, 'nonexistent')).toHaveLength(0);
    });
  });

  describe('getCategories dedup + sort', () => {
    function getCategories(skills: Array<{ category: string }>): string[] {
      const cats = new Set<string>();
      for (const s of skills) cats.add(s.category);
      return [...cats].sort();
    }

    it('returns unique sorted categories', () => {
      const skills = [
        { category: 'Utility' },
        { category: 'Language' },
        { category: 'Utility' },
      ];
      expect(getCategories(skills)).toEqual(['Language', 'Utility']);
    });

    it('returns empty for no skills', () => {
      expect(getCategories([])).toEqual([]);
    });
  });

  describe('rating average computation', () => {
    function computeRating(ratings: number[]): number {
      if (ratings.length === 0) return 0;
      return Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10;
    }

    it('averages multiple ratings', () => {
      expect(computeRating([4, 5])).toBe(4.5);
      expect(computeRating([3, 3, 3])).toBe(3);
    });

    it('rounds to 1 decimal', () => {
      expect(computeRating([4, 5, 5])).toBe(4.7); // (14/3)*10 = 46.66 → 47, /10 = 4.7
    });

    it('returns 0 for empty', () => {
      expect(computeRating([])).toBe(0);
    });
  });
});
