import { ToolRegistry } from '../tools/registry';
import { ToolExecutionRecord, ToolContext } from '../tools/types';
import { NormalizedMessage, makeLLMCall, makeLLMCallStreaming, StreamCallback } from './providers';

export interface LLMConfig {
  provider: 'deepseek' | 'gemini' | 'openai' | 'anthropic' | 'qwen';
  model: string;
  maxTokens?: number;
  userId?: string;
}

export interface LLMResult {
  text: string;
  toolCalls: ToolExecutionRecord[];
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
): Promise<LLMResult> {
  const executionLog: ToolExecutionRecord[] = [];
  const conversationHistory: NormalizedMessage[] = [...messages];

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    const toolDeclarations = toolRegistry.getToolDeclarations();

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
        );

    if (!response.toolCalls || response.toolCalls.length === 0) {
      return {
        text: response.text || 'No response.',
        toolCalls: executionLog,
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
        return {
          text: response.text || 'The same tools were called repeatedly. Breaking the loop to prevent infinite execution.',
          toolCalls: executionLog,
        };
      }
    }

    conversationHistory.push({
      role: 'assistant',
      content: response.text,
      toolCalls: response.toolCalls,
    });

    for (const tc of response.toolCalls) {
      let result: string;
      let error: string | undefined;

      try {
        result = await toolRegistry.execute(tc.name, tc.arguments, context);
      } catch (e: any) {
        result = '';
        error = e.message;
      }

      const record: ToolExecutionRecord = {
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

  return {
    text: 'Maximum tool call iterations reached.',
    toolCalls: executionLog,
  };
}
