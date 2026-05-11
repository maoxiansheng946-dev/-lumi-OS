import React, { useState, useCallback, useRef } from 'react';
import { motion } from 'motion/react';
import { File, BrainCircuit, Folder, Shield } from 'lucide-react';

export interface KnowledgeNodeData {
  id: string;
  type: 'file' | 'memory' | 'branch';
  title: string;
  subtitle?: string;
  hue: number;           // accent hue for glow color
  position: { x: number; y: number }; // 0-1 percentages
  size: 'large' | 'medium' | 'small';
  tier?: string;
  isCore?: boolean;
  isIndexed?: boolean;
  isBranch?: boolean;
}

interface KnowledgeNodeProps {
  node: KnowledgeNodeData;
  isHighlighted: boolean;
  isSelected: boolean;
  onClick: (id: string) => void;
  onDoubleClick: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  containerWidth: number;
  containerHeight: number;
}

const SIZE_MAP = { large: 56, medium: 44, small: 34 };

export function KnowledgeNode({
  node,
  isHighlighted,
  isSelected,
  onClick,
  onDoubleClick,
  onDragEnd,
  containerWidth,
  containerHeight,
}: KnowledgeNodeProps) {
  const [dragging, setDragging] = useState(false);
  const dragStart = useRef<{ mx: number; my: number; nx: number; ny: number } | null>(null);
  const nodeSize = SIZE_MAP[node.size];

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.stopPropagation();
    e.preventDefault();
    dragStart.current = {
      mx: e.clientX,
      my: e.clientY,
      nx: node.position.x,
      ny: node.position.y,
    };
    setDragging(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  }, [node.position]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    const dx = (e.clientX - dragStart.current.mx) / containerWidth;
    const dy = (e.clientY - dragStart.current.my) / containerHeight;
    const newX = Math.max(0.02, Math.min(0.98, dragStart.current.nx + dx));
    const newY = Math.max(0.02, Math.min(0.98, dragStart.current.ny + dy));
    // Visual feedback via style mutation during drag
    const el = e.currentTarget as HTMLElement;
    el.style.left = `${newX * 100}%`;
    el.style.top = `${newY * 100}%`;
  }, [dragging, containerWidth, containerHeight]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    if (!dragging || !dragStart.current) return;
    const dx = (e.clientX - dragStart.current.mx) / containerWidth;
    const dy = (e.clientY - dragStart.current.my) / containerHeight;
    const newX = Math.max(0.02, Math.min(0.98, dragStart.current.nx + dx));
    const newY = Math.max(0.02, Math.min(0.98, dragStart.current.ny + dy));
    setDragging(false);
    dragStart.current = null;
    (e.target as HTMLElement).releasePointerCapture(e.pointerId);
    if (Math.abs(dx) < 0.003 && Math.abs(dy) < 0.003) {
      // Was a click, not a drag
      onClick(node.id);
    } else {
      onDragEnd(node.id, newX, newY);
    }
  }, [dragging, containerWidth, containerHeight, node.id, onClick, onDragEnd]);

  const handleDoubleClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onDoubleClick(node.id);
  }, [node.id, onDoubleClick]);

  const isBranch = node.type === 'branch';
  const glowColor = `hsla(${node.hue}, 60%, 50%, 0.15)`;
  const glowColorStrong = `hsla(${node.hue}, 70%, 55%, 0.3)`;

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.5 }}
      animate={{
        opacity: 1,
        scale: isSelected || isHighlighted ? 1.08 : 1,
      }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      className="absolute -translate-x-1/2 -translate-y-1/2 cursor-pointer select-none z-10 group"
      style={{
        left: `${node.position.x * 100}%`,
        top: `${node.position.y * 100}%`,
        width: nodeSize,
        height: nodeSize,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={handleDoubleClick}
    >
      {/* Glow ring */}
      <div
        className="absolute inset-0 rounded-full transition-all duration-300"
        style={{
          boxShadow: isHighlighted || isSelected
            ? `0 0 ${nodeSize}px ${glowColorStrong}, 0 0 ${nodeSize * 2}px ${glowColorStrong}, inset 0 0 ${nodeSize / 2}px ${glowColor}`
            : `0 0 ${nodeSize * 0.3}px ${glowColor}`,
          opacity: isHighlighted || isSelected ? 1 : 0.4,
          transform: `scale(${isHighlighted || isSelected ? 1.5 : 1})`,
        }}
      />

      {/* Orb body */}
      <div
        className={`absolute inset-1 rounded-full flex items-center justify-center transition-all duration-300 ${
          isBranch
            ? 'bg-white/[0.08] border-2 border-dashed'
            : 'bg-white/[0.06] border'
        }`}
        style={{
          borderColor: isHighlighted || isSelected
            ? `hsla(${node.hue}, 60%, 50%, 0.6)`
            : `hsla(${node.hue}, 30%, 40%, 0.3)`,
          boxShadow: isHighlighted
            ? `inset 0 0 ${nodeSize / 2}px hsla(${node.hue}, 50%, 50%, 0.15)`
            : 'none',
        }}
      >
        {/* Icon */}
        {node.type === 'file' ? (
          <File size={nodeSize * 0.35} className="text-white/60" />
        ) : node.type === 'branch' ? (
          <Folder size={nodeSize * 0.35} className="text-white/60" />
        ) : node.isBranch ? (
          <Folder size={nodeSize * 0.35} className="text-white/60" />
        ) : (
          <BrainCircuit size={nodeSize * 0.35} className="text-white/60" />
        )}

        {/* Core identity shield */}
        {node.isCore && (
          <Shield size={nodeSize * 0.25} className="absolute -top-0.5 -right-0.5 text-amber-400" />
        )}
      </div>

      {/* Label */}
      <div
        className="absolute top-full left-1/2 -translate-x-1/2 mt-1.5 pointer-events-none transition-opacity duration-200"
        style={{ opacity: isHighlighted || isSelected ? 1 : 0.5 }}
      >
        <span
          className="block text-[9px] font-bold text-white/80 text-center whitespace-nowrap max-w-[120px] truncate px-2 py-0.5 rounded-full"
          style={{
            background: isHighlighted ? `hsla(${node.hue}, 30%, 20%, 0.6)` : 'transparent',
          }}
        >
          {node.title}
        </span>
        {node.subtitle && (
          <span className="block text-[7px] text-white/30 text-center mt-0.5 font-mono uppercase tracking-wider">
            {node.subtitle}
          </span>
        )}
      </div>
    </motion.div>
  );
}
