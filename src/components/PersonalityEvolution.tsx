import { useState, useEffect, useCallback } from 'react';
import { motion } from 'motion/react';
import { Loader2, Sparkles, GitBranch, TrendingUp, Clock, Target, ChevronRight } from 'lucide-react';
import { toast } from 'sonner';
import { useSocket } from '@/hooks/useSocket';
import { useT } from '../lib/useT';

interface OwnerProfile {
  synthesizedAt: string;
  memoryCount: number;
  dominantTone: string;
  frequentExpressions: string[];
  interestClusters: string[];
  formalityLevel: number;
  emotionalExpressiveness: number;
  communicationPatterns: string[];
}

interface EvolutionMutation {
  field: string;
  from: number | string | string[];
  to: number | string | string[];
  reason: string;
}

interface EvolutionStep {
  auditId?: string;
  version: string;
  timestamp: string;
  trigger: string;
  ownerProfile?: OwnerProfile;
  mutations: EvolutionMutation[];
  narrative: string;
  reverted?: boolean;
  revertedAt?: string;
}

interface EvolutionAuditEntry {
  id: string;
  status: 'active' | 'reverted';
  createdAt: string;
  revertedAt?: string;
  trigger: string;
  depth: string;
  affectedLayer: 'core' | 'growth' | 'mixed';
  reversible: boolean;
  summary: string;
  mutationFields: string[];
  reasons: string[];
  sourceMemoryCount?: number;
}

interface GrowthState {
  version: number;
  lastUpdatedAt: string;
  ownerInterests: string[];
  ownerExpressions: string[];
  communicationPatterns: string[];
}

interface EvolutionData {
  personalityId: string;
  currentVector: {
    cognitiveStyle: Record<string, number>;
    socialStyle: Record<string, number>;
  } | null;
  version: string;
  evolutionConfig: {
    plasticity: number;
    minMemoriesForEvolution: number;
    minConnectionForEvolution: number;
    cooldownMs: number;
    maxMutationsPerStep: number;
  };
  history: EvolutionStep[];
  audit?: EvolutionAuditEntry[];
  growthState?: GrowthState | null;
  evolutionFrozenAt?: string | null;
}

interface Props {
  personalityId?: string;
}

const DIM_LABELS_EN: Record<string, string> = {
  analytical: 'Analytical',
  intuitive: 'Intuitive',
  systematic: 'Systematic',
  creative: 'Creative',
  warmth: 'Warmth',
  directness: 'Directness',
  playfulness: 'Playfulness',
  formality: 'Formality',
};

const DIM_ORDER = ['analytical', 'intuitive', 'systematic', 'creative', 'warmth', 'directness', 'playfulness', 'formality'];

/** Compute 8-vertex SVG polygon points for a given set of dimension values */
function getRadarPoints(
  values: Record<string, number>,
  cx: number,
  cy: number,
  radius: number,
): { points: string; vertices: Array<{ x: number; y: number; label: string; value: number }> } {
  const vertices: Array<{ x: number; y: number; label: string; value: number }> = [];
  for (let i = 0; i < DIM_ORDER.length; i++) {
    const dim = DIM_ORDER[i];
    const angle = (Math.PI * 2 * i) / DIM_ORDER.length - Math.PI / 2;
    const val = Math.max(0.05, values[dim] || 0);
    const x = cx + radius * val * Math.cos(angle);
    const y = cy + radius * val * Math.sin(angle);
    vertices.push({ x, y, label: DIM_LABELS_EN[dim] || dim, value: values[dim] || 0 });
  }
  const points = vertices.map(v => `${v.x},${v.y}`).join(' ');
  return { points, vertices };
}

/** Grid polygon points for the background rings */
function getGridPoints(cx: number, cy: number, radius: number): string {
  return DIM_ORDER.map((_, i) => {
    const angle = (Math.PI * 2 * i) / DIM_ORDER.length - Math.PI / 2;
    const x = cx + radius * Math.cos(angle);
    const y = cy + radius * Math.sin(angle);
    return `${x},${y}`;
  }).join(' ');
}

export function PersonalityEvolution({ personalityId = 'lumi' }: Props) {
  const t = useT();
  const DIM_LABELS: Record<string, string> = {
    analytical: t.dimAnalytical || '分析型',
    intuitive: t.dimIntuitive || '直觉型',
    systematic: t.dimSystematic || '系统型',
    creative: t.dimCreative || '创造型',
    warmth: t.dimWarmth || '温暖度',
    directness: t.dimDirectness || '直接度',
    playfulness: t.dimPlayfulness || '趣味度',
    formality: t.dimFormality || '正式度',
  };

  const [data, setData] = useState<EvolutionData | null>(null);
  const [loading, setLoading] = useState(true);
  const [selectedStep, setSelectedStep] = useState<number | null>(null);
  const [evolving, setEvolving] = useState(false);
  const [freezing, setFreezing] = useState(false);
  const [reverting, setReverting] = useState(false);
  const socket = useSocket();

  const fetchEvolutionData = useCallback(() => {
    fetch(`/api/personality/${personalityId}/evolution`)
      .then(r => r.json())
      .then(d => { setData(d); setSelectedStep(d.history?.length > 0 ? 0 : null); })
      .catch(() => toast.error(t.failedToLoadEvolution || 'Failed to load evolution data'))
      .finally(() => setLoading(false));
  }, [personalityId]);

  useEffect(() => {
    fetchEvolutionData();
  }, [fetchEvolutionData]);

  // Listen for real-time evolution events via WebSocket
  useEffect(() => {
    if (!socket) return;
    const handler = (event: { personalityId: string; version: string; narrative: string; mutations: any[]; timestamp: string }) => {
      if (event.personalityId === personalityId) {
        toast.success(`${t.lumiEvolvedTo || 'Lumi evolved to'} ${event.version}!`, {
          description: event.narrative?.slice(0, 100),
        });
        // Re-fetch to get the full updated state
        fetchEvolutionData();
      }
    };
    socket.on('personality:evolved', handler);
    return () => { socket.off('personality:evolved', handler); };
  }, [socket, personalityId, fetchEvolutionData]);

  const triggerEvolution = async () => {
    setEvolving(true);
    try {
      const r = await fetch(`/api/personality/${personalityId}/evolve`, { method: 'POST' });
      if (!r.ok) throw new Error((await r.json()).error || 'Evolution failed');
      // Re-fetch to get the full updated state with new evolution history
      const refresh = await fetch(`/api/personality/${personalityId}/evolution`);
      const d = await refresh.json();
      setData(d);
      setSelectedStep(d.history?.length > 0 ? d.history.length - 1 : null);
      toast.success(t.personalityEvolved || 'Personality evolved!');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setEvolving(false);
    }
  };

  const toggleFreeze = async () => {
    if (!data) return;
    setFreezing(true);
    try {
      const r = await fetch(`/api/personality/${personalityId}/evolution/freeze`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ frozen: !data.evolutionFrozenAt }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to update freeze state');
      fetchEvolutionData();
      toast.success(data.evolutionFrozenAt ? 'Evolution unfrozen' : 'Evolution frozen');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setFreezing(false);
    }
  };

  const revertSelected = async () => {
    if (!selected?.auditId) return;
    setReverting(true);
    try {
      const r = await fetch(`/api/personality/${personalityId}/evolution/revert`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ auditId: selected.auditId }),
      });
      if (!r.ok) throw new Error((await r.json()).error || 'Failed to revert evolution');
      fetchEvolutionData();
      toast.success('Evolution reverted');
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setReverting(false);
    }
  };

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-zinc-950/60">
        <Loader2 size={24} className="animate-spin text-white/55" />
      </div>
    );
  }

  const hasHistory = data && data.history.length > 0;
  const evolutionSteps = data?.history || [];
  const selected = selectedStep !== null && selectedStep !== undefined ? evolutionSteps[selectedStep] : null;
  const selectedAudit = selected?.auditId ? data?.audit?.find(a => a.id === selected.auditId) : null;

  const vectorToMap = (vec: Record<string, number>) => {
    const m: Record<string, number> = {};
    for (const [k, v] of Object.entries(vec)) m[k] = v;
    return m;
  };

  const cx = 150, cy = 150, r = 130;

  return (
    <div className="h-full overflow-auto bg-zinc-950/80">
      {/* Header */}
      <div className="flex items-center justify-between p-5 border-b border-white/5">
        <div className="flex items-center gap-3">
          <GitBranch size={18} className="text-fuchsia-400" />
          <div>
            <h2 className="text-sm font-black text-white/90 uppercase tracking-wider">{t.personalityEvolution || 'Personality Evolution'}</h2>
            {data && (
              <p className="text-xs text-white/55 font-mono">
                v{data.version} &middot; {evolutionSteps.length} step{evolutionSteps.length !== 1 ? 's' : ''}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={toggleFreeze}
            disabled={freezing}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-black uppercase transition-all border ${
              data?.evolutionFrozenAt
                ? 'bg-amber-500/20 border-amber-500/30 text-amber-300'
                : 'bg-white/5 border-white/10 text-white/55 hover:bg-white/10'
            }`}
          >
            {freezing ? <Loader2 size={12} className="animate-spin" /> : null}
            {data?.evolutionFrozenAt ? 'Frozen' : 'Active'}
          </button>
          <button
            onClick={triggerEvolution}
            disabled={evolving || Boolean(data?.evolutionFrozenAt)}
            className="flex items-center gap-2 px-4 py-2 bg-fuchsia-500/20 border border-fuchsia-500/30 rounded-xl text-xs font-black uppercase text-fuchsia-400 hover:bg-fuchsia-500/30 disabled:opacity-30 transition-all"
          >
            {evolving ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
            {t.evolve || 'Evolve'}
          </button>
        </div>
      </div>

      {!hasHistory ? (
        <div className="flex flex-col items-center justify-center h-64 gap-4 text-white/45">
          <TrendingUp size={48} />
          <p className="text-xs">{t.noEvolutionHistory || "No evolution history yet. Lumi's personality grows with you."}</p>
        </div>
      ) : (
        <div className="flex h-[calc(100%-65px)]">
          {/* Left: Radar Chart */}
          <div className="w-[420px] flex-shrink-0 p-6 border-r border-white/5 flex flex-col items-center">
            <svg width={340} height={340} viewBox="0 0 300 300">
              {/* Background rings */}
              {[0.25, 0.5, 0.75, 1].map(scale => (
                <motion.polygon
                  key={scale}
                  points={getGridPoints(cx, cy, r * scale)}
                  fill="none"
                  stroke="rgba(255,255,255,0.06)"
                  strokeWidth={0.5}
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: scale * 0.1 }}
                />
              ))}
              {/* Axis lines */}
              {DIM_ORDER.map((dim, i) => {
                const angle = (Math.PI * 2 * i) / DIM_ORDER.length - Math.PI / 2;
                const ex = cx + r * Math.cos(angle);
                const ey = cy + r * Math.sin(angle);
                return (
                  <line key={dim} x1={cx} y1={cy} x2={ex} y2={ey} stroke="rgba(255,255,255,0.08)" strokeWidth={0.5} />
                );
              })}
              {/* Axis labels */}
              {DIM_ORDER.map((dim, i) => {
                const angle = (Math.PI * 2 * i) / DIM_ORDER.length - Math.PI / 2;
                const lx = cx + (r + 22) * Math.cos(angle);
                const ly = cy + (r + 22) * Math.sin(angle);
                return (
                  <text key={dim} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle"
                    className="fill-white/25" style={{ fontSize: '7px', fontWeight: 700, fontFamily: 'monospace' }}>
                    {DIM_LABELS[dim]}
                  </text>
                );
              })}
              {/* Historical step polygons */}
              {evolutionSteps.map((step, idx) => {
                if (!data?.currentVector) return null;
                // Reconstruct vector for this step by applying mutations backwards
                // For simplicity, use current vector if not selected, or show all steps
                const opacity = idx === selectedStep ? 1 : 0.2;
                // We show the current vector for the latest step, or a faded version for older ones
                const values = data.currentVector;
                const merged: Record<string, number> = {
                  ...values.cognitiveStyle,
                  ...values.socialStyle,
                };
                // Apply reverse mutations for older steps
                for (let s = evolutionSteps.length - 1; s > idx; s--) {
                  for (const mut of evolutionSteps[s].mutations) {
                    const parts = mut.field.split('.');
                    if (parts[0] === 'personalityVector' && parts.length === 3) {
                      const style = parts[1] as 'cognitiveStyle' | 'socialStyle';
                      const dim = parts[2];
                      if (merged[dim] !== undefined && typeof mut.from === 'number') {
                        merged[dim] = mut.from;
                      }
                    }
                  }
                }
                const { points, vertices } = getRadarPoints(merged, cx, cy, r);
                return (
                  <g key={step.version}>
                    <motion.polygon
                      points={points}
                      fill={idx === selectedStep ? 'rgba(192,132,252,0.3)' : 'rgba(192,132,252,0.08)'}
                      stroke={idx === selectedStep ? 'rgba(192,132,252,0.8)' : 'rgba(192,132,252,0.25)'}
                      strokeWidth={idx === selectedStep ? 1.5 : 0.5}
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      transition={{ delay: idx * 0.1 }}
                    />
                    {idx === selectedStep && vertices.map((v, vi) => (
                      <circle key={vi} cx={v.x} cy={v.y} r={3} fill="rgba(192,132,252,0.9)" stroke="white" strokeWidth={0.5} />
                    ))}
                  </g>
                );
              })}
            </svg>
            {selected && (
              <p className="text-[12px] text-white/55 text-center mt-2 italic max-w-[340px]">
                {selected.narrative}
              </p>
            )}
          </div>

          {/* Right: Timeline + Mutations */}
          <div className="flex-1 flex flex-col overflow-hidden">
            {/* Timeline */}
            <div className="p-4 border-b border-white/5 overflow-x-auto">
              <div className="flex gap-2 items-center min-w-max">
                <Clock size={12} className="text-white/45 flex-shrink-0" />
                {evolutionSteps.map((step, idx) => (
                  <button
                    key={step.version}
                    onClick={() => setSelectedStep(idx)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-xl text-xs font-mono transition-all flex-shrink-0 ${
                      idx === selectedStep
                        ? 'bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-300'
                        : 'bg-white/5 border border-white/5 text-white/40 hover:bg-white/10'
                    }`}
                  >
                    <span className="font-black">v{step.version}</span>
                    <span className="text-xs opacity-50">{step.timestamp.slice(0, 10)}</span>
                    <span className={`text-xs uppercase px-1.5 py-0.5 rounded-full ${
                      step.trigger === 'manual' ? 'bg-amber-500/20 text-amber-400' :
                      step.trigger === 'milestone' ? 'bg-emerald-500/20 text-emerald-400' :
                      'bg-blue-500/20 text-blue-400'
                    }`}>{step.trigger}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Mutation details */}
            <div className="flex-1 overflow-auto p-5 space-y-4">
              {selected ? (
                <>
                  {/* Owner Profile (if available) */}
                  {selected.ownerProfile && (
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                      <h3 className="text-xs font-black text-white/55 uppercase tracking-wider flex items-center gap-2">
                        <Target size={12} /> {t.ownerProfile || 'Owner Profile'}
                      </h3>
                      <div className="grid grid-cols-2 gap-2 text-xs">
                        <div>
                          <span className="text-white/45">{t.dominantTone || 'Dominant Tone: '}</span>
                          <span className="text-white/60">{selected.ownerProfile.dominantTone}</span>
                        </div>
                        <div>
                          <span className="text-white/45">{t.formalityLabel || 'Formality: '}</span>
                          <span className="text-white/60">{selected.ownerProfile.formalityLevel.toFixed(1)}</span>
                        </div>
                        <div>
                          <span className="text-white/45">{t.expressiveness || 'Expressiveness: '}</span>
                          <span className="text-white/60">{selected.ownerProfile.emotionalExpressiveness.toFixed(1)}</span>
                        </div>
                        <div>
                          <span className="text-white/45">{t.memoriesAnalyzed || 'Memories Analyzed: '}</span>
                          <span className="text-white/60">{selected.ownerProfile.memoryCount}</span>
                        </div>
                      </div>
                      {selected.ownerProfile.interestClusters?.length > 0 && (
                        <div className="flex flex-wrap gap-1 mt-1">
                          {selected.ownerProfile.interestClusters.map(c => (
                            <span key={c} className="px-2 py-0.5 bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-full text-xs text-fuchsia-300">{c}</span>
                          ))}
                        </div>
                      )}
                    </div>
                  )}

                  {selectedAudit && (
                    <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-3">
                      <div className="flex items-center justify-between gap-3">
                        <h3 className="text-xs font-black text-white/55 uppercase tracking-wider">Evolution Audit</h3>
                        <span className={`text-[11px] font-mono uppercase px-2 py-1 rounded-full ${
                          selectedAudit.status === 'reverted'
                            ? 'bg-zinc-500/20 text-zinc-300'
                            : selectedAudit.affectedLayer === 'core'
                            ? 'bg-red-500/20 text-red-300'
                            : selectedAudit.affectedLayer === 'mixed'
                            ? 'bg-amber-500/20 text-amber-300'
                            : 'bg-emerald-500/20 text-emerald-300'
                        }`}>
                          {selectedAudit.status} / {selectedAudit.affectedLayer}
                        </span>
                      </div>
                      <div className="text-[12px] text-white/50 space-y-1">
                        <div>Audit ID: <span className="font-mono text-white/65">{selectedAudit.id}</span></div>
                        <div>Reversible: {selectedAudit.reversible ? 'Yes' : 'No'}</div>
                        <div>Fields: {selectedAudit.mutationFields.join(', ') || 'none'}</div>
                      </div>
                      <button
                        onClick={revertSelected}
                        disabled={!selectedAudit.reversible || selectedAudit.status === 'reverted' || reverting}
                        className="px-3 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-300 text-xs font-black uppercase disabled:opacity-30"
                      >
                        {reverting ? 'Reverting...' : 'Revert This Step'}
                      </button>
                    </div>
                  )}

                  {/* Mutations */}
                  <h3 className="text-xs font-black text-white/55 uppercase tracking-wider flex items-center gap-2">
                    <Sparkles size={12} /> {t.mutations || 'Mutations'}
                  </h3>
                  {selected.mutations.map((mut, mi) => (
                    <motion.div
                      key={mi}
                      initial={{ opacity: 0, x: 10 }}
                      animate={{ opacity: 1, x: 0 }}
                      transition={{ delay: mi * 0.08 }}
                      className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2"
                    >
                      <div className="flex items-center gap-2">
                        <code className="text-[12px] font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                          {mut.field}
                        </code>
                        <ChevronRight size={10} className="text-white/35" />
                      </div>
                      <div className="flex items-center gap-3 text-xs font-mono">
                        <span className="text-red-400/60 line-through">{typeof mut.from === 'number' ? (mut.from as number).toFixed(2) : String(mut.from)}</span>
                        <span className="text-white/35">&rarr;</span>
                        <span className="text-emerald-400">{typeof mut.to === 'number' ? (mut.to as number).toFixed(2) : String(mut.to)}</span>
                      </div>
                      <p className="text-[12px] text-white/55 italic">{mut.reason}</p>
                    </motion.div>
                  ))}
                </>
              ) : (
                <div className="flex items-center justify-center h-full text-white/35 text-xs">
                  {t.selectEvolutionStep || 'Select an evolution step to view details'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Config bar */}
      {data && (
        <div className="border-t border-white/5 px-5 py-3 flex items-center gap-6 text-[12px] text-white/45 font-mono">
          <span>{t.plasticity || 'Plasticity:'} <span className="text-white/40">{data.evolutionConfig.plasticity.toFixed(1)}</span></span>
          <span>{t.cooldown || 'Cooldown:'} <span className="text-white/40">{(data.evolutionConfig.cooldownMs / 86400000).toFixed(0)}d</span></span>
          <span>{t.maxMutations || 'Max Mutations:'} <span className="text-white/40">{data.evolutionConfig.maxMutationsPerStep}</span></span>
          <span>{t.minMemories || 'Min Memories:'} <span className="text-white/40">{data.evolutionConfig.minMemoriesForEvolution}</span></span>
        </div>
      )}
    </div>
  );
}
