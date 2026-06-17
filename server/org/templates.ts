/**
 * Agent Template Marketplace — submit, review, approve, publish, install.
 *
 * Templates are organization-scoped. Employees create templates from their
 * local agents. Admins review and publish. Published templates can be
 * installed by any org member.
 */

import * as EDB from './db';
import { logAudit } from './db';
import { readDB, writeDB } from '../../db_layer';

// ── Template CRUD ────────────────────────────────────────────────────────

export function listTemplates(orgId: string, filters?: { status?: EDB.TemplateStatus; category?: string; authorId?: string }) {
  return EDB.listTemplates(orgId, filters);
}

export function getTemplate(orgId: string, templateId: string) {
  return EDB.getTemplate(orgId, templateId);
}

export function createTemplate(
  orgId: string,
  authorId: string,
  data: { name: string; description: string; category: string; config: any; icon?: string }
) {
  const template = EDB.createTemplate(orgId, authorId, data);
  logAudit({
    orgId,
    userId: authorId,
    action: 'template.create',
    resourceType: 'agent_template',
    resourceId: template.id,
    details: { name: data.name, category: data.category },
  });
  return template;
}

// ── Review workflow ──────────────────────────────────────────────────────

export function submitForReview(orgId: string, userId: string, templateId: string) {
  const t = EDB.getTemplate(orgId, templateId);
  if (!t) return null;
  if (t.authorId !== userId) return null;
  if (t.status !== 'draft') return null;

  const updated = EDB.updateTemplateStatus(orgId, templateId, 'pending_review');
  if (updated) {
    logAudit({
      orgId,
      userId,
      action: 'template.submit',
      resourceType: 'agent_template',
      resourceId: templateId,
    });
  }
  return updated;
}

export function approveTemplate(orgId: string, reviewerId: string, templateId: string, comment?: string) {
  const t = EDB.getTemplate(orgId, templateId);
  if (!t) return null;
  if (t.status !== 'pending_review') return null;

  const updated = EDB.updateTemplateStatus(orgId, templateId, 'approved', reviewerId, comment || '');
  if (updated) {
    logAudit({
      orgId,
      userId: reviewerId,
      action: 'template.approve',
      resourceType: 'agent_template',
      resourceId: templateId,
      details: { comment: comment || '' },
    });
  }
  return updated;
}

export function rejectTemplate(orgId: string, reviewerId: string, templateId: string, comment: string) {
  const t = EDB.getTemplate(orgId, templateId);
  if (!t) return null;
  if (t.status !== 'pending_review') return null;
  if (!comment) return null; // reason required for rejection

  const updated = EDB.updateTemplateStatus(orgId, templateId, 'rejected', reviewerId, comment);
  if (updated) {
    logAudit({
      orgId,
      userId: reviewerId,
      action: 'template.reject',
      resourceType: 'agent_template',
      resourceId: templateId,
      details: { comment },
    });
  }
  return updated;
}

export function publishTemplate(orgId: string, reviewerId: string, templateId: string) {
  const t = EDB.getTemplate(orgId, templateId);
  if (!t) return null;
  if (t.status !== 'approved') return null;

  const updated = EDB.updateTemplateStatus(orgId, templateId, 'published', reviewerId);
  if (updated) {
    logAudit({
      orgId,
      userId: reviewerId,
      action: 'template.publish',
      resourceType: 'agent_template',
      resourceId: templateId,
    });
  }
  return updated;
}

// ── Installation ─────────────────────────────────────────────────────────

export function installTemplate(
  orgId: string,
  userId: string,
  templateId: string,
): { template: EDB.AgentTemplate; agentConfig: any; agent: any; alreadyInstalled: boolean } | null {
  const t = EDB.getTemplate(orgId, templateId);
  if (!t) return null;
  if (t.status !== 'published') return null;

  let config: any;
  try {
    config = JSON.parse(t.config);
  } catch {
    config = {};
  }

  const db = readDB();
  if (!db.agents) db.agents = [];
  const existing = db.agents.find((agent: any) =>
    agent.ownerUid === userId &&
    agent.orgId === orgId &&
    agent.installedTemplateId === templateId &&
    agent.status !== 'terminated'
  );

  const agentConfig = {
    ...config,
    name: config.name || t.name,
    category: t.category,
    personalityId: config.personalityId || 'lumi',
    domain: 'work',
    orgId,
  };

  if (existing) {
    logAudit({
      orgId,
      userId,
      action: 'template.install.existing',
      resourceType: 'agent_template',
      resourceId: templateId,
      details: { agentId: existing.id },
    });
    return { template: t, agentConfig, agent: existing, alreadyInstalled: true };
  }

  const now = new Date().toISOString();
  const agent = {
    id: Math.random().toString(36).substring(2, 15),
    ownerUid: userId,
    name: agentConfig.name,
    category: agentConfig.category,
    data: JSON.stringify(agentConfig),
    status: 'active',
    personalityId: agentConfig.personalityId,
    modelPreference: agentConfig.modelPreference || '',
    memoryScope: agentConfig.memoryScope || 'shared',
    autonomyLevel: agentConfig.autonomyLevel || 'reactive',
    runtimeConfig: typeof agentConfig.runtimeConfig === 'string'
      ? agentConfig.runtimeConfig
      : JSON.stringify(agentConfig.runtimeConfig || {}),
    territory: agentConfig.territory || 'open',
    distilledFrom: '',
    evidenceMap: [],
    relationshipType: '',
    isFrozen: false,
    seedMemoryIds: [],
    executionMode: agentConfig.executionMode || '',
    runtime: agentConfig.runtime || 'internal',
    externalCommand: agentConfig.externalCommand || '',
    domain: 'work',
    orgId,
    installedTemplateId: templateId,
    installedTemplateVersion: t.version,
    createdAt: now,
    lastActiveAt: now,
    skillTags: Array.isArray(agentConfig.skillTags) ? agentConfig.skillTags : [],
    knowledgeDomains: Array.isArray(agentConfig.knowledgeDomains) ? agentConfig.knowledgeDomains : [],
    allowCrossPollination: agentConfig.allowCrossPollination ?? true,
  };

  db.agents.push(agent);
  writeDB(db);
  EDB.incrementTemplateDownloads(orgId, templateId);
  logAudit({
    orgId,
    userId,
    action: 'template.install',
    resourceType: 'agent_template',
    resourceId: templateId,
    details: { agentId: agent.id, agentName: agent.name },
  });

  return { template: t, agentConfig, agent, alreadyInstalled: false };
}

// ── Auto-check helper (called by admin + central Lumi) ───────────────────

export function checkTemplateQuality(template: EDB.AgentTemplate): { passed: boolean; issues: string[] } {
  const issues: string[] = [];

  if (!template.name || template.name.length < 2) {
    issues.push('Template name too short');
  }
  if (!template.description || template.description.length < 10) {
    issues.push('Description too short (min 10 chars)');
  }

  let config: any;
  try {
    config = JSON.parse(template.config);
  } catch {
    issues.push('Invalid config JSON');
    return { passed: false, issues };
  }

  if (!config.initialPrompt || config.initialPrompt.length < 20) {
    issues.push('Initial prompt too short (min 20 chars)');
  }

  // Check for duplicates in the same org
  const orgTemplates = EDB.listTemplates(template.orgId, { status: 'published' });
  const duplicate = orgTemplates.find(t => t.id !== template.id && t.name.toLowerCase() === template.name.toLowerCase());
  if (duplicate) {
    issues.push(`A template named "${template.name}" already exists`);
  }

  return { passed: issues.length === 0, issues };
}
