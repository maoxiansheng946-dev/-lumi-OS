import { Router } from 'express';
import {
  getSubscriptionWithPlan,
  setSubscription,
  addTokensUsed,
  checkTokenLimit,
  listAllSubscriptions,
} from './db';
import { PLANS, getPlan } from './types';

const router = Router();

// Helper: extract user ID from JWT
function getUserId(req: any): string {
  try {
    const jwt = require('jsonwebtoken');
    let token = req.cookies?.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) {
      token = req.headers.authorization.slice(7);
    }
    if (token) return jwt.verify(token, process.env.JWT_SECRET || 'lumiOS_default_jwt_secret_2026_local').uid;
  } catch {}
  return 'anonymous';
}

// ── GET /subscription/status — current user's plan and usage ──
router.get('/subscription/status', (req, res) => {
  try {
    const userId = getUserId(req);
    const { subscription, plan } = getSubscriptionWithPlan(userId);
    const limit = checkTokenLimit(userId);

    res.json({
      subscription: {
        userId: subscription.userId,
        planId: subscription.planId,
        status: subscription.status,
        tokensUsedThisMonth: subscription.tokensUsedThisMonth,
        monthlyTokenCap: subscription.monthlyTokenCap,
        startedAt: subscription.startedAt,
        expiresAt: subscription.expiresAt,
        trialEndsAt: subscription.trialEndsAt,
      },
      plan,
      usage: limit,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /subscription/plans — list all available plans ──
router.get('/subscription/plans', (_req, res) => {
  res.json({ plans: Object.values(PLANS) });
});

// ── POST /subscription/activate — admin: activate/change user plan ──
router.post('/subscription/activate', (req, res) => {
  try {
    const adminId = getUserId(req);
    // Admin role check
    const db = require('../../db_layer').readDB();
    const adminUser = db.users.find((u: any) => u.uid === adminId);
    if (!adminUser || adminUser.role !== 'admin') {
      return res.status(403).json({ error: 'Admin access required' });
    }
    const { userId, planId, status, trialDays } = req.body;

    if (!userId || !planId) {
      return res.status(400).json({ error: 'userId and planId required' });
    }

    const plan = getPlan(planId);
    if (!plan) return res.status(400).json({ error: 'Invalid plan ID' });

    const updates: any = {
      planId,
      status: status || 'active',
      monthlyTokenCap: plan.monthlyTokens,
      activatedBy: adminId,
      startedAt: new Date().toISOString(),
    };

    if (trialDays) {
      updates.status = 'trial';
      updates.trialEndsAt = new Date(Date.now() + trialDays * 86400000).toISOString();
    }

    const sub = setSubscription(userId, updates);
    res.json({ success: true, subscription: sub, plan });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── GET /subscription/admin — admin: list all subscriptions ──
router.get('/subscription/admin', (req, res) => {
  try {
    const adminId = getUserId(req);
    const db = require('../../db_layer').readDB();
    const adminUser = db.users.find((u: any) => u.uid === adminId);
    if (!adminUser || adminUser.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
    const all = listAllSubscriptions();
    const enriched = all.map(sub => ({
      ...sub,
      plan: getPlan(sub.planId) || null,
      usagePercent: sub.monthlyTokenCap > 0
        ? Math.round((sub.tokensUsedThisMonth / sub.monthlyTokenCap) * 100)
        : 0,
    }));
    res.json({ subscriptions: enriched });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /subscription/tokens — proxy: record token usage ──
router.post('/subscription/tokens', (req, res) => {
  try {
    const userId = getUserId(req);
    const { tokens } = req.body;
    if (!tokens || typeof tokens !== 'number') {
      return res.status(400).json({ error: 'tokens (number) required' });
    }

    const { allowed, used, cap, remaining } = checkTokenLimit(userId);
    if (!allowed) {
      return res.status(429).json({ error: 'Token limit exceeded', used, cap, remaining: 0 });
    }

    const sub = addTokensUsed(userId, tokens);
    res.json({
      allowed: true,
      used: sub.tokensUsedThisMonth,
      cap: sub.monthlyTokenCap,
      remaining: Math.max(0, sub.monthlyTokenCap - sub.tokensUsedThisMonth),
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export { router as subscriptionRoutes, getUserId };
