import { Router } from "express";
import { requireAuth } from "../middleware/auth";
import {
  createPlan, updatePlan, updatePlanStep, listPlans, getPlan, deletePlan, getTodayPlanSummary,
} from "../autonomy/planner";
import {
  runFirstBootExploration, runDailyScan, getLatestExploration, getExplorationHistory, isFirstBootComplete,
} from "../autonomy/system_explorer";
import { getProfessionProfile, buildProfessionOverlay, detectProfession, saveProfessionProfile } from "../autonomy/professions";
import { installProfessionAgents, getProfessionTemplates } from "../autonomy/profession_templates";
import { readDB } from "../../db_layer";

export function mountExploreRoutes(router: Router) {
  router.get("/explore/status", (_req, res) => {
    const explored = isFirstBootComplete();
    const latest = getLatestExploration();
    res.json({ explored, latest });
  });

  router.post("/explore/scan", requireAuth, (_req, res) => {
    const result = runDailyScan();
    res.json({ scanned: !!result, snapshot: result });
  });

  router.get("/explore/history", (_req, res) => {
    const history = getExplorationHistory(30);
    res.json({ snapshots: history });
  });

  router.get("/explore/profession", (_req, res) => {
    const profiles = getProfessionProfile();
    const overlay = buildProfessionOverlay();
    res.json({ profiles, overlay });
  });

  router.post("/explore/profession/rescan", requireAuth, (_req, res) => {
    const db = readDB();
    const snapshots = (db as any).systemSnapshots || [];
    const latest = snapshots[snapshots.length - 1];
    const installedApps = latest?.software?.installedApps || [];
    const profiles = detectProfession(installedApps);
    if (profiles.length > 0) saveProfessionProfile(profiles);
    res.json({ profiles });
  });

  router.post("/explore/profession/install", requireAuth, (_req, res) => {
    const count = installProfessionAgents();
    const profiles = getProfessionProfile();
    res.json({ installed: count, profiles });
  });

  router.get("/explore/profession/templates/:profession", (req, res) => {
    const templates = getProfessionTemplates(req.params.profession);
    res.json({ templates });
  });
}

export function mountPlanRoutes(router: Router) {
  const guard = (fn: (req: any, res: any) => Promise<any>) => (req: any, res: any, next: any) =>
    Promise.resolve(fn(req, res)).catch(next);

  router.get("/plans", (_req, res) => {
    const { status, source, limit } = _req.query as any;
    res.json({ plans: listPlans({ status, source, limit: limit ? parseInt(limit) : undefined }) });
  });

  router.get("/plans/today", (_req, res) => {
    res.json({ summary: getTodayPlanSummary() });
  });

  router.get("/plans/:id", (req, res) => {
    const plan = getPlan(req.params.id);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    res.json({ plan });
  });

  router.post("/plans", requireAuth, guard(async (req, res) => {
    const { title, description, priority, steps, tags, source } = req.body;
    if (!title) return res.status(400).json({ error: "title required" });
    const plan = createPlan(title, description || "", source || "user", priority || "medium", steps || [], tags || []);
    res.json({ plan });
  }));

  router.put("/plans/:id", requireAuth, guard(async (req, res) => {
    const plan = updatePlan(req.params.id, req.body);
    if (!plan) return res.status(404).json({ error: "Plan not found" });
    res.json({ plan });
  }));

  router.put("/plans/:planId/steps/:stepId", requireAuth, guard(async (req, res) => {
    const plan = updatePlanStep(req.params.planId, req.params.stepId, req.body);
    if (!plan) return res.status(404).json({ error: "Plan or step not found" });
    res.json({ plan });
  }));

  router.delete("/plans/:id", requireAuth, (req, res) => {
    const ok = deletePlan(req.params.id);
    if (!ok) return res.status(404).json({ error: "Plan not found" });
    res.json({ deleted: true });
  });
}
