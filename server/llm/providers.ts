import { ParsedToolCall, NormalizedLLMResponse } from '../tools/types';

export type MessageContent =
  | string
  | null
  | Array<{ type: 'text'; text: string } | { type: 'image_url'; image_url: { url: string; detail?: 'auto' | 'low' | 'high' } }>;

export interface NormalizedMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: MessageContent;
  toolCalls?: ParsedToolCall[];
  toolCallId?: string;
  name?: string;
  reasoningContent?: string | null;
}

interface ToolDeclaration {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, any>;
  };
}

// ── DeepSeek (OpenAI-compatible) ──

export function formatDeepSeekRequest(params: {
  model: string;
  messages: NormalizedMessage[];
  toolDeclarations: ToolDeclaration[];
  maxTokens?: number;
  userId?: string;
}): {
  model: string;
  messages: Array<{ role: string; content: MessageContent; tool_calls?: any; tool_call_id?: string }>;
  tools?: ToolDeclaration[];
  tool_choice?: string;
  max_tokens?: number;
  user?: string;
} {
  const openaiMessages = params.messages.map(m => {
    const roleMap: Record<string, string> = { assistant: 'assistant', tool: 'tool', system: 'system' };
    const entry: any = { role: roleMap[m.role] || 'user' };
    if (m.content !== null) entry.content = m.content;
    if (m.reasoningContent) entry.reasoning_content = m.reasoningContent;
    if (m.toolCalls) {
      entry.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    if (m.toolCallId) entry.tool_call_id = m.toolCallId;
    if (m.name) entry.name = m.name;
    return entry;
  });

  const hasTools = params.toolDeclarations.length > 0;

  return {
    model: params.model,
    messages: openaiMessages,
    ...(hasTools ? { tools: params.toolDeclarations, tool_choice: 'auto' } : {}),
    ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    ...(params.userId ? { user: params.userId.replace(/[^a-zA-Z0-9_-]/g, '_') } : {}),
  };
}

function extractUsage(rawResponse: any) {
  const usage = rawResponse.usage || rawResponse.usageMetadata;
  if (!usage) return undefined;
  return {
    promptTokens: usage.prompt_tokens || usage.promptTokenCount || usage.input_tokens || usage.inputTokens || 0,
    completionTokens: usage.completion_tokens || usage.candidatesTokenCount || usage.output_tokens || usage.outputTokens || 0,
    totalTokens: usage.total_tokens || usage.totalTokenCount || 0,
  };
}

export function parseDeepSeekResponse(rawResponse: any): NormalizedLLMResponse {
  const message = rawResponse.choices?.[0]?.message;
  if (!message) return { text: null, toolCalls: null };

  const text = message.content || null;
  const reasoningContent = message.reasoning_content || null;
  const usage = extractUsage(rawResponse);

  if (message.tool_calls && message.tool_calls.length > 0) {
    const toolCalls: ParsedToolCall[] = message.tool_calls.map((tc: any) => {
      let args: Record<string, any> = {};
      try {
        args = JSON.parse(tc.function?.arguments || '{}');
      } catch { /* ignore parse errors */ }
      return { id: tc.id, name: tc.function?.name || '', arguments: args };
    });
    return { text, toolCalls, reasoningContent, usage };
  }

  return { text, toolCalls: null, reasoningContent, usage };
}

// ── Gemini ──

export function formatGeminiRequest(params: {
  model: string;
  messages: NormalizedMessage[];
  toolDeclarations: ToolDeclaration[];
  maxTokens?: number;
}): {
  modelConfig: { model: string; systemInstruction?: string; tools?: Array<{ functionDeclarations: any[] }> };
  contents: Array<{ role: string; parts: any[] }>;
} {
  // Extract system message for Gemini's separate systemInstruction param
  let systemInstruction: string | undefined;
  const nonSystemMessages = params.messages.filter(m => {
    if (m.role === 'system' && m.content) {
      systemInstruction = m.content as string;
      return false;
    }
    return true;
  });

  // Convert messages to Gemini contents format
  const contents: Array<{ role: string; parts: any[] }> = [];

  for (const m of nonSystemMessages) {
    if (m.role === 'tool') {
      // Tool results become user messages with functionResponse
      const prevContent = contents.length > 0 ? contents[contents.length - 1] : null;
      if (prevContent && prevContent.role === 'model') {
        // Append functionResponse to a new user message
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: m.name || '',
              response: { content: m.content || '' },
            },
          }],
        });
      } else {
        contents.push({
          role: 'user',
          parts: [{
            functionResponse: {
              name: m.name || '',
              response: { content: m.content || '' },
            },
          }],
        });
      }
      continue;
    }

    if (m.role === 'assistant') {
      const parts: any[] = [];
      if (m.content) {
        parts.push({ text: m.content });
      }
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          parts.push({
            functionCall: {
              name: tc.name,
              args: tc.arguments,
            },
          });
        }
      }
      contents.push({ role: 'model', parts });
      continue;
    }

    // user messages
    contents.push({
      role: 'user',
      parts: [{ text: m.content || '' }],
    });
  }

  const hasTools = params.toolDeclarations.length > 0;

  const modelConfig: any = { model: params.model };
  if (systemInstruction) modelConfig.systemInstruction = systemInstruction;
  if (hasTools) {
    modelConfig.tools = [{
      functionDeclarations: params.toolDeclarations.map(td => ({
        name: td.function.name,
        description: td.function.description,
        parameters: td.function.parameters,
      })),
    }];
  }

  return { modelConfig, contents };
}

export function parseGeminiResponse(rawResponse: any): NormalizedLLMResponse {
  const candidate = rawResponse.candidates?.[0];
  if (!candidate) return { text: null, toolCalls: null };

  const parts = candidate.content?.parts || [];
  const textParts: string[] = [];
  const toolCalls: ParsedToolCall[] = [];

  for (const part of parts) {
    if (part.text) {
      textParts.push(part.text);
    }
    if (part.functionCall) {
      toolCalls.push({
        id: `gemini-${Date.now()}-${toolCalls.length}`,
        name: part.functionCall.name || '',
        arguments: part.functionCall.args || {},
      });
    }
  }

  return {
    text: textParts.length > 0 ? textParts.join('\n') : null,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
    usage: extractUsage(rawResponse),
  };
}

// ── OpenAI (same API format as DeepSeek) ──

export const formatOpenAIRequest = formatDeepSeekRequest;
export const parseOpenAIResponse = parseDeepSeekResponse;

// ── Qwen / DashScope (OpenAI-compatible API) ──

export function formatQwenRequest(params: {
  model: string;
  messages: NormalizedMessage[];
  toolDeclarations: ToolDeclaration[];
  maxTokens?: number;
  userId?: string;
}): {
  model: string;
  messages: Array<{ role: string; content: MessageContent; tool_calls?: any; tool_call_id?: string }>;
  tools?: ToolDeclaration[];
  tool_choice?: string;
  max_tokens?: number;
} {
  const openaiMessages = params.messages.map(m => {
    const roleMap: Record<string, string> = { assistant: 'assistant', tool: 'tool', system: 'system' };
    const entry: any = { role: roleMap[m.role] || 'user' };
    if (m.content !== null) entry.content = m.content;
    if (m.reasoningContent) entry.reasoning_content = m.reasoningContent;
    if (m.toolCalls) {
      entry.tool_calls = m.toolCalls.map(tc => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments) },
      }));
    }
    if (m.toolCallId) entry.tool_call_id = m.toolCallId;
    if (m.name) entry.name = m.name;
    return entry;
  });

  const hasTools = params.toolDeclarations.length > 0;

  return {
    model: params.model,
    messages: openaiMessages,
    ...(hasTools ? { tools: params.toolDeclarations, tool_choice: 'auto' } : {}),
    ...(params.maxTokens ? { max_tokens: params.maxTokens } : {}),
    // DashScope does not support the OpenAI `user` parameter — omit it
  };
}

// ── Anthropic ──

export function formatAnthropicRequest(params: {
  model: string;
  messages: NormalizedMessage[];
  toolDeclarations: ToolDeclaration[];
  maxTokens?: number;
}): { model: string; max_tokens: number; system?: string; messages: any[]; tools?: any[] } {
  // Extract system message to top-level
  let system: string | undefined;
  const nonSystem = params.messages.filter(m => {
    if (m.role === 'system' && m.content) {
      system = m.content as string;
      return false;
    }
    return true;
  });

  const anthropicMessages: any[] = [];

  for (const m of nonSystem) {
    if (m.role === 'tool') {
      anthropicMessages.push({
        role: 'user',
        content: [{ type: 'tool_result', tool_use_id: m.toolCallId, content: m.content || '' }],
      });
    } else if (m.role === 'assistant') {
      const content: any[] = [];
      if (m.content) content.push({ type: 'text', text: m.content });
      if (m.toolCalls) {
        for (const tc of m.toolCalls) {
          content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: tc.arguments });
        }
      }
      anthropicMessages.push({ role: 'assistant', content });
    } else {
      anthropicMessages.push({ role: 'user', content: m.content || '' });
    }
  }

  const hasTools = params.toolDeclarations.length > 0;
  const tools = hasTools
    ? params.toolDeclarations.map(td => ({
        name: td.function.name,
        description: td.function.description,
        input_schema: td.function.parameters,
      }))
    : undefined;

  return {
    model: params.model,
    max_tokens: params.maxTokens || 4096,
    ...(system ? { system } : {}),
    messages: anthropicMessages,
    ...(tools ? { tools } : {}),
  };
}

export function parseAnthropicResponse(rawResponse: any): NormalizedLLMResponse {
  const content = rawResponse.content || [];
  const textParts: string[] = [];
  const toolCalls: ParsedToolCall[] = [];

  for (const block of content) {
    if (block.type === 'text' && block.text) {
      textParts.push(block.text);
    }
    if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        name: block.name,
        arguments: block.input || {},
      });
    }
  }

  return {
    text: textParts.length > 0 ? textParts.join('\n') : null,
    toolCalls: toolCalls.length > 0 ? toolCalls : null,
    usage: extractUsage(rawResponse),
  };
}

// ── LLM Call Router ──

export async function makeLLMCall(
  messages: NormalizedMessage[],
  toolDeclarations: ToolDeclaration[],
  config: { provider: 'deepseek' | 'gemini' | 'openai' | 'anthropic' | 'qwen'; model: string; maxTokens?: number; userId?: string },
  getDeepSeek: () => any,
  getGemini: () => any,
  getOpenAI?: () => any,
  getAnthropic?: () => any,
  getQwen?: () => any,
): Promise<NormalizedLLMResponse> {
  if (config.provider === 'deepseek' || config.provider === 'qwen') {
    const client = config.provider === 'deepseek' ? getDeepSeek() : getQwen?.();
    if (!client) throw new Error(`${config.provider} not configured (API key missing)`);

    const formatFn = config.provider === 'qwen' ? formatQwenRequest : formatDeepSeekRequest;
    const params = formatFn({
      model: config.model,
      messages,
      toolDeclarations,
      maxTokens: config.maxTokens,
      userId: config.userId,
    });

    const response = await client.chat.completions.create(params);
    return parseDeepSeekResponse(response);
  }

  if (config.provider === 'gemini') {
    const client = getGemini();
    if (!client) throw new Error('Gemini not configured (GEMINI_API_KEY missing)');

    const { modelConfig, contents } = formatGeminiRequest({
      model: config.model,
      messages,
      toolDeclarations,
      maxTokens: config.maxTokens,
    });

    const modelInstance = client.getGenerativeModel(modelConfig);
    const result = await modelInstance.generateContent({ contents });
    return parseGeminiResponse(result);
  }

  if (config.provider === 'openai') {
    const client = getOpenAI?.();
    if (!client) throw new Error('OpenAI not configured (OPENAI_API_KEY missing)');

    const params = formatOpenAIRequest({
      model: config.model,
      messages,
      toolDeclarations,
      maxTokens: config.maxTokens,
      userId: config.userId,
    });

    const response = await client.chat.completions.create(params);
    return parseOpenAIResponse(response);
  }

  if (config.provider === 'anthropic') {
    const client = getAnthropic?.();
    if (!client) throw new Error('Anthropic not configured (ANTHROPIC_API_KEY missing)');

    const params = formatAnthropicRequest({
      model: config.model,
      messages,
      toolDeclarations,
      maxTokens: config.maxTokens,
    });

    const response = await client.messages.create(params);
    return parseAnthropicResponse(response);
  }

  throw new Error(`Unsupported provider: ${config.provider}`);
}

// ── Streaming LLM Call Router ──

export type StreamCallback = (chunk: string) => void;

export async function makeLLMCallStreaming(
  messages: NormalizedMessage[],
  toolDeclarations: ToolDeclaration[],
  config: { provider: 'deepseek' | 'gemini' | 'openai' | 'anthropic' | 'qwen'; model: string; maxTokens?: number; userId?: string; signal?: AbortSignal },
  onChunk: StreamCallback,
  getDeepSeek: () => any,
  getGemini: () => any,
  getOpenAI?: () => any,
  getAnthropic?: () => any,
  getQwen?: () => any,
): Promise<NormalizedLLMResponse> {
  // ── DeepSeek / OpenAI / Qwen (OpenAI-compatible streaming) ──
  if (config.provider === 'deepseek' || config.provider === 'openai' || config.provider === 'qwen') {
    const client = config.provider === 'deepseek' ? getDeepSeek()
      : config.provider === 'openai' ? getOpenAI?.()
      : getQwen?.();
    if (!client) throw new Error(`${config.provider} not configured`);

    const formatFn = config.provider === 'qwen' ? formatQwenRequest : formatDeepSeekRequest;
    const params: any = formatFn({
      model: config.model,
      messages,
      toolDeclarations,
      maxTokens: config.maxTokens,
      userId: config.userId,
    });
    params.stream = true;

    const stream = await client.chat.completions.create(params, { signal: config.signal });
    const accumulatedText: string[] = [];
    const accumulatedReasoning: string[] = [];
    const toolCallAccumulators: Map<number, { id: string; name: string; args: string }> = new Map();
    let streamUsage: any = undefined;

    for await (const chunk of stream) {
      const delta = chunk.choices?.[0]?.delta;
      if (delta) {
        if (delta.content) {
          accumulatedText.push(delta.content);
          onChunk(delta.content);
        }

        if (delta.reasoning_content) {
          accumulatedReasoning.push(delta.reasoning_content);
        }

        if (delta.tool_calls) {
          for (const tc of delta.tool_calls) {
            const idx = tc.index ?? 0;
            if (!toolCallAccumulators.has(idx)) {
              toolCallAccumulators.set(idx, { id: tc.id || '', name: tc.function?.name || '', args: '' });
            }
            const acc = toolCallAccumulators.get(idx)!;
            if (tc.id) acc.id = tc.id;
            if (tc.function?.name) acc.name = tc.function.name;
            if (tc.function?.arguments) acc.args += tc.function.arguments;
          }
        }
      }
      if (chunk.usage) streamUsage = chunk.usage;
    }

    const usage = extractUsage({ usage: streamUsage });

    const text = accumulatedText.length > 0 ? accumulatedText.join('') : null;
    const reasoningContent = accumulatedReasoning.length > 0 ? accumulatedReasoning.join('') : null;
    if (toolCallAccumulators.size > 0) {
      const toolCalls: ParsedToolCall[] = [...toolCallAccumulators.values()].map(acc => {
        let args: Record<string, any> = {};
        try { args = JSON.parse(acc.args || '{}'); } catch { /* ignore parse errors */ }
        return { id: acc.id, name: acc.name, arguments: args };
      });
      return { text, toolCalls, reasoningContent, usage };
    }
    return { text, toolCalls: null, reasoningContent, usage };
  }

  // ── Gemini streaming ──
  if (config.provider === 'gemini') {
    const client = getGemini();
    if (!client) throw new Error('Gemini not configured (GEMINI_API_KEY missing)');

    const { modelConfig, contents } = formatGeminiRequest({
      model: config.model,
      messages,
      toolDeclarations,
      maxTokens: config.maxTokens,
    });

    const modelInstance = client.getGenerativeModel(modelConfig);
    const result = await modelInstance.generateContentStream({ contents });

    const accumulatedText: string[] = [];
    const toolCalls: ParsedToolCall[] = [];

    for await (const chunk of result.stream) {
      const text = chunk.text();
      if (text) {
        accumulatedText.push(text);
        onChunk(text);
      }
      const calls = chunk.functionCalls();
      if (calls) {
        for (let i = 0; i < calls.length; i++) {
          toolCalls.push({
            id: `gemini-${Date.now()}-${toolCalls.length}`,
            name: calls[i].name || '',
            arguments: calls[i].args || {},
          });
        }
      }
    }

    // Also check the aggregated response for function calls + usage
    const aggregated = await result.response;
    const parsed = parseGeminiResponse(aggregated);

    return {
      text: accumulatedText.length > 0 ? accumulatedText.join('') : parsed.text,
      toolCalls: parsed.toolCalls && parsed.toolCalls.length > 0 ? parsed.toolCalls : (toolCalls.length > 0 ? toolCalls : null),
      usage: parsed.usage,
    };
  }

  // ── Anthropic streaming ──
  if (config.provider === 'anthropic') {
    const client = getAnthropic?.();
    if (!client) throw new Error('Anthropic not configured (ANTHROPIC_API_KEY missing)');

    const params = formatAnthropicRequest({
      model: config.model,
      messages,
      toolDeclarations,
      maxTokens: config.maxTokens,
    });

    const stream = await client.messages.stream(params);

    const textParts: string[] = [];
    const toolCalls: ParsedToolCall[] = [];

    for await (const event of stream) {
      if (event.type === 'text' && event.text) {
        textParts.push(event.text);
        onChunk(event.text);
      }
    }

    // Get final message for tool use blocks + usage
    const finalMessage = await stream.finalMessage();
    for (const block of finalMessage.content) {
      if (block.type === 'tool_use') {
        toolCalls.push({
          id: block.id,
          name: block.name,
          arguments: block.input || {},
        });
      }
    }

    return {
      text: textParts.length > 0 ? textParts.join('') : null,
      toolCalls: toolCalls.length > 0 ? toolCalls : null,
      usage: extractUsage(finalMessage),
    };
  }

  throw new Error(`Unsupported streaming provider: ${config.provider}`);
}
