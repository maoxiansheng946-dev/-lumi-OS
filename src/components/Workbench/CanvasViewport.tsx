import React, { useEffect, useMemo, useRef, useState } from 'react';
import { GitBranch, Trash2, X } from 'lucide-react';
import { useCanvasPanZoom } from './useCanvasPanZoom';
import { computeLayout, computeEdges } from './canvasLayout';
import { CanvasCard as CanvasCardComponent } from './CanvasCard';
import { CanvasCard, CanvasEdge, PositionedCard } from './types';

interface CanvasViewportProps {
  cards: CanvasCard[];
  edges: CanvasEdge[];
  onRetry?: (cardId: string) => void;
  onClear?: () => void;
  selectedEdgeId?: string | null;
  onEdgeSelect?: (edge: CanvasEdge | null) => void;
  onEdgeModify?: (edge: CanvasEdge, instruction: string) => void;
}

function getCardLabel(card?: PositionedCard | null): string {
  if (!card) return 'Unknown step';
  const label = card.metadata?.toolName || card.metadata?.agentName || card.text || card.id;
  return label.length > 72 ? `${label.slice(0, 72)}...` : label;
}

function EdgeLine({
  edge,
  cards,
  selected,
  onSelect,
}: {
  edge: CanvasEdge;
  cards: PositionedCard[];
  selected?: boolean;
  onSelect?: (edge: CanvasEdge) => void;
}) {
  const src = cards.find(c => c.id === edge.sourceId);
  const tgt = cards.find(c => c.id === edge.targetId);
  if (!src || !tgt) return null;

  const x1 = src.x + src.width;
  const y1 = src.y + src.height / 2;
  const x2 = tgt.x;
  const y2 = tgt.y + tgt.height / 2;
  const direction = x2 >= x1 ? 1 : -1;
  const curve = Math.max(80, Math.abs(x2 - x1) * 0.42);
  const color = selected
    ? 'rgba(45,212,191,0.95)'
    : edge.color || (edge.dashed ? 'rgba(255,255,255,0.18)' : 'rgba(255,255,255,0.28)');
  const d = `M ${x1} ${y1} C ${x1 + curve * direction} ${y1}, ${x2 - curve * direction} ${y2}, ${x2} ${y2}`;
  const arrowPoints = `${x2 - direction * 10},${y2 - 5} ${x2},${y2} ${x2 - direction * 10},${y2 + 5}`;

  return (
    <g data-no-pan>
      <path
        d={d}
        fill="none"
        stroke="transparent"
        strokeWidth={24}
        strokeLinecap="round"
        style={{ cursor: onSelect ? 'pointer' : 'default', pointerEvents: 'stroke' }}
        onClick={(e) => {
          e.stopPropagation();
          onSelect?.(edge);
        }}
      />
      <path
        d={d}
        fill="none"
        stroke={color}
        strokeWidth={selected ? 3 : 1.8}
        strokeDasharray={edge.dashed ? '5,5' : undefined}
        strokeLinecap="round"
        style={{ pointerEvents: 'none' }}
      />
      <polygon points={arrowPoints} fill={color} style={{ pointerEvents: 'none' }} />
      {edge.label && (
        <text
          x={(x1 + x2) / 2}
          y={(y1 + y2) / 2 - 10}
          fill={selected ? 'rgba(153,246,228,0.95)' : 'rgba(255,255,255,0.38)'}
          fontSize={11}
          textAnchor="middle"
          style={{ pointerEvents: 'none' }}
        >
          {edge.label}
        </text>
      )}
    </g>
  );
}

export function CanvasViewport({
  cards,
  edges,
  onRetry,
  onClear,
  selectedEdgeId,
  onEdgeSelect,
  onEdgeModify,
}: CanvasViewportProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [edgeInstruction, setEdgeInstruction] = useState('');
  const { scale, viewportStyle, resetView, focusOnRect, wasRecentlyManual } = useCanvasPanZoom(containerRef);
  const lastAutoFocusedSignature = useRef<string | null>(null);

  const positioned = useMemo(() => {
    const viewportWidth = containerRef.current?.clientWidth || 1200;
    return computeLayout(cards, viewportWidth / scale);
  }, [cards, scale]);

  const visibleEdges = useMemo(() => {
    const cardIds = new Set(positioned.map(c => c.id));
    return computeEdges(cards, edges).filter(e => cardIds.has(e.sourceId) && cardIds.has(e.targetId));
  }, [cards, edges, positioned]);

  const selectedEdge = useMemo(
    () => visibleEdges.find(edge => edge.id === selectedEdgeId) || null,
    [selectedEdgeId, visibleEdges],
  );
  const selectedSource = selectedEdge ? positioned.find(card => card.id === selectedEdge.sourceId) : null;
  const selectedTarget = selectedEdge ? positioned.find(card => card.id === selectedEdge.targetId) : null;
  const latestCard = useMemo(() => {
    if (positioned.length === 0) return null;
    const sorted = [...positioned].sort((a, b) => a.timestamp - b.timestamp);
    return [...sorted].reverse().find(card => card.status === 'running') || sorted[sorted.length - 1];
  }, [positioned]);

  useEffect(() => {
    setEdgeInstruction('');
  }, [selectedEdgeId]);

  useEffect(() => {
    if (!latestCard) {
      lastAutoFocusedSignature.current = null;
      return;
    }

    const signature = `${latestCard.id}:${latestCard.status || 'none'}:${cards.length}`;
    if (lastAutoFocusedSignature.current === signature) return;

    let timer: ReturnType<typeof setTimeout> | null = null;
    const focusLatest = () => {
      if (wasRecentlyManual(1800) && lastAutoFocusedSignature.current !== null) {
        timer = setTimeout(focusLatest, 450);
        return;
      }

      focusOnRect(latestCard, {
        anchorX: 0.42,
        anchorY: 0.5,
        scale,
      });
      lastAutoFocusedSignature.current = signature;
    };

    timer = setTimeout(focusLatest, 80);
    return () => {
      if (timer) clearTimeout(timer);
    };
  }, [cards.length, focusOnRect, latestCard, scale, wasRecentlyManual]);

  const svgWidth = 8000;
  const svgHeight = 8000;

  return (
    <div ref={containerRef} className="absolute inset-0 overflow-hidden" style={{ cursor: 'grab' }}>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" style={{ opacity: 0.2 }}>
        <defs>
          <pattern id="canvas-dots" x="0" y="0" width={40 * scale} height={40 * scale} patternUnits="userSpaceOnUse">
            <circle cx={20 * scale} cy={20 * scale} r={1.5 * scale} fill="rgba(255,255,255,0.4)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill="url(#canvas-dots)" />
      </svg>

      <div data-no-pan className="absolute bottom-24 right-6 z-40 flex items-center gap-1 rounded-xl border border-white/[0.08] bg-black/60 p-1 backdrop-blur-xl">
        <button
          onClick={() => containerRef.current?.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true }))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          -
        </button>
        <span className="min-w-[40px] text-center text-xs tabular-nums text-white/50">
          {Math.round(scale * 100)}%
        </span>
        <button
          onClick={() => containerRef.current?.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true }))}
          className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-white/60 transition-colors hover:bg-white/10 hover:text-white"
        >
          +
        </button>
        <div className="mx-0.5 h-5 w-px bg-white/[0.08]" />
        <button onClick={resetView} className="h-8 rounded-lg px-2 text-[10px] text-white/50 transition-colors hover:bg-white/10 hover:text-white">
          Reset
        </button>
        {onClear && cards.length > 0 && (
          <>
            <div className="mx-0.5 h-5 w-px bg-white/[0.08]" />
            <button
              onClick={onClear}
              title="Clear canvas"
              className="flex h-8 w-8 items-center justify-center rounded-lg text-sm text-red-400/60 transition-colors hover:bg-red-500/10 hover:text-red-400"
            >
              <Trash2 size={14} />
            </button>
          </>
        )}
      </div>

      {selectedEdge && (
        <div
          data-no-pan
          className="absolute right-6 top-16 z-50 w-[360px] rounded-xl border border-teal-300/20 bg-black/75 p-4 text-white shadow-2xl backdrop-blur-xl"
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-teal-400/10 text-teal-200">
                <GitBranch size={16} />
              </span>
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-teal-100/80">Path Edit</div>
                <div className="text-[11px] text-white/35">Modify this step without leaving the canvas</div>
              </div>
            </div>
            <button
              onClick={() => onEdgeSelect?.(null)}
              className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-white/45 hover:bg-white/10 hover:text-white"
              aria-label="Close path editor"
            >
              <X size={14} />
            </button>
          </div>
          <div className="space-y-2 rounded-lg border border-white/[0.06] bg-white/[0.03] p-3">
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/30">From</div>
              <div className="truncate text-xs text-white/70">{getCardLabel(selectedSource)}</div>
            </div>
            <div>
              <div className="text-[10px] uppercase tracking-wide text-white/30">To</div>
              <div className="truncate text-xs text-white/70">{getCardLabel(selectedTarget)}</div>
            </div>
          </div>
          <textarea
            value={edgeInstruction}
            onChange={(e) => setEdgeInstruction(e.target.value)}
            placeholder="Tell Lumi what to change in this step..."
            className="mt-3 h-24 w-full resize-none rounded-lg border border-white/[0.08] bg-white/[0.04] px-3 py-2 text-sm text-white outline-none placeholder:text-white/25 focus:border-teal-300/35"
          />
          <button
            onClick={() => {
              const instruction = edgeInstruction.trim();
              if (!instruction || !selectedEdge) return;
              onEdgeModify?.(selectedEdge, instruction);
              setEdgeInstruction('');
            }}
            disabled={!edgeInstruction.trim()}
            className="mt-3 h-9 w-full rounded-lg bg-teal-300 text-sm font-semibold text-slate-950 transition hover:bg-teal-200 disabled:cursor-not-allowed disabled:bg-white/10 disabled:text-white/30"
          >
            Apply to this path
          </button>
        </div>
      )}

      <div
        className="absolute"
        style={{
          ...viewportStyle,
          width: `${svgWidth}px`,
          height: `${svgHeight}px`,
          pointerEvents: 'auto',
        }}
      >
        <svg
          className="absolute inset-0"
          width={svgWidth}
          height={svgHeight}
          style={{ overflow: 'visible' }}
        >
          {visibleEdges.map(edge => (
            <EdgeLine
              key={edge.id}
              edge={edge}
              cards={positioned}
              selected={edge.id === selectedEdgeId}
              onSelect={onEdgeSelect || undefined}
            />
          ))}
        </svg>

        {positioned.map(card => (
          <div key={card.id} data-canvas-card style={{ pointerEvents: 'auto' }}>
            <CanvasCardComponent
              card={card}
              onRetry={card.status === 'error' || card.type === 'tool_call' ? onRetry : undefined}
            />
          </div>
        ))}

        {cards.length === 0 && (
          <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-center">
            <div className="mb-4 text-5xl opacity-20">+</div>
            <p className="text-sm text-white/30">Tell me what to do. I will build the path here.</p>
            <p className="mt-2 text-xs text-white/15">Drag to pan / Scroll to zoom / Click a path line to edit a step</p>
          </div>
        )}
      </div>
    </div>
  );
}
