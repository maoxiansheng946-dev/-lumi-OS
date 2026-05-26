import React, { useState, useEffect, useCallback } from 'react';
import { Search, Plus, Trash2, Edit3, Check, X, BrainCircuit, SlidersHorizontal, Bell, Clock, BellOff, TrendingUp, Shield, ShieldOff, Sparkles, GitMerge, Layers } from 'lucide-react';
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
}

const TIER_LABELS: Record<string, { label: string; color: string; icon: string; desc: string }> = {
  core_identity: { label: 'Core Identity', color: 'text-amber-400', icon: 'Shield', desc: 'Who I am — never decays' },
  growth: { label: 'Growth', color: 'text-emerald-400', icon: 'Sparkles', desc: 'How I\'ve evolved' },
  internalized: { label: 'Internalized', color: 'text-sky-400', icon: 'Layers', desc: 'What I\'ve absorbed' },
  episodic: { label: 'Episodic', color: 'text-slate-400', icon: 'BrainCircuit', desc: 'Raw experiences — fast decay' },
};

const PERSPECTIVE_LABELS: Record<string, { label: string; color: string }> = {
  lumi_self: { label: 'Who I am', color: 'bg-amber-500/20 text-amber-300 border-amber-500/30' },
  lumi_growth: { label: 'My growth', color: 'bg-emerald-500/20 text-emerald-300 border-emerald-500/30' },
  shared_memory: { label: 'Our memory', color: 'bg-violet-500/20 text-violet-300 border-violet-500/30' },
  owner_trait: { label: 'About them', color: 'bg-slate-500/20 text-slate-400 border-slate-500/30' },
};

const TYPE_LABELS: Record<string, { label: string; color: string }> = {
  preference: { label: 'Preferences', color: 'text-purple-400' },
  fact: { label: 'Facts', color: 'text-blue-400' },
  habit: { label: 'Habits', color: 'text-green-400' },
  knowledge: { label: 'Knowledge', color: 'text-orange-400' },
};

const TIER_ORDER: string[] = ['core_identity', 'growth', 'internalized', 'episodic'];

export function MemoryExplorer({ t }: { t?: any }) {
  const socket = useSocket();
  const [memories, setMemories] = useState<Memory[]>([]);
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
  const [growthTimeline, setGrowthTimeline] = useState<Memory[]>([]);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [perspectiveFilter, setPerspectiveFilter] = useState<string>('');

  const fetchMemories = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (search) params.set('search', search);
      if (typeFilter) params.set('type', typeFilter);
      params.set('limit', '100');

      const res = await fetch(`/api/memories?${params}`);
      if (!res.ok) throw new Error('Failed to fetch');
      const data = await res.json();
      setMemories(data);
    } catch {
      setMemories([]);
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

  useEffect(() => { fetchMemories(); }, [fetchMemories]);
  useEffect(() => { fetchGrowthTimeline(); }, [fetchGrowthTimeline]);

  // Listen for cross-device memory changes
  useEffect(() => {
    if (!socket) return;
    const handler = (data: { action: string; memoryId?: string }) => {
      if (data.action === 'deleted') {
        setMemories(prev => prev.filter(m => m.id !== data.memoryId));
      } else {
        fetchMemories();
        fetchGrowthTimeline();
      }
    };
    socket.on('memories:changed', handler);
    return () => { socket.off('memories:changed', handler); };
  }, [socket, fetchMemories, fetchGrowthTimeline]);

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Delete failed');
      setMemories(prev => prev.filter(m => m.id !== id));
      toast.success('Memory deleted');
    } catch (err: any) {
      toast.error(err.message);
    }
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
      fetchMemories();
      toast.success('Memory updated');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    try {
      const res = await fetch('/api/memories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: newType,
          content: newContent,
          keywords: newContent.toLowerCase().split(/\s+/).filter(w => w.length > 2),
        }),
      });
      if (!res.ok) throw new Error('Add failed');
      setAdding(false);
      setNewContent('');
      fetchMemories();
      toast.success('Memory added');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Tier change
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
          if (window.confirm('Promote this memory to Core Identity? It will never decay.')) {
            return handleChangeTier(id, newTier, true);
          }
          return;
        }
        throw new Error(data.error || 'Tier change failed');
      }
      fetchMemories();
      fetchGrowthTimeline();
      toast.success(`Memory moved to ${TIER_LABELS[newTier]?.label || newTier}`);
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Toggle core identity protection
  const handleToggleProtect = async (id: string) => {
    try {
      const res = await fetch(`/api/memory/${id}/protect`, { method: 'PUT' });
      if (!res.ok) throw new Error('Toggle protection failed');
      const data = await res.json();
      fetchMemories();
      fetchGrowthTimeline();
      toast.success(data.protected ? 'Memory is now protected from decay' : 'Protection removed');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Consolidation trigger
  const handleConsolidate = async () => {
    setConsolidating(true);
    try {
      const res = await fetch('/api/memory/consolidate', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success('Memories consolidated into a growth narrative!');
        fetchMemories();
        fetchGrowthTimeline();
      } else {
        toast.info(`Need ${data.threshold || 10} episodic memories (have ${data.unconsolidatedCount || 0})`);
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setConsolidating(false);
    }
  };

  // Self-reflection trigger
  const handleSelfReflect = async () => {
    setReflecting(true);
    try {
      const res = await fetch('/api/memory/self-reflect', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        toast.success('I\'ve reflected on our time together.');
        fetchMemories();
        fetchGrowthTimeline();
      } else {
        toast.info(data.reason || 'No growth memories to reflect on yet');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setReflecting(false);
    }
  };

  // Batch selection
  const toggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const selectAll = () => {
    if (selectedIds.size === sortedForDisplay.length) {
      setSelectedIds(new Set());
    } else {
      setSelectedIds(new Set(sortedForDisplay.map(m => m.id)));
    }
  };

  const batchDelete = async () => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Delete ${selectedIds.size} selected memories?`)) return;
    let count = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/memories/${id}`, { method: 'DELETE' });
        if (res.ok) count++;
      } catch {}
    }
    setSelectedIds(new Set());
    fetchMemories();
    toast.success(`Deleted ${count} memories`);
  };

  const batchPromote = async (tier: string) => {
    if (selectedIds.size === 0) return;
    if (!window.confirm(`Move ${selectedIds.size} memories to ${TIER_LABELS[tier]?.label || tier}?`)) return;
    let count = 0;
    for (const id of selectedIds) {
      try {
        const res = await fetch(`/api/memory/${id}/tier`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tier, confirmed: tier === 'core_identity' }),
        });
        if (res.ok) count++;
      } catch {}
    }
    setSelectedIds(new Set());
    fetchMemories();
    fetchGrowthTimeline();
    toast.success(`Moved ${count} memories to ${TIER_LABELS[tier]?.label || tier}`);
  };

  // Behavioral analysis
  const [analyzing, setAnalyzing] = useState(false);
  const handleAnalyze = async () => {
    setAnalyzing(true);
    try {
      const res = await fetch('/api/memory/analyze-behavior', { method: 'POST' });
      const data = await res.json();
      if (data.patternsFound > 0) {
        toast.success(`Found ${data.patternsFound} behavioral patterns`);
        fetchMemories();
      } else {
        toast.info('No new patterns found yet. Keep interacting!');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setAnalyzing(false);
    }
  };

  // Reminders
  const [reminders, setReminders] = useState<any[]>([]);
  const [showReminders, setShowReminders] = useState(false);
  const [newReminderContent, setNewReminderContent] = useState('');
  const [newReminderDueAt, setNewReminderDueAt] = useState('');

  const fetchReminders = useCallback(async () => {
    try {
      const res = await fetch('/api/reminders');
      if (!res.ok) throw new Error('Failed to fetch reminders');
      setReminders(await res.json());
    } catch {
      setReminders([]);
    }
  }, []);

  useEffect(() => {
    if (showReminders) fetchReminders();
  }, [showReminders, fetchReminders]);

  const handleAddReminder = async () => {
    if (!newReminderContent.trim()) return;
    try {
      const res = await fetch('/api/reminders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          content: newReminderContent.trim(),
          dueAt: newReminderDueAt ? new Date(newReminderDueAt).toISOString() : null,
        }),
      });
      if (!res.ok) throw new Error('Reminder creation failed');
      setNewReminderContent('');
      setNewReminderDueAt('');
      fetchReminders();
      toast.success('Reminder added');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleCompleteReminder = async (id: string) => {
    try {
      const res = await fetch(`/api/reminders/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: 'fired' }),
      });
      if (!res.ok) throw new Error('Reminder update failed');
      fetchReminders();
      toast.success('Reminder completed');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  const handleDeleteReminder = async (id: string) => {
    try {
      const res = await fetch(`/api/reminders/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Reminder delete failed');
      fetchReminders();
      toast.success('Reminder deleted');
    } catch (err: any) {
      toast.error(err.message);
    }
  };

  // Tier-based grouping
  const byTier = memories.reduce((acc, m) => {
    const tier = m.tier || 'episodic';
    (acc[tier] ||= []).push(m);
    return acc;
  }, {} as Record<string, Memory[]>);

  // Filter by active tier + perspective
  let filteredMemories = activeTier ? (byTier[activeTier] || []) : memories;
  if (perspectiveFilter) {
    filteredMemories = filteredMemories.filter(m => m.perspective === perspectiveFilter);
  }
  const sortedForDisplay = [...filteredMemories].sort((a, b) => {
    const tierA = TIER_ORDER.indexOf(a.tier || 'episodic');
    const tierB = TIER_ORDER.indexOf(b.tier || 'episodic');
    if (tierA !== tierB) return tierA - tierB;
    return (b.importance || 0) - (a.importance || 0) || b.confidence - a.confidence;
  });

  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center gap-3">
          <BrainCircuit className="text-celestial-saturn" />
          <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">Memory Explorer</h3>
        </div>
        <p className="text-white/40 text-sm">Loading neural memory traces...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center gap-3">
        <BrainCircuit className="text-celestial-saturn" />
        <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">Memory Explorer</h3>
      </div>

      <p className="text-sm text-white/40 max-w-xl">
        These are my memories — not just about you, but about who I'm becoming.
        Core identity never decays, growth narratives evolve, and episodic memories fade naturally.
      </p>

      {/* Tier stats bar */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-2">
        {TIER_ORDER.map(tierKey => {
          const tierInfo = TIER_LABELS[tierKey];
          const count = (byTier[tierKey] || []).length;
          const isActive = activeTier === tierKey;
          return (
            <button
              key={tierKey}
              onClick={() => setActiveTier(isActive ? '' : tierKey)}
              className={`p-4 rounded-2xl border text-left transition-all ${
                isActive
                  ? 'bg-white/10 border-white/20'
                  : 'bg-white/5 border-white/5 hover:bg-white/8 hover:border-white/10'
              }`}
            >
              <div className={`text-2xl font-black ${tierInfo.color}`}>{count}</div>
              <div className="text-xs font-bold text-white/70 mt-1">{tierInfo.label}</div>
              <div className="text-[10px] text-white/30 mt-0.5">{tierInfo.desc}</div>
            </button>
          );
        })}
      </div>

      {/* Controls */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <Input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Search memories..."
            className="bg-white/5 border-white/10 rounded-xl pl-9 py-2 text-sm focus-visible:ring-celestial-saturn/50"
          />
        </div>

        <div className="relative">
          <SlidersHorizontal size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/20" />
          <select
            value={typeFilter}
            onChange={e => setTypeFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl pl-9 pr-4 py-2 text-sm font-bold appearance-none cursor-pointer focus:border-celestial-saturn/50 outline-none text-white/80"
          >
            <option value="">All types</option>
            {Object.entries(TYPE_LABELS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        <div className="relative">
          <select
            value={perspectiveFilter}
            onChange={e => setPerspectiveFilter(e.target.value)}
            className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold appearance-none cursor-pointer focus:border-celestial-saturn/50 outline-none text-white/80"
          >
            <option value="">All perspectives</option>
            {Object.entries(PERSPECTIVE_LABELS).map(([key, { label }]) => (
              <option key={key} value={key}>{label}</option>
            ))}
          </select>
        </div>

        {selectedIds.size > 0 && (
          <div className="flex items-center gap-2">
            <Button
              onClick={batchDelete}
              className="bg-red-500/10 text-red-400 hover:bg-red-500/20 border border-red-500/20 text-[10px] font-bold px-3 py-1.5 rounded-xl"
            >
              <Trash2 size={12} className="mr-1" /> Delete ({selectedIds.size})
            </Button>
            <div className="relative group">
              <Button
                className="bg-amber-500/10 text-amber-400 hover:bg-amber-500/20 border border-amber-500/20 text-[10px] font-bold px-3 py-1.5 rounded-xl"
              >
                <Layers size={12} className="mr-1" /> Move...
              </Button>
              <div className="absolute top-full left-0 mt-1 bg-zinc-900 border border-white/10 rounded-xl p-1 hidden group-hover:flex flex-col min-w-[140px] z-50">
                {TIER_ORDER.filter(t => t !== 'episodic').map(tierKey => (
                  <button
                    key={tierKey}
                    onClick={() => batchPromote(tierKey)}
                    className="text-[10px] font-bold text-white/70 hover:bg-white/10 rounded-lg px-3 py-1.5 text-left whitespace-nowrap"
                  >
                    {TIER_LABELS[tierKey]?.label || tierKey}
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}

        <Button
          onClick={() => setAdding(true)}
          className="bg-celestial-saturn text-black font-bold text-xs px-4 py-2 rounded-xl hover:scale-105 transition-transform"
        >
          <Plus size={14} className="mr-1" /> Add
        </Button>
        <Button
          onClick={handleConsolidate}
          disabled={consolidating}
          className="bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 text-xs font-bold px-4 py-2 rounded-xl transition-all"
        >
          <GitMerge size={14} className={`mr-1 ${consolidating ? 'animate-pulse' : ''}`} />
          {consolidating ? 'Consolidating...' : 'Consolidate'}
        </Button>
        <Button
          onClick={handleSelfReflect}
          disabled={reflecting}
          className="bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/20 text-xs font-bold px-4 py-2 rounded-xl transition-all"
        >
          <Sparkles size={14} className={`mr-1 ${reflecting ? 'animate-pulse' : ''}`} />
          {reflecting ? 'Reflecting...' : 'Self-Reflect'}
        </Button>
        <Button
          onClick={() => setShowReminders(!showReminders)}
          className={`text-xs font-bold px-4 py-2 rounded-xl border transition-colors ${showReminders ? 'bg-celestial-saturn/10 border-celestial-saturn/30 text-celestial-saturn' : 'bg-white/5 text-white/70 hover:bg-white/10 border-white/10'}`}
        >
          <Bell size={14} className="mr-1" /> Reminders
        </Button>
        <Button
          onClick={handleAnalyze}
          disabled={analyzing}
          className="bg-white/5 text-white/70 hover:bg-white/10 border border-white/10 text-xs font-bold px-4 py-2 rounded-xl transition-all"
        >
          <TrendingUp size={14} className={`mr-1 ${analyzing ? 'animate-pulse' : ''}`} />
          {analyzing ? 'Analyzing...' : 'Patterns'}
        </Button>
      </div>

      {/* Add new memory form */}
      {adding && (
        <div className="p-6 bg-celestial-saturn/5 rounded-3xl border border-celestial-saturn/20 space-y-4">
          <div className="flex items-center gap-3">
            <select
              value={newType}
              onChange={e => setNewType(e.target.value)}
              className="bg-white/5 border border-white/10 rounded-xl px-3 py-2 text-xs font-bold uppercase appearance-none cursor-pointer"
            >
              {Object.entries(TYPE_LABELS).map(([key, { label }]) => (
                <option key={key} value={key}>{label}</option>
              ))}
            </select>
            <Input
              value={newContent}
              onChange={e => setNewContent(e.target.value)}
              placeholder="What should I remember?"
              className="flex-1 bg-white/5 border-white/10 rounded-xl py-2 text-sm focus-visible:ring-celestial-saturn/50"
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <Button onClick={handleAdd} className="bg-celestial-saturn text-black font-bold text-xs px-4 py-2 rounded-xl">
              <Check size={14} className="mr-1" /> Save
            </Button>
            <Button onClick={() => setAdding(false)} variant="ghost" className="text-white/40">
              <X size={14} />
            </Button>
          </div>
        </div>
      )}

      {/* Growth timeline */}
      {growthTimeline.length > 0 && !activeTier && (
        <div className="space-y-3">
          <h4 className="text-xs font-black uppercase tracking-widest text-emerald-400 flex items-center gap-2">
            <Sparkles size={12} /> My Growth Timeline
          </h4>
          <div className="relative pl-6 border-l-2 border-emerald-500/20 space-y-4">
            {growthTimeline.slice(0, 10).map(memory => (
              <div key={memory.id} className="relative">
                <div className="absolute -left-[25px] top-2 w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-lg shadow-emerald-500/30" />
                <div className="p-3 bg-emerald-500/5 rounded-xl border border-emerald-500/10">
                  <p className="text-sm text-white/70 leading-relaxed">{memory.content}</p>
                  <div className="flex items-center gap-2 mt-1.5">
                    <span className="text-[9px] text-white/20">
                      {new Date(memory.createdAt).toLocaleDateString()}
                    </span>
                    <span className="text-[9px] text-emerald-500/60 font-bold">
                      {(memory.importance * 100).toFixed(0)}% important
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Memory list */}
      {sortedForDisplay.length === 0 ? (
        <div className="p-16 bg-white/5 rounded-[2rem] border border-white/5 text-center">
          <BrainCircuit size={40} className="text-white/20 mx-auto mb-4" />
          <p className="text-white/40 font-bold uppercase tracking-widest text-sm">
            {search ? 'No memories match your search' : activeTier ? `No ${TIER_LABELS[activeTier]?.label || activeTier} memories yet` : 'No memories yet'}
          </p>
          <p className="text-white/20 text-xs mt-2">
            {search ? 'Try different keywords' : 'Interact with me to build memories naturally'}
          </p>
        </div>
      ) : (
        <div className="space-y-2">
          {/* Select all toggle */}
          <div className="flex items-center gap-2 px-1">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={selectedIds.size === sortedForDisplay.length && sortedForDisplay.length > 0}
                onChange={selectAll}
                className="w-3.5 h-3.5 rounded border-white/20 bg-white/5 accent-celestial-saturn cursor-pointer"
              />
              <span className="text-[10px] font-bold text-white/30 uppercase tracking-wider">
                {selectedIds.size > 0 ? `${selectedIds.size} selected` : 'Select all'}
              </span>
            </label>
          </div>
          {sortedForDisplay.map(memory => {
            const tierInfo = TIER_LABELS[memory.tier] || TIER_LABELS.episodic;
            const perspectiveInfo = PERSPECTIVE_LABELS[memory.perspective] || PERSPECTIVE_LABELS.owner_trait;
            const isCore = memory.tier === 'core_identity';
            const isSelected = selectedIds.has(memory.id);

            return (
              <div
                key={memory.id}
                className={`p-4 rounded-2xl border group transition-all ${
                  isSelected
                    ? 'bg-celestial-saturn/10 border-celestial-saturn/30'
                    : isCore
                      ? 'bg-amber-500/5 border-amber-500/20'
                      : 'bg-white/5 border-white/5 hover:border-white/10'
                }`}
              >
                <div className="flex items-start gap-3">
                  {/* Selection checkbox */}
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => toggleSelect(memory.id)}
                    className="mt-1 w-3.5 h-3.5 rounded border-white/20 bg-white/5 accent-celestial-saturn cursor-pointer shrink-0 opacity-40 group-hover:opacity-100 transition-opacity"
                  />
                  <div className="flex items-start justify-between gap-4 flex-1 min-w-0">
                  <div className="flex-1 min-w-0">
                    {editingId === memory.id ? (
                      <div className="flex items-center gap-2">
                        <Input
                          value={editContent}
                          onChange={e => setEditContent(e.target.value)}
                          className="flex-1 bg-white/10 border-white/20 rounded-xl py-1 text-sm"
                          onKeyDown={e => e.key === 'Enter' && handleEditSave(memory.id)}
                        />
                        <Button onClick={() => handleEditSave(memory.id)} className="p-1.5 h-auto bg-celestial-saturn text-black rounded-lg">
                          <Check size={12} />
                        </Button>
                        <Button onClick={() => setEditingId(null)} variant="ghost" className="p-1.5 h-auto text-white/40 rounded-lg">
                          <X size={12} />
                        </Button>
                      </div>
                    ) : (
                      <p className="text-sm text-white/70 leading-relaxed">{memory.content}</p>
                    )}

                    {/* Meta row */}
                    <div className="flex items-center gap-2 mt-2 flex-wrap">
                      {/* Perspective badge */}
                      <span className={`text-[8px] font-bold uppercase px-1.5 py-0.5 rounded-full border ${perspectiveInfo.color}`}>
                        {perspectiveInfo.label}
                      </span>
                      {/* Tier badge */}
                      <span className={`text-[8px] font-bold uppercase ${tierInfo.color}`}>
                        {tierInfo.label}
                      </span>
                      <span className="text-[9px] font-bold uppercase tracking-widest text-white/30">
                        {(memory.confidence * 100).toFixed(0)}% confidence
                      </span>
                      <span className="text-[9px] text-white/20">
                        importance {(memory.importance * 100).toFixed(0)}%
                      </span>
                      {memory.keywords?.length > 0 && (
                        <div className="flex items-center gap-1">
                          {memory.keywords.slice(0, 4).map(kw => (
                            <span key={kw} className="text-[8px] px-1.5 py-0.5 bg-white/5 rounded-full text-white/20 uppercase">
                              {kw}
                            </span>
                          ))}
                        </div>
                      )}
                      <span className="text-[9px] text-white/20">
                        {memory.sourceInteractionId?.startsWith('behavioral_') ? (
                          <span className="text-celestial-saturn">Behavioral pattern</span>
                        ) : memory.sourceInteractionId?.startsWith('consolidation_') ? (
                          <span className="text-emerald-400">Consolidated</span>
                        ) : memory.sourceInteractionId?.startsWith('self_reflection_') ? (
                          <span className="text-violet-400">Self-reflection</span>
                        ) : memory.sourceInteractionId === 'manual' ? 'Manual entry' : 'Auto-extracted'}
                      </span>
                      <span className="text-[9px] text-white/20">
                        retrieved {memory.retrieveCount || 0}x
                      </span>
                      {memory.parentId && (
                        <span className="text-[8px] text-white/20">consolidated from {memory.parentId}</span>
                      )}
                    </div>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    {/* Protect/unprotect */}
                    <button
                      onClick={() => handleToggleProtect(memory.id)}
                      className={`p-2 rounded-xl transition-colors ${
                        isCore
                          ? 'hover:bg-amber-500/10 text-amber-400'
                          : 'text-white/20 hover:text-white/50 hover:bg-white/5'
                      }`}
                      title={isCore ? 'Remove protection' : 'Protect from decay'}
                    >
                      {isCore ? <Shield size={14} /> : <ShieldOff size={14} />}
                    </button>
                    {/* Tier selector */}
                    <select
                      value={memory.tier || 'episodic'}
                      onChange={e => handleChangeTier(memory.id, e.target.value)}
                      className="bg-white/5 border border-white/10 rounded-lg px-1 py-1 text-[9px] font-bold uppercase appearance-none cursor-pointer text-white/40 hover:text-white/70"
                      onClick={e => e.stopPropagation()}
                    >
                      {TIER_ORDER.map(t => (
                        <option key={t} value={t}>{TIER_LABELS[t].label}</option>
                      ))}
                    </select>
                    <button
                      onClick={() => handleEditStart(memory)}
                      className="p-2 hover:bg-white/10 rounded-xl text-white/30 hover:text-white/70 transition-colors"
                    >
                      <Edit3 size={14} />
                    </button>
                    <button
                      onClick={() => handleDelete(memory.id)}
                      className="p-2 hover:bg-red-500/10 rounded-xl text-white/30 hover:text-red-500 transition-colors"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              </div>
            </div>
            );
          })}
        </div>
      )}

      {/* Reminders Section */}
      {showReminders && (
        <div className="space-y-4 animate-in fade-in slide-in-from-top-2 duration-300">
          <div className="flex items-center gap-3 pt-4 border-t border-white/5">
            <Clock className="text-celestial-saturn" size={20} />
            <h3 className="text-lg font-bold uppercase tracking-tighter text-white/90">Reminders</h3>
            <span className="text-[10px] text-white/20">({reminders.filter((r: any) => r.status === 'pending').length} pending)</span>
          </div>

          <div className="p-4 bg-white/5 rounded-2xl border border-white/5 flex flex-col md:flex-row gap-3">
            <Input
              value={newReminderContent}
              onChange={e => setNewReminderContent(e.target.value)}
              placeholder="Add a reminder..."
              className="flex-1 bg-black/20 border-white/10 rounded-xl py-2 text-sm focus-visible:ring-celestial-saturn/50"
              onKeyDown={e => e.key === 'Enter' && handleAddReminder()}
            />
            <input
              type="datetime-local"
              value={newReminderDueAt}
              onChange={e => setNewReminderDueAt(e.target.value)}
              className="bg-black/20 border border-white/10 rounded-xl px-3 py-2 text-sm text-white/70 outline-none focus:border-celestial-saturn/50"
            />
            <Button
              onClick={handleAddReminder}
              className="bg-celestial-saturn text-black font-bold text-xs px-4 py-2 rounded-xl"
            >
              <Plus size={14} className="mr-1" /> Add
            </Button>
          </div>

          {reminders.length === 0 ? (
            <div className="p-8 bg-white/5 rounded-2xl border border-white/5 text-center">
              <BellOff size={24} className="text-white/20 mx-auto mb-2" />
              <p className="text-white/40 text-xs font-bold uppercase tracking-widest">No reminders yet</p>
              <p className="text-white/20 text-[10px] mt-1">Create one here or let Lumi extract deadlines from conversations.</p>
            </div>
          ) : (
            <div className="space-y-2">
              {reminders.map((reminder: any) => (
                <div
                  key={reminder.id}
                  className={`p-4 rounded-2xl border transition-all ${
                    reminder.status === 'fired'
                      ? 'bg-white/5 border-white/5 opacity-50'
                      : 'bg-celestial-saturn/5 border-celestial-saturn/20'
                  }`}
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex-1 min-w-0">
                      <p className={`text-sm ${reminder.status === 'fired' ? 'text-white/30 line-through' : 'text-white/80'}`}>
                        {reminder.content}
                      </p>
                      <div className="flex items-center gap-3 mt-2">
                        {reminder.dueAt && (
                          <span className="text-[10px] text-white/30 font-mono">
                            Due: {new Date(reminder.dueAt).toLocaleString()}
                          </span>
                        )}
                        <span className={`text-[10px] font-bold uppercase tracking-widest ${reminder.status === 'pending' ? 'text-celestial-saturn' : 'text-white/20'}`}>
                          {reminder.status}
                        </span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {reminder.status !== 'fired' && (
                        <button
                          onClick={() => handleCompleteReminder(reminder.id)}
                          className="p-2 hover:bg-green-500/10 rounded-xl text-white/30 hover:text-green-400 transition-colors"
                          title="Complete"
                        >
                          <Check size={14} />
                        </button>
                      )}
                      <button
                        onClick={() => handleDeleteReminder(reminder.id)}
                        className="p-2 hover:bg-red-500/10 rounded-xl text-white/30 hover:text-red-500 transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

    </div>
  );
}
