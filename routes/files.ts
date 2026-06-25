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
import { exec, spawn } from 'child_process';
import iconv from 'iconv-lite';
import { readDB, writeDB } from '../db_layer';
import { ingestDocument } from '../server/agents/rag';
import { getDataPath, getDataRoot } from '../server/config/data_path';
import * as OrgKB from '../server/org/kb';

const PERSONAL_KNOWLEDGE_DIR = getDataPath('knowledge');
fs.mkdirSync(PERSONAL_KNOWLEDGE_DIR, { recursive: true });

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

function getAuthPayload(req: Request): any | null {
  try {
    let token = req.cookies?.token;
    if (!token && req.headers.authorization?.startsWith('Bearer ')) token = req.headers.authorization.slice(7);
    if (!token) return null;
    return jwt.verify(token, JWT_SECRET) as any;
  } catch {
    return null;
  }
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
  displayName: string;
  domain: 'personal' | 'work';
  orgId?: string;
  size: string;
  rawSize: number;
  type: 'file';
  source: 'upload' | 'generated' | 'ingested';
  agentIds: string[];
  status: 'ready' | 'indexing' | 'indexed';
  updatedAt: string;
  createdAt: string;
}

interface FileScope {
  domain: 'personal' | 'work';
  orgId?: string;
  dir: string;
}

const MOJIBAKE_TOKENS = [
  '\u00c3',
  '\u00c2',
  '\ufffd',
  '\u00e6',
  '\u00e9',
  '\u00e8',
  '\u00e7',
  '\u00e5',
  '\u00e4',
  '\u951f',
  '\u93c2',
  '\u6d93',
  '\u7f01',
  '\u7015',
  '\u6fc2',
  '\u5a34',
  '\u6d7c',
  '\u5fe1',
  '\u9439',
  '\u9359',
];

function looksMojibake(value: string): boolean {
  return /[\u0080-\u009f]/.test(value)
    || /[\u00c0-\u00ff][\u0080-\u00bf]/.test(value)
    || MOJIBAKE_TOKENS.some(token => value.includes(token));
}

function textScore(value: string): number {
  let score = 0;
  const replacement = (value.match(/\ufffd/g) || []).length;
  const mojibake = MOJIBAKE_TOKENS.reduce((sum, token) => sum + (value.includes(token) ? 1 : 0), 0);
  const cjk = (value.match(/[\u4e00-\u9fff]/g) || []).length;
  const ascii = (value.match(/[A-Za-z0-9._ -]/g) || []).length;
  score += cjk * 2 + ascii * 0.15;
  score -= replacement * 8 + mojibake * 2;
  return score;
}

function repairFilename(value: string): string {
  const original = String(value || '').normalize('NFC');
  if (!original || !looksMojibake(original)) return original;
  const candidates = new Set<string>([original]);
  try { candidates.add(Buffer.from(original, 'latin1').toString('utf8').normalize('NFC')); } catch {}
  try { candidates.add(iconv.decode(iconv.encode(original, 'gbk'), 'utf8').normalize('NFC')); } catch {}
  try { candidates.add(iconv.decode(iconv.encode(original, 'gb18030'), 'utf8').normalize('NFC')); } catch {}
  return [...candidates].sort((a, b) => textScore(b) - textScore(a))[0] || original;
}

function sanitizeKnowledgeFilename(value: string, fallback = 'untitled'): string {
  const repaired = repairFilename(value || fallback)
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '_')
    .trim();
  const safe = repaired && repaired !== '.' && repaired !== '..' ? repaired : fallback;
  return path.basename(safe);
}

const TEXT_KNOWLEDGE_EXTS = /\.(txt|md|json|csv|log|xml|yaml|yml|ts|tsx|js|jsx|py|html|css|env|toml|ini|cfg)$/i;
const EXTRACTABLE_KNOWLEDGE_EXTS = /\.(docx|xlsx|xls|pdf)$/i;
const IMAGE_KNOWLEDGE_EXTS = /\.(png|jpe?g|webp|gif|bmp|tiff?)$/i;
const GENERATED_FILE_EXTS = /\.(docx?|pptx?|xlsx?|pdf|txt|md|csv|json|png|jpe?g|webp|gif|svg|html|dxf|dwg)$/i;

const DOWNLOAD_MIME_TYPES: Record<string, string> = {
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.json': 'application/json',
  '.csv': 'text/csv',
  '.log': 'text/plain',
  '.xml': 'application/xml',
  '.html': 'text/html',
  '.css': 'text/css',
  '.js': 'text/javascript',
  '.ts': 'text/typescript',
  '.tsx': 'text/typescript',
  '.py': 'text/x-python',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.pdf': 'application/pdf',
  '.doc': 'application/msword',
  '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  '.ppt': 'application/vnd.ms-powerpoint',
  '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  '.xls': 'application/vnd.ms-excel',
  '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  '.dxf': 'application/dxf',
  '.dwg': 'application/octet-stream',
};

function getDownloadMime(filePath: string): string | undefined {
  const ext = path.extname(filePath).toLowerCase() || (filePath.startsWith('.') ? filePath.toLowerCase() : '');
  return DOWNLOAD_MIME_TYPES[ext];
}

function isInsideRoot(filePath: string, root: string): boolean {
  const normalizedFile = path.normalize(filePath).toLowerCase();
  const normalizedRoot = path.normalize(root).toLowerCase();
  return normalizedFile === normalizedRoot || normalizedFile.startsWith(normalizedRoot + path.sep.toLowerCase());
}

function resolveGeneratedDownloadPath(value: unknown): string {
  const raw = String(value || '').trim();
  if (!raw) {
    const err: any = new Error('path is required');
    err.status = 400;
    throw err;
  }
  const expanded = raw.replace(/^~(?=$|[\\/])/, os.homedir());
  const resolved = path.resolve(expanded);
  if (!GENERATED_FILE_EXTS.test(resolved)) {
    const err: any = new Error('Unsupported generated file type');
    err.status = 400;
    throw err;
  }

  const allowedRoots = [
    path.join(process.cwd(), 'lumi_output'),
    getDataRoot(),
    path.join(os.homedir(), 'Desktop'),
    path.join(os.homedir(), 'Downloads'),
    path.join(os.homedir(), 'Documents'),
    os.tmpdir(),
  ];
  if (!allowedRoots.some(root => isInsideRoot(resolved, root))) {
    const err: any = new Error('Generated file path is outside allowed directories');
    err.status = 403;
    throw err;
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    const err: any = new Error('Generated file not found');
    err.status = 404;
    throw err;
  }
  return resolved;
}

async function extractKnowledgeFileContent(filePath: string): Promise<string | null> {
  const extName = path.extname(filePath);
  try {
    if (TEXT_KNOWLEDGE_EXTS.test(extName)) {
      return fs.readFileSync(filePath, 'utf-8');
    }
    if (/\.docx$/i.test(extName)) {
      const mammoth = await import('mammoth');
      return (await mammoth.extractRawText({ path: filePath })).value;
    }
    if (/\.xlsx?$/i.test(extName)) {
      const XLSX = await import('xlsx');
      const wb = XLSX.readFile(filePath);
      return wb.SheetNames.map((name: string) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        return `[${name}]\n${csv}`;
      }).join('\n\n');
    }
    if (/\.pdf$/i.test(extName)) {
      const pdfModule: any = await import('pdf-parse');
      const pdfParse = pdfModule.default || pdfModule;
      return (await pdfParse(fs.readFileSync(filePath))).text;
    }
  } catch (err: any) {
    console.warn(`[Files] Failed to extract "${path.basename(filePath)}": ${err.message}`);
  }
  return null;
}

function normalizeFileDomain(value: unknown): 'personal' | 'work' {
  return String(value || '').toLowerCase() === 'work' ? 'work' : 'personal';
}

function getRequestedDomain(req: Request): 'personal' | 'work' {
  return normalizeFileDomain(req.query.domain || req.body?.domain);
}

function getFileScope(req: Request): FileScope {
  const domain = getRequestedDomain(req);
  if (domain === 'personal') {
    return { domain: 'personal', dir: PERSONAL_KNOWLEDGE_DIR };
  }

  const payload = getAuthPayload(req);
  const orgId = String(req.query.orgId || req.body?.orgId || payload?.orgId || '').trim();
  if (!payload || !orgId) {
    const err: any = new Error('Organization context required');
    err.status = 403;
    throw err;
  }

  const dir = getDataPath(path.join('org', orgId, 'knowledge'));
  fs.mkdirSync(dir, { recursive: true });
  return { domain: 'work', orgId, dir };
}

function metaMatchesScope(meta: any, scope: FileScope): boolean {
  const metaDomain = normalizeFileDomain(meta?.domain || (meta?.orgId ? 'work' : 'personal'));
  if (metaDomain !== scope.domain) return false;
  if (scope.domain === 'work') return String(meta?.orgId || '') === scope.orgId;
  return !meta?.orgId;
}

function findFileMeta(db: any, filename: string, scope: FileScope): any | undefined {
  return (db.knowledgeFiles || []).find((m: any) => m.filename === filename && metaMatchesScope(m, scope));
}

function removeFileMeta(db: any, filename: string, scope: FileScope): void {
  db.knowledgeFiles = (db.knowledgeFiles || []).filter((m: any) => !(m.filename === filename && metaMatchesScope(m, scope)));
}

function ensureOrgArticleFromFile(scope: FileScope, userId: string, filename: string, content: string | null, articleId?: string): any | null {
  if (scope.domain !== 'work' || !scope.orgId) return null;
  const articleContent = (content && content.trim())
    ? content
    : `文件已上传到组织知识库。\n\n文件名：${repairFilename(filename)}`;
  if (articleId && OrgKB.getArticle(scope.orgId, articleId)) {
    return OrgKB.updateArticle(scope.orgId, userId, articleId, {
      title: repairFilename(filename),
      content: articleContent,
      category: 'files',
      tags: ['upload', path.extname(filename).replace(/^\./, '')].filter(Boolean),
      status: 'published',
    });
  }
  return OrgKB.createArticle(scope.orgId, userId, {
    title: repairFilename(filename),
    content: articleContent,
    category: 'files',
    tags: ['upload', path.extname(filename).replace(/^\./, '')].filter(Boolean),
    status: 'published',
  });
}

function sendRouteError(res: Response, err: any, fallbackStatus = 400): void {
  res.status(err?.status || fallbackStatus).json({ error: err?.message || 'Request failed' });
}

function buildEntry(filename: string, source: 'upload' | 'generated' | 'ingested', agentIds: string[] = [], scope: FileScope, status?: 'ready' | 'indexing' | 'indexed'): KnowledgeEntry {
  const filePath = path.join(scope.dir, filename);
  const displayName = repairFilename(filename);
  let st: fs.Stats;
  try { st = fs.statSync(filePath); }
  catch { st = { size: 0, mtime: new Date(), birthtime: new Date() } as fs.Stats; }
  return {
    id: filename,
    name: displayName,
    displayName,
    domain: scope.domain,
    orgId: scope.orgId,
    size: formatSize(st.size),
    rawSize: st.size,
    type: 'file',
    source,
    agentIds,
    status: status || (agentIds.length > 0 ? 'indexed' : 'ready'),
    updatedAt: st.mtime.toISOString(),
    createdAt: st.birthtime.toISOString(),
  };
}

// ── GET /files/list — list knowledge base files ──
router.get('/files/list', (req: Request, res: Response) => {
  try {
    const scope = getFileScope(req);
    const db = readDB();
    const fileMeta: Record<string, { source: string; agentIds: string[]; status?: 'ready' | 'indexing' | 'indexed' }> = {};
    if (db.knowledgeFiles) {
      for (const m of db.knowledgeFiles) {
        if (!metaMatchesScope(m, scope)) continue;
        fileMeta[m.filename] = { source: m.source || 'upload', agentIds: m.agentIds || [], status: m.status };
      }
    }

    const entries = fs.readdirSync(scope.dir);
    const files: KnowledgeEntry[] = [];
    for (const name of entries) {
      if (name.startsWith('.') || name.startsWith('_')) continue;
      const meta = fileMeta[name] || { source: 'upload' as const, agentIds: [] as string[] };
      const source = (meta.source as 'upload' | 'generated' | 'ingested') || 'upload';
      files.push(buildEntry(name, source, meta.agentIds, scope, meta.status));
    }

    files.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ files });
  } catch (err: any) {
    sendRouteError(res, err, 500);
  }
});

// ── POST /files/upload — upload files + auto-ingest into Lumi's memory ──
router.post('/files/upload', requireAuth, upload.array('files', 20), async (req: Request, res: Response) => {
  try {
    const uploadedFiles = req.files as Express.Multer.File[];
    if (!uploadedFiles || uploadedFiles.length === 0) {
      return res.status(400).json({ error: 'No files provided' });
    }

    const userId = getUserId(req);
    const scope = getFileScope(req);
    const db = readDB();
    if (!db.knowledgeFiles) db.knowledgeFiles = [];

    const saved: any[] = [];
    for (const file of uploadedFiles) {
      const uploadName = sanitizeKnowledgeFilename(file.originalname, 'upload');
      let dest = path.join(scope.dir, uploadName);
      let counter = 1;
      const ext = path.extname(uploadName);
      const base = path.basename(uploadName, ext);
      while (fs.existsSync(dest)) {
        dest = path.join(scope.dir, `${base} (${counter})${ext}`);
        counter++;
      }
      fs.renameSync(file.path, dest);
      const finalName = path.basename(dest);

      // Track in DB
      const existing = findFileMeta(db, finalName, scope);
      const isNew = !existing;
      if (existing) {
        existing.source = 'upload';
        existing.domain = scope.domain;
        existing.orgId = scope.orgId || '';
        existing.updatedAt = new Date().toISOString();
      } else {
        db.knowledgeFiles.push({
          filename: finalName,
          displayName: repairFilename(finalName),
          domain: scope.domain,
          orgId: scope.orgId || '',
          source: 'upload',
          agentIds: [],
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      }

      const entry: any = {
        id: finalName,
        name: repairFilename(finalName),
        displayName: repairFilename(finalName),
        type: 'file',
        kind: IMAGE_KNOWLEDGE_EXTS.test(ext) || file.mimetype?.startsWith('image/') ? 'image' : 'file',
        mimeType: file.mimetype || '',
        size: formatSize(file.size),
        rawSize: file.size,
        path: dest,
        domain: scope.domain,
        orgId: scope.orgId,
      };
      let extractedContent: string | null = null;

      // For text files: return content so the chat can use it immediately
      if (TEXT_KNOWLEDGE_EXTS.test(ext) || EXTRACTABLE_KNOWLEDGE_EXTS.test(ext)) {
        extractedContent = await extractKnowledgeFileContent(dest);
        if (extractedContent) {
          entry.content = extractedContent.slice(0, 50000); // cap at 50KB for chat context
          entry.preview = extractedContent.slice(0, 1000);
          entry.extracted = true;
        }
      }

      // Personal files are ingested into personal memory; work files become org KB articles.
      if (isNew && scope.domain === 'work') {
        try {
          const meta = findFileMeta(db, finalName, scope);
          const article = ensureOrgArticleFromFile(scope, userId, finalName, extractedContent, meta?.orgArticleId);
          if (meta) {
            if (!Array.isArray(meta.agentIds)) meta.agentIds = [];
            meta.orgArticleId = article?.id;
            meta.status = 'indexed';
            if (!meta.agentIds.includes('org-kb')) meta.agentIds.push('org-kb');
          }
          entry.orgArticleId = article?.id;
          entry.ingested = true;
        } catch (orgErr: any) {
          console.warn(`[OrgKB] Failed to sync "${finalName}": ${orgErr.message}`);
          entry.syncError = orgErr.message;
        }
      } else if (isNew && (TEXT_KNOWLEDGE_EXTS.test(ext) || EXTRACTABLE_KNOWLEDGE_EXTS.test(ext))) {
        try {
          const content = extractedContent || await extractKnowledgeFileContent(dest);
          if (content) {
            const result = await ingestDocument(userId, 'lumi', finalName, content);
            const meta = findFileMeta(db, finalName, scope);
            if (meta) {
              if (!Array.isArray(meta.agentIds)) meta.agentIds = [];
              if (!meta.agentIds.includes('lumi')) meta.agentIds.push('lumi');
              meta.status = 'indexed';
              meta.updatedAt = new Date().toISOString();
            }
            entry.ingested = true;
            console.log(`[AutoIngest] "${finalName}" → ${result.chunkCount} chunks`);
          }
        } catch (ingestErr: any) {
          console.warn(`[AutoIngest] Failed for "${finalName}": ${ingestErr.message}`);
        }
      }

      saved.push(entry);
    }
    writeDB(db);
    res.json({ success: true, files: saved });
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── POST /files/save — save generated content as a file ──
router.post('/files/save', requireAuth, async (req: Request, res: Response) => {
  try {
    const { name, content } = req.body;
    if (!name || content === undefined) return res.status(400).json({ error: 'name and content required' });

    const userId = getUserId(req);
    const scope = getFileScope(req);
    const safeName = sanitizeKnowledgeFilename(name);
    const contentText = typeof content === 'string' ? content : JSON.stringify(content, null, 2);
    const filePath = path.join(scope.dir, safeName);
    fs.writeFileSync(filePath, contentText, 'utf-8');

    const db = readDB();
    if (!db.knowledgeFiles) db.knowledgeFiles = [];
    const existing = findFileMeta(db, safeName, scope);
    if (existing) {
      existing.source = 'generated';
      existing.domain = scope.domain;
      existing.orgId = scope.orgId || '';
      existing.updatedAt = new Date().toISOString();
    } else {
      db.knowledgeFiles.push({
        filename: safeName,
        displayName: repairFilename(safeName),
        domain: scope.domain,
        orgId: scope.orgId || '',
        source: 'generated',
        agentIds: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }
    const meta = findFileMeta(db, safeName, scope);
    let orgArticleId: string | undefined;
    if (scope.domain === 'work') {
      const article = ensureOrgArticleFromFile(scope, userId, safeName, contentText, meta?.orgArticleId);
      orgArticleId = article?.id;
      if (meta) {
        if (!Array.isArray(meta.agentIds)) meta.agentIds = [];
        meta.orgArticleId = orgArticleId;
        meta.status = 'indexed';
        if (!meta.agentIds.includes('org-kb')) meta.agentIds.push('org-kb');
      }
    } else if (meta) {
      try {
        const result = await ingestDocument(userId, 'lumi', safeName, contentText);
        if (!Array.isArray(meta.agentIds)) meta.agentIds = [];
        if (!meta.agentIds.includes('lumi')) meta.agentIds.push('lumi');
        meta.status = 'indexed';
        meta.updatedAt = new Date().toISOString();
        console.log(`[AutoIngest] "${safeName}" -> ${result.chunkCount} chunks`);
      } catch (ingestErr: any) {
        console.warn(`[AutoIngest] Failed for generated "${safeName}": ${ingestErr.message}`);
      }
    }
    writeDB(db);

    res.json({ success: true, filename: safeName, orgArticleId, entry: buildEntry(safeName, 'generated', meta?.agentIds || [], scope) });
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── GET /files/generated?path=... — download a generated work artifact ──
router.get('/files/generated', requireAuth, (req: Request, res: Response) => {
  try {
    const filePath = resolveGeneratedDownloadPath(req.query.path);
    const fileName = path.basename(filePath);
    const mime = getDownloadMime(filePath);
    if (mime) res.setHeader('Content-Type', mime);
    const inline = req.query.inline === '1';
    const disposition = inline ? 'inline' : 'attachment';
    res.setHeader('Content-Disposition', `${disposition}; filename*=UTF-8''${encodeURIComponent(fileName)}`);
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── GET /files/download/:id — download or preview a file ──
router.get('/files/download/:id', (req: Request, res: Response) => {
  try {
    const scope = getFileScope(req);
    const safeName = path.basename(req.params.id);
    const filePath = path.join(scope.dir, safeName);
    if (!safeName || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const ext = path.extname(safeName).toLowerCase();
    const mime = getDownloadMime(ext);
    if (mime) res.setHeader('Content-Type', mime);

    const inline = req.query.inline === '1';
    if (inline) {
      res.setHeader('Content-Disposition', 'inline');
    } else {
      res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(repairFilename(safeName))}`);
    }
    fs.createReadStream(filePath).pipe(res);
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── GET /files/open-folder/:id — open the file's containing folder in the OS ──
router.get('/files/open-folder/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const scope = getFileScope(req);
    const safeName = path.basename(req.params.id);
    const filePath = path.join(scope.dir, safeName);
    if (!safeName || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });

    const folder = path.resolve(path.dirname(filePath));
    const platform = process.platform;
    let cmd: string;
    if (platform === 'win32') {
      cmd = `explorer "${folder}"`;
    } else if (platform === 'darwin') {
      cmd = `open "${folder}"`;
    } else {
      cmd = `xdg-open "${folder}"`;
    }
    // spawn detached so it survives server restart; explorer may exit 1 on success
    const proc = spawn(cmd, [], { detached: true, stdio: 'ignore', shell: true });
    proc.unref();
    res.json({ success: true, path: folder });
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── DELETE /files/delete/:id ──
router.delete('/files/delete/:id', requireAuth, (req: Request, res: Response) => {
  try {
    const scope = getFileScope(req);
    const safeName = path.basename(req.params.id);
    const filePath = path.join(scope.dir, safeName);
    if (!safeName || !fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    fs.unlinkSync(filePath);

    const db = readDB();
    if (db.knowledgeFiles) {
      removeFileMeta(db, safeName, scope);
      writeDB(db);
    }
    res.json({ success: true });
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── POST /files/rename ──
router.post('/files/rename', requireAuth, (req: Request, res: Response) => {
  try {
    const { id, newName } = req.body;
    if (!id || !newName) return res.status(400).json({ error: 'id and newName required' });

    const scope = getFileScope(req);
    const oldPath = path.join(scope.dir, path.basename(id));
    const safeNewName = sanitizeKnowledgeFilename(newName);
    const newPath = path.join(scope.dir, safeNewName);

    if (!fs.existsSync(oldPath)) return res.status(404).json({ error: 'Not found' });
    if (fs.existsSync(newPath)) return res.status(409).json({ error: 'Name already taken' });

    fs.renameSync(oldPath, newPath);

    const db = readDB();
    if (db.knowledgeFiles) {
      const meta = findFileMeta(db, path.basename(id), scope);
      if (meta) {
        meta.filename = safeNewName;
        meta.displayName = repairFilename(safeNewName);
        meta.updatedAt = new Date().toISOString();
      }
      writeDB(db);
    }
    res.json({ success: true, id: safeNewName, name: repairFilename(safeNewName), displayName: repairFilename(safeNewName) });
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── GET /files/info/:id ──
router.get('/files/info/:id', (req: Request, res: Response) => {
  try {
    const scope = getFileScope(req);
    const safeName = path.basename(req.params.id);
    const filePath = path.join(scope.dir, safeName);
    if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'Not found' });
    const st = fs.statSync(filePath);
    const db = readDB();
    const meta = findFileMeta(db, safeName, scope);
    res.json({
      id: safeName,
      name: repairFilename(safeName),
      displayName: repairFilename(safeName),
      domain: scope.domain,
      orgId: scope.orgId,
      size: st.size,
      formattedSize: formatSize(st.size),
      type: 'file',
      source: meta?.source || 'upload',
      agentIds: meta?.agentIds || [],
      updatedAt: st.mtime.toISOString(),
      createdAt: meta?.createdAt || st.birthtime.toISOString(),
    });
  } catch (err: any) {
    sendRouteError(res, err);
  }
});

// ── POST /files/ingest — chunk into agent memory (RAG) ──
router.post('/files/ingest', requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = getUserId(req);
    const scope = getFileScope(req);
    const { fileId, agentId } = req.body;
    if (!fileId || !agentId) return res.status(400).json({ error: 'fileId and agentId required' });

    const safeName = path.basename(fileId);
    const filePath = path.join(scope.dir, safeName);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
      return res.status(404).json({ error: 'File not found' });
    }

    const content = await extractKnowledgeFileContent(filePath);
    if (!content || !content.trim()) {
      return res.status(415).json({ error: 'This file type has no extractable text for Lumi to absorb' });
    }

    // Mark as indexing
    const db = readDB();
    if (!db.knowledgeFiles) db.knowledgeFiles = [];
    let meta = findFileMeta(db, safeName, scope);
    if (!meta) {
      meta = {
        filename: safeName,
        displayName: repairFilename(safeName),
        domain: scope.domain,
        orgId: scope.orgId || '',
        source: 'upload',
        agentIds: [],
        createdAt: new Date().toISOString(),
      };
      db.knowledgeFiles.push(meta);
    }
    if (!Array.isArray(meta.agentIds)) meta.agentIds = [];
    meta.indexingAt = new Date().toISOString();
    writeDB(db);

    if (scope.domain === 'work') {
      const article = ensureOrgArticleFromFile(scope, userId, safeName, content, meta?.orgArticleId);
      if (!meta.agentIds.includes('org-kb')) meta.agentIds.push('org-kb');
      meta.orgArticleId = article?.id;
      meta.status = 'indexed';
      delete meta.indexingAt;
      writeDB(db);
      res.json({ success: true, orgArticleId: article?.id, memoryIds: [] });
      return;
    }

    const result = await ingestDocument(userId, agentId, safeName, content);

    // Mark as indexed
    if (!meta.agentIds.includes(agentId)) meta.agentIds.push(agentId);
    meta.status = 'indexed';
    meta.updatedAt = new Date().toISOString();
    delete meta.indexingAt;
    writeDB(db);

    res.json({ success: true, chunkCount: result.chunkCount, memoryIds: result.memoryIds });
  } catch (err: any) {
    sendRouteError(res, err, 500);
  }
});

export default router;
