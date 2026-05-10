import React, { useState, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Zap, TrendingUp, Clock, Layers, RefreshCw } from 'lucide-react';

interface ProviderStats {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  calls: number;
}

interface DailyStats {
  date: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

interface UsageData {
  byProvider: Record<string, ProviderStats>;
  daily: DailyStats[];
  grandTotal: number;
  days: number;
  recordCount: number;
}

const PROVIDER_LABELS: Record<string, string> = {
  deepseek: 'DeepSeek',
  qwen: 'Qwen',
  openai: 'OpenAI',
  gemini: 'Gemini',
  anthropic: 'Anthropic',
};

const PROVIDER_COLORS: Record<string, string> = {
  deepseek: '#6366f1',
  qwen: '#06b6d4',
  openai: '#10b981',
  gemini: '#8b5cf6',
  anthropic: '#f59e0b',
};

function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

export const TokenDashboard: React.FC = () => {
  const [data, setData] = useState<UsageData | null>(null);
  const [loading, setLoading] = useState(true);
  const [days, setDays] = useState(30);
  const [error, setError] = useState<string | null>(null);

  const fetchUsage = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/llm/usage?days=${days}`, { credentials: 'include' });
      if (!resp.ok) throw new Error(resp.status === 401 ? 'Login required' : `HTTP ${resp.status}`);
      const res = await resp.json();
      setData(res);
    } catch (err: any) {
      setError(err.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { fetchUsage(); }, [fetchUsage]);

  const providers = data?.byProvider ? Object.entries(data.byProvider) : [];
  const maxDaily = data?.daily?.length ? Math.max(...data.daily.map(d => d.totalTokens), 1) : 1;

  // Donut ring data
  const total = providers.reduce((sum, [, s]) => sum + s.totalTokens, 0);
  let cumulative = 0;
  const segments = providers.map(([p, s]) => {
    const start = cumulative;
    const frac = total > 0 ? s.totalTokens / total : 0;
    cumulative += frac;
    return { provider: p, stats: s, start, frac, color: PROVIDER_COLORS[p] || '#888' };
  });
  const circumference = 2 * Math.PI * 36;

  return (
    <div className="h-full flex flex-col text-white">
      {/* Header */}
      <div className="flex items-center justify-between mb-5">
        <div className="flex items-center gap-2.5">
          <div className="w-8 h-8 rounded-xl bg-amber-500/10 border border-amber-500/20 flex items-center justify-center">
            <Zap size={16} className="text-amber-400" />
          </div>
          <div>
            <h2 className="text-base font-black tracking-tight">Token Usage</h2>
            <p className="text-[10px] text-white/25 font-medium">LLM API consumption</p>
          </div>
        </div>
        <div className="flex items-center gap-1.5 bg-white/5 rounded-xl p-1">
          {[7, 30, 90].map(d => (
            <button
              key={d}
              onClick={() => setDays(d)}
              className={`px-2.5 py-1 rounded-lg text-[10px] font-bold uppercase tracking-wider transition-all ${
                days === d ? 'bg-white/15 text-white' : 'text-white/30 hover:text-white/50'
              }`}
            >
              {d}d
            </button>
          ))}
          <button onClick={fetchUsage} className="p-1.5 rounded-lg hover:bg-white/5 text-white/30 hover:text-white/60 transition-all">
            <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
          </button>
        </div>
      </div>

      {loading && !data ? (
        <div className="flex-1 flex items-center justify-center">
          <RefreshCw size={20} className="text-white/20 animate-spin" />
        </div>
      ) : error && !data ? (
        <div className="flex-1 flex items-center justify-center">
          <p className="text-red-400 text-xs">{error}</p>
        </div>
      ) : (
        <div className="flex-1 flex flex-col gap-3 overflow-auto custom-scrollbar pr-1">
          {/* Grand total */}
          <motion.div
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            className="rounded-2xl bg-white/5 border border-white/5 p-4 flex items-center justify-between"
          >
            <div className="flex items-center gap-2.5">
              <TrendingUp size={16} className="text-amber-400/70" />
              <span className="text-[10px] font-bold text-white/30 uppercase tracking-widest">Total</span>
            </div>
            <div className="text-right">
              <span className="text-xl font-black tracking-tight">{formatTokens(data?.grandTotal || 0)}</span>
              <span className="text-[10px] text-white/20 ml-1">{data?.recordCount || 0} calls</span>
            </div>
          </motion.div>

          {/* Provider breakdown */}
          <div className="rounded-2xl bg-white/5 border border-white/5 p-4">
            <h3 className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Layers size={10} /> Providers
            </h3>
            {providers.length === 0 ? (
              <p className="text-white/20 text-xs py-4 text-center">No usage data yet.</p>
            ) : (
              <div className="flex items-center gap-4">
                {/* Ring chart */}
                <svg width="90" height="90" viewBox="0 0 90 90" className="shrink-0">
                  {segments.map(seg => {
                    const dashArray = seg.frac * circumference;
                    const dashOffset = -seg.start * circumference;
                    return (
                      <circle
                        key={seg.provider}
                        r="36" cx="45" cy="45"
                        fill="none"
                        stroke={seg.color}
                        strokeWidth="10"
                        strokeDasharray={`${dashArray} ${circumference - dashArray}`}
                        strokeDashoffset={dashOffset}
                        strokeLinecap="round"
                        className="opacity-80"
                        transform="rotate(-90 45 45)"
                      />
                    );
                  })}
                  <text x="45" y="43" textAnchor="middle" className="text-[14px] font-black" fill="white">
                    {formatTokens(total)}
                  </text>
                  <text x="45" y="56" textAnchor="middle" className="text-[8px] font-bold" fill="rgba(255,255,255,0.25)">
                    TOTAL
                  </text>
                </svg>

                {/* Legend */}
                <div className="flex-1 space-y-1.5 min-w-0">
                  {providers.map(([provider, stats]) => (
                    <div key={provider} className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-1.5 min-w-0">
                        <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: PROVIDER_COLORS[provider] || '#888' }} />
                        <span className="text-[10px] font-bold text-white/60 truncate">{PROVIDER_LABELS[provider] || provider}</span>
                      </div>
                      <span className="text-[10px] text-white/30 font-mono shrink-0">
                        {formatTokens(stats.totalTokens)} / {stats.calls}
                      </span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Daily trend */}
          <div className="flex-1 rounded-2xl bg-white/5 border border-white/5 p-4">
            <h3 className="text-[10px] font-bold text-white/25 uppercase tracking-widest mb-3 flex items-center gap-1.5">
              <Clock size={10} /> Daily
            </h3>
            {!data?.daily || data.daily.length === 0 ? (
              <p className="text-white/20 text-xs py-4 text-center">No daily data.</p>
            ) : (
              <div className="flex items-end gap-0.5 h-28">
                <AnimatePresence>
                  {data.daily.map((d, i) => {
                    const h = (d.totalTokens / maxDaily) * 100;
                    return (
                      <motion.div
                        key={d.date}
                        initial={{ height: 0 }}
                        animate={{ height: `${Math.max(h, 1)}%` }}
                        transition={{ delay: i * 0.01, type: 'spring', stiffness: 300, damping: 20 }}
                        className="flex-1 rounded-t-[2px] bg-amber-500/25 hover:bg-amber-400/50 transition-colors min-h-[2px] relative group"
                      >
                        <div className="absolute -top-8 left-1/2 -translate-x-1/2 px-1.5 py-0.5 bg-black/90 rounded text-[9px] font-mono text-white/60 opacity-0 group-hover:opacity-100 pointer-events-none whitespace-nowrap transition-opacity z-10">
                          {formatTokens(d.totalTokens)}
                        </div>
                      </motion.div>
                    );
                  })}
                </AnimatePresence>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
};
