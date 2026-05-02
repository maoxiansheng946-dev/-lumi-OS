import React from 'react';
import { motion } from 'motion/react';
import { Shield, Lock, FileText, Database, Radio, Cpu, Smartphone, Network, Globe, ArrowLeft } from 'lucide-react';

export function FoundersSanctuary({ t, user, onBack }: { t: any; user: any; onBack: () => void }) {
  const blueprints = [
    { 
      id: 'SHARD_01', 
      title: 'Neural Sharding Protocol', 
      description: 'The core algorithm that splits LLM weights across edge devices without compromising inference speed.',
      status: 'VERIFIED',
      icon: <Network size={24} />
    },
    { 
      id: 'MESH_VOID', 
      title: 'Zero-Knowledge Mesh', 
      description: 'Encrypted communication layer ensuring that no peer can ever see the original sensory input of another node.',
      status: 'ENCRYPTED',
      icon: <Shield size={24} />
    },
    { 
      id: 'KINETIC_K', 
      title: 'Kinetic Kernel v2', 
      description: 'The OS architecture designed to bridge silicon power with human intuition via sub-threshold neural spikes.',
      status: 'STABLE',
      icon: <Cpu size={24} />
    }
  ];

  return (
    <div className="space-y-24 py-12">
      {/* Back Button */}
      <motion.button
        initial={{ opacity: 0, x: -20 }}
        animate={{ opacity: 1, x: 0 }}
        onClick={onBack}
        className="flex items-center gap-2 text-white/40 hover:text-white transition-colors group"
      >
        <ArrowLeft size={16} className="group-hover:-translate-x-1 transition-transform" />
        <span className="text-[10px] font-black uppercase tracking-widest">Back to Hub</span>
      </motion.button>

      {/* Header Section */}
      <section className="text-center space-y-8">
        <motion.div 
          initial={{ opacity: 0, scale: 0.8 }}
          animate={{ opacity: 1, scale: 1 }}
          className="inline-flex items-center gap-3 px-6 py-2 bg-white/5 border border-white/10 rounded-full"
        >
          <Lock size={14} className="text-celestial-saturn" />
          <span className="text-[10px] font-black uppercase tracking-[0.4em] text-white/60">Restricted Access // Sanctuary-Level-7</span>
        </motion.div>
        
        <div className="space-y-4">
          <h1 className="text-7xl font-black tracking-tighter leading-none italic uppercase italic">
            Founder's <br /> <span className="text-celestial-saturn text-glow">Sanctuary</span>
          </h1>
          <p className="text-xl text-white/30 max-w-2xl mx-auto italic">
            The mathematical foundation of Lumi. These archives contain the blueprints for the sovereign neural future.
          </p>
        </div>
      </section>

      {/* Blueprint Grid */}
      <section className="grid lg:grid-cols-3 gap-8">
        {blueprints.map((item, i) => (
          <motion.div 
            key={item.id}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: i * 0.2 }}
            className="p-8 glass-dark rounded-[3rem] border border-white/5 hover:border-white/20 transition-all group overflow-hidden relative"
          >
            <div className="absolute -right-4 -top-4 opacity-5 group-hover:opacity-10 transition-opacity">
               {item.icon}
            </div>
            
            <div className="space-y-6 relative z-10">
               <div className="text-[10px] font-mono text-celestial-saturn tracking-[0.3em] font-bold">
                 MODULE_ID: {item.id}
               </div>
               
               <h3 className="text-2xl font-black tracking-tight text-white/90 uppercase">{item.title}</h3>
               <p className="text-sm text-white/40 leading-relaxed italic">{item.description}</p>
               
               <div className="pt-6 flex justify-between items-center border-t border-white/5">
                  <div className="flex items-center gap-2">
                    <div className="w-1.5 h-1.5 rounded-full bg-celestial-saturn animate-pulse" />
                    <span className="text-[10px] font-black text-white/40 uppercase">{item.status}</span>
                  </div>
                  <button className="text-[8px] font-black text-white/20 hover:text-white transition-colors uppercase tracking-widest border border-white/10 px-4 py-2 rounded-full">
                    Open Archive
                  </button>
               </div>
            </div>
          </motion.div>
        ))}
      </section>

      {/* The Protocol Codex */}
      <section className="glass p-16 rounded-[4rem] border border-white/5 relative overflow-hidden">
         <div className="absolute top-0 right-0 p-12 text-[120px] font-black text-white/5 leading-none select-none pointer-events-none">
           CODEX
         </div>
         
         <div className="max-w-3xl space-y-12 relative z-10">
            <div className="space-y-4">
              <h2 className="text-4xl font-black italic uppercase tracking-tighter">The Shard <span className="text-celestial-saturn">Manifesto</span></h2>
              <div className="w-20 h-1 bg-celestial-saturn" />
            </div>
            
            <div className="grid gap-8 font-mono text-xs leading-loose text-white/60 italic">
               <div className="space-y-2 border-l-2 border-white/5 pl-8">
                 <p className="text-white/80 font-bold uppercase">0x01: Distribution of Intelligence</p>
                 <p>Intelligence shall not be centralized. Lumi nodes sharding ensures that even the founding architects cannot access the collective memory of the mesh. Sovereignty is non-negotiable.</p>
               </div>
               <div className="space-y-2 border-l-2 border-white/5 pl-8">
                 <p className="text-white/80 font-bold uppercase">0x02: Kinetic Interface Theory</p>
                 <p>The OS is the extension of the nervous system. Every window resize, every focus shift, is a neural impulse mapped to silicon. The machine must respond as fast as the thought.</p>
               </div>
               <div className="space-y-2 border-l-2 border-white/5 pl-8">
                 <p className="text-white/80 font-bold uppercase">0x03: Persistent Shards</p>
                 <p>Data exists in ephemeral fragments. A node can leave the mesh, but its contribution to the collective inference remains encrypted across the persistent sharding layer.</p>
               </div>
            </div>
         </div>
      </section>
    </div>
  );
}
