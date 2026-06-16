import { useState, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, FileText, Sparkles, Heart, Users, Briefcase, GraduationCap, User, X, ArrowRight, ArrowLeft, Eye, Castle, Loader2, CheckCircle, AlertTriangle, Zap, Mic, Headphones } from 'lucide-react';
import { toast } from 'sonner';
import { useApp } from '../contexts/AppContext';

interface DistillSummary {
  messageCount: number;
  memoryCount: number;
  cognitiveStyle?: Record<string, number>;
  socialStyle?: Record<string, number>;
  tone?: string;
  topPhrases?: string[];
}

interface DistillResult {
  personalityConfig: any;
  seedMemories: Array<{
    type: string;
    content: string;
    keywords: string[];
    confidence: number;
    evidenceGrade: 'verbatim' | 'artifact' | 'impression';
  }>;
  evidenceMap: Array<{ memoryIndex: number; grade: string; source: string }>;
  relationshipType: string;
  narrative: string;
  inferredName: string;
  summary: DistillSummary;
}

type LocalizedText = { zh: string; en: string };

const localize = (isZh: boolean, zh: string, en: string) => (isZh ? zh : en);
const pickText = (isZh: boolean, text: LocalizedText) => (isZh ? text.zh : text.en);

const RELATIONSHIP_TYPES = [
  { id: 'close_friend', label: { zh: '挚友', en: 'Close Friend' }, icon: <Users size={18} />, desc: { zh: '最好的朋友、知心人', en: 'Best friend and confidant' } },
  { id: 'family', label: { zh: '亲人', en: 'Family' }, icon: <Heart size={18} />, desc: { zh: '家人、长辈、兄弟姐妹', en: 'Family, elders, siblings' } },
  { id: 'lover', label: { zh: '恋人', en: 'Partner' }, icon: <Heart size={18} className="text-rose-400" />, desc: { zh: '曾经或现在的爱人', en: 'Past or present romantic partner' } },
  { id: 'mentor', label: { zh: '导师', en: 'Mentor' }, icon: <GraduationCap size={18} />, desc: { zh: '老师、师父、引路人', en: 'Teacher, guide, or mentor' } },
  { id: 'colleague', label: { zh: '同事', en: 'Colleague' }, icon: <Briefcase size={18} />, desc: { zh: '并肩工作的伙伴', en: 'Work partner or teammate' } },
];

const DIM_ORDER = ['analytical', 'intuitive', 'systematic', 'creative', 'warmth', 'directness', 'playfulness', 'formality'];
const DIM_LABELS: Record<string, LocalizedText> = {
  analytical: { zh: '分析', en: 'Analytical' }, intuitive: { zh: '直觉', en: 'Intuitive' }, systematic: { zh: '系统', en: 'Systematic' }, creative: { zh: '创造', en: 'Creative' },
  warmth: { zh: '温度', en: 'Warmth' }, directness: { zh: '直接', en: 'Direct' }, playfulness: { zh: '趣味', en: 'Playful' }, formality: { zh: '正式', en: 'Formal' },
};

function MiniRadar({ cognitiveStyle, socialStyle, isZh = true }: { cognitiveStyle?: Record<string, number>; socialStyle?: Record<string, number>; isZh?: boolean }) {
  if (!cognitiveStyle || !socialStyle) return null;
  const values = { ...cognitiveStyle, ...socialStyle };
  const cx = 90, cy = 90, r = 75;

  const vertices = DIM_ORDER.map((dim, i) => {
    const angle = (Math.PI * 2 * i) / DIM_ORDER.length - Math.PI / 2;
    const val = Math.max(0.05, values[dim] || 0);
    return { x: cx + r * val * Math.cos(angle), y: cy + r * val * Math.sin(angle) };
  });

  return (
    <svg width={200} height={200} viewBox="0 0 180 180" className="mx-auto">
      {[0.25, 0.5, 0.75, 1].map(scale => (
        <polygon key={scale} points={DIM_ORDER.map((_, i) => {
          const a = (Math.PI * 2 * i) / DIM_ORDER.length - Math.PI / 2;
          return `${cx + r * scale * Math.cos(a)},${cy + r * scale * Math.sin(a)}`;
        }).join(' ')} fill="none" stroke="rgba(255,255,255,0.06)" strokeWidth={0.5} />
      ))}
      {DIM_ORDER.map((dim, i) => {
        const angle = (Math.PI * 2 * i) / DIM_ORDER.length - Math.PI / 2;
        const lx = cx + (r + 15) * Math.cos(angle);
        const ly = cy + (r + 15) * Math.sin(angle);
        return <text key={dim} x={lx} y={ly} textAnchor="middle" dominantBaseline="middle" className="fill-white/20" style={{ fontSize: '7px', fontFamily: 'monospace' }}>{pickText(isZh, DIM_LABELS[dim])}</text>;
      })}
      <polygon points={vertices.map(v => `${v.x},${v.y}`).join(' ')} fill="rgba(192,132,252,0.25)" stroke="rgba(192,132,252,0.6)" strokeWidth={1} />
      {vertices.map((v, i) => <circle key={i} cx={v.x} cy={v.y} r={2.5} fill="rgba(192,132,252,0.9)" />)}
    </svg>
  );
}

function EvidenceBadge({ grade, isZh = true }: { grade: 'verbatim' | 'artifact' | 'impression'; isZh?: boolean }) {
  const config = {
    verbatim: { bg: 'bg-emerald-500/10', border: 'border-emerald-500/20', text: 'text-emerald-400', label: { zh: '原话', en: 'Quote' } },
    artifact: { bg: 'bg-blue-500/10', border: 'border-blue-500/20', text: 'text-blue-400', label: { zh: '事实', en: 'Fact' } },
    impression: { bg: 'bg-amber-500/10', border: 'border-amber-500/20', text: 'text-amber-400', label: { zh: '推测', en: 'Inferred' } },
  };
  const c = config[grade] || config.impression;
  return <span className={`text-xs font-bold uppercase px-2 py-0.5 rounded-full border ${c.bg} ${c.border} ${c.text}`}>{pickText(isZh, c.label)}</span>;
}

export function MemoryAvatarLab({ t, onEnterSanctuary }: { t: any; onEnterSanctuary?: (agent: any) => void }) {
  const { createAgent, user, login } = useApp();
  const isZh = t?.langCode !== 'en';
  const ui = (zh: string, en: string) => localize(isZh, zh, en);
  const [currentStep, setCurrentStep] = useState(1);
  const [distilling, setDistilling] = useState(false);
  const [creating, setCreating] = useState(false);
  const [chatLog, setChatLog] = useState('');
  const [format, setFormat] = useState<'wechat' | 'qq' | 'plain'>('wechat');
  const [fileName, setFileName] = useState('');
  const [relationshipType, setRelationshipType] = useState('close_friend');
  const [distillResult, setDistillResult] = useState<DistillResult | null>(null);
  const [sanctuaryName, setSanctuaryName] = useState('');
  const [audioFile, setAudioFile] = useState<File | null>(null);
  const [audioTranscribing, setAudioTranscribing] = useState(false);
  const [audioTranscript, setAudioTranscript] = useState('');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const audioInputRef = useRef<HTMLInputElement>(null);

  const handleFileLoad = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setFileName(file.name);
    // Detect format from filename
    if (file.name.includes('微信') || file.name.includes('wechat')) setFormat('wechat');
    else if (file.name.includes('QQ') || file.name.includes('qq')) setFormat('qq');
    else setFormat('plain');

    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setChatLog(text);
      const lineCount = text.split('\n').filter(l => l.trim()).length;
      toast.success(localize(isZh, `已从 ${file.name} 读取 ${lineCount} 行`, `Loaded ${lineCount} lines from ${file.name}`));
    };
    reader.readAsText(file);
  }, [isZh]);

  const handleAudioUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setAudioFile(file);
    // Transcribe audio via server
    setAudioTranscribing(true);
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const base64 = (reader.result as string).split(',')[1];
        const res = await fetch('/api/audio/transcribe', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ audio: base64, fileName: file.name }),
          credentials: 'include',
        });
        if (res.ok) {
          const data = await res.json();
          setAudioTranscript(data.text || '');
          // Append transcript to chat log for richer distillation
          if (data.text) {
            setChatLog(prev => prev + '\n\n[语音记录]\n' + data.text.split('\n').map((l: string) => `Target: ${l}`).join('\n'));
            const seconds = Math.round((data.text?.length || 0) / 20);
            toast.success(localize(isZh, `已转录 ${seconds} 秒语音`, `Transcribed about ${seconds} seconds of audio`));
          }
        } else {
          toast.error(localize(isZh, '语音转录失败', 'Audio transcription failed'));
        }
      } catch {
        toast.error(localize(isZh, '语音转录失败', 'Audio transcription failed'));
      } finally {
        setAudioTranscribing(false);
      }
    };
    reader.readAsDataURL(file);
  }, [isZh]);

  const handleDistill = async () => {
    if (!user) { login(); return; }
    if (!chatLog.trim()) { toast.error(t?.uploadChatLogFirst || 'Please upload a chat log first'); return; }
    setDistilling(true);
    try {
      const res = await fetch('/api/agents/distill', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chatLog,
          format,
          relationshipType,
          ...(audioTranscript ? { audioTranscript } : {}),
        }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json()).error || 'Distillation failed');
      const result: DistillResult = await res.json();
      setDistillResult(result);
      setSanctuaryName(result.inferredName);
      setCurrentStep(2);
      toast.success(`Distilled personality for "${result.inferredName}" — ${result.seedMemories.length} memories extracted`);
    } catch (err: any) {
      toast.error(err.message || 'Distillation failed');
    } finally {
      setDistilling(false);
    }
  };

  const handleCreateSanctuary = async () => {
    if (!user) { login(); return; }
    if (!distillResult) return;
    setCreating(true);
    try {
      const agent = await createAgent(
        sanctuaryName || distillResult.inferredName,
        distillResult.relationshipType,
        {
          territory: 'sanctuary',
          distilledFrom: 'chat_records',
          evidenceMap: distillResult.evidenceMap,
          relationshipType: distillResult.relationshipType,
          isFrozen: true,
          personalityConfig: distillResult.personalityConfig,
          seedMemories: distillResult.seedMemories,
        },
      );
      if (!agent) throw new Error('Agent creation failed');
      toast.success(`Sanctuary created for "${agent.name}"`);
      setCurrentStep(3);
      onEnterSanctuary?.(agent);
    } catch (err: any) {
      toast.error(err.message || 'Creation failed');
    } finally {
      setCreating(false);
    }
  };

  const reset = () => {
    setCurrentStep(1);
    setChatLog('');
    setFileName('');
    setDistillResult(null);
    setSanctuaryName('');
  };

  const steps = [
    { id: 1, title: ui('数据上传', 'Data Upload'), icon: <Upload size={18} /> },
    { id: 2, title: ui('人格蒸馏', 'Personality Distill'), icon: <Zap size={18} /> },
    { id: 3, title: ui('领地创建', 'Sanctuary Setup'), icon: <Castle size={18} /> },
  ];

  const relationshipLabel = (id: string) => {
    const rel = RELATIONSHIP_TYPES.find(item => item.id === id);
    return rel ? pickText(isZh, rel.label) : id;
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950/90">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
        <div className="flex items-center gap-3">
          <Castle size={18} className="text-fuchsia-400" />
          <div>
            <h2 className="text-sm font-black text-white/90 uppercase tracking-wider">{ui('智能体生成实验室', 'Agent Generation Lab')}</h2>
            <p className="text-xs text-white/55 font-mono">{t?.memoryAvatarLab || 'Memory Avatar Lab'}</p>
          </div>
        </div>
        <div className="flex items-center gap-1">
          {steps.map((step, i) => (
            <div key={step.id} className="flex items-center gap-1">
              {i > 0 && <div className="w-6 h-px bg-white/10" />}
              <div className={`w-8 h-8 rounded-xl flex items-center justify-center transition-all ${currentStep >= step.id ? 'bg-fuchsia-500/20 text-fuchsia-400 border border-fuchsia-500/30' : 'bg-white/5 text-white/45 border border-white/5'}`}>
                {step.icon}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-auto p-6">
        <AnimatePresence mode="wait">
          {/* Step 1: Upload */}
          {currentStep === 1 && (
            <motion.div key="s1" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-2xl mx-auto space-y-6">
              <div className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl text-xs text-amber-300/80 leading-relaxed">
                <AlertTriangle size={14} className="inline mr-2" />
                {ui('这是从数据中蒸馏出的记忆化身，不是那个人本身。请确认您有权使用这些数据，且用途符合伦理。', 'This memory avatar is distilled from data. It is not the person themselves. Please confirm you have the right to use the data and that the purpose is ethical.')}
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-white/55">{ui('聊天记录文件', 'Chat Log File')}</label>
                <input ref={fileInputRef} type="file" accept=".txt,.json,.csv" onChange={handleFileLoad} className="hidden" />
                <div
                  onClick={() => fileInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 rounded-2xl p-10 flex flex-col items-center justify-center gap-4 hover:border-fuchsia-500/30 hover:bg-white/[0.02] transition-all cursor-pointer"
                >
                  {fileName ? (
                    <>
                      <FileText size={36} className="text-fuchsia-400" />
                      <span className="text-sm text-white/60 font-medium">{fileName}</span>
                      <span className="text-xs text-white/45">{ui(`${chatLog.split('\n').filter(l => l.trim()).length} 行已读取`, `${chatLog.split('\n').filter(l => l.trim()).length} lines loaded`)}</span>
                    </>
                  ) : (
                    <>
                      <Upload size={36} className="text-white/40" />
                      <div className="text-center space-y-1">
                        <p className="text-sm text-white/40">{ui('上传聊天记录导出文件', 'Upload exported chat logs')}</p>
                        <p className="text-xs text-white/40">{ui('支持微信、QQ 导出 .txt，纯文本', 'Supports WeChat, QQ .txt exports, and plain text')}</p>
                      </div>
                    </>
                  )}
                </div>
                <div className="flex gap-2">
                  {(['wechat', 'qq', 'plain'] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setFormat(f)}
                      className={`px-3 py-1.5 rounded-lg text-xs font-bold uppercase transition-all ${format === f ? 'bg-fuchsia-500/20 border border-fuchsia-500/30 text-fuchsia-400' : 'bg-white/5 border border-white/5 text-white/55 hover:bg-white/10'}`}
                    >
                      {f === 'wechat' ? ui('微信', 'WeChat') : f === 'qq' ? 'QQ' : 'Plain'}
                    </button>
                  ))}
                </div>
              </div>

              {/* Audio upload for voice recording */}
              <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-white/55">{ui('语音记录（可选）', 'Voice Recording (optional)')}</label>
                <input ref={audioInputRef} type="file" accept="audio/*,.mp3,.wav,.ogg,.m4a,.aac" onChange={handleAudioUpload} className="hidden" />
                <div
                  onClick={() => audioInputRef.current?.click()}
                  className="border-2 border-dashed border-white/10 rounded-2xl p-6 flex flex-col items-center justify-center gap-3 hover:border-fuchsia-500/30 hover:bg-white/[0.02] transition-all cursor-pointer"
                >
                  {audioFile ? (
                    <>
                      {audioTranscribing ? (
                        <>
                          <Loader2 size={28} className="text-fuchsia-400 animate-spin" />
                          <span className="text-xs text-white/40">{ui('转录中...', 'Transcribing...')}</span>
                        </>
                      ) : (
                        <>
                          <Headphones size={28} className="text-fuchsia-400" />
                          <span className="text-xs text-white/50">{audioFile.name}</span>
                          <span className="text-xs text-white/45">{ui('已转录 - 语音特征将纳入人格分析', 'Transcribed - voice traits will be included in analysis')}</span>
                        </>
                      )}
                    </>
                  ) : (
                    <>
                      <Mic size={28} className="text-white/40" />
                      <div className="text-center space-y-1">
                        <p className="text-xs text-white/55">{ui('上传语音录音', 'Upload voice recording')}</p>
                        <p className="text-[12px] text-white/35">{ui('MP3 / WAV / OGG - 用于分析语气和口头禅', 'MP3 / WAV / OGG - used to analyze tone and phrases')}</p>
                      </div>
                    </>
                  )}
                </div>
              </div>

              <div className="space-y-3">
                <label className="text-xs font-bold uppercase tracking-wider text-white/55">{ui('关系类型', 'Relationship Type')}</label>
                <div className="grid grid-cols-5 gap-2">
                  {RELATIONSHIP_TYPES.map(rel => (
                    <button
                      key={rel.id}
                      onClick={() => setRelationshipType(rel.id)}
                      className={`flex flex-col items-center gap-1.5 p-3 rounded-xl border transition-all ${relationshipType === rel.id ? 'bg-fuchsia-500/10 border-fuchsia-500/30 text-fuchsia-400' : 'bg-white/5 border-white/5 text-white/55 hover:bg-white/10'}`}
                    >
                      {rel.icon}
                      <span className="text-[12px] font-bold">{pickText(isZh, rel.label)}</span>
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex justify-end pt-2">
                <button
                  onClick={handleDistill}
                  disabled={!chatLog.trim() || distilling}
                  className="flex items-center gap-2 px-8 py-3 bg-fuchsia-500/20 border border-fuchsia-500/30 rounded-xl text-sm font-bold text-fuchsia-400 hover:bg-fuchsia-500/30 disabled:opacity-30 transition-all"
                >
                  {distilling ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                  {distilling ? ui('蒸馏中...', 'Distilling...') : ui('开始人格蒸馏', 'Start Personality Distill')}
                  <ArrowRight size={14} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 2: Results Preview */}
          {currentStep === 2 && distillResult && (
            <motion.div key="s2" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }} className="max-w-3xl mx-auto space-y-6">
              {/* Narrative */}
              <div className="p-6 bg-white/5 border border-white/10 rounded-2xl space-y-3">
                <div className="flex items-center gap-2">
                  <Eye size={14} className="text-fuchsia-400" />
                  <span className="text-xs font-bold uppercase tracking-wider text-white/55">{ui('蒸馏结果', 'Distill Result')} - {distillResult.inferredName}</span>
                </div>
                <p className="text-sm text-white/60 leading-relaxed italic">"{distillResult.narrative}"</p>
                <div className="flex gap-3 text-xs text-white/55 font-mono">
                  <span>{ui(`${distillResult.summary.messageCount} 条消息`, `${distillResult.summary.messageCount} messages`)}</span>
                  <span>{ui(`${distillResult.seedMemories.length} 条记忆`, `${distillResult.seedMemories.length} memories`)}</span>
                  <span>{relationshipLabel(distillResult.relationshipType)}</span>
                  <span className="text-fuchsia-400">{distillResult.personalityConfig.expressionStyle.tone}</span>
                </div>
              </div>

              {/* Radar */}
              <div className="p-6 bg-white/5 border border-white/10 rounded-2xl">
                <h3 className="text-xs font-bold uppercase tracking-wider text-white/55 mb-3">{ui('8 维人格向量', '8-D Personality Vector')}</h3>
                <MiniRadar cognitiveStyle={distillResult.summary.cognitiveStyle} socialStyle={distillResult.summary.socialStyle} isZh={isZh} />
              </div>

              {/* Common phrases */}
              {distillResult.summary.topPhrases && distillResult.summary.topPhrases.length > 0 && (
                <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-2">
                  <span className="text-xs font-bold uppercase tracking-wider text-white/55">{ui('常用表达', 'Common Phrases')}</span>
                  <div className="flex flex-wrap gap-2">
                    {distillResult.summary.topPhrases.map((p, i) => (
                      <span key={i} className="px-3 py-1 bg-fuchsia-500/10 border border-fuchsia-500/20 rounded-full text-xs text-fuchsia-300">{p}</span>
                    ))}
                  </div>
                </div>
              )}

              {/* Seed Memories with Evidence */}
              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-white/55">{ui('种子记忆', 'Seed Memories')} ({distillResult.seedMemories.length})</span>
                <div className="space-y-2 max-h-64 overflow-auto">
                  {distillResult.seedMemories.slice(0, 10).map((mem, i) => (
                    <div key={i} className="flex items-start gap-3 p-3 bg-white/[0.02] rounded-xl border border-white/5">
                      <EvidenceBadge grade={mem.evidenceGrade} isZh={isZh} />
                      <div className="flex-1 min-w-0">
                        <p className="text-xs text-white/50 leading-relaxed">{mem.content}</p>
                        <span className="text-[12px] text-white/40 font-mono">{mem.keywords?.join(', ')}</span>
                      </div>
                      <span className="text-[12px] text-white/40 font-mono">{Math.round(mem.confidence * 100)}%</span>
                    </div>
                  ))}
                </div>
              </div>

              {/* Sanctuary config */}
              <div className="p-4 bg-white/5 border border-white/10 rounded-2xl space-y-3">
                <span className="text-xs font-bold uppercase tracking-wider text-white/55">{ui('领地配置', 'Sanctuary Settings')}</span>
                <input
                  value={sanctuaryName}
                  onChange={(e) => setSanctuaryName(e.target.value)}
                  placeholder={ui('领地名称...', 'Sanctuary name...')}
                  className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-sm text-white/80 placeholder:text-white/40 focus:outline-none focus:border-fuchsia-500/30"
                />
                <div className="text-[12px] text-white/45 font-mono space-y-1">
                  <p>{ui('• 工具权限：无（仅对话）', '- Tool permission: none (chat only)')}</p>
                  <p>{ui('• 记忆隔离：私有（不共享）', '- Memory isolation: private (not shared)')}</p>
                  <p>{ui('• 演化：冻结（不自动变化）', '- Evolution: frozen (no automatic drift)')}</p>
                  <p>{ui('• 通知：关闭（只在领地内可见）', '- Notifications: off (visible only inside sanctuary)')}</p>
                </div>
              </div>

              <div className="flex justify-between pt-2">
                <button onClick={() => setCurrentStep(1)} className="flex items-center gap-2 px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white/40 hover:bg-white/10 transition-all">
                  <ArrowLeft size={14} /> {ui('返回', 'Back')}
                </button>
                <button onClick={handleCreateSanctuary} disabled={creating} className="flex items-center gap-2 px-8 py-3 bg-fuchsia-500/20 border border-fuchsia-500/30 rounded-xl text-sm font-bold text-fuchsia-400 hover:bg-fuchsia-500/30 disabled:opacity-30 transition-all">
                  {creating ? <Loader2 size={16} className="animate-spin" /> : <Castle size={16} />}
                  {creating ? ui('创建中...', 'Creating...') : ui('创建领地', 'Create Sanctuary')}
                  <ArrowRight size={14} />
                </button>
              </div>
            </motion.div>
          )}

          {/* Step 3: Created */}
          {currentStep === 3 && distillResult && (
            <motion.div key="s3" initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.95 }} className="max-w-md mx-auto text-center space-y-8 py-12">
              <div className="w-24 h-24 rounded-[2rem] bg-fuchsia-500/20 flex items-center justify-center mx-auto border border-fuchsia-500/30 shadow-[0_0_60px_rgba(192,132,252,0.15)]">
                <CheckCircle size={48} className="text-fuchsia-400" />
              </div>
              <div className="space-y-2">
                <h2 className="text-2xl font-black tracking-tighter text-white/90">{ui('领地已创建', 'Sanctuary Created')}</h2>
                <p className="text-sm text-white/40 max-w-sm mx-auto">
                  {ui(`"${sanctuaryName || distillResult.inferredName}" 的记忆化身已安放在专属领地中。现在可以进入领地与 ta 对话。`, `The memory avatar for "${sanctuaryName || distillResult.inferredName}" has been placed in its private sanctuary. You can enter now and start talking.`)}
                </p>
              </div>
              <div className="flex gap-4 justify-center">
                <button onClick={reset} className="px-6 py-3 bg-white/5 border border-white/10 rounded-xl text-sm text-white/40 hover:bg-white/10 transition-all">
                  {ui('再创建一个', 'Create Another')}
                </button>
                <button className="px-6 py-3 bg-fuchsia-500/20 border border-fuchsia-500/30 rounded-xl text-sm font-bold text-fuchsia-400 hover:bg-fuchsia-500/30 transition-all">
                  {ui('进入领地', 'Enter Sanctuary')} <ArrowRight size={14} className="inline ml-1" />
                </button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
