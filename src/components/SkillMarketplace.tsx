import React from 'react';
import { SkillCenter } from './SkillCenter';

/** Thin wrapper — delegates to SkillCenter, the canonical skill marketplace component. */
export function SkillMarketplace({ t }: { t: any }) {
  return <SkillCenter t={t} />;
}
