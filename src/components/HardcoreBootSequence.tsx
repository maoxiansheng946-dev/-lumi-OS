import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Terminal, Cpu, Database, Activity, Globe, Shield, Zap, BrainCircuit } from 'lucide-react';

interface BootLog {
  text: string;
  type: 'info' | 'success' | 'warning' | 'error';
  timestamp: string;
}

export function HardcoreBootSequence({ onComplete }: { onComplete: () => void }) {
  const [logs, setLogs] = useState<BootLog[]>([]);
  const [progress, setProgress] = useState(0);
  const [phase, setPhase] = useState<'bios' | 'kernel' | 'init' | 'ready'>('bios');
  const scrollRef = useRef<HTMLDivElement>(null);

  const bootSteps = [
    { text: 'LUMI BIOS Ver 4.4.2 (2026-05-02)', delay: 100 },
    { text: 'CPUID: Intel(R) Silicon Adaptive Neural Processor @ 9.2GHz', delay: 200 },
    { text: 'CPU Check: 128 Threads... OK', delay: 150 },
    { text: 'Memory: 32768MB Distributed Mesh RAM... OK', delay: 300 },
    { text: 'Checking Persistent Shards...', delay: 400 },
    { text: 'Shard-A (System) OK', delay: 100 },
    { text: 'Shard-B (Neural) OK', delay: 100 },
    { text: 'Shard-C (Memory) OK', delay: 100 },
    { text: 'Booting Lumi Virtual Kernel v2.0.4...', delay: 500 },
    { text: '[ LOADING MODULES ]', delay: 200 },
    { text: 'Mounting /dev/mesh-01...', delay: 150 },
    { text: 'Mapping Neural Synapses...', delay: 250 },
    { text: 'Init: Lumi-Core-D (v1.0.12)...', delay: 100 },
    { text: 'Network: Mesh Peer Bridge Active...', delay: 200 },
    { text: 'Security: Neural ID Verification Active...', delay: 150 },
    { text: 'Environment: Virtual Desktop Engine Starting...', delay: 300 },
    { text: 'LUMI_OS READY', delay: 500 },
  ];

  useEffect(() => {
    let currentStep = 0;
    const interval = setInterval(() => {
      if (currentStep < bootSteps.length) {
        const step = bootSteps[currentStep];
        const newLog: BootLog = {
          text: step.text,
          type: step.text.includes('OK') || step.text.includes('READY') ? 'success' : 'info',
          timestamp: new Date().toLocaleTimeString([], { hour12: false }),
        };
        setLogs(prev => [...prev, newLog]);
        setProgress(((currentStep + 1) / bootSteps.length) * 100);
        currentStep++;
      } else {
        clearInterval(interval);
        setTimeout(() => {
          setPhase('ready');
          setTimeout(onComplete, 1000);
        }, 800);
      }
    }, 150);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [logs]);

  return (
    <motion.div 
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1 }}
      className="fixed inset-0 z-[9999] bg-black p-8 font-mono text-[10px] md:text-xs leading-relaxed overflow-hidden"
    >
      {/* Background Matrix/Grid Effect */}
      <div className="absolute inset-0 opacity-10 bg-[linear-gradient(rgba(0,255,100,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(0,255,100,0.05)_1px,transparent_1px)] bg-[size:20px_20px]" />
      
      <div className="max-w-4xl mx-auto h-full flex flex-col relative z-20">
        <div className="flex justify-between items-start mb-8">
           <div className="space-y-1">
             <div className="text-[#00ff41] font-black tracking-[0.2em] uppercase">LUMI NEURAL SYSTEMS (C) 2026</div>
             <div className="text-white/40">SECURE BOOT INTERFACE // KERNEL_TRUST_0x44</div>
           </div>
           <div className="text-right">
             <BrainCircuit size={32} className="text-[#00ff41] opacity-50" />
           </div>
        </div>

        <div 
          ref={scrollRef}
          className="flex-1 overflow-y-auto custom-scrollbar-hidden space-y-1 mb-8"
        >
          {logs.map((log, i) => (
            <motion.div 
              key={i}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              className="flex gap-4"
            >
              <span className="text-white/20 whitespace-nowrap">[{log.timestamp}]</span>
              <span className={
                log.type === 'success' ? 'text-[#00ff41]' : 
                log.type === 'warning' ? 'text-yellow-500' :
                log.type === 'error' ? 'text-red-500' : 'text-white/80'
              }>
                {log.text}
              </span>
            </motion.div>
          ))}
          {progress < 100 && (
            <motion.div 
              animate={{ opacity: [0, 1, 0] }}
              transition={{ duration: 0.5, repeat: Infinity }}
              className="w-2 h-4 bg-[#00ff41] ml-4 inline-block"
            />
          )}
        </div>

        <div className="space-y-4 pt-8 border-t border-white/10">
           <div className="flex justify-between items-end">
              <div className="space-y-2">
                 <div className="text-[10px] uppercase tracking-widest text-[#00ff41]">Boot Progress: {Math.floor(progress)}%</div>
                 <div className="w-64 h-1 bg-white/5 rounded-full overflow-hidden">
                    <motion.div 
                      animate={{ width: `${progress}%` }}
                      className="h-full bg-[#00ff41]"
                    />
                 </div>
              </div>
              <div className="text-right space-y-1">
                 <div className="text-[8px] text-white/20 uppercase">Core Temperature: 34°C</div>
                 <div className="text-[8px] text-white/20 uppercase">Mesh Connectivity: 100%</div>
              </div>
           </div>
        </div>
      </div>

      {/* Glitch Overlay on completion */}
      <AnimatePresence>
        {phase === 'ready' && (
          <motion.div 
            initial={{ opacity: 0 }}
            animate={{ opacity: [0, 1, 0, 1, 0] }}
            exit={{ opacity: 0 }}
            className="absolute inset-0 bg-white z-[10000] mix-blend-difference"
          />
        )}
      </AnimatePresence>
    </motion.div>
  );
}
