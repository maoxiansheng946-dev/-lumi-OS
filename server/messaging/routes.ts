/**
 * Feishu Messaging Routes — webhook receiver + send endpoints.
 *
 * Feishu Event Subscription flow:
 *   1. POST /api/feishu/events — receives all subscribed events
 *   2. URL verification: Feishu sends { type: "url_verification", challenge: "..." }
 *      → respond with { challenge: "..." } within 1 second
 *   3. Message events: parse → process via LLM with Lumi personality → reply
 */
import { Router } from 'express';
import { FeishuAdapter } from './feishu';
import type { FeishuConfig } from './feishu';
import type { IncomingMessage, MessageHandler } from './types';
import { getMessagingConfig, updateMessagingConfig } from './config';
import { readDB } from '../../db_layer';
import { requireAuth } from '../middleware/auth';

// Dedup cache: prevent duplicate processing when Feishu retries events
// Feishu retries if no 200 within 1s, but AI reply may take 5-30s
const recentMessages = new Map<string, number>();
const DEDUP_TTL_MS = 5 * 60 * 1000; // 5 min
function isDuplicate(messageId: string): boolean {
  const now = Date.now();
  // Cleanup stale entries
  for (const [id, ts] of recentMessages) {
    if (now - ts > DEDUP_TTL_MS) recentMessages.delete(id);
  }
  if (recentMessages.has(messageId)) return true;
  recentMessages.set(messageId, now);
  return false;
}

export function createMessagingRoutes(
  feishuConfig: FeishuConfig,
  options?: {
    onMessage?: MessageHandler;
    llmGetters?: {
      getDeepSeek?: () => any;
      getGemini?: () => any;
      getOpenAI?: () => any;
      getAnthropic?: () => any;
      getQwen?: () => any;
    };
    personalityRegistry?: any;
    queryMemories?: (opts: { userId: string; query: string; limit: number; minConfidence: number }) => any[];
    loadEmotionalState?: (userId: string) => any;
  },
): Router {
  const router = Router();
  const adapter = new FeishuAdapter(feishuConfig);

  router.post('/feishu/events', async (req, res) => {
    try {
      const body = req.body;

      // URL verification challenge
      if (body.type === 'url_verification' || body.event?.type === 'url_verification') {
        const challenge = body.challenge || body.event?.challenge;
        if (challenge) {
          console.log('[Feishu] URL verification challenge received');
          return res.json({ challenge });
        }
        return res.status(400).json({ error: 'Missing challenge token' });
      }

      const msg = adapter.parseEvent(body);
      if (!msg) {
        return res.json({ code: 0 });
      }

      // Dedup: Feishu retries events if no ack, but we process async below
      if (isDuplicate(msg.messageId)) {
        console.log(`[Feishu] Ignoring duplicate: ${msg.messageId}`);
        return res.json({ code: 0 });
      }

      console.log(`[Feishu] ${msg.userName} (${msg.chatType}): ${msg.text.slice(0, 80)}`);

      // Respond to Feishu IMMEDIATELY (must be < 1s), process AI reply async
      res.json({ code: 0 });

      if (options?.onMessage) {
        const reply = await options.onMessage(msg);
        if (reply) {
          await adapter.replyMessage(msg.messageId, reply.text).catch(() =>
            adapter.sendMessage(msg.chatId, { text: reply.text, platform: 'feishu' }));
        }
      } else {
        const replyText = await processWithPersonality(msg, options);
        // Prefer replying to the specific message, fallback to sending to chat
        await adapter.replyMessage(msg.messageId, replyText).catch(() =>
          adapter.sendMessage(msg.chatId, { text: replyText, platform: 'feishu' }));
      }
    } catch (err: any) {
      console.error('[Feishu] Event error:', err.message);
      if (!res.headersSent) {
        res.json({ code: -1, msg: err.message });
      }
    }
  });

  // ── POST /feishu/send — manual send (for testing / admin) ──
  router.post('/feishu/send', async (req, res) => {
    try {
      const { chatId, text, card } = req.body;
      if (!chatId) return res.status(400).json({ error: 'chatId required' });
      if (!text && !card) return res.status(400).json({ error: 'text or card required' });

      let messageId: string;
      if (card) {
        messageId = await adapter.sendCard(chatId, card);
      } else {
        messageId = await adapter.sendMessage(chatId, { text, platform: 'feishu' });
      }

      res.json({ success: true, messageId });
    } catch (err: any) {
      console.error('[Feishu] Send error:', err.message);
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /feishu/status — health check ──
  router.get('/feishu/status', (_req, res) => {
    const cfg = getMessagingConfig().feishu;
    res.json({
      platform: 'feishu',
      configured: cfg.enabled,
      appId: cfg.appId ? `${cfg.appId.slice(0, 8)}...` : null,
      hasSecret: !!cfg.appSecret,
    });
  });

  // ── GET /feishu/config — full config (masked) ──
  router.get('/feishu/config', requireAuth, (_req, res) => {
    const cfg = getMessagingConfig().feishu;
    res.json({
      appId: cfg.appId,
      appIdMasked: cfg.appId ? `${cfg.appId.slice(0, 8)}...` : '',
      hasSecret: !!cfg.appSecret,
      verificationToken: cfg.verificationToken ? '***' : undefined,
      enabled: cfg.enabled,
    });
  });

  // ── POST /feishu/config — update config ──
  router.post('/feishu/config', requireAuth, async (req, res) => {
    try {
      const { appId, appSecret, verificationToken } = req.body;
      const updated = updateMessagingConfig({ appId, appSecret, verificationToken });
      // Reload adapter with new config
      const newConfig = { appId: updated.feishu.appId, appSecret: updated.feishu.appSecret, verificationToken: updated.feishu.verificationToken };
      Object.assign(feishuConfig, newConfig);
      adapter.reload?.(newConfig);
      res.json({ success: true, configured: updated.feishu.enabled, appId: updated.feishu.appId ? `${updated.feishu.appId.slice(0, 8)}...` : '' });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}

// ── AI reply pipeline — powered by Lumi personality ──

async function processWithPersonality(
  msg: IncomingMessage,
  options?: {
    llmGetters?: Record<string, () => any>;
    personalityRegistry?: any;
    queryMemories?: (opts: { userId: string; query: string; limit: number; minConfidence: number }) => any[];
    loadEmotionalState?: (userId: string) => any;
  },
): Promise<string> {
  const llm = options?.llmGetters;
  const registry = options?.personalityRegistry;

  // ── Build system prompt from Lumi personality ──
  let systemPrompt = '';
  let personality: any = null;

  if (registry) {
    try {
      const memories = options?.queryMemories
        ? options.queryMemories({ userId: msg.userId, query: msg.text, limit: 5, minConfidence: 0.4 })
        : [];
      const emotionalState = options?.loadEmotionalState ? options.loadEmotionalState(msg.userId) : undefined;

      const result = registry.buildSystemPrompt(
        'lumi',
        { mode: 'chat', sensory: { hasAudio: false, hasVideo: false, hasSpatial: false, hasHaptic: false, hasHolographic: false, activeDeviceTypes: [], deviceCount: 0 } },
        {
          memories: memories.length > 0 ? memories : undefined,
          emotionalState,
          userId: msg.userId,
        },
      );
      personality = result.config;
      systemPrompt = result.systemPrompt;
    } catch (err: any) {
      console.warn('[Feishu] Personality build failed, using fallback:', err.message);
    }
  }

  if (!systemPrompt) {
    systemPrompt = `你是一个名为 Lumi 的 AI 助手，通过飞书与用户交流。保持回复简洁、有帮助、自然。`;
  }

  // ── Determine model order from user LLM prefs ──
  const userLLMPrefs = (() => {
    try {
      const db = readDB();
      const setting = (db.settings || []).find((s: any) => s.key === `llm_prefs_${msg.userId}`);
      if (setting) return JSON.parse(setting.value);
    } catch {}
    return { provider: '', models: {} };
  })();
  const DEFAULT_MODELS: Record<string, string> = {
    deepseek: 'deepseek-chat', qwen: 'qwen-plus', openai: 'gpt-4o',
    gemini: 'gemini-2.0-flash', anthropic: 'claude-sonnet-4-6',
  };
  const activeProvider = userLLMPrefs.provider || 'deepseek';
  const activeModel = (userLLMPrefs.models || {})[activeProvider] || DEFAULT_MODELS[activeProvider] || 'deepseek-chat';

  // Build fallback candidates from all user-configured models
  const fallbackCandidates = Object.entries(userLLMPrefs.models || {})
    .filter(([p]) => p !== activeProvider)
    .map(([p, m]) => ({ provider: p, model: m as string }));

  const modelProviders = resolveProviderOrder(activeProvider, activeModel, fallbackCandidates, llm);

  for (const { getter, model } of modelProviders) {
    try {
      const client = getter();
      if (!client) continue;

      if (model.includes('gemini')) {
        const genAI = client;
        const modelInstance = genAI.getGenerativeModel({ model, systemInstruction: systemPrompt });
        const result = await modelInstance.generateContent({
          contents: [{ role: 'user', parts: [{ text: msg.text }] }],
        });
        const text = result.response.text();
        if (text) return text;
      } else {
        const response = await client.chat.completions.create({
          model,
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: msg.text },
          ],
        });
        const text = response.choices?.[0]?.message?.content;
        if (text) return text;
      }
    } catch (err: any) {
      console.warn(`[Feishu] Model ${model} failed:`, err.message);
    }
  }

  return `收到你的消息："${msg.text.slice(0, 100)}"。当前暂无 AI 回复，请稍后再试。`;
}

function resolveProviderOrder(
  activeProvider: string,
  activeModel: string,
  fallbackCandidates: { provider: string; model: string }[],
  llmGetters?: Record<string, () => any>,
): { getter: () => any; model: string }[] {
  const keyMap: Record<string, string> = {
    qwen: 'getQwen', deepseek: 'getDeepSeek', gemini: 'getGemini',
    openai: 'getOpenAI', anthropic: 'getAnthropic',
  };

  const ordered: { getter: () => any; model: string }[] = [];
  const seen = new Set<string>();

  // Active provider first
  const getterKey = keyMap[activeProvider];
  if (getterKey && llmGetters?.[getterKey]) {
    ordered.push({ getter: llmGetters[getterKey], model: activeModel });
    seen.add(getterKey);
  }

  // User's other configured models as fallbacks
  for (const { provider, model } of fallbackCandidates) {
    const gk = keyMap[provider];
    if (gk && llmGetters?.[gk] && !seen.has(gk)) {
      ordered.push({ getter: llmGetters[gk], model });
      seen.add(gk);
    }
  }

  // Remaining providers as additional fallbacks with default models
  const defaults: Record<string, string> = {
    getQwen: 'qwen-plus', getDeepSeek: 'deepseek-chat', getGemini: 'gemini-2.0-flash',
    getOpenAI: 'gpt-4o', getAnthropic: 'claude-sonnet-4-6',
  };
  for (const [key, model] of Object.entries(defaults)) {
    if (!seen.has(key) && llmGetters?.[key]) {
      ordered.push({ getter: llmGetters[key], model });
      seen.add(key);
    }
  }

  return ordered;
}
