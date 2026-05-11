import { MemoryType } from '../memory/types';

export interface ExpressionStyle {
  /** Short persona description for self-reference, e.g. "futuristic AI architect" */
  persona: string;
  /** Tone of voice */
  tone: 'neutral' | 'warm' | 'professional' | 'technical' | 'playful' | 'inspiring';
  /** Response verbosity */
  verbosity: 'concise' | 'balanced' | 'detailed';
  /** Languages the personality operates in */
  languages: string[];
  /** Phrase patterns or vocabulary the personality favours */
  vocabularyHints?: string[];
}

export interface ToolPolicy {
  /** Tool names this personality is allowed to use. [] = none, ['*'] = all */
  allowedTools: string[];
  /** Tools that require user confirmation before execution */
  requireConfirmation: string[];
  /** Tools that are completely forbidden for this personality */
  forbiddenTools: string[];
  /** Maximum tool loop iterations */
  maxIterations: number;
  /** Per-tool security level overrides — takes precedence over the tool's built-in level */
  securityOverrides?: Record<string, 'safe' | 'confirm' | 'forbidden'>;
}

export interface MemoryPolicy {
  /** Max memories to inject into system prompt per turn */
  retrieveLimit: number;
  /** Minimum confidence score to include a memory */
  minConfidence: number;
  /** Which memory types to retrieve */
  includeTypes: MemoryType[];
  /** Whether to auto-extract new memories from conversations */
  autoExtract: boolean;
}

export interface PersonalityConfig {
  id: string;
  name: string;
  version: string;

  /** Core drive — one sentence describing the personality's fundamental motivation */
  coreMotivation: string;

  /** Hard behavioural limits — what this personality must never do */
  behavioralBoundaries: string[];

  /** Voice and style */
  expressionStyle: ExpressionStyle;

  /** Tool access control */
  toolPolicy: ToolPolicy;

  /** Memory behaviour */
  memoryPolicy: MemoryPolicy;

  /** Default model for this personality */
  defaultModel: string;

  /** Fallback model if the default is unavailable */
  fallbackModel: string;

  /** TTS voice ID for voice mode — maps to CosyVoice/GPT-SoVITS voice */
  ttsVoiceId?: string;

  /** Custom voice instructions injected into the voice system prompt */
  voiceInstructions?: string;

  /** Per-context overrides — e.g. 'floating-window' can be more concise than 'full-screen' */
  contextOverrides?: Record<string, Partial<{
    expressionStyle: Partial<ExpressionStyle>;
    toolPolicy: Partial<ToolPolicy>;
    memoryPolicy: Partial<MemoryPolicy>;
  }>>;
}

/** Active sensory channels from connected devices */
export interface SensoryContext {
  /** Audio input active (microphone / voice) */
  audio: boolean;
  /** Visual input active (camera / AR feed) */
  visual: boolean;
  /** 3D spatial awareness active (room mapping / position tracking) */
  spatial: boolean;
  /** Haptic feedback available */
  haptic: boolean;
  /** Holographic output capable */
  holographic: boolean;
  /** Active device types in this session */
  activeDeviceTypes: string[];
  /** Number of active devices */
  deviceCount: number;
  /** Optional spatial location tag (e.g. "living-room", "office", "mobile") */
  locationTag?: string;
  /** Optional visual scene description (from camera/AR) */
  visualScene?: string;
}

/** Context in which the personality is invoked */
export interface PersonalityContext {
  /** UI context — e.g. 'full-screen', 'floating-window', 'product-page', 'voice' */
  uiContext?: string;
  /** Whether this is a tool-enabled (task) or simple (chat) invocation */
  mode: 'chat' | 'task';
  /** Multimodal sensory context from connected devices */
  sensory?: SensoryContext;
}
