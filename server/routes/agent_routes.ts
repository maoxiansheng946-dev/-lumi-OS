import { Router, Request, Response, NextFunction } from "express";
import jwt from "jsonwebtoken";
import { readDB, writeDB } from "../../db_layer";
import { getOrCreateActiveConversation, getActiveConversation, getMessages, addMessage } from "../conversation/manager";
import { getKey } from "../config/keys";
import { makeLLMCall, NormalizedMessage } from "../llm/providers";

const asyncHandler = (fn: (req: Request, res: Response, next?: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) =>
    Promise.resolve(fn(req, res, next)).catch(next);

export function mountAgentRoutes(
  router: Router,
  jwtSecret: string,
  llmGetters: {
    getDeepSeek: () => any;
    getGemini: () => any;
    getOpenAI?: () => any;
    getAnthropic?: () => any;
    getQwen?: () => any;
  },
) {
  // ── Agent Distillation — create a memory avatar from chat records ──
  router.post("/agents/distill", asyncHandler(async (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    let uid: string;
    try { uid = (jwt.verify(token, jwtSecret) as any).uid; } catch { return res.status(401).json({ error: "Invalid token" }); }

    const { chatLog, format, relationshipType, name: targetName, audioTranscript } = req.body || {};
    if (!chatLog || !format) {
      return res.status(400).json({ error: "chatLog and format are required" });
    }
    if (!['wechat', 'qq', 'plain'].includes(format)) {
      return res.status(400).json({ error: "format must be: wechat, qq, or plain" });
    }

    try {
      const { distillPersona } = await import('../agents/distiller');
      const result = await distillPersona(
        { chatLog, format, targetName, relationshipType, userId: uid },
        { getDeepSeek: llmGetters.getDeepSeek, getGemini: llmGetters.getGemini, getOpenAI: llmGetters.getOpenAI, getAnthropic: llmGetters.getAnthropic, getQwen: llmGetters.getQwen },
      );

      res.json({
        personalityConfig: result.personalityConfig,
        seedMemories: result.seedMemories,
        evidenceMap: result.evidenceMap,
        relationshipType: result.relationshipType,
        narrative: result.narrative,
        inferredName: result.inferredName,
        // Summary for quick preview
        summary: {
          messageCount: chatLog.split('\n').filter((l: string) => l.trim()).length,
          memoryCount: result.seedMemories.length,
          cognitiveStyle: result.personalityConfig.personalityVector?.cognitiveStyle,
          socialStyle: result.personalityConfig.personalityVector?.socialStyle,
          tone: result.personalityConfig.expressionStyle.tone,
          topPhrases: result.personalityConfig.expressionStyle.vocabularyHints?.slice(0, 5),
        },
      });
    } catch (err: any) {
      console.error('[Distill] Failed:', err.message);
      res.status(500).json({ error: err.message || 'Distillation failed' });
    }
  }));

  // List sanctuary agents for the current user
  router.get("/agents/sanctuaries", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });
    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const db = readDB();
      const sanctuaries = (db.agents || []).filter(
        (a: any) => a.ownerUid === decoded.uid && a.territory === 'sanctuary'
      ).map((a: any) => ({
        id: a.id,
        name: a.name,
        relationshipType: a.relationshipType || 'close_friend',
        isFrozen: a.isFrozen ?? true,
        memoryCount: (db.memories || []).filter((m: any) => m.agentId === a.id).length,
        createdAt: a.createdAt,
        lastActiveAt: a.lastActiveAt,
      }));
      res.json({ sanctuaries });
    } catch {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  router.get("/agents/:id/history", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { id } = req.params;
      const db = readDB();

      // Verify agent ownership or check if it's a default agent
      const isDefaultAgent = ['lumi', 'lumi_default', 'scholar_default', 'founder_default', 'incubated'].includes(id);
      const agent = isDefaultAgent ? true : db.agents.find((a: any) => a.id === id && a.ownerUid === decoded.uid);
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      // Load from persisted interactions via conversation manager
      const conv = getActiveConversation(decoded.uid, id);
      const messages = conv ? getMessages(conv.id, 100) : [];
      const history = messages.map((m: any) => ({
        role: m.role,
        content: m.content || m.message || '',
      }));
      res.json(history);
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  router.post("/agents/:id/history", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { id } = req.params;
      const { messages } = req.body;
      const db = readDB();

      // Verify agent ownership or check if it's a default agent
      const isDefaultAgent = ['lumi', 'lumi_default', 'scholar_default', 'founder_default', 'incubated'].includes(id);
      const agent = isDefaultAgent ? true : db.agents.find((a: any) => a.id === id && a.ownerUid === decoded.uid);
      if (!agent) return res.status(404).json({ error: "Agent not found" });

      // Save via conversation manager (persisted to interactions)
      const conv = getOrCreateActiveConversation(decoded.uid, id);
      if (Array.isArray(messages)) {
        for (const msg of messages) {
          addMessage({
            userId: decoded.uid,
            agentId: id,
            conversationId: conv.id,
            role: msg.role || 'user',
            content: msg.content || '',
          });
        }
      }
      res.json({ success: true, conversationId: conv.id });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  router.get("/agents", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const db = readDB();
      const userAgents = db.agents.filter((a: any) => a.ownerUid === decoded.uid && !a.id.startsWith('ephemeral_'));
      res.json(userAgents);
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  router.post("/agents", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { name, category, data, personalityId, modelPreference, memoryScope, autonomyLevel, territory, distilledFrom, evidenceMap, relationshipType, isFrozen, seedMemoryIds, executionMode } = req.body;
      const db = readDB();

      // Sanctuary agents always get private memory scope and frozen evolution
      const isSanctuary = territory === 'sanctuary';

      const newAgent: any = {
        id: Math.random().toString(36).substring(2, 15),
        ownerUid: decoded.uid,
        name,
        category: category || (relationshipType || 'friend'),
        data: data || '{}',
        status: "active",
        personalityId: personalityId || 'lumi',
        modelPreference: modelPreference || '',
        memoryScope: isSanctuary ? 'private' : (memoryScope || 'shared'),
        autonomyLevel: isSanctuary ? 'reactive' : (autonomyLevel || 'reactive'),
        runtimeConfig: '{}',
        territory: territory || 'open',
        distilledFrom: distilledFrom || '',
        evidenceMap: evidenceMap || [],
        relationshipType: relationshipType || '',
        isFrozen: isFrozen ?? isSanctuary,
        seedMemoryIds: seedMemoryIds || [],
        executionMode: executionMode || '',
        createdAt: new Date().toISOString(),
        lastActiveAt: new Date().toISOString(),
        skillTags: [],
        knowledgeDomains: [],
        allowCrossPollination: !isSanctuary,
      };

      db.agents.push(newAgent);
      writeDB(db);
      res.json(newAgent);
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  router.delete("/agents/:id", (req, res) => {
    const token = req.cookies.token;
    if (!token) return res.status(401).json({ error: "Unauthorized" });

    try {
      const decoded: any = jwt.verify(token, jwtSecret);
      const { id } = req.params;
      const db = readDB();

      const agentIndex = db.agents.findIndex((a: any) => a.id === id && a.ownerUid === decoded.uid);
      if (agentIndex === -1) {
        return res.status(404).json({ error: "Agent not found or unauthorized" });
      }

      db.agents.splice(agentIndex, 1);
      writeDB(db);
      res.json({ success: true });
    } catch (e) {
      res.status(401).json({ error: "Invalid token" });
    }
  });

  // ── Audio Transcription — transcribe uploaded audio files for distillation ──
  router.post("/audio/transcribe", asyncHandler(async (req, res) => {
    const { audio, fileName } = req.body || {};
    if (!audio) return res.status(400).json({ error: "Audio data is required" });

    try {
      // Try Deepgram pre-recorded API first
      const dgKey = process.env.DEEPGRAM_API_KEY || getKey('DEEPGRAM_API_KEY');
      if (dgKey) {
        const buffer = Buffer.from(audio, 'base64');
        const dgRes = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=zh&punctuate=true', {
          method: 'POST',
          headers: {
            'Authorization': `Token ${dgKey}`,
            'Content-Type': fileName?.endsWith('.wav') ? 'audio/wav' :
                            fileName?.endsWith('.ogg') ? 'audio/ogg' :
                            fileName?.endsWith('.m4a') ? 'audio/mp4' :
                            'audio/mp3',
          },
          body: buffer,
        });
        if (dgRes.ok) {
          const data = await dgRes.json() as any;
          const text = data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '';
          return res.json({ text });
        }
      }

      // Fallback: try Qwen SenseVoice via DashScope
      const qwenKey = process.env.DASHSCOPE_API_KEY || getKey('DASHSCOPE_API_KEY');
      if (qwenKey) {
        const buffer = Buffer.from(audio, 'base64');
        const form = new FormData();
        form.append('model', 'sensevoice-v1');
        form.append('file', new Blob([buffer]), fileName || 'audio.mp3');
        const qwRes = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', {
          method: 'POST',
          headers: { 'Authorization': `Bearer ${qwenKey}` },
          body: form,
        });
        if (qwRes.ok) {
          const data = await qwRes.json() as any;
          const text = data?.output?.sentence?.text || '';
          return res.json({ text });
        }
      }

      res.json({ text: '', note: 'No STT provider configured (set DEEPGRAM_API_KEY or DASHSCOPE_API_KEY)' });
    } catch (err: any) {
      console.error('[Audio Transcribe] Error:', err.message);
      res.json({ text: '', error: err.message });
    }
  }));

  // ── Pet Generation — generate a custom desktop pet spritesheet from description ──
  router.post("/pets/generate", asyncHandler(async (req, res) => {
    const { prompt, mode } = req.body || {};
    if (!prompt?.trim()) return res.status(400).json({ error: "Prompt is required" });

    const lower = prompt.toLowerCase();
    const colorMap: Record<string, { body: string; bodyDark: string; accent: string; belly: string }> = {
      white:  { body: '#f0f0f0', bodyDark: '#d0d0d0', accent: '#e8e8e8', belly: '#ffffff' },
      black:  { body: '#3a3a3a', bodyDark: '#222222', accent: '#4a4a4a', belly: '#555555' },
      red:    { body: '#e85545', bodyDark: '#b83020', accent: '#f07060', belly: '#ffd4cc' },
      blue:   { body: '#5599dd', bodyDark: '#3366aa', accent: '#77bbff', belly: '#cce5ff' },
      green:  { body: '#5ddb5d', bodyDark: '#2ea82e', accent: '#7fee7f', belly: '#c8f7c8' },
      purple: { body: '#9966cc', bodyDark: '#6633aa', accent: '#bb88ee', belly: '#ddccff' },
      pink:   { body: '#f0a0b0', bodyDark: '#d07080', accent: '#f5c0cc', belly: '#ffe8ec' },
      orange: { body: '#f4a460', bodyDark: '#d2843e', accent: '#f8c080', belly: '#ffe4c4' },
      yellow: { body: '#f5d442', bodyDark: '#c8a010', accent: '#fde868', belly: '#fff9cc' },
      grey:   { body: '#888888', bodyDark: '#666666', accent: '#aaaaaa', belly: '#cccccc' },
      gray:   { body: '#888888', bodyDark: '#666666', accent: '#aaaaaa', belly: '#cccccc' },
    };

    // AI-enhanced mode: use LLM to generate creative design parameters
    if (mode === 'ai_enhanced') {
      try {
        const llmPrompt = `You are a pixel art character designer. Given a user's description, output a JSON design spec for a cute desktop pet creature.

User description: "${prompt}"

Analyze the description and output ONLY valid JSON (no markdown, no explanation):
{
  "petName": "creative name in Chinese + English (max 20 chars)",
  "color": "white|black|red|blue|green|purple|pink|orange|yellow|grey",
  "hasWings": true/false,
  "hasHorns": true/false,
  "isSmall": true/false,
  "isRound": true/false,
  "designNotes": "2-3 sentence description of the character design for procedural generation"
}

Choose features that best match the user's description. Be creative but coherent.`;

        const messages: NormalizedMessage[] = [{ role: 'user', content: llmPrompt }];
        const result = await makeLLMCall(
          messages, [],
          { provider: 'qwen', model: 'qwen-plus', maxTokens: 500 },
          llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen,
        );

        const raw = result.text || '';
        let aiDesign: any = {};
        try {
          aiDesign = JSON.parse(raw.replace(/```json|```/g, '').trim());
        } catch {
          aiDesign = {};
        }

        const color = (aiDesign.color && colorMap[aiDesign.color]) ? aiDesign.color : 'orange';
        const tags = {
          color,
          hasWings: !!aiDesign.hasWings,
          hasHorns: !!aiDesign.hasHorns,
          isSmall: !!aiDesign.isSmall,
          isRound: !!aiDesign.isRound,
        };

        return res.json({
          generated: true,
          prompt,
          petId: `ai-${Date.now()}`,
          petName: aiDesign.petName || prompt.slice(0, 30).replace(/[^a-zA-Z0-9一-鿿\s]/g, '').trim() || 'AI Pet',
          tags,
          aiEnhanced: true,
          designNotes: aiDesign.designNotes || '',
        });
      } catch (err: any) {
        console.error('[Pet Gen] AI-enhanced mode failed, falling back to procedural:', err.message);
        // Fall through to procedural mode
      }
    }

    let palette = colorMap.orange; // default warm orange
    for (const [color, p] of Object.entries(colorMap)) {
      if (lower.includes(color)) { palette = p; break; }
    }

    const hasWings = lower.includes('wing') || lower.includes('fly') || lower.includes('bird') || lower.includes('dragon');
    const hasHorns = lower.includes('horn') || lower.includes('dragon');
    const isSmall = lower.includes('small') || lower.includes('tiny') || lower.includes('mini');
    const isRound = lower.includes('round') || lower.includes('blob') || lower.includes('ball') || lower.includes('slime');

    // Return config — frontend handles spritesheet generation procedurally
    res.json({
      generated: true,
      prompt,
      petId: `custom-${Date.now()}`,
      petName: prompt.slice(0, 30).replace(/[^a-zA-Z0-9一-鿿\s]/g, '').trim() || 'Custom Pet',
      tags: {
        color: Object.keys(colorMap).find(c => lower.includes(c)) || 'orange',
        hasWings,
        hasHorns,
        isSmall,
        isRound,
      },
    });
  }));
}
