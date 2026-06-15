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
  | 'system';

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
    `- Recent errors: ${state.errors?.length ? state.errors.map(e => `${e.source}: ${e.message}`).slice(-3).join(' | ') : 'none'}`,
    `- State age: ${stateAge}s`,
  ] : ['- No live desktop client state has been reported yet.'];

  return [
    '## Lumi Client Self Model',
    'You are Lumi running inside the LumiOS desktop client. Treat the client as your body: know its surfaces, current state, and safe action routes.',
    'Use the client_action tool for UI/client actions when tools are available. Do not pretend a window changed if you did not call the action or ask the user.',
    'Prefer explicit client actions such as open_music_center, start_meeting_mode, open_canvas_task, show_knowledge_base, open_settings, and set_wallpaper_mode instead of mouse/keyboard control for Lumi UI.',
    'Ask for explicit user confirmation before changing wallpaper mode, starting autonomous execution, starting/stopping meeting capture, or requesting sensor/permission changes.',
    'Respect modes: chat is conversational, meeting is transcription/reporting, music is listening/playback atmosphere, assistant is guided work, autonomous is visible multi-step execution.',
    '',
    '### Client Capabilities',
    ...capabilityLines,
    '',
    '### Current Client State',
    ...stateLines,
  ].join('\n');
}

function formatStateObject(value?: Record<string, unknown>): string {
  if (!value) return 'unknown';
  const entries = Object.entries(value)
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}=${String(v)}`);
  return entries.length ? entries.join(', ') : 'unknown';
}
