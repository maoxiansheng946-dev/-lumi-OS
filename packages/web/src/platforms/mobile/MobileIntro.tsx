import React from 'react';
import { motion } from 'motion/react';
import { Smartphone, Download, Zap, Shield, Phone as PhoneIcon, ArrowLeft, Globe, QrCode } from 'lucide-react';
import { GlassCard } from '../../components/SharedUI';

interface MobileIntroProps {
  t: any;
  onBack: () => void;
}

export function MobileIntro({ t, onBack }: MobileIntroProps) {
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
          className="flex items-center gap-2 text-white/40 hover:text-celestial-nebula transition-colors uppercase tracking-widest text-xs font-bold"
        >
          <ArrowLeft size={16} />
          {t.backToEcosystem || 'Back to Ecosystem'}
        </button>
        <div className="flex items-center gap-3 px-4 py-2 bg-celestial-nebula/10 border border-celestial-nebula/20 rounded-full">
           <div className="w-2 h-2 rounded-full bg-celestial-nebula animate-pulse" />
           <span className="text-[10px] font-black text-celestial-nebula uppercase tracking-widest text-white/80">{t.lumiMobileSyncActive || 'Lumi Mobile Sync Active'}</span>
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-16 items-center">
        <div className="space-y-8">
          <div className="space-y-4">
            <div className="inline-flex items-center gap-2 px-3 py-1 bg-celestial-nebula/10 border border-celestial-nebula/20 rounded-full text-[10px] font-black text-celestial-nebula uppercase tracking-widest">
              {t.portableNeuralGateway || 'Portable Neural Gateway'}
            </div>
            <h1 className="text-6xl md:text-7xl font-black tracking-tighter leading-none italic uppercase">
              {t.neuralSensoryPerception || <>Neural Sensory <span className="text-celestial-nebula text-glow">Perception</span></>}
            </h1>
            <p className="text-xl text-white/40 leading-relaxed max-w-lg italic">
              {t.mobileHeroDesc || 'Your agent, decoupled from the workstation. Distributed mesh networking combined with real-time sensory sharding.'}
            </p>
          </div>

          <div className="flex flex-col sm:flex-row gap-4">
             <a
               href="/download"
               className="group px-10 py-6 bg-celestial-nebula text-white font-black rounded-2xl hover:scale-105 active:scale-95 transition-all flex items-center justify-center gap-4 shadow-[0_0_50px_rgba(59,130,246,0.3)]"
             >
               <Download size={24} className="text-white group-hover:rotate-12 transition-transform" />
               <div className="text-left">
                  <div className="text-lg leading-none">{t.getMobileApp || 'GET MOBILE APP'}</div>
                  <div className="text-[10px] opacity-80 tracking-wider uppercase">{t.latestBuild || 'LATEST BUILD'}</div>
               </div>
             </a>
          </div>

          <div className="grid grid-cols-2 gap-4 max-w-sm">
             <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-2">
                <div className="flex justify-between items-center">
                   <span className="text-[8px] font-black text-white/30 uppercase">{t.cameraStream || 'Camera Stream'}</span>
                   <div className="w-1 h-1 rounded-full bg-green-500 animate-pulse" />
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                   <div className="h-full bg-celestial-nebula w-3/4" />
                </div>
             </div>
             <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-2">
                <div className="flex justify-between items-center">
                   <span className="text-[8px] font-black text-white/30 uppercase">{t.sensors || 'Sensors'}</span>
                   <span className="text-[8px] font-bold text-celestial-nebula font-mono">{t.activeStatusCap || 'ACTIVE'}</span>
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                   <div className="h-full bg-white/20 w-1/2" />
                </div>
             </div>
          </div>
        </div>

        <div className="relative aspect-[9/16] max-w-[320px] mx-auto group">
           <div className="absolute inset-0 bg-celestial-nebula/20 blur-[100px] opacity-50 group-hover:opacity-80 transition-opacity" />
           <div className="relative h-full rounded-[3.5rem] overflow-hidden border-[8px] border-white/10 glass shadow-2xl">
              <div className="absolute top-0 inset-x-0 h-8 flex justify-center items-center z-20">
                 <div className="w-24 h-4 bg-black rounded-full" />
              </div>

              <div className="absolute inset-0 bg-[#020205] flex flex-col pt-12 items-center text-center p-8 overflow-hidden">
                 <div className="star-field opacity-20" />

                 <div className="relative mb-8 w-full">
                    <div className="aspect-square w-full rounded-full border-2 border-celestial-nebula/20 flex items-center justify-center p-6 relative">
                       <motion.div
                         animate={{ rotate: 360 }}
                         transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
                         className="absolute inset-0 z-20 pointer-events-none"
                       >
                         <div className="w-1/2 h-px bg-gradient-to-r from-transparent to-celestial-nebula shadow-[0_0_15px_#3b82f6]" />
                       </motion.div>

                       <div className="w-full h-full rounded-full border border-celestial-nebula/40 flex items-center justify-center relative">
                          {[...Array(5)].map((_, i) => (
                            <motion.div
                              key={i}
                              animate={{
                                scale: [0, 1.5, 0],
                                opacity: [0, 0.8, 0]
                              }}
                              transition={{ duration: 2, repeat: Infinity, delay: i * 0.4 }}
                              className="absolute w-1 h-1 bg-celestial-nebula rounded-full"
                              style={{
                                top: `${20 + Math.random() * 60}%`,
                                left: `${20 + Math.random() * 60}%`
                              }}
                            />
                          ))}
                          <Smartphone size={40} className="text-celestial-nebula relative z-10" />
                       </div>
                    </div>
                    <div className="absolute inset-0 blur-3xl bg-celestial-nebula/5 rounded-full" />
                 </div>

                 <div className="space-y-1 relative z-10">
                    <div className="text-3xl font-black tracking-tighter italic">{t.mobileHub || 'MOBILE HUB'}</div>
                    <div className="text-[9px] text-celestial-nebula font-black uppercase tracking-[0.4em] mb-4">{t.realtimeSensorySharding || 'Real-time Sensory Sharding'}</div>
                 </div>

                 <div className="w-full space-y-4 relative z-10">
                    <div className="bg-white/5 p-4 rounded-2xl border border-white/5 flex flex-col gap-2">
                       <div className="flex justify-between items-center text-[8px] font-black text-white/30 uppercase">
                          <span>{t.environmentMetadata || 'Environment Metadata'}</span>
                          <span className="text-celestial-nebula">{t.capturing || 'Capturing...'}</span>
                       </div>
                       <motion.div
                         animate={{ opacity: [0.3, 1, 0.3] }}
                         transition={{ duration: 1.5, repeat: Infinity }}
                         className="font-mono text-[10px] text-white/60 text-left"
                       >
                         SYNCING_BIO_METRIC_01... <br/>
                         GPS_SHARD_ACTIVE_12.4
                       </motion.div>
                    </div>

                    {[1, 2].map(i => (
                      <div key={i} className="flex flex-col gap-2">
                        <div className="flex justify-between text-[8px] font-black text-white/20 uppercase tracking-widest">
                           <span>Mesh Peer Nexus_0{i}</span>
                           <span>{t.meshOnline || 'ONLINE'}</span>
                        </div>
                        <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                           <motion.div
                             initial={{ width: 0 }}
                             animate={{ width: `${60 + Math.random() * 30}%` }}
                             className="h-full bg-celestial-nebula/40"
                           />
                        </div>
                      </div>
                    ))}
                 </div>

                 <div className="mt-auto pt-4 flex gap-3 w-full justify-center opacity-40">
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center p-2"><Globe size={18} /></div>
                    <div className="w-10 h-10 rounded-xl bg-white/5 flex items-center justify-center p-2"><Zap size={18} /></div>
                 </div>
              </div>
           </div>
        </div>
      </div>

      <section className="pt-8 space-y-8">
        <div className="text-center">
          <h2 className="text-3xl font-black tracking-widest uppercase">{t.mobileBinaryPackages || 'Mobile Binary Packages'}</h2>
          <p className="text-white/40 text-sm">{t.deployMobileClient || 'Deploy the Lumi client to your portable devices'}</p>
        </div>

        <div className="grid md:grid-cols-3 gap-6">
          {[
            { platform: 'Android', version: 'v1.2.0', format: '.apk', icon: '🤖' },
            { platform: 'iOS (App Store)', version: 'v1.2.0', format: 'Redirect', icon: '🍏' },
            { platform: 'TestFlight', version: 'v1.2.1-beta', format: 'invite-only', icon: '✈️' },
          ].map((dl) => (
            <GlassCard key={dl.platform} className="p-8 border-white/5 hover:border-celestial-nebula/30 transition-colors group">
              <div className="flex justify-between items-start mb-6">
                <span className="text-4xl">{dl.icon}</span>
                <span className="text-[10px] font-bold py-1 px-3 bg-white/5 rounded-full text-white/40 uppercase tracking-widest">{t.releasedBadge || 'Released'}</span>
              </div>
              <div className="space-y-4">
                <div>
                  <h3 className="text-xl font-bold">{dl.platform}</h3>
                  <p className="text-xs text-white/30 font-mono">{dl.version} • {dl.format}</p>
                </div>
                <a
                  href="/download"
                  className="w-full py-4 bg-white/5 hover:bg-celestial-nebula text-white font-black rounded-xl border border-white/10 transition-all flex items-center justify-center gap-2 group"
                >
                  <Download size={18} className="group-hover:translate-y-0.5 transition-transform" />
                  {t.goToDownloads || 'GO TO DOWNLOADS'}
                </a>
              </div>
            </GlassCard>
          ))}
        </div>

        <div className="flex justify-center pt-8">
           <GlassCard className="p-8 flex items-center gap-12 border-white/5">
              <div className="p-4 bg-white rounded-3xl">
                 <QrCode size={120} className="text-black" />
              </div>
              <div className="space-y-4">
                 <h3 className="text-2xl font-bold">{t.quickScan || 'Quick Scan'}</h3>
                 <p className="text-sm text-white/40 max-w-xs">{t.scanQRCode || 'Scan the QR code with your mobile device to open the decentralized installation gateway.'}</p>
                 <div className="flex items-center gap-2 text-celestial-nebula font-bold text-xs">
                    <div className="w-2 h-2 bg-celestial-nebula rounded-full animate-ping" />
                    {t.gatewayOnline || 'GATEWAY ONLINE'}
                 </div>
              </div>
           </GlassCard>
        </div>
      </section>
    </motion.div>
  );
}
