import { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { UserIcon, BrainCircuit, TrendingUp, Activity, Calendar, Loader2, Sparkles, Clock, GitBranch } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';

interface PersonalityStats {
  totalMemories: number;
  byType: Record<string, number>;
  avgConfidence: Record<string, number>;
  monthlyTrend: { month: string; count: number }[];
  totalInteractions: number;
  personalityId: string;
}

const TYPE_LABELS: Record<string, string> = {
  preference: 'Preferences',
  fact: 'Facts',
  habit: 'Habits',
  knowledge: 'Knowledge',
};

const TYPE_COLORS: Record<string, string> = {
  preference: 'bg-violet-500',
  fact: 'bg-blue-500',
  habit: 'bg-amber-500',
  knowledge: 'bg-emerald-500',
};

export function PersonalityDashboard() {
  const { personalityId } = useApp();
  const [stats, setStats] = useState<PersonalityStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/personality/stats?personalityId=${personalityId}`)
      .then(r => r.json())
      .then(data => setStats(data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [personalityId]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950/60">
        <Loader2 size={24} className="animate-spin text-white/30" />
      </div>
    );
  }

  if (!stats) return null;

  const maxMonthCount = Math.max(1, ...stats.monthlyTrend.map(m => m.count));
  const memoryTypes = Object.entries(stats.byType);
  const totalConfidence = Object.values(stats.avgConfidence).reduce((a, b) => a + b, 0);
  const avgConfidenceAll = Object.values(stats.avgConfidence).length > 0
    ? Math.round(totalConfidence / Object.values(stats.avgConfidence).length)
    : 0;

  return (
    <div className="h-full flex flex-col bg-zinc-950/60 backdrop-blur-xl text-white overflow-y-auto">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
        <div className="w-10 h-10 rounded-xl bg-violet-500/20 flex items-center justify-center">
          <UserIcon size={20} className="text-violet-400" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white/90">Personality Dashboard</h2>
          <p className="text-[10px] text-white/30">Memory evolution & behavior patterns</p>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-6">
        {/* Key metrics */}
        <div className="grid grid-cols-4 gap-3">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-center">
            <BrainCircuit size={18} className="text-violet-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-white/90">{stats.totalMemories}</div>
            <div className="text-[8px] font-bold text-white/30 uppercase tracking-widest mt-1">Memories</div>
          </div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-center">
            <Activity size={18} className="text-emerald-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-white/90">{stats.totalInteractions}</div>
            <div className="text-[8px] font-bold text-white/30 uppercase tracking-widest mt-1">Interactions</div>
          </div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-center">
            <TrendingUp size={18} className="text-amber-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-white/90">{avgConfidenceAll}%</div>
            <div className="text-[8px] font-bold text-white/30 uppercase tracking-widest mt-1">Avg Confidence</div>
          </div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 text-center">
            <Sparkles size={18} className="text-blue-400 mx-auto mb-2" />
            <div className="text-2xl font-black text-white/90">{stats.personalityId}</div>
            <div className="text-[8px] font-bold text-white/30 uppercase tracking-widest mt-1">Active Persona</div>
          </div>
        </div>

        {/* Memory distribution by type */}
        <div className="p-5 rounded-2xl bg-white/5 border border-white/5 space-y-3">
          <h3 className="text-[10px] font-black uppercase text-white/30 tracking-wider">Memory Distribution</h3>
          <div className="space-y-2">
            {memoryTypes.map(([type, count]) => (
              <div key={type} className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-white/50 w-20 uppercase">{TYPE_LABELS[type] || type}</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(count / Math.max(1, stats.totalMemories)) * 100}%` }}
                    className={`h-full ${TYPE_COLORS[type] || 'bg-white/40'} rounded-full`}
                  />
                </div>
                <span className="text-[10px] font-bold text-white/60 w-8 text-right">{count}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Confidence by type */}
        <div className="p-5 rounded-2xl bg-white/5 border border-white/5 space-y-3">
          <h3 className="text-[10px] font-black uppercase text-white/30 tracking-wider">Confidence by Type</h3>
          <div className="space-y-2">
            {Object.entries(stats.avgConfidence).map(([type, conf]) => (
              <div key={type} className="flex items-center gap-3">
                <span className="text-[10px] font-bold text-white/50 w-20 uppercase">{TYPE_LABELS[type] || type}</span>
                <div className="flex-1 h-2 bg-white/5 rounded-full overflow-hidden">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${conf}%` }}
                    className="h-full bg-amber-500 rounded-full"
                  />
                </div>
                <span className="text-[10px] font-bold text-amber-400 w-10 text-right">{conf}%</span>
              </div>
            ))}
          </div>
        </div>

        {/* Monthly trend */}
        <div className="p-5 rounded-2xl bg-white/5 border border-white/5 space-y-3">
          <h3 className="text-[10px] font-black uppercase text-white/30 tracking-wider flex items-center gap-2">
            <Calendar size={12} /> Memory Growth (6 months)
          </h3>
          <div className="flex items-end gap-2 h-24">
            {stats.monthlyTrend.map(m => (
              <div key={m.month} className="flex-1 flex flex-col items-center gap-1">
                <span className="text-[8px] font-bold text-white/40">{m.count}</span>
                <motion.div
                  initial={{ height: 0 }}
                  animate={{ height: `${(m.count / maxMonthCount) * 80}px` }}
                  className="w-full bg-gradient-to-t from-violet-500/40 to-violet-500 rounded-t-sm min-h-[4px]"
                />
                <span className="text-[7px] text-white/20 font-mono">{m.month.slice(2)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Evolution Timeline */}
        <div className="p-5 rounded-2xl bg-white/5 border border-white/5 space-y-3">
          <h3 className="text-[10px] font-black uppercase text-white/30 tracking-wider flex items-center gap-2">
            <Clock size={12} /> Evolution Timeline
          </h3>
          <div className="relative pl-5 space-y-0">
            <div className="absolute left-[7px] top-0 bottom-0 w-px bg-white/10" />
            {stats.monthlyTrend.map((m, i) => {
              const monthLabel = m.month;
              const isMilestone = m.count > 0 && (i === 0 || m.count >= stats.monthlyTrend[i - 1]?.count * 2);
              const isLatest = i === stats.monthlyTrend.length - 1;
              return (
                <div key={m.month} className="relative pb-5 last:pb-0">
                  <div className={`absolute left-[-17px] top-1 w-[15px] h-[15px] rounded-full border-2 flex items-center justify-center ${
                    isMilestone
                      ? 'bg-violet-500/20 border-violet-500'
                      : isLatest
                      ? 'bg-emerald-500/20 border-emerald-500'
                      : 'bg-white/10 border-white/20'
                  }`}>
                    <div className={`w-[5px] h-[5px] rounded-full ${
                      isMilestone ? 'bg-violet-500' : isLatest ? 'bg-emerald-500' : 'bg-white/30'
                    }`} />
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[8px] font-bold text-white/40 min-w-[32px]">{monthLabel.slice(2)}</span>
                    <span className={`text-[10px] font-bold ${
                      isMilestone ? 'text-violet-300' : 'text-white/60'
                    }`}>
                      {m.count > 0 ? `+${m.count} ${m.count === 1 ? 'memory' : 'memories'}` : 'Baseline'}
                    </span>
                    {isMilestone && (
                      <span className="text-[7px] font-black px-1.5 py-0.5 rounded bg-violet-500/20 text-violet-400 uppercase tracking-wider">
                        Milestone
                      </span>
                    )}
                    {isLatest && (
                      <span className="text-[7px] font-black px-1.5 py-0.5 rounded bg-emerald-500/20 text-emerald-400 uppercase tracking-wider">
                        Now
                      </span>
                    )}
                  </div>
                  {isMilestone && (
                    <p className="text-[8px] text-white/20 ml-[36px]">
                      Memory threshold crossed — pattern recognition activated
                    </p>
                  )}
                </div>
              );
            })}
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 flex items-center gap-3 text-[7px] text-white/20 font-bold">
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-violet-500/20 border border-violet-500" /> Milestone</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-emerald-500/20 border border-emerald-500" /> Current</span>
            <span className="flex items-center gap-1"><div className="w-2 h-2 rounded-full bg-white/10 border border-white/20" /> Normal</span>
          </div>
        </div>
      </div>
    </div>
  );
}
