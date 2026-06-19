import { getGateConfig } from '../autonomy/safety_gate';
import { mcpManager } from '../mcp/client';

export type AdapterStatus =
  | 'ready'
  | 'available'
  | 'draft_only'
  | 'requires_setup'
  | 'attention'
  | 'degraded'
  | 'blocked'
  | 'planned';

export type AdapterCategory =
  | 'client'
  | 'workspace'
  | 'media'
  | 'files'
  | 'web'
  | 'messaging'
  | 'cad_bim'
  | 'ai'
  | 'automation'
  | 'collaboration'
  | 'organization'
  | 'memory'
  | 'system';

export interface AdapterCapability {
  id: string;
  label: string;
  category: AdapterCategory;
  status: AdapterStatus;
  actions: string[];
  surfaces?: string[];
  requiresSetup?: boolean;
  requiresConfirmation?: boolean;
  setup?: string[];
  diagnostics?: string[];
  safety?: string;
  notes?: string;
}

export interface AdapterRegistrySummary {
  total: number;
  byStatus: Record<AdapterStatus, number>;
  byCategory: Record<AdapterCategory, number>;
  readyCount: number;
  setupRequiredCount: number;
  attentionCount: number;
  plannedCount: number;
}

export interface AdapterRegistryReport {
  generatedAt: string;
  userId: string;
  stateAgeSeconds: number | null;
  summary: AdapterRegistrySummary;
  adapters: AdapterCapability[];
}

export interface AdapterRegistryOptions {
  userId?: string;
  clientState?: Record<string, any> | null;
  includePlanned?: boolean;
}

interface SkillStats {
  total: number;
  connected: number;
  enabled: number;
  broken: number;
  unhealthy: number;
  connectedNames: string[];
  issueNames: string[];
}

const STATUS_ORDER: AdapterStatus[] = [
  'ready',
  'available',
  'draft_only',
  'requires_setup',
  'attention',
  'degraded',
  'blocked',
  'planned',
];

const CATEGORY_ORDER: AdapterCategory[] = [
  'client',
  'workspace',
  'media',
  'files',
  'web',
  'messaging',
  'cad_bim',
  'ai',
  'automation',
  'collaboration',
  'organization',
  'memory',
  'system',
];

export function getAdapterRegistry(options: AdapterRegistryOptions = {}): AdapterRegistryReport {
  const userId = options.userId || 'anonymous';
  const state = options.clientState || null;
  const gate = getGateConfig();
  const skillStats = getSkillStats();
  const stateAgeSeconds = getStateAgeSeconds(state);
  const hasState = Boolean(state);
  const staleState = stateAgeSeconds != null && stateAgeSeconds > 120;
  const adapters: AdapterCapability[] = [
    {
      id: 'client.action_router',
      label: 'Client Action Router',
      category: 'client',
      status: !hasState ? 'requires_setup' : staleState ? 'attention' : 'ready',
      actions: [
        'client_get_state',
        'client_health_check',
        'client_action',
        'client_self_repair',
      ],
      surfaces: ['desktop shell', 'top bar', 'mode switcher', 'window manager'],
      setup: hasState ? [] : ['Open Lumi desktop client so the state relay can report live client state.'],
      diagnostics: staleState ? [`Client state is ${stateAgeSeconds}s old.`] : [],
      notes: 'Preferred route for Lumi UI control. Use this before mouse/keyboard control inside Lumi itself.',
    },
    {
      id: 'client.modes',
      label: 'Client Modes',
      category: 'client',
      status: hasState ? 'ready' : 'available',
      actions: ['set_client_mode(chat)', 'set_client_mode(assistant)', 'set_client_mode(autonomous)', 'start_meeting_mode'],
      surfaces: ['mode switcher', 'voice', 'chat', 'meeting'],
      requiresConfirmation: true,
      diagnostics: state?.mode ? [`Current mode: ${state.mode}`] : [],
      notes: 'Chat is conversation-first, Assistant is guided work, Autonomous is visible execution, Meeting is transcription/reporting.',
    },
    {
      id: 'workspace.canvas',
      label: 'Canvas Workbench',
      category: 'workspace',
      status: state?.canvas?.saveState === 'error' ? 'degraded' : 'ready',
      actions: ['open_canvas_task', 'client_self_repair(open_recovery_surface:canvas)'],
      surfaces: ['canvas workbench', 'task route', 'visible outputs'],
      diagnostics: [
        state?.canvas?.sessionId ? `session=${state.canvas.sessionId}` : '',
        state?.canvas?.saveState ? `save=${state.canvas.saveState}` : '',
        state?.canvas?.errorCount ? `errors=${state.canvas.errorCount}` : '',
      ].filter(Boolean),
      notes: 'Use for multi-step work that should show a visible path and deliverables.',
    },
    {
      id: 'workspace.knowledge_memory',
      label: 'Knowledge Base and Memory',
      category: 'memory',
      status: 'ready',
      actions: ['show_knowledge_base', 'search_memory', 'client_action(show_knowledge_base)'],
      surfaces: ['knowledge base', 'memory domain', 'imports'],
      notes: 'Personal memory and knowledge should stay source-bound and privacy-aware.',
    },
    {
      id: 'workspace.organization',
      label: 'Organization Workspace',
      category: 'organization',
      status: state?.org?.connected ? 'ready' : 'available',
      actions: ['open_organization_workspace'],
      surfaces: ['organization hub', 'legal hub', 'templates', 'audit', 'knowledge base'],
      diagnostics: state?.org?.connected
        ? [`connected=${state.org.name || state.org.id || 'organization'}`, `role=${state.org.role || 'member'}`]
        : ['No active organization in current client state.'],
      notes: 'Organization work is available from the desktop client and should not be hidden from Lumi.',
    },
    {
      id: 'workspace.skills_mcp',
      label: 'Skills and MCP Runtime',
      category: 'ai',
      status: skillStats.unhealthy || skillStats.broken
        ? 'attention'
        : skillStats.connected > 0 || skillStats.total > 0
          ? 'ready'
          : 'requires_setup',
      actions: ['open_skills', 'client_health_check', 'client_repair_skill'],
      surfaces: ['skill hall', 'MCP servers', 'GitHub MCP discovery'],
      requiresConfirmation: true,
      setup: skillStats.total ? [] : ['Install or enable skills/MCP servers in the Skill Hall.'],
      diagnostics: [
        `skills=${skillStats.total}`,
        `enabled=${skillStats.enabled}`,
        `connected=${skillStats.connected}`,
        skillStats.broken ? `broken=${skillStats.broken}` : '',
        skillStats.unhealthy ? `unhealthy=${skillStats.unhealthy}` : '',
        skillStats.issueNames.length ? `issues=${skillStats.issueNames.slice(0, 5).join(', ')}` : '',
      ].filter(Boolean),
      notes: 'Skills are Lumi expansion points. Repair/install actions need confirmation.',
    },
    {
      id: 'workspace.files',
      label: 'Native Files',
      category: 'files',
      status: state?.files?.error ? 'degraded' : 'ready',
      actions: ['open_files', 'desktop_list_files', 'read_file', 'search_files'],
      surfaces: ['Files window', 'native file picker', 'knowledge import'],
      diagnostics: [
        state?.files?.currentPath ? `path=${state.files.currentPath}` : '',
        state?.files?.itemCount != null ? `items=${state.files.itemCount}` : '',
        state?.files?.error ? `error=${state.files.error}` : '',
      ].filter(Boolean),
      notes: 'Use native file APIs for file work. Ask before writing or deleting user files.',
    },
    {
      id: 'media.music_netease',
      label: 'Music Center and NetEase Playback',
      category: 'media',
      status: state?.music?.lastError ? 'attention' : state?.music?.source || state?.music?.trackName ? 'ready' : 'available',
      actions: ['open_music_center', 'show_music_layer', 'hide_music_layer', 'music_search', 'music_play'],
      surfaces: ['music center', 'mood layer', 'voice coexistence'],
      setup: state?.music?.lastError ? ['Check NetEase login/session, API credentials, and local player readiness in Music Center.'] : [],
      diagnostics: [
        state?.music?.isPlaying ? 'playing=true' : 'playing=false',
        state?.music?.trackName ? `track=${state.music.trackName}` : '',
        state?.music?.source ? `source=${state.music.source}` : '',
        state?.music?.lastError ? `error=${state.music.lastError}` : '',
      ].filter(Boolean),
      notes: 'Music can run alongside chat, voice, meeting, canvas, and mood layer.',
    },
    {
      id: 'media.voice',
      label: 'Voice, Wake Word, STT and TTS',
      category: 'media',
      status: state?.voice?.state === 'error' ? 'attention' : 'available',
      actions: ['open_settings(section=voice)', 'start_meeting_mode', 'end_meeting_mode'],
      surfaces: ['voice chat', 'meeting mode', 'voice services settings'],
      setup: ['Configure wake word, speech-to-text, and text-to-speech providers in Voice Services.'],
      diagnostics: [
        state?.voice?.state ? `voice=${state.voice.state}` : '',
        state?.voice?.muted ? 'muted=true' : '',
      ].filter(Boolean),
      notes: 'Voice provider choices should be respected exactly. Do not use LLM providers as hidden fallbacks for voice.',
    },
    {
      id: 'meeting.transcription_report',
      label: 'Meeting Capture and Report',
      category: 'workspace',
      status: state?.meeting?.active ? 'ready' : 'available',
      actions: ['start_meeting_mode', 'end_meeting_mode', 'open_meeting_notes'],
      surfaces: ['meeting mode', 'notes', 'report'],
      requiresConfirmation: true,
      diagnostics: [
        state?.meeting?.active ? 'active=true' : 'active=false',
        state?.meeting?.noteCount != null ? `notes=${state.meeting.noteCount}` : '',
        state?.meeting?.hasReport ? 'report=true' : '',
      ].filter(Boolean),
      notes: 'Meeting capture should be explicit and ends with an organized report when requested.',
    },
    {
      id: 'automation.autonomy_workflows',
      label: 'Always Online and Autonomous Workflows',
      category: 'automation',
      status: gate.alwaysOnline ? (gate.autoProcessEnabled ? 'ready' : 'available') : 'blocked',
      actions: ['open_plans', 'open_work_queue', 'autonomy_get_policy', 'autonomy_register_workflow'],
      surfaces: ['Plans', 'work queue', 'autonomy settings'],
      requiresConfirmation: true,
      diagnostics: [
        `alwaysOnline=${gate.alwaysOnline}`,
        `autoProcess=${gate.autoProcessEnabled}`,
        `maxConsecutiveTasks=${gate.maxConsecutiveTasks}`,
      ],
      notes: 'Autonomous work needs an explicit workflow agreement. It is not ambient unlimited control.',
    },
    {
      id: 'automation.computer_use',
      label: 'Desktop Computer Use',
      category: 'automation',
      status: gate.externalAppAutomationEnabled ? 'available' : 'blocked',
      actions: ['computer_use', 'desktop_open', 'desktop_clipboard_write'],
      surfaces: ['desktop apps', 'browser UI', 'CAD/Revit UI', 'messaging UI'],
      requiresConfirmation: true,
      setup: gate.externalAppAutomationEnabled ? [] : ['Enable external app automation in Settings > Autonomy before controlling external applications.'],
      safety: 'Prefer explicit adapters and files first. Use mouse/keyboard only after confirmation and with visible progress.',
      notes: 'This is Lumi using the computer, not the default route for Lumi client UI.',
    },
    {
      id: 'web.browser',
      label: 'Browser and Web Work',
      category: 'web',
      status: 'ready',
      actions: ['browser_open_task', 'web_search', 'url_fetch'],
      surfaces: ['browser', 'web search', 'URL fetch'],
      requiresConfirmation: true,
      safety: 'Opening and reading is allowed when tools permit; posts, purchases, submissions, and account actions require confirmation.',
      notes: 'Use for research and handoff to browser tasks.',
    },
    {
      id: 'messaging.wechat_feishu',
      label: 'WeChat, Feishu, and Remote Messaging',
      category: 'messaging',
      status: 'draft_only',
      actions: ['wechat_prepare_reply', 'wechat_copy_reply_draft'],
      surfaces: ['WeChat', 'Feishu bot/remote channel', 'clipboard drafts'],
      requiresConfirmation: true,
      diagnostics: [`sendRequiresConfirmation=${gate.messagingSendRequiresConfirmation}`],
      safety: 'Lumi can draft and copy. Sending or external posting must stay user-confirmed.',
      notes: 'For a shared local Lumi, remote messages are routed into the same local agent unless a future multi-user router is added.',
    },
    {
      id: 'cad_bim.drafting',
      label: 'CAD Drafting and Floorplan Handoff',
      category: 'cad_bim',
      status: 'draft_only',
      actions: ['floorplan_extract_geometry', 'ocr_image_file', 'cad_generate_dxf'],
      surfaces: ['canvas', 'CAD handoff files', 'desktop CAD apps'],
      requiresConfirmation: true,
      safety: 'Generated DXF/IFC/BIM drafts are not production drawings until dimensions and standards are reviewed.',
      notes: 'Current stable path is file generation plus optional confirmed app opening. Direct AutoCAD/Revit UI control is possible later through computer-use and adapters.',
    },
    {
      id: 'cad_bim.ifc_revit',
      label: 'IFC and Revit Integration',
      category: 'cad_bim',
      status: 'planned',
      actions: ['capability_research', 'open_skills'],
      surfaces: ['Revit import', 'IFC handoff', 'Dynamo script handoff'],
      requiresConfirmation: true,
      setup: ['Add a safe IFC generator or Dynamo/Revit adapter before claiming native RVT production output.'],
      notes: 'Next robust path: generate IFC or Dynamo scripts before direct RVT automation.',
    },
    {
      id: 'ai.external_agents',
      label: 'External AI and Agent Tools',
      category: 'ai',
      status: skillStats.connected > 0 ? 'available' : 'requires_setup',
      actions: ['external_app_list_adapters', 'adapter_registry_list', 'capability_research', 'computer_use'],
      surfaces: ['MCP', 'browser', 'files', 'clipboard', 'local AI apps'],
      requiresConfirmation: true,
      setup: skillStats.connected > 0 ? [] : ['Connect a specific AI app, MCP server, browser account, or file workflow before delegating real work.'],
      notes: 'Lumi can research and draft adapters. Installing or running third-party code requires confirmation.',
    },
    {
      id: 'collaboration.lap',
      label: 'LAP Inter-Lumi Collaboration',
      category: 'collaboration',
      status: 'available',
      actions: ['lap.handshake', 'lap.task.delegate', 'lap.task.result', 'lap.context.share', 'lap.revoke'],
      surfaces: ['community Lumi', 'organization Lumi', 'remote peers'],
      requiresConfirmation: true,
      safety: 'External Lumi context is external by default and cannot mutate local memory/core identity without approval.',
      notes: 'Use LAP for future Lumi-to-Lumi cooperation with source and consent boundaries.',
    },
    {
      id: 'system.sleep_dream',
      label: 'Sleep and Dream Memory Cycle',
      category: 'system',
      status: 'ready',
      actions: ['lumi_sleep_status', 'lumi_sleep_cycle'],
      surfaces: ['memory consolidation', 'rest cycle', 'always-online idle time'],
      notes: 'Dreaming consolidates memory and uncertainty without deleting originals or changing core identity.',
    },
    {
      id: 'system.settings_permissions',
      label: 'Settings, Providers, and Permissions',
      category: 'system',
      status: 'ready',
      actions: ['open_settings', 'open_settings(section=llm)', 'open_settings(section=voice)', 'open_settings(section=vision)'],
      surfaces: ['Settings', 'LLM providers', 'Vision Services', 'Voice Services', 'Autonomy'],
      diagnostics: [
        state?.permissions ? `permissions=${Object.keys(state.permissions).length}` : 'permissions=unknown',
        gate.externalAppAutomationEnabled ? 'externalAutomation=true' : 'externalAutomation=false',
      ],
      notes: 'Provider selection is authoritative. Fallbacks should be visible and user-informed, not silent.',
    },
  ];

  const visibleAdapters = options.includePlanned === false
    ? adapters.filter(adapter => adapter.status !== 'planned')
    : adapters;

  return {
    generatedAt: new Date().toISOString(),
    userId,
    stateAgeSeconds,
    summary: summarizeAdapters(visibleAdapters),
    adapters: visibleAdapters,
  };
}

export function getAdapterById(id: string, options: AdapterRegistryOptions = {}): AdapterCapability | null {
  const report = getAdapterRegistry(options);
  return report.adapters.find(adapter => adapter.id === id) || null;
}

export function summarizeAdapters(adapters: AdapterCapability[]): AdapterRegistrySummary {
  const byStatus = Object.fromEntries(STATUS_ORDER.map(status => [status, 0])) as Record<AdapterStatus, number>;
  const byCategory = Object.fromEntries(CATEGORY_ORDER.map(category => [category, 0])) as Record<AdapterCategory, number>;

  for (const adapter of adapters) {
    byStatus[adapter.status] += 1;
    byCategory[adapter.category] += 1;
  }

  return {
    total: adapters.length,
    byStatus,
    byCategory,
    readyCount: byStatus.ready + byStatus.available + byStatus.draft_only,
    setupRequiredCount: byStatus.requires_setup + byStatus.blocked,
    attentionCount: byStatus.attention + byStatus.degraded,
    plannedCount: byStatus.planned,
  };
}

function getStateAgeSeconds(state: Record<string, any> | null): number | null {
  const updatedAt = Number(state?.updatedAt || 0);
  if (!updatedAt) return null;
  return Math.max(0, Math.round((Date.now() - updatedAt) / 1000));
}

function getSkillStats(): SkillStats {
  try {
    const config = mcpManager.getConfig();
    const local = mcpManager.listLocalSkills();
    const connected = mcpManager.getConnectedServers();
    const health = mcpManager.getServerHealth();
    const enabled = Object.values(config).filter((item: any) => item?.enabled).length;
    const brokenSkills = local.filter((skill: any) => skill?.broken);
    const unhealthyNames = Object.entries(health)
      .filter(([, item]) => ['crashed', 'failed', 'restarting'].includes(item.status))
      .map(([name]) => name);
    const issueNames = Array.from(new Set([
      ...brokenSkills.map((skill: any) => String(skill.name || 'unknown')),
      ...unhealthyNames,
    ])).filter(Boolean);

    return {
      total: local.length,
      connected: connected.length,
      enabled,
      broken: brokenSkills.length,
      unhealthy: unhealthyNames.length,
      connectedNames: connected,
      issueNames,
    };
  } catch (error: any) {
    return {
      total: 0,
      connected: 0,
      enabled: 0,
      broken: 0,
      unhealthy: 1,
      connectedNames: [],
      issueNames: [String(error?.message || error || 'mcp inspection failed')],
    };
  }
}
