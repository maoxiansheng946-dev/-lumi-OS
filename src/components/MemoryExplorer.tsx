import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Search, Plus, Trash2, Edit3, Check, X, SlidersHorizontal, Bell, Clock, BellOff, TrendingUp, Shield, ShieldOff, Sparkles, GitMerge, Layers, ChevronRight, Network, ListTree } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import { useSocket } from '@/hooks/useSocket';

interface Memory {
  id: string;
  userId: string;
  type: 'preference' | 'fact' | 'habit' | 'knowledge';
  content: string;
  keywords: string[];
  confidence: number;
  sourceInteractionId: string;
  createdAt: string;
  updatedAt: string;
  lastRetrievedAt: string | null;
  retrieveCount: number;
  tier: 'episodic' | 'internalized' | 'growth' | 'core_identity';
  perspective: 'owner_trait' | 'lumi_self' | 'shared_memory' | 'lumi_growth';
  importance: number;
  parentId: string | null;
  nodeType: 'branch' | 'leaf';
}

interface MemoryTree {
  node: Memory;
  children: MemoryTree[];
}

const TIER_LABELS: Record<string, { label: string; color: string; bg: string; border: string; desc: string }> = {
  core_identity: { label: 'Core', color: 'text-amber-300', bg: 'bg-amber-500/10', border: 'border-amber-500/30', desc: 'Who I am' },
  growth: { label: 'Growth', color: 'text-emerald-300', bg: 'bg-emerald-500/10', border: 'border-emerald-500/30', desc: 'How I evolve' },
  internalized: { label: 'Internalized', color: 'text-sky-300', bg: 'bg-sky-500/10', border: 'border-sky-500/30', desc: 'What I absorbed' },
  episodic: { label: 'Episodic', color: 'text-slate-400', bg: 'bg-slate-500/10', border: 'border-slate-500/30', desc: 'Raw experiences' },
};

const PERSPECTIVE_LABELS: Record<string, { label: string; color: string }> = {
  lumi_self: { label: 'Self', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  lumi_growth: { label: 'Growth', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  shared_memory: { label: 'Shared', color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  owner_trait: { label: 'Owner', color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
};

const TYPE_COLORS: Record<string, { dot: string; text: string }> = {
  preference: { dot: 'bg-purple-400', text: 'text-purple-400' },
  fact: { dot: 'bg-blue-400', text: 'text-blue-400' },
  habit: { dot: 'bg-green-400', text: 'text-green-400' },
  knowledge: { dot: 'bg-orange-400', text: 'text-orange-400' },
};

const BRANCH_PALETTE = [
  'border-l-rose-400', 'border-l-amber-400', 'border-l-emerald-400',
  'border-l-sky-400', 'border-l-violet-400', 'border-l-pink-400',
  'border-l-cyan-400', 'border-l-orange-400', 'border-l-teal-400',
];

const TIER_ORDER: string[] = ['core_identity', 'growth', 'internalized', 'episodic'];
const DRAG_TYPE = 'memory-node';

// ── TreeNode ──

function TreeNode({
  tree,
  depth,
  branchIndex,
  expandedIds,
  setExpandedIds,
  selectedIds,
  toggleSelect,
  editingId,
  editContent,
  setEditContent,
  handleEditStart,
  handleEditSave,
  handleEditCancel,
  handleDelete,
  handleChangeTier,
  handleToggleProtect,
  handleMove,
  filterText,
  batchMode,
  allBranches,
}: {
  tree: MemoryTree;
  depth: number;
  branchIndex: number;
  expandedIds: Set<string>;
  setExpandedIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  selectedIds: Set<string>;
  toggleSelect: (id: string) => void;
  editingId: string | null;
  editContent: string;
  setEditContent: (v: string) => void;
  handleEditStart: (m: Memory) => void;
  handleEditSave: (id: string) => void;
  handleEditCancel: () => void;
  handleDelete: (id: string) => void;
  handleChangeTier: (id: string, tier: string, confirmed?: boolean) => void;
  handleToggleProtect: (id: string) => void;
  handleMove: (id: string, newParentId: string | null) => void;
  filterText: string;
  batchMode: boolean;
  allBranches: Set<string>;
}) {
  const { node, children } = tree;
  const isBranch = node.nodeType === 'branch';
  const isExpanded = expandedIds.has(node.id);
  const isCore = node.tier === 'core_identity';
  const isSelected = selectedIds.has(node.id);
  const tierInfo = TIER_LABELS[node.tier] || TIER_LABELS.episodic;
  const perspectiveInfo = PERSPECTIVE_LABELS[node.perspective] || PERSPECTIVE_LABELS.owner_trait;
  const typeColor = TYPE_COLORS[node.type] || TYPE_COLORS.fact;
  const isLastChild = false; // determined at parent level

  const toggleExpand = () => {
    setExpandedIds(prev => {
      const next = new Set(prev);
      if (next.has(node.id)) next.delete(node.id);
      else next.add(node.id);
      return next;
    });
  };

  const handleDragStart = (e: React.DragEvent) => {
    if (isBranch) return;
    e.dataTransfer.setData(DRAG_TYPE, node.id);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent) => {
    if (!isBranch && node.nodeType !== 'branch') return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isBranch) return;
    const draggedId = e.dataTransfer.getData(DRAG_TYPE);
    if (draggedId && draggedId !== node.id) {
      handleMove(draggedId, node.id);
      setExpandedIds(prev => new Set(prev).add(node.id));
    }
  };

  const accentColor = BRANCH_PALETTE[depth % BRANCH_PALETTE.length];

  // Filter visibility
  if (filterText) {
    const textMatch = node.content.toLowerCase().includes(filterText.toLowerCase())
      || node.keywords?.some(k => k.toLowerCase().includes(filterText.toLowerCase()));
    const childMatch = children.some(c => {
      const walk = (t: MemoryTree): boolean =>
        t.node.content.toLowerCase().includes(filterText.toLowerCase())
        || t.node.keywords?.some(k => k.toLowerCase().includes(filterText.toLowerCase()))
        || t.children.some(walk);
      return walk(c);
    });
    if (!textMatch && !childMatch) return null;
  }

  return (
    <div>
      {/* Node row */}
      <div
        draggable={!isBranch}
        onDragStart={!isBranch ? handleDragStart : undefined}
        className="relative"
        style={{ paddingLeft: depth * 24 + 8 }}
      >
      <motion.div
        layout
        initial={{ opacity: 0, x: -8 }}
        animate={{ opacity: 1, x: 0 }}
        transition={{ duration: 0.2 }}
        className={`flex items-center gap-1.5 py-2 px-2 rounded-xl transition-all group cursor-pointer
          ${isSelected ? 'bg-celestial-saturn/10 ring-1 ring-celestial-saturn/20' : ''}
          ${!isBranch && !isSelected ? 'hover:bg-white/[0.03]' : ''}
        `}
      >
        {/* Tree connector lines */}
        {depth > 0 && (
          <div className="absolute inset-0 pointer-events-none">
            {Array.from({ length: depth }).map((_, i) => {
              const lineX = i * 24 + 20;
              const isLastLine = i === depth - 1;
              return (
                <div
                  key={i}
                  className="absolute top-0 bottom-0"
                  style={{ left: lineX }}
                >
                  <div className="absolute top-1/2 left-0 w-3 border-t border-white/[0.08]" />
                  {!isLastLine && <div className="absolute top-0 left-0 w-px h-full border-l border-white/[0.06]" />}
                  {isLastLine && <div className="absolute top-0 left-0 w-px h-1/2 border-l border-white/[0.06]" />}
                </div>
              );
            })}
          </div>
        )}

        {/* Expand button */}
        {isBranch ? (
          <motion.div
            animate={{ rotate: isExpanded ? 90 : 0 }}
            transition={{ duration: 0.15 }}
          >
            <button onClick={toggleExpand} className="p-0.5 hover:bg-white/10 rounded text-white/30 hover:text-white/60 shrink-0 z-10">
              <ChevronRight size={13} />
            </button>
          </motion.div>
        ) : batchMode ? (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={() => toggleSelect(node.id)}
            onClick={e => e.stopPropagation()}
            className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 accent-celestial-saturn cursor-pointer shrink-0 z-10 ml-0.5"
          />
        ) : (
          <div className="w-[22px] shrink-0" />
        )}

        {/* Branch card */}
        {isBranch ? (
          <div
            className={`flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl border-l-[3px] bg-white/[0.03] border-white/[0.06] ${accentColor} hover:bg-white/[0.06] transition-colors min-w-0 z-10`}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
          >
            <span className="text-sm font-semibold text-white/85 truncate">{node.content}</span>
            <span className="text-[10px] font-mono text-white/20 shrink-0 ml-auto">{children.length}</span>
          </div>
        ) : (
          <div className="flex-1 min-w-0 z-10" onClick={() => batchMode && toggleSelect(node.id)}>
            {editingId === node.id ? (
              <div className="flex items-center gap-2">
                <Input
                  value={editContent}
                  onChange={e => setEditContent(e.target.value)}
                  className="flex-1 bg-white/10 border-white/20 rounded-lg py-1 text-sm"
                  onKeyDown={e => e.key === 'Enter' && handleEditSave(node.id)}
                  autoFocus
                />
                <Button onClick={() => handleEditSave(node.id)} className="p-1.5 h-auto bg-celestial-saturn text-black rounded-lg"><Check size={12} /></Button>
                <Button onClick={handleEditCancel} className="p-1.5 h-auto text-white/40 hover:text-white rounded-lg" variant="ghost"><X size={12} /></Button>
              </div>
            ) : (
              <>
                <p className="text-sm text-white/70 leading-relaxed">{node.content}</p>
                <div className="flex items-center gap-2 mt-1">
                  {/* Type dot */}
                  <span className={`inline-block w-1.5 h-1.5 rounded-full ${typeColor.dot}`} title={node.type} />
                  {/* Tier badge */}
                  <span className={`text-[9px] font-bold uppercase ${tierInfo.color}`}>{tierInfo.label}</span>
                  {/* Perspective */}
                  <span className={`text-[8px] font-bold uppercase px-1 py-px rounded-full border ${perspectiveInfo.color}`}>{perspectiveInfo.label}</span>
                  {/* Confidence bar */}
                  <span className="flex items-center gap-1 text-[9px] text-white/25">
                    <span className="inline-block w-8 h-1 bg-white/[0.08] rounded-full overflow-hidden">
                      <span className="block h-full bg-white/30 rounded-full" style={{ width: `${node.confidence * 100}%` }} />
                    </span>
                    {(node.confidence * 100).toFixed(0)}%
                  </span>
                  {isCore && <Shield size={10} className="text-amber-400" />}
                </div>
              </>
            )}
          </div>
        )}

        {/* Actions (hover visible) */}
        <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0 z-10">
          {!isBranch && (
            <>
              <button onClick={() => handleToggleProtect(node.id)} className={`p-1.5 rounded-lg transition-colors ${isCore ? 'bg-amber-500/10 text-amber-400' : 'text-white/20 hover:text-white/50 hover:bg-white/5'}`} title={isCore ? 'Unprotect' : 'Protect'}>
                {isCore ? <Shield size={12} /> : <ShieldOff size={12} />}
              </button>
              <select
                value={node.tier || 'episodic'}
                onChange={e => handleChangeTier(node.id, e.target.value)}
                className="bg-white/5 border border-white/10 rounded-lg px-1.5 py-0.5 text-[9px] font-bold uppercase appearance-none cursor-pointer text-white/40 hover:text-white/70"
              >
                {TIER_ORDER.map(t => (<option key={t} value={t}>{TIER_LABELS[t].label}</option>))}
              </select>
            </>
          )}
          <button onClick={() => handleEditStart(node)} className="p-1.5 hover:bg-white/10 rounded-lg text-white/30 hover:text-white/70 transition-colors"><Edit3 size={12} /></button>
          <button onClick={() => handleDelete(node.id)} className="p-1.5 hover:bg-red-500/10 rounded-lg text-white/30 hover:text-red-400 transition-colors"><Trash2 size={12} /></button>
        </div>
      </motion.div>
      </div>

      {/* Children with AnimatePresence */}
      <AnimatePresence>
        {isBranch && isExpanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2, ease: 'easeInOut' }}
            style={{ overflow: 'hidden' }}
          >
            <div
              onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
              onDrop={(e) => {
                e.preventDefault();
                e.stopPropagation();
                const draggedId = e.dataTransfer.getData(DRAG_TYPE);
                if (draggedId) handleMove(draggedId, node.id);
                setExpandedIds(prev => new Set(prev).add(node.id));
              }}
            >
            {children.length === 0 ? (
              <div className="py-3 text-center" style={{ paddingLeft: (depth + 1) * 24 + 8 }}>
                <span className="text-[10px] text-white/[0.08] italic">Drop memories here</span>
              </div>
            ) : (
              children.map((child, i) => (
                <TreeNode
                  key={child.node.id}
                  tree={child}
                  depth={depth + 1}
                  branchIndex={i}
                  expandedIds={expandedIds}
                  setExpandedIds={setExpandedIds}
                  selectedIds={selectedIds}
                  toggleSelect={toggleSelect}
                  editingId={editingId}
                  editContent={editContent}
                  setEditContent={setEditContent}
                  handleEditStart={handleEditStart}
                  handleEditSave={handleEditSave}
                  handleEditCancel={handleEditCancel}
                  handleDelete={handleDelete}
                  handleChangeTier={handleChangeTier}
                  handleToggleProtect={handleToggleProtect}
                  handleMove={handleMove}
                  filterText={filterText}
                  batchMode={batchMode}
                  allBranches={allBranches}
                />
              ))
            )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

// ── Main component ──

export function MemoryExplorer({ t }: { t?: any }) {
  const socket = useSocket();
  const [tree, setTree] = useState<MemoryTree[]>([]);
  const [flatMemories, setFlatMemories] = useState<Memory[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [activeTier, setActiveTier] = useState<string>('');
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState<string>('preference');
  const [newContent, setNewContent] = useState('');
  const [consolidating, setConsolidating] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [organizing, setOrganizing] = useState(false);
  const [growthTimeline, setGrowthTimeline] = useState<Memory[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [perspectiveFilter, setPerspectiveFilter] = useState<string>('');
  const [expandedIds, setExpandedIds] = useState<Set<string>>(new Set());
  const [showReminders, setShowReminders] = useState(false);
  const [batchMode, setBatchMode] = useState(false);
  const [allBranches] = useState<Set<string>>(new Set());

  const fetchTree = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (typeFilter) params.set('type', typeFilter);
      const res = await fetch(`/api/memory/tree?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setTree(data.tree || []);
      const flat: Memory[] = [];
      const walk = (nodes: MemoryTree[]) => { for (const n of nodes) { flat.push(n.node); walk(n.children); } };
      walk(data.tree || []);
      setFlatMemories(flat);
      if (search) {
        const ids = new Set<string>();
        const find = (nodes: MemoryTree[]): boolean => {
          for (const n of nodes) {
            const match = n.node.content.toLowerCase().includes(search.toLowerCase())
              || n.node.keywords?.some(k => k.toLowerCase().includes(search.toLowerCase()));
            if (match || find(n.children)) { ids.add(n.node.id); return true; }
          }
          return false;
        };
        find(data.tree || []);
        setExpandedIds(ids);
      }
    } catch {
      setTree([]);
      setFlatMemories([]);
    } finally {
      setLoading(false);
    }
  }, [search, typeFilter]);

  const fetchGrowthTimeline = useCallback(async () => {
    try {
      const res = await fetch('/api/memory/growth');
      if (!res.ok) return;
      const data = await res.json();
      setGrowthTimeline(data.growth || []);
    } catch {}
  }, []);

  useEffect(() => { fetchTree(); }, [fetchTree]);
  useEffect(() => { fetchGrowthTimeline(); }, [fetchGrowthTimeline]);

  useEffect(() => {
    if (!socket) return;
    const handler = () => { fetchTree(); fetchGrowthTimeline(); };
    socket.on('memories:changed', handler);
    return () => { socket.off('memories:changed', handler); };
  }, [socket, fetchTree, fetchGrowthTimeline]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      fetchTree();
      fetchGrowthTimeline();
      toast.success('Memory deleted');
      setSelectedIds(prev => { const next = new Set(prev); next.delete(id); return next; });
    } catch (err: any) { toast.error(err.message); }
  };

  const handleEditStart = (memory: Memory) => {
    setEditingId(memory.id);
    setEditContent(memory.content);
  };

  const handleEditSave = async (id: string) => {
    try {
      const res = await fetch(`/api/memories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: editContent }),
      });
      if (!res.ok) throw new Error('Update failed');
      setEditingId(null);
      fetchTree();
      toast.success('Updated');
    } catch (err: any) { toast.error(err.message); }
  };

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: newType, content: newContent, keywords: newContent.toLowerCase().split(/\s+/).filter(w => w.length > 2) }),
      });
      if (!res.ok) throw new Error('Add failed');
      setAdding(false);
      setNewContent('');
      fetchTree();
      toast.success('Memory added');
    } catch (err: any) { toast.error(err.message); }
  };

  const handleChangeTier = async (id: string, newTier: string, confirmed = false) => {
    try {
      const res = await fetch(`/api/memory/${id}/tier`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier: newTier, confirmed }),
      });
      if (!res.ok) {
        const data = await res.json();
        if (data.error?.includes('confirmed')) {
          if (window.confirm('Promote to Core Identity? It will never decay.')) {
            return handleChangeTier(id, newTier, true);
          }
          return;
        }
        throw new Error(data.error || 'Tier change failed');
      }
      fetchTree();
      fetchGrowthTimeline();
      toast.success(`Tier → ${TIER_LABELS[newTier]?.label || newTier}`);
    } catch (err: any) { toast.error(err.message); }
  };

  const handleToggleProtect = async (id: string) => {
    try {
      const res = await fetch(`/api/memory/${id}/protect`, { method: 'PUT' });
      if (!res.ok) throw new Error('Toggle protection failed');
      const data = await res.json();
      fetchTree();
      fetchGrowthTimeline();
      toast.success(data.protected ? 'Protected from decay' : 'Protection removed');
    } catch (err: any) { toast.error(err.message); }
  };

  const handleMove = async (id: string, newParentId: string | null) => {
    try {
      const res = await fetch(`/api/memory/${id}/move`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parentId: newParentId }),
      });
      if (!res.ok) throw new Error('Move failed');
      fetchTree();
      toast.success('Moved');
    } catch (err: any) { toast.error(err.message); }
  };

  const handleAutoOrganize = async () => {
    setOrganizing(true);
    try {
      const res = await fetch('/api/memory/auto-organize', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(`Created ${data.branchesCreated} branches, organized ${data.memoriesAssigned} memories`);
        fetchTree().then(() => {
          fetch('/api/memory/tree').then(r => r.json()).then(d => {
            const ids = new Set<string>();
            const walk = (nodes: MemoryTree[]) => { for (const n of nodes) { if (n.node.nodeType === 'branch') ids.add(n.node.id); walk(n.children); } };
            walk(d.tree || []);
            setExpandedIds(ids);
          }).catch(() => {});
        });
      } else {
        toast.info(data.reason || `Need 3+ unorganized memories (have ${data.count || 0})`);
      }
    } catch (err: any) { toast.error(err.message); }
    finally { setOrganizing(false); }
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    try {
      const res = await fetch('/api/memory/consolidate', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success('Consolidated into growth narrative');
        fetchTree();
        fetchGrowthTimeline();
      } else {
        toast.info(`Need ${data.threshold || 10} episodic memories (have ${data.unconsolidatedCount || 0})`);
      }
    } catch (err: any) { toast.error(err.message); }
    finally { setConsolidating(false); }
  };

  const handleSelfReflect = async () => {
    setReflecting(true);
    try {
      const res = await fetch('/api/memory/self-reflect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success("I've reflected on our time together.");
        fetchTree();
        fetchGrowthTimeline();
      } else { toast.info(data.reason || 'No growth memories to reflect on yet'); }
    } catch (err: any) { toast.error(err.message); }
    finally { setReflecting(false); }
  };

  const toggleSelect = (id: string) => {
    setSelectedIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  };

  const batchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected memories?`)) return;
    let count = 0;
    for (const id of selectedIds) {
      try { const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' }); if (res.ok) count++; } catch {}
    }
    setSelectedIds(new Set());
    setBatchMode(false);
    fetchTree();
    toast.success(`Deleted ${count} memories`);
  };

  const batchPromote = async (tier: string) => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Move ${selectedIds.size} memories to ${TIER_LABELS[tier]?.label || tier}?`)) return;
    let count = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/memory/${id}/tier`, {
          method: 'PUT', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier, confirmed: tier === 'core_identity' }),
        });
        if (res.ok) count++;
      } catch {}
    }
    setSelectedIds(new Set());
    setBatchMode(false);
    fetchTree();
    fetchGrowthTimeline();
    toast.success(`Moved ${count} → ${TIER_LABELS[tier]?.label || tier}`);
  };

  const [analyzing, setAnalyzing] = useState(false);
  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch('/api/memory/analyze-behavior', { method: 'POST' });
      const data = await res.json();
      if (data.patternsFound > 0) { toast.success(`Found ${data.patternsFound} behavioral patterns`); fetchTree(); }
      else { toast.info('No new patterns found yet.'); }
    } catch (err: any) { toast.error(err.message); }
    finally { setAnalyzing(false); }
  };

  // Reminders
  const [reminders, setReminders] = useState<any[]>([]);
  const [newReminderContent, setNewReminderContent] = useState('');
  const [newReminderDueAt, setNewReminderDueAt] = useState('');
  const fetchReminders = useCallback(async () => {
    try { const res = await fetch('/api/reminders'); if (res.ok) setReminders(await res.json()); } catch { setReminders([]); }
  }, []);
  useEffect(() => { if (showReminders) fetchReminders(); }, [showReminders, fetchReminders]);

  const handleAddReminder = async () => {
    if (!newReminderContent.trim()) return;
    try {
      await fetch('/api/reminders', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: newReminderContent.trim(), dueAt: newReminderDueAt ? new Date(newReminderDueAt).toISOString() : null }),
      });
      setNewReminderContent(''); setNewReminderDueAt('');
      fetchReminders();
      toast.success('Reminder added');
    } catch (err: any) { toast.error(err.message); }
  };

  const handleCompleteReminder = async (id: string) => {
    try {
      await fetch(`/api/reminders/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: 'fired' }) });
      fetchReminders();
      toast.success('Done');
    } catch (err: any) { toast.error(err.message); }
  };

  const handleDeleteReminder = async (id: string) => {
    try { await fetch(`/api/reminders/${id}`, { method: 'DELETE' }); fetchReminders(); } catch (err: any) { toast.error(err.message); }
  };

  // Tier stats
  const byTier = flatMemories.reduce((acc, m) => { (acc[m.tier] ||= []).push(m); return acc; }, {} as Record<string, Memory[]>);

  // Filtered display tree
  let filteredMemories = activeTier ? (byTier[activeTier] || []) : flatMemories;
  if (perspectiveFilter) filteredMemories = filteredMemories.filter(m => m.perspective === perspectiveFilter);

  const buildFilteredTree = (memories: Memory[]): MemoryTree[] => {
    const map = new Map<string, MemoryTree>();
    const roots: MemoryTree[] = [];
    for (const m of memories) { map.set(m.id, { node: m, children: [] }); }
    for (const m of memories) {
      const t = map.get(m.id)!;
      if (m.parentId && map.has(m.parentId)) { map.get(m.parentId)!.children.push(t); }
      else { roots.push(t); }
    }
    return roots;
  };

  const displayTree = activeTier || perspectiveFilter ? buildFilteredTree(filteredMemories) : tree;

  // Loading state
  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center gap-3">
          <ListTree className="text-celestial-saturn" size={24} />
          <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">Memory Tree</h3>
        </div>
        <div className="space-y-3">
          {[1, 2, 3, 4].map(i => (
            <div key={i} className="h-10 bg-white/[0.03] rounded-xl animate-pulse" style={{ marginLeft: (i % 3) * 20 }} />
          ))}
        </div>
      </div>
    );
  }

  const pendingReminders = reminders.filter((r: any) => r.status === 'pending').length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-celestial-saturn/10 rounded-2xl">
            <ListTree className="text-celestial-saturn" size={22} />
          </div>
          <div>
            <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">Memory Tree</h3>
            <p className="text-[11px] text-white/25 mt-0.5">Branches are topics, leaves are what I know</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Button
            onClick={() => { setBatchMode(!batchMode); if (batchMode) setSelectedIds(new Set()); }}
            className={`text-[10px] font-bold px-3 py-1.5 rounded-xl transition-all ${
              batchMode ? 'bg-celestial-saturn/10 text-celestial-saturn border border-celestial-saturn/30' : 'bg-white/5 text-white/40 hover:text-white/70 border border-white/10'
            }`}
          >
            <ListTree size={12} className="mr-1" />
            {batchMode ? 'Exit Select' : 'Select'}
          </Button>
        </div>
      </div>

      {/* Tier stats cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
        {TIER_ORDER.map(tierKey => {
          const t = TIER_LABELS[tierKey];
          const count = (byTier[tierKey] || []).length;
          const isActive = activeTier === tierKey;
          return (
            <motion.button
              key={tierKey}
              whileHover={{ scale: 1.02 }}
              whileTap={{ scale: 0.98 }}
              onClick={() => setActiveTier(isActive ? '' : tierKey)}
              className={`p-4 rounded-2xl border text-left transition-all ${
                isActive ? `${t.bg} ${t.border} ring-1 ring-white/10` : 'bg-white/[0.03] border-white/[0.06] hover:bg-white/[0.06]'
              }`}
            >
              <div className={`text-2xl font-black ${t.color} tabular-nums`}>{count}</div>
              <div className="text-xs font-bold text-white/70 mt-1">{t.label}</div>
              <div className="text-[10px] text-white/25 mt-0.5">{t.desc}</div>
            </motion.button>
          );
        })}
      </div>

      {/* Controls bar */}
      <div className="flex items-center gap-2 flex-wrap">
        <div className="relative flex-1 min-w-[180px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="bg-white/[0.04] border-white/[0.08] rounded-xl pl-9 py-2 text-sm focus-visible:ring-celestial-saturn/30"
          />
        </div>

        <div className="relative">
          <SlidersHorizontal size={12} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="bg-white/[0.04] border border-white/[0.08] rounded-xl pl-8 pr-4 py-2 text-xs font-bold appearance-none cursor-pointer focus:border-celestial-saturn/30 outline-none text-white/70"
          >
            <option value="">All types</option>
            {Object.entries(TYPE_COLORS).map(([key, { text }]) => (<option key={key} value={key} className={text}>{key}</option>))}
          </select>
        </div>

        <select
          value={perspectiveFilter}
          onChange={e => setPerspectiveFilter(e.target.value)}
          className="bg-white/[0.04] border border-white/[0.08] rounded-xl px-3 py-2 text-xs font-bold appearance-none cursor-pointer focus:border-celestial-saturn/30 outline-none text-white/70"
        >
          <option value="">All perspectives</option>
          {Object.entries(PERSPECTIVE_LABELS).map(([key, { label }]) => (<option key={key} value={key}>{label}</option>))}
        </select>

        {batchMode && selectedIds.size > 0 && (
          <>
            <Button onClick={batchDelete} className="bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 text-[10px] font-bold px-3 py-1.5 rounded-xl">
              <Trash2 size={12} className="mr-1" /> {selectedIds.size}
            </Button>
            <div className="relative group">
              <Button className="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 text-[10px] font-bold px-3 py-1.5 rounded-xl">
                <Layers size={12} className="mr-1" /> Promote
              </Button>
              <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-white/10 rounded-xl p-1 hidden group-hover:flex flex-col min-w-[120px] z-50">
                {TIER_ORDER.filter(t => t !== 'episodic').map(tierKey => (
                  <button key={tierKey} onClick={() => batchPromote(tierKey)} className="text-[10px] font-bold text-white/70 hover:bg-white/10 rounded-lg px-3 py-1.5 text-left whitespace-nowrap">
                    {TIER_LABELS[tierKey]?.label || tierKey}
                  </button>
                ))}
              </div>
            </div>
          </>
        )}

        <div className="w-px h-6 bg-white/[0.08] mx-1" />

        <Button onClick={() => setAdding(true)} className="bg-celestial-saturn text-black font-bold text-xs px-4 py-2 rounded-xl hover:scale-105 transition-transform">
          <Plus size={14} className="mr-1" /> Add
        </Button>
        <Button onClick={handleAutoOrganize} disabled={organizing}
          className="bg-cyan-500/10 text-cyan-300 hover:bg-cyan-500/20 border border-cyan-500/20 text-xs font-bold px-4 py-2 rounded-xl transition-all">
          <Network size={14} className={`mr-1 ${organizing ? 'animate-pulse' : ''}`} />
          {organizing ? 'Organizing...' : 'Auto-Organize'}
        </Button>
        <Button onClick={handleConsolidate} disabled={consolidating}
          className="bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 text-xs font-bold px-4 py-2 rounded-xl transition-all">
          <GitMerge size={14} className={`mr-1 ${consolidating ? 'animate-pulse' : ''}`} />
          Consolidate
        </Button>
        <Button onClick={handleSelfReflect} disabled={reflecting}
          className="bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/20 text-xs font-bold px-4 py-2 rounded-xl transition-all">
          <Sparkles size={14} className={`mr-1 ${reflecting ? 'animate-pulse' : ''}`} />
          Reflect
        </Button>
        <Button onClick={handleAnalyze} disabled={analyzing}
          className="bg-white/[0.04] text-white/50 hover:text-white/80 border border-white/[0.08] text-xs font-bold px-4 py-2 rounded-xl transition-all">
          <TrendingUp size={14} className={`mr-1 ${analyzing ? 'animate-pulse' : ''}`} />
          Patterns
        </Button>

        <div className="w-px h-6 bg-white/[0.08] mx-1" />

        <Button onClick={() => setShowReminders(!showReminders)}
          className={`text-xs font-bold px-4 py-2 rounded-xl border transition-all relative ${
            showReminders ? 'bg-celestial-saturn/10 border-celestial-saturn/30 text-celestial-saturn' : 'bg-white/[0.04] text-white/50 hover:text-white/80 border-white/[0.08]'
          }`}>
          <Bell size={14} className="mr-1" />
          Reminders
          {pendingReminders > 0 && (
            <span className="absolute -top-1.5 -right-1.5 w-4 h-4 bg-celestial-saturn text-black text-[9px] font-bold rounded-full flex items-center justify-center">{pendingReminders}</span>
          )}
        </Button>
      </div>

      {/* Add form */}
      <AnimatePresence>
        {adding && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="p-5 bg-celestial-saturn/5 rounded-2xl border border-celestial-saturn/20 space-y-3">
              <div className="flex items-center gap-3">
                <select value={newType} onChange={e => setNewType(e.target.value)}
                  className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold uppercase appearance-none cursor-pointer text-white/70">
                  {Object.entries(TYPE_COLORS).map(([key, { text }]) => (<option key={key} value={key} className={text}>{key}</option>))}
                </select>
                <Input value={newContent} onChange={e => setNewContent(e.target.value)} placeholder="What should I remember?"
                  className="flex-1 bg-white/5 border-white/10 rounded-xl py-2 text-sm focus-visible:ring-celestial-saturn/50"
                  onKeyDown={e => e.key === 'Enter' && handleAdd()} autoFocus />
                <Button onClick={handleAdd} className="bg-celestial-saturn text-black font-bold text-xs px-4 py-2 rounded-xl"><Check size={14} className="mr-1" /> Save</Button>
                <Button onClick={() => setAdding(false)} variant="ghost" className="text-white/40 hover:text-white"><X size={14} /></Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Growth Timeline */}
      {growthTimeline.length > 0 && !activeTier && !search && (
        <div className="space-y-3">
          <h4 className="text-xs font-black uppercase tracking-widest text-emerald-400 flex items-center gap-2">
            <Sparkles size={12} /> Growth Timeline
          </h4>
          <div className="relative pl-6 border-l-2 border-emerald-500/20 space-y-3">
            {growthTimeline.slice(0, 10).map(memory => (
              <div key={memory.id} className="relative">
                <div className="absolute -left-[25px] top-2 w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30" />
                <div className="p-3 bg-emerald-500/[0.04] rounded-xl border border-emerald-500/10">
                  <p className="text-sm text-white/70 leading-relaxed">{memory.content}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[9px] text-white/20">{new Date(memory.createdAt).toLocaleDateString()}</span>
                    <span className="text-[9px] text-emerald-500/60 font-bold">{(memory.importance * 100).toFixed(0)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tree view */}
      {displayTree.length === 0 ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="py-20 bg-white/[0.02] rounded-[2rem] border border-white/[0.04] text-center"
        >
          <ListTree size={48} className="text-white/[0.06] mx-auto mb-4" />
          <p className="text-white/30 font-bold uppercase tracking-widest text-sm">
            {search ? 'No memories match your search' : activeTier ? `No ${TIER_LABELS[activeTier]?.label || activeTier} memories` : 'No memories yet'}
          </p>
          <p className="text-white/[0.12] text-xs mt-2">
            {search ? 'Try different keywords' : 'Interact with me to build memories naturally'}
          </p>
        </motion.div>
      ) : (
        <div
          className="space-y-0.5"
          onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = 'move'; }}
          onDrop={(e) => {
            e.preventDefault();
            const draggedId = e.dataTransfer.getData(DRAG_TYPE);
            if (draggedId) handleMove(draggedId, null);
          }}
        >
          {displayTree.map((node, i) => (
            <TreeNode
              key={node.node.id}
              tree={node}
              depth={0}
              branchIndex={i}
              expandedIds={expandedIds}
              setExpandedIds={setExpandedIds}
              selectedIds={selectedIds}
              toggleSelect={toggleSelect}
              editingId={editingId}
              editContent={editContent}
              setEditContent={setEditContent}
              handleEditStart={handleEditStart}
              handleEditSave={handleEditSave}
              handleEditCancel={() => setEditingId(null)}
              handleDelete={handleDelete}
              handleChangeTier={handleChangeTier}
              handleToggleProtect={handleToggleProtect}
              handleMove={handleMove}
              filterText={search}
              batchMode={batchMode}
              allBranches={allBranches}
            />
          ))}
        </div>
      )}

      {/* Reminders */}
      <AnimatePresence>
        {showReminders && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            style={{ overflow: 'hidden' }}
          >
            <div className="space-y-4 pt-6 border-t border-white/[0.06]">
              <div className="flex items-center gap-3">
                <Clock className="text-celestial-saturn" size={18} />
                <h3 className="text-lg font-bold uppercase tracking-tighter text-white/90">Reminders</h3>
                <span className="text-[10px] text-white/20">({pendingReminders} pending)</span>
              </div>
              <div className="p-4 bg-white/[0.03] rounded-2xl border border-white/[0.06] flex flex-col md:flex-row gap-3">
                <Input value={newReminderContent} onChange={e => setNewReminderContent(e.target.value)} placeholder="Add a reminder..."
                  className="flex-1 bg-black/20 border-white/10 rounded-xl py-2 text-sm focus-visible:ring-celestial-saturn/50"
                  onKeyDown={e => e.key === 'Enter' && handleAddReminder()} />
                <input type="datetime-local" value={newReminderDueAt} onChange={e => setNewReminderDueAt(e.target.value)}
                  className="bg-black/20 border border-white/[0.08] rounded-xl px-3 py-2 text-sm text-white/70 outline-none focus:border-celestial-saturn/50" />
                <Button onClick={handleAddReminder} className="bg-celestial-saturn text-black font-bold text-xs px-4 py-2 rounded-xl">
                  <Plus size={14} className="mr-1" /> Add
                </Button>
              </div>
              {reminders.length === 0 ? (
                <div className="p-8 bg-white/[0.02] rounded-2xl border border-white/[0.04] text-center">
                  <BellOff size={24} className="text-white/[0.08] mx-auto mb-2" />
                  <p className="text-white/30 text-xs font-bold uppercase tracking-widest">No reminders yet</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {reminders.map((reminder: any) => (
                    <div key={reminder.id} className={`p-4 rounded-2xl border transition-all ${reminder.status === 'fired' ? 'bg-white/[0.02] border-white/[0.04] opacity-40' : 'bg-celestial-saturn/[0.03] border-celestial-saturn/10'}`}>
                      <div className="flex items-start justify-between gap-4">
                        <div className="flex-1 min-w-0">
                          <p className={`text-sm ${reminder.status === 'fired' ? 'text-white/20 line-through' : 'text-white/70'}`}>{reminder.content}</p>
                          <div className="flex items-center gap-3 mt-2">
                            {reminder.dueAt && <span className="text-[10px] text-white/25 font-mono">{new Date(reminder.dueAt).toLocaleString()}</span>}
                            <span className={`text-[10px] font-bold uppercase tracking-widest ${reminder.status === 'pending' ? 'text-celestial-saturn' : 'text-white/15'}`}>{reminder.status}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1 shrink-0">
                          {reminder.status !== 'fired' && (
                            <button onClick={() => handleCompleteReminder(reminder.id)} className="p-2 hover:bg-green-500/10 rounded-xl text-white/20 hover:text-green-400 transition-colors"><Check size={14} /></button>
                          )}
                          <button onClick={() => handleDeleteReminder(reminder.id)} className="p-2 hover:bg-red-500/10 rounded-xl text-white/20 hover:text-red-400 transition-colors"><Trash2 size={14} /></button>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
