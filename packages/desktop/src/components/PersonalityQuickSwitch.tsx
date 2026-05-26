import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, ChevronDown } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';

export function PersonalityQuickSwitch({ t, callActive }: { t: any; callActive: boolean }) {
  const { personalityId, setPersonalityId } = useApp();
  const [personalities, setPersonalities] = useState<any[]>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    fetch('/api/personalities')
      .then(res => res.json())
      .then(data => setPersonalities(Array.isArray(data) ? data : data.personalities || []))
      .catch(() => {});
  }, []);

  const current = personalities.find((p: any) => p.id === personalityId);

  const handleSwitch = (id: string) => {
    setPersonalityId(id);
    setOpen(false);
    if (callActive) {
      // Emit socket event so server switches personality mid-call
      window.dispatchEvent(new CustomEvent('lumi:switch-personality', { detail: { personalityId: id } }));
    }
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="h-10 px-3 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-2 hover:bg-white/10 hover:text-white transition-all shadow-xl"
      >
        <Sparkles size={12} />
        <span className="max-w-[80px] truncate">{current?.name || 'Lumi'}</span>
        <ChevronDown size={12} />
      </button>

      <AnimatePresence>
        {open && (
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 10 }}
            className="absolute bottom-full left-0 mb-2 w-48 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-2 z-50 shadow-2xl max-h-64 overflow-y-auto"
          >
            {personalities.map((p: any) => (
              <button
                key={p.id}
                onClick={() => handleSwitch(p.id)}
                className={`w-full text-left px-3 py-2 rounded-xl text-xs font-bold uppercase transition-all ${
                  personalityId === p.id ? 'bg-purple-500/20 text-purple-300' : 'text-white/60 hover:bg-white/5 hover:text-white'
                }`}
              >
                {p.name || p.id}
              </button>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
