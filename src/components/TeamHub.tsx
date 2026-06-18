import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Bot, ExternalLink, Trash2, Power, PowerOff, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

export function TeamHub({ t }: { t?: any }) {
  const [agents, setAgents] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [showConnectForm, setShowConnectForm] = useState(false);
  const [connectName, setConnectName] = useState('');
  const [connectCategory, setConnectCategory] = useState('general');
  const [connectSkillTags, setConnectSkillTags] = useState('');
  const [connectCommand, setConnectCommand] = useState('');
  const [connecting, setConnecting] = useState(false);
  const loadAgentsFailedText = t?.loadAgentsFailed || 'Failed to load agents';

  const fetchAgents = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const res = await fetch('/api/agents', { credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || loadAgentsFailedText);
      setAgents(Array.isArray(data) ? data : data.agents || []);
    } catch (err: any) {
      const message = err?.message || loadAgentsFailedText;
      setLoadError(message);
      toast.error(message);
    }
    setLoading(false);
  }, [loadAgentsFailedText]);

  useEffect(() => { fetchAgents(); }, [fetchAgents]);

  const handleConnectExternal = async () => {
    if (!connectName.trim() || !connectCommand.trim()) return;
    setConnecting(true);
    try {
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: connectName.trim(),
          category: connectCategory,
          skillTags: connectSkillTags ? connectSkillTags.split(',').map((s: string) => s.trim()) : [],
          runtime: 'external',
          externalCommand: connectCommand.trim(),
          executionMode: 'sequential',
          territory: 'open',
        }),
        credentials: 'include',
      });
      if (res.ok) {
        toast.success(t?.agentConnected || 'External agent connected');
        setShowConnectForm(false);
        setConnectName('');
        setConnectCommand('');
        fetchAgents();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t?.connectFailed || 'Connection failed');
      }
    } catch (err: any) {
      toast.error(err.message || t?.connectFailed || 'Connection failed');
    }
    setConnecting(false);
  };

  const handleDelete = async (id: string) => {
    try {
      const res = await fetch(`/api/agents/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) {
        setAgents(prev => prev.filter(a => a.id !== id));
        toast.success(t?.agentRemoved || 'Agent removed');
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t?.removeFailed || 'Failed to remove');
      }
    } catch (err: any) {
      toast.error(err.message || t?.removeFailed || 'Failed to remove');
    }
  };

  const handleToggle = async (agent: any) => {
    const nextFrozen = !(agent.isFrozen ?? false);
    try {
      const res = await fetch(`/api/agents/${agent.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFrozen: nextFrozen }),
        credentials: 'include',
      });
      if (res.ok) {
        setAgents(prev => prev.map(a => a.id === agent.id ? { ...a, isFrozen: nextFrozen } : a));
        toast.info(nextFrozen ? (t?.agentFrozen || 'Agent frozen') : (t?.agentActivated || 'Agent activated'));
      }
    } catch (err: any) {
      toast.error(err.message || t?.toggleFailed || 'Toggle failed');
    }
  };

  const internalAgents = agents.filter(a => a.runtime !== 'external');
  const externalAgents = agents.filter(a => a.runtime === 'external');

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="lumi-panel flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-[0.08em] text-white/90">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-cyan-300/15 bg-cyan-400/10 text-cyan-300">
              <Users size={20} />
            </span>
            {t?.teamHub || 'Agent Team'}
          </h2>
          <p className="text-sm text-white/40 max-w-xl mt-1">
            {t?.teamDesc || "Lumi's team of agents. Each member has their own skills — Lumi can dispatch tasks through the orchestrator."}
          </p>
        </div>
        <button
          onClick={() => setShowConnectForm(!showConnectForm)}
          className="lumi-button-primary shrink-0 border-cyan-400/25 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
        >
          <ExternalLink size={12} />
          {t?.connectExternal || 'Connect External Agent'}
        </button>
      </div>

      <AnimatePresence>
        {showConnectForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="lumi-panel space-y-4 border-cyan-500/15 bg-cyan-500/5 p-5">
              <p className="text-xs text-cyan-400/70">{t?.connectExternalDesc || 'Link an AI agent running on your machine or cloud.'}</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <input value={connectName} onChange={e => setConnectName(e.target.value)}
                  placeholder={t?.agentName || 'Agent Name'} className="lumi-field py-2 text-xs" />
                <select value={connectCategory} onChange={e => setConnectCategory(e.target.value)}
                  className="lumi-field py-2 text-xs text-white/80">
                  {['general','code','content','analysis','search','automation','assistant','media'].map(c => (
                    <option key={c} value={c} className="bg-gray-900">{c}</option>
                  ))}
                </select>
                <input value={connectSkillTags} onChange={e => setConnectSkillTags(e.target.value)}
                  placeholder={t?.agentSkillTags || 'Skill Tags (comma separated)'} className="lumi-field py-2 text-xs" />
                <input value={connectCommand} onChange={e => setConnectCommand(e.target.value)}
                  placeholder={t?.agentCommandHint || 'openclaw send --task "{task}"'} className="lumi-field py-2 font-mono text-xs" />
              </div>
              <div className="flex gap-2">
                <button onClick={handleConnectExternal}
                  disabled={connecting || !connectName.trim() || !connectCommand.trim()}
                  className="lumi-button-primary h-9 border-cyan-300/25 bg-cyan-300/90 px-4 text-xs text-slate-950 hover:bg-cyan-200">
                  {connecting ? (t?.connectingBtn || 'Connecting...') : (t?.connectBtn || 'Connect')}
                </button>
                <button onClick={() => setShowConnectForm(false)}
                  className="lumi-button h-9 px-4 text-xs">
                  {t?.cancel || 'Cancel'}
                </button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {loading ? (
        <div className="lumi-panel p-16 text-center">
          <Loader2 size={32} className="text-white/40 mx-auto mb-4 animate-spin" />
          <p className="text-white/40 text-sm">{t?.loading || 'Loading...'}</p>
        </div>
      ) : loadError ? (
        <div className="lumi-panel border-red-400/15 bg-red-500/5 p-8 text-center">
          <p className="text-sm text-red-200/80">{loadError}</p>
          <button onClick={() => void fetchAgents()} className="lumi-button mt-4">{t?.retry || 'Retry'}</button>
        </div>
      ) : agents.length === 0 ? (
        <div className="lumi-panel p-16 text-center">
          <Users size={40} className="text-white/45 mx-auto mb-4" />
          <p className="text-white/40 font-bold uppercase tracking-widest text-sm">{t?.noTeamMembers || 'No team members yet'}</p>
          <p className="text-white/45 text-xs mt-2">{t?.teamCreateHint || 'Use agent_create in chat to add a teammate.'}</p>
        </div>
      ) : (
        <>
          {/* Internal Agents */}
          {internalAgents.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-white/50">{t?.internalAgents || 'Internal Agents'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AnimatePresence>
                  {internalAgents.map((agent: any) => (
                    <motion.div
                      key={agent.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="lumi-panel space-y-3 p-5 transition-colors hover:border-white/15 hover:bg-white/[0.06]"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/15 bg-cyan-500/10">
                            <Bot size={16} className="text-cyan-400" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white">{agent.name}</h4>
                            <span className="text-[11px] text-white/40 uppercase">{agent.category || 'general'}</span>
                          </div>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggle(agent)}
                            className={`rounded-lg p-1.5 transition-all ${agent.isFrozen ? 'bg-white/5 text-white/30 hover:text-white/50' : 'bg-green-500/10 text-green-400'}`}
                            title={agent.isFrozen ? (t?.activate || 'Activate') : (t?.freeze || 'Freeze')}
                          >
                            {agent.isFrozen ? <Power size={14} /> : <PowerOff size={14} />}
                          </button>
                          <button
                            onClick={() => handleDelete(agent.id)}
                            className="rounded-lg p-1.5 text-white/30 transition-all hover:bg-red-500/10 hover:text-red-400"
                            title={t?.remove || 'Remove'}
                          >
                            <Trash2 size={14} />
                          </button>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 text-xs text-white/40">
                        <span className={`w-1.5 h-1.5 rounded-full ${agent.isFrozen ? 'bg-white/20' : 'bg-green-400 animate-pulse'}`} />
                        {agent.isFrozen ? (t?.frozen || 'Frozen') : (t?.active || 'Active')}
                        {agent.memoryScope === 'private' && (
                          <span className="px-1.5 py-0.5 bg-purple-500/10 text-purple-400 rounded text-[10px]">{t?.sanctuary || 'Sanctuary'}</span>
                        )}
                      </div>
                      {(agent.skillTags || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {agent.skillTags.map((t: string) => (
                            <span key={t} className="px-1.5 py-0.5 bg-white/5 rounded text-[10px] text-white/40 uppercase">{t}</span>
                          ))}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}

          {/* External Agents */}
          {externalAgents.length > 0 && (
            <div className="space-y-3">
              <h3 className="text-xs font-black uppercase tracking-widest text-white/50">{t?.externalAgents || 'External Agents'}</h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <AnimatePresence>
                  {externalAgents.map((agent: any) => (
                    <motion.div
                      key={agent.id}
                      initial={{ opacity: 0, y: 10 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: -10 }}
                      className="lumi-panel space-y-3 border-cyan-500/15 bg-cyan-500/5 p-5 transition-colors hover:border-cyan-500/30"
                    >
                      <div className="flex items-start justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-cyan-300/15 bg-cyan-500/10">
                            <ExternalLink size={16} className="text-cyan-400" />
                          </div>
                          <div>
                            <h4 className="text-sm font-bold text-white">{agent.name}</h4>
                            <span className="text-[11px] text-cyan-400/70">{agent.category || 'external'}</span>
                          </div>
                        </div>
                        <button
                          onClick={() => handleDelete(agent.id)}
                          className="rounded-lg p-1.5 text-white/30 transition-all hover:bg-red-500/10 hover:text-red-400"
                          title={t?.remove || 'Remove'}
                        >
                          <Trash2 size={14} />
                        </button>
                      </div>
                      {agent.externalCommand && (
                        <div className="p-2 bg-black/40 rounded-lg text-xs font-mono text-white/40 truncate">
                          {agent.externalCommand}
                        </div>
                      )}
                    </motion.div>
                  ))}
                </AnimatePresence>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
