import { getGateConfig } from '../autonomy/safety_gate';
import { listAutonomousWorkflows } from '../autonomy/workflows';
import { formatLAPSelfPrompt } from '../lap/policy';
import { getMemoryFirewallPolicy } from '../memory/firewall';
import { getActionConstitutionPolicy } from '../tools/action_constitution';

export type ClientMode = 'chat' | 'assistant' | 'autonomous' | 'meeting' | 'music';
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
  org?: { connected?: boolean; name?: string; role?: string };
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
    updatedAt?: number;
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

const CLIENT_CAPABILITIES: ClientCapability[] = [
  {
    id: 'mode.chat',
    label: 'Chat mode',
    kind: 'mode',
    actions: ['set_client_mode(chat)'],
    notes: 'Conversation-only state. Lumi should answer naturally and avoid acting.',
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
    id: 'mode.music',
    label: 'Music mode',
    kind: 'mode',
    actions: ['set_client_mode(music)', 'open_music_center', 'show_music_layer', 'hide_music_layer'],
    notes: 'Music-focused state for playback, recommendations, lyrics, and mood layer. Switching mode does not auto-open the player.',
    stateKeys: ['mode', 'music'],
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
    label: 'Auto execute mode',
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
    stateKeys: ['windows', 'permissions.nativeFiles'],
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
    actions: ['open_app:avatar-studio', 'open_app:sound', 'open_app:memory-avatar'],
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
    notes: 'Music playback control, NetEase integration, lyrics, and fullscreen mood layer.',
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
    actions: ['open_settings:autonomy', 'autonomy_get_policy', 'autonomy_update_policy', 'autonomy_list_workflows', 'autonomy_register_workflow', 'autonomy_set_workflow_enabled'],
    notes: 'Lumi can stay ready while the desktop/server is running. The desktop client can launch at login, hide to tray/background, and supervise bundled backend processes; background execution still requires the autonomy gate plus an enabled user-confirmed workflow.',
    requiresConfirmation: true,
    stateKeys: ['mode', 'autonomy', 'runtime'],
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
    actions: ['cad_generate_dxf'],
    notes: 'Lumi can generate simple DXF draft files and open them after confirmation. Production drawings still require user review.',
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

export function formatClientSelfPrompt(userId: string): string {
  const state = getClientState(userId);
  const stateAge = state?.updatedAt ? Math.round((Date.now() - state.updatedAt) / 1000) : null;
  const gate = getGateConfig();
  const workflows = listAutonomousWorkflows(userId);
  const enabledWorkflows = workflows.filter(workflow => workflow.enabled);
  const memoryFirewall = getMemoryFirewallPolicy();
  const actionConstitution = getActionConstitutionPolicy();
  const capabilityLines = CLIENT_CAPABILITIES.map(cap => (
    `- ${cap.label} [${cap.kind}]: ${cap.notes} Actions: ${cap.actions.join(', ')}${cap.requiresConfirmation ? ' (confirmation-sensitive)' : ''}`
  ));

  const stateLines = state ? [
    `- Platform: ${state.platform || 'unknown'}`,
    `- Current mode: ${state.mode || 'unknown'}`,
    `- Active tab: ${state.activeTab || 'unknown'}`,
    `- Work domain: ${state.workDomain || 'personal'}`,
    `- Organization: ${state.org?.connected ? `${state.org.name || 'connected'} (${state.org.role || 'member'})` : 'not connected or personal domain'}`,
    `- Open windows: ${(state.windows?.open || []).join(', ') || 'none'}`,
    `- Focused window: ${state.windows?.focused || 'none'}`,
    `- Surfaces: knowledge=${Boolean(state.surfaces?.knowledgeOpen)}, chat=${Boolean(state.surfaces?.chatOpen)}, canvas=${Boolean(state.surfaces?.canvasOpen)}, meeting=${Boolean(state.surfaces?.meetingOpen)}, musicLayer=${Boolean(state.surfaces?.musicLayerVisible)}, wallpaper=${Boolean(state.surfaces?.wallpaperMode)}`,
    `- Voice: ${state.voice?.state || 'idle'}${state.voice?.muted ? ' (muted)' : ''}`,
    `- Music: ${state.music?.isPlaying ? 'playing' : 'idle'}${state.music?.trackName ? `, track="${state.music.trackName}"` : ''}${state.music?.volume != null ? `, volume=${state.music.volume}` : ''}, layer=${Boolean(state.music?.layerVisible ?? state.surfaces?.musicLayerVisible)}`,
    `- Meeting: active=${Boolean(state.meeting?.active)}, notes=${state.meeting?.noteCount || 0}, report=${Boolean(state.meeting?.hasReport)}, reportGenerating=${Boolean(state.meeting?.reportGenerating)}`,
    `- Canvas: open=${Boolean(state.canvas?.open)}, session=${state.canvas?.sessionId || 'none'}, cards=${state.canvas?.cardCount || 0}, running=${state.canvas?.runningCount || 0}, errors=${state.canvas?.errorCount || 0}, save=${state.canvas?.saveState || 'unknown'}`,
    `- Permissions: ${formatStateObject(state.permissions)}`,
    `- Tools: agent=${state.tools?.agentStatus || 'idle'}, workflowSteps=${state.tools?.workflowStepCount || 0}, runningSteps=${state.tools?.runningWorkflowSteps || 0}`,
    `- Native runtime: autostart=${Boolean(state.runtime?.autostartEnabled)}, closeToBackground=${Boolean(state.runtime?.closeToBackground)}, backend=${state.runtime?.backendNodeRunning ? 'running' : 'dev/not-spawned'}, shortcut=${state.runtime?.globalShortcut || 'Alt+Space'}${state.runtime?.lastError ? `, error=${state.runtime.lastError}` : ''}`,
    `- Autonomy gate: alwaysOnline=${gate.alwaysOnline}, autoProcess=${gate.autoProcessEnabled}, externalAppAutomation=${gate.externalAppAutomationEnabled}, messagingSendRequiresConfirmation=${gate.messagingSendRequiresConfirmation}, maxConsecutiveTasks=${gate.maxConsecutiveTasks}`,
    `- Confirmed autonomous workflows: enabled=${enabledWorkflows.length}, total=${workflows.length}${enabledWorkflows.length ? `, titles=${enabledWorkflows.map(workflow => workflow.title).slice(0, 5).join(', ')}` : ''}`,
    `- Recent errors: ${state.errors?.length ? state.errors.map(e => `${e.source}: ${e.message}`).slice(-3).join(' | ') : 'none'}`,
    `- State age: ${stateAge}s`,
  ] : ['- No live desktop client state has been reported yet.'];

  return [
    '## Lumi Client Self Model',
    'You are Lumi running inside the LumiOS desktop client. Treat the client as your body: know its surfaces, current state, and safe action routes.',
    'Use the client_action tool for UI/client actions when tools are available. Do not pretend a window changed if you did not call the action or ask the user.',
    'Prefer explicit client actions such as open_music_center, start_meeting_mode, open_canvas_task, show_knowledge_base, open_settings, and set_wallpaper_mode instead of mouse/keyboard control for Lumi UI.',
    'Ask for explicit user confirmation before changing wallpaper mode, starting autonomous execution, starting/stopping meeting capture, or requesting sensor/permission changes.',
    'For 24-hour availability: Lumi can stay ready only while the desktop client/server is running. Use launch-at-login and close-to-background for resident desktop behavior; autonomous background work still requires auto processing plus time, idle, token, and confirmed-workflow gates.',
    'Do not create autonomous background work from ambient context alone. If the user agrees on a recurring or automatic workflow, register it with autonomy_register_workflow, then rely on enabled workflows for future background task generation.',
    'For external apps such as WeChat, CAD, browsers, and other AI tools: use explicit adapters first. Prepare drafts/files/plans before controlling UI. Never claim a message was sent or a production drawing was finalized unless an explicit confirmed integration did it.',
    'Respect the global Memory Firewall: store personal, organization, meeting, LAP, community, and external-app memories with their source and privacy boundaries. Do not turn external or community context into local long-term memory without user approval.',
    'Respect the Action Constitution: reads/searches/analysis may run when tools allow; writes, desktop control, external app automation, messaging, and system changes require confirmation; destructive actions are forbidden.',
    'Respect modes: chat is conversational, meeting is transcription/reporting, music is listening/playback atmosphere, assistant is guided work, autonomous is visible multi-step execution.',
    '',
    '### Client Capabilities',
    ...capabilityLines,
    '',
    '### Current Client State',
    ...stateLines,
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
