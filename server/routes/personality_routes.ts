import { Router } from "express";
import { personalityRegistry } from "../personality";
import { evolvePersonality } from "../personality/evolution";
import { loadEmotionalState } from "../personality/state";
import { readDB } from "../../db_layer";
import { optionalAuth } from "../middleware/auth";

export function mountPersonalityRoutes(router: Router, _jwtSecret: string, llm: {
  getDeepSeek: any; getGemini: any; getOpenAI: any; getAnthropic: any; getQwen: any;
}) {
  const asyncHandler = (fn: (req: any, res: any, next?: any) => Promise<any>) =>
    (req: any, res: any, next: any) => Promise.resolve(fn(req, res, next)).catch(next);

  router.get("/personalities", (_req, res) => {
    const lumi = personalityRegistry.get('lumi');
    res.json([lumi]);
  });

  router.get("/personalities/:id", (req, res) => {
    const config = personalityRegistry.get(req.params.id);
    if (!config) return res.status(404).json({ error: "Personality not found" });
    res.json(config);
  });

  router.get("/personality/:id/evolution", (req, res) => {
    const config = personalityRegistry.get(req.params.id);
    if (!config) return res.status(404).json({ error: "Personality not found" });
    const history = personalityRegistry.getEvolutionHistory(req.params.id);
    const evolutionConfig = personalityRegistry.getEvolutionConfig(req.params.id);
    res.json({
      personalityId: req.params.id,
      currentVector: config.personalityVector || null,
      version: config.version,
      growthState: config.growthState || null,
      evolutionFrozenAt: config.evolutionFrozenAt || null,
      evolutionConfig,
      history,
      audit: personalityRegistry.getEvolutionAudit(req.params.id),
    });
  });

  router.get("/personality/:id/evolution/audit", (req, res) => {
    const config = personalityRegistry.get(req.params.id);
    if (!config) return res.status(404).json({ error: "Personality not found" });
    res.json({
      personalityId: req.params.id,
      growthState: config.growthState || null,
      frozenAt: config.evolutionFrozenAt || null,
      audit: personalityRegistry.getEvolutionAudit(req.params.id),
    });
  });

  router.get("/personality/:id/growth-journal", optionalAuth, (req, res) => {
    try {
      const uid = req.user?.uid || 'anonymous';
      const db = readDB();
      const limit = parseInt(req.query.limit as string) || 14;

      const journalEntries = (db.memories || [])
        .filter((m: any) =>
          m.userId === uid &&
          m.keywords?.includes('growth_journal') &&
          m.type === 'knowledge'
        )
        .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, limit)
        .map((m: any) => ({
          id: m.id,
          content: m.content,
          date: m.createdAt?.slice(0, 10) || '',
          tier: m.tier,
        }));

      const dataEntries = (db.memories || [])
        .filter((m: any) =>
          m.userId === uid &&
          m.keywords?.includes('growth_journal_data')
        )
        .sort((a: any, b: any) => (b.createdAt || '').localeCompare(a.createdAt || ''))
        .slice(0, limit)
        .map((m: any) => {
          try {
            return { id: m.id, date: m.createdAt?.slice(0, 10) || '', data: JSON.parse(m.content) };
          } catch {
            return { id: m.id, date: m.createdAt?.slice(0, 10) || '', data: null };
          }
        });

      res.json({
        personalityId: req.params.id,
        journalEntries,
        statsEntries: dataEntries,
        count: journalEntries.length,
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  router.post("/personality/:id/evolve", optionalAuth, asyncHandler(async (req, res) => {
    try {
      const config = personalityRegistry.get(req.params.id);
      if (!config) return res.status(404).json({ error: "Personality not found" });
      if (personalityRegistry.isEvolutionFrozen(req.params.id)) {
        return res.status(409).json({ error: "Personality evolution is frozen. Unfreeze it before evolving." });
      }

      const uid = req.user?.uid || 'anonymous';
      const emotionalState = loadEmotionalState(uid);
      const evolutionConfig = personalityRegistry.getEvolutionConfig(req.params.id);

      const step = await evolvePersonality(
        config, uid, emotionalState.connection,
        llm.getDeepSeek, llm.getGemini, llm.getOpenAI, llm.getAnthropic, llm.getQwen,
        evolutionConfig,
      );

      if (!step) {
        return res.json({ evolved: false, reason: 'Evolution not needed or not ready. Check evolution config cooldown, connection score, and memory count.' });
      }

      const updated = personalityRegistry.applyEvolution(req.params.id, step);
      res.json({ evolved: true, version: step.version, narrative: step.narrative, mutations: step.mutations.length, config: updated });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  }));

  router.post("/personality/:id/evolution/freeze", (req, res) => {
    const frozen = req.body?.frozen !== false;
    const updated = personalityRegistry.setEvolutionFrozen(req.params.id, frozen);
    if (!updated) return res.status(404).json({ error: "Personality not found" });
    res.json({
      personalityId: req.params.id,
      frozen: Boolean(updated.evolutionFrozenAt),
      frozenAt: updated.evolutionFrozenAt || null,
    });
  });

  router.post("/personality/:id/evolution/revert", (req, res) => {
    const auditId = String(req.body?.auditId || '');
    if (!auditId) return res.status(400).json({ error: "auditId is required" });
    const updated = personalityRegistry.revertEvolution(req.params.id, auditId);
    if (!updated) return res.status(404).json({ error: "Evolution audit entry not found or not reversible" });
    res.json({
      personalityId: req.params.id,
      reverted: true,
      auditId,
      version: updated.version,
      growthState: updated.growthState || null,
      audit: personalityRegistry.getEvolutionAudit(req.params.id),
    });
  });
}
