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

  const toggleSection = (s: string) => setExpandedSections(prev => ({ ...prev, [s]: !prev[s] }));

  useEffect(() => {
    fetch('/api/personalities')
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setConfig(data[0]);
        }
      })
      .catch(() => toast.error(t?.failedToLoadPersonalities || 'Failed to load Lumi config'))
      .finally(() => setLoading(false));
  }, []);

  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center gap-3">
          <User className="text-celestial-saturn" />
          <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">{t?.lumiCore || 'Lumi Core Config'}</h3>
        </div>
        <p className="text-white/40 text-sm">{t?.loadingPersonalities || 'Loading...'}</p>
      </div>
    );
  }

  if (!config) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center gap-3">
          <User className="text-celestial-saturn" />
          <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">{t?.lumiCore || 'Lumi Core Config'}</h3>
        </div>
        <p className="text-white/40 text-sm">{t?.noPersonalitiesDefined || 'No configuration found.'}</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      {/* Tab bar */}
      <div className="flex items-center gap-1 p-1 bg-white/5 rounded-xl border border-white/5">
        {[
          { id: 'personality' as const, label: t?.lumiCore || 'Personality', icon: <User size={14} /> },
          { id: 'contacts' as const, label: t?.contacts || 'Contacts', icon: <Users size={14} /> },
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
        <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">{t?.lumiCore || 'Lumi Core Config'}</h3>
        <span className="text-xs font-mono text-white/45 bg-white/5 px-2 py-0.5 rounded-full">v{config.version}</span>
      </div>

      <p className="text-sm text-white/40 max-w-xl">
        {t?.lumiCoreDesc || 'Lumi\'s core personality evolves organically through Hebbian learning from interactions. This view shows the current configuration — changes happen automatically, not through manual editing.'}
      </p>

      <div className="space-y-4">
        {/* Identity */}
        <Section title={t?.identitySection || 'Identity'} section="identity" expanded={expandedSections} onToggle={toggleSection}>
          <ReadonlyField label={t?.idLabel || 'ID'} value={config.id} mono />
          <ReadonlyField label={t?.nameLabel || 'Name'} value={config.name} />
          <ReadonlyField label={t?.versionLabel || 'Version'} value={config.version} />
          <div className="space-y-1">
            <label className="text-xs font-black uppercase text-white/55">{t?.coreMotivationLabel || 'Core Motivation'}</label>
            <p className="text-sm text-white/60 bg-white/5 rounded-xl p-3">{config.coreMotivation}</p>
          </div>
          <ReadonlyField label="Evolution" value={config.evolutionFrozenAt ? `Frozen since ${new Date(config.evolutionFrozenAt).toLocaleString()}` : 'Active'} />
        </Section>

        {/* Growth State */}
        <Section title="Local Growth State" section="growth" expanded={expandedSections} onToggle={toggleSection}>
          {config.growthState ? (
            <div className="space-y-3">
              <div className="grid grid-cols-2 gap-4">
                <ReadonlyField label="Growth Version" value={String(config.growthState.version)} />
                <ReadonlyField label="Last Updated" value={new Date(config.growthState.lastUpdatedAt).toLocaleString()} />
              </div>
              {config.growthState.ownerProfile && (
                <div className="grid grid-cols-2 gap-4">
                  <ReadonlyField label="Observed Tone" value={config.growthState.ownerProfile.dominantTone} />
                  <ReadonlyField label="Profile Memories" value={String(config.growthState.ownerProfile.memoryCount)} />
                </div>
              )}
              <ReadonlyField label="Owner Interests" value={(config.growthState.ownerInterests || []).join(', ') || 'none'} />
              <ReadonlyField label="Owner Expressions" value={(config.growthState.ownerExpressions || []).join(', ') || 'none'} />
              <ReadonlyField label="Communication Patterns" value={(config.growthState.communicationPatterns || []).join('; ') || 'none'} />
            </div>
          ) : (
            <p className="text-white/45 text-xs">No local growth state yet. Lumi will build this from confirmed interaction patterns.</p>
          )}
        </Section>

        {/* Evolution Vector */}
        <Section title={t?.evolutionVector || 'Evolution Vector'} section="evolution" expanded={expandedSections} onToggle={toggleSection}>
          {config.personalityVector ? (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-black uppercase text-white/55 block mb-2">Cognitive Style</label>
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
                <label className="text-xs font-black uppercase text-white/55 block mb-2">Social Style</label>
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
                  <div>Plasticity: {config.evolutionConfig.plasticity} | Cooldown: {Math.round(config.evolutionConfig.cooldownMs / 86400000)}d | Max mutations/step: {config.evolutionConfig.maxMutationsPerStep}</div>
                  {config.lastEvolvedAt && <div>Last evolved: {new Date(config.lastEvolvedAt).toLocaleDateString()}</div>}
                </div>
              )}
            </div>
          ) : (
            <p className="text-white/55 text-xs">{t?.evolutionNotInit || 'Evolution vector not yet initialized. It will be seeded on first interaction.'}</p>
          )}
        </Section>

        {/* Expression */}
        <Section title={t?.expressionStyleSection || 'Expression Style'} section="expression" expanded={expandedSections} onToggle={toggleSection}>
          <ReadonlyField label={t?.personaField || 'Persona'} value={config.expressionStyle.persona} />
          <div className="grid grid-cols-2 gap-4">
            <ReadonlyField label={t?.toneField || 'Tone'} value={config.expressionStyle.tone} />
            <ReadonlyField label={t?.verbosityField || 'Verbosity'} value={config.expressionStyle.verbosity} />
          </div>
          <ReadonlyField label={t?.languagesField || 'Languages'} value={config.expressionStyle.languages.join(', ')} />
          {config.expressionStyle.vocabularyHints && config.expressionStyle.vocabularyHints.length > 0 && (
            <ReadonlyField label={t?.vocabularyHints || 'Vocabulary Hints'} value={config.expressionStyle.vocabularyHints.join(', ')} />
          )}
          <ReadonlyField label={t?.ttsVoice || 'TTS Voice'} value={config.ttsVoiceId || t?.defaultVoice || 'default'} />
        </Section>

        {/* Boundaries */}
        <Section title={t?.behavioralBoundariesSection || 'Behavioral Boundaries'} section="boundaries" expanded={expandedSections} onToggle={toggleSection}>
          {config.behavioralBoundaries.map((b, i) => (
            <div key={i} className="flex items-center gap-2 p-3 bg-white/5 rounded-xl">
              <Activity size={12} className="text-celestial-saturn/50 shrink-0" />
              <span className="text-sm text-white/60">{b}</span>
            </div>
          ))}
          {config.behavioralBoundaries.length === 0 && (
            <p className="text-white/45 text-xs">{t?.noBoundariesDefined || 'No boundaries defined.'}</p>
          )}
        </Section>

        {/* Tool Policy */}
        <Section title={t?.toolPolicySection || 'Tool Policy'} section="tools" expanded={expandedSections} onToggle={toggleSection}>
          <ReadonlyField label={t?.allowedToolsField || 'Allowed Tools'} value={(config.toolPolicy.allowedTools || ['*']).join(', ')} />
          <ReadonlyField label={t?.requireConfirmationField || 'Require Confirmation'} value={(config.toolPolicy.requireConfirmation || []).join(', ') || 'none'} />
          <ReadonlyField label={t?.forbiddenToolsField || 'Forbidden Tools'} value={(config.toolPolicy.forbiddenTools || []).join(', ') || 'none'} />
          <ReadonlyField label={t?.maxIterationsField || 'Max Iterations'} value={String(config.toolPolicy.maxIterations)} />
        </Section>

        {/* Memory Policy */}
        <Section title={t?.memoryPolicySection || 'Memory Policy'} section="memory" expanded={expandedSections} onToggle={toggleSection}>
          <div className="grid grid-cols-2 gap-4">
            <ReadonlyField label={t?.retrieveLimitField || 'Retrieve Limit'} value={String(config.memoryPolicy.retrieveLimit)} />
            <ReadonlyField label={t?.minConfidenceField || 'Min Confidence'} value={String(config.memoryPolicy.minConfidence)} />
          </div>
          <ReadonlyField label={t?.includeTypesField || 'Include Types'} value={config.memoryPolicy.includeTypes.join(', ')} />
          <ReadonlyField label={t?.autoExtractLabel || 'Auto-extract'} value={config.memoryPolicy.autoExtract ? 'Yes' : 'No'} />
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
