import { useState } from 'react';
import { motion } from 'motion/react';
import { Briefcase, Loader2, User } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../lib/useT';
import type { DomainSwitchResult } from '../../contexts/AppContext';

interface Props {
  domain: 'personal' | 'work';
  onToggle: () => Promise<DomainSwitchResult>;
  connected: boolean;
}

export function WorkModeSwitch({ domain, onToggle, connected }: Props) {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const [switching, setSwitching] = useState(false);
  const isWork = domain === 'work';

  const handleToggle = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      const result = await onToggle();
      if (result?.success) {
        toast.success(result.message || (result.domain === 'work' ? ui('已切换到工作域', 'Switched to work domain') : ui('已切换到个人域', 'Switched to personal domain')));
      } else {
        toast.error(result?.message || ui('模式切换失败', 'Mode switch failed'));
      }
    } catch (err: any) {
      toast.error(err.message || ui('模式切换失败', 'Mode switch failed'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <motion.button
      onClick={handleToggle}
      disabled={switching}
      className={`relative flex items-center gap-2 px-4 py-2 rounded-full text-sm font-medium transition-all cursor-pointer ${
        isWork
          ? 'bg-blue-600/20 text-blue-400 border border-blue-500/40'
          : 'bg-white/5 text-white/60 border border-white/10 hover:bg-white/10'
      } ${switching ? 'opacity-70 cursor-wait' : ''}`}
      whileTap={{ scale: 0.95 }}
      title={isWork ? ui('切换到个人域', 'Switch to personal domain') : connected ? ui('切换到工作域', 'Switch to work domain') : ui('未发现可用组织，点击后会尝试自动发现', 'No available organization found. Click to try auto-discovery.')}
    >
      <motion.div
        className={`absolute left-1 top-1 bottom-1 w-[calc(50%-4px)] rounded-full ${
          isWork ? 'bg-blue-500/30' : 'bg-white/10'
        }`}
        animate={{ x: isWork ? 'calc(100% + 4px)' : 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      />
      <span className="relative z-10 flex items-center gap-1.5">
        {switching ? <Loader2 size={14} className="animate-spin" /> : isWork ? <Briefcase size={14} /> : <User size={14} />}
        {isWork ? ui('工作', 'Work') : ui('个人', 'Personal')}
      </span>
      {!connected && (
        <span className="relative z-10 text-xs text-amber-400 ml-1">{t.orgConnectionOffline}</span>
      )}
    </motion.button>
  );
}
