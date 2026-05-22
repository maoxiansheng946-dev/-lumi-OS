import React from 'react';
import { SkillCenter } from './SkillCenter';

/** Thin wrapper — delegates to SkillCenter, the canonical skill marketplace component. */
export function SkillMarketplace({ t, lang }: { t: any; lang: 'en' | 'zh' }) {
  return <SkillCenter t={t} lang={lang} />;
}
