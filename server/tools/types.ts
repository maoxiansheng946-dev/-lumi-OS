export type ToolPermission = 'public' | 'user' | 'admin' | 'system';

/** Security classification per tool — inspired by Claude Code's tier system */
export type SecurityLevel = 'safe' | 'confirm' | 'forbidden';

export interface ToolContext {
  userId?: string;
  socketId?: string;
  cwd?: string;
  /** Relay for desktop tools: sends execution request to Tauri frontend and returns result */
  desktopRelay?: (toolName: string, args: Record<string, any>) => Promise<string>;
  /** Called when a tool requires confirmation. Returns true to proceed, false to abort. */
  requestConfirmation?: (toolName: string, args: Record<string, any>) => Promise<boolean>;
  /** Personality's tool policy for security level resolution */
  toolPolicy?: import('../personality/types').ToolPolicy;
  /** Returns true if the task has been cancelled — checked between tool iterations */
  isCancelled?: () => boolean;
  /** Progress callback for long-running tools (computer_use) — reports each step */
  onProgress?: (step: string) => void;
  /** Lifecycle callback fired immediately before an LLM-selected tool begins. */
  onToolStart?: (call: { id?: string; name: string; arguments: Record<string, any> }) => void;
  /** LLM provider getters for tools that need to call vision/text models internally */
  llmGetters?: {
    getDeepSeek: () => any;
    getGemini: () => any;
    getOpenAI?: () => any;
    getAnthropic?: () => any;
    getQwen?: () => any;
    getArk?: () => any;
    getOllama?: () => any;
    getLmStudio?: () => any;
  };
  /** True when the tool is being used by background autonomous work. */
  autonomous?: boolean;
  /** Surface that initiated the tool call, such as chat, voice, canvas, meeting, or mcp. */
  source?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, any>;
  handler: (args: Record<string, any>, context?: ToolContext) => Promise<string>;
  permission: ToolPermission;
  /** Security level: safe = auto-execute, confirm = ask user, forbidden = never execute */
  securityLevel: SecurityLevel;
}

export interface ParsedToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface LLMUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface NormalizedLLMResponse {
  text: string | null;
  toolCalls: ParsedToolCall[] | null;
  reasoningContent?: string | null;
  usage?: LLMUsage;
}

export interface ToolExecutionRecord {
  id?: string;
  name: string;
  arguments: Record<string, any>;
  result: string;
  error?: string;
}
