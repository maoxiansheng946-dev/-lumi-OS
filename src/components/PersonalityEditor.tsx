import React, { useState, useEffect } from 'react';
import { User, ChevronDown, ChevronRight, Activity, Users } from 'lucide-react';
import { toast } from 'sonner';
import { PersonalityEvolution } from './PersonalityEvolution';
import { ContactsPanel } from './ContactsPanel';

interface PersonalityConfig {
  id: string;
  name: string;
  version: string;
  coreMotivation: string;
  behavioralBoundaries: string[];
  expressionStyle: {
    persona: string;
    tone: string;
    verbosity: string;
    languages: string[];
    vocabularyHints?: string[];
  };
  toolPolicy: {
    allowedTools: string[];
    requireConfirmation: string[];
    forbiddenTools: string[];
    maxIterations: number;
    securityOverrides?: Record<string, string>;
  };
  memoryPolicy: {
    retrieveLimit: number;
    minConfidence: number;
    includeTypes: string[];
    autoExtract: boolean;
  };
  ttsVoiceId?: string;
  personalityVector?: {
    cognitiveStyle: { analytical: number; intuitive: number; systematic: number; creative: number };
    socialStyle: { warmth: number; directness: number; playfulness: number; formality: number };
  };
  evolutionConfig?: {
    plasticity: number;
    minMemoriesForEvolution: number;
    minConnectionForEvolution: number;
    cooldownMs: number;
    maxMutationsPerStep: number;
  };
  lastEvolvedAt?: string | null;
  growthState?: {
    version: number;
    lastUpdatedAt: string;
    ownerInterests: string[];
    ownerExpressions: string[];
    communicationPatterns: string[];
    adaptationNotes: string[];
    ownerProfile?: {
      memoryCount: number;
      dominantTone: string;
      formalityLevel: number;
      emotionalExpressiveness: number;
    };
  };
  evolutionFrozenAt?: string | null;
}

export function PersonalityEditor({ t }: { t?: any }) {
  const [tab, setTab] = useState<'personality' | 'contacts'>('personality');
  const [config, setConfig] = useState<PersonalityConfig | null>(null);
  const [loading, setLoading] = useState(true);
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    identity: true,
    growth: true,
    boundaries: false,
    expression: false,
    evolution: true,
    tools: false,
    memory: false,
  });
  const isZh = t?.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);

  const toggleSection = (s: string) => setExpandedSections(prev => ({ ...prev, [s]: !prev[s] }));

  useEffect(() => {
    fetch('/api/personalities')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setConfig(data[0]);
        }
      })
      .catch(() => toast.error(t?.failedToLoadPersonalities || ui('Lumi 配置加载失败', 'Failed to load Lumi config')))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center gap-3">
          <User className="text-celestial-saturn" />
          <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">{t?.lumiCore || ui('Lumi 人格核心配置', 'Lumi Core Config')}</h3>
        </div>
        <p className="text-white/40 text-sm">{t?.loadingPersonalities || ui('加载中...', 'Loading...')}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center gap-3">
          <User className="text-celestial-saturn" />
          <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">{t?.lumiCore || ui('Lumi 人格核心配置', 'Lumi Core Config')}</h3>
        </div>
        <p className="text-white/40 text-sm">{t?.noPersonalitiesDefined || ui('未找到配置。', 'No configuration found.')}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Tab bar */}
      <div className="flex items-center gap-1 p-1 bg-white/5 rounded-xl border border-white/5">
        {[
          { id: 'personality' as const, label: t?.lumiCore || ui('人格核心', 'Personality'), icon: <User size={14} /> },
          { id: 'contacts' as const, label: t?.contacts || ui('联系人', 'Contacts'), icon: <Users size={14} /> },
        ].map(item => (
          <button
            key={item.id}
            onClick={() => setTab(item.id)}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-bold uppercase tracking-widest transition-all ${
              tab === item.id ? 'bg-white/10 text-white' : 'text-white/40 hover:text-white/70'
            }`}
          >
            {item.icon}
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'contacts' ? (
        <ContactsPanel />
      ) : (
        <>
      <div className="flex items-center gap-3">
        <User className="text-celestial-saturn" />
        <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">{t?.lumiCore || ui('Lumi 人格核心配置', 'Lumi Core Config')}</h3>
        <span className="text-xs font-mono text-white/45 bg-white/5 px-2 py-0.5 rounded-full">v{config.version}</span>
      </div>

      <p className="text-sm text-white/40 max-w-xl">
        {t?.lumiCoreDesc || ui('Lumi 的人格核心会从互动中通过 Hebbian 学习自然成长。这个视图展示当前配置；变化会自动发生，不需要手动硬改。', 'Lumi\'s core personality evolves organically through Hebbian learning from interactions. This view shows the current configuration — changes happen automatically, not through manual editing.')}
      </p>

      <div className="space-y-4">
        {/* Identity */}
        <Section title={t?.identitySection || ui('身份', 'Identity')} section="identity" expanded={expandedSections} onToggle={toggleSection}>
          <ReadonlyField label={t?.idLabel || 'ID'} value={config.id} mono />
          <ReadonlyField label={t?.nameLabel || ui('名称', 'Name')} value={config.name} />
          <ReadonlyField label={t?.versionLabel || ui('版本', 'Version')} value={config.version} />
          <div className="space-y-1">
            <label className="text-xs font-black uppercase text-white/55">{t?.coreMotivationLabel || ui('核心动机', 'Core Motivation')}</label>
            <p className="text-sm text-white/60 bg-white/5 rounded-xl p-3">{config.coreMotivation}</p>
          </div>
          <ReadonlyField label={ui('演化状态', 'Evolution')} value={config.evolutionFrozenAt ? ui(`自 ${new Date(config.evolutionFrozenAt).toLocaleString()} 起冻结`, `Frozen since ${new Date(config.evolutionFrozenAt).toLocaleString()}`) : ui('活跃', 'Active')} />
        </Section>

        {/* Growth State */}
        <Section title={ui('本地成长状态', 'Local Growth State')} section="growth" expanded={expandedSections} onToggle={toggleSection}>
          {config.growthState ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <ReadonlyField label={ui('成长版本', 'Growth Version')} value={String(config.growthState.version)} />
                <ReadonlyField label={ui('最近更新', 'Last Updated')} value={new Date(config.growthState.lastUpdatedAt).toLocaleString()} />
              </div>
              {config.growthState.ownerProfile && (
                <div className="grid grid-cols-2 gap-4">
                  <ReadonlyField label={ui('观察到的语气', 'Observed Tone')} value={config.growthState.ownerProfile.dominantTone} />
                  <ReadonlyField label={ui('画像记忆数', 'Profile Memories')} value={String(config.growthState.ownerProfile.memoryCount)} />
                </div>
              )}
              <ReadonlyField label={ui('用户兴趣', 'Owner Interests')} value={(config.growthState.ownerInterests || []).join(', ') || ui('无', 'none')} />
              <ReadonlyField label={ui('用户表达习惯', 'Owner Expressions')} value={(config.growthState.ownerExpressions || []).join(', ') || ui('无', 'none')} />
              <ReadonlyField label={ui('沟通模式', 'Communication Patterns')} value={(config.growthState.communicationPatterns || []).join('; ') || ui('无', 'none')} />
            </div>
          ) : (
            <p className="text-white/45 text-xs">{ui('还没有本地成长状态。Lumi 会从已确认的互动模式中逐步建立。', 'No local growth state yet. Lumi will build this from confirmed interaction patterns.')}</p>
          )}
        </Section>

        {/* Evolution Vector */}
        <Section title={t?.evolutionVector || ui('演化向量', 'Evolution Vector')} section="evolution" expanded={expandedSections} onToggle={toggleSection}>
          {config.personalityVector ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-black uppercase text-white/55 block mb-2">{ui('认知风格', 'Cognitive Style')}</label>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(config.personalityVector.cognitiveStyle).map(([k, v]) => (
                    <div key={k} className="text-center p-3 bg-white/5 rounded-xl">
                      <div className="text-lg font-black text-celestial-saturn">{(v * 100).toFixed(0)}%</div>
                      <div className="text-[12px] text-white/55 uppercase">{k}</div>
                    </div>
                  ))}
                </div>
              </div>
              <div>
                <label className="text-xs font-black uppercase text-white/55 block mb-2">{ui('社交风格', 'Social Style')}</label>
                <div className="grid grid-cols-4 gap-2">
                  {Object.entries(config.personalityVector.socialStyle).map(([k, v]) => (
                    <div key={k} className="text-center p-3 bg-white/5 rounded-xl">
                      <div className="text-lg font-black text-violet-400">{(v * 100).toFixed(0)}%</div>
                      <div className="text-[12px] text-white/55 uppercase">{k}</div>
                    </div>
                  ))}
                </div>
              </div>
              {config.evolutionConfig && (
                <div className="text-xs text-white/45 space-y-1">
                  <div>{ui('可塑性', 'Plasticity')}: {config.evolutionConfig.plasticity} | {ui('冷却', 'Cooldown')}: {Math.round(config.evolutionConfig.cooldownMs / 86400000)}d | {ui('每步最大变异', 'Max mutations/step')}: {config.evolutionConfig.maxMutationsPerStep}</div>
                  {config.lastEvolvedAt && <div>{ui('最近演化', 'Last evolved')}: {new Date(config.lastEvolvedAt).toLocaleDateString()}</div>}
                </div>
              )}
            </div>
          ) : (
            <p className="text-white/55 text-xs">{t?.evolutionNotInit || ui('演化向量尚未初始化，会在首次互动时生成种子。', 'Evolution vector not yet initialized. It will be seeded on first interaction.')}</p>
          )}
        </Section>

        {/* Expression */}
        <Section title={t?.expressionStyleSection || ui('表达风格', 'Expression Style')} section="expression" expanded={expandedSections} onToggle={toggleSection}>
          <ReadonlyField label={t?.personaField || ui('人格表现', 'Persona')} value={config.expressionStyle.persona} />
          <div className="grid grid-cols-2 gap-4">
            <ReadonlyField label={t?.toneField || ui('语气', 'Tone')} value={config.expressionStyle.tone} />
            <ReadonlyField label={t?.verbosityField || ui('详略程度', 'Verbosity')} value={config.expressionStyle.verbosity} />
          </div>
          <ReadonlyField label={t?.languagesField || ui('语言', 'Languages')} value={config.expressionStyle.languages.join(', ')} />
          {config.expressionStyle.vocabularyHints && config.expressionStyle.vocabularyHints.length > 0 && (
            <ReadonlyField label={t?.vocabularyHints || ui('词汇提示', 'Vocabulary Hints')} value={config.expressionStyle.vocabularyHints.join(', ')} />
          )}
          <ReadonlyField label={t?.ttsVoice || ui('TTS 声音', 'TTS Voice')} value={config.ttsVoiceId || t?.defaultVoice || ui('默认', 'default')} />
        </Section>

        {/* Boundaries */}
        <Section title={t?.behavioralBoundariesSection || ui('行为边界', 'Behavioral Boundaries')} section="boundaries" expanded={expandedSections} onToggle={toggleSection}>
          {config.behavioralBoundaries.map((b, i) => (
            <div key={i} className="flex items-center gap-2 p-3 bg-white/5 rounded-xl">
              <Activity size={12} className="text-celestial-saturn/50 shrink-0" />
              <span className="text-sm text-white/60">{b}</span>
            </div>
          ))}
          {config.behavioralBoundaries.length === 0 && (
            <p className="text-white/45 text-xs">{t?.noBoundariesDefined || ui('尚未定义边界。', 'No boundaries defined.')}</p>
          )}
        </Section>

        {/* Tool Policy */}
        <Section title={t?.toolPolicySection || ui('工具策略', 'Tool Policy')} section="tools" expanded={expandedSections} onToggle={toggleSection}>
          <ReadonlyField label={t?.allowedToolsField || ui('允许工具', 'Allowed Tools')} value={(config.toolPolicy.allowedTools || ['*']).join(', ')} />
          <ReadonlyField label={t?.requireConfirmationField || ui('需要确认', 'Require Confirmation')} value={(config.toolPolicy.requireConfirmation || []).join(', ') || ui('无', 'none')} />
          <ReadonlyField label={t?.forbiddenToolsField || ui('禁用工具', 'Forbidden Tools')} value={(config.toolPolicy.forbiddenTools || []).join(', ') || ui('无', 'none')} />
          <ReadonlyField label={t?.maxIterationsField || ui('最大迭代次数', 'Max Iterations')} value={String(config.toolPolicy.maxIterations)} />
        </Section>

        {/* Memory Policy */}
        <Section title={t?.memoryPolicySection || ui('记忆策略', 'Memory Policy')} section="memory" expanded={expandedSections} onToggle={toggleSection}>
          <div className="grid grid-cols-2 gap-4">
            <ReadonlyField label={t?.retrieveLimitField || ui('检索上限', 'Retrieve Limit')} value={String(config.memoryPolicy.retrieveLimit)} />
            <ReadonlyField label={t?.minConfidenceField || ui('最低置信度', 'Min Confidence')} value={String(config.memoryPolicy.minConfidence)} />
          </div>
          <ReadonlyField label={t?.includeTypesField || ui('包含类型', 'Include Types')} value={config.memoryPolicy.includeTypes.join(', ')} />
          <ReadonlyField label={t?.autoExtractLabel || ui('自动提取', 'Auto-extract')} value={config.memoryPolicy.autoExtract ? ui('是', 'Yes') : ui('否', 'No')} />
        </Section>

      </div>

      {/* Evolution History + Radar */}
      <div className="rounded-2xl overflow-hidden">
        <PersonalityEvolution />
      </div>
        </>
      )}
    </div>
  );
}

// Sub-components

function Section({ title, section, expanded, onToggle, children }: {
  title: string;
  section: string;
  expanded: Record<string, boolean>;
  onToggle: (s: string) => void;
  children: React.ReactNode;
}) {
  const open = expanded[section] !== false;
  return (
    <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
      <button onClick={() => onToggle(section)} className="flex items-center gap-2 text-xs font-black uppercase tracking-widest text-white/50 hover:text-white/80 w-full text-left">
        {open ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
        {title}
      </button>
      {open && <div className="space-y-3">{children}</div>}
    </div>
  );
}

function ReadonlyField({ label, value, mono }: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs font-black uppercase text-white/55">{label}</label>
      <div className={`w-full bg-white/5 border border-white/5 rounded-xl px-3 py-2 text-sm text-white/60 ${mono ? 'font-mono' : ''}`}>
        {value || <span className="text-white/45">—</span>}
      </div>
    </div>
  );
}
