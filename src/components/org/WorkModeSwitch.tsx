import { useState } from 'react';
import { Building2, Loader2, User } from 'lucide-react';
import { toast } from 'sonner';
import { useT } from '../../lib/useT';
import type { DomainSwitchResult } from '../../contexts/AppContext';

interface Props {
  domain: 'personal' | 'work';
  onSelectDomain: (domain: 'personal' | 'work') => Promise<DomainSwitchResult>;
  onOpenOrganization: () => void;
  onCloseOrganization?: () => void;
  organizationOpen?: boolean;
  connected: boolean;
}

export function WorkModeSwitch({
  domain,
  onSelectDomain,
  onOpenOrganization,
  onCloseOrganization,
  organizationOpen = false,
  connected,
}: Props) {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const [switching, setSwitching] = useState(false);
  const isWork = domain === 'work';

  const reportResult = (result: DomainSwitchResult, target: 'personal' | 'work') => {
    if (result?.success) {
      toast.success(result.message || (target === 'work'
        ? ui('已进入组织', 'Entered organization')
        : ui('已切换到个人', 'Switched to personal')));
    } else {
      toast.error(result?.message || ui('模式切换失败', 'Mode switch failed'));
    }
  };

  const handlePersonal = async () => {
    if (switching) return;
    if (domain === 'personal') {
      onCloseOrganization?.();
      return;
    }
    setSwitching(true);
    try {
      const result = await onSelectDomain('personal');
      reportResult(result, 'personal');
      if (result?.success) onCloseOrganization?.();
    } catch (err: any) {
      toast.error(err.message || ui('模式切换失败', 'Mode switch failed'));
    } finally {
      setSwitching(false);
    }
  };

  const handleOrganization = async () => {
    if (switching) return;
    if (!connected) {
      onOpenOrganization();
      return;
    }
    if (domain === 'work') {
      onOpenOrganization();
      return;
    }
    setSwitching(true);
    try {
      const result = await onSelectDomain('work');
      reportResult(result, 'work');
      if (result?.success) onOpenOrganization();
    } catch (err: any) {
      toast.error(err.message || ui('模式切换失败', 'Mode switch failed'));
    } finally {
      setSwitching(false);
    }
  };

  return (
    <div className={`flex h-8 items-center rounded-full border border-white/10 bg-black/20 p-0.5 text-[11px] font-black uppercase tracking-widest ${switching ? 'opacity-75' : ''}`}>
      <button
        type="button"
        onClick={handlePersonal}
        disabled={switching}
        title={ui('切换到个人', 'Switch to personal')}
        className={`flex h-7 min-w-[78px] items-center justify-center gap-1.5 rounded-full px-3 transition-all ${
          !isWork && !organizationOpen
            ? 'bg-white/12 text-white shadow-[0_0_18px_rgba(255,255,255,0.08)]'
            : 'text-white/45 hover:bg-white/8 hover:text-white/75'
        } disabled:cursor-wait`}
      >
        <User size={13} />
        {ui('个人', 'Personal')}
      </button>
      <button
        type="button"
        onClick={handleOrganization}
        disabled={switching}
        title={connected ? ui('打开组织', 'Open organization') : ui('创建组织', 'Create organization')}
        className={`flex h-7 min-w-[82px] items-center justify-center gap-1.5 rounded-full px-3 transition-all ${
          isWork || organizationOpen
            ? 'border border-blue-400/25 bg-blue-500/18 text-blue-100 shadow-[0_0_18px_rgba(59,130,246,0.16)]'
            : 'text-white/45 hover:bg-white/8 hover:text-white/75'
        } disabled:cursor-wait`}
      >
        {switching ? <Loader2 size={13} className="animate-spin" /> : <Building2 size={13} />}
        {ui('组织', 'Organization')}
      </button>
    </div>
  );
}
