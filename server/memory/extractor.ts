import { makeLLMCall, NormalizedMessage } from '../llm/providers';
import { ExtractedMemory } from './types';
import type { UserLLMProvider } from '../llm/user_preferences';

export interface ExtractedReminder {
  content: string;
  dueAt: string | null;
  confidence: number;
}

const EXTRACTION_PROMPT = `You are a memory extraction system for a personal AI assistant. Analyze the conversation below and identify any new information about the user AND any time-sensitive tasks or reminders.

The user's memories are organized as a tree with topic branches. When extracting new memories, suggest which branch they belong to.

Output ONLY a JSON object with two arrays:

{
  "memories": [
    {
      "type": "preference" | "fact" | "habit" | "knowledge",
      "content": "concise sentence (original language of conversation)",
      "keywords": ["specific terms", "category words"],
      "confidence": 0.3-0.9,
      "branchHint": "name of existing branch this belongs to, or null for root"
    }
  ],
  "reminders": [
    {
      "content": "what to remind the user about",
      "dueAt": "ISO datetime or null if no specific time mentioned",
      "confidence": 0.3-0.9
    }
  ]
}

Memory types:
- "preference": user likes/dislikes
- "fact": objective facts (name, occupation, location)
- "habit": recurring behaviors, routines
- "knowledge": topics the user is learning about

Keywords MUST include: (a) original terms the user said, AND (b) category words for search (e.g. "名字", "爱好", "食物", "name", "hobby")

Reminders: only extract if the user explicitly says they want to be reminded about something, mentions a deadline, schedule, or task. Set dueAt to an ISO datetime if a specific time is mentioned, otherwise null.

Rules:
- Only extract NEW information not in "Existing memories"
- If nothing new, output {"memories": [], "reminders": []}
- Be conservative on confidence
- Output valid JSON only, no explanation

Memory tree branches:
{treeBranches}

Existing memories:
{existingMemories}

Conversation to analyze:
User: {userMessage}
Assistant: {assistantResponse}

JSON output:`;

export interface ExtractionContext {
  userMessage: string;
  assistantResponse: string;
  existingMemories: string[];
  provider: UserLLMProvider;
  model: string;
  userId?: string;
  domain?: string;
  orgId?: string;
  treeBranches?: string[];
  /** Location tag from sensory context or user message (e.g. 'home', 'office', 'cafe') */
  locationTag?: string;
}

export async function extractMemories(
  ctx: ExtractionContext,
  getDeepSeek: () => any,
  getGemini: () => any,
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
): Promise<{ memories: (ExtractedMemory & { branchHint?: string })[]; reminders: ExtractedReminder[] }> {
  const existingStr = ctx.existingMemories.length > 0
    ? ctx.existingMemories.map(m => `- ${m}`).join('\n')
    : '(none yet)';

  const branchesStr = ctx.treeBranches && ctx.treeBranches.length > 0
    ? ctx.treeBranches.map(b => `- ${b}`).join('\n')
    : '(none — all memories are at root level)';

  // Inject location context for spatial memory tagging
  let locationHint = '';
  if (ctx.locationTag) {
    locationHint = `\n\nLocation context: The user is currently at "${ctx.locationTag}". If relevant, include location-related keywords.`;
  }

  const prompt = EXTRACTION_PROMPT
    .replace('{treeBranches}', branchesStr)
    .replace('{existingMemories}', existingStr)
    .replace('{userMessage}', ctx.userMessage.slice(0, 2000))
    .replace('{assistantResponse}', ctx.assistantResponse.slice(0, 2000))
    + locationHint;

  const messages: NormalizedMessage[] = [
    { role: 'user', content: prompt },
  ];

  try {
    const response = await makeLLMCall(
      messages,
      [],
      { provider: ctx.provider, model: ctx.model, maxTokens: 1024, userId: ctx.userId, domain: ctx.domain, orgId: ctx.orgId },
      getDeepSeek,
      getGemini,
      getOpenAI,
      getAnthropic,
      getQwen,
      getOllama,
      getLmStudio,
      getArk,
      getXiaomi,
      getKimi,
      getGlm,
      getRelay,
    );

    const text = response.text || '';
    const jsonMatch = text.match(/\\{[\\s\\S]*\\}|\\[[\\s\\S]*\\]/);
    if (!jsonMatch) return { memories: [], reminders: [] };

    const parsed = JSON.parse(jsonMatch[0]);

    const memArray: any[] = Array.isArray(parsed) ? parsed : (parsed.memories || []);
    const remArray: any[] = Array.isArray(parsed) ? [] : (parsed.reminders || []);

    const validTypes = new Set(['preference', 'fact', 'habit', 'knowledge']);
    const memories = memArray
      .filter((item: any) =>
        item &&
        validTypes.has(item.type) &&
        typeof item.content === 'string' &&
        item.content.length > 0 &&
        Array.isArray(item.keywords),
      )
      .filter((item: any) => {
        const conf = Number(item.confidence) || 0.5;
        if (conf < 0.5) return false;
        const content = item.content.trim();
        if (content.length < 5) return false;
        if (/^[\d\s.,;:!?，。；：！？、""''「」『』【】（）()\[\]{}<>%$#@&*+\-/=~^`|]+$/.test(content)) return false;
        return true;
      })
      .map((item: any) => ({
        type: item.type as ExtractedMemory['type'],
        content: item.content.trim().slice(0, 500),
        keywords: item.keywords.map((k: any) => String(k).toLowerCase().trim()).filter((k: string) => k.length > 0).slice(0, 5),
        confidence: Math.min(1, Math.max(0.1, Number(item.confidence) || 0.5)),
        branchHint: typeof item.branchHint === 'string' ? item.branchHint.trim() : undefined,
      }));

    const reminders: ExtractedReminder[] = remArray
      .filter((item: any) =>
        item &&
        typeof item.content === 'string' &&
        item.content.length > 0,
      )
      .map((item: any) => ({
        content: item.content.trim().slice(0, 500),
        dueAt: item.dueAt || null,
        confidence: Math.min(1, Math.max(0.1, Number(item.confidence) || 0.5)),
      }));

    return { memories, reminders };
  } catch (err) {
    console.error('[Memory Extractor] Extraction failed:', err);
    return { memories: [], reminders: [] };
  }
}
