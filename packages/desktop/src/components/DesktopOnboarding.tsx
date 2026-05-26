import React, { useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  Cpu,
  Search,
  Zap,
  Mic,
  ChevronRight,
  Shield,
  Globe,
  Key
} from 'lucide-react';

interface OnboardingProps {
  isOpen: boolean;
  onFinish: () => void;
  onConfigureApi: () => void;
  hasApiKey: boolean;
  t: any;
}

export function DesktopOnboarding({ isOpen, onFinish, onConfigureApi, hasApiKey, t }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);

  const steps = useMemo(() => {
    const base = [
      {
        title: t.onboardingWelcomeTitle || "Welcome to Lumi OS",
        description: t.onboardingWelcomeDesc || "Your local-first, AI-driven operating system designed for neural performance and privacy.",
        icon: <Sparkles size={48} className="text-celestial-saturn" />,
        color: "from-celestial-saturn/20 to-transparent"
      },
      {
        title: t.onboardingNeuralCore || "Neural Core",
        description: t.onboardingNeuralCoreDesc || "The central sphere is your gateway. Click it to interact, or use the voice commands to control your environment.",
        icon: <Cpu size={48} className="text-blue-400" />,
        color: "from-blue-500/20 to-transparent"
      },
      {
        title: t.onboardingSpotlight || "Spotlight Search",
        description: t.onboardingSpotlightDesc || "Press Cmd+K anytime to summon the Spotlight. Find apps, run commands, and traverse shard directories instantly.",
        icon: <Search size={48} className="text-purple-400" />,
        color: "from-purple-500/20 to-transparent"
      },
      {
        title: t.onboardingPrivacy || "Privacy First",
        description: t.onboardingPrivacyDesc || "All neural training and voice processing happens on your local node. Your data remains sharded and encrypted.",
        icon: <Shield size={48} className="text-emerald-400" />,
        color: "from-emerald-500/20 to-transparent"
      }
    ];
    if (!hasApiKey) {
      base.push({
        title: t.onboardingApiSetup || "Connect Your AI",
        description: t.onboardingApiSetupDesc || "Lumi needs an LLM API key to power its intelligence. Add keys from DeepSeek, OpenAI, or any supported provider in Settings.",
        icon: <Key size={48} className="text-celestial-saturn" />,
        color: "from-celestial-saturn/20 to-transparent"
      });
    }
    return base;
  }, [hasApiKey, t]);

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 pointer-events-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/90 backdrop-blur-xl"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.9, y: 20 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.9, y: 20 }}
          className="relative w-full max-w-2xl bg-white/[0.02] border border-white/10 rounded-[3rem] overflow-hidden shadow-2xl"
        >
          {/* Progress Bar */}
          <div className="absolute top-0 left-0 right-0 h-1 flex gap-1 p-1">
            {steps.map((_, i) => (
              <div 
                key={i} 
                className={`h-full flex-1 rounded-full transition-all duration-500 ${
                  i <= currentStep ? 'bg-celestial-saturn' : 'bg-white/5'
                }`} 
              />
            ))}
          </div>

          <div className={`p-12 bg-gradient-to-br ${steps[currentStep].color} transition-all duration-1000`}>
            <div className="flex flex-col items-center text-center space-y-8">
              <motion.div
                key={currentStep}
                initial={{ opacity: 0, scale: 0.5, rotate: -20 }}
                animate={{ opacity: 1, scale: 1, rotate: 0 }}
                className="w-24 h-24 rounded-[2rem] bg-white/5 flex items-center justify-center shadow-2xl border border-white/10"
              >
                {steps[currentStep].icon}
              </motion.div>

              <div className="space-y-4">
                <motion.h2 
                  key={`title-${currentStep}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="text-4xl font-black text-white tracking-tighter"
                >
                  {steps[currentStep].title}
                </motion.h2>
                <motion.p 
                  key={`desc-${currentStep}`}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: 0.1 }}
                  className="text-lg text-white/60 leading-relaxed max-w-lg"
                >
                  {steps[currentStep].description}
                </motion.p>
              </div>

              <div className="pt-8 w-full space-y-3">
                {currentStep < steps.length - 1 ? (
                  <button
                    onClick={() => setCurrentStep(prev => prev + 1)}
                    className="w-full py-6 bg-white text-black rounded-[2rem] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all shadow-xl"
                  >
                    {t.continueBtn || 'Continue'}
                    <ChevronRight size={20} />
                  </button>
                ) : !hasApiKey ? (
                  <>
                    <button
                      onClick={onConfigureApi}
                      className="w-full py-6 bg-celestial-saturn text-black rounded-[2rem] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all shadow-[0_0_40px_rgba(255,200,80,0.3)]"
                    >
                      {t.setupApiNow || 'Set Up Now'}
                      <Key size={20} />
                    </button>
                    <button
                      onClick={onFinish}
                      className="w-full py-3 text-white/30 hover:text-white/50 text-sm font-medium transition-colors"
                    >
                      {t.skipForNow || 'Skip for now'}
                    </button>
                  </>
                ) : (
                  <button
                    onClick={onFinish}
                    className="w-full py-6 bg-celestial-saturn text-black rounded-[2rem] font-black uppercase tracking-[0.2em] flex items-center justify-center gap-3 hover:scale-[1.02] active:scale-95 transition-all shadow-[0_0_40px_rgba(255,200,80,0.3)]"
                  >
                    {t.enterWorkspace || 'Enter Workspace'}
                    <Zap size={20} fill="currentColor" />
                  </button>
                )}
              </div>

              <div className="flex gap-2">
                 <div className="text-[10px] font-black text-white/20 uppercase tracking-[0.3em]">
                   {t.poweredByLumi || 'Powered by Lumi Neural Core v2.0'}
                 </div>
              </div>
            </div>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
