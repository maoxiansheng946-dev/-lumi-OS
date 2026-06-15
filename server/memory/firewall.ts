import type {
  Memory,
  MemoryPrivacyClass,
  MemoryRetention,
  MemorySource,
  MemoryTier,
} from './types';

export interface MemoryFirewallInput {
  userId: string;
  content: string;
  tier?: MemoryTier;
  source?: MemorySource;
  domain?: string;
  orgId?: string;
  privacyClass?: MemoryPrivacyClass;
  retention?: MemoryRetention;
  userApproved?: boolean;
}

export interface MemoryFirewallDecision {
  accepted: boolean;
  reason: string;
  metadata: Required<Pick<Memory, 'source' | 'privacyClass' | 'retention' | 'userApproved' | 'firewall'>>;
}

export interface MemoryFirewallPolicy {
  defaultSource: MemorySource;
  rules: string[];
  protectedTiers: MemoryTier[];
  externalSources: MemorySource[];
}

const EXTERNAL_SOURCES = new Set<MemorySource>(['lap', 'community', 'external_app']);
const SECRET_PATTERNS = [
  /\b(api[_-]?key|secret|token|password|passwd|private[_-]?key)\b/i,
  /\bsk-[A-Za-z0-9_-]{16,}\b/,
  /\bghp_[A-Za-z0-9_]{20,}\b/,
];

export function getMemoryFirewallPolicy(): MemoryFirewallPolicy {
  return {
    defaultSource: 'chat',
    protectedTiers: ['core_identity'],
    externalSources: Array.from(EXTERNAL_SOURCES),
    rules: [
      'Every memory receives source, privacyClass, retention, userApproved, and firewall metadata.',
      'Personal chat, voice, canvas, manual, system, import, and consolidation memories are local private memories by default.',
      'Work-domain memories are organization scoped and must keep orgId attached.',
      'Meeting memories default to session retention unless explicitly promoted later.',
      'LAP, community, and external-app memories are external by default and require explicit user approval for long-term storage.',
      'Secret-looking content is blocked from memory storage unless explicitly approved.',
      'core_identity memories require explicit user approval.',
    ],
  };
}

export function evaluateMemoryFirewall(input: MemoryFirewallInput): MemoryFirewallDecision {
  const source = input.source || inferSource(input);
  const privacyClass = input.privacyClass || inferPrivacyClass(input, source);
  const retention = input.retention || inferRetention(input, source);
  const userApproved = input.userApproved === true;
  const tier = input.tier || 'episodic';

  if (!input.userId) {
    return reject('Memory requires a userId', source, privacyClass, retention, userApproved);
  }
  if (!input.content || !String(input.content).trim()) {
    return reject('Memory content is empty', source, privacyClass, retention, userApproved);
  }
  if (privacyClass === 'secret' && !userApproved) {
    return reject('Secret-looking content requires explicit approval before storage', source, privacyClass, retention, userApproved);
  }
  if (tier === 'core_identity' && !userApproved) {
    return reject('core_identity memories require explicit user approval', source, privacyClass, retention, userApproved);
  }
  if (EXTERNAL_SOURCES.has(source) && retention !== 'ephemeral' && !userApproved) {
    return reject(`${source} memory requires explicit approval for ${retention} storage`, source, privacyClass, retention, userApproved);
  }
  if ((input.domain || 'personal') === 'work' && !input.orgId) {
    return reject('Work-domain memory requires orgId', source, privacyClass, retention, userApproved);
  }

  return accept('Memory accepted by global firewall', source, privacyClass, retention, userApproved);
}

export function applyMemoryFirewallMetadata<T extends Partial<Memory>>(
  memory: T,
  decision: MemoryFirewallDecision,
): T {
  return {
    ...memory,
    source: decision.metadata.source,
    privacyClass: decision.metadata.privacyClass,
    retention: decision.metadata.retention,
    userApproved: decision.metadata.userApproved,
    firewall: decision.metadata.firewall,
  };
}

function inferSource(input: MemoryFirewallInput): MemorySource {
  if ((input.domain || 'personal') === 'work') return 'organization';
  const id = input.content + ' ' + (input.tier || '') + ' ' + (input.orgId || '');
  if (/meeting|transcript|minutes|会议|纪要/i.test(id)) return 'meeting';
  if (/consolidation|reflection|journal/i.test(id)) return 'consolidation';
  return 'chat';
}

function inferPrivacyClass(input: MemoryFirewallInput, source: MemorySource): MemoryPrivacyClass {
  if (SECRET_PATTERNS.some(pattern => pattern.test(input.content || ''))) return 'secret';
  if ((input.domain || 'personal') === 'work' || source === 'organization') return 'organization';
  if (source === 'community' || source === 'lap') return 'shared';
  if (source === 'system') return 'private';
  return 'private';
}

function inferRetention(input: MemoryFirewallInput, source: MemorySource): MemoryRetention {
  if (input.tier === 'core_identity') return 'permanent';
  if (source === 'meeting') return 'session';
  if (source === 'lap' || source === 'community' || source === 'external_app') return 'ephemeral';
  return 'long_term';
}

function accept(
  reason: string,
  source: MemorySource,
  privacyClass: MemoryPrivacyClass,
  retention: MemoryRetention,
  userApproved: boolean,
): MemoryFirewallDecision {
  return {
    accepted: true,
    reason,
    metadata: buildMetadata(true, reason, source, privacyClass, retention, userApproved),
  };
}

function reject(
  reason: string,
  source: MemorySource,
  privacyClass: MemoryPrivacyClass,
  retention: MemoryRetention,
  userApproved: boolean,
): MemoryFirewallDecision {
  return {
    accepted: false,
    reason,
    metadata: buildMetadata(false, reason, source, privacyClass, retention, userApproved),
  };
}

function buildMetadata(
  accepted: boolean,
  reason: string,
  source: MemorySource,
  privacyClass: MemoryPrivacyClass,
  retention: MemoryRetention,
  userApproved: boolean,
): Required<Pick<Memory, 'source' | 'privacyClass' | 'retention' | 'userApproved' | 'firewall'>> {
  return {
    source,
    privacyClass,
    retention,
    userApproved,
    firewall: {
      accepted,
      reason,
      appliedAt: new Date().toISOString(),
    },
  };
}
