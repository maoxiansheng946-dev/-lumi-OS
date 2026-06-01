// Messaging integrations (Feishu, WeCom, etc.)
import { Router } from "express";
import { createMessagingRoutes, createWeComRoutes } from "../messaging";
import { getMessagingConfig } from "../messaging/config";
import { personalityRegistry } from "../personality";
import { queryMemories } from "../memory";
import { loadEmotionalState } from "../personality/state";

export function setupMessaging(
  apiRouter: Router,
  llm: { getDeepSeek: any; getGemini: any; getOpenAI: any; getAnthropic: any; getQwen: any },
) {
  const cfg = getMessagingConfig();
  const llmGetters = { getDeepSeek: llm.getDeepSeek, getGemini: llm.getGemini, getOpenAI: llm.getOpenAI, getAnthropic: llm.getAnthropic, getQwen: llm.getQwen };

  // Always mount messaging routes so UI can save config even before env vars are set
  // Feishu
  apiRouter.use("/", createMessagingRoutes(cfg.feishu, {
    llmGetters,
    personalityRegistry,
    queryMemories,
    loadEmotionalState,
  }));
  console.log(cfg.feishu?.appId && cfg.feishu?.appSecret ? '[Feishu] Active' : '[Feishu] Mounted (not configured)');

  // WeCom
  apiRouter.use("/", createWeComRoutes(cfg.wecom, {
    llmGetters,
    personalityRegistry,
    queryMemories,
    loadEmotionalState,
  }));
  console.log(cfg.wecom?.corpId && cfg.wecom?.appSecret ? '[WeCom] Active' : '[WeCom] Mounted (not configured)');
}
