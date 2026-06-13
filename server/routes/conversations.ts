import { Router } from "express";
import { requireAuth, optionalAuth } from "../middleware/auth";
import { readDB, writeDB } from "../../db_layer";
import {
  getUserConversations,
  getMessages,
  closeConversation,
  getActiveConversation,
} from "../conversation/manager";

export function mountConversationRoutes(router: Router, _jwtSecret: string) {
  router.get("/conversations", requireAuth, (req, res) => {
    const limit = parseInt(req.query.limit as string) || 20;
    const offset = parseInt(req.query.offset as string) || 0;
    const conversations = getUserConversations(req.user!.uid, limit, offset, req.user!.orgId);
    res.json({ conversations, limit, offset });
  });

  router.get("/conversations/active", requireAuth, (req, res) => {
    const activeConversation = getActiveConversation(req.user!.uid, undefined, req.user!.orgId);
    res.json({ activeConversation });
  });

  router.get("/conversations/:id/messages", requireAuth, (req, res) => {
    const db = readDB();
    const conv = (db.conversations || []).find((c: any) => c.id === req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    // Ownership check
    if (conv.userId !== req.user!.uid) return res.status(403).json({ error: "Unauthorized" });
    // Domain check
    if (req.user!.orgId) {
      if (conv.orgId !== req.user!.orgId) return res.status(403).json({ error: "Unauthorized" });
    } else {
      if (conv.orgId && conv.orgId !== '') return res.status(403).json({ error: "Unauthorized" });
    }
    const limit = parseInt(req.query.limit as string) || 50;
    const messages = getMessages(req.params.id, limit);
    res.json({ messages });
  });

  router.post("/conversations/:id/close", requireAuth, (req, res) => {
    const db = readDB();
    const conv = (db.conversations || []).find((c: any) => c.id === req.params.id);
    if (!conv) return res.status(404).json({ error: "Conversation not found" });
    if (conv.userId !== req.user!.uid) return res.status(403).json({ error: "Unauthorized" });
    if (req.user!.orgId) {
      if (conv.orgId !== req.user!.orgId) return res.status(403).json({ error: "Unauthorized" });
    } else {
      if (conv.orgId && conv.orgId !== '') return res.status(403).json({ error: "Unauthorized" });
    }
    const { summary } = req.body || {};
    const closed = closeConversation(req.params.id, summary);
    if (!closed) return res.status(404).json({ error: "Conversation not found" });
    res.json({ success: true, conversation: closed });
  });

  router.delete("/conversations/:id", requireAuth, (req, res) => {
    const db = readDB();
    if (!db.conversations) return res.status(404).json({ error: "Not found" });
    const conv = db.conversations.find((c: any) => c.id === req.params.id);
    if (!conv) return res.status(404).json({ error: "Not found" });
    // Ownership + domain check
    if (conv.userId !== req.user!.uid) return res.status(403).json({ error: "Unauthorized" });
    if (req.user!.orgId) {
      if (conv.orgId !== req.user!.orgId) return res.status(403).json({ error: "Unauthorized" });
    } else {
      if (conv.orgId && conv.orgId !== '') return res.status(403).json({ error: "Unauthorized" });
    }
    const idx = db.conversations.findIndex((c: any) => c.id === req.params.id);
    db.conversations.splice(idx, 1);
    if (db.interactions) {
      db.interactions = db.interactions.filter((i: any) => i.conversationId !== req.params.id);
    }
    writeDB(db);
    res.json({ success: true });
  });
}
