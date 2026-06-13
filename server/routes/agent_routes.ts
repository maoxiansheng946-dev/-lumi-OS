import { Router, Request, Response, NextFunction } from "express";
import { readDB, writeDB } from "../../db_layer";
import { getOrCreateActiveConversation, getActiveConversation, getMessages, addMessage } from "../conversation/manager";
import { getKey } from "../config/keys";
import { makeLLMCall, NormalizedMessage } from "../llm/providers";
import { requireAuth, resolveDomain } from "../middleware/auth";

const asyncHandler = (fn: (req: Request, res: Response, next?: NextFunction) => Promise<any>) =>
  (req: Request, res: Response, next: NextFunction) => Promise.resolve(fn(req, res, next)).catch(next);

export function mountAgentRoutes(
  router: Router,
  _jwtSecret: string,
  llmGetters: { getDeepSeek: () => any; getGemini: () => any; getOpenAI?: () => any; getAnthropic?: () => any; getQwen?: () => any; },
) {
  router.post("/agents/distill", requireAuth, asyncHandler(async (req, res) => {
    const uid = req.user!.uid;
    const { chatLog, format, relationshipType, name: targetName } = req.body || {};
    if (!chatLog || !format) return res.status(400).json({ error: "chatLog and format are required" });
    if (!['wechat', 'qq', 'plain'].includes(format)) return res.status(400).json({ error: "format must be: wechat, qq, or plain" });
    try {
      const { distillPersona } = await import('../agents/distiller');
      const result = await distillPersona(
        { chatLog, format, targetName, relationshipType, userId: uid },
        { getDeepSeek: llmGetters.getDeepSeek, getGemini: llmGetters.getGemini, getOpenAI: llmGetters.getOpenAI, getAnthropic: llmGetters.getAnthropic, getQwen: llmGetters.getQwen },
      );
      res.json({ personalityConfig: result.personalityConfig, seedMemories: result.seedMemories, evidenceMap: result.evidenceMap, relationshipType: result.relationshipType, narrative: result.narrative, inferredName: result.inferredName, summary: { messageCount: chatLog.split('\n').filter((l: string) => l.trim()).length, memoryCount: result.seedMemories.length, cognitiveStyle: result.personalityConfig.personalityVector?.cognitiveStyle, socialStyle: result.personalityConfig.personalityVector?.socialStyle, tone: result.personalityConfig.expressionStyle.tone, topPhrases: result.personalityConfig.expressionStyle.vocabularyHints?.slice(0, 5) } });
    } catch (err: any) { console.error('[Distill] Failed:', err.message); res.status(500).json({ error: err.message || 'Distillation failed' }); }
  }));

  router.get("/agents/sanctuaries", requireAuth, (req, res) => {
    try {
      const db = readDB();
      const orgId = req.user!.orgId;
      const sanctuaries = (db.agents || []).filter((a: any) => {
        if (!a.ownerUid || a.ownerUid !== req.user!.uid) return false;
        if (a.territory !== 'sanctuary') return false;
        if (orgId) return a.orgId === orgId;
        return (!a.orgId || a.orgId === '');
      }).map((a: any) => ({ id: a.id, name: a.name, relationshipType: a.relationshipType || 'close_friend', isFrozen: a.isFrozen ?? true, memoryCount: (db.memories || []).filter((m: any) => m.agentId === a.id).length, createdAt: a.createdAt, lastActiveAt: a.lastActiveAt }));
      res.json({ sanctuaries });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get("/agents/:id/history", requireAuth, (req, res) => {
    try {
      const { id } = req.params; const db = readDB();
      const isDefault = ['lumi', 'lumi_default', 'scholar_default', 'founder_default', 'incubated'].includes(id);
      if (!isDefault && !db.agents.find((a: any) => a.id === id && a.ownerUid === req.user!.uid)) return res.status(404).json({ error: "Agent not found" });
      const conv = getActiveConversation(req.user!.uid, id);
      const msgs = conv ? getMessages(conv.id, 100) : [];
      // Also merge proactive push notifications (Lumi-initiated messages)
      const proactive = (db.interactions || [])
        .filter((i: any) => i.userId === req.user!.uid && i.mode === 'proactive')
        .slice(-50)
        .map((i: any) => ({ role: 'assistant', content: i.content || i.message || '', createdAt: i.timestamp, mode: 'proactive' }));
      const merged = [...msgs.map((m: any) => ({ role: m.role, content: m.content || m.message || '', createdAt: m.createdAt })), ...proactive]
        .sort((a, b) => (new Date(a.createdAt || 0).getTime()) - (new Date(b.createdAt || 0).getTime()))
        .slice(-150);
      res.json(merged);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/agents/:id/history", requireAuth, (req, res) => {
    try {
      const { id } = req.params; const { messages } = req.body;
      const db = readDB(); const isDefault = ['lumi', 'lumi_default', 'scholar_default', 'founder_default', 'incubated'].includes(id);
      if (!isDefault && !db.agents.find((a: any) => a.id === id && a.ownerUid === req.user!.uid)) return res.status(404).json({ error: "Agent not found" });
      const conv = getOrCreateActiveConversation(req.user!.uid, id);
      if (Array.isArray(messages)) for (const msg of messages) addMessage({ userId: req.user!.uid, agentId: id, conversationId: conv.id, role: msg.role || 'user', content: msg.content || '' });
      res.json({ success: true, conversationId: conv.id });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.get("/agents", requireAuth, (req, res) => {
    try {
      const orgId = req.user!.orgId;
      res.json(readDB().agents.filter((a: any) => {
        if (a.id.startsWith('ephemeral_')) return false;
        if (!a.ownerUid || a.ownerUid !== req.user!.uid) return false;
        if (orgId) return a.orgId === orgId;
        return (!a.orgId || a.orgId === '');
      }));
    }
    catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/agents", requireAuth, (req, res) => {
    try {
      const { name, category, data, personalityId, modelPreference, memoryScope, autonomyLevel, territory, distilledFrom, evidenceMap, relationshipType, isFrozen, seedMemoryIds, executionMode, runtime, externalCommand } = req.body;
      const db = readDB(); const isSanctuary = territory === 'sanctuary';
      const dc = resolveDomain(req.user!);
      const agent: any = { id: Math.random().toString(36).substring(2, 15), ownerUid: req.user!.uid, name, category: category || (relationshipType || 'friend'), data: data || '{}', status: "active", personalityId: personalityId || 'lumi', modelPreference: modelPreference || '', memoryScope: isSanctuary ? 'private' : (memoryScope || 'shared'), autonomyLevel: isSanctuary ? 'reactive' : (autonomyLevel || 'reactive'), runtimeConfig: '{}', territory: territory || 'open', distilledFrom: distilledFrom || '', evidenceMap: evidenceMap || [], relationshipType: relationshipType || '', isFrozen: isFrozen ?? isSanctuary, seedMemoryIds: seedMemoryIds || [], executionMode: executionMode || '', runtime: runtime || 'internal', externalCommand: externalCommand || '', domain: dc.domain, orgId: dc.orgId, createdAt: new Date().toISOString(), lastActiveAt: new Date().toISOString(), skillTags: [], knowledgeDomains: [], allowCrossPollination: !isSanctuary };
      db.agents.push(agent); writeDB(db); res.json(agent);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.put("/agents/:id", requireAuth, (req, res) => {
    try {
      const { id } = req.params;
      const db = readDB();
      const idx = db.agents.findIndex((a: any) => a.id === id && a.ownerUid === req.user!.uid);
      if (idx === -1) return res.status(404).json({ error: "Agent not found or unauthorized" });
      const agent = db.agents[idx];
      const allowedFields = [
        'name', 'category', 'personalityId', 'modelPreference', 'memoryScope',
        'autonomyLevel', 'executionMode', 'skillTags', 'knowledgeDomains',
        'allowCrossPollination', 'isFrozen', 'territory', 'relationshipType',
        'runtime', 'externalCommand',
      ];
      for (const field of allowedFields) {
        if (req.body[field] !== undefined) agent[field] = req.body[field];
      }
      if (req.body.data !== undefined) agent.data = typeof req.body.data === 'string' ? req.body.data : JSON.stringify(req.body.data);
      if (req.body.runtimeConfig !== undefined) agent.runtimeConfig = typeof req.body.runtimeConfig === 'string' ? req.body.runtimeConfig : JSON.stringify(req.body.runtimeConfig);
      agent.lastActiveAt = new Date().toISOString();
      writeDB(db);
      res.json(agent);
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.delete("/agents/:id", requireAuth, (req, res) => {
    try {
      const { id } = req.params; const db = readDB();
      const BUILTINS = ['lumi', 'lumi_default', 'scholar_default', 'founder_default', 'incubated'];
      if (BUILTINS.includes(id)) return res.status(403).json({ error: "Cannot delete built-in agent" });
      const idx = db.agents.findIndex((a: any) => a.id === id && a.ownerUid === req.user!.uid);
      if (idx === -1) return res.status(404).json({ error: "Agent not found or unauthorized" });
      db.agents.splice(idx, 1);
      // Cleanup orphaned data
      if (db.interactions) db.interactions = db.interactions.filter((i: any) => i.agentId !== id);
      if (db.memories) db.memories = db.memories.filter((m: any) => m.agentId !== id);
      if (db.conversations) db.conversations = db.conversations.filter((c: any) => c.agentId !== id);
      writeDB(db); res.json({ success: true });
    } catch (err: any) { res.status(500).json({ error: err.message }); }
  });

  router.post("/audio/transcribe", asyncHandler(async (req, res) => {
    const { audio, fileName } = req.body || {};
    if (!audio) return res.status(400).json({ error: "Audio data is required" });
    try {
      const dgKey = process.env.DEEPGRAM_API_KEY || getKey('DEEPGRAM_API_KEY');
      if (dgKey) { const buffer = Buffer.from(audio, 'base64'); const dgRes = await fetch('https://api.deepgram.com/v1/listen?model=nova-2&language=zh&punctuate=true', { method: 'POST', headers: { 'Authorization': `Token ${dgKey}`, 'Content-Type': fileName?.endsWith('.wav') ? 'audio/wav' : fileName?.endsWith('.ogg') ? 'audio/ogg' : fileName?.endsWith('.m4a') ? 'audio/mp4' : 'audio/mp3' }, body: buffer }); if (dgRes.ok) { const data = await dgRes.json() as any; return res.json({ text: data?.results?.channels?.[0]?.alternatives?.[0]?.transcript || '' }); } }
      const qwenKey = process.env.DASHSCOPE_API_KEY || getKey('DASHSCOPE_API_KEY');
      if (qwenKey) { const buffer = Buffer.from(audio, 'base64'); const form = new FormData(); form.append('model', 'sensevoice-v1'); form.append('file', new Blob([buffer]), fileName || 'audio.mp3'); const qwRes = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/asr/transcription', { method: 'POST', headers: { 'Authorization': `Bearer ${qwenKey}` }, body: form }); if (qwRes.ok) { const data = await qwRes.json() as any; return res.json({ text: data?.output?.sentence?.text || '' }); } }
      res.json({ text: '', note: 'No STT provider configured' });
    } catch (err: any) { res.json({ text: '', error: err.message }); }
  }));

  router.post("/pets/generate", asyncHandler(async (req, res) => {
    const { prompt, mode } = req.body || {};
    if (!prompt?.trim()) return res.status(400).json({ error: "Prompt is required" });
    const lower = prompt.toLowerCase();

    if (mode === 'ai_enhanced') {
      try {
        const llmPrompt = `You are a pixel-art pet designer for a desktop companion app. Given a Chinese or English description, output ONLY valid JSON (no markdown, no explanation) that describes a cute desktop pet.

User description: "${prompt}"

Output JSON fields:
- petName: short name (Chinese if input is Chinese, max 8 chars)
- species: "cat" | "fox" | "rabbit" | "bear" | "hamster" | "blob" | "bird" | "dragon"
- color: main body color — "white" | "black" | "red" | "blue" | "green" | "purple" | "pink" | "orange" | "yellow" | "brown" | "cream" | "grey"
- pattern: "solid" | "striped" | "spotted" | "bicolor" | "gradient"
- patternColor: secondary color for pattern (use color list above)
- eyeShape: "round" | "oval" | "slit" | "star" | "heart"
- eyeColor: eye color hex
- mouthStyle: "smile" | "open" | "shocked" | "neutral" | "tongue"
- size: "tiny" | "small" | "normal" | "large"
- hasWings: true/false
- hasHorns: true/false
- special: "none" | "glowing" | "sparkly"

Match species to description clues: 猫→cat, 狐狸/狐→fox, 兔→rabbit, 熊→bear, 仓鼠/鼠→hamster, 史莱姆/软泥→blob, 鸟→bird, 龙→dragon.
Choose pattern/eyeShape/mouthStyle that fits the described personality.
If the description doesn't specify, use reasonable defaults. Be creative!`;
        const result = await makeLLMCall([{ role: 'user', content: llmPrompt }], [], { provider: 'qwen', model: 'qwen-plus', maxTokens: 500 }, llmGetters.getDeepSeek, llmGetters.getGemini, llmGetters.getOpenAI, llmGetters.getAnthropic, llmGetters.getQwen);
        let aiDesign: any = {};
        try { aiDesign = JSON.parse((result.text || '').replace(/```json\s*|```/g, '').trim()); } catch { aiDesign = {}; }
        const colorMap: Record<string, string> = { white:'#f0f0f0',black:'#3a3a3a',red:'#e85545',blue:'#5599dd',green:'#5ddb5d',purple:'#9966cc',pink:'#f0a0b0',orange:'#f4a460',yellow:'#f5d442',brown:'#8B6914',cream:'#fff8dc',grey:'#888888' };
        const tags: any = {
          species: aiDesign.species || 'cat',
          color: colorMap[aiDesign.color] || aiDesign.color || '#f4a460',
          pattern: aiDesign.pattern || 'solid',
          patternColor: colorMap[aiDesign.patternColor] || aiDesign.patternColor || '',
          eyeShape: aiDesign.eyeShape || 'round',
          eyeColor: aiDesign.eyeColor || '',
          mouthStyle: aiDesign.mouthStyle || 'smile',
          size: aiDesign.size || 'normal',
          hasWings: !!aiDesign.hasWings,
          hasHorns: !!aiDesign.hasHorns,
          special: aiDesign.special || 'none',
        };
        return res.json({ generated: true, prompt, petId: `ai-${Date.now()}`, petName: aiDesign.petName || prompt.slice(0, 30), tags, aiEnhanced: true });
      } catch (err: any) { console.error('[Pet Gen] AI-enhanced failed:', err.message); }
    }

    // Procedural fallback: regex matching
    const speciesMatch = /猫|cat|狐狸|fox|兔|rabbit|bunny|熊|bear|仓鼠|hamster|史莱姆|blob|slime|鸟|bird|龙|dragon/i;
    let species = 'cat';
    if (/狐狸|fox/i.test(lower)) species = 'fox';
    else if (/兔|rabbit|bunny/i.test(lower)) species = 'rabbit';
    else if (/熊|bear/i.test(lower)) species = 'bear';
    else if (/仓鼠|hamster/i.test(lower)) species = 'hamster';
    else if (/史莱姆|blob|slime|软泥/i.test(lower)) species = 'blob';
    else if (/鸟|bird/i.test(lower)) species = 'bird';
    else if (/龙|dragon/i.test(lower)) species = 'dragon';

    const colorMap: Record<string, string> = { white:'#f0f0f0',black:'#3a3a3a',red:'#e85545',blue:'#5599dd',green:'#5ddb5d',purple:'#9966cc',pink:'#f0a0b0',orange:'#f4a460',yellow:'#f5d442',brown:'#8B6914',cream:'#fff8dc',grey:'#888888' };
    const color = Object.keys(colorMap).find(c => lower.includes(c)) || 'orange';
    const pattern = /条纹|stripe|斑点|spot|花纹/i.test(lower) ? (/斑点|spot/i.test(lower) ? 'spotted' : 'striped') : 'solid';
    const eyeShape = /星星|star|星眼/i.test(lower) ? 'star' : /爱心|heart|心形/i.test(lower) ? 'heart' : /蛇眼|slit|竖瞳/i.test(lower) ? 'slit' : 'round';
    const mouthStyle = /张嘴|open|张大/i.test(lower) ? 'open' : /惊讶|shock/i.test(lower) ? 'shocked' : /吐舌|tongue/i.test(lower) ? 'tongue' : 'smile';
    const size = /tiny|小小|迷你|mini/i.test(lower) ? 'tiny' : /small|小/i.test(lower) ? 'small' : /large|大|big/i.test(lower) ? 'large' : 'normal';
    const hasWings = /wing|翅膀|fly/i.test(lower);
    const hasHorns = /horn|角/i.test(lower);
    const special = /glow|发光|光/i.test(lower) ? 'glowing' : /spark|星星|闪光|闪/i.test(lower) ? 'sparkly' : 'none';

    res.json({ generated: true, prompt, petId: `custom-${Date.now()}`, petName: prompt.slice(0, 30), tags: { species, color: colorMap[color] || '#f4a460', pattern, patternColor: '', eyeShape, eyeColor: '', mouthStyle, size, hasWings, hasHorns, special } });
  }));
}
