import React from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Book, Code, Terminal, Shield, Globe, Zap, Search, Sparkles, Layers } from 'lucide-react';
import { Card } from './ui/card';
import { Input } from './ui/input';
import { useModuleData } from '@/hooks/useModuleData';
import { LoadingSpinner, GlassCard, IconBox } from './SharedUI';

export function Docs({ t }: { t: any }) {
  const { data, loading } = useModuleData<any>('/api/modules/docs');
  const [activeTab, setActiveTab] = React.useState('philosophy');

  if (loading) return <LoadingSpinner />;

  const tabs = [
    { id: 'philosophy', title: t.corePhilosophy, icon: <Sparkles size={18} /> },
    { id: 'hosts', title: t.smartHostProgram, icon: <Layers size={18} /> },
    { id: 'clients', title: t.multiClientTitle, icon: <Globe size={18} /> },
    { id: 'getting-started', title: 'Getting Started', icon: <Book size={18} /> },
    { id: 'api', title: 'API Reference', icon: <Code size={18} /> },
  ];

  return (
    <div className="max-w-6xl mx-auto space-y-12">
      <div className="text-center space-y-6">
        <h1 className="text-6xl font-bold tracking-tighter glow-text">{data?.title || t.docs}</h1>
        <p className="text-xl text-white/60 max-w-2xl mx-auto">Master the LumiAI protocol and build advanced Agent architectures.</p>
        <div className="max-w-md mx-auto relative">
          <Input placeholder="Search documentation..." className="bg-white/5 border-white/10 rounded-2xl p-6 h-auto text-lg pl-12" />
          <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-white/40" size={20} />
        </div>
      </div>

      {/* Secondary Navigation */}
      <div className="flex flex-wrap justify-center gap-4 border-b border-white/5 pb-8">
        {tabs.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`flex items-center gap-2 px-6 py-3 rounded-full transition-all ${
              activeTab === tab.id 
                ? 'bg-celestial-nebula text-white shadow-[0_0_20px_rgba(255,45,85,0.3)]' 
                : 'bg-white/5 text-white/40 hover:bg-white/10'
            }`}
          >
            {tab.icon}
            <span className="font-bold text-sm uppercase tracking-widest">{tab.title}</span>
          </button>
        ))}
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={activeTab}
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -20 }}
          className="space-y-12"
        >
          {activeTab === 'philosophy' && (
            <div className="space-y-12">
              <div className="text-center space-y-4">
                <h2 className="text-4xl font-bold tracking-tighter">{t.corePhilosophy}</h2>
                <p className="text-white/60 max-w-2xl mx-auto">{t.philosophyDesc}</p>
              </div>
              <div className="grid md:grid-cols-3 gap-8">
                <PhilosophyCard 
                  icon={<Shield className="text-celestial-nebula" size={32} />} 
                  title={t.philosophyPillar1} 
                  desc={t.philosophyPillar1Desc} 
                />
                <PhilosophyCard 
                  icon={<Zap className="text-celestial-saturn" size={32} />} 
                  title={t.philosophyPillar2} 
                  desc={t.philosophyPillar2Desc} 
                />
                <PhilosophyCard 
                  icon={<Globe className="text-celestial-glow" size={32} />} 
                  title={t.philosophyPillar3} 
                  desc={t.philosophyPillar3Desc} 
                />
              </div>
            </div>
          )}

          {activeTab === 'hosts' && (
            <div className="space-y-16">
              <div className="text-center space-y-4">
                <h2 className="text-4xl font-bold tracking-tighter glow-text">{t.smartHostProgram}</h2>
                <p className="text-white/60 max-w-2xl mx-auto italic">"{t.everythingCanBeLumi}"</p>
              </div>
              
              <div className="grid md:grid-cols-2 gap-12 items-center">
                <div className="space-y-6">
                  <h3 className="text-2xl font-bold text-celestial-saturn underline decoration-celestial-saturn/30 underline-offset-8">Host Architecture</h3>
                  <p className="text-lg text-white/70 leading-relaxed">
                    The Smart Host Program defines a hardware-agnostic communication protocol that allows the Lumi Neural Core to 'inhabit' existing physical systems.
                  </p>
                  <ul className="space-y-4">
                    <li className="flex gap-4">
                      <div className="w-6 h-6 rounded-full bg-celestial-saturn/20 flex items-center justify-center text-celestial-saturn font-bold text-xs mt-1">1</div>
                      <p className="text-sm text-white/60"><strong className="text-white">Neural Encapsulation:</strong> Wrapping existing APIs into Lumi-compatible intent streams.</p>
                    </li>
                    <li className="flex gap-4">
                      <div className="w-6 h-6 rounded-full bg-celestial-saturn/20 flex items-center justify-center text-celestial-saturn font-bold text-xs mt-1">2</div>
                      <p className="text-sm text-white/60"><strong className="text-white">Symbiotic Feedback:</strong> Real-time sensory data from the host contributes to the local Agent's evolution.</p>
                    </li>
                  </ul>
                </div>
                <GlassCard className="p-8 aspect-video flex flex-col justify-center items-center text-center space-y-6">
                   <Layers size={64} className="text-celestial-saturn animate-pulse" />
                   <div className="space-y-2">
                     <h4 className="font-bold">Protocol Status: Beta</h4>
                     <p className="text-xs text-white/40">Active hosts: 12,400+ | Categories: Toys, Industry, Wearables</p>
                   </div>
                </GlassCard>
              </div>
            </div>
          )}

          {activeTab === 'clients' && (
            <div className="space-y-16">
              <div className="text-center space-y-4">
                <h2 className="text-4xl font-bold tracking-tighter glow-text">{t.multiClientTitle}</h2>
                <p className="text-white/60 max-w-2xl mx-auto">Seamless synchronization across all your dimensions.</p>
              </div>

              <div className="grid md:grid-cols-2 gap-8">
                <GlassCard className="p-8 space-y-4 border-t-2 border-t-celestial-saturn">
                  <div className="flex items-center gap-3">
                    <Terminal className="text-celestial-saturn" size={24} />
                    <h3 className="text-xl font-bold">{t.desktopNode}</h3>
                  </div>
                  <p className="text-sm text-white/40 leading-relaxed">{t.desktopDesc}</p>
                  <div className="pt-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <Zap size={12} className="text-celestial-saturn" />
                      <span>Windows / macOS / Linux (Electron Runtime)</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <Zap size={12} className="text-celestial-saturn" />
                      <span>Direct Hardware Access for Local Inference</span>
                    </div>
                  </div>
                </GlassCard>

                <GlassCard className="p-8 space-y-4 border-t-2 border-t-celestial-nebula">
                  <div className="flex items-center gap-3">
                    <Globe className="text-celestial-nebula" size={24} />
                    <h3 className="text-xl font-bold">{t.mobilePerception}</h3>
                  </div>
                  <p className="text-sm text-white/40 leading-relaxed">{t.mobileDesc}</p>
                  <div className="pt-4 space-y-2">
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <Zap size={12} className="text-celestial-nebula" />
                      <span>iOS / Android (Capacitor Runtime)</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-white/60">
                      <Zap size={12} className="text-celestial-nebula" />
                      <span>Multimodal Sensing & Voice Sync</span>
                    </div>
                  </div>
                </GlassCard>
              </div>

              <div className="p-12 bg-white/5 rounded-[32px] border border-white/10 space-y-8">
                <div className="text-center space-y-2">
                  <h3 className="text-2xl font-bold">{t.syncProtocol}</h3>
                  <p className="text-sm text-white/40">{t.syncProtocolDesc}</p>
                </div>
                <div className="flex flex-col md:flex-row items-center justify-center gap-8">
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-celestial-saturn">
                      <Terminal size={32} />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-tighter">Brain Node</span>
                  </div>
                  <div className="flex-1 h-px bg-gradient-to-r from-celestial-saturn via-white/20 to-celestial-nebula hidden md:block min-w-[100px]" />
                  <div className="px-4 py-2 rounded-full border border-white/10 bg-white/5 text-[10px] font-mono">
                    AES-256-GCM / P2P Mesh
                  </div>
                  <div className="flex-1 h-px bg-gradient-to-r from-celestial-nebula via-white/20 to-celestial-saturn hidden md:block min-w-[100px]" />
                  <div className="flex flex-col items-center gap-2">
                    <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center text-celestial-nebula">
                      <Globe size={32} />
                    </div>
                    <span className="text-xs font-bold uppercase tracking-tighter">Sense Node</span>
                  </div>
                </div>
              </div>
            </div>
          )}

          {activeTab === 'getting-started' && (
            <div className="grid md:grid-cols-3 gap-8">
              <DocCard 
                icon={<Book className="text-celestial-mars" />} 
                title="Getting Started" 
                desc="Learn the basics of Agent generation and local node setup." 
                links={['Installation', 'First Agent', 'Syncing Devices']}
              />
              <DocCard 
                icon={<Zap className="text-celestial-saturn" />} 
                title="Quick Start" 
                desc="Get up and running in less than 5 minutes." 
                links={['CLI Setup', 'Hello World', 'Node Config']}
              />
              <DocCard 
                icon={<Globe className="text-celestial-glow" />} 
                title="Ecosystem" 
                desc="Explore the LumiAI distributed network." 
                links={['Mesh Basics', 'P2P Sync', 'Security']}
              />
            </div>
          )}

          {activeTab === 'api' && (
            <div className="grid md:grid-cols-3 gap-8">
              <DocCard 
                icon={<Code className="text-celestial-saturn" />} 
                title="API Reference" 
                desc="Deep dive into the LumiAI local SDK and neural synthesis API." 
                links={['Authentication', 'Data Streams', 'Memory Core']}
              />
              <DocCard 
                icon={<Terminal className="text-celestial-glow" />} 
                title="CLI Commands" 
                desc="Full reference for the LumiAI command line interface." 
                links={['lumi generate', 'lumi sync', 'lumi status']}
              />
              <DocCard 
                icon={<Shield className="text-celestial-mars" />} 
                title="Security API" 
                desc="Manage encryption and node permissions." 
                links={['Key Management', 'Access Control', 'Privacy Levels']}
              />
            </div>
          )}

          {activeTab === 'advanced' && (
            <div className="grid md:grid-cols-3 gap-8">
              <DocCard 
                icon={<Terminal className="text-celestial-glow" />} 
                title="Advanced Guides" 
                desc="Build complex multi-agent systems and custom knowledge graphs." 
                links={['Orchestration', 'Custom LLMs', 'Security Rules']}
              />
              <DocCard 
                icon={<Zap className="text-celestial-saturn" />} 
                title="Performance" 
                desc="Optimize your node for high-speed inference." 
                links={['GPU Acceleration', 'Memory Management', 'Caching']}
              />
              <DocCard 
                icon={<Globe className="text-celestial-nebula" />} 
                title="Global Mesh" 
                desc="Scale your agents across the distributed mesh." 
                links={['Swarm Logic', 'Cross-Node Sync', 'Latency']}
              />
            </div>
          )}

          <div className="grid lg:grid-cols-2 gap-12">
            {data?.sections?.map((section: any) => (
              <GlassCard key={section.id} className="space-y-6" hoverEffect={false}>
                <h3 className="text-2xl font-bold tracking-tighter">{section.title}</h3>
                <div className="space-y-4 text-white/60 leading-relaxed">
                  <p>{section.content}</p>
                  {section.id === 1 && (
                    <div className="p-6 bg-white/5 rounded-2xl border border-white/10 font-mono text-sm overflow-x-auto">
                      <code>
                        lumi generate --name "MyAgent" --data ./docs/knowledge.pdf --privacy high
                      </code>
                    </div>
                  )}
                </div>
              </GlassCard>
            ))}
            
            {!data?.sections && activeTab === 'philosophy' && (
              <>
                <GlassCard className="space-y-6" hoverEffect={false}>
                  <h3 className="text-2xl font-bold tracking-tighter">Neural Synthesis Protocol</h3>
                  <div className="space-y-4 text-white/60 leading-relaxed">
                    <p>The LumiAI protocol uses distributed neural synthesis to build Agent intelligence. This process is entirely local, ensuring that your data never leaves your node.</p>
                    <div className="p-6 bg-white/5 rounded-2xl border border-white/10 font-mono text-sm overflow-x-auto">
                      <code>
                        lumi generate --name "MyAgent" --data ./docs/knowledge.pdf --privacy high
                      </code>
                    </div>
                    <p>By defining a high privacy level, the protocol will use advanced encryption and local-only processing for all neural weight calculations.</p>
                  </div>
                </GlassCard>

                <GlassCard className="space-y-6" hoverEffect={false}>
                  <h3 className="text-2xl font-bold tracking-tighter">Security & Privacy</h3>
                  <div className="space-y-4 text-white/60 leading-relaxed">
                    <p>Privacy is the core of LumiAI. Our security architecture is built on three pillars:</p>
                    <ul className="space-y-3">
                      <li className="flex items-center gap-3"><Zap size={16} className="text-celestial-saturn" /> Local-First Data Processing</li>
                      <li className="flex items-center gap-3"><Shield size={16} className="text-celestial-mars" /> End-to-End Node Encryption</li>
                      <li className="flex items-center gap-3"><Globe size={16} className="text-celestial-glow" /> Decentralized Identity (DID)</li>
                    </ul>
                  </div>
                </GlassCard>
              </>
            )}
          </div>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function PhilosophyCard({ icon, title, desc }: { icon: React.ReactNode; title: string; desc: string }) {
  return (
    <GlassCard className="p-8 rounded-3xl space-y-4 text-center border border-white/5 hover:border-celestial-nebula/30 transition-colors">
      <div className="w-16 h-16 rounded-2xl bg-white/5 flex items-center justify-center mx-auto mb-2">
        {icon}
      </div>
      <h3 className="text-xl font-bold tracking-tight">{title}</h3>
      <p className="text-sm text-white/40 leading-relaxed">{desc}</p>
    </GlassCard>
  );
}

function DocCard({ icon, title, desc, links }: { icon: React.ReactNode; title: string; desc: string; links: string[] }) {
  return (
    <GlassCard className="space-y-6 group">
      <IconBox icon={icon} />
      <div className="space-y-2">
        <h3 className="text-xl font-bold tracking-tighter">{title}</h3>
        <p className="text-sm text-white/40 leading-relaxed">{desc}</p>
      </div>
      <ul className="space-y-2">
        {links.map((link, i) => (
          <li key={i} className="text-sm text-celestial-saturn hover:underline cursor-pointer flex items-center gap-2">
            <Zap size={12} />
            {link}
          </li>
        ))}
      </ul>
    </GlassCard>
  );
}
