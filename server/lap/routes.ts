import { Router } from 'express';
import { getLocalAgent, getAllSessions, getTasksForAgent, buildTaskListResponse, getActiveSharedContexts, removeSession } from './index';
import { getLAPPolicySnapshot } from './policy';

export const lapRoutes = Router();

// Get local agent identity
lapRoutes.get('/lap/identity', (_req, res) => {
  res.json(getLocalAgent());
});

// Get LAP collaboration policy and memory firewall rules.
lapRoutes.get('/lap/policy', (_req, res) => {
  res.json(getLAPPolicySnapshot());
});

// List all active LAP sessions
lapRoutes.get('/lap/sessions', (_req, res) => {
  const sessions = getAllSessions().map(s => ({
    sessionId: s.sessionId,
    peerA: { agentId: s.peerA.agentId, name: s.peerA.name, userId: s.peerA.userId },
    peerB: { agentId: s.peerB.agentId, name: s.peerB.name, userId: s.peerB.userId },
    trustLevel: s.trustLevel,
    scope: s.scope,
    establishedAt: s.establishedAt,
    lastHeartbeat: s.lastHeartbeat,
  }));
  res.json({ sessions, count: sessions.length });
});

// Get tasks for a specific agent
lapRoutes.get('/lap/tasks/:agentId', (req, res) => {
  const tasks = getTasksForAgent(req.params.agentId);
  res.json(buildTaskListResponse(tasks));
});

// Get shared contexts for a session
lapRoutes.get('/lap/contexts/:sessionId', (req, res) => {
  const contexts = getActiveSharedContexts(req.params.sessionId);
  res.json({ contexts, count: contexts.length });
});

// Revoke a session
lapRoutes.delete('/lap/sessions/:sessionId', (req, res) => {
  const ok = removeSession(req.params.sessionId);
  res.json({ success: ok, sessionId: req.params.sessionId });
});
