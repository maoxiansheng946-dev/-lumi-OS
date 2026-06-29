import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { makeApp } from './helpers';
import {
  enrichMarkdownKnowledgeContent,
  normalizeKnowledgeLinkTarget,
  type MarkdownKnowledgeMetadata,
} from '../server/knowledge/markdown';

let cleanup = () => {};

describe('Markdown knowledge metadata', () => {
  it('extracts Obsidian-style properties, tags, wikilinks, and markdown links', () => {
    const source = `---
title: Project Lumi
aliases: [Lumi KB, Knowledge Base]
tags:
  - ai
  - workspace/notes
owner: team
---
# Project Lumi

Links to [[Source Note|source]] and [[Roadmap#Q3]].
See [Spec](docs/spec.md) and #rag.

\`#notatag [[Nope]]\`

\`\`\`
#code
[[Nope]]
\`\`\`
`;

    const enriched = enrichMarkdownKnowledgeContent(source, 'Project Lumi.md');

    expect(enriched.metadata).toMatchObject({
      title: 'Project Lumi',
      aliases: ['Lumi KB', 'Knowledge Base'],
      tags: ['ai', 'workspace/notes', 'rag'],
      wikiLinks: ['Source Note', 'Roadmap'],
      markdownLinks: ['docs/spec.md'],
    });
    expect(enriched.metadata.frontmatter.owner).toBe('team');
    expect(enriched.content).toContain('[Markdown Source]');
    expect(enriched.content).toContain('Tags: #ai, #workspace/notes, #rag');
    expect(enriched.metadata.wikiLinks).not.toContain('Nope');
    expect(enriched.metadata.tags).not.toContain('code');
  });

  it('normalizes link targets for backlink matching', () => {
    expect(normalizeKnowledgeLinkTarget('Folder/Source Note.md#Heading')).toBe('source note');
    expect(normalizeKnowledgeLinkTarget('[[Roadmap|display]]')).toBe('roadmap');
    expect(normalizeKnowledgeLinkTarget('https://example.com/Roadmap.md')).toBe('');
  });
});

describe('RAG markdown source metadata', () => {
  beforeAll(async () => {
    const app = await makeApp();
    cleanup = app.cleanup;
  });

  afterAll(() => {
    cleanup();
  });

  it('stores tags, aliases, and links as retrievable memory keywords', async () => {
    const { ingestDocument } = await import('../server/agents/rag');
    const { readDB } = await import('../db_layer');
    const sourceMetadata: MarkdownKnowledgeMetadata = {
      kind: 'markdown',
      title: 'Project Lumi',
      aliases: ['Lumi KB'],
      tags: ['rag', 'workspace/notes'],
      wikiLinks: ['Source Note'],
      markdownLinks: ['docs/spec.md'],
      links: ['Source Note', 'docs/spec.md'],
      frontmatter: { title: 'Project Lumi' },
    };

    const result = await ingestDocument(
      'user-md',
      'lumi',
      'Project Lumi.md',
      'Project Lumi keeps source metadata attached to every chunk.',
      {
        filePath: 'Project Lumi.md',
        sourceMetadata,
      },
    );

    const db = readDB();
    const stored = db.memories.find((memory: any) => memory.id === result.memoryIds[0]);
    expect(stored?.keywords).toEqual(expect.arrayContaining([
      'title:Project Lumi',
      'alias:Lumi KB',
      'tag:rag',
      'tag:workspace/notes',
      'wikilink:Source Note',
      'link:docs/spec.md',
    ]));
  });
});
