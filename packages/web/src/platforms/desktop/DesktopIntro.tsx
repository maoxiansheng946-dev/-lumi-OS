import React from 'react';
import { motion } from 'motion/react';
import { Laptop, Download, Zap, Shield, Cpu, ArrowLeft, Terminal } from 'lucide-react';
import { GlassCard } from '../../components/SharedUI';

interface DesktopIntroProps {
  t: any;
  onBack: () => void;
}

export function DesktopIntro({ t, onBack }: DesktopIntroProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -20 }}
      className="max-w-6xl mx-auto py-12 px-4 space-y-16"
    >
      <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-6">
        <button
          onClick={onBack}
          className="flex items-center gap-2 text-white/40 hover:text-celestial-saturn transition-colors uppercase tracking-widest text-xs font-bold"
        >
          <ArrowLeft size={16} />
          {t.backToEcosystem || 'Back to Ecosystem'}
        </button>
        <div className="flex items-center gap-3 px-4 py-2 bg-celestial-saturn/10 border border-celestial-saturn/20 rounded-full">
           <div className="w-2 h-2 rounded-full bg-celestial-saturn animate-pulse" />
           <span className="text-[10px] font-black text-celestial-saturn uppercase tracking-widest text-white/80">{t.lumiOSStableRelease || 'Lumi OS Stable Release'}</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-16 items-center">
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-white/5 border border-white/10 rounded-full text-[10px] font-bold text-white/40 uppercase tracking-widest">
              {t.highPerfWorkstationNode || 'High-Performance Workstation Node'}
            </div>
            <h1 className="text-6xl md:text-7xl font-black tracking-tighter leading-none italic uppercase">
              {t.initializeKineticDesktopCore || <>INITIALIZE <span className="text-celestial-saturn text-glow">KINETIC</span> <br/>DESKTOP CORE</>}
            </h1>
            <p className="text-xl text-white/40 leading-relaxed max-w-lg italic">
              {t.desktopHeroDesc || 'Transform your hardware into a sovereign neural node. Zero latency, local LLM execution, and kernel-level OS automation.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
             <a
               href="/download"
               className="group px-10 py-6 bg-white text-black font-black rounded-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-4 shadow-[0_0_50px_rgba(255,255,255,0.2)]"
             >
               <Download size={24} className="text-celestial-saturn group-hover:rotate-12 transition-transform" />
               <div className="text-left">
                  <div className="text-lg leading-none">{t.downloadNative || 'DOWNLOAD NATIVE'}</div>
                  <div className="text-[10px] opacity-60 tracking-wider">{t.latestReleaseLabel || 'LATEST RELEASE'}</div>
               </div>
             </a>
          </div>

          <div className="flex items-center gap-8 pt-4">
            <div className="flex flex-col">
              <span className="text-[10px] font-black text-white/20 uppercase tracking-widest">{t.accelerationLabel || 'Acceleration'}</span>
              <div className="flex gap-2 mt-2">
                <div className="px-2 py-1 bg-white/5 border border-white/5 rounded text-[8px] font-bold text-white/40">NVIDIA CUDA</div>
                <div className="px-2 py-1 bg-white/5 border border-white/5 rounded text-[8px] font-bold text-white/40">APPLE METAL</div>
                <div className="px-2 py-1 bg-white/5 border border-white/5 rounded text-[8px] font-bold text-white/40">VULKAN</div>
              </div>
            </div>
          </div>
        </div>

        <div className="relative aspect-video rounded-[3rem] overflow-hidden border border-white/10 glass shadow-2xl group">
           <div className="absolute inset-0 bg-gradient-to-br from-celestial-saturn/20 via-transparent to-transparent group-hover:opacity-100 transition-opacity" />
           <div className="absolute inset-0 flex items-center justify-center">
              <div className="absolute inset-0 opacity-20 bg-[radial-gradient(circle_at_center,rgba(255,200,80,0.2)_0%,transparent_70%)]" />
              <Laptop size={120} className="text-white/5 group-hover:scale-110 transition-transform duration-700" />
              <div className="absolute inset-0 flex flex-col items-center justify-center p-12 space-y-6">
                 <div className="relative">
                   <Terminal size={64} className="text-celestial-saturn opacity-50 relative z-10" />
                   <div className="absolute inset-0 blur-2xl bg-celestial-saturn/20 rounded-full animate-pulse" />
                 </div>
                 <div className="w-full max-w-sm space-y-3 bg-black/40 p-4 rounded-2xl border border-white/5 backdrop-blur-xl">
                    <div className="flex justify-between items-center px-1">
                      <span className="text-[8px] font-black text-white/20 uppercase tracking-widest">{t.kernelLoadSequence || 'Kernel Load Sequence'}</span>
                      <span className="text-[10px] font-bold text-celestial-saturn">{t.stableLabel || 'STABLE'}</span>
                    </div>
                    <div className="h-1.5 w-full bg-white/5 rounded-full overflow-hidden">
                       <motion.div
                         initial={{ width: 0 }}
                         animate={{ width: '100%' }}
                         transition={{ duration: 4, repeat: Infinity }}
                         className="h-full bg-gradient-to-r from-celestial-saturn/40 to-celestial-saturn"
                        />
                    </div>
                    <div className="grid grid-cols-4 gap-1">
                      {[...Array(20)].map((_, i) => (
                        <div key={i} className="h-0.5 bg-white/10 rounded-full" />
                      ))}
                    </div>
                 </div>
              </div>
           </div>
        </div>
      </div>

      <section className="glass p-12 rounded-[3.5rem] border border-white/5">
        <div className="max-w-4xl mx-auto space-y-12">
          <div className="text-center space-y-2">
            <h2 className="text-3xl font-black tracking-tighter uppercase italic">{t.nativeNodeSuperiority || <>Native Node <span className="text-celestial-saturn">Superiority</span></>}</h2>
            <p className="text-white/30 text-sm italic">{t.desktopSuperiorityDesc || "Why the desktop client is the primary choice for neural architects"}</p>
          </div>

          <div className="grid md:grid-cols-2 gap-12">
            <div className="space-y-6">
              <h4 className="text-[10px] font-black text-white/60 uppercase tracking-[0.3em] border-l-2 border-celestial-saturn pl-4">{t.standardBrowserEdition || 'Standard Browser Edition'}</h4>
              <ul className="space-y-4">
                {[
                  t.browserItem1 || 'Cloud-dependent neural sync',
                  t.browserItem2 || 'Restricted sandbox environment',
                  t.browserItem3 || 'Standard CPU/GPU limits',
                  t.browserItem4 || 'Universal compatibility'
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-white/30 italic">
                    <div className="w-1.5 h-1.5 rounded-full bg-white/20" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-6">
              <h4 className="text-[10px] font-black text-celestial-saturn uppercase tracking-[0.3em] border-l-2 border-celestial-saturn pl-4">{t.lumiNativeKernelNode || 'Lumi Native Kernel Node'}</h4>
              <ul className="space-y-4">
                {[
                  t.kernelItem1 || 'Full Silicon-level local LLM execution',
                  t.kernelItem2 || 'Direct OS & File System automation',
                  t.kernelItem3 || 'Hardware acceleration (DirectX/Metal)',
                  t.kernelItem4 || 'Sovereign Data Vault (No telemetry)'
                ].map((item, i) => (
                  <li key={i} className="flex items-center gap-3 text-sm text-white/90 font-bold italic">
                    <Zap size={14} className="text-celestial-saturn" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      <div className="grid md:grid-cols-3 gap-8">
        <IntroFeature
          icon={<Cpu />}
          title={t.featureNvidiaAccel || 'NVIDIA/Metal Acceleration'}
          desc={t.featureNvidiaAccelDesc || "Optimized kernels for maximum local inference speed using your hardware's full capability."}
        />
        <IntroFeature
          icon={<Shield />}
          title={t.featureZeroKnowledge || 'Zero-Knowledge Sync'}
          desc={t.featureZeroKnowledgeDesc || 'All personal data stays in your local vault. Only metadata sharding enters the mesh.'}
        />
        <IntroFeature
          icon={<Zap />}
          title={t.featureOSAutomation || 'OS-Level Automation'}
          desc={t.featureOSAutomationDesc || 'Control your system, files, and applications directly through neural commands.'}
        />
      </div>

      <section className="pt-8 text-center">
        <a
          href="/download"
          className="inline-flex px-12 py-6 bg-celestial-saturn text-black font-black rounded-2xl hover:scale-105 active:scale-95 transition-all gap-3 shadow-[0_0_50px_rgba(255,200,80,0.3)]"
        >
          <Download size={24} />
          {t.goToDownloads || 'GO TO DOWNLOADS'}
        </a>
        <p className="text-[10px] text-white/20 font-mono mt-4">{t.versionInfo || 'v2.0.4 · Windows 10+ · 120MB · Free'}</p>
      </section>
    </motion.div>
  );
}

function IntroFeature({ icon, title, desc }: { icon: any, title: string, desc: string }) {
  return (
    <GlassCard className="p-8 space-y-6">
      <div className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 flex items-center justify-center text-celestial-saturn">
        {React.cloneElement(icon as React.ReactElement<any>, { size: 24 })}
      </div>
      <div className="space-y-2">
        <h3 className="text-lg font-bold uppercase tracking-tight">{title}</h3>
        <p className="text-sm text-white/40 leading-relaxed">{desc}</p>
      </div>
    </GlassCard>
  );
}
