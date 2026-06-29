// WeChat ClawBot routes — QR login + status + config
import { Router } from 'express';
import { WeChatClawBotAdapter, type WeChatClawBotConfig } from './wechat-clawbot';
import { getMessagingConfig, updateMessagingConfig } from './config';
import { requireAuth } from '../middleware/auth';
import type { MessageHandler } from './types';
import { makeLLMCall, type NormalizedMessage } from '../llm/providers';
import { getUserPreferredLLMConfig } from '../llm/user_preferences';

export function createWeChatRoutes(
  config: WeChatClawBotConfig,
  options?: {
    onMessage?: MessageHandler;
    llmGetters?: Record<string, () => any>;
    personalityRegistry?: any;
    queryMemories?: (opts: { userId: string; query: string; limit: number; minConfidence: number }) => any[];
    loadEmotionalState?: (userId: string) => any;
  },
): Router {
  const router = Router();
  const adapter = new WeChatClawBotAdapter(config);

  // ── GET /wechat/qrcode — get login QR code ──
  router.get('/wechat/qrcode', requireAuth, async (_req, res) => {
    try {
      const qr = await adapter.getQRCode();
      res.json(qr);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /wechat/qrcode/status — poll QR scan status ──
  router.get('/wechat/qrcode/status', requireAuth, async (req, res) => {
    try {
      const qrId = req.query.qrcode_id as string;
      if (!qrId) return res.status(400).json({ error: 'qrcode_id required' });
      const status = await adapter.checkQRCodeStatus(qrId);
      if (status.status === 'confirmed' && status.bot_token) {
        // Derive botId from botToken if not returned: format is "xxx@im.bot:token"
        const botId = status.bot_id || (status.bot_token.split(':')[0] || status.bot_token);
        const conf = {
          botToken: status.bot_token,
          botId,
          baseUrl: status.baseurl || 'https://ilinkai.weixin.qq.com',
          enabled: true,
        };
        // Persist the login credentials
        updateMessagingConfig({ wechat: conf });
        Object.assign(config, conf);
        adapter.reload(config);
        // Start polling in background
        startWeChatPolling(adapter, config, options);
      }
      res.json(status);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // ── GET /wechat/status — connection status ──
  router.get('/wechat/status', (_req, res) => {
    res.json({
      platform: 'wechat',
      configured: !!(config.botToken && config.botId),
      listening: adapter.isPolling(),
      botId: config.botId ? `${config.botId.slice(0, 12)}...` : null,
    });
  });

  // ── GET /wechat/config ──
  router.get('/wechat/config', requireAuth, (_req, res) => {
    res.json({
      botId: config.botId,
      hasToken: !!config.botToken,
      enabled: !!(config.botToken && config.botId),
    });
  });

  // ── POST /wechat/config — manual config override ──
  router.post('/wechat/config', requireAuth, async (req, res) => {
    try {
      const { botToken, botId } = req.body;
      const updated = updateMessagingConfig({ wechat: { botToken, botId, baseUrl: 'https://ilinkai.weixin.qq.com' } });
      Object.assign(config, updated.wechat);
      adapter.reload(config);
      if (updated.wechat.enabled) {
        startWeChatPolling(adapter, config, options);
      } else {
        adapter.stopPolling();
      }
      res.json({ success: true, configured: updated.wechat.enabled });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // Auto-start polling if already configured (survives restarts)
  if (config?.botToken) {
    if (!config.botId) config.botId = (config.botToken.split(':')[0] || config.botToken);
    console.log('[WeChat] Already logged in — botId:', config.botId?.slice(0,12)+'...', 'starting poll loop');
    startWeChatPolling(adapter, config, options);
  }

  return router;
}

// ── Polling + AI reply pipeline ──

function startWeChatPolling(
  adapter: WeChatClawBotAdapter,
  _config: WeChatClawBotConfig,
  options?: {
    onMessage?: MessageHandler;
    llmGetters?: Record<string, () => any>;
    personalityRegistry?: any;
    queryMemories?: (opts: { userId: string; query: string; limit: number; minConfidence: number }) => any[];
    loadEmotionalState?: (userId: string) => any;
  },
): void {
  adapter.startPolling(async (msg) => {
    if (options?.onMessage) {
      return options.onMessage(msg);
    }
    const reply = await processWeChatMessage(msg, options);
    return reply ? { text: reply.text, platform: 'wechat' as const } : null;
  });
}

// Simplified AI reply via the user's selected main LLM.

const DEFAULT_SYSTEM_PROMPT = `你是一个名为 Lumi 的 AI 助手，通过微信与用户交流。保持回复简洁、温暖、有帮助。用中文回复。`;

async function processWeChatMessage(
  msg: { userId: string; text: string },
  options?: { llmGetters?: Record<string, () => any> },
): Promise<{ text: string } | null> {
  const llm = options?.llmGetters;
  if (!llm) return { text: `收到你的消息："${msg.text.slice(0, 60)}"。当前 AI 服务未配置。` };

  try {
    const config = getUserPreferredLLMConfig(msg.userId || 'anonymous', { maxTokens: 500 });
    const messages: NormalizedMessage[] = [
      { role: 'system', content: DEFAULT_SYSTEM_PROMPT },
      { role: 'user', content: msg.text },
    ];
    const response = await makeLLMCall(
      messages,
      [],
      config,
      llm.getDeepSeek,
      llm.getGemini,
      llm.getOpenAI,
      llm.getAnthropic,
      llm.getQwen,
    );
    const text = response.text?.trim();
    if (text) return { text: text.slice(0, 500) };
  } catch (err: any) {
    console.warn(`[WeChat] Main LLM failed:`, err.message);
  }

  return { text: `收到你的消息："${msg.text.slice(0, 60)}"。当前主推理服务不可用，请稍后再试。` };
}
