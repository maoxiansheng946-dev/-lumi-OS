import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Download, Trash2, Edit3, Brain, Shield, ShieldOff, File, Clock, Layers, Sparkles, CheckCircle2, Loader2 } from 'lucide-react';

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

interface NodeDetailPanelProps {
  node: {
    id: string;
    type: 'file' | 'memory' | 'branch';
    title: string;
    hue: number;
    fileData?: FileEntry;
    memoryData?: Memory;
    isCore?: boolean;
    isBranch?: boolean;
  } | null;
  onClose: () => void;
  onDelete: (id: string) => void;
  onDownload?: (id: string) => void;
  onIngest?: (id: string) => void;
  onToggleProtect?: (id: string) => void;
  onChangeTier?: (id: string, tier: string, confirmed?: boolean) => void;
  onEdit?: (id: string, content: string) => void;
}

const TIER_LABELS: Record<string, string> = {
  core_identity: 'Core Identity',
  growth: 'Growth',
  internalized: 'Internalized',
  episodic: 'Episodic',
};

export function NodeDetailPanel({
  node,
  onClose,
  onDelete,
  onDownload,
  onIngest,
  onToggleProtect,
  onChangeTier,
  onEdit,
}: NodeDetailPanelProps) {
  return (
    <AnimatePresence>
      {node && (
        <motion.div
          initial={{ x: '100%', opacity: 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 0 }}
          transition={{ type: 'spring', stiffness: 300, damping: 28 }}
          className="absolute right-0 top-0 bottom-0 w-[340px] bg-black/80 backdrop-blur-2xl border-l border-white/[0.08] z-30 flex flex-col overflow-hidden shadow-2xl"
        >
          {/* Header */}
          <div className="p-4 border-b border-white/[0.06] flex items-center gap-3">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center shrink-0"
              style={{ background: `hsla(${node.hue}, 50%, 40%, 0.2)` }}
            >
              {node.type === 'file' ? (
                <File size={14} className="text-white/70" />
              ) : node.isBranch ? (
                <Layers size={14} className="text-white/70" />
              ) : (
                <Brain size={14} className="text-white/70" />
              )}
            </div>
            <div className="flex-1 min-w-0">
              <h3 className="text-sm font-bold text-white/85 truncate">{node.title}</h3>
              <span className="text-[9px] text-white/30 uppercase tracking-wider">
                {node.type === 'file' ? 'File' : node.isBranch ? 'Branch' : 'Memory'} · {node.id.slice(0, 8)}...
              </span>
            </div>
            <button onClick={onClose} className="p-1.5 hover:bg-white/10 rounded-lg text-white/30 hover:text-white transition-colors">
              <X size={16} />
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
            {/* File content */}
            {node.type === 'file' && node.fileData && (
              <>
                <div className="space-y-2">
                  <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Size</label>
                  <p className="text-sm text-white/60">{node.fileData.size}</p>
                </div>
                <div className="space-y-2">
                  <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Source</label>
                  <span className="inline-block px-2 py-0.5 rounded-full bg-white/5 border border-white/10 text-[9px] font-bold text-white/50 uppercase">
                    {node.fileData.source}
                  </span>
                </div>
                <div className="space-y-2">
                  <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Status</label>
                  <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full border text-[9px] font-bold uppercase ${
                    node.fileData.status === 'indexed'
                      ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                      : node.fileData.status === 'indexing'
                        ? 'bg-amber-500/10 border-amber-500/30 text-amber-400'
                        : 'bg-white/5 border-white/10 text-white/40'
                  }`}>
                    {node.fileData.status === 'indexed' ? <CheckCircle2 size={9} /> : node.fileData.status === 'indexing' ? <Loader2 size={9} className="animate-spin" /> : <Clock size={9} />}
                    {node.fileData.status}
                  </span>
                </div>
                {node.fileData.agentIds.length > 0 && (
                  <div className="space-y-2">
                    <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Agents</label>
                    <div className="flex flex-wrap gap-1">
                      {node.fileData.agentIds.map(aid => (
                        <span key={aid} className="px-2 py-0.5 bg-emerald-500/5 border border-emerald-500/20 rounded-full text-[8px] font-bold text-emerald-400/60 uppercase">{aid.slice(0, 8)}</span>
                      ))}
                    </div>
                  </div>
                )}
                <div className="space-y-2">
                  <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Modified</label>
                  <p className="text-[10px] text-white/30 font-mono">{new Date(node.fileData.updatedAt).toLocaleString()}</p>
                </div>
              </>
            )}

            {/* Memory content */}
            {(node.type === 'memory' || node.type === 'branch') && node.memoryData && (
              <>
                <div className="space-y-2">
                  <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Content</label>
                  <p className="text-sm text-white/70 leading-relaxed bg-white/[0.03] rounded-xl p-3 border border-white/[0.05]">
                    {node.memoryData.content}
                  </p>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.05]">
                    <label className="text-[7px] font-bold text-white/15 uppercase tracking-widest">Tier</label>
                    <p className="text-xs font-bold text-white/60 mt-0.5">{TIER_LABELS[node.memoryData.tier] || node.memoryData.tier}</p>
                  </div>
                  <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.05]">
                    <label className="text-[7px] font-bold text-white/15 uppercase tracking-widest">Type</label>
                    <p className="text-xs font-bold text-white/60 mt-0.5 capitalize">{node.memoryData.type}</p>
                  </div>
                  <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.05]">
                    <label className="text-[7px] font-bold text-white/15 uppercase tracking-widest">Confidence</label>
                    <p className="text-xs font-bold text-white/60 mt-0.5">{(node.memoryData.confidence * 100).toFixed(0)}%</p>
                  </div>
                  <div className="p-3 bg-white/[0.03] rounded-xl border border-white/[0.05]">
                    <label className="text-[7px] font-bold text-white/15 uppercase tracking-widest">Importance</label>
                    <p className="text-xs font-bold text-white/60 mt-0.5">{(node.memoryData.importance * 100).toFixed(0)}%</p>
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Keywords</label>
                  <div className="flex flex-wrap gap-1">
                    {node.memoryData.keywords?.map(kw => (
                      <span key={kw} className="px-2 py-0.5 bg-white/5 rounded-full text-[8px] text-white/30">{kw}</span>
                    ))}
                  </div>
                </div>
                <div className="space-y-2">
                  <label className="text-[8px] font-bold text-white/20 uppercase tracking-widest">Retrieved</label>
                  <p className="text-[10px] text-white/30">{node.memoryData.retrieveCount || 0}x · last: {node.memoryData.lastRetrievedAt ? new Date(node.memoryData.lastRetrievedAt).toLocaleDateString() : 'never'}</p>
                </div>
              </>
            )}
          </div>

          {/* Actions */}
          <div className="p-3 border-t border-white/[0.06] flex items-center gap-2 flex-wrap">
            {node.type === 'file' && (
              <>
                {onDownload && (
                  <button onClick={() => onDownload(node.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-bold text-white/60 transition-colors">
                    <Download size={12} /> Download
                  </button>
                )}
                {onIngest && (
                  <button onClick={() => onIngest(node.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/20 rounded-lg text-[10px] font-bold text-amber-400 transition-colors">
                    <Brain size={12} /> Ingest
                  </button>
                )}
              </>
            )}
            {(node.type === 'memory' || node.type === 'branch') && (
              <>
                {onEdit && (
                  <button onClick={() => {
                    const content = prompt('Edit content:', node.memoryData?.content || '');
                    if (content) onEdit(node.id, content);
                  }} className="flex items-center gap-1.5 px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg text-[10px] font-bold text-white/60 transition-colors">
                    <Edit3 size={12} /> Edit
                  </button>
                )}
                {onToggleProtect && (
                  <button onClick={() => onToggleProtect(node.id)} className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-[10px] font-bold transition-colors ${
                    node.isCore ? 'bg-amber-500/10 border border-amber-500/20 text-amber-400' : 'bg-white/5 hover:bg-white/10 text-white/60'
                  }`}>
                    {node.isCore ? <Shield size={12} /> : <ShieldOff size={12} />}
                    {node.isCore ? 'Protected' : 'Protect'}
                  </button>
                )}
                {onChangeTier && (
                  <select
                    value={node.memoryData?.tier || 'episodic'}
                    onChange={e => onChangeTier(node.id, e.target.value)}
                    className="bg-white/5 border border-white/10 rounded-lg px-2 py-1.5 text-[10px] font-bold uppercase appearance-none cursor-pointer text-white/50"
                  >
                    {Object.entries(TIER_LABELS).map(([k, v]) => (<option key={k} value={k}>{v}</option>))}
                  </select>
                )}
              </>
            )}
            <div className="flex-1" />
            <button onClick={() => onDelete(node.id)} className="flex items-center gap-1.5 px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 border border-red-500/20 rounded-lg text-[10px] font-bold text-red-400 transition-colors">
              <Trash2 size={12} /> Delete
            </button>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
