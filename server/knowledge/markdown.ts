import path from 'path';

export interface MarkdownKnowledgeMetadata {
  kind: 'markdown';
  title: string;
  aliases: string[];
  tags: string[];
  wikiLinks: string[];
  markdownLinks: string[];
  links: string[];
  frontmatter: Record<string, string | string[] | number | boolean>;
}

export interface EnrichedMarkdownKnowledge {
  content: string;
  metadata: MarkdownKnowledgeMetadata;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;
const MAX_METADATA_ITEMS = 60;

export function enrichMarkdownKnowledgeContent(raw: string, filename = 'untitled.md'): EnrichedMarkdownKnowledge {
  const source = String(raw || '');
  const { frontmatter, body } = splitFrontmatter(source);
  const bodyForLinks = stripCodeBlocks(body);
  const aliases = uniqueStrings([
    ...asStringList(frontmatter.aliases),
    ...asStringList(frontmatter.alias),
  ]);
  const tags = uniqueStrings([
    ...asStringList(frontmatter.tags),
    ...asStringList(frontmatter.tag),
    ...extractInlineTags(bodyForLinks),
  ]).map(normalizeTag).filter(Boolean).slice(0, MAX_METADATA_ITEMS);
  const wikiLinks = uniqueStrings(extractWikiLinks(bodyForLinks)).slice(0, MAX_METADATA_ITEMS);
  const markdownLinks = uniqueStrings(extractMarkdownLinks(bodyForLinks)).slice(0, MAX_METADATA_ITEMS);
  const links = uniqueStrings([...wikiLinks, ...markdownLinks]).slice(0, MAX_METADATA_ITEMS);
  const title = deriveTitle(frontmatter, body, filename);

  const metadata: MarkdownKnowledgeMetadata = {
    kind: 'markdown',
    title,
    aliases: aliases.slice(0, MAX_METADATA_ITEMS),
    tags,
    wikiLinks,
    markdownLinks,
    links,
    frontmatter,
  };

  const prefix = formatMarkdownKnowledgePrelude(metadata, filename);
  const cleanedBody = body.trim();
  return {
    content: [prefix, cleanedBody].filter(Boolean).join('\n\n'),
    metadata,
  };
}

export function normalizeKnowledgeLinkTarget(value: string): string {
  let target = String(value || '').trim();
  if (!target) return '';
  target = target.replace(/^!?\[\[/, '').replace(/\]\]$/, '');
  target = target.split('|')[0].split('#')[0].split('^')[0].trim();
  target = target.replace(/^<|>$/g, '').replace(/^['"]|['"]$/g, '');
  if (/^[a-z][a-z0-9+.-]*:/i.test(target)) return '';
  try {
    target = decodeURIComponent(target);
  } catch {}
  target = target.replace(/\\/g, '/');
  target = path.posix.basename(target);
  target = target.replace(/\.(md|markdown)$/i, '');
  return target.normalize('NFC').toLowerCase();
}

function splitFrontmatter(raw: string): {
  frontmatter: MarkdownKnowledgeMetadata['frontmatter'];
  body: string;
} {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) return { frontmatter: {}, body: raw };
  return {
    frontmatter: parseSimpleFrontmatter(match[1] || ''),
    body: raw.slice(match[0].length),
  };
}

function parseSimpleFrontmatter(block: string): MarkdownKnowledgeMetadata['frontmatter'] {
  const result: MarkdownKnowledgeMetadata['frontmatter'] = {};
  const lines = block.split(/\r?\n/);
  let activeArrayKey = '';

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    if (activeArrayKey && line.startsWith('- ')) {
      const current = result[activeArrayKey];
      const list = Array.isArray(current) ? current : [];
      list.push(stripQuotes(line.slice(2).trim()));
      result[activeArrayKey] = list;
      continue;
    }

    activeArrayKey = '';
    const match = line.match(/^([A-Za-z0-9_-]+):(?:\s*(.*))?$/);
    if (!match) continue;

    const key = match[1];
    const value = (match[2] || '').trim();
    if (!value) {
      result[key] = [];
      activeArrayKey = key;
      continue;
    }
    result[key] = parseFrontmatterValue(value);
  }

  return result;
}

function parseFrontmatterValue(value: string): string | string[] | number | boolean {
  if (/^\[.*\]$/.test(value)) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(',').map(item => stripQuotes(item.trim())).filter(Boolean);
  }
  if (/^(true|false)$/i.test(value)) return value.toLowerCase() === 'true';
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  if (value.includes(',') && !/^\d{4}-\d{2}-\d{2}/.test(value)) {
    return value.split(',').map(item => stripQuotes(item.trim())).filter(Boolean);
  }
  return stripQuotes(value);
}

function stripQuotes(value: string): string {
  return value.replace(/^['"]|['"]$/g, '').trim();
}

function asStringList(value: unknown): string[] {
  if (Array.isArray(value)) return value.map(item => String(item || '').trim()).filter(Boolean);
  if (typeof value === 'string') {
    return value
      .split(/[,\s]+/)
      .map(item => item.trim())
      .filter(Boolean);
  }
  return [];
}

function stripCodeBlocks(value: string): string {
  return String(value || '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/~~~[\s\S]*?~~~/g, '')
    .replace(/`[^`\n]*`/g, '');
}

function extractInlineTags(value: string): string[] {
  const tags: string[] = [];
  const re = /(^|[\s([{])#([\p{L}\p{N}_/-]+)(?=$|[\s.,;:!?()[\]{}'"<>])/gu;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const tag = match[2] || '';
    if (/^[0-9a-f]{3,8}$/i.test(tag)) continue;
    tags.push(tag);
  }
  return tags;
}

function extractWikiLinks(value: string): string[] {
  const links: string[] = [];
  const re = /!?\[\[([^\]\n]+)\]\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const target = normalizeDisplayLink(match[1] || '');
    if (target) links.push(target);
  }
  return links;
}

function extractMarkdownLinks(value: string): string[] {
  const links: string[] = [];
  const re = /!?\[[^\]\n]*\]\(([^)\s]+)(?:\s+["'][^"']*["'])?\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(value)) !== null) {
    const target = normalizeDisplayLink(match[1] || '');
    if (target) links.push(target);
  }
  return links;
}

function normalizeDisplayLink(value: string): string {
  return String(value || '')
    .split('|')[0]
    .split('#')[0]
    .split('^')[0]
    .replace(/^<|>$/g, '')
    .trim();
}

function normalizeTag(value: string): string {
  return String(value || '').replace(/^#/, '').trim();
}

function deriveTitle(
  frontmatter: MarkdownKnowledgeMetadata['frontmatter'],
  body: string,
  filename: string,
): string {
  const fmTitle = frontmatter.title;
  if (typeof fmTitle === 'string' && fmTitle.trim()) return fmTitle.trim();
  const heading = body.match(/^#\s+(.+)$/m)?.[1]?.trim();
  if (heading) return heading;
  return path.basename(filename, path.extname(filename)).trim() || filename;
}

function formatMarkdownKnowledgePrelude(metadata: MarkdownKnowledgeMetadata, filename: string): string {
  const lines = [
    '[Markdown Source]',
    `File: ${filename}`,
    `Title: ${metadata.title}`,
  ];
  if (metadata.aliases.length > 0) lines.push(`Aliases: ${metadata.aliases.join(', ')}`);
  if (metadata.tags.length > 0) lines.push(`Tags: ${metadata.tags.map(tag => `#${tag}`).join(', ')}`);
  if (metadata.links.length > 0) lines.push(`Links: ${metadata.links.join(', ')}`);

  const propertyKeys = Object.keys(metadata.frontmatter)
    .filter(key => !['title', 'aliases', 'alias', 'tags', 'tag'].includes(key))
    .slice(0, 20);
  if (propertyKeys.length > 0) {
    lines.push(`Properties: ${propertyKeys.map(key => `${key}=${formatProperty(metadata.frontmatter[key])}`).join('; ')}`);
  }
  return lines.join('\n');
}

function formatProperty(value: string | string[] | number | boolean): string {
  if (Array.isArray(value)) return value.join(',');
  return String(value);
}

function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    const cleaned = String(value || '').trim();
    if (!cleaned) continue;
    const key = cleaned.normalize('NFC').toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(cleaned);
  }
  return result;
}
