import { describe, expect, it } from 'vitest';
import { buildResponseLanguageInstruction, detectLanguage, getResponseLanguage } from '../server/utils/language';

describe('language detection', () => {
  it('treats Chinese messages with English product names as Chinese', () => {
    expect(detectLanguage('为什么我给lumi发消息会默认用英语反馈给我，我说的可是中文')).toBe('zh');
    expect(getResponseLanguage('为什么我给lumi发消息会默认用英语反馈给我，我说的可是中文')).toBe('Simplified Chinese');
  });

  it('treats Chinese messages with code terms as Chinese', () => {
    expect(detectLanguage('React useEffect 怎么用')).toBe('zh');
    expect(detectLanguage('lumi 帮我 fix bug')).toBe('zh');
  });

  it('keeps plain English as English', () => {
    expect(detectLanguage('how do I fix this bug')).toBe('en');
    expect(getResponseLanguage('how do I fix this bug')).toBe('English');
  });

  it('builds an explicit anti-English-drift prompt overlay', () => {
    const instruction = buildResponseLanguageInstruction('lumi 帮我 fix bug');
    expect(instruction).toContain('Simplified Chinese');
    expect(instruction).toContain('Do not switch to English');
  });
});
