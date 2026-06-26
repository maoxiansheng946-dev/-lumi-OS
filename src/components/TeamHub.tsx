import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Users, Bot, ExternalLink, Trash2, Power, PowerOff, Loader2, RefreshCw, CheckCircle2, AlertTriangle, Clock3 } from 'lucide-react';
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
  const [testingIds, setTestingIds] = useState<string[]>([]);
  const loadAgentsFailedText = t?.loadAgentsFailed || 'Failed to load agents';
  const isZh = t?.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);

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
        const created = await res.json().catch(() => null);
        toast.success(t?.agentConnected || 'External agent connected');
        setShowConnectForm(false);
        setConnectName('');
        setConnectCommand('');
        setConnectSkillTags('');
        if (created?.id) setAgents(prev => [created, ...prev.filter(a => a.id !== created.id)]);
        else fetchAgents();
      } else {
        const err = await res.json().catch(() => ({}));
        toast.error(err.error || t?.connectFailed || 'Connection failed');
      }
    } catch (err: any) {
      toast.error(err.message || t?.connectFailed || 'Connection failed');
    }
    setConnecting(false);
  };

  const handleTestConnection = async (agent: any) => {
    setTestingIds(prev => prev.includes(agent.id) ? prev : [...prev, agent.id]);
    try {
      const res = await fetch(`/api/agents/${agent.id}/test`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task: `Lumi health check for ${agent.name || 'external agent'}. Reply briefly.` }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Connection test failed');
      if (data.agent) setAgents(prev => prev.map(a => a.id === agent.id ? data.agent : a));
      if (data.ok) toast.success(ui('外部 agent 连接正常', 'External agent is reachable'));
      else toast.error(data.result?.output || ui('外部 agent 测试失败', 'External agent test failed'));
    } catch (err: any) {
      toast.error(err.message || ui('外部 agent 测试失败', 'External agent test failed'));
    } finally {
      setTestingIds(prev => prev.filter(id => id !== agent.id));
    }
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
  const readyExternalCount = externalAgents.filter(agent => agent.healthStatus === 'online' && agent.isFrozen !== true).length;

  const healthMeta = (agent: any) => {
    if (agent.healthStatus === 'online') return { icon: <CheckCircle2 size={13} />, label: ui('可用', 'Online'), className: 'border-emerald-400/15 bg-emerald-500/10 text-emerald-300' };
    if (agent.healthStatus === 'error') return { icon: <AlertTriangle size={13} />, label: ui('异常', 'Error'), className: 'border-red-400/15 bg-red-500/10 text-red-200' };
    return { icon: <Clock3 size={13} />, label: ui('未测试', 'Untested'), className: 'border-white/10 bg-white/[0.04] text-white/45' };
  };

  const formatTime = (value?: string) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return '';
    return date.toLocaleString(isZh ? 'zh-CN' : 'en-US', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
  };

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
            {ui('Lumi 的工作团队。内部 agent 可直接调度，外部 agent 通过本机 CLI 连接，先测试健康状态再交给 orchestrator。', "Lumi's working team. Internal agents are dispatched directly; external agents connect through local CLI commands and should pass a health test before orchestration.")}
          </p>
          <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-bold text-white/35">
            <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1">
              {ui(`内部 ${internalAgents.length}`, `${internalAgents.length} internal`)}
            </span>
            <span className="rounded-full border border-cyan-300/15 bg-cyan-500/10 px-2 py-1 text-cyan-200/60">
              {ui(`外部就绪 ${readyExternalCount}/${externalAgents.length}`, `${readyExternalCount}/${externalAgents.length} external ready`)}
            </span>
          </div>
        </div>
        <button
          onClick={() => setShowConnectForm(!showConnectForm)}
          className="lumi-button-primary shrink-0 border-cyan-400/25 bg-cyan-500/15 text-cyan-300 hover:bg-cyan-500/25"
        >
          <ExternalLink size={12} />
          {t?.connectExternal || ui('连接外部 Agent', 'Connect External Agent')}
        </button>
      </div>

      <AnimatePresence>
        {showConnectForm && (
          <motion.div initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }} className="overflow-hidden">
            <div className="lumi-panel space-y-4 border-cyan-500/15 bg-cyan-500/5 p-5">
              <p className="text-xs text-cyan-400/70">{ui('连接一个可通过本机命令调用的外部 agent。命令必须包含 {task}，保存后可以立即测试健康状态。', 'Connect an external agent callable from a local command. The command must include {task}; test health after saving.')}</p>
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
                  placeholder={t?.agentSkillTags || ui('能力标签，用逗号分隔，如 analysis, code', 'Skill tags, comma separated, e.g. analysis, code')} className="lumi-field py-2 text-xs" />
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
                        <div className="flex items-center gap-1">
                          <button
                            onClick={() => handleToggle(agent)}
                            className={`rounded-lg p-1.5 transition-all ${agent.isFrozen ? 'bg-white/5 text-white/30 hover:text-white/50' : 'bg-green-500/10 text-green-400'}`}
                            title={agent.isFrozen ? (t?.activate || 'Activate') : (t?.freeze || 'Freeze')}
                          >
                            {agent.isFrozen ? <Power size={14} /> : <PowerOff size={14} />}
                          </button>
                          <button
                            onClick={() => void handleTestConnection(agent)}
                            disabled={testingIds.includes(agent.id)}
                            className="rounded-lg p-1.5 text-cyan-300/65 transition-all hover:bg-cyan-500/10 hover:text-cyan-100 disabled:opacity-30"
                            title={ui('测试连接', 'Test connection')}
                          >
                            <RefreshCw size={14} className={testingIds.includes(agent.id) ? 'animate-spin' : ''} />
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
                      <div className="flex flex-wrap items-center gap-2">
                        {(() => {
                          const meta = healthMeta(agent);
                          return (
                            <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-1 text-[11px] font-bold ${meta.className}`}>
                              {meta.icon}
                              {meta.label}
                            </span>
                          );
                        })()}
                        {agent.lastRunDurationMs != null && (
                          <span className="rounded-full border border-white/[0.08] bg-white/[0.03] px-2 py-1 text-[11px] font-mono text-white/35">
                            {agent.lastRunDurationMs}ms
                          </span>
                        )}
                        {agent.lastHealthCheckAt && (
                          <span className="text-[11px] text-white/30">
                            {formatTime(agent.lastHealthCheckAt)}
                          </span>
                        )}
                      </div>
                      {(agent.skillTags || []).length > 0 && (
                        <div className="flex flex-wrap gap-1">
                          {agent.skillTags.map((tag: string) => (
                            <span key={tag} className="rounded bg-cyan-500/10 px-1.5 py-0.5 text-[10px] uppercase text-cyan-300/55">{tag}</span>
                          ))}
                        </div>
                      )}
                      {agent.healthStatus !== 'online' && (
                        <div className="rounded-lg border border-amber-300/10 bg-amber-500/5 px-3 py-2 text-xs text-amber-100/55">
                          {agent.healthStatus === 'error'
                            ? ui('上次测试失败。修复命令并重新测试前，不会参与调度。', 'Last test failed. It will not be scheduled until the command is fixed and tested again.')
                            : ui('尚未测试。测试通过后才会参与任务调度。', 'Untested. It will only join orchestration after a successful health test.')}
                        </div>
                      )}
                      {agent.externalCommand && (
                        <div className="p-2 bg-black/40 rounded-lg text-xs font-mono text-white/40 truncate">
                          {agent.externalCommand}
                        </div>
                      )}
                      {agent.lastRunOutput && (
                        <div className="max-h-20 overflow-hidden rounded-lg border border-white/[0.06] bg-black/25 p-2 text-xs leading-relaxed text-white/42">
                          {agent.lastRunOutput}
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
