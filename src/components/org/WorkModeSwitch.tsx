import React from 'react';
import { motion } from 'motion/react';
import { Briefcase, User } from 'lucide-react';
import { useT } from '../../lib/useT';

interface Props {
  domain: 'personal' | 'work';
  onToggle: () => void;
  connected: boolean;
}

export function WorkModeSwitch({ domain, onToggle, connected }: Props) {
  const t = useT();
  const isWork = domain === 'work';

  return (
    <motion.button
      onClick={onToggle}
      className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all cursor-pointer ${
        isWork
          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40'
          : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
      }`}
      whileTap={{ scale: 0.95 }}
      title={isWork ? 'Switch to personal domain' : connected ? 'Switch to work domain' : 'Not connected to an organization'}
    >
      <motion.div
        className={`absolute left-1 top-1 bottom-1 w-[calc(50%-4px)] rounded-full ${
          isWork ? 'bg-blue-500/30' : 'bg-white/10'
        }`}
        animate={{ x: isWork ? 'calc(100% + 4px)' : 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      />
      <span className="relative z-10 flex items-center gap-1.5">
        {isWork ? <Briefcase size={14} /> : <User size={14} />}
        {isWork ? 'Work' : 'Personal'}
      </span>
      {!connected && (
        <span className="relative z-10 text-xs text-amber-400 ml-1">{t.orgConnectionOffline}</span>
      )}
    </motion.button>
  );
}
