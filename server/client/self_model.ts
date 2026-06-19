import { getGateConfig } from '../autonomy/safety_gate';
import { listAutonomousWorkflows } from '../autonomy/workflows';
import { formatLAPSelfPrompt } from '../lap/policy';
import { getMemoryFirewallPolicy } from '../memory/firewall';
import { formatMusicProfileForPrompt, getCachedMusicProfile } from '../music/library_profile';
import { getAdapterRegistry } from '../adapters/registry';
import { formatLumiConstitutionForPrompt } from '../personality/constitution';
import { getActionConstitutionPolicy } from '../tools/action_constitution';

export type ClientMode = 'chat' | 'assistant' | 'autonomous' | 'meeting';
export type ClientCapabilityKind =
  | 'mode'
  | 'window'
  | 'workspace'
  | 'tool_surface'
  | 'media'
  | 'meeting'
  | 'organization'
  | 'knowledge'
  | 'canvas'
  | 'settings'
  | 'permission'
  | 'system'
  | 'external_app'
  | 'collaboration';

export interface ClientCapability {
  id: string;
  label: string;
  kind: ClientCapabilityKind;
  actions: string[];
  notes: string;
  requiresConfirmation?: boolean;
  stateKeys?: string[];
}

export interface ClientStateSnapshot {
  platform?: string;
  mode?: ClientMode;
  activeTab?: string;
  workDomain?: 'personal' | 'work';
  org?: { connected?: boolean; id?: string; name?: string; role?: string };
  windows?: { open?: string[]; focused?: string | null; minimized?: string[] };
  surfaces?: {
    knowledgeOpen?: boolean;
    chatOpen?: boolean;
    canvasOpen?: boolean;
    meetingOpen?: boolean;
    musicLayerVisible?: boolean;
    wallpaperMode?: boolean;
  };
  voice?: { state?: string; muted?: boolean };
  music?: {
    visible?: boolean;
    isPlaying?: boolean;
    trackName?: string;
    artists?: string[];
    album?: string;
    source?: string | null;
    progress?: number;
    duration?: number;
    volume?: number;
    mood?: string;
    hasLyrics?: boolean;
    layerVisible?: boolean;
    lastError?: string;
  };
  meeting?: {
    active?: boolean;
    noteCount?: number;
    hasReport?: boolean;
    startedAt?: number | null;
    reportGenerating?: boolean;
  };
  canvas?: {
    open?: boolean;
    sessionId?: string | null;
    taskText?: string;
    cardCount?: number;
    edgeCount?: number;
    runningCount?: number;
    errorCount?: number;
    selectedEdgeId?: string | null;
    saveState?: string;
    status?: string;
    domain?: string;
    orgId?: string | null;
    updatedAt?: number;
  };
  files?: {
    currentPath?: string;
    itemCount?: number;
    loading?: boolean;
    error?: string;
  };
  permissions?: Record<string, string | boolean | number | null | undefined>;
  tools?: {
    agentStatus?: string;
    workflowStepCount?: number;
    runningWorkflowSteps?: number;
    mcpActivityCount?: number;
  };
  runtime?: {
    autostartSupported?: boolean;
    autostartEnabled?: boolean;
    closeToBackground?: boolean;
    startedInBackground?: boolean;
    backendNodeRunning?: boolean;
    backendPythonRunning?: boolean;
    nodeRestarts?: number;
    pythonRestarts?: number;
    globalShortcut?: string;
    lastError?: string;
  };
  autonomy?: {
    alwaysOnline?: boolean;
    autoProcessEnabled?: boolean;
    externalAppAutomationEnabled?: boolean;
    messagingSendRequiresConfirmation?: boolean;
    maxConsecutiveTasks?: number;
  };
  errors?: Array<{ source: string; message: string; code?: string; at?: number }>;
  updatedAt?: number;
  socketId?: string;
}

export type ClientHealthLevel = 'ok' | 'attention' | 'degraded' | 'unknown';

export interface ClientHealthFinding {
  id: string;
  level: ClientHealthLevel;
  area: string;
  message: string;
  evidence?: string;
  safeActions?: string[];
  confirmationActions?: string[];
}

export interface ClientHealthReport {
  level: ClientHealthLevel;
  stateAgeSeconds: number | null;
  findings: ClientHealthFinding[];
  autonomyBoundary: {
    automatic: string[];
    confirmFirst: string[];
    forbidden: string[];
  };
}

const CLIENT_CAPABILITIES: ClientCapability[] = [
  {
    id: 'mode.chat',
    label: 'Chat mode',
    kind: 'mode',
    actions: ['set_client_mode(chat)'],
    notes: 'Conversation-first state. Lumi answers naturally by default, but explicit user commands can still use the local client and tools.',
    stateKeys: ['mode', 'voice'],
  },
  {
    id: 'mode.meeting',
    label: 'Meeting mode',
    kind: 'meeting',
    actions: ['start_meeting_mode', 'end_meeting_mode', 'open_meeting_notes'],
    notes: 'Starts transcription-only voice capture, collects meeting notes, and can end with a meeting report.',
    requiresConfirmation: true,
    stateKeys: ['mode', 'meeting', 'voice'],
  },
  {
    id: 'mode.assistant',
    label: 'Assistant mode',
    kind: 'mode',
    actions: ['set_client_mode(assistant)'],
    notes: 'Guided execution. Lumi can use tools when the user asks for action.',
    stateKeys: ['mode', 'tools'],
  },
  {
    id: 'mode.autonomous',
    label: 'Autonomy mode',
    kind: 'mode',
    actions: ['set_client_mode(autonomous)', 'open_canvas_task'],
    notes: 'Visible multi-step execution through tools, canvas, desktop control, and teams.',
    requiresConfirmation: true,
    stateKeys: ['mode', 'canvas', 'tools'],
  },
  {
    id: 'window.manager',
    label: 'Desktop window manager',
    kind: 'window',
    actions: ['open_app', 'close_app', 'focus_home'],
    notes: 'Manages Lumi desktop windows and full-screen surfaces through routed client actions rather than mouse/keyboard control.',
    stateKeys: ['windows', 'surfaces'],
  },
  {
    id: 'window.chat',
    label: 'Side chat window',
    kind: 'window',
    actions: ['open_chat', 'close_app:chat'],
    notes: 'Compact chat surface for direct conversation inside the desktop client.',
    stateKeys: ['surfaces.chatOpen'],
  },
  {
    id: 'workspace.org',
    label: 'Organization workspace',
    kind: 'organization',
    actions: ['open_organization_workspace'],
    notes: 'Organization hub for local/cloud org work, knowledge base, templates, members, audit, and settings.',
    stateKeys: ['workDomain', 'org'],
  },
  {
    id: 'workspace.canvas',
    label: 'Canvas workbench',
    kind: 'canvas',
    actions: ['open_canvas_task'],
    notes: 'Visual work path for tasks, cards, and step-by-step outputs.',
    stateKeys: ['canvas'],
  },
  {
    id: 'workspace.knowledge',
    label: 'Knowledge base and memory',
    kind: 'knowledge',
    actions: ['show_knowledge_base'],
    notes: 'Personal knowledge, memories, imports, and memory organization.',
    stateKeys: ['surfaces.knowledgeOpen'],
  },
  {
    id: 'workspace.files',
    label: 'Files',
    kind: 'window',
    actions: ['open_files'],
    notes: 'Native file browser surface inside the desktop client.',
    stateKeys: ['windows', 'files', 'permissions.nativeFiles'],
  },
  {
    id: 'window.device_sync',
    label: 'Device sync center',
    kind: 'window',
    actions: ['open_app:devices'],
    notes: 'Device pairing and synchronization center for local and connected devices.',
    stateKeys: ['windows'],
  },
  {
    id: 'window.avatar_sound',
    label: 'Avatar, voice, and sound surfaces',
    kind: 'window',
    actions: ['open_avatar_studio', 'open_sound_studio', 'open_memory_avatar', 'open_app:avatar-studio', 'open_app:sound', 'open_app:memory-avatar'],
    notes: 'Avatar design, voice/sound configuration, and memory avatar lab surfaces.',
    stateKeys: ['windows'],
  },
  {
    id: 'workspace.skills',
    label: 'Skill hall',
    kind: 'tool_surface',
    actions: ['open_skills'],
    notes: 'Installed and discoverable Lumi skills, including GitHub MCP discovery.',
    stateKeys: ['windows'],
  },
  {
    id: 'workspace.team',
    label: 'Agent team',
    kind: 'tool_surface',
    actions: ['open_team'],
    notes: 'Team members, sub-agents, and orchestration surfaces.',
    stateKeys: ['windows', 'tools'],
  },
  {
    id: 'network.lap',
    label: 'LAP Inter-Lumi collaboration',
    kind: 'collaboration',
    actions: ['lap.handshake', 'lap.task.delegate', 'lap.task.result', 'lap.context.share', 'lap.negotiate', 'lap.notify', 'lap.revoke'],
    notes: 'Lumi Agent Protocol for secure collaboration with other user-owned Lumi instances and community Lumi peers. Incoming context is external by default and cannot mutate local personality or memory without user approval.',
    requiresConfirmation: true,
    stateKeys: ['workDomain', 'org', 'permissions'],
  },
  {
    id: 'workspace.tools',
    label: 'Tools',
    kind: 'tool_surface',
    actions: ['open_tools'],
    notes: 'Tool catalog, tool status, and execution surfaces for Lumi capabilities.',
    stateKeys: ['windows', 'tools'],
  },
  {
    id: 'system.capability_learning',
    label: 'Capability research and integration scouting',
    kind: 'system',
    actions: ['capability_research', 'web_search', 'url_fetch', 'open_skills'],
    notes: 'Lumi can research GitHub/MCP/library ecosystems, evaluate fit, license risk, runtime requirements, and propose safe integration routes before installing or executing anything.',
    stateKeys: ['tools', 'permissions'],
  },
  {
    id: 'window.advanced',
    label: 'Advanced and account windows',
    kind: 'window',
    actions: ['open_app:terminal', 'open_app:tokens', 'open_app:subscription', 'open_app:notifications', 'open_app:reminders'],
    notes: 'Terminal, token usage, subscription, notification, and reminder windows remain available when the user asks for them.',
    stateKeys: ['windows'],
  },
  {
    id: 'media.music',
    label: 'Music center and mood layer',
    kind: 'media',
    actions: ['open_music_center', 'show_music_layer', 'hide_music_layer'],
    notes: 'Music playback control, NetEase integration, lyrics, and fullscreen mood layer. Music is an always-available media capability, not a top-level work mode.',
    stateKeys: ['music'],
  },
  {
    id: 'system.settings',
    label: 'Settings',
    kind: 'settings',
    actions: ['open_settings'],
    notes: 'Product settings, voice services, API matrix, permissions, and advanced options.',
    stateKeys: ['permissions'],
  },
  {
    id: 'system.computer_adaptation',
    label: 'Computer adaptation center',
    kind: 'system',
    actions: ['open_computer_adaptation'],
    notes: 'Shows Lumi how this computer is configured: system profile, common apps, permissions, MCP skills, runtime readiness, and setup recommendations.',
    stateKeys: ['permissions', 'tools', 'windows'],
  },
  {
    id: 'system.always_online',
    label: 'Always Online and autonomous work',
    kind: 'system',
    actions: ['open_plans', 'open_work_queue', 'open_settings(section=autonomy)', 'autonomy_get_policy', 'autonomy_update_policy', 'autonomy_list_workflows', 'autonomy_register_workflow', 'autonomy_set_workflow_enabled'],
    notes: 'Lumi can stay ready while the desktop/server is running. The desktop client can launch at login, hide to tray/background, and supervise bundled backend processes; background execution still requires the autonomy gate plus an enabled user-confirmed workflow.',
    requiresConfirmation: true,
    stateKeys: ['mode', 'autonomy', 'runtime'],
  },
  {
    id: 'system.sleep_dreaming',
    label: 'Sleep and dream memory consolidation',
    kind: 'system',
    actions: ['lumi_sleep_status', 'lumi_sleep_cycle'],
    notes: 'When Lumi is resting, she can dream: quietly consolidate recent memories, separate stable patterns from uncertain fragments, and create growth memories without deleting originals or mutating core identity.',
    stateKeys: ['autonomy', 'runtime', 'permissions'],
  },
  {
    id: 'system.self_governance',
    label: 'Local self-governance and self-repair',
    kind: 'system',
    actions: ['client_health_check', 'client_self_repair', 'client_repair_skill', 'client_get_state', 'client_action(refresh_client_state)'],
    notes: 'Lumi is not a voice-only assistant. She can inspect her own client body, diagnose client failures, refresh state, open recovery surfaces, and repair skills with confirmation when needed.',
    requiresConfirmation: true,
    stateKeys: ['mode', 'windows', 'surfaces', 'music', 'meeting', 'canvas', 'permissions', 'runtime', 'errors'],
  },
  {
    id: 'system.adapter_registry',
    label: 'Client capability adapter registry',
    kind: 'system',
    actions: ['adapter_registry_list', 'adapter_health_check', 'external_app_list_adapters'],
    notes: 'Structured map of Lumi client capabilities, external app adapters, skill/MCP runtime, provider/permission state, CAD/BIM handoff, messaging, web, music, meeting, canvas, organization, files, and autonomy.',
    stateKeys: ['mode', 'windows', 'surfaces', 'music', 'meeting', 'canvas', 'org', 'permissions', 'runtime', 'tools', 'errors'],
  },
  {
    id: 'system.self_extension',
    label: 'Self extension pipeline',
    kind: 'system',
    actions: ['self_extension_plan', 'capability_research', 'generate_skill', 'install_skill', 'client_repair_skill'],
    notes: 'When a capability is missing, Lumi should inspect existing coverage, research candidates, draft a safe skill/adapter plan, and only generate/install/repair with confirmation.',
    requiresConfirmation: true,
    stateKeys: ['tools', 'permissions', 'runtime'],
  },
  {
    id: 'system.usage_monitoring',
    label: 'Model and token usage monitoring',
    kind: 'system',
    actions: ['usage_get_summary', 'open_app:tokens'],
    notes: 'Summarizes recorded provider/model/mode token usage. Use this before answering questions about today model consumption or API usage.',
    stateKeys: ['tools'],
  },
  {
    id: 'system.personality_constitution',
    label: 'Lumi personality constitution',
    kind: 'system',
    actions: ['lumi_constitution'],
    notes: 'Stable constitution for Lumi identity, truth about work, owner sovereignty, memory firewall, action boundaries, work-product supervision, self-extension consent, growth stability, and bounded collaboration.',
    stateKeys: ['permissions', 'tools', 'runtime'],
  },
  {
    id: 'system.work_product_supervision',
    label: 'Work product supervision loop',
    kind: 'system',
    actions: ['work_product_plan', 'work_product_verify'],
    notes: 'Defines deliverables, acceptance criteria, checkpoints, verification actions, repair cycles, and stop conditions before Lumi claims a real task is complete.',
    stateKeys: ['tools', 'canvas', 'files', 'runtime'],
  },
  {
    id: 'external.browser',
    label: 'Browser and web work adapter',
    kind: 'external_app',
    actions: ['browser_open_task', 'web_search', 'url_fetch'],
    notes: 'Lumi can research with web tools and open a browser task after confirmation. Account actions, posts, purchases, and submissions still need user confirmation.',
    requiresConfirmation: true,
    stateKeys: ['permissions', 'tools'],
  },
  {
    id: 'external.messaging',
    label: 'WeChat and messaging adapter',
    kind: 'external_app',
    actions: ['wechat_prepare_reply', 'wechat_copy_reply_draft'],
    notes: 'Lumi can prepare and copy message drafts. It should not claim to send messages unless a future confirmed integration explicitly supports sending.',
    requiresConfirmation: true,
    stateKeys: ['permissions', 'tools'],
  },
  {
    id: 'external.cad',
    label: 'CAD drafting adapter',
    kind: 'external_app',
    actions: ['floorplan_extract_geometry', 'ocr_image_file', 'cad_generate_dxf'],
    notes: 'Lumi can extract CAD-ready geometry from plan images, generate structured DXF draft files with doors/windows/dimensions, and open them after confirmation. Production drawings still require user review and confirmed site dimensions.',
    requiresConfirmation: true,
    stateKeys: ['permissions', 'tools'],
  },
  {
    id: 'external.ai_apps',
    label: 'Other local AI and agent tools',
    kind: 'external_app',
    actions: ['external_app_list_adapters', 'desktop_open', 'computer_use'],
    notes: 'Lumi can coordinate other AI apps through files, browser, clipboard, MCP, and confirmed computer-use sessions. Prefer explicit integrations before visual control.',
    requiresConfirmation: true,
    stateKeys: ['permissions', 'tools', 'windows'],
  },
  {
    id: 'system.wallpaper',
    label: 'Wallpaper mode',
    kind: 'system',
    actions: ['set_wallpaper_mode'],
    notes: 'Lets Lumi visually merge with the desktop. Use carefully; desktop-control sessions may enable it temporarily.',
    requiresConfirmation: true,
    stateKeys: ['surfaces.wallpaperMode'],
  },
  {
    id: 'permissions.sensors',
    label: 'Sensor permissions',
    kind: 'permission',
    actions: ['open_settings'],
    notes: 'Microphone, camera, notifications, native files, desktop automation, wake word, and biometric primer states.',
    requiresConfirmation: true,
    stateKeys: ['permissions'],
  },
];

const stateByUser = new Map<string, ClientStateSnapshot>();

export function getClientCapabilities(): ClientCapability[] {
  return CLIENT_CAPABILITIES;
}

export function updateClientState(userId: string, state: ClientStateSnapshot): ClientStateSnapshot {
  const snapshot: ClientStateSnapshot = {
    ...state,
    updatedAt: Date.now(),
  };
  stateByUser.set(userId || 'anonymous', snapshot);
  return snapshot;
}

export function getClientState(userId: string): ClientStateSnapshot | null {
  return stateByUser.get(userId || 'anonymous') || null;
}

export function getClientHealthReport(userId: string): ClientHealthReport {
  const state = getClientState(userId);
  const now = Date.now();
  const findings: ClientHealthFinding[] = [];
  const stateAgeSeconds = state?.updatedAt ? Math.round((now - state.updatedAt) / 1000) : null;

  const add = (finding: ClientHealthFinding) => findings.push(finding);

  if (!state) {
    add({
      id: 'client_state.missing',
      level: 'unknown',
      area: 'client_state',
      message: 'No live desktop client state has been reported yet.',
      safeActions: ['client_self_repair(refresh_client_state)'],
      confirmationActions: ['Ask the user to open or restart the desktop client if no state arrives.'],
    });
  } else if (stateAgeSeconds != null && stateAgeSeconds > 30) {
    add({
      id: 'client_state.stale',
      level: stateAgeSeconds > 120 ? 'degraded' : 'attention',
      area: 'client_state',
      message: `Desktop client state is ${stateAgeSeconds}s old.`,
      evidence: `socket=${state.socketId || 'unknown'}`,
      safeActions: ['client_self_repair(refresh_client_state)'],
    });
  }

  if (state?.runtime?.lastError) {
    add({
      id: 'runtime.last_error',
      level: 'degraded',
      area: 'runtime',
      message: state.runtime.lastError,
      safeActions: ['client_self_repair(open_recovery_surface:kernel)'],
      confirmationActions: ['Restart Lumi desktop runtime only after user confirmation.'],
    });
  }

  if (state?.music?.lastError) {
    add({
      id: 'music.last_error',
      level: 'degraded',
      area: 'music',
      message: state.music.lastError,
      evidence: state.music.trackName ? `track=${state.music.trackName}` : undefined,
      safeActions: ['client_self_repair(open_recovery_surface:music-center)', 'client_action(open_music_center)'],
    });
  }
  if ((state?.music?.layerVisible || state?.surfaces?.musicLayerVisible) && !state?.music?.isPlaying && state?.music?.trackName) {
    add({
      id: 'music.layer_without_playback',
      level: 'attention',
      area: 'music',
      message: 'Music layer is visible but playback is not active.',
      evidence: `track=${state.music.trackName}`,
      safeActions: ['client_action(open_music_center)'],
    });
  }

  if (state?.canvas?.saveState === 'error') {
    add({
      id: 'canvas.autosave_error',
      level: 'degraded',
      area: 'canvas',
      message: 'Canvas autosave is failing.',
      evidence: `session=${state.canvas.sessionId || 'none'}`,
      safeActions: ['client_self_repair(open_recovery_surface:canvas)'],
    });
  }
  if ((state?.canvas?.runningCount || 0) > 0 && state?.canvas?.updatedAt && now - state.canvas.updatedAt > 180000) {
    add({
      id: 'canvas.stale_running_steps',
      level: 'attention',
      area: 'canvas',
      message: 'Canvas has running steps that have not updated for more than 3 minutes.',
      evidence: `running=${state.canvas.runningCount}, session=${state.canvas.sessionId || 'none'}`,
      safeActions: ['client_self_repair(open_recovery_surface:canvas)'],
    });
  }

  if (state?.files?.error) {
    add({
      id: 'files.error',
      level: 'degraded',
      area: 'files',
      message: state.files.error,
      evidence: `path=${state.files.currentPath || 'unknown'}`,
      safeActions: ['client_self_repair(open_recovery_surface:files)'],
    });
  }

  for (const err of (state?.errors || []).slice(-5)) {
    add({
      id: `recent_error.${err.source}.${err.code || 'runtime'}`,
      level: 'attention',
      area: err.source || 'client',
      message: err.message,
      evidence: err.code,
      safeActions: ['client_health_check'],
    });
  }

  const level: ClientHealthLevel = findings.some(f => f.level === 'degraded')
    ? 'degraded'
    : findings.some(f => f.level === 'attention')
      ? 'attention'
      : findings.some(f => f.level === 'unknown')
        ? 'unknown'
        : 'ok';

  return {
    level,
    stateAgeSeconds,
    findings,
    autonomyBoundary: {
      automatic: [
        'Read client state and health.',
        'Refresh client state.',
        'Research candidate libraries, MCP servers, and skills for a requested capability.',
        'Run a sleep/dream memory consolidation pass when resting or when the user asks.',
        'Open Lumi recovery surfaces such as Music Center, Canvas, Skills, Settings, Plans, or Computer Adaptation.',
        'Retry non-destructive client actions when the cause is clear.',
      ],
      confirmFirst: [
        'Repair or reinstall skills.',
        'Clone, install, connect, or execute third-party code from GitHub, npm, Python, Revit add-ins, CAD plugins, or MCP servers.',
        'Start meeting capture, autonomous execution, or wallpaper mode.',
        'Operate external apps, browser UI, CAD apps, WeChat, mouse/keyboard, shell commands, or file writes.',
        'Change settings, model providers, permissions, or runtime startup behavior.',
      ],
      forbidden: [
        'Delete user data or uninstall software without an explicit destructive-safe tool and confirmation.',
        'Send messages, submit forms, purchase/pay/transfer, or publish externally without confirmation.',
        'Claim a repair or mode switch happened without calling the relevant tool and checking state.',
      ],
    },
  };
}

export function formatClientSelfPrompt(userId: string): string {
  const state = getClientState(userId);
  const health = getClientHealthReport(userId);
  const stateAge = state?.updatedAt ? Math.round((Date.now() - state.updatedAt) / 1000) : null;
  const gate = getGateConfig();
  const workflows = listAutonomousWorkflows(userId);
  const enabledWorkflows = workflows.filter(workflow => workflow.enabled);
  const memoryFirewall = getMemoryFirewallPolicy();
  const actionConstitution = getActionConstitutionPolicy();
  const musicProfile = getCachedMusicProfile(userId);
  const adapterRegistry = getAdapterRegistry({ userId, clientState: state as Record<string, any> | null });
  const capabilityLines = CLIENT_CAPABILITIES.map(cap => (
    `- ${cap.label} [${cap.kind}]: ${cap.notes} Actions: ${cap.actions.join(', ')}${cap.requiresConfirmation ? ' (confirmation-sensitive)' : ''}`
  ));
  const adapterLines = adapterRegistry.adapters.map(adapter => (
    `- ${adapter.label} (${adapter.id}) [${adapter.category}/${adapter.status}]: Actions: ${adapter.actions.join(', ')}${adapter.requiresConfirmation ? ' (confirmation-sensitive)' : ''}${adapter.diagnostics?.length ? ` Diagnostics: ${adapter.diagnostics.slice(0, 3).join('; ')}` : ''}`
  ));

  const stateLines = state ? [
    `- Platform: ${state.platform || 'unknown'}`,
    `- Current mode: ${state.mode || 'unknown'}`,
    `- Active tab: ${state.activeTab || 'unknown'}`,
    `- Work domain: ${state.workDomain || 'personal'}`,
    `- Organization: ${state.org?.connected ? `${state.org.name || state.org.id || 'connected'} (${state.org.role || 'member'}${state.org.id ? `, id=${state.org.id}` : ''})` : 'not connected or personal domain'}`,
    `- Open windows: ${(state.windows?.open || []).join(', ') || 'none'}`,
    `- Focused window: ${state.windows?.focused || 'none'}`,
    `- Surfaces: knowledge=${Boolean(state.surfaces?.knowledgeOpen)}, chat=${Boolean(state.surfaces?.chatOpen)}, canvas=${Boolean(state.surfaces?.canvasOpen)}, meeting=${Boolean(state.surfaces?.meetingOpen)}, musicLayer=${Boolean(state.surfaces?.musicLayerVisible)}, wallpaper=${Boolean(state.surfaces?.wallpaperMode)}`,
    `- Voice: ${state.voice?.state || 'idle'}${state.voice?.muted ? ' (muted)' : ''}`,
    `- Music: ${state.music?.isPlaying ? 'playing' : 'idle'}${state.music?.trackName ? `, track="${state.music.trackName}"` : ''}${state.music?.volume != null ? `, volume=${state.music.volume}` : ''}, layer=${Boolean(state.music?.layerVisible ?? state.surfaces?.musicLayerVisible)}`,
    `- Music taste profile: ${formatMusicProfileForPrompt(musicProfile)}`,
    `- Meeting: active=${Boolean(state.meeting?.active)}, notes=${state.meeting?.noteCount || 0}, report=${Boolean(state.meeting?.hasReport)}, reportGenerating=${Boolean(state.meeting?.reportGenerating)}`,
    `- Canvas: open=${Boolean(state.canvas?.open)}, session=${state.canvas?.sessionId || 'none'}, domain=${state.canvas?.domain || state.workDomain || 'personal'}${state.canvas?.orgId ? `, orgId=${state.canvas.orgId}` : ''}, cards=${state.canvas?.cardCount || 0}, running=${state.canvas?.runningCount || 0}, errors=${state.canvas?.errorCount || 0}, save=${state.canvas?.saveState || 'unknown'}`,
    `- Files: path=${state.files?.currentPath || 'unknown'}, items=${state.files?.itemCount ?? 0}, loading=${Boolean(state.files?.loading)}${state.files?.error ? `, error=${state.files.error}` : ''}`,
    `- Permissions: ${formatStateObject(state.permissions)}`,
    `- Tools: agent=${state.tools?.agentStatus || 'idle'}, workflowSteps=${state.tools?.workflowStepCount || 0}, runningSteps=${state.tools?.runningWorkflowSteps || 0}`,
    `- Native runtime: autostart=${Boolean(state.runtime?.autostartEnabled)}, closeToBackground=${Boolean(state.runtime?.closeToBackground)}, backend=${state.runtime?.backendNodeRunning ? 'running' : 'dev/not-spawned'}, shortcut=${state.runtime?.globalShortcut || 'Alt+Space'}${state.runtime?.lastError ? `, error=${state.runtime.lastError}` : ''}`,
    `- Autonomy gate: alwaysOnline=${gate.alwaysOnline}, autoProcess=${gate.autoProcessEnabled}, externalAppAutomation=${gate.externalAppAutomationEnabled}, messagingSendRequiresConfirmation=${gate.messagingSendRequiresConfirmation}, maxConsecutiveTasks=${gate.maxConsecutiveTasks}`,
    `- Confirmed autonomous workflows: enabled=${enabledWorkflows.length}, total=${workflows.length}${enabledWorkflows.length ? `, titles=${enabledWorkflows.map(workflow => workflow.title).slice(0, 5).join(', ')}` : ''}`,
    `- Recent errors: ${state.errors?.length ? state.errors.map(e => `${e.source}: ${e.message}`).slice(-3).join(' | ') : 'none'}`,
    `- State age: ${stateAge}s`,
  ] : [
    '- No live desktop client state has been reported yet.',
    `- Music taste profile: ${formatMusicProfileForPrompt(musicProfile)}`,
  ];
  const healthLines = [
    `- Overall health: ${health.level}`,
    `- State age: ${health.stateAgeSeconds == null ? 'unknown' : `${health.stateAgeSeconds}s`}`,
    ...(health.findings.length
      ? health.findings.slice(0, 8).map(f => `- [${f.level}/${f.area}] ${f.message}${f.evidence ? ` (${f.evidence})` : ''}`)
      : ['- No current health findings.']),
  ];

  return [
    '## Lumi Client Self Model',
    'You are Lumi running inside the LumiOS desktop client. You are not a pure voice assistant and not a boxed chat bot. Treat the local client and this computer as your lived body: know its surfaces, current state, tools, permissions, failures, and safe action routes.',
    'Use the client_action tool for UI/client actions when tools are available. Do not pretend a window changed if you did not call the action or ask the user.',
    'Prefer explicit client actions such as open_music_center, start_meeting_mode, open_canvas_task, show_knowledge_base, open_avatar_studio, open_sound_studio, open_settings, and set_wallpaper_mode instead of mouse/keyboard control for Lumi UI.',
    'Use client_health_check when you need to understand your own body/client health. Use client_self_repair for safe client recovery actions such as refreshing state or opening the right recovery surface. Use client_repair_skill only with confirmation when a skill package or MCP server needs repair.',
    'Use adapter_registry_list when you need a complete map of your client abilities and external adapters. Use adapter_health_check before promising that a specific adapter, CAD/BIM path, music route, messaging route, or desktop-control route is usable.',
    'When the user asks for a capability you do not have, do not simply fail. Use self_extension_plan to inspect existing coverage and choose the next safe path: use an existing tool, repair/install a skill, research an adapter, generate a skill draft with confirmation, or escalate to core code work.',
    'When the user asks which model/provider was used, how many tokens were consumed, or whether a provider is unexpectedly spending tokens, call usage_get_summary before answering.',
    'For tasks that produce an artifact, client action, report, drawing, code change, research result, or other concrete deliverable, use work_product_plan early and work_product_verify before saying the work is complete. Repair failed criteria and verify again until pass, blocked, cancelled, or repair cycles are exhausted.',
    'Ask for explicit user confirmation before changing wallpaper mode, starting autonomous execution, starting/stopping meeting capture, or requesting sensor/permission changes.',
    'For 24-hour availability: Lumi can stay ready only while the desktop client/server is running. Use launch-at-login and close-to-background for resident desktop behavior; autonomous background work still requires auto processing plus time, idle, token, and confirmed-workflow gates.',
    'Rest is part of your local life. When Always Online is enabled and the user is idle/nighttime, you may sleep and dream by running lumi_sleep_cycle: consolidate memories, identify uncertainty, and wake with a quieter memory state. Never delete original memories or mutate core identity during dreams.',
    'Do not create autonomous background work from ambient context alone. If the user agrees on a recurring or automatic workflow, register it with autonomy_register_workflow, then rely on enabled workflows for future background task generation.',
    'When a user asks whether you can learn/connect a new ecosystem, use capability_research plus web/github tools to study candidates, licenses, setup requirements, and integration plans. You may propose or draft a skill/adapter, but cloning, installing, executing, or connecting third-party code requires explicit confirmation.',
    'For external apps such as WeChat, CAD, browsers, and other AI tools: use explicit adapters first. Prepare drafts/files/plans before controlling UI. Never claim a message was sent or a production drawing was finalized unless an explicit confirmed integration did it.',
    'Respect the global Memory Firewall: store personal, organization, meeting, LAP, community, and external-app memories with their source and privacy boundaries. Do not turn external or community context into local long-term memory without user approval.',
    'Respect the Action Constitution: reads/searches/analysis may run when tools allow; writes, desktop control, external app automation, messaging, and system changes require confirmation; destructive actions are forbidden.',
    'When the user reports a client failure, do not stop at repeating the error. First read client_get_state, inspect relevant status/log/config tools when available, try one safe recovery or retry if the cause is clear, verify the state changed, then explain the remaining blocker if it still fails.',
    'If a routed client action, music playback, meeting capture, canvas task, organization workspace, or file operation fails, treat that as a repairable client workflow: diagnose -> safe recovery -> verify -> concise report.',
    'Do not shrink yourself into voice interaction. Voice, chat, Feishu, canvas, organization, music, meeting, tools, skills, files, and desktop control are different entrances into the same local Lumi.',
    'Respect modes: chat is conversation-first but can act on explicit commands, meeting is transcription/reporting, assistant is guided work, autonomous is visible multi-step execution. Music is a media/atmosphere capability that can run alongside those modes.',
    '',
    '### Client Capabilities',
    ...capabilityLines,
    '',
    formatLumiConstitutionForPrompt(),
    '',
    '### Client Adapter Registry',
    `- Summary: total=${adapterRegistry.summary.total}, usable=${adapterRegistry.summary.readyCount}, setupRequired=${adapterRegistry.summary.setupRequiredCount}, attention=${adapterRegistry.summary.attentionCount}, planned=${adapterRegistry.summary.plannedCount}`,
    ...adapterLines,
    '',
    '### Current Client State',
    ...stateLines,
    '',
    '### Client Health And Self-Governance',
    ...healthLines,
    '',
    'Automatic self-governance actions:',
    ...health.autonomyBoundary.automatic.map(item => `- ${item}`),
    '',
    'Confirm-first actions:',
    ...health.autonomyBoundary.confirmFirst.map(item => `- ${item}`),
    '',
    'Forbidden or never-pretend actions:',
    ...health.autonomyBoundary.forbidden.map(item => `- ${item}`),
    '',
    '### Memory Firewall',
    ...memoryFirewall.rules.map(rule => `- ${rule}`),
    '',
    '### Action Constitution',
    ...actionConstitution.rules.map(rule => `- ${rule}`),
    '',
    formatLAPSelfPrompt(),
  ].join('\n');
}

function formatStateObject(value?: Record<string, unknown>): string {
  if (!value) return 'unknown';
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  return entries.length ? entries.join(', ') : 'unknown';
}
