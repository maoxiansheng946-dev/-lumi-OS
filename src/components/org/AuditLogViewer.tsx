import React, { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import {
  ScrollText, Search, Download, Filter, Loader2,
  Clock, User, FileText, AlertCircle, CheckCircle,
} from 'lucide-react';
import { useT } from '../../lib/useT';

interface AuditEntry {
  id: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId: string;
  details: string;
  timestamp: string;
}

export function AuditLogViewer() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const [entries, setEntries] = useState<AuditEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ userId: '', action: '', resourceType: '' });
  const [showFilters, setShowFilters] = useState(false);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => {
    loadEntries();
  }, []);

  const loadEntries = useCallback(async (withFilters?: typeof filters) => {
    setLoading(true);
    setFeedback(null);
    try {
      const params = new URLSearchParams();
      params.set('limit', '100');
      if (withFilters) {
        if (withFilters.userId) params.set('userId', withFilters.userId);
        if (withFilters.action) params.set('action', withFilters.action);
        if (withFilters.resourceType) params.set('resourceType', withFilters.resourceType);
      }
      const res = await fetch(`/api/org/audit?${params.toString()}`, { credentials: 'include' });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error((data as any).error || ui(`审计日志加载失败（${res.status}）`, `Audit log load failed (${res.status})`));
      setEntries(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
    } finally { setLoading(false); }
  }, []);

  const handleFilter = () => {
    loadEntries(filters);
  };

  const handleExport = async () => {
    setFeedback(null);
    try {
      const params = new URLSearchParams();
      if (filters.userId) params.set('userId', filters.userId);
      if (filters.action) params.set('action', filters.action);
      if (filters.resourceType) params.set('resourceType', filters.resourceType);
      const res = await fetch(`/api/org/audit/export?${params.toString()}`, { credentials: 'include' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || ui(`审计导出失败（${res.status}）`, `Audit export failed (${res.status})`));
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `audit-export-${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setFeedback({ type: 'success', text: ui('审计 CSV 已导出', 'Audit CSV exported') });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
    }
  };

  const parseDetails = (detailsStr: string): Record<string, any> => {
    try { return JSON.parse(detailsStr); } catch { return {}; }
  };

  const actionColor = (action: string): string => {
    if (action.includes('create') || action.includes('submit') || action.includes('publish')) return 'text-green-400';
    if (action.includes('delete') || action.includes('reject') || action.includes('remove')) return 'text-red-400';
    if (action.includes('update') || action.includes('approve')) return 'text-blue-400';
    if (action.includes('login') || action.includes('register')) return 'text-purple-400';
    return 'text-white/50';
  };

  return (
    <div className="space-y-6 p-6">
      <div className="lumi-panel flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-[0.08em] text-white/90">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-amber-300/15 bg-amber-400/10 text-amber-300">
              <ScrollText size={24} />
            </span>
            {t.orgAudit}
          </h2>
          <p className="mt-1 text-sm text-white/40">{ui(`${entries.length} 条记录`, `${entries.length} entries`)}</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowFilters(!showFilters)}
            className={`lumi-button h-9 text-sm ${showFilters ? 'border-amber-400/25 bg-amber-500/15 text-amber-200' : ''}`}
          >
            <Filter size={14} /> {ui('筛选', 'Filters')}
          </button>
          <button
            onClick={handleExport}
            className="lumi-button h-9 text-sm"
          >
            <Download size={14} /> {ui('导出 CSV', 'Export CSV')}
          </button>
        </div>
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
          feedback.type === 'success'
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/20 bg-red-500/10 text-red-300'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Filter bar */}
      {showFilters && (
        <motion.div
          initial={{ opacity: 0, height: 0 }}
          animate={{ opacity: 1, height: 'auto' }}
          className="lumi-panel flex items-end gap-3 p-4"
        >
          <div className="flex-1">
            <label className="text-white/55 text-xs block mb-1">{ui('用户 ID', 'User ID')}</label>
            <input
              value={filters.userId}
              onChange={e => setFilters(f => ({ ...f, userId: e.target.value }))}
              placeholder={ui('按用户筛选...', 'Filter by user...')}
              className="lumi-field h-10 w-full rounded-lg text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-white/55 text-xs block mb-1">{ui('操作', 'Action')}</label>
            <input
              value={filters.action}
              onChange={e => setFilters(f => ({ ...f, action: e.target.value }))}
              placeholder={ui('例如 template.create...', 'e.g. template.create...')}
              className="lumi-field h-10 w-full rounded-lg text-sm"
            />
          </div>
          <div className="flex-1">
            <label className="text-white/55 text-xs block mb-1">{ui('资源类型', 'Resource Type')}</label>
            <input
              value={filters.resourceType}
              onChange={e => setFilters(f => ({ ...f, resourceType: e.target.value }))}
              placeholder={ui('例如 agent_template...', 'e.g. agent_template...')}
              className="lumi-field h-10 w-full rounded-lg text-sm"
            />
          </div>
          <button onClick={handleFilter} className="lumi-button-primary h-10 border-amber-400/25 bg-amber-500/15 text-amber-200 hover:bg-amber-500/25">
            <Search size={14} /> {ui('搜索', 'Search')}
          </button>
        </motion.div>
      )}

      {/* Entries */}
      {loading ? (
        <div className="lumi-panel py-12 text-center text-white/55"><Loader2 size={24} className="mx-auto animate-spin" /></div>
      ) : entries.length === 0 ? (
        <div className="lumi-panel py-12 text-center text-white/55">
          <ScrollText size={32} className="mx-auto mb-2 opacity-30" />
          {ui('未找到审计记录', 'No audit entries found')}
        </div>
      ) : (
        <div className="space-y-1">
          {entries.map(entry => {
            const details = parseDetails(entry.details);
            return (
              <div
                key={entry.id}
                className="lumi-panel flex items-center gap-4 rounded-xl px-4 py-3 transition-colors hover:border-white/15 hover:bg-white/[0.07]"
              >
                <Clock size={12} className="text-white/45 flex-shrink-0" />
                <span className="text-white/45 text-xs font-mono min-w-[140px]">
                  {new Date(entry.timestamp).toLocaleString(isZh ? 'zh-CN' : undefined)}
                </span>
                <span className={`text-xs font-medium min-w-[160px] ${actionColor(entry.action)}`}>
                  {entry.action}
                </span>
                <div className="flex items-center gap-1 text-white/55 text-xs min-w-[120px]">
                  <User size={10} /> {entry.userId.slice(0, 10)}...
                </div>
                <div className="flex items-center gap-1 text-white/55 text-xs min-w-[120px]">
                  <FileText size={10} /> {entry.resourceType}
                </div>
                <span className="text-white/45 text-xs font-mono flex-1 truncate">
                  {Object.keys(details).length > 0 ? JSON.stringify(details).slice(0, 60) : '-'}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
