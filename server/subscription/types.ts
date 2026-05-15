// Subscription plan definitions and types

export interface SubscriptionPlan {
  id: string;
  name: string;
  tier: 'free' | 'light' | 'pro' | 'enterprise';
  monthlyTokens: number;        // Token cap per month
  llmProviders: string[];       // e.g. ['qwen', 'deepseek', 'gemini']
  sttIncluded: boolean;
  ttsIncluded: boolean;
  voiceCloneIncluded: boolean;
  memoryIncluded: boolean;
  agentCount: number;           // Max agents user can create
  priority: boolean;            // Priority queue for LLM calls
  priceCNY: number;             // 0 = free
  description: string;
}

export interface UserSubscription {
  userId: string;
  planId: string;
  status: 'active' | 'expired' | 'trial' | 'none';
  tokensUsedThisMonth: number;
  monthlyTokenCap: number;
  startedAt: string | null;
  expiresAt: string | null;
  trialEndsAt: string | null;
  activatedBy: string | null;   // Admin who activated
  createdAt: string;
  updatedAt: string;
}

export const PLANS: Record<string, SubscriptionPlan> = {
  free: {
    id: 'free',
    name: 'Free',
    tier: 'free',
    monthlyTokens: 500_000,
    llmProviders: ['qwen', 'deepseek'],
    sttIncluded: true,
    ttsIncluded: true,
    voiceCloneIncluded: false,
    memoryIncluded: true,
    agentCount: 1,
    priority: false,
    priceCNY: 0,
    description: 'Basic Lumi experience. One agent, Qwen LLM, speech in/out.',
  },
  light: {
    id: 'light',
    name: 'Light',
    tier: 'light',
    monthlyTokens: 2_000_000,
    llmProviders: ['qwen', 'deepseek'],
    sttIncluded: true,
    ttsIncluded: true,
    voiceCloneIncluded: false,
    memoryIncluded: true,
    agentCount: 3,
    priority: false,
    priceCNY: 29,
    description: 'Two LLMs, three agents. For daily productivity.',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    tier: 'pro',
    monthlyTokens: 10_000_000,
    llmProviders: ['qwen', 'deepseek', 'gemini', 'openai'],
    sttIncluded: true,
    ttsIncluded: true,
    voiceCloneIncluded: true,
    memoryIncluded: true,
    agentCount: 10,
    priority: true,
    priceCNY: 69,
    description: 'All LLMs, voice cloning, ten agents. For power users.',
  },
  enterprise: {
    id: 'enterprise',
    name: 'Enterprise',
    tier: 'enterprise',
    monthlyTokens: 50_000_000,
    llmProviders: ['qwen', 'deepseek', 'gemini', 'openai', 'anthropic'],
    sttIncluded: true,
    ttsIncluded: true,
    voiceCloneIncluded: true,
    memoryIncluded: true,
    agentCount: 50,
    priority: true,
    priceCNY: 199,
    description: 'All models unlimited, custom deployment, team agents, priority support.',
  },
};

export function getPlan(planId: string): SubscriptionPlan | undefined {
  return PLANS[planId];
}

export function getDefaultPlan(): SubscriptionPlan {
  return PLANS.free;
}
