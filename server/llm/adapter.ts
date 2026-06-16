import { ToolRegistry } from '../tools/registry';
import { ToolExecutionRecord, ToolContext, LLMUsage } from '../tools/types';
import { NormalizedMessage, makeLLMCall, makeLLMCallStreaming, StreamCallback } from './providers';
import { recordWorkflow, WorkflowStep } from '../skills/worklog';
import { recordLatency } from '../monitor/latency_store';

export interface LLMConfig {
  provider: 'deepseek' | 'gemini' | 'openai' | 'anthropic' | 'qwen' | 'ark' | 'ollama' | 'lmstudio' | 'xiaomi' | 'kimi' | 'glm' | 'relay' | 'auto';
  model: string;
  maxTokens?: number;
  userId?: string;
}

export interface LLMResult {
  text: string;
  toolCalls: ToolExecutionRecord[];
  usageRecords: LLMUsageRecord[];
}

export interface LLMUsageRecord {
  provider: string;
  model: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

function filterToolDeclarationsForPolicy(
  declarations: ReturnType<ToolRegistry['getToolDeclarations']>,
  context?: ToolContext,
): ReturnType<ToolRegistry['getToolDeclarations']> {
  const policy = context?.toolPolicy;
  if (!policy) return declarations;
  if (policy.forbiddenTools?.includes('*')) return [];

  const allowed = new Set(policy.allowedTools || []);
  const forbidden = new Set(policy.forbiddenTools || []);
  return declarations.filter((declaration) => {
    const name = declaration.function.name;
    if (forbidden.has(name)) return false;
    if (allowed.has('*')) return true;
    return allowed.has(name);
  });
}

export async function runWithTools(
  messages: NormalizedMessage[],
  toolRegistry: ToolRegistry,
  config: LLMConfig,
  onToolCall?: (record: ToolExecutionRecord) => void,
  maxIterations: number = 5,
  getDeepSeek?: () => any,
  getGemini?: () => any,
  getOpenAI?: () => any,
  getAnthropic?: () => any,
  getQwen?: () => any,
  onStreamChunk?: StreamCallback,
  context?: ToolContext,
  getOllama?: () => any,
  getLmStudio?: () => any,
  getArk?: () => any,
  getXiaomi?: () => any,
  getKimi?: () => any,
  getGlm?: () => any,
  getRelay?: () => any,
): Promise<LLMResult> {
  const executionLog: ToolExecutionRecord[] = [];
  const usageRecords: LLMUsageRecord[] = [];
  const conversationHistory: NormalizedMessage[] = [...messages];

  // Auto-detect hybrid mode: if provider is 'auto' and Ollama is available, use local→cloud dispatch
  const effectiveProvider = config.provider === 'auto' && getOllama?.()
    ? 'auto'  // Keep as 'auto' for the dispatch logic below
    : config.provider;

  const effectiveMaxIterations = Math.max(0, Math.min(maxIterations, context?.toolPolicy?.maxIterations ?? maxIterations));
  for (let iteration = 0; iteration < effectiveMaxIterations; iteration++) {
    // Check for cancellation between iterations
    if (context?.isCancelled?.()) {
      return {
        text: 'Task was cancelled by the user.',
        toolCalls: executionLog,
        usageRecords,
      };
    }
    const toolDeclarations = filterToolDeclarationsForPolicy(toolRegistry.getToolDeclarations(), context);

    const llmStart = Date.now();
    const response = onStreamChunk
      ? await makeLLMCallStreaming(
          conversationHistory,
          toolDeclarations,
          config,
          onStreamChunk,
          getDeepSeek || (() => null),
          getGemini || (() => null),
          getOpenAI || (() => null),
          getAnthropic || (() => null),
          getQwen || (() => null),
          getOllama || (() => null),
          getLmStudio || (() => null),
          getArk || (() => null),
          getXiaomi || (() => null),
          getKimi || (() => null),
          getGlm || (() => null),
          getRelay || (() => null),
        )
      : await makeLLMCall(
          conversationHistory,
          toolDeclarations,
          config,
          getDeepSeek || (() => null),
          getGemini || (() => null),
          getOpenAI || (() => null),
          getAnthropic || (() => null),
          getQwen || (() => null),
          getOllama || (() => null),
          getLmStudio || (() => null),
          getArk || (() => null),
          getXiaomi || (() => null),
          getKimi || (() => null),
          getGlm || (() => null),
          getRelay || (() => null),
        );
    recordLatency('llm', Date.now() - llmStart);

    // Collect usage from this LLM call
    if (response.usage) {
      usageRecords.push({
        provider: config.provider,
        model: config.model,
        promptTokens: response.usage.promptTokens,
        completionTokens: response.usage.completionTokens,
        totalTokens: response.usage.totalTokens,
      });
    }

    if (!response.toolCalls || response.toolCalls.length === 0) {
      recordWorkflowIfToolsUsed(executionLog, messages, config.userId);
      return {
        text: response.text || 'No response.',
        toolCalls: executionLog,
        usageRecords,
      };
    }

    // Check for duplicate tool calls (prevents infinite loops within maxIterations)
    const lastAssistantMsg = conversationHistory
      .filter(m => m.role === 'assistant')
      .slice(-1)[0];
    if (lastAssistantMsg?.toolCalls) {
      const sameTools = lastAssistantMsg.toolCalls.every((tc, i) =>
        response.toolCalls![i] &&
        tc.name === response.toolCalls![i].name &&
        JSON.stringify(tc.arguments) === JSON.stringify(response.toolCalls![i].arguments)
      );
      if (sameTools && lastAssistantMsg.toolCalls.length === response.toolCalls.length) {
        recordWorkflowIfToolsUsed(executionLog, messages, config.userId);
        return {
          text: response.text || 'The same tools were called repeatedly. Breaking the loop to prevent infinite execution.',
          toolCalls: executionLog,
          usageRecords,
        };
      }
    }

    conversationHistory.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
      reasoningContent: response.reasoningContent,
    });

    for (const tc of response.toolCalls) {
      let result: string;
      let error: string | undefined;

      try {
        context?.onToolStart?.({ id: tc.id, name: tc.name, arguments: tc.arguments });
      } catch {}

      try {
        result = await toolRegistry.execute(tc.name, tc.arguments, context);
      } catch (e: any) {
        result = '';
        error = e.message;
      }

      const record: ToolExecutionRecord = {
        id: tc.id,
        name: tc.name,
        arguments: tc.arguments,
        result,
        error,
      };
      executionLog.push(record);
      onToolCall?.(record);

      conversationHistory.push({
        role: 'tool',
        content: error ? `Error: ${error}` : result,
        toolCallId: tc.id,
        name: tc.name,
      });
    }
  }

  recordWorkflowIfToolsUsed(executionLog, messages, config.userId);
  return {
    text: 'Maximum tool call iterations reached.',
    toolCalls: executionLog,
    usageRecords,
  };
}

/** Record workflow from tool execution trace, if any tools were actually called */
function recordWorkflowIfToolsUsed(
  executionLog: ToolExecutionRecord[],
  messages: NormalizedMessage[],
  userId?: string,
): void {
  if (executionLog.length === 0) return;
  const rawContent = messages.find(m => m.role === 'user')?.content || '';
  const userMsg = typeof rawContent === 'string' ? rawContent : Array.isArray(rawContent) ? rawContent.filter(c => c.type === 'text').map(c => (c as any).text).join(' ') : '';
  const safeMsg = userMsg || '';
  recordWorkflow({
    userId: userId || 'anonymous',
    userIntent: safeMsg.slice(0, 200),
    toolSequence: executionLog.map(e => ({
      name: e.name,
      args: e.arguments,
      resultSummary: (e.result || e.error || '').slice(0, 200),
    })),
    conversationExcerpt: safeMsg.slice(0, 500),
  });
}

// ── Vision Integration ──

/** Parse screenshot relay result — handles JSON wrapper { image_base64, format, width, height } or raw base64 */
export function parseScreenshotBase64(relayResult: string): { base64: string; mime: string } {
  try {
    const parsed = JSON.parse(relayResult);
    if (parsed.image_base64) {
      return {
        base64: parsed.image_base64,
        mime: parsed.format === 'jpeg' ? 'image/jpeg' : 'image/png',
      };
    }
  } catch {}
  // Fallback: raw base64 string (legacy)
  return { base64: relayResult, mime: 'image/png' };
}

/** Analyze a screenshot with a vision-capable model. */
export async function analyzeScreen(
  imageBase64: string,
  query: string,
  config: { provider: string; model: string },
  getDeepSeek?: () => any,
  getGemini?: () => any,
  getOpenAI?: () => any,
  getAnthropic?: () => any,
  getQwen?: () => any,
  getOllama?: () => any,
  getLmStudio?: () => any,
  getArk?: () => any,
  getXiaomi?: () => any,
  getKimi?: () => any,
  getGlm?: () => any,
  getRelay?: () => any,
): Promise<string> {
  const { base64, mime } = parseScreenshotBase64(imageBase64);

  // Determine which vision model to use
  let provider = config.provider;
  let model = config.model;

  // Qwen and Ark have specific vision models — auto-switch when using chat models
  if (provider === 'qwen' && !model.includes('vl')) {
    // qwen-plus/qwen-max/qwen-turbo → qwen-vl-max for vision
    model = 'qwen-vl-max';
  } else if (provider === 'ark' && !model.includes('vision')) {
    // doubao-1-5-pro/lite → doubao-1-5-vision-pro for vision
    model = 'doubao-1-5-vision-pro-32k';
  } else if (provider === 'deepseek') {
    // DeepSeek has no vision capability — route to the best available provider
    if (getQwen?.()) { provider = 'qwen'; model = 'qwen-vl-max'; }
    else if (getArk?.()) { provider = 'ark'; model = 'doubao-1-5-vision-pro-32k'; }
    else if (getOpenAI?.()) { provider = 'openai'; model = 'gpt-4o'; }
    else if (getGemini?.()) { provider = 'gemini'; model = 'gemini-2.0-flash'; }
    else throw new Error('Vision requires a Qwen, Ark, OpenAI, or Gemini API key. DeepSeek does not support vision.');
  }

  const messages: NormalizedMessage[] = [
    {
      role: 'system',
      content: 'You are a screen reader AI. Analyze the screenshot and answer the user\'s question about what is visible on screen. Describe UI elements, text content, error messages, and anything relevant to the query. Be thorough but concise.',
    },
    {
      role: 'user',
      content: [
        { type: 'text', text: query },
        { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}`, detail: 'high' } },
      ],
    },
  ];

  const result = await makeLLMCall(
    messages, [],
    { provider: provider as any, model, maxTokens: 1000 },
    getDeepSeek || (() => null), getGemini || (() => null),
    getOpenAI, getAnthropic, getQwen, getOllama, getLmStudio, getArk,
    getXiaomi, getKimi, getGlm, getRelay,
  );

  return result.text || 'Vision analysis returned no text.';
}

/** Run a multimodal conversation with vision-capable models. */
export async function runWithVision(
  messages: NormalizedMessage[],
  config: LLMConfig,
  getDeepSeek?: () => any,
  getGemini?: () => any,
  getOpenAI?: () => any,
  getAnthropic?: () => any,
  getQwen?: () => any,
  getOllama?: () => any,
  getLmStudio?: () => any,
  getArk?: () => any,
  getXiaomi?: () => any,
  getKimi?: () => any,
  getGlm?: () => any,
  getRelay?: () => any,
): Promise<string> {
  const result = await makeLLMCall(messages, [], config, getDeepSeek || (() => null), getGemini || (() => null), getOpenAI, getAnthropic, getQwen, getOllama, getLmStudio, getArk, getXiaomi, getKimi, getGlm, getRelay);
  return result.text || '';
}
