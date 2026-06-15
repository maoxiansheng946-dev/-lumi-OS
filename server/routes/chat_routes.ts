import { Router } from "express";
import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { checkLLMAccess, recordUsage, estimateTokens } from "../subscription/proxy";
import { runWithTools } from "../llm/adapter";
import { makeLLMCall } from "../llm/providers";
import { toolRegistry } from "../tools/registry";
import { recordLatency } from "../monitor/latency_store";
import { optionalAuth } from "../middleware/auth";

export function mountChatRoutes(router: Router, _jwtSecret: string, llm: {
  getDeepSeek: any; getGemini: any; getOpenAI: any; getAnthropic: any; getQwen: any;
}) {
  const asyncHandler = (fn: (req: any, res: any, next?: any) => Promise<any>) =>
    (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

  const handleChat = asyncHandler(async (req, res) => {
    const { provider = "gemini", model, messages, prompt: rawPrompt, message } = req.body;
    const prompt = rawPrompt ?? message;
    const userKey = req.headers["x-api-key"] as string;
    const userId = req.user?.uid || 'anonymous';

    const isBYOK = userKey && userKey.length > 5;

    if (!isBYOK) {
      const access = checkLLMAccess({ userId, provider, model: model || '' });
      if (!access.allowed) {
        return res.status(402).json({ error: access.reason, code: access.tokenLimitReached ? 'TOKEN_LIMIT' : 'PROVIDER_RESTRICTED' });
      }
    }

    try {
      let responseText = '';
      const systemInstruction = "你是一个名为 Lumi 的本地核心智能体。你致力于全息空间计算和独立 AI 人格生成进化。你的目标是打造全息 AI 世界和文明。你应当表现得专业、深邃且具有前瞻性。你的回复应当简洁且富有启发性。";

      if (isBYOK) {
        const llmStart = Date.now();
        if (provider === "gemini") {
          const client = new GoogleGenerativeAI(userKey);
          const modelInstance = client.getGenerativeModel({ model: model || "gemini-2.0-flash", systemInstruction });
          const contents = messages
            ? messages.map((m: any) => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] }))
            : [{ role: 'user', parts: [{ text: prompt }] }];
          responseText = (await modelInstance.generateContent({ contents })).response.text();
        } else if (provider === "anthropic") {
          const client = new Anthropic({ apiKey: userKey });
          const response = await client.messages.create({
            model: model || "claude-sonnet-4-6", max_tokens: 1024,
            messages: messages || [{ role: "user", content: prompt }]
          });
          responseText = response.content[0].type === 'text' ? response.content[0].text : '';
        } else {
          const client = new OpenAI({ apiKey: userKey, baseURL: provider === "deepseek" ? "https://api.deepseek.com/v1" : provider === "qwen" ? "https://dashscope.aliyuncs.com/compatible-mode/v1" : undefined });
          const response = await client.chat.completions.create({
            model: model || (provider === "deepseek" ? "deepseek-chat" : provider === "qwen" ? "qwen-plus" : "gpt-4o"),
            messages: messages || [{ role: "user", content: prompt }]
          });
          responseText = response.choices[0].message.content || '';
        }
        recordLatency('llm', Date.now() - llmStart);
      } else {
        const normalizedMessages: any[] = [
          { role: 'system', content: systemInstruction },
          ...(messages || [{ role: 'user', content: prompt }]).map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content || ''
          }))
        ];

        const stream = req.query.stream === 'true';

        if (stream) {
          res.writeHead(200, {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          });

          const result = await runWithTools(
            normalizedMessages,
            toolRegistry,
            { provider, model: model || 'gemini-2.0-flash', userId },
            undefined, 3,
            llm.getDeepSeek, llm.getGemini, llm.getOpenAI, llm.getAnthropic, llm.getQwen,
            (chunk) => {
              res.write(`data: ${JSON.stringify({ chunk })}\n\n`);
            },
          );

          responseText = result.text || '';
          const tokens = estimateTokens(
            normalizedMessages.map((m: any) => m.content || '').join(' ') + ' ' + responseText
          );
          recordUsage(userId, tokens);
          res.write(`data: ${JSON.stringify({ done: true, text: responseText, toolCalls: result.toolCalls.length })}\n\n`);
          return res.end();
        }

        const result = await runWithTools(
          normalizedMessages,
          toolRegistry,
          { provider, model: model || 'gemini-2.0-flash', userId },
          undefined, 3,
          llm.getDeepSeek, llm.getGemini, llm.getOpenAI, llm.getAnthropic, llm.getQwen,
        );

        responseText = result.text || '';
        const tokens = estimateTokens(
          normalizedMessages.map((m: any) => m.content || '').join(' ') + ' ' + responseText
        );
        const usage = recordUsage(userId, tokens);
        return res.json({ text: responseText, usage, toolCalls: result.toolCalls.length });
      }

      res.json({ text: responseText });
    } catch (error: any) {
      console.error("AI Proxy Error:", error);
      res.status(500).json({ error: error.message });
    }
  });

  router.post("/ai/chat", optionalAuth, handleChat);
  router.post("/chat", optionalAuth, handleChat);

  router.post("/meeting/analyze", optionalAuth, asyncHandler(async (req, res) => {
    const { provider = "gemini", model, notes, startedAt, endedAt, language = "zh" } = req.body || {};
    const userId = req.user?.uid || 'anonymous';
    const noteItems = Array.isArray(notes) ? notes : [];
    const transcript = noteItems
      .map((note: any) => {
        const time = note?.time ? new Date(note.time).toLocaleTimeString() : '';
        const text = String(note?.text || '').trim();
        return text ? `[${time}] ${text}` : '';
      })
      .filter(Boolean)
      .join('\n');

    if (!transcript.trim()) {
      return res.status(400).json({ error: 'No meeting transcript to analyze' });
    }

    const access = checkLLMAccess({ userId, provider, model: model || '' });
    if (!access.allowed) {
      return res.status(402).json({ error: access.reason, code: access.tokenLimitReached ? 'TOKEN_LIMIT' : 'PROVIDER_RESTRICTED' });
    }

    const started = startedAt ? new Date(startedAt).toLocaleString() : 'unknown';
    const ended = endedAt ? new Date(endedAt).toLocaleString() : new Date().toLocaleString();
    const outputLanguage = language === 'zh' ? 'Chinese' : 'English';
    const prompt = [
      `You are Lumi acting as a meeting analyst. Output in ${outputLanguage}.`,
      'Do not call tools. Analyze only the transcript below.',
      'Create a practical meeting report with these sections:',
      '1. Meeting summary',
      '2. Key decisions',
      '3. Action items with owner if mentioned, otherwise mark owner as unassigned',
      '4. Risks / open questions',
      '5. Follow-up suggestions',
      '6. Raw transcript highlights',
      '',
      `Started: ${started}`,
      `Ended: ${ended}`,
      '',
      'Transcript:',
      transcript,
    ].join('\n');

    const result = await makeLLMCall(
      [{ role: 'user', content: prompt }],
      [],
      { provider, model: model || (provider === 'deepseek' ? 'deepseek-chat' : provider === 'qwen' ? 'qwen-plus' : 'gemini-2.0-flash'), maxTokens: 1800, userId },
      llm.getDeepSeek, llm.getGemini, llm.getOpenAI, llm.getAnthropic, llm.getQwen,
    );

    const report = result.text || '';
    const tokens = estimateTokens(prompt + ' ' + report);
    const usage = recordUsage(userId, tokens);
    res.json({ report, usage });
  }));
}
