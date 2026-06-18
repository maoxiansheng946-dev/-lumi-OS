import fs from 'fs';
import os from 'os';
import path from 'path';
import { ToolRegistry } from '../registry';
import { ToolContext } from '../types';
import { getDataPath } from '../../config/data_path';
import { getExternalAppAdapters } from '../../external_apps/adapters';
import { isExternalAppAutomationAllowed, isMessagingSendConfirmationRequired } from '../../autonomy/safety_gate';

function requireDesktopRelay(context?: ToolContext) {
  if (!context?.desktopRelay) {
    throw new Error('External app actions require the Lumi desktop client relay.');
  }
  return context.desktopRelay;
}

function requireExternalAutomation() {
  if (!isExternalAppAutomationAllowed()) {
    throw new Error('External app automation is disabled. Enable it in Settings > Autonomy before opening or controlling external apps.');
  }
}

function normalizeUrl(args: Record<string, any>): string {
  const rawUrl = String(args.url || '').trim();
  const query = String(args.query || '').trim();
  if (rawUrl) {
    if (/^https?:\/\//i.test(rawUrl)) return rawUrl;
    return `https://${rawUrl}`;
  }
  if (!query) throw new Error('Provide either url or query.');
  return `https://www.bing.com/search?q=${encodeURIComponent(query)}`;
}

function buildMessageDraft(args: Record<string, any>): string {
  const explicitDraft = String(args.draft || '').trim();
  if (explicitDraft) return explicitDraft;

  const contact = String(args.contact || '').trim();
  const context = String(args.context || '').trim();
  const intent = String(args.intent || 'reply clearly and helpfully').trim();
  const tone = String(args.tone || 'warm and concise').trim();

  const lines = [
    contact ? `${contact}，` : '',
    `我看到了，我这边会按“${intent}”来处理。`,
  ];
  if (context) {
    lines.push(`关于你提到的“${context.slice(0, 160)}”，我会先确认关键点，再推进下一步。`);
  }
  lines.push(tone.includes('formal') ? '如有变动我会及时同步。' : '有变化我马上同步你。');
  return lines.filter(Boolean).join('\n');
}

function safeFileName(value: string): string {
  const cleaned = (value || 'cad_drawing')
    .replace(/[<>:"/\\|?*\x00-\x1f]+/g, '_')
    .replace(/\s+/g, '_')
    .replace(/^\.+|\.+$/g, '')
    .replace(/^_+|_+$/g, '')
    .trim();
  return Array.from(cleaned || 'cad_drawing').slice(0, 64).join('') || 'cad_drawing';
}

function safeLayer(value: any, fallback: string): string {
  return String(value || fallback)
    .replace(/[^a-zA-Z0-9_$-]+/g, '_')
    .slice(0, 31) || fallback;
}

function dxfLine(x1: number, y1: number, x2: number, y2: number, layer = 'CUT'): string[] {
  return ['0', 'LINE', '8', layer, '10', String(x1), '20', String(y1), '30', '0', '11', String(x2), '21', String(y2), '31', '0'];
}

function dxfCircle(x: number, y: number, r: number, layer = 'HOLE'): string[] {
  return ['0', 'CIRCLE', '8', layer, '10', String(x), '20', String(y), '30', '0', '40', String(r)];
}

function dxfArc(cx: number, cy: number, r: number, start: number, end: number, layer = 'CUT'): string[] {
  return ['0', 'ARC', '8', layer, '10', String(cx), '20', String(cy), '30', '0', '40', String(r), '50', String(start), '51', String(end)];
}

function dxfText(x: number, y: number, text: string, height = 240, layer = 'TEXT'): string[] {
  return ['0', 'TEXT', '8', layer, '10', String(x), '20', String(y), '30', '0', '40', String(height), '1', text.slice(0, 80)];
}

function svgEscape(value: any): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildRoundedRectEntities(width: number, height: number, radius: number): string[] {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const r = Math.max(0, Math.min(radius, Math.min(w, h) / 2));
  if (r <= 0) {
    return [
      ...dxfLine(0, 0, w, 0),
      ...dxfLine(w, 0, w, h),
      ...dxfLine(w, h, 0, h),
      ...dxfLine(0, h, 0, 0),
    ];
  }
  return [
    ...dxfLine(r, 0, w - r, 0),
    ...dxfLine(w, r, w, h - r),
    ...dxfLine(w - r, h, r, h),
    ...dxfLine(0, h - r, 0, r),
    ...dxfArc(w - r, r, r, 270, 360),
    ...dxfArc(w - r, h - r, r, 0, 90),
    ...dxfArc(r, h - r, r, 90, 180),
    ...dxfArc(r, r, r, 180, 270),
  ];
}

function buildDxf(args: Record<string, any>): string {
  const width = Math.max(1, Number(args.width) || 100);
  const height = Math.max(1, Number(args.height) || 60);
  const radius = Math.max(0, Number(args.cornerRadius) || 0);
  const holes = Array.isArray(args.holes) ? args.holes : [];
  const walls = Array.isArray(args.walls) ? args.walls : Array.isArray(args.lines) ? args.lines : [];
  const rooms = Array.isArray(args.rooms) ? args.rooms : [];
  const labels = Array.isArray(args.labels) ? args.labels : [];
  const entities: string[] = [
    '0', 'SECTION', '2', 'ENTITIES',
    ...buildRoundedRectEntities(width, height, radius),
  ];

  for (const wall of walls.slice(0, 500)) {
    const x1 = Number(wall?.x1 ?? wall?.from?.x);
    const y1 = Number(wall?.y1 ?? wall?.from?.y);
    const x2 = Number(wall?.x2 ?? wall?.to?.x);
    const y2 = Number(wall?.y2 ?? wall?.to?.y);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      entities.push(...dxfLine(x1, y1, x2, y2, safeLayer(wall?.layer, 'WALL')));
    }
  }

  for (const room of rooms.slice(0, 120)) {
    const x = Number(room?.x);
    const y = Number(room?.y);
    const w = Number(room?.width ?? room?.w);
    const h = Number(room?.height ?? room?.h);
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
      const layer = safeLayer(room?.layer, 'ROOM');
      entities.push(...dxfLine(x, y, x + w, y, layer));
      entities.push(...dxfLine(x + w, y, x + w, y + h, layer));
      entities.push(...dxfLine(x + w, y + h, x, y + h, layer));
      entities.push(...dxfLine(x, y + h, x, y, layer));
      if (room?.name) {
        entities.push(...dxfText(x + 120, y + Math.min(h / 2, 600), String(room.name), Number(room?.textHeight) || 220, 'TEXT'));
      }
    }
  }

  for (const hole of holes.slice(0, 40)) {
    const x = Number(hole?.x);
    const y = Number(hole?.y);
    const r = Number(hole?.r ?? hole?.radius);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r) && r > 0) {
      entities.push(...dxfCircle(x, y, r));
    }
  }

  for (const label of labels.slice(0, 160)) {
    const x = Number(label?.x);
    const y = Number(label?.y);
    const text = String(label?.text || label?.name || '').trim();
    if (Number.isFinite(x) && Number.isFinite(y) && text) {
      entities.push(...dxfText(x, y, text, Number(label?.height) || 220, safeLayer(label?.layer, 'TEXT')));
    }
  }

  entities.push('0', 'ENDSEC', '0', 'EOF');
  return `${entities.join('\n')}\n`;
}

function buildCadPreviewSvg(args: Record<string, any>, title: string): string {
  const width = Math.max(1, Number(args.width) || 100);
  const height = Math.max(1, Number(args.height) || 60);
  const radius = Math.max(0, Number(args.cornerRadius) || 0);
  const holes = Array.isArray(args.holes) ? args.holes : [];
  const walls = Array.isArray(args.walls) ? args.walls : Array.isArray(args.lines) ? args.lines : [];
  const rooms = Array.isArray(args.rooms) ? args.rooms : [];
  const labels = Array.isArray(args.labels) ? args.labels : [];
  const margin = Math.max(width, height) * 0.05;
  const viewBox = `${-margin} ${-margin} ${width + margin * 2} ${height + margin * 2}`;
  const strokeWidth = Math.max(1, Math.min(width, height) / 260);
  const textSize = Math.max(180, Math.min(width, height) / 32);
  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${viewBox}" width="960" height="640">`,
    '<rect x="-100000" y="-100000" width="200000" height="200000" fill="#08111f"/>',
    `<text x="0" y="${-margin * 0.35}" fill="#9fb7d8" font-size="${textSize}" font-family="Arial, sans-serif">${svgEscape(title)}</text>`,
    `<rect x="0" y="0" width="${width}" height="${height}" rx="${radius}" ry="${radius}" fill="none" stroke="#38bdf8" stroke-width="${strokeWidth * 1.4}"/>`,
  ];

  for (const room of rooms.slice(0, 120)) {
    const x = Number(room?.x);
    const y = Number(room?.y);
    const w = Number(room?.width ?? room?.w);
    const h = Number(room?.height ?? room?.h);
    if ([x, y, w, h].every(Number.isFinite) && w > 0 && h > 0) {
      parts.push(`<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="rgba(45,212,191,0.08)" stroke="#2dd4bf" stroke-width="${strokeWidth}"/>`);
      if (room?.name) {
        parts.push(`<text x="${x + 120}" y="${y + Math.min(h / 2, 600)}" fill="#d8f3ff" font-size="${Number(room?.textHeight) || textSize}" font-family="Arial, sans-serif">${svgEscape(room.name)}</text>`);
      }
    }
  }

  for (const wall of walls.slice(0, 500)) {
    const x1 = Number(wall?.x1 ?? wall?.from?.x);
    const y1 = Number(wall?.y1 ?? wall?.from?.y);
    const x2 = Number(wall?.x2 ?? wall?.to?.x);
    const y2 = Number(wall?.y2 ?? wall?.to?.y);
    if ([x1, y1, x2, y2].every(Number.isFinite)) {
      parts.push(`<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#fbbf24" stroke-width="${strokeWidth * 1.8}" stroke-linecap="round"/>`);
    }
  }

  for (const hole of holes.slice(0, 40)) {
    const x = Number(hole?.x);
    const y = Number(hole?.y);
    const r = Number(hole?.r ?? hole?.radius);
    if (Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(r) && r > 0) {
      parts.push(`<circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="#f472b6" stroke-width="${strokeWidth}"/>`);
    }
  }

  for (const label of labels.slice(0, 160)) {
    const x = Number(label?.x);
    const y = Number(label?.y);
    const text = String(label?.text || label?.name || '').trim();
    if (Number.isFinite(x) && Number.isFinite(y) && text) {
      parts.push(`<text x="${x}" y="${y}" fill="#e5e7eb" font-size="${Number(label?.height) || textSize}" font-family="Arial, sans-serif">${svgEscape(text)}</text>`);
    }
  }

  parts.push('</svg>');
  return parts.join('');
}

function getCadPreviewPath(dxfPath: string): string {
  return dxfPath.replace(/\.dxf$/i, '.svg');
}

function ensureDxfExtension(filePath: string): string {
  return /\.dxf$/i.test(filePath) ? filePath : `${filePath}.dxf`;
}

function expandHomePath(filePath: string): string {
  return filePath.replace(/^~(?=$|[\\/])/, os.homedir());
}

function assertWritableCadPath(filePath: string) {
  const normalized = path.normalize(filePath);
  const lower = normalized.toLowerCase();
  const blocked = [
    path.normalize('C:\\Windows').toLowerCase(),
    path.normalize('C:\\Program Files').toLowerCase(),
    path.normalize('C:\\Program Files (x86)').toLowerCase(),
  ];
  if (blocked.some(root => lower === root || lower.startsWith(root + path.sep.toLowerCase()))) {
    throw new Error(`Refusing to write CAD output inside a system directory: ${normalized}`);
  }
}

function resolveCadOutputPath(args: Record<string, any>, title: string): string {
  const outputPath = String(args.outputPath || '').trim();
  const outputDirectory = String(args.outputDirectory || '').trim();
  if (outputPath) {
    const baseDir = outputDirectory ? expandHomePath(outputDirectory) : getDataPath('cad');
    const resolved = path.isAbsolute(outputPath)
      ? expandHomePath(outputPath)
      : path.resolve(baseDir, outputPath);
    const finalPath = ensureDxfExtension(resolved);
    assertWritableCadPath(finalPath);
    fs.mkdirSync(path.dirname(finalPath), { recursive: true });
    return finalPath;
  }

  const directory = outputDirectory
    ? path.resolve(expandHomePath(outputDirectory))
    : getDataPath('cad');
  const finalPath = path.join(directory, `${title}_${Date.now()}.dxf`);
  assertWritableCadPath(finalPath);
  fs.mkdirSync(path.dirname(finalPath), { recursive: true });
  return finalPath;
}

export function registerExternalAppTools(registry: ToolRegistry): void {
  registry.register({
    name: 'external_app_list_adapters',
    description: 'List Lumi external app adapters and their safety policies for browser, messaging, CAD, and other AI apps.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
    },
    handler: async () => JSON.stringify({
      externalAppAutomationEnabled: isExternalAppAutomationAllowed(),
      messagingSendRequiresConfirmation: isMessagingSendConfirmationRequired(),
      adapters: getExternalAppAdapters(),
    }, null, 2),
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'browser_open_task',
    description: 'Prepare or open a browser task. By default returns the target URL without opening it; set open=true only when the user wants the browser opened.',
    parameters: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open. If omitted, query is converted to a Bing search URL.' },
        query: { type: 'string', description: 'Search query when no URL is provided.' },
        open: { type: 'boolean', description: 'Open the URL in the desktop browser. Requires external app automation.' },
      },
      required: [],
    },
    handler: async (args, context) => {
      const target = normalizeUrl(args);
      if (!args.open) {
        return JSON.stringify({ target, opened: false, note: 'Set open=true after user confirmation to open the browser.' }, null, 2);
      }
      requireExternalAutomation();
      const desktopRelay = requireDesktopRelay(context);
      const result = await desktopRelay('desktop_open', { target });
      return JSON.stringify({ target, opened: true, result }, null, 2);
    },
    permission: 'user',
    securityLevel: 'confirm',
  });

  registry.register({
    name: 'wechat_prepare_reply',
    description: 'Prepare a WeChat or messaging reply draft. This tool never sends messages.',
    parameters: {
      type: 'object',
      properties: {
        contact: { type: 'string', description: 'Recipient name or group name.' },
        context: { type: 'string', description: 'Relevant message context from the user.' },
        intent: { type: 'string', description: 'What the reply should accomplish.' },
        tone: { type: 'string', description: 'Tone, e.g. concise, warm, formal, apologetic.' },
        draft: { type: 'string', description: 'Use this exact draft if already written.' },
      },
      required: [],
    },
    handler: async (args) => JSON.stringify({
      draft: buildMessageDraft(args),
      sendAllowed: false,
      note: 'Lumi prepared a draft only. Sending stays user-confirmed.',
    }, null, 2),
    permission: 'user',
    securityLevel: 'safe',
  });

  registry.register({
    name: 'wechat_copy_reply_draft',
    description: 'Copy a prepared WeChat/messaging reply draft to clipboard and optionally open WeChat. This never presses Send.',
    parameters: {
      type: 'object',
      properties: {
        draft: { type: 'string', description: 'Reply draft to copy.' },
        openWechat: { type: 'boolean', description: 'Open WeChat after copying the draft.' },
        applicationTarget: { type: 'string', description: 'Optional app target, default wechat.exe.' },
      },
      required: ['draft'],
    },
    handler: async (args, context) => {
      requireExternalAutomation();
      const draft = String(args.draft || '').trim();
      if (!draft) throw new Error('Draft is required.');
      const desktopRelay = requireDesktopRelay(context);
      const copied = await desktopRelay('desktop_clipboard_write', { text: draft });
      let opened: string | undefined;
      if (args.openWechat) {
        opened = await desktopRelay('desktop_open', { target: args.applicationTarget || 'wechat.exe' });
      }
      return JSON.stringify({
        copied: true,
        clipboardResult: copied,
        opened: Boolean(args.openWechat),
        openResult: opened,
        sendAllowed: !isMessagingSendConfirmationRequired(),
        note: 'The draft is ready on the clipboard. Lumi did not send the message.',
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'confirm',
  });

  registry.register({
    name: 'cad_generate_dxf',
    description: 'Generate a CAD DXF draft with an outline, optional walls/rooms/labels/holes, and optional explicit output path. Use this as a drafting handoff, not as final engineering verification. If the user asks for a visible desktop file, set outputDirectory or outputPath and verify it after creation.',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'Drawing title / output filename.' },
        width: { type: 'number', description: 'Outer width in chosen units.' },
        height: { type: 'number', description: 'Outer height in chosen units.' },
        unit: { type: 'string', description: 'Unit label, e.g. mm, cm, inch.' },
        cornerRadius: { type: 'number', description: 'Optional rounded corner radius.' },
        outputDirectory: { type: 'string', description: 'Optional directory to save the DXF, e.g. C:\\Users\\name\\Desktop. Use when the user asks to put the file somewhere visible.' },
        outputPath: { type: 'string', description: 'Optional exact DXF output path. Relative paths are resolved under outputDirectory or Lumi CAD data directory.' },
        sourcePath: { type: 'string', description: 'Optional source drawing/image path used for traceability.' },
        walls: {
          type: 'array',
          description: 'Optional CAD wall/line segments: {x1,y1,x2,y2,layer}. Use this for floor-plan drafts.',
          items: { type: 'object' },
        },
        rooms: {
          type: 'array',
          description: 'Optional room rectangles: {name,x,y,width,height}. Adds room outlines and labels.',
          items: { type: 'object' },
        },
        labels: {
          type: 'array',
          description: 'Optional text labels: {text,x,y,height,layer}.',
          items: { type: 'object' },
        },
        holes: {
          type: 'array',
          description: 'Optional holes as objects with x, y, and r/radius.',
          items: { type: 'object' },
        },
        openPreview: { type: 'boolean', description: 'Open the generated DXF with the system default app. Requires external app automation.' },
      },
      required: ['width', 'height'],
    },
    handler: async (args, context) => {
      const title = safeFileName(String(args.title || 'lumi_cad_draft'));
      const outPath = resolveCadOutputPath(args, title);
      fs.writeFileSync(outPath, buildDxf(args), 'utf-8');
      const previewSvg = buildCadPreviewSvg(args, title);
      const previewPath = getCadPreviewPath(outPath);
      fs.writeFileSync(previewPath, previewSvg, 'utf-8');
      const stat = fs.statSync(outPath);
      const previewStat = fs.statSync(previewPath);

      let openResult: string | undefined;
      if (args.openPreview) {
        requireExternalAutomation();
        const desktopRelay = requireDesktopRelay(context);
        openResult = await desktopRelay('desktop_open', { target: outPath });
      }

      return JSON.stringify({
        path: outPath,
        previewPath,
        previewSvg,
        title,
        unit: args.unit || 'unit',
        width: Number(args.width) || 100,
        height: Number(args.height) || 60,
        sourcePath: args.sourcePath || undefined,
        outputDirectory: path.dirname(outPath),
        exists: fs.existsSync(outPath),
        size: stat.size,
        previewExists: fs.existsSync(previewPath),
        previewSize: previewStat.size,
        artifacts: [
          { type: 'dxf', path: outPath },
          { type: 'svg_preview', path: previewPath },
        ],
        walls: Array.isArray(args.walls) ? args.walls.length : Array.isArray(args.lines) ? args.lines.length : 0,
        rooms: Array.isArray(args.rooms) ? args.rooms.length : 0,
        labels: Array.isArray(args.labels) ? args.labels.length : 0,
        holes: Array.isArray(args.holes) ? args.holes.length : 0,
        opened: Boolean(args.openPreview),
        openResult,
        note: 'Generated and verified a DXF draft file. Review dimensions and tolerances before production use.',
      }, null, 2);
    },
    permission: 'user',
    securityLevel: 'confirm',
  });
}
