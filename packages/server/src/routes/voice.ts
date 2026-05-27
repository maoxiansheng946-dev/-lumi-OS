import { Router, Request, Response } from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { synthesizeSpeech, cloneVoice, designVoice, listVoices, getActiveProvider } from '../tts/adapter';
import { readDB, writeDB } from '../data/db_layer';
import { logger } from '../utils/logger';
import { recordLatency } from '../monitor/latency_store';
import { getDataDir } from '../utils/paths';

const router = Router();

// Ensure voice samples directory exists
const samplesDir = path.join(getDataDir(), 'voice_samples');
fs.mkdirSync(samplesDir, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    const userId = (_req as any).userId || 'anonymous';
    const userDir = path.join(samplesDir, userId);
    fs.mkdirSync(userDir, { recursive: true });
    cb(null, userDir);
  },
  filename: (_req, file, cb) => {
    const timestamp = Date.now();
    const safeName = file.originalname.replace(/[^a-zA-Z0-9_\-. ]/g, '');
    cb(null, `${timestamp}_${safeName}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB per file
  fileFilter: (_req, file, cb) => {
    const base = (file.mimetype || '').split(';')[0];
    const allowed = ['audio/webm', 'audio/mp3', 'audio/mpeg', 'audio/wav', 'audio/wave', 'audio/ogg', 'audio/m4a', 'audio/x-wav', 'audio/x-pn-wav'];
    if (allowed.includes(base)) {
      cb(null, true);
    } else {
      cb(new Error(`Unsupported audio format: ${file.mimetype}`));
    }
  },
});

function getUserId(req: Request): string {
  return (req as any).user?.uid || (req as any).userId || 'anonymous';
}

// POST /api/voice/samples — Upload voice sample(s) for cloning
router.post('/voice/samples', upload.array('samples', 5), (req: Request, res: Response) => {
  try {
    const files = req.files as Express.Multer.File[];
    console.log('[Voice Upload] Received files:', files?.length, 'userId:', getUserId(req));
    if (!files || files.length === 0) {
      console.log('[Voice Upload] No files — req.file:', req.file, 'req.files:', req.files, 'req.body:', req.body);
      return res.status(400).json({ error: 'No audio files provided' });
    }
    files.forEach(f => console.log('[Voice Upload] File:', f.filename, f.size, f.mimetype, f.path));

    const urls = files.map(f => `/api/voice/samples/${getUserId(req)}/${f.filename}`);
    console.log('[Voice Upload] Returning URLs:', urls);
    res.json({ urls, filenames: files.map(f => f.filename), count: files.length });
  } catch (err: any) {
    console.log('[Voice Upload] Error:', err.message);
    res.status(500).json({ error: err.message });
  }
});

// GET /api/voice/samples/:userId/:filename — Serve uploaded samples
router.get('/voice/samples/:userId/:filename', (req: Request, res: Response) => {
  const filePath = path.join(samplesDir, req.params.userId, req.params.filename);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Sample not found' });
  }
  res.sendFile(filePath);
});

// POST /api/voice/clone — Trigger voice cloning
router.post('/voice/clone', async (req: Request, res: Response) => {
  try {
    const { sampleUrls, name, provider } = req.body;

    if (!sampleUrls || !Array.isArray(sampleUrls) || sampleUrls.length === 0) {
      return res.status(400).json({ error: 'At least one sample URL is required' });
    }
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Voice name is required' });
    }

    const activeProvider = provider || getActiveProvider();
    if (!activeProvider) {
      return res.status(400).json({ error: 'No TTS provider configured. Add an API key in Settings → Voice Services or Settings → API Matrix.' });
    }

    // GPT-SoVITS doesn't support cloud cloning; CosyVoice (DashScope) does
    if (activeProvider === 'gptsovits') {
      return res.status(400).json({
        error: 'GPT-SoVITS does not support cloud cloning. Use CosyVoice (DashScope) for voice cloning.',
        activeProvider,
      });
    }

    const baseUrl = `${req.protocol}://${req.get('host')}`;
    const absoluteUrls = sampleUrls.map((url: string) =>
      url.startsWith('http') ? url : `${baseUrl}${url}`
    );
    console.log('[Voice Clone] sampleUrls:', sampleUrls, 'absoluteUrls:', absoluteUrls, 'name:', name, 'provider:', activeProvider);

    const voiceId = await cloneVoice({ sampleUrls: absoluteUrls, name }, activeProvider);
    console.log('[Voice Clone] Got voiceId:', voiceId);

    // Store voice reference in user data
    const db = readDB();
    const userId = getUserId(req);
    console.log('[Voice Clone] Writing to DB for userId:', userId);
    if (!db.voiceProfiles) db.voiceProfiles = {};
    if (!db.voiceProfiles[userId]) db.voiceProfiles[userId] = [];
    db.voiceProfiles[userId].push({
      voiceId,
      name,
      provider: activeProvider,
      createdAt: new Date().toISOString(),
    });
    writeDB(db);
    console.log('[Voice Clone] DB written, responding with voiceId:', voiceId);

    res.json({ voiceId, name, provider: activeProvider });
  } catch (err: any) {
    logger.error('[Voice Clone Error]', err);
    res.status(500).json({ error: err.message || 'Voice cloning service unavailable' });
  }
});

// POST /api/voice/design — Design a new voice from text description
router.post('/voice/design', async (req: Request, res: Response) => {
  try {
    const { prompt, name } = req.body;
    if (!prompt || typeof prompt !== 'string' || prompt.trim().length < 10) {
      return res.status(400).json({ error: 'Voice prompt is required (at least 10 characters)' });
    }
    if (!name || typeof name !== 'string') {
      return res.status(400).json({ error: 'Voice name is required' });
    }
    const activeProvider = getActiveProvider() || 'cosyvoice';
    if (activeProvider === 'gptsovits') {
      return res.status(400).json({ error: 'GPT-SoVITS does not support voice design. Use CosyVoice (DashScope).' });
    }

    const voiceId = await designVoice(prompt.trim(), name, activeProvider);

    const db = readDB();
    const userId = getUserId(req);
    if (!db.voiceProfiles) db.voiceProfiles = {};
    if (!db.voiceProfiles[userId]) db.voiceProfiles[userId] = [];
    db.voiceProfiles[userId].push({
      voiceId,
      name,
      provider: activeProvider,
      prompt: prompt.trim(),
      createdAt: new Date().toISOString(),
    });
    writeDB(db);

    res.json({ voiceId, name, provider: activeProvider });
  } catch (err: any) {
    logger.error('[Voice Design Error]', err);
    res.status(500).json({ error: err.message || 'Voice design service unavailable' });
  }
});

// GET /api/voice/voices — List user's cloned voices + provider premade voices
router.get('/voice/voices', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const db = readDB();
    const userVoices = db.voiceProfiles?.[userId] || [];

    // Also try to fetch premade voices from active provider
    let premadeVoices: any[] = [];
    const provider = getActiveProvider();
    if (provider) {
      try {
        premadeVoices = await listVoices(provider);
      } catch {
        // Provider not available — just return user voices
      }
    }

    res.json({
      cloned: userVoices,
      premade: premadeVoices,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// DELETE /api/voice/:voiceId — Delete a cloned voice
router.delete('/voice/:voiceId', async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const db = readDB();
    const userVoices = db.voiceProfiles?.[userId] || [];
    const voiceIdx = userVoices.findIndex((v: any) => v.voiceId === req.params.voiceId);

    if (voiceIdx === -1) {
      return res.status(404).json({ error: 'Voice not found' });
    }

    const [removed] = userVoices.splice(voiceIdx, 1);
    db.voiceProfiles[userId] = userVoices;
    writeDB(db);

    res.json({ deleted: removed });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// POST /api/voice/synthesize — Synthesize speech (for TTS without full voice call)
router.post('/voice/synthesize', async (req: Request, res: Response) => {
  try {
    const { text, voiceId, provider } = req.body;

    if (!text || typeof text !== 'string') {
      return res.status(400).json({ error: 'Text is required' });
    }

    const activeProvider = provider || getActiveProvider();
    if (!activeProvider) {
      return res.status(400).json({ error: 'No TTS provider configured' });
    }

    const start = Date.now();
    const result = await synthesizeSpeech(text, {
      provider: activeProvider,
      voiceId: voiceId || 'default',
    });
    recordLatency('tts', Date.now() - start);

    res.set('Content-Type', `audio/${result.format}`);
    res.set('X-Audio-Format', result.format);
    res.send(result.audioBuffer);
  } catch (err: any) {
    logger.error('[Voice Synthesize Error]', err);
    res.status(500).json({ error: 'Speech synthesis unavailable' });
  }
});

export default router;
