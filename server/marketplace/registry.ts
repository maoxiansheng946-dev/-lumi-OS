/**
 * LumiOS Skill Marketplace Registry
 *
 * Dynamically discovers skills from:
 *   - Bundled skills in server/skills/bundled/
 *   - Community registry (published skills)
 *   - Local ~/lumi_skills/ installs
 */
import fs from 'fs';
import path from 'path';
import os from 'os';
import { fileURLToPath } from 'url';
import { readDB, writeDB } from '../../db_layer';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const SKILLS_DIR = path.join(os.homedir(), 'lumi_skills');
const BUNDLED_DIR = path.join(__dirname, '..', 'skills', 'bundled');

export interface MarketplaceSkill {
  id: string;
  name: string;
  description: string;
  author: string;
  downloads: number;
  rating: number;
  category: string;
  icon: string;
  installSource: 'bundled' | 'community';
  installPath?: string;
  installed: boolean;
  version?: string;
  toolCount?: number;
}

export interface SkillRating {
  skillId: string;
  userId: string;
  rating: number;
  review?: string;
  timestamp: string;
}

/** Scan bundled directory to discover available skills */
function discoverBundledSkills(): MarketplaceSkill[] {
  const skills: MarketplaceSkill[] = [];
  if (!fs.existsSync(BUNDLED_DIR)) return skills;

  const entries = fs.readdirSync(BUNDLED_DIR, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const pkgPath = path.join(BUNDLED_DIR, entry.name, 'package.json');
    if (!fs.existsSync(pkgPath)) continue;

    try {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      const lumi = pkg.lumi || {};
      const installed = fs.existsSync(path.join(SKILLS_DIR, entry.name));
      skills.push({
        id: `skill-${entry.name}`,
        name: lumi.displayName || toDisplayName(entry.name),
        description: pkg.description || '',
        author: 'Lumi Official',
        downloads: 0,
        rating: 0,
        category: lumi.category || 'Other',
        icon: lumi.icon || 'Zap',
        installSource: 'bundled',
        installPath: path.join(BUNDLED_DIR, entry.name),
        installed,
        version: pkg.version,
        toolCount: lumi.toolCount || 1,
      });
    } catch { /* skip invalid packages */ }
  }
  return skills;
}

/** Community skill registry stored in DB */
const COMMUNITY_REGISTRY: MarketplaceSkill[] = [];

/** Get community registry from DB */
function getCommunityRegistry(): MarketplaceSkill[] {
  const db = readDB();
  if (!db.communitySkills) return [];
  return db.communitySkills.map((s: any) => ({
    ...s,
    installSource: 'community' as const,
    installPath: s.installPath,
    installed: fs.existsSync(path.join(SKILLS_DIR, s.id.replace('skill-', ''))),
  }));
}

/** Get all marketplace skills: bundled + community, with download counts & ratings from DB */
export function getMarketplaceSkills(): MarketplaceSkill[] {
  const bundled = discoverBundledSkills();
  const community = getCommunityRegistry();
  const db = readDB();

  const all = [...bundled, ...community];

  // Enrich with ratings from DB
  if (db.skillRatings) {
    for (const skill of all) {
      const ratings = (db.skillRatings as SkillRating[]).filter(r => r.skillId === skill.id);
      if (ratings.length > 0) {
        skill.rating = Math.round((ratings.reduce((a, b) => a + b.rating, 0) / ratings.length) * 10) / 10;
      }
    }
  }

  // Enrich with download counts from DB
  if (db.skillDownloads) {
    for (const skill of all) {
      skill.downloads = (db.skillDownloads as Record<string, number>)[skill.id] || skill.downloads;
    }
  }

  return all;
}

export function getSkillById(id: string): MarketplaceSkill | undefined {
  return getMarketplaceSkills().find(s => s.id === id);
}

export function searchSkills(query: string): MarketplaceSkill[] {
  const q = query.toLowerCase();
  return getMarketplaceSkills().filter(s =>
    s.name.toLowerCase().includes(q) ||
    s.description.toLowerCase().includes(q) ||
    s.category.toLowerCase().includes(q)
  );
}

export function getCategories(): string[] {
  const categories = new Set<string>();
  for (const s of getMarketplaceSkills()) {
    categories.add(s.category);
  }
  return [...categories].sort();
}

/** Record a skill installation */
export function recordInstall(skillId: string): void {
  const db = readDB();
  if (!db.skillDownloads) db.skillDownloads = {};
  db.skillDownloads[skillId] = (db.skillDownloads[skillId] || 0) + 1;
  writeDB(db);
}

/** Publish a community skill */
export function publishSkill(skill: {
  id?: string;
  name: string;
  description: string;
  author: string;
  category: string;
  icon: string;
  installPath?: string;
  version?: string;
  toolCount?: number;
}): MarketplaceSkill {
  const skillId = skill.id || `skill-${skill.name.toLowerCase().replace(/[^a-z0-9]/g, '-')}`;
  const db = readDB();
  if (!db.communitySkills) db.communitySkills = [];

  const entry: MarketplaceSkill = {
    id: skillId,
    name: skill.name,
    description: skill.description,
    author: skill.author || 'Community',
    downloads: 0,
    rating: 0,
    category: skill.category || 'Other',
    icon: skill.icon || 'Zap',
    installSource: 'community' as const,
    installPath: skill.installPath,
    installed: false,
    version: skill.version,
    toolCount: skill.toolCount || 1,
  };

  const existing = db.communitySkills.findIndex((s: any) => s.id === skillId);
  if (existing >= 0) {
    db.communitySkills[existing] = entry;
  } else {
    db.communitySkills.push(entry);
  }
  writeDB(db);
  return entry;
}

/** Rate a skill */
export function rateSkill(skillId: string, userId: string, rating: number, review?: string): SkillRating {
  if (rating < 1 || rating > 5) throw new Error('Rating must be between 1 and 5');

  const db = readDB();
  if (!db.skillRatings) db.skillRatings = [];

  // Update existing rating or add new
  const existing = (db.skillRatings as SkillRating[]).findIndex(
    r => r.skillId === skillId && r.userId === userId,
  );
  const entry: SkillRating = {
    skillId, userId, rating, review,
    timestamp: new Date().toISOString(),
  };

  if (existing >= 0) {
    (db.skillRatings as SkillRating[])[existing] = entry;
  } else {
    (db.skillRatings as SkillRating[]).push(entry);
  }
  writeDB(db);
  return entry;
}

/** Get ratings for a skill */
export function getSkillRatings(skillId: string): SkillRating[] {
  const db = readDB();
  if (!db.skillRatings) return [];
  return (db.skillRatings as SkillRating[]).filter(r => r.skillId === skillId);
}

function toDisplayName(dirName: string): string {
  return dirName
    .split('-')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}
