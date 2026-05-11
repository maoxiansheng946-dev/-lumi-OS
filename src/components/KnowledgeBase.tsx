import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Search, Upload, Network, GitMerge, Sparkles, TrendingUp, Loader2, File, BrainCircuit, Layers } from 'lucide-react';
import { toast } from 'sonner';
import { useSocket } from '@/hooks/useSocket';
import { ParticleCanvas } from './ParticleCanvas';
import { KnowledgeNode, type KnowledgeNodeData } from './KnowledgeNode';
import { NodeDetailPanel } from './NodeDetailPanel';

interface FileEntry {
  id: string;
  name: string;
  size: string;
  rawSize: number;
  type: 'file';
  source: 'upload' | 'generated' | 'ingested';
  agentIds: string[];
  status: 'ready' | 'indexing' | 'indexed';
  updatedAt: string;
  createdAt: string;
}

interface Memory {
  id: string;
  userId: string;
  type: 'preference' | 'fact' | 'habit' | 'knowledge';
  content: string;
  keywords: string[];
  confidence: number;
  tier: 'episodic' | 'internalized' | 'growth' | 'core_identity';
  perspective: string;
  importance: number;
  nodeType: 'branch' | 'leaf';
  createdAt: string;
  updatedAt: string;
  lastRetrievedAt: string | null;
  retrieveCount: number;
  parentId: string | null;
}

interface MemoryTree { node: Memory; children: MemoryTree[]; }

const POSITIONS_KEY = 'lumi_knowledge_positions';

function loadPositions(): Record<string, { x: number; y: number }> {
  try {
    const raw = localStorage.getItem(POSITIONS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function savePositions(positions: Record<string, { x: number; y: number }>) {
  try { localStorage.setItem(POSITIONS_KEY, JSON.stringify(positions)); } catch {}
}

function computeLayout(
  branchNodes: KnowledgeNodeData[],
  leafNodes: KnowledgeNodeData[],
  savedPositions: Record<string, { x: number; y: number }>,
): KnowledgeNodeData[] {
  const all: KnowledgeNodeData[] = [];
  const cols = Math.max(5, Math.ceil(Math.sqrt(leafNodes.length)));

  // Branch nodes in a row near top
  branchNodes.forEach((n, i) => {
    const x = (i + 1) / (branchNodes.length + 1);
    const y = 0.12 + Math.random() * 0.06;
    all.push({
      ...n,
      position: savedPositions[n.id] || { x, y },
    });
  });

  // Leaf nodes in a loose grid
  leafNodes.forEach((n, i) => {
    const col = i % cols;
    const row = Math.floor(i / cols);
    const x = (col + 1) / (cols + 1) + (Math.random() - 0.5) * 0.12;
    const y = 0.30 + (row / Math.ceil(leafNodes.length / cols)) * 0.55 + (Math.random() - 0.5) * 0.06;
    all.push({
      ...n,
      position: savedPositions[n.id] || { x: Math.max(0.05, Math.min(0.95, x)), y: Math.max(0.08, Math.min(0.92, y)) },
    });
  });

  return all;
}

const TIER_HUES: Record<string, number> = {
  core_identity: 42,
  growth: 150,
  internalized: 200,
  episodic: 260,
};

export function KnowledgeBase({ t }: { t?: any }) {
  const socket = useSocket();
  const containerRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [memories, setMemories] = useState<Memory[]>([]);
  const [nodes, setNodes] = useState<KnowledgeNodeData[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<'all' | 'file' | 'memory' | 'branch'>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<Set<string>>(new Set());
  const [organizing, setOrganizing] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [savedPositions, setSavedPositions] = useState<Record<string, { x: number; y: number }>>(loadPositions);
  const [containerSize, setContainerSize] = useState({ w: 800, h: 600 });

  // Observe container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(entries => {
      for (const e of entries) {
        setContainerSize({ w: e.contentRect.width, h: e.contentRect.height });
      }
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fetch data
  const fetchAll = useCallback(async () => {
    setLoading(true);
    try {
      const [filesRes, memoryRes] = await Promise.all([
        fetch('/api/files/list'),
        fetch('/api/memory/tree'),
      ]);
      if (filesRes.ok) {
        const d = await filesRes.json();
        setFiles(d.files || []);
      }
      if (memoryRes.ok) {
        const d = await memoryRes.json();
        const flat: Memory[] = [];
        const walk = (nodes: MemoryTree[]) => {
          for (const n of nodes) { flat.push(n.node); walk(n.children); }
        };
        walk(d.tree || []);
        setMemories(flat);
      }
    } catch { /* ignore */ }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchAll(); }, [fetchAll]);

  // Socket listener
  useEffect(() => {
    if (!socket) return;
    const handler = () => fetchAll();
    socket.on('memories:changed', handler);
    return () => { socket.off('memories:changed', handler); };
  }, [socket, fetchAll]);

  // Build knowledge nodes from files + memories
  useEffect(() => {
    const branchNodes: KnowledgeNodeData[] = [];
    const leafNodes: KnowledgeNodeData[] = [];

    // Files → leaf nodes
    for (const f of files) {
      leafNodes.push({
        id: f.id,
        type: 'file' as const,
        title: f.name,
        subtitle: f.size,
        hue: 210, // blue for files
        position: { x: 0.5, y: 0.5 },
        size: f.status === 'indexed' ? 'medium' : 'small',
        isIndexed: f.status === 'indexed',
      });
    }

    // Memories → branch or leaf nodes
    for (const m of memories) {
      const hue = TIER_HUES[m.tier] || 42;
      const isBranch = m.nodeType === 'branch';
      const node: KnowledgeNodeData = {
        id: m.id,
        type: isBranch ? 'branch' : 'memory',
        title: m.content.length > 60 ? m.content.slice(0, 57) + '...' : m.content,
        subtitle: m.type,
        hue,
        position: { x: 0.5, y: 0.5 },
        size: isBranch ? 'large' : 'small',
        tier: m.tier,
        isCore: m.tier === 'core_identity',
        isBranch,
      };
      if (isBranch) branchNodes.push(node);
      else leafNodes.push(node);
    }

    const positioned = computeLayout(branchNodes, leafNodes, savedPositions);
    setNodes(positioned);
  }, [files, memories, savedPositions]);

  // Filtering
  const filteredNodes = nodes.filter(n => {
    if (typeFilter !== 'all' && n.type !== typeFilter) return false;
    if (search) {
      const q = search.toLowerCase();
      return n.title.toLowerCase().includes(q) || n.subtitle?.toLowerCase().includes(q);
    }
    return true;
  });

  // Build node position list for ParticleCanvas
  const nodePositions = filteredNodes.map(n => ({
    x: n.position.x,
    y: n.position.y,
    id: n.id,
    hue: n.hue,
  }));

  // Find selected/highlighted node data for detail panel
  const selectedNodeData = selectedId ? (() => {
    const n = nodes.find(nd => nd.id === selectedId);
    if (!n) return null;
    const fileData = files.find(f => f.id === selectedId);
    const memoryData = memories.find(m => m.id === selectedId);
    return { ...n, fileData, memoryData };
  })() : null;

  // Handlers
  const handleNodeClick = (id: string) => {
    setSelectedId(prev => prev === id ? null : id);
  };

  const handleNodeDoubleClick = (id: string) => {
    const n = nodes.find(nd => nd.id === id);
    if (!n) return;
    if (n.type === 'file') {
      // Preview file
      const fileData = files.find(f => f.id === id);
      if (fileData) previewFile(fileData);
    } else {
      setSelectedId(id);
    }
  };

  const handleDragEnd = (id: string, x: number, y: number) => {
    const newPos = { ...savedPositions, [id]: { x, y } };
    setSavedPositions(newPos);
    savePositions(newPos);
    setNodes(prev => prev.map(n => n.id === id ? { ...n, position: { x, y } } : n));
  };

  const handleDelete = async (id: string) => {
    const n = nodes.find(nd => nd.id === id);
    if (!n) return;
    if (!confirm(`Delete "${n.title}"?`)) return;
    try {
      const endpoint = n.type === 'file' ? `/api/files/delete/${encodeURIComponent(id)}` : `/api/memories/${id}`;
      const method = 'DELETE';
      const res = await fetch(endpoint, { method });
      if (res.ok) {
        toast.success('Deleted');
        fetchAll();
        setSelectedId(null);
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Delete failed');
      }
    } catch { toast.error('Delete failed'); }
  };

  const handleDownload = async (id: string) => {
    try {
      const res = await fetch(`/api/files/download/${encodeURIComponent(id)}`);
      if (!res.ok) throw new Error('Download failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = id;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { toast.error('Download failed'); }
  };

  const handleIngest = async (id: string) => {
    const agentId = prompt('Enter agent ID to ingest into:');
    if (!agentId) return;
    try {
      const res = await fetch('/api/files/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ fileId: id, agentId }),
      });
      if (res.ok) {
        toast.success('Ingested');
        fetchAll();
      } else {
        const d = await res.json().catch(() => ({}));
        toast.error(d.error || 'Ingest failed');
      }
    } catch { toast.error('Ingest failed'); }
  };

  const handleToggleProtect = async (id: string) => {
    try {
      const res = await fetch(`/api/memory/${id}/protect`, { method: 'PUT' });
      const data = await res.json();
      toast.success(data.protected ? 'Protected' : 'Unprotected');
      fetchAll();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleChangeTier = async (id: string, tier: string, confirmed = false) => {
    try {
      const res = await fetch(`/api/memory/${id}/tier`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, confirmed }),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.error?.includes('confirmed')) {
          if (confirm('Promote to Core Identity?')) return handleChangeTier(id, tier, true);
          return;
        }
        throw new Error(d.error);
      }
      toast.success('Tier changed');
      fetchAll();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleEdit = async (id: string, content: string) => {
    try {
      const res = await fetch(`/api/memories/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) { toast.success('Updated'); fetchAll(); }
      else { toast.error('Update failed'); }
    } catch { toast.error('Update failed'); }
  };

  const handleUpload = async (fileList: FileList | null) => {
    if (!fileList || fileList.length === 0) return;
    const formData = new FormData();
    Array.from(fileList).forEach(f => formData.append('files', f));
    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData });
      if (res.ok) { toast.success(`Uploaded ${fileList.length} file(s)`); fetchAll(); }
      else { const d = await res.json().catch(() => ({})); toast.error(d.error || 'Upload failed'); }
    } catch { toast.error('Upload failed'); }
  };

  const previewFile = async (item: FileEntry) => {
    const textExts = ['.txt', '.md', '.json', '.csv', '.ts', '.tsx', '.js', '.jsx', '.py', '.html', '.css', '.yaml', '.yml', '.toml', '.xml', '.log', '.env', '.sh', '.bat'];
    const ext = '.' + item.name.split('.').pop()?.toLowerCase();
    if (textExts.includes(ext) && item.rawSize > 0) {
      try {
        const res = await fetch(`/api/files/download/${encodeURIComponent(item.id)}`);
        if (res.ok) {
          const text = await res.text();
          const w = window.open('', '_blank', 'width=800,height=600');
          if (w) {
            w.document.title = item.name;
            w.document.body.innerHTML = `<pre style="font-family:monospace;font-size:13px;padding:16px;white-space:pre-wrap;word-break:break-all;background:#0a0a0a;color:#e0e0e0">${text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</pre>`;
          }
        }
      } catch { toast.info(`Cannot preview ${item.name}`); }
    } else {
      toast.info('Preview not available. Use Download.');
    }
  };

  const handleAutoOrganize = async () => {
    setOrganizing(true);
    try {
      const res = await fetch('/api/memory/auto-organize', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success(`Organized: ${data.branchesCreated} branches, ${data.memoriesAssigned} memories`);
        fetchAll();
      } else { toast.info(data.reason || 'Not enough unorganized memories'); }
    } catch { toast.error('Organization failed'); }
    finally { setOrganizing(false); }
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    try {
      const res = await fetch('/api/memory/consolidate', { method: 'POST' });
      const data = await res.json();
      if (data.success) { toast.success('Consolidated'); fetchAll(); }
      else { toast.info(data.reason || `Need ${data.threshold || 10} episodic memories`); }
    } catch { toast.error('Consolidation failed'); }
    finally { setConsolidating(false); }
  };

  const handleSelfReflect = async () => {
    setReflecting(true);
    try {
      const res = await fetch('/api/memory/self-reflect', { method: 'POST' });
      const data = await res.json();
      if (data.success) { toast.success('Reflection complete'); fetchAll(); }
      else { toast.info(data.reason || 'Nothing to reflect on'); }
    } catch { toast.error('Reflection failed'); }
    finally { setReflecting(false); }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch('/api/memory/analyze-behavior', { method: 'POST' });
      const data = await res.json();
      if (data.patternsFound > 0) { toast.success(`Found ${data.patternsFound} patterns`); fetchAll(); }
      else { toast.info('No new patterns'); }
    } catch { toast.error('Analysis failed'); }
    finally { setAnalyzing(false); }
  };

  const totalFiles = files.length;
  const totalMemories = memories.filter(m => m.nodeType !== 'branch').length;
  const totalBranches = memories.filter(m => m.nodeType === 'branch').length;

  return (
    <div
      ref={containerRef}
      className="relative w-full h-full overflow-hidden bg-[#020408] font-sans"
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={(e) => {
        e.preventDefault();
        setIsDragging(false);
        handleUpload(e.dataTransfer.files);
      }}
    >
      {/* Particle Canvas background */}
      <ParticleCanvas
        nodePositions={nodePositions}
        highlightedNodeIds={highlightedIds}
        className="absolute inset-0"
      />

      {/* Loading state */}
      <AnimatePresence>
        {loading && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 flex items-center justify-center bg-black/60 z-20"
          >
            <div className="flex flex-col items-center gap-4">
              <Loader2 size={36} className="animate-spin text-celestial-saturn" />
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-white/30">Loading Knowledge Base...</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Knowledge Nodes */}
      {filteredNodes.map(node => (
        <KnowledgeNode
          key={node.id}
          node={node}
          isHighlighted={highlightedIds.has(node.id)}
          isSelected={selectedId === node.id}
          onClick={handleNodeClick}
          onDoubleClick={handleNodeDoubleClick}
          onDragEnd={handleDragEnd}
          containerWidth={containerSize.w}
          containerHeight={containerSize.h}
        />
      ))}

      {/* Toolbar - floating top */}
      <div className="absolute top-4 left-4 right-4 z-20 pointer-events-none">
        <div className="flex items-center gap-2 max-w-[720px] mx-auto pointer-events-auto">
          <div className="flex items-center gap-2 flex-1 bg-black/70 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-4 py-2.5 shadow-2xl">
            <Search size={14} className="text-white/20 shrink-0" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search knowledge base..."
              className="bg-transparent text-sm text-white/80 placeholder:text-white/20 outline-none flex-1 min-w-0"
            />
            <div className="flex items-center gap-1">
              {(['all', 'file', 'memory', 'branch'] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setTypeFilter(f)}
                  className={`px-2.5 py-1 rounded-lg text-[9px] font-bold uppercase tracking-wider transition-all ${
                    typeFilter === f ? 'bg-white/10 text-white/80' : 'text-white/25 hover:text-white/50'
                  }`}
                >
                  {f === 'all' ? 'All' : f === 'file' ? 'Files' : f === 'memory' ? 'Memories' : 'Branches'}
                </button>
              ))}
            </div>
          </div>

          <button
            onClick={() => fileInputRef.current?.click()}
            className="w-10 h-10 flex items-center justify-center bg-black/70 backdrop-blur-xl border border-white/[0.08] rounded-2xl text-white/60 hover:text-white hover:border-white/20 transition-all shadow-2xl"
          >
            <Upload size={16} />
            <input type="file" ref={fileInputRef} className="hidden" multiple onChange={e => handleUpload(e.target.files)} />
          </button>

          <button
            onClick={handleAutoOrganize}
            disabled={organizing}
            className="w-10 h-10 flex items-center justify-center bg-black/70 backdrop-blur-xl border border-cyan-500/20 rounded-2xl text-cyan-400/70 hover:text-cyan-400 hover:border-cyan-500/40 transition-all shadow-2xl"
          >
            <Network size={16} className={organizing ? 'animate-pulse' : ''} />
          </button>

          <button
            onClick={handleConsolidate}
            disabled={consolidating}
            className="w-10 h-10 flex items-center justify-center bg-black/70 backdrop-blur-xl border border-emerald-500/20 rounded-2xl text-emerald-400/70 hover:text-emerald-400 hover:border-emerald-500/40 transition-all shadow-2xl"
          >
            <GitMerge size={16} className={consolidating ? 'animate-pulse' : ''} />
          </button>
        </div>
      </div>

      {/* Stats bar - floating bottom */}
      <div className="absolute bottom-4 left-4 right-4 z-20 pointer-events-none">
        <div className="flex items-center gap-3 justify-center pointer-events-auto">
          <div className="flex items-center gap-3 bg-black/70 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-4 py-2 shadow-2xl">
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-white/40">
              <File size={12} /> {totalFiles} files
            </span>
            <span className="w-px h-3 bg-white/[0.08]" />
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-white/40">
              <BrainCircuit size={12} /> {totalMemories} memories
            </span>
            <span className="w-px h-3 bg-white/[0.08]" />
            <span className="flex items-center gap-1.5 text-[10px] font-bold text-white/40">
              <Layers size={12} /> {totalBranches} branches
            </span>
            <span className="w-px h-3 bg-white/[0.08]" />
            <button onClick={handleSelfReflect} disabled={reflecting} className="flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-white/5 text-[10px] font-bold text-white/25 hover:text-white/50 transition-colors">
              <Sparkles size={11} className={reflecting ? 'animate-pulse' : ''} /> Reflect
            </button>
            <button onClick={handleAnalyze} disabled={analyzing} className="flex items-center gap-1 px-2 py-0.5 rounded-lg hover:bg-white/5 text-[10px] font-bold text-white/25 hover:text-white/50 transition-colors">
              <TrendingUp size={11} className={analyzing ? 'animate-pulse' : ''} /> Patterns
            </button>
          </div>
        </div>
      </div>

      {/* Detail panel */}
      <NodeDetailPanel
        node={selectedNodeData}
        onClose={() => setSelectedId(null)}
        onDelete={handleDelete}
        onDownload={handleDownload}
        onIngest={handleIngest}
        onToggleProtect={handleToggleProtect}
        onChangeTier={handleChangeTier}
        onEdit={handleEdit}
      />

      {/* Drag overlay */}
      <AnimatePresence>
        {isDragging && (
          <motion.div
            initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
            className="absolute inset-0 z-50 bg-cyan-500/10 backdrop-blur-sm border-4 border-dashed border-cyan-500/30 flex items-center justify-center"
          >
            <div className="text-center space-y-3">
              <div className="w-20 h-20 rounded-full bg-cyan-500/20 flex items-center justify-center mx-auto animate-bounce">
                <Upload size={36} className="text-cyan-400" />
              </div>
              <p className="text-lg font-black text-white uppercase tracking-[0.2em]">Drop files to knowledge base</p>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
