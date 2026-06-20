import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Loader2, Search, Sparkles, TrendingUp, Network, GitMerge, Upload, ArrowRight, File, FileText, Trash2, Download, Eye, ChevronRight, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';
import { useSocket } from '@/hooks/useSocket';
import { appConfirm } from '@/lib/appConfirm';
import { NodeDetailPanel } from './NodeDetailPanel';
import { MemoryTreeScene, layoutTree3D } from './MemoryTree';
import type { TreeNode3D, BranchCurve3D, MemoryNode as MemNode, FileEntry } from './MemoryTree';

interface MemoryTree { node: MemNode; children: MemoryTree[]; }

interface KnowledgeBaseProps {
  t?: any;
  isOpen: boolean;
  onClose: () => void;
  domain?: 'personal' | 'work';
}

export function KnowledgeBase({ t, isOpen, onClose, domain = 'personal' }: KnowledgeBaseProps) {
  const socket = useSocket();

  const [files, setFiles] = useState<FileEntry[]>([]);
  const [memories, setMemories] = useState<MemNode[]>([]);
  const [treeNodes, setTreeNodes] = useState<TreeNode3D[]>([]);
  const [branchCurves, setBranchCurves] = useState<BranchCurve3D[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [cardPos, setCardPos] = useState<{ x: number; y: number } | null>(null);
  const [organizing, setOrganizing] = useState(false);
  const [consolidating, setConsolidating] = useState(false);
  const [reflecting, setReflecting] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = React.useRef<HTMLInputElement>(null);
  const lastLoadErrorRef = React.useRef<string | null>(null);

  const reportLoadError = useCallback((message: string) => {
    setLoadError(message);
    if (lastLoadErrorRef.current !== message) {
      toast.error(message);
      lastLoadErrorRef.current = message;
    }
  }, []);

  const scopedMemoryUrl = useCallback((path: string) => {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}domain=${encodeURIComponent(domain)}`;
  }, [domain]);

  const scopedFileUrl = useCallback((path: string) => {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}domain=${encodeURIComponent(domain)}`;
  }, [domain]);

  // Fetch data — parallel, no dependency between files and memory tree
  const fetchAll = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    const [filesRes, treeRes] = await Promise.allSettled([
      fetch(scopedFileUrl('/api/files/list'), { credentials: 'include' }),
      fetch(scopedMemoryUrl('/api/memory/tree')),
    ]);
    const errors: string[] = [];

    if (filesRes.status === 'fulfilled' && filesRes.value.ok) {
      try {
        const d = await filesRes.value.json();
        setFiles((d.files || []).map((file: FileEntry) => ({
          ...file,
          name: file.displayName || file.name,
          domain: file.domain || domain,
        })));
      } catch {}
    } else {
      const status = filesRes.status === 'fulfilled' ? filesRes.value.status : 'network';
      errors.push(`${t.kbFilesLoadFailed || 'Files failed to load'} (${status})`);
    }

    if (treeRes.status === 'fulfilled' && treeRes.value.ok) {
      try {
        const d = await treeRes.value.json();
        const flat: MemNode[] = [];
        const walk = (nodes: MemoryTree[]) => {
          for (const n of nodes) { flat.push(n.node); walk(n.children); }
        };
        walk(d.tree || []);
        setMemories(flat);
      } catch {}
    } else {
      const status = treeRes.status === 'fulfilled' ? treeRes.value.status : 'network';
      errors.push(`${t.kbMemoriesLoadFailed || 'Memories failed to load'} (${status})`);
    }

    if (errors.length > 0) {
      reportLoadError(errors.join(' / '));
    } else {
      lastLoadErrorRef.current = null;
    }
    setLoading(false);
  }, [domain, reportLoadError, scopedFileUrl, scopedMemoryUrl, t.kbFilesLoadFailed, t.kbMemoriesLoadFailed]);

  useEffect(() => { if (isOpen) fetchAll(); }, [isOpen, fetchAll]);

  // Socket
  useEffect(() => {
    if (!socket || !isOpen) return;
    socket.on('memories:changed', fetchAll);
    return () => { socket.off('memories:changed', fetchAll); };
  }, [socket, isOpen, fetchAll]);

  // Build tree
  useEffect(() => {
    if (!isOpen) return;
    const { nodes, curves } = layoutTree3D(memories, files);
    setTreeNodes(nodes);
    setBranchCurves(curves);
  }, [memories, files, isOpen]);

  // Find selected node data
  const selectedNode = selectedId ? treeNodes.find(n => n.id === selectedId) : null;
  const selectedFileData = selectedId ? files.find(f => f.id === selectedId) : undefined;
  const selectedMemoryData = selectedId ? memories.find(m => m.id === selectedId) : undefined;

  // Search: text results from memories
  const searchResults = useMemo(() => {
    if (!search.trim()) return [];
    const q = search.toLowerCase();
    return memories
      .filter(m => m.nodeType !== 'branch' && m.content.toLowerCase().includes(q))
      .slice(0, 5);
  }, [memories, search]);

  // Actions
  const handleDelete = async (id: string) => {
    const n = treeNodes.find(nd => nd.id === id);
    if (!n) return;
    const ok = await appConfirm({
      title: t.kbDeleteConfirm || 'Delete',
      message: `${t.kbDeleteConfirm || 'Delete'} "${n.title}"?`,
      confirmText: t.delete || 'Delete',
      cancelText: t.cancel || 'Cancel',
      tone: 'danger',
    });
    if (!ok) return;
    try {
      const endpoint = n.type === 'file' ? scopedFileUrl(`/api/files/delete/${encodeURIComponent(id)}`) : scopedMemoryUrl(`/api/memories/${id}`);
      const res = await fetch(endpoint, { method: 'DELETE', credentials: 'include' });
      if (res.ok) { toast.success(t.kbDeleted || 'Deleted'); fetchAll(); setSelectedId(null); }
      else toast.error(t.kbDeleteFailed || 'Delete failed');
    } catch { toast.error(t.kbDeleteFailed || 'Delete failed'); }
  };

  const handleDownload = async (id: string) => {
    try {
      const res = await fetch(scopedFileUrl(`/api/files/download/${encodeURIComponent(id)}`), { credentials: 'include' });
      if (!res.ok) throw new Error('');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      const file = files.find(f => f.id === id);
      a.href = url; a.download = file?.displayName || file?.name || id;
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch { toast.error('Download failed'); }
  };

  const handleIngest = async (id: string) => {
    const agentId = prompt(t.kbEnterAgentId || 'Enter agent ID:');
    if (!agentId) return;
    try {
      const res = await fetch(scopedFileUrl('/api/files/ingest'), {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fileId: id, agentId, domain }),
      });
      if (res.ok) { toast.success(t.kbIngested || 'Ingested'); fetchAll(); }
      else toast.error(t.kbIngestFailed || 'Ingest failed');
    } catch { toast.error(t.kbIngestFailed || 'Ingest failed'); }
  };

  const handleToggleProtect = async (id: string) => {
    try {
      const res = await fetch(scopedMemoryUrl(`/api/memory/${id}/protect`), { method: 'PUT' });
      const d = await res.json();
      toast.success(d.protected ? (t.kbProtected || 'Protected') : (t.kbUnprotected || 'Unprotected'));
      fetchAll();
    } catch { toast.error(t.kbProtectFailed || 'Protect failed'); }
  };

  const handleChangeTier = async (id: string, tier: string, confirmed = false) => {
    try {
      const res = await fetch(scopedMemoryUrl(`/api/memory/${id}/tier`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tier, confirmed }),
      });
      if (!res.ok) {
        const d = await res.json();
        if (d.error?.includes('confirmed')) {
          const ok = await appConfirm({
            title: t.kbPromoteConfirm || 'Promote to Core Identity?',
            message: t.kbPromoteConfirm || 'Promote to Core Identity?',
            confirmText: t.confirm || 'Confirm',
            cancelText: t.cancel || 'Cancel',
          });
          if (ok) return handleChangeTier(id, tier, true);
          return;
        }
        throw new Error(d.error);
      }
      toast.success(t.kbTierChanged || 'Tier changed'); fetchAll();
    } catch (err: any) { toast.error(err.message); }
  };

  const handleEdit = async (id: string, content: string) => {
    try {
      const res = await fetch(scopedMemoryUrl(`/api/memories/${id}`), {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (res.ok) { toast.success(t.kbUpdated || 'Updated'); fetchAll(); }
      else toast.error(t.kbUpdateFailed || 'Update failed');
    } catch { toast.error(t.kbUpdateFailed || 'Update failed'); }
  };

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      for (let i = 0; i < files.length; i++) formData.append('files', files[i]);
      const res = await fetch(scopedFileUrl('/api/files/upload'), { method: 'POST', body: formData, credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        toast.success(`${t.kbUploadedFiles || 'Uploaded'}: ${d.files?.length || files.length}`);
        fetchAll();
      } else toast.error(t.kbUploadFailed || 'Upload failed');
    } catch { toast.error(t.kbUploadFailed || 'Upload failed'); }
    finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleAutoOrganize = async () => {
    setOrganizing(true);
    try {
      const res = await fetch(scopedMemoryUrl('/api/memory/auto-organize'), { method: 'POST' });
      const d = await res.json();
      if (d.success) { toast.success(`Organized: ${d.branchesCreated} branches, ${d.memoriesAssigned} memories`); fetchAll(); }
      else toast.info(d.reason || (t.kbNotEnoughMemories || 'Not enough unorganized memories'));
    } catch { toast.error(t.kbOrganizationFailed || 'Organization failed'); }
    finally { setOrganizing(false); }
  };

  const handleConsolidate = async () => {
    setConsolidating(true);
    try {
      const res = await fetch(scopedMemoryUrl('/api/memory/consolidate'), { method: 'POST' });
      const d = await res.json();
      if (d.success) { toast.success(t.kbConsolidated || 'Consolidated'); fetchAll(); }
      else toast.info(d.reason || `${t.kbNeedMemories || 'Need'} ${d.threshold || 10} ${t.kbMem || 'memories'}`);
    } catch { toast.error(t.kbConsolidationFailed || 'Consolidation failed'); }
    finally { setConsolidating(false); }
  };

  const handleSelfReflect = async () => {
    setReflecting(true);
    try {
      const res = await fetch(scopedMemoryUrl('/api/memory/self-reflect'), { method: 'POST' });
      const d = await res.json();
      if (d.success) { toast.success(t.kbReflectionComplete || 'Reflection complete'); fetchAll(); }
      else toast.info(d.reason || 'Nothing to reflect on');
    } catch { toast.error(t.kbReflectionFailed || 'Reflection failed'); }
    finally { setReflecting(false); }
  };

  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch(scopedMemoryUrl('/api/memory/analyze-behavior'), { method: 'POST' });
      const d = await res.json();
      if (d.patternsFound > 0) { toast.success(`${t.kbPatternsFound || 'Found'} ${d.patternsFound} ${t.kbPatterns || 'patterns'}`); fetchAll(); }
      else toast.info(t.kbNoNewPatterns || 'No new patterns');
    } catch { toast.error(t.kbAnalysisFailed || 'Analysis failed'); }
    finally { setAnalyzing(false); }
  };

  // ESC to close
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && isOpen && !selectedId) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [isOpen, onClose, selectedId]);

  const totalFiles = files.length;
  const totalMemories = memories.filter(m => m.nodeType !== 'branch').length;
  const totalBranches = memories.filter(m => m.nodeType === 'branch').length;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ clipPath: 'circle(0% at 50% 95%)', opacity: 0 }}
          animate={{ clipPath: 'circle(150% at 50% 95%)', opacity: 1 }}
          exit={{ clipPath: 'circle(0% at 50% 95%)', opacity: 0 }}
          transition={{ duration: 0.75, ease: [0.25, 0.1, 0.25, 1] }}
          className="fixed inset-0 z-[200]"
          style={{
            background: 'radial-gradient(ellipse at 50% 30%, #0f0f23 0%, #080812 40%, #020205 100%)',
          }}
        >
          {/* 3D Memory Tree Scene */}
          <MemoryTreeScene
            nodes={treeNodes}
            curves={branchCurves}
            searchQuery={search}
            highlightedNodeId={selectedId}
            onNodeClick={(id, sx, sy) => {
              if (!id) { setSelectedId(null); setCardPos(null); return; }
              setSelectedId(prev => prev === id ? null : id);
              setCardPos(prev => prev ? null : { x: sx, y: sy });
            }}
            onNodeDoubleClick={(id) => setSelectedId(id)}
          />

          {/* Loading overlay */}
          <AnimatePresence>
            {loading && (
              <motion.div
                initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                className="absolute inset-0 flex items-center justify-center bg-black/40 z-10"
              >
                <div className="flex flex-col items-center gap-4">
                  <Loader2 size={40} className="animate-spin text-amber-400" />
                  <span className="text-xs font-black uppercase tracking-[0.3em] text-white/55">{t.awakening || 'Awakening...'}</span>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {loadError && !loading && (
            <div className="absolute top-20 left-1/2 -translate-x-1/2 z-30 flex max-w-[520px] items-center gap-2 rounded-xl border border-red-400/20 bg-red-950/70 px-4 py-2 text-xs text-red-100 shadow-2xl backdrop-blur-xl">
              <AlertCircle size={14} className="shrink-0 text-red-300" />
              <span className="truncate">{loadError}</span>
            </div>
          )}

          {/* Left: File browser */}
          <div className="absolute left-6 top-32 bottom-20 z-20 flex flex-col">
            <div className="bg-black/40 backdrop-blur-xl border border-white/[0.08] rounded-2xl overflow-hidden flex-1 flex flex-col w-64 min-h-0">
              <div className="px-4 py-3 border-b border-white/[0.06] flex items-center justify-between">
                <span className="text-xs font-bold text-white/45 uppercase tracking-widest flex items-center gap-2">
                  <File size={12} className="text-blue-400/60" />
                  {t.kbFiles || 'Files'} ({totalFiles})
                </span>
              </div>
              <div className="flex-1 overflow-y-auto custom-scrollbar p-2 space-y-1">
                {files.length === 0 ? (
                  <div className="text-xs text-white/25 text-center py-8">{t.noFilesYet || 'No files yet'}</div>
                ) : (
                  files.map(f => (
                    <button
                      key={f.id}
                      onClick={() => { setSelectedId(f.id); setCardPos(null); }}
                      className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl text-left transition-all group ${
                        selectedId === f.id
                          ? 'bg-white/10 border border-white/15 shadow-[0_0_20px_rgba(59,130,246,0.08)]'
                          : 'hover:bg-white/5 border border-transparent'
                      }`}
                    >
                      {f.name.match(/\.(pdf|docx?|xlsx?|pptx?)$/i) ? (
                        <FileText size={13} className="text-amber-400/60 shrink-0" />
                      ) : f.name.match(/\.(mp3|wav|m4a|ogg|flac)$/i) ? (
                        <File size={13} className="text-purple-400/60 shrink-0" />
                      ) : f.name.match(/\.(mp4|mov|avi|mkv|webm)$/i) ? (
                        <File size={13} className="text-red-400/60 shrink-0" />
                      ) : (
                        <File size={13} className="text-blue-400/60 shrink-0" />
                      )}
                      <div className="flex-1 min-w-0">
                        <span className="text-xs text-white/70 truncate block">{f.name}</span>
                        {f.source && (
                          <span className="text-[12px] text-white/25 uppercase">{f.source}</span>
                        )}
                      </div>
                      <ChevronRight size={12} className="text-white/20 shrink-0 group-hover:text-white/40 transition-colors" />
                    </button>
                  ))
                )}
              </div>
            </div>
          </div>

          {/* Top bar — controls */}
          <div className="absolute top-6 left-6 right-6 z-20 pointer-events-none">
            <div className="flex items-center gap-3 justify-between pointer-events-auto">
              {/* Left: title */}
              <div className="flex items-center gap-3 bg-black/40 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-4 py-2">
                <div className="w-2 h-2 rounded-full bg-amber-400 animate-pulse shadow-[0_0_8px_rgba(251,191,36,0.5)]" />
                <span className="text-xs font-black text-white/50 uppercase tracking-[0.2em]">{t.knowledgeBase || 'Knowledge Base'}</span>
              </div>

              {/* Search */}
              <div className="relative flex items-center gap-2 bg-black/40 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-4 py-2 flex-1 max-w-[320px]">
                <Search size={13} className="text-white/45 shrink-0" />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder={t.searchMemories || 'Search memories...'}
                  className="bg-transparent text-xs text-white/70 placeholder:text-white/45 outline-none flex-1 min-w-0"
                />
                <AnimatePresence>
                  {search.trim() && (
                    <motion.div
                      initial={{ opacity: 0, y: -4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -4 }}
                      className="absolute top-full left-0 right-0 mt-2 bg-zinc-900/95 backdrop-blur-xl border border-white/10 rounded-xl overflow-hidden shadow-2xl"
                    >
                      {searchResults.length === 0 ? (
                        <div className="px-4 py-3 text-xs text-white/55">{t.noMatchesFound || 'No matches found'}</div>
                      ) : (
                        searchResults.map(m => (
                          <button
                            key={m.id}
                            onClick={() => setSelectedId(m.id)}
                            className="w-full flex items-center gap-2 px-4 py-2.5 text-left hover:bg-white/5 transition-colors group"
                          >
                            <ArrowRight size={12} className="text-amber-400/50 shrink-0 group-hover:text-amber-400 transition-colors" />
                            <span className="text-xs text-white/60 group-hover:text-white/80 transition-colors truncate">
                              {m.content.slice(0, 60)}
                            </span>
                          </button>
                        ))
                      )}
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>

              {/* Center: actions */}
              <div className="flex items-center gap-2">
                {/* Hidden file input */}
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  onChange={handleUpload}
                  className="hidden"
                />
                <button
                  onClick={() => fileInputRef.current?.click()}
                  disabled={uploading}
                  className="flex items-center gap-1.5 bg-black/40 backdrop-blur-xl border border-green-500/20 rounded-xl px-3 py-2 text-xs font-bold text-green-400/70 hover:text-green-300 hover:border-green-400/40 transition-all"
                >
                  {uploading ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                  {t.kbImport || 'Import'}
                </button>
                <button
                  onClick={handleAutoOrganize}
                  disabled={organizing}
                  className="flex items-center gap-1.5 bg-black/40 backdrop-blur-xl border border-cyan-500/20 rounded-xl px-3 py-2 text-xs font-bold text-cyan-400/70 hover:text-cyan-300 hover:border-cyan-400/40 transition-all"
                >
                  {organizing ? <Loader2 size={13} className="animate-spin" /> : <Network size={13} />}
                  {t.kbOrganize || 'Organize'}
                </button>
                <button
                  onClick={handleConsolidate}
                  disabled={consolidating}
                  className="flex items-center gap-1.5 bg-black/40 backdrop-blur-xl border border-emerald-500/20 rounded-xl px-3 py-2 text-xs font-bold text-emerald-400/70 hover:text-emerald-300 hover:border-emerald-400/40 transition-all"
                >
                  {consolidating ? <Loader2 size={13} className="animate-spin" /> : <GitMerge size={13} />}
                  {t.kbMerge || 'Merge'}
                </button>
                <button
                  onClick={handleSelfReflect}
                  disabled={reflecting}
                  className="flex items-center gap-1.5 bg-black/40 backdrop-blur-xl border border-violet-500/20 rounded-xl px-3 py-2 text-xs font-bold text-violet-400/70 hover:text-violet-300 hover:border-violet-400/40 transition-all"
                >
                  {reflecting ? <Loader2 size={13} className="animate-spin" /> : <Sparkles size={13} />}
                  {t.kbReflect || 'Reflect'}
                </button>
                <button
                  onClick={handleAnalyze}
                  disabled={analyzing}
                  className="flex items-center gap-1.5 bg-black/40 backdrop-blur-xl border border-amber-500/20 rounded-xl px-3 py-2 text-xs font-bold text-amber-400/70 hover:text-amber-300 hover:border-amber-400/40 transition-all"
                >
                  {analyzing ? <Loader2 size={13} className="animate-spin" /> : <TrendingUp size={13} />}
                  {t.kbPatterns || 'Patterns'}
                </button>
              </div>

              {/* Right: close + stats */}
              <div className="flex items-center gap-3">
                <div className="flex items-center gap-3 bg-black/40 backdrop-blur-xl border border-white/[0.08] rounded-2xl px-4 py-2">
                  <span className="text-[12px] font-bold text-blue-400/60">{totalFiles} {t.kbFiles || 'files'}</span>
                  <span className="w-px h-3 bg-white/[0.08]" />
                  <span className="text-[12px] font-bold text-amber-400/60">{totalMemories} {t.kbMem || 'mem'}</span>
                  <span className="w-px h-3 bg-white/[0.08]" />
                  <span className="text-[12px] font-bold text-cyan-400/60">{totalBranches} {t.kbBranches || 'branches'}</span>
                </div>
                <button
                  onClick={onClose}
                  className="w-10 h-10 flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/[0.08] rounded-2xl text-white/40 hover:text-white hover:border-white/20 transition-all"
                >
                  <X size={18} />
                </button>
              </div>
            </div>
          </div>

          {/* Floating detail card */}
          <NodeDetailPanel
            node={selectedNode ? {
              id: selectedNode.id,
              type: selectedNode.type as 'file' | 'memory' | 'branch' | 'conversation',
              title: selectedNode.title,
              hue: selectedNode.hue,
              fileData: selectedFileData,
              memoryData: selectedMemoryData,
              isCore: selectedNode.tier === 'core_identity',
              isBranch: selectedNode.type === 'branch',
            } : null}
            position={cardPos}
            onClose={() => { setSelectedId(null); setCardPos(null); }}
            onDelete={handleDelete}
            onDownload={handleDownload}
            onIngest={handleIngest}
            onToggleProtect={handleToggleProtect}
            onChangeTier={handleChangeTier}
            onEdit={handleEdit}
          />

          {/* Bottom hint */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <span className="text-[12px] font-bold text-white/40 uppercase tracking-[0.15em] bg-black/30 px-4 py-1.5 rounded-full border border-white/[0.04]">
              {t.kbEscHint || 'ESC to close · Click nodes to inspect · Drag to rotate'}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export { layoutTree3D };
