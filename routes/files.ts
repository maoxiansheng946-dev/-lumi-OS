/**
 * AI Knowledge Base API — manages files in Lumi's knowledge vault.
 *
 * Files stored in data/knowledge/. Each file tracked with metadata:
 *   - source: 'upload' | 'generated' | 'ingested'
 *   - agentIds: which agents have ingested this file
 *   - status: 'ready' | 'indexing' | 'indexed'
 */
import { Router, Request, Response } from 'express';
import multer from 'multer';
import jwt from 'jsonwebtoken';
import path from 'path';
import fs from 'fs';
import os from 'os';
import { readDB, writeDB } from '../db_layer';
import { ingestDocument } from '../server/agents/rag';
import { getDataPath } from '../server/config/data_path';

const KNOWLEDGE_DIR = getDataPath('knowledge');
fs.mkdirSync(KNOWLEDGE_DIR, { recursive: true });

const router = Router();

const JWT_SECRET = process.env.JWT_SECRET || 'lumiOS_default_jwt_secret_2026_local';

function requireAuth(req: Request, res: Response, next: () => void): void {
  let token = req.cookies.token;
  if (!token && req.headers.authorization?.startsWith('Bearer ')) {
    token = req.headers.authorization.slice(7);
  }
  if (!token) { res.status(401).json({ error: 'Login required' }); return; }
  try { jwt.verify(token, JWT_SECRET); next(); }
  catch { res.status(401).json({ error: 'Invalid token' }); }
}

function getUserId(req: Request): string {
  try {
    let token = req.cookies.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.slice(7);
    if (token) return (jwt.verify(token, JWT_SECRET) as any).uid;
  } catch {}
  return 'anonymous';
}

// ── Multer: files staged in OS temp, then moved to knowledge dir ──
const tmpDir = path.join(os.tmpdir(), 'lumi-uploads');
fs.mkdirSync(tmpDir, { recursive: true });
const upload = multer({ dest: tmpDir, limits: { fileSize: 500 * 1024 * 1024 } });

// ── Helpers ──

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

interface KnowledgeEntry {
  id: string;
  name: string;
  size: string;
  rawSize: number;
  type: 'file';
  source: 'upload' | 'generated' | 'ingested';
  agentIds: string[];
  status: 'ready' | 'indexing' | 'indexed';
  updatedAt: string;
  createdAt: string;
}

function buildEntry(filename: string, source: 'upload' | 'generated' | 'ingested', agentIds: string[] = []): KnowledgeEntry {
  const filePath = path.join(KNOWLEDGE_DIR, filename);
  let st: fs.Stats;
  try { st = fs.statSync(filePath); }
  catch { st = { size: 0, mtime: new Date(), birthtime: new Date() } as fs.Stats; }
  return {
    id: filename,
    name: filename,
    size: formatSize(st.size),
    rawSize: st.size,
    type: 'file',
    source,
    agentIds,
    status: agentIds.length > 0 ? 'indexed' : 'ready',
    updatedAt: st.mtime.toISOString(),
    createdAt: st.birthtime.toISOString(),
  };
}

// ── GET /files/list — list knowledge base files ──
router.get('/files/list', (_req: Request, res: Response) => {
  try {
    const db = readDB();
    const fileMeta: Record<string, { source: string; agentIds: string[] }> = {};
    if (db.knowledgeFiles) {
      for (const m of db.knowledgeFiles) {
        fileMeta[m.filename] = { source: m.source || 'upload', agentIds: m.agentIds || [] };
      }
    }

    const entries = fs.readdirSync(KNOWLEDGE_DIR);
    const files: KnowledgeEntry[] = [];
    for (const name of entries) {
      if (name.startsWith('.') || name.startsWith('_')) continue;
      const meta = fileMeta[name] || { source: 'upload' as const, agentIds: [] as string[] };
      const source = (meta.source as 'upload' | 'generated' | 'ingested') || 'upload';
      files.push(buildEntry(name, source, meta.agentIds));
    }

    files.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ files });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /files/upload — upload files ──
router.post('/files/upload', requireAuth, upload.array('files', 20), (req: Request, res: Response) => {
  try {
    const uploadedFiles = req.files as Express.Multer.File[];
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const db = readDB();
    if (!db.knowledgeFiles) db.knowledgeFiles = [];

    const saved: string[] = [];
    for (const file of uploadedFiles) {
      let dest = path.join(KNOWLEDGE_DIR, file.originalname);
      let counter = 1;
      const ext = path.extname(file.originalname);
      const base = path.basename(file.originalname, ext);
      while (fs.existsSync(dest)) {
        dest = path.join(KNOWLEDGE_DIR, `${base} (${counter})${ext}`);
        counter++;
      }
      fs.renameSync(file.path, dest);
      const finalName = path.basename(dest);

      // Track in DB
      const existing = db.knowledgeFiles.find((m: any) => m.filename === finalName);
      if (existing) {
        existing.source = 'upload';
        existing.updatedAt = new Date().toISOString();
      } else {
        db.knowledgeFiles.push({
          filename: finalName,
          source: 'upload',
          agentIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }
      saved.push(finalName);
    }
    writeDB(db);
    res.json({ success: true, files: saved });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /files/save — save generated content as a file ──
router.post('/files/save', requireAuth, (req: Request, res: Response) => {
  try {
    const { name, content } = req.body;
    if (!name || content === undefined) return res.status(400).json({ error: 'name and content required' });

    const safeName = name.replace(/[<>:"/\\|?*]/g, '_');
    const filePath = path.join(KNOWLEDGE_DIR, safeName);
    fs.writeFileSync(filePath, typeof content === 'string' ? content : JSON.stringify(content, null, 2), 'utf-8');

    const db = readDB();
    if (!db.knowledgeFiles) db.knowledgeFiles = [];
    const existing = db.knowledgeFiles.find((m: any) => m.filename === safeName);
    if (existing) {
      existing.source = 'generated';
      existing.updatedAt = new Date().toISOString();
    } else {
      db.knowledgeFiles.push({
        filename: safeName,
        source: 'generated',
        agentIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    writeDB(db);

    res.json({ success: true, filename: safeName, entry: buildEntry(safeName, 'generated', []) });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /files/download/:id — download a file ──
router.get('/files/download/:id', (req: Request, res: Response) => {
  try {
    const safeName = path.basename(req.params.id);
    const filePath = path.join(KNOWLEDGE_DIR, safeName);
    if (!safeName || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: 'File not found' });
    }
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── DELETE /files/delete/:id ──
router.delete('/files/delete/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const safeName = path.basename(req.params.id);
    const filePath = path.join(KNOWLEDGE_DIR, safeName);
    if (!safeName || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(filePath);

    const db = readDB();
    if (db.knowledgeFiles) {
      db.knowledgeFiles = db.knowledgeFiles.filter((m: any) => m.filename !== safeName);
      writeDB(db);
    }
    res.json({ success: true });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /files/rename ──
router.post('/files/rename', requireAuth, (req: Request, res: Response) => {
  try {
    const { id, newName } = req.body;
    if (!id || !newName) return res.status(400).json({ error: 'id and newName required' });

    const oldPath = path.join(KNOWLEDGE_DIR, path.basename(id));
    const safeNewName = newName.replace(/[<>:"/\\|?*]/g, '_');
    const newPath = path.join(KNOWLEDGE_DIR, safeNewName);

    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Not found' });
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'Name already taken' });

    fs.renameSync(oldPath, newPath);

    const db = readDB();
    if (db.knowledgeFiles) {
      const meta = db.knowledgeFiles.find((m: any) => m.filename === path.basename(id));
      if (meta) meta.filename = safeNewName;
      writeDB(db);
    }
    res.json({ success: true, id: safeNewName, name: safeNewName });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── GET /files/info/:id ──
router.get('/files/info/:id', (req: Request, res: Response) => {
  try {
    const safeName = path.basename(req.params.id);
    const filePath = path.join(KNOWLEDGE_DIR, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    const st = fs.statSync(filePath);
    const db = readDB();
    const meta = db.knowledgeFiles?.find((m: any) => m.filename === safeName);
    res.json({
      id: safeName,
      name: safeName,
      size: st.size,
      formattedSize: formatSize(st.size),
      type: 'file',
      source: meta?.source || 'upload',
      agentIds: meta?.agentIds || [],
      updatedAt: st.mtime.toISOString(),
      createdAt: meta?.createdAt || st.birthtime.toISOString(),
    });
  } catch (err: any) {
    res.status(400).json({ error: err.message });
  }
});

// ── POST /files/ingest — chunk into agent memory (RAG) ──
router.post('/files/ingest', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const { fileId, agentId } = req.body;
    if (!fileId || !agentId) return res.status(400).json({ error: 'fileId and agentId required' });

    const safeName = path.basename(fileId);
    const filePath = path.join(KNOWLEDGE_DIR, safeName);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = fs.readFileSync(filePath, 'utf-8');

    // Mark as indexing
    const db = readDB();
    if (!db.knowledgeFiles) db.knowledgeFiles = [];
    let meta = db.knowledgeFiles.find((m: any) => m.filename === safeName);
    if (!meta) {
      meta = { filename: safeName, source: 'upload', agentIds: [], createdAt: new Date().toISOString() };
      db.knowledgeFiles.push(meta);
    }
    meta.indexingAt = new Date().toISOString();
    writeDB(db);

    const result = await ingestDocument(userId, agentId, safeName, content);

    // Mark as indexed
    if (!meta.agentIds.includes(agentId)) meta.agentIds.push(agentId);
    delete meta.indexingAt;
    writeDB(db);

    res.json({ success: true, chunkCount: result.chunkCount, memoryIds: result.memoryIds });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
