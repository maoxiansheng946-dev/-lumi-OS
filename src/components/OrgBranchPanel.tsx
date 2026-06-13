import React, { useState, useEffect } from 'react';
import { GitBranch, Link, Unlink, RefreshCw, CheckCircle2, XCircle } from 'lucide-react';

interface BranchState {
  connected: boolean; orgId?: string; orgName?: string;
  lastSync?: string; status?: string;
}

export function OrgBranchPanel() {
  const [state, setState] = useState<BranchState>({ connected: false });
  const [loading, setLoading] = useState(true);
  const [orgCode, setOrgCode] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [syncing, setSyncing] = useState(false);

  useEffect(() => { loadState(); }, []);

  const loadState = async () => {
    try {
      const res = await fetch('/api/branch/state', { credentials: 'include' });
      if (res.ok) setState(await res.json());
    } catch {} finally { setLoading(false); }
  };

  const connect = async () => {
    if (!orgCode.trim()) return;
    setConnecting(true);
    try {
      const res = await fetch('/api/branch/connect', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code: orgCode }), credentials: 'include',
      });
      if (res.ok) {
        const d = await res.json();
        setState(d);
        setOrgCode('');
      }
    } catch {} finally { setConnecting(false); }
  };

  const disconnect = async () => {
    try {
      await fetch('/api/branch/disconnect', { method: 'POST', credentials: 'include' });
      setState({ connected: false });
    } catch {}
  };

  const sync = async () => {
    setSyncing(true);
    try {
      const res = await fetch('/api/branch/sync', { method: 'POST', credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        setState(d);
      }
    } catch {} finally { setSyncing(false); }
  };

  if (loading) return <div className="p-6 text-white/40">Loading...</div>;

  return (
    <div className="p-6 max-w-lg mx-auto space-y-6">
      <h2 className="text-lg font-bold text-white flex items-center gap-2"><GitBranch size={20} className="text-purple-400" />分支终端</h2>

      <div className="bg-white/5 border border-white/10 rounded-xl p-4">
        <div className="flex items-center gap-2">
          {state.connected ? (
            <>
              <CheckCircle2 size={16} className="text-green-400" />
              <span className="text-white text-sm">已连接到 <span className="text-purple-400">{state.orgName || state.orgId}</span></span>
            </>
          ) : (
            <>
              <XCircle size={16} className="text-white/30" />
              <span className="text-white/40 text-sm">未连接到任何组织</span>
            </>
          )}
        </div>
        {state.lastSync && <p className="text-white/25 text-xs mt-2">上次同步: {new Date(state.lastSync).toLocaleString()}</p>}

        <div className="flex gap-2 mt-4">
          {state.connected ? (
            <>
              <button onClick={sync} disabled={syncing} className="px-4 py-2 bg-purple-600 hover:bg-purple-500 disabled:opacity-40 text-white rounded-lg text-sm flex items-center gap-1">
                <RefreshCw size={14} className={syncing ? 'animate-spin' : ''} /> 同步
              </button>
              <button onClick={disconnect} className="px-4 py-2 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-lg text-sm flex items-center gap-1">
                <Unlink size={14} /> 断开
              </button>
            </>
          ) : (
            <div className="flex w-full gap-2">
              <input
                value={orgCode} onChange={e => setOrgCode(e.target.value)}
                placeholder="输入组织邀请码..."
                className="flex-1 px-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white placeholder:text-white/30 text-sm"
              />
              <button onClick={connect} disabled={!orgCode.trim() || connecting} className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded-lg text-sm flex items-center gap-1 whitespace-nowrap">
                <Link size={14} /> {connecting ? '连接中...' : '连接'}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
