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
import { spawn } from 'child_process';
import iconv from 'iconv-lite';
import { readDB, writeDB } from '../db_layer';
import { ingestDocument } from '../server/agents/rag';
import { getDataPath, getDataRoot } from '../server/config/data_path';
import * as OrgKB from '../server/org/kb';
import { analyzeScreen } from '../server/llm/adapter';
import { getUserPreferredVision, type VisionProvider } from '../server/llm/vision_preferences';

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
const MAX_UPLOAD_FILES = Math.max(20, Number(process.env.KNOWLEDGE_UPLOAD_MAX_FILES || 200));
const upload = multer({ dest: tmpDir, limits: { fileSize: 500 * 1024 * 1024, files: MAX_UPLOAD_FILES } });

type KnowledgeStatus = 'ready' | 'indexing' | 'indexed' | 'partial' | 'unsupported' | 'failed';
type ExtractionMethod = 'text' | 'docx' | 'spreadsheet' | 'pdf' | 'image-vision' | 'image-metadata' | 'unsupported';

interface KnowledgeExtractionResult {
  content: string | null;
  method: ExtractionMethod;
  status: Extract<KnowledgeStatus, 'indexed' | 'partial' | 'unsupported' | 'failed'>;
  warning?: string;
  error?: string;
  provider?: VisionProvider;
  model?: string;
}

interface KnowledgeExtractionDeps {
  llmGetters?: Record<string, (() => any) | undefined>;
}

let knowledgeExtractionDeps: KnowledgeExtractionDeps = {};
let sharpLoader: Promise<any> | null = null;

export function configureKnowledgeFileRoutes(deps: KnowledgeExtractionDeps): void {
  knowledgeExtractionDeps = { ...knowledgeExtractionDeps, ...deps };
}

async function getSharp() {
  if (!sharpLoader) {
    sharpLoader = import('sharp').then(mod => mod.default || mod);
  }
  return sharpLoader;
}

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
  status: KnowledgeStatus;
  extractionStatus?: KnowledgeExtractionResult['status'];
  extractionMethod?: ExtractionMethod;
  extractionWarning?: string;
  extractionError?: string;
  contentChars?: number;
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

function visionModelFor(provider: VisionProvider): string {
  switch (provider) {
    case 'qwen': return 'qwen-vl-max';
    case 'ark': return 'doubao-1-5-vision-pro-32k';
    case 'ollama': return 'qwen2.5vl:7b';
    case 'lmstudio': return 'local-vision-model';
    case 'relay': return 'qwen2.5-vl-7b-instruct';
    case 'openai': return 'gpt-4o';
    case 'gemini':
    default:
      return 'gemini-2.0-flash';
  }
}

function resolveKnowledgeVisionProvider(userId: string): VisionProvider | null {
  const g = knowledgeExtractionDeps.llmGetters || {};
  const provider = getUserPreferredVision(userId).provider;
  if (provider === 'openai' && g.getOpenAI?.()) return 'openai';
  if (provider === 'gemini' && g.getGemini?.()) return 'gemini';
  if (provider === 'ark' && g.getArk?.()) return 'ark';
  if (provider === 'qwen' && g.getQwen?.()) return 'qwen';
  if (provider === 'ollama' && g.getOllama?.()) return 'ollama';
  if (provider === 'lmstudio' && g.getLmStudio?.()) return 'lmstudio';
  if (provider === 'relay' && g.getRelay?.()) return 'relay';
  return null;
}

async function extractImageKnowledge(filePath: string, userId: string): Promise<KnowledgeExtractionResult> {
  let meta: any = {};
  try {
    const sharp = await getSharp();
    meta = await sharp(filePath).metadata();
    const provider = resolveKnowledgeVisionProvider(userId);
    const displayName = repairFilename(path.basename(filePath));
    const imageInfo = [
      `[Image File] ${displayName}`,
      `Format: ${meta.format || path.extname(filePath).replace(/^\./, '') || 'unknown'}`,
      `Size: ${meta.width || '?'} x ${meta.height || '?'} px`,
    ].join('\n');

    if (!provider) {
      return {
        content: `${imageInfo}\n\nVisual analysis was not run because no configured vision model is available for this user.`,
        method: 'image-metadata',
        status: 'partial',
        warning: 'No configured vision model is available. Configure a vision provider to extract text and visual content from images.',
      };
    }

    const g = knowledgeExtractionDeps.llmGetters || {};
    const buffer = await sharp(filePath)
      .rotate()
      .resize({ width: 1800, height: 1800, fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
    const base64 = buffer.toString('base64');
    const preferred = getUserPreferredVision(userId);
    const model = preferred.model || visionModelFor(provider);
    const prompt = [
      'Prepare this uploaded image for Lumi knowledge-base retrieval.',
      'Extract every readable text exactly as visible. Then summarize the visual content, tables, diagrams, screenshots, documents, labels, entities, and relationships that may be useful later.',
      'Return structured plain text in the image language when possible. Do not invent details that are not visible.',
      `File name: ${displayName}`,
    ].join('\n');
    const imagePayload = JSON.stringify({
      image_base64: base64,
      format: 'jpeg',
      width: meta.width || null,
      height: meta.height || null,
    });
    const analysis = await analyzeScreen(
      imagePayload,
      prompt,
      { provider, model, userId, maxTokens: 2200 },
      g.getDeepSeek,
      g.getGemini,
      g.getOpenAI,
      g.getAnthropic,
      g.getQwen,
      g.getOllama,
      g.getLmStudio,
      g.getArk,
      g.getXiaomi,
      g.getKimi,
      g.getGlm,
      g.getRelay,
    );

    return {
      content: `${imageInfo}\nVision provider: ${provider}/${model}\n\nExtracted visual knowledge:\n${String(analysis || '').trim()}`,
      method: 'image-vision',
      status: 'indexed',
      provider,
      model,
    };
  } catch (err: any) {
    const fallback = [
      `[Image File] ${repairFilename(path.basename(filePath))}`,
      meta?.format ? `Format: ${meta.format}` : '',
      meta?.width || meta?.height ? `Size: ${meta.width || '?'} x ${meta.height || '?'} px` : '',
    ].filter(Boolean).join('\n');
    return {
      content: fallback || null,
      method: fallback ? 'image-metadata' : 'unsupported',
      status: fallback ? 'partial' : 'failed',
      error: err?.message || String(err),
      warning: fallback ? 'Image vision extraction failed; only file metadata was indexed.' : undefined,
    };
  }
}

async function extractKnowledgeFileContent(filePath: string, userId = 'anonymous'): Promise<KnowledgeExtractionResult> {
  const extName = path.extname(filePath);
  try {
    if (TEXT_KNOWLEDGE_EXTS.test(extName)) {
      return { content: fs.readFileSync(filePath, 'utf-8'), method: 'text', status: 'indexed' };
    }
    if (/\.docx$/i.test(extName)) {
      const mammoth = await import('mammoth');
      return { content: (await mammoth.extractRawText({ path: filePath })).value, method: 'docx', status: 'indexed' };
    }
    if (/\.xlsx?$/i.test(extName)) {
      const XLSX = await import('xlsx');
      const wb = XLSX.readFile(filePath);
      const content = wb.SheetNames.map((name: string) => {
        const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name]);
        return `[${name}]\n${csv}`;
      }).join('\n\n');
      return { content, method: 'spreadsheet', status: 'indexed' };
    }
    if (/\.pdf$/i.test(extName)) {
      const pdfModule: any = await import('pdf-parse');
      const pdfParse = pdfModule.default || pdfModule;
      return { content: (await pdfParse(fs.readFileSync(filePath))).text, method: 'pdf', status: 'indexed' };
    }
    if (IMAGE_KNOWLEDGE_EXTS.test(extName)) {
      return await extractImageKnowledge(filePath, userId);
    }
  } catch (err: any) {
    console.warn(`[Files] Failed to extract "${path.basename(filePath)}": ${err.message}`);
    return { content: null, method: 'unsupported', status: 'failed', error: err.message };
  }
  return {
    content: null,
    method: 'unsupported',
    status: 'unsupported',
    warning: 'This file type has no supported text or visual extraction path yet.',
  };
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

function applyExtractionMeta(meta: any, extraction: KnowledgeExtractionResult, content: string | null): void {
  if (!meta) return;
  meta.extractionStatus = extraction.status;
  meta.extractionMethod = extraction.method;
  meta.extractionWarning = extraction.warning || '';
  meta.extractionError = extraction.error || '';
  meta.extractionProvider = extraction.provider || '';
  meta.extractionModel = extraction.model || '';
  meta.contentChars = content?.length || 0;
  meta.updatedAt = new Date().toISOString();
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

function buildEntry(filename: string, source: 'upload' | 'generated' | 'ingested', agentIds: string[] = [], scope: FileScope, status?: KnowledgeStatus, meta?: any): KnowledgeEntry {
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
    extractionStatus: meta?.extractionStatus,
    extractionMethod: meta?.extractionMethod,
    extractionWarning: meta?.extractionWarning || undefined,
    extractionError: meta?.extractionError || undefined,
    contentChars: meta?.contentChars || undefined,
    updatedAt: st.mtime.toISOString(),
    createdAt: st.birthtime.toISOString(),
  };
}

// ── GET /files/list — list knowledge base files ──
router.get('/files/list', (req: Request, res: Response) => {
  try {
    const scope = getFileScope(req);
    const db = readDB();
    const fileMeta: Record<string, any> = {};
    if (db.knowledgeFiles) {
      for (const m of db.knowledgeFiles) {
        if (!metaMatchesScope(m, scope)) continue;
        fileMeta[m.filename] = m;
      }
    }

    const entries = fs.readdirSync(scope.dir);
    const files: KnowledgeEntry[] = [];
    for (const name of entries) {
      if (name.startsWith('.') || name.startsWith('_')) continue;
      const meta = fileMeta[name] || { source: 'upload' as const, agentIds: [] as string[] };
      const source = (meta.source as 'upload' | 'generated' | 'ingested') || 'upload';
      files.push(buildEntry(name, source, meta.agentIds, scope, meta.status, meta));
    }

    files.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
    res.json({ files });
  } catch (err: any) {
    sendRouteError(res, err, 500);
  }
});

// ── POST /files/upload — upload files + auto-ingest into Lumi's memory ──
router.post('/files/upload', requireAuth, upload.array('files', MAX_UPLOAD_FILES), async (req: Request, res: Response) => {
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
      let extraction: KnowledgeExtractionResult = {
        content: null,
        method: 'unsupported',
        status: 'unsupported',
      };
      let extractedContent: string | null = null;

      // Extract supported document/image content so Lumi can retrieve it later.
      if (TEXT_KNOWLEDGE_EXTS.test(ext) || EXTRACTABLE_KNOWLEDGE_EXTS.test(ext) || IMAGE_KNOWLEDGE_EXTS.test(ext)) {
        extraction = await extractKnowledgeFileContent(dest, userId);
        extractedContent = extraction.content;
        entry.extractionStatus = extraction.status;
        entry.extractionMethod = extraction.method;
        entry.extractionWarning = extraction.warning;
        entry.extractionError = extraction.error;
        if (extractedContent) {
          entry.content = extractedContent.slice(0, 50000); // cap at 50KB for chat context
          entry.preview = extractedContent.slice(0, 1000);
          entry.extracted = true;
        }
      }

      // Personal files are ingested into personal memory; work files become org KB articles.
      if (scope.domain === 'work') {
        try {
          const meta = findFileMeta(db, finalName, scope);
          if (meta) applyExtractionMeta(meta, extraction, extractedContent);
          if (extractedContent?.trim()) {
            const article = ensureOrgArticleFromFile(scope, userId, finalName, extractedContent, meta?.orgArticleId);
            if (meta) {
              if (!Array.isArray(meta.agentIds)) meta.agentIds = [];
              meta.orgArticleId = article?.id;
              meta.status = extraction.status === 'partial' ? 'partial' : 'indexed';
              if (!meta.agentIds.includes('org-kb')) meta.agentIds.push('org-kb');
            }
            entry.orgArticleId = article?.id;
            entry.ingested = true;
            entry.partial = extraction.status === 'partial';
          } else if (meta) {
            meta.status = extraction.status === 'failed' ? 'failed' : extraction.status === 'unsupported' ? 'unsupported' : 'ready';
            entry.syncError = extraction.error || extraction.warning || 'No extractable content found';
          }
        } catch (orgErr: any) {
          console.warn(`[OrgKB] Failed to sync "${finalName}": ${orgErr.message}`);
          entry.syncError = orgErr.message;
        }
      } else if (extractedContent?.trim()) {
        try {
          const result = await ingestDocument(userId, 'lumi', finalName, extractedContent, {
            filePath: dest,
            domain: scope.domain,
            orgId: scope.orgId || '',
          });
          const meta = findFileMeta(db, finalName, scope);
          if (meta) {
            if (!Array.isArray(meta.agentIds)) meta.agentIds = [];
            if (!meta.agentIds.includes('lumi')) meta.agentIds.push('lumi');
            meta.status = extraction.status === 'partial' ? 'partial' : 'indexed';
            applyExtractionMeta(meta, extraction, extractedContent);
          }
          entry.ingested = true;
          entry.partial = extraction.status === 'partial';
          console.log(`[AutoIngest] "${finalName}" -> ${result.chunkCount} chunks`);
        } catch (ingestErr: any) {
          console.warn(`[AutoIngest] Failed for "${finalName}": ${ingestErr.message}`);
          const meta = findFileMeta(db, finalName, scope);
          if (meta) {
            meta.status = 'failed';
            meta.extractionError = ingestErr.message;
          }
          entry.syncError = ingestErr.message;
        }
      } else {
        const meta = findFileMeta(db, finalName, scope);
        if (meta) {
          applyExtractionMeta(meta, extraction, extractedContent);
          meta.status = extraction.status === 'failed' ? 'failed' : extraction.status === 'unsupported' ? 'unsupported' : 'ready';
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
    const generatedExtraction: KnowledgeExtractionResult = { content: contentText, method: 'text', status: 'indexed' };
    if (meta) applyExtractionMeta(meta, generatedExtraction, contentText);
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
        const result = await ingestDocument(userId, 'lumi', safeName, contentText, {
          filePath,
          domain: scope.domain,
          orgId: scope.orgId || '',
        });
        if (!Array.isArray(meta.agentIds)) meta.agentIds = [];
        if (!meta.agentIds.includes('lumi')) meta.agentIds.push('lumi');
        meta.status = 'indexed';
        applyExtractionMeta(meta, generatedExtraction, contentText);
        console.log(`[AutoIngest] "${safeName}" -> ${result.chunkCount} chunks`);
      } catch (ingestErr: any) {
        console.warn(`[AutoIngest] Failed for generated "${safeName}": ${ingestErr.message}`);
      }
    }
    writeDB(db);

    res.json({ success: true, filename: safeName, orgArticleId, entry: buildEntry(safeName, 'generated', meta?.agentIds || [], scope, meta?.status, meta) });
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
      status: meta?.status || ((meta?.agentIds || []).length > 0 ? 'indexed' : 'ready'),
      extractionStatus: meta?.extractionStatus,
      extractionMethod: meta?.extractionMethod,
      extractionWarning: meta?.extractionWarning || undefined,
      extractionError: meta?.extractionError || undefined,
      contentChars: meta?.contentChars || undefined,
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

    const extraction = await extractKnowledgeFileContent(filePath, userId);
    const content = extraction.content;

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
    applyExtractionMeta(meta, extraction, content);
    if (!content || !content.trim()) {
      meta.status = extraction.status === 'failed' ? 'failed' : extraction.status === 'unsupported' ? 'unsupported' : 'ready';
      writeDB(db);
      return res.status(415).json({
        error: extraction.error || extraction.warning || 'This file type has no extractable text or visual content for Lumi to absorb',
        extractionStatus: extraction.status,
        extractionMethod: extraction.method,
      });
    }
    meta.indexingAt = new Date().toISOString();
    writeDB(db);

    if (scope.domain === 'work') {
      const article = ensureOrgArticleFromFile(scope, userId, safeName, content, meta?.orgArticleId);
      if (!meta.agentIds.includes('org-kb')) meta.agentIds.push('org-kb');
      meta.orgArticleId = article?.id;
      meta.status = extraction.status === 'partial' ? 'partial' : 'indexed';
      applyExtractionMeta(meta, extraction, content);
      delete meta.indexingAt;
      writeDB(db);
      res.json({ success: true, orgArticleId: article?.id, memoryIds: [], extractionStatus: extraction.status });
      return;
    }

    const result = await ingestDocument(userId, agentId, safeName, content, {
      filePath,
      domain: scope.domain,
      orgId: scope.orgId || '',
    });

    // Mark as indexed
    if (!meta.agentIds.includes(agentId)) meta.agentIds.push(agentId);
    meta.status = extraction.status === 'partial' ? 'partial' : 'indexed';
    applyExtractionMeta(meta, extraction, content);
    delete meta.indexingAt;
    writeDB(db);

    res.json({ success: true, chunkCount: result.chunkCount, memoryIds: result.memoryIds, extractionStatus: extraction.status });
  } catch (err: any) {
    sendRouteError(res, err, 500);
  }
});

export default router;
