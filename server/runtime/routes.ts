// Route aggregator — mounts all shared routes on the API router
import { Router } from "express";
import { Server } from "socket.io";
import { mountPersonalityRoutes } from "../routes/personality_routes";
import { mountMcpRoutes } from "../routes/mcp_routes";
import { mountDeviceRoutes } from "../routes/device_routes";
import { mountSystemRoutes } from "../routes/system_routes";
import { mountChatRoutes } from "../routes/chat_routes";
import { mountPreferencesRoutes } from "../routes/preferences_routes";
import { mountInteractionsRoutes } from "../routes/interactions_routes";
import { mountAuthRoutes } from "../routes/auth";
import { mountMemoryRoutes } from "../routes/memory_routes";
import { mountConversationRoutes } from "../routes/conversations";
import { mountAgentRoutes } from "../routes/agent_routes";
import { mountSkillRoutes } from "../routes/skill_routes";
import { mountMarketplaceRoutes } from "../routes/marketplace_routes";
import { mountMiscRoutes } from "../routes/misc_routes";
import { mountContactsRoutes } from "../routes/contacts_routes";
import { mountBranchConnectionRoutes } from "../routes/branch_routes";
import { mountNotificationRoutes } from "../routes/notifications";
import { mountCanvasRoutes } from "../routes/canvas_routes";
import { autonomyRoutes } from "../routes/autonomy_routes";
import { mountExploreRoutes, mountPlanRoutes } from "../routes/plan_explore_routes";
import { mountMusicRoutes } from "../routes/music_routes";

interface RouteContext {
  apiRouter: Router;
  jwtSecret: string;
  llm: {
    getDeepSeek: any; getGemini: any; getOpenAI: any; getAnthropic: any; getQwen: any; getArk: any; getGlm: any;
  };
  getCookieOptions: () => { httpOnly: true; secure: boolean; sameSite: "none" | "lax"; maxAge: number };
  io: Server;
}

export function mountAllRoutes({ apiRouter, jwtSecret, llm, getCookieOptions, io }: RouteContext) {
  const llmGetters = { getDeepSeek: llm.getDeepSeek, getGemini: llm.getGemini, getOpenAI: llm.getOpenAI, getAnthropic: llm.getAnthropic, getQwen: llm.getQwen, getArk: llm.getArk, getGlm: llm.getGlm };

  // Personality, MCP, Device management
  mountPersonalityRoutes(apiRouter, jwtSecret, llmGetters);
  mountMcpRoutes(apiRouter);
  mountDeviceRoutes(apiRouter, jwtSecret);

  // System routes (health, tools, llm, settings, stats, ecosystem, modules)
  mountSystemRoutes(apiRouter, jwtSecret, io);

  // AI Chat
  mountChatRoutes(apiRouter, jwtSecret, llmGetters);

  // Auth
  mountAuthRoutes(apiRouter, jwtSecret, getCookieOptions);

  // Agents
  mountAgentRoutes(apiRouter, jwtSecret, llmGetters);

  // Preferences & Interactions
  mountPreferencesRoutes(apiRouter, jwtSecret);
  mountInteractionsRoutes(apiRouter, jwtSecret);

  // Memory & Conversation
  mountMemoryRoutes(apiRouter, jwtSecret, llmGetters);
  mountConversationRoutes(apiRouter, jwtSecret);

  // Skills & Marketplace
  mountSkillRoutes(apiRouter, jwtSecret, llmGetters, io);
  mountMarketplaceRoutes(apiRouter, jwtSecret, io);

  // Contacts
  mountContactsRoutes(apiRouter, jwtSecret);

  // Branch connection (employee→company)
  mountBranchConnectionRoutes(apiRouter, jwtSecret);

  // Notifications
  mountNotificationRoutes(apiRouter);

  // Canvas Workbench
  mountCanvasRoutes(apiRouter, jwtSecret);

  // System Exploration & Plans
  mountExploreRoutes(apiRouter);
  mountPlanRoutes(apiRouter);

  // Music profile and library analysis
  mountMusicRoutes(apiRouter);

  // Autonomy
  apiRouter.use('/autonomy', autonomyRoutes());

  // Misc (founder vision, feedback, admin config, Org chat)
  mountMiscRoutes(apiRouter, jwtSecret, llmGetters);
}
