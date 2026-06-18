// Auto-layout algorithm for infinite canvas cards
import { CanvasCard, CanvasEdge, PositionedCard } from './types';

const START_Y = 92;
const NODE_GAP_X = 92;
const LANE_GAP_Y = 128;
const MIN_HEIGHT = 92;
const MAX_HEIGHT = 380;

function getCardWidth(card: CanvasCard): number {
  switch (card.type) {
    case 'user_request':
      return 300;
    case 'stage_header':
      return 230;
    case 'tool_call':
      return 300;
    case 'reasoning_text':
      return 360;
    case 'final_output':
      return 440;
    case 'source_citation':
      return 300;
    case 'artifact':
      return 420;
    case 'error':
      return 340;
    default:
      return 320;
  }
}

function getHeightText(card: CanvasCard): string {
  const parts = [card.text, card.detail];
  if (card.type === 'tool_call') {
    parts.push(card.metadata?.result, card.metadata?.error);
  }
  if (card.type === 'artifact') {
    parts.push(card.metadata?.filepath, card.metadata?.preview, card.metadata?.companionPreviewPath);
  }
  return parts.filter(Boolean).join(' ');
}

function estimateHeight(card: CanvasCard, width: number): number {
  const charsPerLine = Math.max(20, Math.floor(width / 7));
  const lines = Math.ceil(getHeightText(card).length / charsPerLine);
  const base = card.type === 'stage_header'
    ? 84
    : card.type === 'tool_call'
      ? 116
      : card.type === 'artifact'
        ? card.metadata?.svgPreview ? 300 : 132
        : 104;
  return Math.min(MAX_HEIGHT, Math.max(MIN_HEIGHT, base + lines * 18));
}

export function computeLayout(cards: CanvasCard[], viewportWidth: number): PositionedCard[] {
  if (cards.length === 0) return [];

  // Group by groupId, preserving order by min timestamp in group
  const groups = new Map<string, CanvasCard[]>();
  for (const card of cards) {
    const list = groups.get(card.groupId) || [];
    list.push(card);
    groups.set(card.groupId, list);
  }

  const groupEntries = Array.from(groups.entries()).sort((a, b) => {
    const aMin = Math.min(...a[1].map(c => c.timestamp));
    const bMin = Math.min(...b[1].map(c => c.timestamp));
    return aMin - bMin;
  });

  const laneStartX = Math.max(72, Math.min(140, viewportWidth * 0.06));
  let currentY = START_Y;
  const result: PositionedCard[] = [];

  for (const [, groupCards] of groupEntries) {
    const sorted = [...groupCards].sort((a, b) => a.timestamp - b.timestamp);
    let currentX = laneStartX;
    let laneHeight = 0;

    for (const card of sorted) {
      const width = getCardWidth(card);
      const height = estimateHeight(card, width);
      result.push({ ...card, x: currentX, y: currentY, width, height });
      currentX += width + NODE_GAP_X;
      laneHeight = Math.max(laneHeight, height);
    }

    currentY += laneHeight + LANE_GAP_Y;
  }

  return result;
}

/** Derive edges from card ordering + explicit parentId references */
export function computeEdges(_cards: CanvasCard[], existingEdges: CanvasEdge[]): CanvasEdge[] {
  // Group cards by groupId
  const groups = new Map<string, CanvasCard[]>();
  for (const c of _cards) {
    const list = groups.get(c.groupId) || [];
    list.push(c);
    groups.set(c.groupId, list);
  }

  const edges: CanvasEdge[] = [];

  for (const [groupId, groupCards] of groups) {
    // Sort by timestamp
    const sorted = [...groupCards].sort((a, b) => a.timestamp - b.timestamp);

    // Create a flag to mark which connections are from explicit parentId
    const connected = new Set<string>();
    for (const card of sorted) {
      if (card.parentId && sorted.some(c => c.id === card.parentId)) {
        edges.push({
          id: `edge_${card.parentId}_${card.id}`,
          sourceId: card.parentId,
          targetId: card.id,
          dashed: true,
          color: 'rgba(139,92,246,0.35)',
        });
        connected.add(card.id);
      }
    }

    // Chain remaining cards in order
    for (let i = 1; i < sorted.length; i++) {
      if (!connected.has(sorted[i].id)) {
        edges.push({
          id: `edge_${sorted[i - 1].id}_${sorted[i].id}`,
          sourceId: sorted[i - 1].id,
          targetId: sorted[i].id,
        });
      }
    }
  }

  // Merge with externally created edges, deduplicating by source+target
  const edgeKeys = new Set<string>();
  for (const e of edges) edgeKeys.add(`${e.sourceId}_${e.targetId}`);
  for (const e of existingEdges) {
    const key = `${e.sourceId}_${e.targetId}`;
    if (!edgeKeys.has(key)) {
      edges.push(e);
      edgeKeys.add(key);
    }
  }

  return edges;
}
