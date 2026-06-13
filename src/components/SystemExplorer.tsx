import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  Cpu, Scan, HardDrive, Monitor, Calendar, Plus, Trash2, RefreshCw,
  Briefcase, CheckCircle2, Circle, Loader2, ChevronRight, Zap,
} from 'lucide-react';

interface Snapshot {
  hardware?: { cpus?: { model?: string }[]; totalMemoryGB?: number; gpus?: { model?: string }[] };
  software?: { os?: string; installedApps?: string[] };
  filesystem?: { totalUserFiles?: number };
  timestamp?: string;
}

interface ProfessionProfile {
  profession: string; score: number; confidence: string;
}

interface Plan {
  id: string; title: string; description: string; status: string;
  priority: string; source: string; steps?: { id: string; title: string; completed?: boolean }[];
  createdAt?: string;
}

export function SystemExplorer() {
  const [tab, setTab] = useState<'explore' | 'plans'>('explore');
  const [explored, setExplored] = useState(false);
  const [latest, setLatest] = useState<Snapshot | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [profiles, setProfiles] = useState<ProfessionProfile[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);
  const [newPlan, setNewPlan] = useState({ title: '', description: '', priority: 'medium' });
  const [showNewPlan, setShowNewPlan] = useState(false);

  const loadExplore = useCallback(async () => {
    try {
      const [statusRes, historyRes, profRes] = await Promise.all([
        fetch('/api/explore/status'),
        fetch('/api/explore/history'),
        fetch('/api/explore/profession'),
      ]);
      const s = await statusRes.json();
      const h = await historyRes.json();
      const p = await profRes.json();
      setExplored(s.explored);
      setLatest(s.latest);
      setHistory(h.snapshots || []);
      setProfiles(p.profiles || []);
    } catch {} finally { setLoading(false); }
  }, []);

  const loadPlans = useCallback(async () => {
    try {
      const res = await fetch('/api/plans');
      const d = await res.json();
      setPlans(d.plans || []);
    } catch {}
  }, []);

  useEffect(() => { loadExplore(); loadPlans(); }, [loadExplore, loadPlans]);

  const doScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/explore/scan', { method: 'POST', credentials: 'include' });
      const d = await res.json();
      if (d.snapshot) {
        setLatest(d.snapshot);
        setHistory(prev => [d.snapshot, ...prev]);
      }
    } catch {} finally { setScanning(false); }
  };

  const createPlan = async () => {
    if (!newPlan.title.trim()) return;
    try {
      const res = await fetch('/api/plans', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...newPlan, steps: [], tags: [], source: 'manual' }),
        credentials: 'include',
      });
      if (res.ok) {
        const d = await res.json();
        setPlans(prev => [d.plan, ...prev]);
        setNewPlan({ title: '', description: '', priority: 'medium' });
        setShowNewPlan(false);
      }
    } catch {}
  };

  const deletePlan = async (id: string) => {
    try {
      await fetch(`/api/plans/${id}`, { method: 'DELETE', credentials: 'include' });
      setPlans(prev => prev.filter(p => p.id !== id));
    } catch {}
  };

  const installProfession = async () => {
    try {
      await fetch('/api/explore/profession/install', { method: 'POST', credentials: 'include' });
    } catch {}
  };

  if (loading) return <div className="p-6 text-white/40">Loading...</div>;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      <div className="flex items-center gap-2">
        <button
          onClick={() => setTab('explore')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'explore' ? 'bg-blue-500/20 text-blue-400' : 'text-white/40 hover:text-white/60'}`}
        >
          系统探索
        </button>
        <button
          onClick={() => setTab('plans')}
          className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${tab === 'plans' ? 'bg-blue-500/20 text-blue-400' : 'text-white/40 hover:text-white/60'}`}
        >
          <Calendar size={14} className="inline mr-1" />计划
        </button>
      </div>

      {tab === 'explore' && (
        <div className="space-y-6">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2"><Cpu size={20} className="text-blue-400" />系统状态</h2>
            <button
              onClick={doScan}
              disabled={scanning}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-sm transition-colors flex items-center gap-2"
            >
              <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
              {scanning ? '扫描中...' : '立即扫描'}
            </button>
          </div>

          {latest && (
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center gap-2 text-white/60 text-xs mb-2"><HardDrive size={14} />硬件</div>
                <p className="text-white text-sm">{latest.hardware?.cpus?.[0]?.model || '未知 CPU'} · {latest.hardware?.totalMemoryGB || '?'} GB RAM</p>
                <p className="text-white/40 text-xs mt-1">{latest.hardware?.gpus?.map(g => g.model).join(', ') || '无 GPU'}</p>
              </div>
              <div className="bg-white/5 border border-white/10 rounded-xl p-4">
                <div className="flex items-center gap-2 text-white/60 text-xs mb-2"><Monitor size={14} />软件</div>
                <p className="text-white text-sm">{latest.software?.os || '未知 OS'}</p>
                <p className="text-white/40 text-xs mt-1">{latest.software?.installedApps?.length || 0} 个已安装应用</p>
              </div>
            </div>
          )}

          {profiles.length > 0 && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2 text-white/80 text-sm font-medium"><Briefcase size={16} className="text-amber-400" />检测到的专业领域</div>
                <button onClick={installProfession} className="px-3 py-1.5 text-xs bg-amber-500/20 text-amber-400 rounded-lg hover:bg-amber-500/30 transition-colors">安装专业代理</button>
              </div>
              <div className="space-y-2">
                {profiles.map(p => (
                  <div key={p.profession} className="flex items-center justify-between">
                    <span className="text-white text-sm">{p.profession}</span>
                    <span className="text-white/40 text-xs">{Math.round(p.score * 100)}% 置信度</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {history.length > 0 && (
            <div>
              <h3 className="text-white/60 text-xs mb-2 flex items-center gap-1"><Scan size={12} />扫描历史 (最近 {history.length} 次)</h3>
              <div className="space-y-1">
                {history.slice(0, 10).map((s, i) => (
                  <div key={i} className="text-white/35 text-xs">{s.timestamp ? new Date(s.timestamp).toLocaleString() : `#${history.length - i}`} — {s.hardware?.cpus?.[0]?.model || 'N/A'}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'plans' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-bold text-white flex items-center gap-2"><Calendar size={20} className="text-green-400" />计划列表</h2>
            <button onClick={() => setShowNewPlan(!showNewPlan)} className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm transition-colors flex items-center gap-1">
              <Plus size={14} /> 新建
            </button>
          </div>

          {showNewPlan && (
            <div className="bg-white/5 border border-white/10 rounded-xl p-4 space-y-3">
              <input value={newPlan.title} onChange={e => setNewPlan(p => ({ ...p, title: e.target.value }))} placeholder="计划标题" className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 text-sm" />
              <textarea value={newPlan.description} onChange={e => setNewPlan(p => ({ ...p, description: e.target.value }))} placeholder="描述" rows={2} className="w-full px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 text-sm resize-none" />
              <div className="flex gap-2">
                <select value={newPlan.priority} onChange={e => setNewPlan(p => ({ ...p, priority: e.target.value }))} className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm">
                  <option value="low">低优先级</option>
                  <option value="medium">中优先级</option>
                  <option value="high">高优先级</option>
                </select>
                <button onClick={createPlan} disabled={!newPlan.title.trim()} className="px-4 py-2 bg-green-600 hover:bg-green-500 disabled:opacity-40 text-white rounded-lg text-sm">创建</button>
              </div>
            </div>
          )}

          {plans.length === 0 && <div className="text-white/30 text-center py-12">暂无计划 — 点击"新建"创建第一个</div>}

          <div className="space-y-2">
            {plans.map(plan => (
              <div key={plan.id} className="bg-white/5 border border-white/10 rounded-xl p-4 flex items-center justify-between group">
                <div className="flex-1">
                  <div className="flex items-center gap-2">
                    {plan.status === 'done' ? <CheckCircle2 size={16} className="text-green-400" /> : <Circle size={16} className="text-white/30" />}
                    <span className="text-white text-sm font-medium">{plan.title}</span>
                    <span className={`text-xs px-1.5 py-0.5 rounded ${plan.priority === 'high' ? 'bg-red-500/20 text-red-400' : plan.priority === 'medium' ? 'bg-amber-500/20 text-amber-400' : 'bg-white/10 text-white/40'}`}>{plan.priority}</span>
                  </div>
                  {plan.description && <p className="text-white/40 text-xs mt-1">{plan.description}</p>}
                  {plan.steps && plan.steps.length > 0 && (
                    <div className="flex items-center gap-1 mt-1 text-white/30 text-xs">
                      <Zap size={10} /> {plan.steps.filter(s => s.completed).length}/{plan.steps.length} 步骤
                    </div>
                  )}
                </div>
                <button onClick={() => deletePlan(plan.id)} className="opacity-0 group-hover:opacity-100 p-2 text-white/30 hover:text-red-400 transition-all"><Trash2 size={14} /></button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
