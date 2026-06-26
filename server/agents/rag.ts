import path from 'path';
import { addMemory } from '../memory/store';
import { Memory } from '../memory/types';

export interface ChunkOptions {
  maxChunkSize?: number;
  overlapSize?: number;
  agentId?: string;
}

export interface IngestDocumentOptions {
  chunkSize?: number;
  tier?: 'episodic' | 'internalized';
  filePath?: string;
  domain?: string;
  orgId?: string;
}

/**
 * Split text into overlapping chunks for memory ingestion.
 * Default chunk size ~500 chars with 50 char overlap.
 */
export function chunkText(
  text: string,
  options: ChunkOptions = {},
): string[] {
  const maxSize = options.maxChunkSize || 500;
  const overlap = options.overlapSize || 50;
  const chunks: string[] = [];

  let offset = 0;
  while (offset < text.length) {
    const chunk = text.slice(offset, offset + maxSize).trim();
    if (chunk) chunks.push(chunk);
    offset += maxSize - overlap;
  }

  return chunks;
}

/**
 * Ingest a document into an agent's private memory.
 * Each chunk becomes an internalized memory with source citation metadata.
 */
export async function ingestDocument(
  userId: string,
  agentId: string,
  documentTitle: string,
  content: string,
  options?: IngestDocumentOptions,
): Promise<{ chunkCount: number; memoryIds: string[] }> {
  const chunks = chunkText(content, {
    maxChunkSize: options?.chunkSize || 500,
    agentId,
  });

  const memoryIds: string[] = [];
  const sourceFile = options?.filePath || documentTitle;

  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    const mem = addMemory(
      {
        userId,
        type: 'knowledge',
        content: `[${documentTitle} #${i + 1}/${chunks.length}] ${chunk}`,
        keywords: [
          documentTitle,
          `source:${path.basename(sourceFile)}`,
          `chunk:${i + 1}/${chunks.length}`,
          'ingested',
          'document',
        ],
        confidence: 0.7,
        sourceInteractionId: sourceFile,
      },
      {
        tier: options?.tier || 'internalized',
        perspective: 'lumi_self',
        importance: 0.4,
        agentId,
        domain: options?.domain || 'personal',
        orgId: options?.orgId || '',
        source: 'import',
      },
    );
    memoryIds.push(mem.id);
  }

  console.log(`[RAG] Ingested "${documentTitle}" -> ${chunks.length} chunks for agent ${agentId}`);
  return { chunkCount: chunks.length, memoryIds };
}

/**
 * Retrieve relevant chunks for a query from agent-scoped knowledge.
 * Each result includes a citation string tracking source document and chunk position.
 */
import { queryMemories } from '../memory/store';

export function retrieveChunks(
  userId: string,
  agentId: string,
  query: string,
  limit = 5,
  scope: { domain?: string; orgId?: string } = {},
): Array<Memory & { citation: string }> {
  const memories = queryMemories({
    userId,
    agentId,
    type: 'knowledge',
    query,
    limit,
    minConfidence: 0.3,
    domain: scope.domain,
    orgId: scope.orgId,
  });

  return memories.map(m => {
    const source = m.sourceInteractionId
      ? path.basename(m.sourceInteractionId)
      : 'unknown';
    const chunkInfo = (m.keywords || []).find((k: string) => k.startsWith('chunk:')) || 'unknown';
    return {
      ...m,
      citation: `[Source: ${source}, ${chunkInfo}]`,
    };
  });
}
