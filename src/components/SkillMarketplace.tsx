import React, { useState } from 'react';
import { Zap, ShoppingBag, User, Star, Download, CheckCircle, RefreshCw, Sparkles } from 'lucide-react';
import { GlassCard } from './SharedUI';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useModuleData } from '@/hooks/useModuleData';
import { toast } from 'sonner';

export function SkillMarketplace({ t }: { t: any }) {
  const { data: marketSkills, loading: marketLoading, error: marketError } = useModuleData<any[]>('/api/marketplace/skills');
  const [acquired, setAcquired] = useState<Set<string>>(() => {
    try { return new Set(JSON.parse(localStorage.getItem('lumi_acquired_skills') || '[]')); } catch { return new Set(); }
  });
  // Generation state
  const [genDescription, setGenDescription] = useState('');
  const [generating, setGenerating] = useState(false);
  const [showGenPanel, setShowGenPanel] = useState(false);

  // Install state
  const [installUrl, setInstallUrl] = useState('');
  const [installing, setInstalling] = useState(false);
  const [showInstallPanel, setShowInstallPanel] = useState(false);

  const containerRef = React.useRef<HTMLDivElement>(null);

  const handleAcquire = async (skill: any) => {
    if (acquired.has(skill.id)) return;
    try {
      const res = await fetch('/api/marketplace/skills/acquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: skill.id, skillName: skill.name }),
      });
      if (res.ok) {
        const next = new Set(acquired);
        next.add(skill.id);
        setAcquired(next);
        localStorage.setItem('lumi_acquired_skills', JSON.stringify([...next]));
        toast.success(`Acquired: ${skill.name}`);
      } else {
        toast.error('Failed to acquire');
      }
    } catch {
      toast.error('Connection error');
    }
  };

  const handleGenerate = async () => {
    if (!genDescription.trim()) return;
    setGenerating(true);
    try {
      const res = await fetch('/api/skills/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ description: genDescription }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Skill "${data.skillName}" generated!`);
        setGenDescription('');
        setShowGenPanel(false);
      } else {
        toast.error(data.error || 'Generation failed');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setGenerating(false);
    }
  };

  const handleInstall = async () => {
    if (!installUrl.trim()) return;
    setInstalling(true);
    try {
      const isGit = installUrl.startsWith('http') || installUrl.startsWith('git@');
      const res = await fetch('/api/skills/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          source: isGit ? 'git' : 'local',
          url: isGit ? installUrl : undefined,
          path: !isGit ? installUrl : undefined,
          name: installUrl.split('/').pop()?.replace('.git', ''),
        }),
      });
      const data = await res.json();
      if (data.success) {
        toast.success(`Skill "${data.name}" installed!`);
        setInstallUrl('');
        setShowInstallPanel(false);
      } else {
        toast.error(data.error || 'Install failed');
      }
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setInstalling(false);
    }
  };

  React.useEffect(() => {
    const handleScroll = (e: any) => {
      const category = e.detail;
      if (category === t.marketplace && containerRef.current) {
        const offset = 100;
        const elementPosition = containerRef.current.getBoundingClientRect().top;
        const offsetPosition = elementPosition + window.pageYOffset - offset;
        window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
      }
    };
    window.addEventListener('scroll-to-eco', handleScroll);
    return () => window.removeEventListener('scroll-to-eco', handleScroll);
  }, [t.marketplace]);

  return (
    <div className="max-w-6xl mx-auto space-y-12" ref={containerRef}>
      {/* Header */}
      <div className="text-center space-y-4">
        <h2 className="text-4xl font-bold tracking-tighter glow-text">
          {t.marketplaceLoRA || "Skill Registry"}
        </h2>
        <p className="text-white/40 max-w-2xl mx-auto">
          Manage Lumi's skills — auto-generated from experience, installed from the community, or acquired from the marketplace.
        </p>
      </div>

      {/* Action bar */}
      <div className="flex items-center gap-3 justify-center flex-wrap">
        <Button
          onClick={() => setShowGenPanel(!showGenPanel)}
          className="bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 border border-emerald-500/20 text-xs font-bold px-4 py-2 rounded-xl"
        >
          <Sparkles size={14} className="mr-1" /> Generate Skill
        </Button>
        <Button
          onClick={() => setShowInstallPanel(!showInstallPanel)}
          className="bg-violet-500/10 text-violet-300 hover:bg-violet-500/20 border border-violet-500/20 text-xs font-bold px-4 py-2 rounded-xl"
        >
          <Download size={14} className="mr-1" /> Install from URL
        </Button>
      </div>

      {/* Generation panel */}
      {showGenPanel && (
        <div className="p-6 bg-emerald-500/5 rounded-3xl border border-emerald-500/20 space-y-4">
          <h4 className="text-sm font-bold text-emerald-300 flex items-center gap-2">
            <Sparkles size={16} /> Generate a new skill from description
          </h4>
          <p className="text-xs text-white/40">
            Describe what the skill should do. Lumi will generate an MCP server package with tools, parameters, and documentation.
          </p>
          <div className="flex gap-3">
            <Input
              value={genDescription}
              onChange={e => setGenDescription(e.target.value)}
              placeholder="e.g. Generate a weekly report from database data and send it via email"
              className="flex-1 bg-white/5 border-white/10 rounded-xl py-2 text-sm"
              onKeyDown={e => e.key === 'Enter' && handleGenerate()}
            />
            <Button
              onClick={handleGenerate}
              disabled={generating || !genDescription.trim()}
              className="bg-emerald-500 text-black font-bold text-xs px-6 py-2 rounded-xl hover:scale-105 transition-transform disabled:opacity-40"
            >
              {generating ? 'Generating...' : 'Generate'}
            </Button>
          </div>
        </div>
      )}

      {/* Install panel */}
      {showInstallPanel && (
        <div className="p-6 bg-violet-500/5 rounded-3xl border border-violet-500/20 space-y-4">
          <h4 className="text-sm font-bold text-violet-300 flex items-center gap-2">
            <Download size={16} /> Install a skill from Git URL or local path
          </h4>
          <p className="text-xs text-white/40">
            Paste a Git repository URL (e.g. https://github.com/user/lumi-skill-xxx) or a local directory path.
          </p>
          <div className="flex gap-3">
            <Input
              value={installUrl}
              onChange={e => setInstallUrl(e.target.value)}
              placeholder="https://github.com/user/lumi-skill-example"
              className="flex-1 bg-white/5 border-white/10 rounded-xl py-2 text-sm"
              onKeyDown={e => e.key === 'Enter' && handleInstall()}
            />
            <Button
              onClick={handleInstall}
              disabled={installing || !installUrl.trim()}
              className="bg-violet-500 text-black font-bold text-xs px-6 py-2 rounded-xl hover:scale-105 transition-transform disabled:opacity-40"
            >
              {installing ? 'Installing...' : 'Install'}
            </Button>
          </div>
        </div>
      )}

      {/* Marketplace skills */}
      {marketError && (
        <div className="p-6 bg-red-500/5 rounded-3xl border border-red-500/20 text-center">
          <p className="text-red-400 text-sm font-bold">Failed to load marketplace skills</p>
        </div>
      )}
      {!marketError && marketSkills && marketSkills.length > 0 && (
        <div className="space-y-4">
          <h3 className="text-lg font-bold text-white/80 flex items-center gap-2">
            <ShoppingBag size={18} className="text-celestial-saturn" />
            {t.marketplaceLoRA || "Marketplace"}
          </h3>
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {marketSkills.map((skill: any) => (
              <SkillCard key={skill.id} skill={skill} t={t} isAcquired={acquired.has(skill.id)} onAcquire={() => handleAcquire(skill)} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

function SkillCard({ skill, t, isAcquired, onAcquire }: { skill: any; t: any; isAcquired: boolean; onAcquire: () => void }) {
  return (
    <GlassCard className="p-6 space-y-6 flex flex-col h-full group">
      <div className="flex items-start justify-between">
        <div className="w-12 h-12 rounded-2xl bg-celestial-saturn/10 flex items-center justify-center text-celestial-saturn">
          <Zap size={24} />
        </div>
        <div className="px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[10px] font-bold uppercase tracking-widest text-white/40">
          {skill.category}
        </div>
      </div>

      <div className="space-y-2 flex-1">
        <h3 className="text-xl font-bold tracking-tighter group-hover:text-celestial-saturn transition-colors">{skill.name}</h3>
        <p className="text-sm text-white/40 leading-relaxed">{skill.description}</p>
      </div>

      <div className="pt-6 border-t border-white/5 space-y-4">
        <div className="flex items-center justify-between text-xs">
          <div className="flex items-center gap-2 text-white/60">
            <User size={14} />
            {skill.author}
          </div>
          {skill.rating != null && (
            <div className="flex items-center gap-1 text-celestial-saturn">
              <Star size={14} fill="currentColor" />
              {skill.rating}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between">
          <div className="text-xl font-bold flex items-center gap-1">
            <Zap size={18} fill="currentColor" className="text-celestial-saturn" />
            {skill.price}
          </div>
          {isAcquired ? (
            <div className="flex items-center gap-1 text-green-500 text-xs font-bold uppercase tracking-widest">
              <CheckCircle size={14} />
              Acquired
            </div>
          ) : (
            <Button
              onClick={onAcquire}
              className="rounded-xl bg-celestial-saturn text-black font-bold h-10 px-6 hover:scale-105 transition-transform flex items-center gap-2"
            >
              <Download size={16} />
              {t.acquire || "Acquire"}
            </Button>
          )}
        </div>
      </div>
    </GlassCard>
  );
}
