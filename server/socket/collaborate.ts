/**
 * Multi-Agent Collaboration — Actor + Critic pattern
 * Two LLM passes: Actor executes tools, Critic reviews and refines.
 */
import { Socket } from 'socket.io';
import { makeLLMCallStreaming, NormalizedMessage } from '../llm/providers';
import { toolRegistry } from '../tools/registry';
import { personalityRegistry } from '../personality';
import { logger } from '../../logger';

interface CollabSession {
  actorModel: string;
  criticModel: string;
  maxIterations: number;
}

export async function runCollaboration(
  socket: Socket,
  userText: string,
  personalityId: string,
  llmGetters: {
    getDeepSeek: () => any;
    getGemini: () => any;
    getOpenAI: () => any;
    getAnthropic: () => any;
    getQwen: () => any;
  },
): Promise<void> {
  const { config: personality } = personalityRegistry.buildSystemPrompt(personalityId, { mode: 'task' });

  socket.emit('agent:status', { status: 'thinking', agentName: 'Lumi Collab' });

  // ── Phase 1: Actor (Qwen, fast + tools) ──
  socket.emit('agent:status', { status: 'thinking', agentName: 'Actor' });

  const actorMessages: NormalizedMessage[] = [
    {
      role: 'system',
      content: `You are ${personality.name}, the ACTOR agent. Execute the user's request by calling tools as needed. Be thorough and complete. After you finish, summarize what you did.`,
    },
    { role: 'user', content: userText },
  ];

  let actorText = '';
  const actorToolResults: string[] = [];

  try {
    const actorResult = await makeLLMCallStreaming(
      actorMessages,
      toolRegistry.getToolDeclarations(),
      { provider: 'qwen', model: 'qwen-plus' },
      (chunk) => { actorText += chunk; },
      llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
    );

    // Execute actor's tool calls
    if (actorResult.toolCalls?.length) {
      for (const tc of actorResult.toolCalls) {
        socket.emit('agent:tool_call', { correlationId: tc.id, name: tc.name, arguments: tc.arguments });
        try {
          const result = await toolRegistry.execute(tc.name, tc.arguments);
          actorToolResults.push(`[${tc.name}]: ${result.slice(0, 300)}`);
          socket.emit('agent:tool_call', { correlationId: tc.id, name: tc.name, result: result.slice(0, 300) });
        } catch (err: any) {
          actorToolResults.push(`[${tc.name}] ERROR: ${err.message}`);
        }
      }
    }
  } catch (err: any) {
    logger.error('[Collab] Actor failed:', err.message);
    socket.emit('agent:error', { message: 'Collaboration actor phase failed' });
    socket.emit('agent:status', { status: 'idle' });
    return;
  }

  // ── Phase 2: Critic (DeepSeek, reasoning) ──
  socket.emit('agent:status', { status: 'thinking', agentName: 'Critic' });

  const criticPrompt = `You are the CRITIC agent. Review the ACTOR's work below and:

1. Identify any mistakes, omissions, or missed opportunities
2. Suggest improvements or corrections
3. Provide a final, polished response to the user that incorporates your improvements

USER REQUEST: ${userText}

ACTOR'S RESPONSE: ${actorText}

ACTOR'S TOOL RESULTS:
${actorToolResults.join('\n') || '(no tools executed)'}

Provide your critique and FINAL RESPONSE in a single message. Start with "## Critique" then "## Final Response".`;

  let criticText = '';

  try {
    await makeLLMCallStreaming(
      [{ role: 'user', content: criticPrompt }],
      [], // Critic doesn't use tools
      { provider: 'deepseek', model: 'deepseek-v4-pro' },
      (chunk) => { criticText += chunk; },
      llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
    );
  } catch (err: any) {
    logger.error('[Collab] Critic failed:', err.message);
    // Fallback: use actor's output directly
    criticText = actorText;
  }

  // Extract final response (after "## Final Response")
  const finalMatch = criticText.match(/## Final Response\s*\n?([\s\S]*)/i);
  const finalResponse = finalMatch ? finalMatch[1].trim() : criticText.trim() || actorText.trim();

  socket.emit('agent:response', { text: finalResponse, agentName: 'Lumi Collab', source: 'collaborate' });
  socket.emit('agent:status', { status: 'idle', agentName: 'Lumi Collab' });
}
