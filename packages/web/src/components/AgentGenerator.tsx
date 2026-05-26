import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Upload, FileText, Rocket, Shield, Cpu, Heart, Users, User, Briefcase, Mic, X, Trash2, Sparkles, Database, Zap } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import { GlassCard, IconBox, FeatureItem } from './SharedUI';
import { useApp } from '../contexts/AppContext';

export function AgentGenerator({ t, onChatAgent }: { t: any; onChatAgent?: (agent: any) => void }) {
  const { createAgent, deleteAgent, agents, user, login } = useApp();
  const [currentStep, setCurrentStep] = useState(1);
  const [isGenerating, setIsGenerating] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [agentName, setAgentName] = useState('');
  const [selectedCategory, setSelectedCategory] = useState('friend');
  const [isCloning, setIsCloning] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generationTimeoutRef = React.useRef<any>(null);
  const sectionRefs = React.useRef<{ [key: string]: HTMLElement | null }>({});

  React.useEffect(() => {
    const scrollToSection = (element: HTMLElement | null) => {
      if (!element) return;
      const offset = 100;
      const elementPosition = element.getBoundingClientRect().top;
      const offsetPosition = elementPosition + window.pageYOffset - offset;
      window.scrollTo({ top: offsetPosition, behavior: 'smooth' });
    };

    const handleScroll = (e: any) => {
      const category = e.detail;
      if (category === t.identityData || category === t.neuralTemplates) {
        setCurrentStep(1);
      }

      window.setTimeout(() => {
        scrollToSection(sectionRefs.current[category]);
      }, 0);
    };

    window.addEventListener('scroll-to-gen', handleScroll);
    return () => window.removeEventListener('scroll-to-gen', handleScroll);
  }, [t.identityData, t.neuralTemplates]);

  const steps = [
    { id: 1, title: t.identityData || 'Identity', icon: <User size={20} /> },
    { id: 2, title: t.uploadFiles || 'Data Infusion', icon: <Database size={20} /> },
    { id: 3, title: t.neuralSynthesis || 'Synthesis', icon: <Zap size={20} /> }
  ];

  const categorySkills: Record<string, { name: string; desc: string }> = {
    colleague: { name: 'Colleague Skill (同事技能包)', desc: 'Professional knowledge, work habits, and collaborative logic.' },
    family: { name: 'Ancestor Skill (祖先技能包)', desc: 'Family history, wisdom, and ancestral voice synthesis.' },
    friend: { name: 'Kindred Mind Skill (知己技能包)', desc: 'Emotional resonance, shared memories, and deep empathy.' },
    lover: { name: 'Ex-Partner Skill (前任技能包)', desc: 'Relationship dynamics, intimate communication, and closure logic.' }
  };

  const handleUpload = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    setFiles(prev => {
      const existingNames = new Set(prev.map(f => f.name));
      const newcomers = selected.filter(f => !existingNames.has(f.name));
      return [...prev, ...newcomers];
    });
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const removeFile = (fileName: string) => {
    setFiles(prev => prev.filter(f => f.name !== fileName));
  };

  const handleGenerate = async () => {
    if (!user) {
      login();
      return;
    }
    if (!agentName || files.length === 0) return;
    setIsGenerating(true);

    try {
      const formData = new FormData();
      files.forEach(f => formData.append('files', f));
      const uploadRes = await fetch('/api/files/upload', { method: 'POST', body: formData });
      if (!uploadRes.ok) throw new Error('Upload failed');
      const uploaded = await uploadRes.json();

      await createAgent(agentName, selectedCategory, { files: uploaded.uploaded, voiceCloned: isCloning });
      setAgentName('');
      setFiles([]);
      setCurrentStep(1);
    } catch (err: any) {
      console.error('Synthesis error:', err);
    } finally {
      setIsGenerating(false);
    }
  };

  const cancelGeneration = () => {
    if (generationTimeoutRef.current) {
      clearTimeout(generationTimeoutRef.current);
      setIsGenerating(false);
    }
  };

  const startVoiceCloning = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      setIsCloning(true);
      const mediaRecorder = new MediaRecorder(stream);
      const chunks: BlobPart[] = [];
      mediaRecorder.ondataavailable = e => chunks.push(e.data);
      mediaRecorder.onstop = async () => {
        stream.getTracks().forEach(t => t.stop());
        const blob = new Blob(chunks, { type: 'audio/webm' });
        const formData = new FormData();
        formData.append('audio', blob, 'voice_sample.webm');
        try {
          const res = await fetch('/api/voice/samples', { method: 'POST', body: formData });
          if (res.ok) {
            toast.success('Voice sample captured. Go to Voice Forge to clone.');
          } else {
            toast.error('Failed to upload voice sample');
          }
        } catch {
          toast.error('Upload failed');
        }
        setIsCloning(false);
      };
      mediaRecorder.start();
      setTimeout(() => { if (mediaRecorder.state === 'recording') mediaRecorder.stop(); }, 5000);
      toast.info('Recording 5-second sample...');
    } catch {
      toast.error('Microphone access denied');
    }
  };

  return (
    <div className="max-w-7xl mx-auto space-y-16 relative">
      <AnimatePresence>
        {isGenerating && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-[100] bg-celestial-deep/80 backdrop-blur-xl flex flex-col items-center justify-center overflow-hidden"
          >
            <div className="relative w-80 h-80">
              <motion.div
                animate={{
                  scale: [1, 1.3, 1],
                  opacity: [0.3, 0.6, 0.3],
                  rotate: [0, 360]
                }}
                transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                className="absolute inset-0 border border-celestial-saturn/20 rounded-full blur-sm"
              />
              <motion.div
                animate={{
                  scale: [1.2, 1, 1.2],
                  opacity: [0.2, 0.5, 0.2],
                  rotate: [360, 0]
                }}
                transition={{ duration: 12, repeat: Infinity, ease: "linear" }}
                className="absolute inset-[-20px] border border-celestial-nebula/20 rounded-full blur-md"
              />

              <motion.div
                animate={{
                  scale: [1, 1.2, 1],
                  opacity: [0.5, 0.9, 0.5]
                }}
                transition={{ duration: 2, repeat: Infinity }}
                className="absolute inset-10 neural-core-glow rounded-full shadow-[0_0_100px_rgba(255,204,0,0.3)]"
              />

              <div className="absolute inset-0 flex items-center justify-center z-10">
                <motion.div
                  animate={{ y: [0, -10, 0] }}
                  transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
                >
                  <Cpu size={80} className="text-celestial-saturn filter drop-shadow-[0_0_15px_rgba(255,204,0,0.5)]" />
                </motion.div>
              </div>

              {[...Array(40)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ scale: 0, opacity: 0, x: 0, y: 0 }}
                  animate={{
                    scale: [0, 1, 0],
                    opacity: [0, 1, 0],
                    x: (Math.random() - 0.5) * 400,
                    y: (Math.random() - 0.5) * 400,
                  }}
                  transition={{
                    duration: 2 + Math.random() * 2,
                    repeat: Infinity,
                    delay: Math.random() * 2,
                    ease: "easeOut"
                  }}
                  className={`absolute left-1/2 top-1/2 w-1 h-1 rounded-full ${i % 2 === 0 ? 'bg-celestial-saturn' : 'bg-celestial-nebula'} shadow-[0_0_8px_currentColor]`}
                />
              ))}

              {[...Array(3)].map((_, i) => (
                <motion.div
                  key={i}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 10 + i * 5, repeat: Infinity, ease: "linear" }}
                  className="absolute inset-0 border border-white/5 rounded-full"
                  style={{ scale: 0.8 + i * 0.2 }}
                >
                  <motion.div
                    animate={{ scale: [1, 1.5, 1] }}
                    transition={{ duration: 2, repeat: Infinity, delay: i }}
                    className="absolute top-0 left-1/2 -translate-x-1/2 w-2 h-2 bg-white/20 rounded-full"
                  />
                </motion.div>
              ))}
            </div>

            <div className="mt-12 text-center space-y-4">
              <motion.h2
                animate={{ opacity: [0.4, 1, 0.4] }}
                transition={{ duration: 2, repeat: Infinity }}
                className="text-3xl font-bold tracking-tighter text-celestial-saturn uppercase"
              >
                {t.neuralSynthesis}
              </motion.h2>
              <p className="text-white/40 font-mono text-sm max-w-md">
                {t.weavingEssence}<br/>
                {t.establishingAnchor}
              </p>
              <Button
                onClick={cancelGeneration}
                variant="ghost"
                className="text-white/20 hover:text-red-500 mt-4"
              >
                {t.interruptRitual || 'Interrupt Ritual'}
              </Button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="text-center space-y-6" ref={el => { sectionRefs.current[t.identityData] = el; }}>
        <h1 className="text-6xl font-bold tracking-tighter glow-text">{t.lifeLab}</h1>
        <p className="text-xl text-white/60 max-w-2xl mx-auto italic">
          "{t.lifeLabDesc}"
        </p>
      </div>

      <div className="max-w-3xl mx-auto">
        <div className="flex items-center justify-between relative">
          <div className="absolute top-1/2 left-0 right-0 h-px bg-white/5 -translate-y-1/2 z-0" />
          {steps.map((step) => (
            <div key={step.id} className="relative z-10 flex flex-col items-center gap-3">
              <motion.div
                animate={{
                  backgroundColor: currentStep >= step.id ? 'var(--color-celestial-saturn)' : 'rgba(255,255,255,0.05)',
                  color: currentStep >= step.id ? '#000' : 'rgba(255,255,255,0.4)',
                  scale: currentStep === step.id ? 1.2 : 1
                }}
                className="w-12 h-12 rounded-2xl flex items-center justify-center border border-white/10 backdrop-blur-md transition-colors"
              >
                {step.icon}
              </motion.div>
              <span className={`text-[10px] font-black uppercase tracking-widest ${currentStep >= step.id ? 'text-celestial-saturn' : 'text-white/20'}`}>
                {step.title}
              </span>
            </div>
          ))}
        </div>
      </div>

      <div className="max-w-4xl mx-auto">
        <AnimatePresence mode="wait">
          {currentStep === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <GlassCard className="p-10 rounded-[3rem] space-y-10" hoverEffect={false}>
                <div className="space-y-4">
                  <label className="text-sm font-bold uppercase tracking-widest text-white/40">1. Define Identity</label>
                  <Input
                    value={agentName}
                    onChange={(e) => setAgentName(e.target.value)}
                    placeholder="Enter Agent Name (e.g., Research Assistant)"
                    className="bg-white/5 border-white/10 rounded-2xl p-8 h-auto text-2xl font-bold tracking-tight focus-visible:ring-celestial-saturn/50"
                  />
                </div>

                <div className="space-y-6" ref={el => { sectionRefs.current[t.neuralTemplates] = el; }}>
                  <label className="text-sm font-bold uppercase tracking-widest text-white/40">2. Select Neural Template</label>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <CategoryButton
                      active={selectedCategory === 'colleague'}
                      onClick={() => setSelectedCategory('colleague')}
                      icon={<Briefcase size={20} />}
                      label={t.categoryColleague}
                    />
                    <CategoryButton
                      active={selectedCategory === 'family'}
                      onClick={() => setSelectedCategory('family')}
                      icon={<Users size={20} />}
                      label={t.categoryFamily}
                    />
                    <CategoryButton
                      active={selectedCategory === 'friend'}
                      onClick={() => setSelectedCategory('friend')}
                      icon={<User size={20} />}
                      label={t.categoryFriend}
                    />
                    <CategoryButton
                      active={selectedCategory === 'lover'}
                      onClick={() => setSelectedCategory('lover')}
                      icon={<Heart size={20} />}
                      label={t.categoryLover}
                    />
                  </div>

                  <div className="p-6 bg-white/5 border border-white/10 rounded-3xl space-y-3">
                    <div className="flex items-center gap-2 text-celestial-saturn">
                      <Zap size={16} />
                      <span className="text-sm font-bold uppercase tracking-widest">{categorySkills[selectedCategory].name}</span>
                    </div>
                    <p className="text-xs text-white/40 leading-relaxed">
                      {categorySkills[selectedCategory].desc}
                    </p>
                  </div>
                </div>

                <div className="flex justify-end pt-4">
                  <Button
                    onClick={() => setCurrentStep(2)}
                    disabled={!agentName}
                    className="px-12 py-8 rounded-2xl bg-celestial-saturn text-black font-black text-lg hover:scale-105 transition-transform"
                  >
                    Next: Data Infusion
                  </Button>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {currentStep === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <GlassCard className="p-10 rounded-[3rem] space-y-10" hoverEffect={false}>
                <div className="grid md:grid-cols-2 gap-10">
                  <div className="space-y-6">
                    <label className="text-sm font-bold uppercase tracking-widest text-white/40">Knowledge Base</label>
                    <input
                      ref={fileInputRef}
                      type="file"
                      multiple
                      onChange={handleFileChange}
                      className="hidden"
                      accept=".pdf,.json,.txt,.ts,.js,.py,.md,.csv,.yaml,.yml,.xml,.html,.css"
                    />
                    <div
                      onClick={handleUpload}
                      className="border-2 border-dashed border-white/10 rounded-[3rem] p-12 flex flex-col items-center justify-center gap-6 hover:border-celestial-saturn/30 hover:bg-white/5 transition-all cursor-pointer group aspect-square"
                    >
                      <div className="w-20 h-20 rounded-full bg-celestial-saturn/10 flex items-center justify-center text-celestial-saturn group-hover:scale-110 transition-transform">
                        <Upload size={40} />
                      </div>
                      <div className="text-center space-y-2">
                        <p className="font-bold text-lg">{t.dropFiles}</p>
                        <p className="text-xs text-white/40">PDF, JSON, TXT (Max 50MB)</p>
                      </div>
                    </div>
                  </div>

                  <div className="space-y-6">
                    <label className="text-sm font-bold uppercase tracking-widest text-white/40">Vocal Essence</label>
                    <div className="border border-white/10 rounded-[3rem] p-10 space-y-8 bg-white/5 aspect-square flex flex-col justify-center items-center text-center">
                      <div className={`w-20 h-20 rounded-full flex items-center justify-center ${isCloning ? 'bg-celestial-nebula/20 text-celestial-nebula animate-pulse' : 'bg-white/10 text-white/40'}`}>
                        <Mic size={40} />
                      </div>
                      <div className="space-y-2">
                        <h4 className="font-bold">{t.voiceCloning}</h4>
                        <p className="text-xs text-white/40 leading-relaxed px-4">{t.cloningDesc}</p>
                      </div>
                      <Button
                        onClick={startVoiceCloning}
                        disabled={isCloning}
                        className="w-full py-6 rounded-2xl bg-white/5 border border-white/10 hover:bg-white/10 font-bold"
                      >
                        {isCloning ? 'Cloning Essence...' : 'Start Voice Sample'}
                      </Button>
                    </div>
                  </div>
                </div>

                {files.length > 0 && (
                  <div className="space-y-4">
                    <label className="text-sm font-bold uppercase tracking-widest text-white/40">Neural Fragments</label>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {files.map((file, i) => (
                        <div key={i} className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5 group/file">
                          <div className="flex items-center gap-3 min-w-0">
                            <FileText size={18} className="text-celestial-saturn shrink-0" />
                            <div className="min-w-0">
                              <span className="text-sm text-white/60 font-medium truncate block">{file.name}</span>
                              <span className="text-[10px] text-white/20">{formatFileSize(file.size)}</span>
                            </div>
                          </div>
                          <button
                            onClick={() => removeFile(file.name)}
                            className="p-2 hover:bg-white/10 rounded-xl text-white/20 hover:text-red-500 transition-colors shrink-0"
                          >
                            <X size={16} />
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex justify-between pt-4">
                  <Button
                    variant="ghost"
                    onClick={() => setCurrentStep(1)}
                    className="px-10 py-8 rounded-2xl text-white/40 hover:text-white font-bold"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={() => setCurrentStep(3)}
                    disabled={files.length === 0}
                    className="px-12 py-8 rounded-2xl bg-celestial-saturn text-black font-black text-lg hover:scale-105 transition-transform"
                  >
                    Next: Final Synthesis
                  </Button>
                </div>
              </GlassCard>
            </motion.div>
          )}

          {currentStep === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 20 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -20 }}
              className="space-y-8"
            >
              <GlassCard className="p-10 rounded-[3rem] space-y-10 text-center" hoverEffect={false}>
                <div className="space-y-6">
                  <div className="w-24 h-24 rounded-[2rem] bg-celestial-saturn/20 flex items-center justify-center text-celestial-saturn mx-auto shadow-[0_0_50px_rgba(255,204,0,0.2)]">
                    <Sparkles size={48} />
                  </div>
                  <div className="space-y-2">
                    <h2 className="text-4xl font-black tracking-tighter">Ready for Awakening</h2>
                    <p className="text-white/40 max-w-md mx-auto">All neural fragments are prepared. The synthesis ritual will anchor this essence to your local node.</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-6 max-w-2xl mx-auto">
                  <div className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-2">
                    <div className="text-[10px] uppercase tracking-widest text-white/20 font-bold">Name</div>
                    <div className="text-lg font-bold text-celestial-saturn">{agentName}</div>
                  </div>
                  <div className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-2">
                    <div className="text-[10px] uppercase tracking-widest text-white/20 font-bold">Template</div>
                    <div className="text-lg font-bold text-celestial-saturn capitalize">{selectedCategory}</div>
                  </div>
                  <div className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-2">
                    <div className="text-[10px] uppercase tracking-widest text-white/20 font-bold">Data</div>
                    <div className="text-lg font-bold text-celestial-saturn">{files.length} Fragments</div>
                  </div>
                </div>

                <div className="flex justify-between pt-10">
                  <Button
                    variant="ghost"
                    onClick={() => setCurrentStep(2)}
                    className="px-10 py-8 rounded-2xl text-white/40 hover:text-white font-bold"
                  >
                    Back
                  </Button>
                  <Button
                    onClick={handleGenerate}
                    className="px-16 py-8 rounded-2xl bg-celestial-saturn text-black font-black text-xl hover:scale-105 transition-transform shadow-[0_0_30px_rgba(255,204,0,0.3)]"
                  >
                    <Rocket size={24} className="mr-3" />
                    {t.createAgent}
                  </Button>
                </div>
              </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>

      <section className="space-y-8 pt-16 border-t border-white/5" ref={el => { sectionRefs.current[t.generatedAgents] = el; }}>
        <div className="flex justify-between items-end">
          <div className="space-y-2">
            <h2 className="text-4xl font-bold tracking-tighter glow-text">{t.generatedAgents || 'Generated Agents'}</h2>
            <p className="text-white/40">Select an agent to activate or modify its core.</p>
          </div>
          <div className="text-sm font-bold uppercase tracking-widest text-white/20">Total: {agents.length}</div>
        </div>

        {agents.length > 0 ? (
          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-6">
            {agents.map((agent) => (
              <motion.div
                key={agent.id}
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                className="glass p-6 rounded-[2rem] border-white/10 hover:border-celestial-saturn/30 transition-all cursor-pointer group"
              >
                <div className="flex justify-between items-start mb-4">
                  <div className="w-12 h-12 rounded-2xl bg-celestial-saturn/10 flex items-center justify-center text-celestial-saturn group-hover:scale-110 transition-transform">
                    <Cpu size={24} />
                  </div>
                  <div className="flex flex-col items-end gap-2">
                    <div className="text-[10px] font-bold uppercase tracking-widest text-white/20">
                      {agent.createdAt ? new Date(agent.createdAt).toLocaleDateString() : 'Unknown'}
                    </div>
                  </div>
                </div>
                <div className="space-y-1">
                  <h4 className="text-xl font-bold tracking-tight">{agent.name}</h4>
                  <p className="text-xs text-white/40 uppercase tracking-widest font-bold">{agent.category}</p>
                </div>
                <div className="mt-6 flex gap-2">
                  <Button
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteAgent(agent.id);
                    }}
                    size="sm"
                    className="flex-1 rounded-xl bg-red-500/10 border border-red-500/20 hover:bg-red-500/20 text-[10px] font-bold uppercase tracking-widest text-red-500"
                  >
                    <Trash2 size={14} className="mr-1" />
                    Delete
                  </Button>
                  <Button
                    onClick={() => onChatAgent?.(agent)}
                    size="sm"
                    className="flex-1 rounded-xl bg-celestial-saturn text-black text-[10px] font-bold uppercase tracking-widest"
                  >
                    Chat
                  </Button>
                </div>
              </motion.div>
            ))}
          </div>
        ) : (
          <div className="glass p-20 rounded-[3rem] border-white/10 text-center space-y-4">
            <div className="w-16 h-16 rounded-full bg-white/5 mx-auto flex items-center justify-center text-white/20">
              <Database size={32} />
            </div>
            <p className="text-white/40 font-bold uppercase tracking-widest">No Agents Generated Yet</p>
          </div>
        )}
      </section>
    </div>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SkillBadge({ label }: { label: string }) {
  return (
    <div className="flex items-center gap-2 px-3 py-1.5 bg-white/5 rounded-lg border border-white/5 text-[10px] font-bold uppercase tracking-widest text-white/60">
      <div className="w-1 h-1 rounded-full bg-celestial-saturn" />
      {label}
    </div>
  );
}

function CategoryButton({ active, onClick, icon, label }: { active: boolean; onClick: () => void; icon: React.ReactNode; label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex flex-col items-center justify-center gap-2 p-4 rounded-2xl border transition-all ${
        active
          ? 'bg-celestial-saturn/10 border-celestial-saturn/30 text-celestial-saturn shadow-[0_0_20px_rgba(255,204,0,0.1)]'
          : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10'
      }`}
    >
      {icon}
      <span className="text-[10px] font-bold uppercase tracking-widest">{label}</span>
    </button>
  );
}
