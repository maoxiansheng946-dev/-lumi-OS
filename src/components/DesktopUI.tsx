import React, { useState, useEffect, useCallback, useRef, lazy, Suspense } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { HardcoreBootSequence } from './HardcoreBootSequence';
import { GlobalNodeMap } from './GlobalNodeMap';
import { sounds } from '../services/soundService';
import {
  Rocket,
  Cpu,
  Globe,
  Settings as SettingsIcon,
  Shield,
  Zap,
  X,
  User as UserIcon,
  Search,
  Folder,
  FileText,
  Activity,
  Wifi,
  Volume2,
  VolumeX,
  Battery,
  Bluetooth,
  Moon,
  Sun,
  Maximize2,
  Minimize2,
  Minus,
  Square,
  ChevronRight,
  ArrowLeft,
  Clock,
  Bell,
  Disc,
  Headphones,
  BrainCircuit,
  Sparkles,
  Box,
  CheckCircle2,
  XCircle,
  Wrench,
  MessageSquare,
  Crown,
  Castle,
  Brush,
  Mic,
  Briefcase,
} from 'lucide-react';
import { toast } from 'sonner';
import { GlassCard } from './SharedUI';
import { LocalAgentSphere } from './LocalAgentSphere';
import { VoiceTrainingDialog } from './VoiceTrainingDialog';
import { VoicePicker } from './VoicePicker';
import { VoiceForge } from './VoiceForge';
import { ToolPanel } from './ToolPanel';
import { GitHubMCPBrowser } from './GitHubMCPBrowser';
import { SkillCenter } from './SkillCenter';
import { NotificationCenter } from './NotificationCenter';
import { TokenDashboard } from './TokenDashboard';
import { SubscriptionPanel } from './SubscriptionPanel';
import { useContextMenu } from '@/hooks/useContextMenu';
import { ContextMenu } from './ContextMenu';
import { DesktopOnboarding } from './DesktopOnboarding';
import { DeviceSyncCenter } from './DeviceSyncCenter';
import { AgentChatPage } from './AgentChatPage';
import { OrgHub } from './org/OrgHub';
import { OrgPortal } from './OrgPortal';
import { WorkModeSwitch } from './org/WorkModeSwitch';
import { Sanctuary } from './Sanctuary';
import { MemoryAvatarLab } from './MemoryAvatarLab';
import { AvatarStudio } from './AvatarStudio';
import { ReminderPanel } from './ReminderPanel';
import { PetAvatar } from './SpriteAnimator';
import { getDefaultPets } from '../pets/defaults';
import type { PetConfig } from '../pets/types';
import { NeuralSynthesisMonitor } from './NeuralSynthesisMonitor';
import { ContributorNodePanel } from './ContributorNodePanel';
import { MeshSyncSelector } from './MeshSyncSelector';
import { useSocket } from '@/hooks/useSocket';
import { useAmbientPoller } from '@/hooks/useAmbientPoller';
import { useVoiceCall } from '@/hooks/useVoiceCall';
import { useApp } from '@/contexts/AppContext';
const NexusGlobe = lazy(() => import('./NexusGlobe/NexusGlobe').then(m => ({ default: m.NexusGlobe })));
import WorkflowPanel, { type WorkflowStep } from './WorkflowPanel';
import { useWakeWord } from '../hooks/useWakeWord';
import { useGestureDetector } from '../hooks/useGestureDetector';
import { ErrorBoundary } from './ErrorBoundary';
import { ToolConfirmDialog } from './ToolConfirmDialog';

const KnowledgeBase = lazy(() => import('./KnowledgeBase').then(m => ({ default: m.KnowledgeBase })));
import { PersonalityEditor } from './PersonalityEditor';
import { Settings } from './Settings';
import { systemService } from '@/services/systemService';
import { usePlatform } from '@/hooks/usePlatform';

// Define the shape of the native API
interface NativeFile {
  name: string;
  path: string;
  isDirectory: boolean;
}

declare global {
  interface Window {
    lumiElectron?: {
      getSystemInfo: () => Promise<{ platform: string; hostname: string; freeMemory: number }>;
      listHomeFiles: () => Promise<NativeFile[]>;
      selectDirectory: () => Promise<string | null>;
      runCommand: (command: string) => Promise<{ success: boolean; output: string }>;
    };
  }
}

interface WindowProps {
  id: string;
  title: string;
  icon: React.ReactNode;
  children: React.ReactNode;
  onClose: (id: string) => void;
  isActive: boolean;
  onFocus: (id: string) => void;
  onMinimize: (id: string) => void;
  onMinimizeComplete: (id: string) => void;
  isMinimized: boolean;
  t: any;
  colorClass?: string;
  width?: string | number;
  height?: string | number;
  zIndex?: number;
}

function OSWindow({
  id,
  title,
  icon,
  children,
  onClose,
  isActive,
  onFocus,
  onMinimize,
  onMinimizeComplete,
  isMinimized,
  t,
  colorClass = 'from-celestial-mars to-celestial-saturn',
  width = 'auto',
  height = 'auto',
  zIndex = 10,
}: WindowProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [snapZone, setSnapZone] = useState<'none' | 'left' | 'right'>('none');
  const [isDragging, setIsDragging] = useState(false);
  const constrainRef = React.useRef<HTMLDivElement>(null);

  const isSnapped = isMaximized || snapZone !== 'none';

  return (
    <>
      {/* Invisible drag boundary fills the viewport so windows can be dragged freely */}
      <div ref={constrainRef} className="fixed inset-0 pointer-events-none z-0" />
      <motion.div
        drag={!isMaximized && !isMinimized}
        dragElastic={0.1}
        dragTransition={{ bounceStiffness: 400, bounceDamping: 25 }}
        dragConstraints={constrainRef}
        onDragStart={() => setIsDragging(true)}
        onDragEnd={(_e, info) => {
          setIsDragging(false);
          if (info.point.x < 80) setSnapZone('left');
          else if (info.point.x > window.innerWidth - 80) setSnapZone('right');
          else setSnapZone('none');
        }}
        initial={{ opacity: 0, scale: 0.85, y: 20, filter: 'blur(0px)' }}
        animate={isMinimized
          ? { opacity: 0, scale: 0.3, y: 40, filter: 'blur(4px)', transition: { duration: 0.25, ease: [0.4, 0, 1, 1] } }
          : {
              opacity: 1,
              scale: 1,
              y: 0,
              filter: 'blur(0px)',
              width: isMaximized ? '100vw' : snapZone !== 'none' ? '50vw' : width,
              height: isMaximized ? 'calc(100vh - 40px)' : snapZone !== 'none' ? 'calc(100vh - 40px)' : height,
              top: isSnapped ? '40px' : undefined,
              left: isMaximized ? '0' : snapZone === 'left' ? '0' : snapZone === 'right' ? '50%' : undefined,
              x: 0,
              transition: { type: 'spring', stiffness: 300, damping: 26, mass: 0.8 },
            }
        }
        onAnimationComplete={() => {
          if (isMinimized) onMinimizeComplete(id);
        }}
        exit={{ opacity: 0, scale: 0.85, y: 20, filter: 'blur(4px)', transition: { duration: 0.18, ease: [0.4, 0, 1, 1] } }}
        style={{
          zIndex: isMinimized ? zIndex - 100 : zIndex,
          position: isSnapped ? 'fixed' : 'absolute',
          ...(!isSnapped ? { top: '30%', left: '30%' } : {}),
        }}
        onClick={() => !isMinimized && onFocus(id)}
        className={`os-window pointer-events-auto overflow-hidden ${isMaximized ? 'rounded-none' : 'rounded-[2.5rem]'} ${isMinimized ? 'pointer-events-none' : ''} ${isDragging ? 'is-dragging' : ''}`}
      >
        <div
          className="os-window-header px-6"
        >
          <div className="flex items-center gap-4 select-none">
            <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${colorClass} flex items-center justify-center p-1.5 shadow-lg border border-white/10 group-hover:rotate-6 transition-transform`}>
              {React.isValidElement(icon)
                ? React.cloneElement(icon as React.ReactElement<any>, { size: 16, className: 'text-white' })
                : icon}
            </div>
            <div className="flex flex-col">
              <span className="text-[10px] font-black tracking-[0.2em] uppercase text-white/80 leading-none mb-0.5">{title}</span>
              <span className="text-[7px] font-bold text-white/20 uppercase tracking-widest leading-none">{t.statusOperational || 'Status: Operational / Shared Root'}</span>
            </div>
          </div>
          <div className="flex gap-3">
            <button
              onClick={(e) => { e.stopPropagation(); onClose(id); }}
              className="w-3 h-3 rounded-full bg-red-500/40 border border-red-500/60 hover:bg-red-500/80 flex items-center justify-center transition-colors group/close"
            >
              <X size={6} className="text-white opacity-0 group-hover/close:opacity-100 transition-opacity" />
            </button>
          </div>
        </div>
        <div
          className="os-window-content bg-[#05050a]/98 backdrop-blur-3xl custom-scrollbar h-full"
          style={isDragging ? { backdropFilter: 'none' } : undefined}
        >
          {children}
        </div>
      </motion.div>
    </>
  );
}

function ControlCenter({ isOpen, onClose, t, brightness, setBrightness, volume, setVolume, theme, setTheme, lang, setLang, isLightMode, setIsLightMode, toggleWindow }: {
  isOpen: boolean;
  onClose: () => void;
  t: any;
  brightness: number;
  setBrightness: (v: number) => void;
  volume: number;
  setVolume: (v: number) => void;
  theme: string;
  setTheme: (t: string) => void;
  lang: 'en' | 'zh';
  setLang: (l: 'en' | 'zh') => void;
  isLightMode: boolean;
  setIsLightMode: (v: boolean) => void;
  toggleWindow: (id: string) => void;
}) {
  const [nightShift, setNightShift] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const { selectedVoiceId, unreadCount } = useApp();

  if (!isOpen) return null;

  const themes = [
    { id: 'celestial', label: t.celestial || 'Celestial', color: 'bg-celestial-saturn', icon: <Sparkles size={14} /> },
    { id: 'nebula', label: t.nebula || 'Nebula', color: 'bg-indigo-500', icon: <Moon size={14} /> },
    { id: 'cyber', label: t.cyber || 'Cyber', color: 'bg-emerald-500', icon: <Zap size={14} /> },
  ];

  return (
    <motion.div 
      initial={{ opacity: 0, y: -20, scale: 0.95 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -20, scale: 0.95 }}
      className="fixed top-12 right-6 w-80 glass-dark rounded-[2.5rem] p-6 z-[100] shadow-[0_30px_70px_rgba(0,0,0,0.7)] border border-white/10 backdrop-blur-3xl"
    >
      <div className="flex items-center justify-between mb-6">
        <h3 className="text-xs font-black uppercase tracking-widest text-white/40">{t.nexusControl || 'Nexus Control'}</h3>
        <div className="flex bg-white/5 p-1 rounded-xl">
           <button 
            onClick={() => setLang('en')}
            className={`px-3 py-1 text-[8px] font-black uppercase tracking-widest rounded-lg transition-all ${lang === 'en' ? 'bg-white text-black' : 'text-white/40'}`}
           >EN</button>
           <button 
            onClick={() => setLang('zh')}
            className={`px-3 py-1 text-[8px] font-black uppercase tracking-widest rounded-lg transition-all ${lang === 'zh' ? 'bg-white text-black' : 'text-white/40'}`}
           >ZH</button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-4 mb-6">
        <div className="col-span-1 bg-white/5 rounded-2xl p-4 flex flex-col gap-3">
          <div className="flex gap-3">
             <button
               onClick={async () => {
                 try { const r = await fetch('/api/health'); if (r.ok) toast.info(t.serverOnline); else toast.info(t.serverDegraded); }
                 catch { toast.error(t.serverOffline); }
               }}
               className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white active:scale-95 transition-transform"
               title={t.wifi}
             ><Wifi size={18} /></button>
             <button
               onClick={() => toast.info(t.bluetoothRequiresDesktop)}
               className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/40 active:scale-95 transition-transform"
               title={t.bluetooth}
             ><Bluetooth size={18} /></button>
          </div>
          <div className="flex gap-3">
             <button 
               className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${theme === 'cyber' ? 'bg-emerald-500 text-white' : 'bg-white/10 text-white/40'}`}
               onClick={() => { setTheme('cyber'); sounds.playPulse(); }}
               title={t.cyber}
             >
               <Rocket size={18} />
             </button>
             <button 
               className={`w-10 h-10 rounded-full flex items-center justify-center transition-all ${theme === 'nebula' ? 'bg-indigo-500 text-white' : 'bg-white/10 text-white/40'}`}
               onClick={() => { setTheme('nebula'); sounds.playPulse(); }}
               title={t.nebula}
             >
               <Moon size={18} />
             </button>
          </div>
        </div>
        <div className="col-span-1 bg-white/5 rounded-[1.5rem] p-5 flex flex-col justify-between">
           <div className="space-y-2">
             <div className="flex justify-between items-center text-[10px] font-bold text-white/40 uppercase">
               <span>{t.display || 'Display'}</span>
               <button
                 onClick={() => setIsLightMode(!isLightMode)}
                 className={`w-8 h-8 rounded-full flex items-center justify-center transition-all ${
                   isLightMode ? 'bg-amber-400 text-black' : 'bg-white/10 text-blue-300'
                 }`}
                 title={isLightMode ? (t.lightMode || 'Light') : (t.darkMode || 'Dark')}
               >
                 {isLightMode ? <Sun size={14} /> : <Moon size={14} />}
               </button>
             </div>
             <div className="h-4 w-full bg-white/5 rounded-full relative group cursor-pointer" onClick={(e) => {
               const rect = e.currentTarget.getBoundingClientRect();
               const percent = (e.clientX - rect.left) / rect.width;
               const v = Math.min(100, Math.max(0, Math.round(percent * 100)));
               setBrightness(v);
               systemService.setBrightness(v);
             }}>
               <motion.div 
                 animate={{ width: `${brightness}%` }}
                 className="h-full bg-white/60 rounded-full" 
               />
             </div>
           </div>
           <div className="space-y-2">
             <div className="flex justify-between items-center text-[10px] font-bold text-white/40 uppercase">
               <span>{t.sound || 'Sound'}</span>
               <Volume2 size={12} />
             </div>
             <div className="h-4 w-full bg-white/5 rounded-full relative group cursor-pointer" onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                const percent = (e.clientX - rect.left) / rect.width;
                const v = Math.min(100, Math.max(0, Math.round(percent * 100)));
                setVolume(v);
                systemService.setVolume(v);
             }}>
               <motion.div
                 animate={{ width: `${volume}%` }}
                 className="h-full bg-celestial-saturn rounded-full"
               />
             </div>
           </div>
        </div>
      </div>

      {/* Quick Access: Personality / Voice / LLM */}
      <div className="space-y-2 mb-6">
        <span className="text-[10px] font-black text-white/20 uppercase tracking-widest px-2">{t.aiCore || 'AI Core'}</span>
        <div className="space-y-1">
          {/* Voice selector */}
          <button
            onClick={() => { toggleWindow('voice'); onClose(); }}
            className="w-full flex items-center justify-between p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Volume2 size={14} className="text-pink-400" />
              <span className="text-xs font-bold text-white/70">{t.voiceLabel || 'Voice'}</span>
            </div>
            <span className="text-[10px] font-black text-pink-400 uppercase truncate max-w-[100px]">{selectedVoiceId || (t.defaultLabel || 'Default')}</span>
          </button>

          {/* Notifications shortcut */}
          <button
            onClick={() => { toggleWindow('notifications'); onClose(); }}
            className="w-full flex items-center justify-between p-3 bg-white/5 rounded-xl hover:bg-white/10 transition-colors"
          >
            <div className="flex items-center gap-2">
              <Bell size={14} className="text-amber-400" />
              <span className="text-xs font-bold text-white/70">{t.notificationsLabel || 'Notifications'}</span>
            </div>
            <span className="text-[10px] font-black text-amber-400">{unreadCount} {t.unread || 'unread'}</span>
          </button>
        </div>
      </div>

      <div className="space-y-4">
        <div className="space-y-2">
          <span className="text-[10px] font-black text-white/20 uppercase tracking-widest px-2">{t.matrixSynthesis || 'Matrix Synthesis'}</span>
          <div className="grid grid-cols-3 gap-2">
            {themes.map((themeOption) => (
              <button 
                key={themeOption.id}
                onClick={() => { setTheme(themeOption.id); sounds.playPulse(); }}
                className={`flex flex-col items-center gap-2 p-3 rounded-2xl transition-all ${theme === themeOption.id ? 'bg-white/10 shadow-[0_0_20px_rgba(255,255,255,0.05)]' : 'hover:bg-white/5'}`}
              >
                <div className={`w-8 h-8 rounded-full ${themeOption.color} flex items-center justify-center text-white shadow-lg`}>
                  {themeOption.icon}
                </div>
                <span className="text-[8px] font-black uppercase text-white/40">{themeOption.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="space-y-1">
        <div
          onClick={() => {
            const next = !nightShift;
            setNightShift(next);
            document.documentElement.style.filter = next ? 'sepia(0.3) hue-rotate(-10deg)' : '';
            toast.info(next ? t.nightShiftOn : t.nightShiftOff);
          }}
          className="flex items-center justify-between p-3 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${nightShift ? 'bg-orange-500/30 text-orange-400' : 'bg-orange-500/20 text-orange-500'}`}><Sun size={16} /></div>
            <span className="text-xs font-bold text-white/80">{t.nightShift || 'Night Shift'}</span>
          </div>
          <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${nightShift ? 'bg-orange-500' : 'bg-white/10'}`}>
            <div className={`w-3 h-3 rounded-full bg-white transition-transform ${nightShift ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
        </div>
        <div
          onClick={() => {
            const next = !focusMode;
            setFocusMode(next);
            toast.info(next ? t.focusModeOn : t.focusModeOff);
          }}
          className="flex items-center justify-between p-3 bg-white/5 rounded-xl cursor-pointer hover:bg-white/10 transition-colors"
        >
          <div className="flex items-center gap-3">
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center ${focusMode ? 'bg-purple-500/30 text-purple-400' : 'bg-purple-500/20 text-purple-500'}`}><Maximize2 size={16} /></div>
            <span className="text-xs font-bold text-white/80">{t.focusMode || 'Focus Mode'}</span>
          </div>
          <div className={`w-8 h-4 rounded-full p-0.5 transition-colors ${focusMode ? 'bg-purple-500' : 'bg-white/10'}`}>
            <div className={`w-3 h-3 rounded-full bg-white transition-transform ${focusMode ? 'translate-x-4' : 'translate-x-0'}`} />
          </div>
        </div>
      </div>
      
      <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between font-sans">
        <span className="text-[10px] font-bold text-white/20 tracking-widest uppercase">{t.desktopVersion || 'Lumi OS v2.0.4'}</span>
        <button onClick={onClose} className="text-[10px] font-black text-celestial-saturn hover:underline uppercase tracking-widest">{t.closeNexus || 'Close Nexus'}</button>
      </div>
    </motion.div>
  );
}

interface DesktopIconProps {
  label: string;
  icon: React.ReactNode;
  colorClass: string;
  onClick: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}

function DesktopIcon({ label, icon, colorClass, onClick, onContextMenu }: DesktopIconProps) {
  return (
    <div
      onDoubleClick={onClick}
      onContextMenu={onContextMenu}
      className="desktop-icon group cursor-pointer"
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(); }}}
    >
      <div className={`desktop-icon-img bg-gradient-to-br ${colorClass} shadow-[0_10px_20px_-5px_rgba(0,0,0,0.5)]`}>
        <div className="text-white group-hover:rotate-12 transition-transform">
          {icon}
        </div>
      </div>
      <span className="desktop-icon-label">{label}</span>
    </div>
  );
}

function KernelMonitorApp({ t }: { t: any }) {
  const [data, setData] = useState<number[]>([]);
  const [stats, setStats] = useState({ cpu: 0, ram: { used: 0, total: 0, percent: 0 }, platform: '', release: '', arch: '', hostname: '', cpus: 0, uptime: 0 });
  const [tasks, setTasks] = useState<any[]>([]);

  useEffect(() => {
    const fetchStats = async () => {
      try {
        const res = await fetch('/api/system/stats');
        if (!res.ok) return;
        const sys = await res.json();
        setStats(sys);
        setData(prev => {
          const next = [...prev, sys.cpu || 0];
          return next.slice(-30);
        });
      } catch {}
    };

    fetchStats();
    const interval = setInterval(fetchStats, 2000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const res = await fetch('/api/scheduler/tasks');
        if (!res.ok) return;
        const data = await res.json();
        setTasks(data.tasks || []);
      } catch {}
    };
    fetchTasks();
    const interval = setInterval(fetchTasks, 10000);
    return () => clearInterval(interval);
  }, []);

  const chipLabel = stats.platform ? `${stats.platform.toUpperCase()}_${stats.arch.toUpperCase()}_NODE` : 'NEURAL_NODE';
  const uptimeFmt = stats.uptime ? `${Math.floor(stats.uptime / 3600)}h ${Math.floor((stats.uptime % 3600) / 60)}m` : '';
  const loadStatus = stats.cpu > 80 ? 'WARN' : stats.cpu > 50 ? 'LOAD' : 'IDLE';

  return (
    <div className="p-8 h-full flex flex-col space-y-6 font-sans">
      <div className="flex justify-between items-center bg-black/40 p-5 rounded-[2rem] border border-white/5 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-celestial-saturn/10 flex items-center justify-center text-celestial-saturn border border-celestial-saturn/20 shadow-[0_0_20px_rgba(255,200,80,0.1)]">
            <Cpu size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black text-white/40 uppercase tracking-widest leading-none mb-1">{stats.hostname || t.localIntelNode || 'Local Node'}</div>
            <div className="text-lg font-black text-white tracking-tight">{chipLabel}</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black text-celestial-saturn uppercase tracking-widest leading-none mb-1">{loadStatus} · {stats.cpus}c · {uptimeFmt}</div>
          <div className="text-xs font-mono text-white/40">{stats.release || ''} / CPU {stats.cpu}%</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t.neuralThroughput || 'CPU Load', value: `${stats.cpu}%`, bar: stats.cpu, color: 'bg-celestial-saturn' },
          { label: t.synapticLoad || 'Memory', value: `${stats.ram.used} / ${stats.ram.total} GB`, bar: stats.ram.percent, color: 'bg-emerald-500' },
          { label: t.meshLatency || 'Disk I/O', value: `${stats.cpus} Cores · ${stats.arch}`, bar: 0, color: 'bg-blue-500' }
        ].map((stat, i) => (
          <div key={i} className="p-5 bg-white/5 rounded-[2rem] border border-white/5 space-y-3 hover:bg-white/10 transition-colors cursor-default">
            <div className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">{stat.label}</div>
            <div className="text-xl font-black text-white tracking-tighter">{stat.value}</div>
            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
               <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${stat.bar}%` }}
                className={`h-full ${stat.color}`}
               />
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 bg-black/40 rounded-[2.5rem] border border-white/5 p-6 relative overflow-hidden">
        <div className="absolute inset-0 opacity-10">
          <div className="w-full h-full" style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.05) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.05) 1px, transparent 1px)', backgroundSize: '20px 20px' }} />
        </div>
        <div className="relative h-full flex items-end gap-1">
          {data.map((val, i) => (
            <motion.div
              key={i}
              initial={{ height: 0 }}
              animate={{ height: `${val}%` }}
              className="flex-1 bg-gradient-to-t from-celestial-saturn/40 to-celestial-saturn rounded-t-sm"
              style={{ minWidth: '4px' }}
            />
          ))}
        </div>
      </div>

      <div className="bg-black/40 rounded-[2rem] border border-white/5 p-5 space-y-4">
        <div className="flex items-center justify-between">
          <div className="text-[10px] font-black uppercase tracking-widest text-white/40">{t.autonomyRuntime || 'Autonomy Runtime'}</div>
          <div className="text-[9px] font-bold uppercase tracking-widest text-celestial-saturn">{tasks.filter(t => t.active).length} {t.activeLabel || 'active'}</div>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          {tasks.map(task => (
            <div key={task.id} className="p-3 bg-white/5 rounded-xl border border-white/5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[10px] font-black uppercase tracking-widest text-white/70 truncate">{task.id}</div>
                <div className="text-[9px] text-white/25 font-mono">{task.cron}{task.lastRun ? ` / ${new Date(task.lastRun).toLocaleTimeString()}` : ''}</div>
              </div>
              <div className={`w-2 h-2 rounded-full shrink-0 ${task.active ? 'bg-green-500 animate-pulse' : 'bg-white/20'}`} />
            </div>
          ))}
          {tasks.length === 0 && (
            <div className="col-span-2 text-[10px] text-white/25 font-bold uppercase tracking-widest">{t.schedulerNotReporting || 'Scheduler not reporting yet'}</div>
          )}
        </div>
      </div>
    </div>
  );
}
function Spotlight({ isOpen, onClose, onSelect, apps, t }: { isOpen: boolean; onClose: () => void; onSelect: (id: string) => void; apps: any[]; t: any }) {
  const [query, setQuery] = useState('');
  
  const filteredApps = apps.filter(app => 
    app.label.toLowerCase().includes(query.toLowerCase()) || 
    app.id.toLowerCase().includes(query.toLowerCase())
  );

  if (!isOpen) return null;

  return (
    <motion.div 
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4 pointer-events-auto"
      onClick={onClose}
    >
      <motion.div 
        initial={{ y: -20, scale: 0.95 }}
        animate={{ y: 0, scale: 1 }}
        className="w-full max-w-xl glass-dark border border-white/10 rounded-[2rem] overflow-hidden shadow-[0_50px_100px_rgba(0,0,0,0.8)]"
        onClick={e => e.stopPropagation()}
      >
        <div className="p-6 flex items-center gap-4 border-b border-white/5">
          <Search size={24} className="text-white/40" />
          <input 
            autoFocus
            placeholder={t.searchNeuralHub || "Search Lumi Neural Hub..."}
            className="flex-1 bg-transparent border-none outline-none text-xl font-bold text-white placeholder:text-white/20"
            value={query}
            onChange={e => setQuery(e.target.value)}
          />
          <div className="px-2 py-1 bg-white/5 rounded text-[10px] font-black text-white/40 tracking-widest border border-white/5">ESC</div>
        </div>
        <div className="flex-1 overflow-y-auto p-2 custom-scrollbar">
          {filteredApps.length > 0 ? (
            filteredApps.map(app => (
              <button
                key={app.id}
                onClick={() => { onSelect(app.id); onClose(); }}
                className="w-full p-4 flex items-center gap-4 hover:bg-white/5 rounded-2xl transition-colors text-left group"
              >
                <div className={`w-12 h-12 rounded-xl bg-gradient-to-br ${app.color} flex items-center justify-center p-2 shadow-lg`}>
                  {React.isValidElement(app.icon) ? React.cloneElement(app.icon, { size: 24 }) : app.icon}
                </div>
                <div className="flex-1">
                  <div className="text-sm font-black text-white tracking-tight">{app.label}</div>
                  <div className="text-[10px] text-white/30 uppercase tracking-widest">{t.neuralApp || 'Neural Application'}</div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity">
                  <ChevronRight size={16} className="text-white/40" />
                </div>
              </button>
            ))
          ) : (
             <div className="p-12 text-center text-white/20">
                <BrainCircuit size={48} className="mx-auto mb-4 opacity-10" />
                <p className="text-xs font-black uppercase tracking-widest">{t.noNeuralNodes || 'No neural nodes found'}</p>
             </div>
          )}
        </div>
      </motion.div>
    </motion.div>
  );
}

function DailyCapability({ t, onInstall }: { t: any; onInstall: (skillId: string) => void }) {
  const [skill, setSkill] = useState<{ id: string; name: string; desc: string; iconColor: string } | null>(null);
  const [installing, setInstalling] = useState(false);

  useEffect(() => {
    const skills = [
      { id: 'pixelle', name: 'Pixelle Studio', desc: t.pixelleDesc || 'AI image & video generation', iconColor: 'from-purple-500 to-pink-500' },
      { id: 'minimax', name: 'MiniMax Studio', desc: t.minimaxDesc || 'Music, video, image & voice AI', iconColor: 'from-amber-400 to-yellow-500' },
      { id: 'desktop-automation', name: 'Desktop Commander', desc: t.desktopCommanderDesc || 'Full desktop control via AI', iconColor: 'from-cyan-500 to-blue-500' },
      { id: 'video-editor', name: 'Video Forge', desc: t.videoForgeDesc || 'Video & audio editing suite', iconColor: 'from-rose-500 to-orange-500' },
      { id: 'fetcher', name: 'Web Fetcher Pro', desc: t.webFetcherProDesc || 'Smart web content extraction', iconColor: 'from-blue-500 to-cyan-400' },
      { id: 'code-sandbox', name: 'Code Sandbox', desc: t.codeSandboxDesc || 'Run Python & JS in cloud sandbox', iconColor: 'from-green-500 to-emerald-400' },
    ];
    const idx = new Date().getDate() % skills.length;
    fetch('/api/skills').then(r => r.json()).then(data => {
      const installed = (data.skills || []).map((s: any) => s.name?.toLowerCase?.() || '');
      const uninstalled = skills.filter(s => !installed.some((n: string) => n.includes(s.id)));
      setSkill(uninstalled.length > 0 ? uninstalled[idx % uninstalled.length] : null);
    }).catch(() => {});
  }, []);

  if (!skill) return null;

  const handleInstall = async () => {
    setInstalling(true);
    try {
      await fetch('/api/marketplace/skills/acquire', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ skillId: `skill-${skill.id}`, skillName: skill.name, installSource: 'bundled', installPath: `server/skills/bundled/${skill.id}` }),
      });
      toast.success(`${skill.name} installed!`);
      onInstall(skill.id);
    } catch { toast.error(t.installFailed || 'Install failed'); }
    finally { setInstalling(false); }
  };

  return (
    <GlassCard className="p-5 rounded-[2rem] border-white/5 bg-black/20 space-y-3">
      <div className="flex items-center gap-2">
        <Sparkles size={12} className="text-celestial-saturn" />
        <span className="text-[9px] font-black uppercase tracking-widest text-white/30">{t.dailyCapability || 'Daily Capability'}</span>
      </div>
      <div className="flex items-center gap-3">
        <div className={`w-9 h-9 rounded-xl bg-gradient-to-br ${skill.iconColor} flex items-center justify-center shrink-0`}>
          <Sparkles size={14} className="text-white" />
        </div>
        <div className="min-w-0 flex-1">
          <h4 className="text-[11px] font-bold text-white/80">{skill.name}</h4>
          <p className="text-[8px] text-white/30 truncate">{skill.desc}</p>
        </div>
      </div>
      <button
        onClick={handleInstall}
        disabled={installing}
        className="w-full h-9 rounded-xl bg-white/10 text-white/60 hover:bg-white/20 text-[10px] font-bold transition-all disabled:opacity-50 flex items-center justify-center"
      >
        {installing ? (
          <motion.div animate={{ rotate: 360 }} transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}>
            <Activity size={14} />
          </motion.div>
        ) : 'Install'}
      </button>
    </GlassCard>
  );
}

export function DesktopUI({ 
  t, 
  user, 
  lang,
  setLang,
  activeTab, 
  setActiveTab, 
  onLogin, 
  onExit,
  renderTabContent 
}: { 
  t: any; 
  user: any; 
  lang: 'en' | 'zh';
  setLang: (l: 'en' | 'zh') => void;
  activeTab: string; 
  setActiveTab: (tab: string) => void; 
  onLogin: () => void;
  onExit: () => void;
  renderTabContent: (tab: string) => React.ReactNode;
}) {
  // Camera and Environment state
  const [viewMode, setViewMode] = useState<'personal' | 'world'>('personal');
  const [syncRate, setSyncRate] = useState(1);
  const cameraZ = useMotionValue(viewMode === 'personal' ? 0 : -800);

  useEffect(() => {
    cameraZ.set(viewMode === 'personal' ? 0 : -1000);
  }, [viewMode]);

  // Mouse parallax and hand gestures removed — will be re-added with face recognition

  const personalScale = useTransform(cameraZ, [0, -1000], [1, 0.4]);
  const personalOpacity = useTransform(cameraZ, [0, -400], [1, 0]);
  const { isTauri } = usePlatform();
  const { selectedVoiceId, unreadCount, notifications, addNotification, orgConnection, workDomain, switchDomain } = useApp();

  const [openWindows, setOpenWindows] = useState<string[]>(activeTab !== 'home' && activeTab !== 'knowledge' ? [activeTab] : []);
  const [minimizedWindows, setMinimizedWindows] = useState<string[]>([]);
  const [focusedWindow, setFocusedWindow] = useState<string | null>(activeTab !== 'home' && activeTab !== 'knowledge' ? activeTab : null);
  const [windowOrder, setWindowOrder] = useState<string[]>(activeTab !== 'home' && activeTab !== 'knowledge' ? [activeTab] : []);
  const [knowledgeOpen, setKnowledgeOpen] = useState(activeTab === 'knowledge');
  const [chatOpen, setChatOpen] = useState(false);
  const [chatPrefill, setChatPrefill] = useState('');
  const [sanctuaryOpen, setSanctuaryOpen] = useState(false);
  const [sanctuaryAgent, setSanctuaryAgent] = useState<any>(null);
  const [petReaction, setPetReaction] = useState<{ animation: string; until: number } | null>(null);
  const petReactionTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);

  const triggerPetReaction = (animation: string, ms: number = 1500) => {
    if (petReactionTimeout.current) clearTimeout(petReactionTimeout.current);
    setPetReaction({ animation, until: Date.now() + ms });
    petReactionTimeout.current = setTimeout(() => setPetReaction(null), ms);
  };

  const [memoryLabOpen, setMemoryLabOpen] = useState(false);
  const [equippedAccessories, setEquippedAccessories] = useState<string[]>(() => {
    try {
      const saved = localStorage.getItem('lumi_accessories');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [selectedPet, setSelectedPet] = useState<PetConfig | null>(() => {
    try {
      const saved = localStorage.getItem('lumi_selected_pet');
      if (saved) {
        const parsed = JSON.parse(saved);
        // Rehydrate spritesheet from defaults if possible
        const defaults = getDefaultPets();
        const found = defaults.find(d => d.id === parsed.id);
        if (!found?.atlas && !parsed?.atlas) return null;
        return found || parsed;
      }
    } catch {}
    return null;
  });

  // Ref to prevent echoing our own preference changes back via socket
  const petPrefsSavingRef = useRef(false);
  const savePetPrefsToServer = useCallback(async (pet: PetConfig | null, accessories: string[]) => {
    localStorage.setItem('lumi_accessories', JSON.stringify(accessories));
    if (pet) {
      localStorage.setItem('lumi_selected_pet', JSON.stringify({ id: pet.id, name: pet.name, author: pet.author }));
    } else {
      localStorage.removeItem('lumi_selected_pet');
    }
    petPrefsSavingRef.current = true;
    try {
      await fetch('/api/preferences/pet', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pet: pet ? { id: pet.id, name: pet.name, author: pet.author } : null,
          accessories,
        }),
        credentials: 'include',
      });
    } catch {}
    setTimeout(() => { petPrefsSavingRef.current = false; }, 500);
  }, []);

  const [theme, setTheme] = useState<string>('celestial');
  const [isLightMode, setIsLightMode] = useState(false);
  useEffect(() => {
    document.documentElement.setAttribute('data-mode', isLightMode ? 'light' : 'dark');
  }, [isLightMode]);
  const [nativeFiles, setNativeFiles] = useState<NativeFile[]>([]);
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('general');
  const [brightness, setBrightness] = useState(85);
  const [volume, setVolume] = useState(60);
  const [time, setTime] = useState(new Date());
  const [isWallpaperMode, setIsWallpaperMode] = useState(false);
  const [editMode, setEditMode] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(true); // Tauri starts fullscreen
  useEffect(() => {
    const check = () => {
      setIsFullscreen(window.innerWidth >= screen.width - 10 && window.innerHeight >= screen.height - 10);
    };
    check();
    window.addEventListener('resize', check);
    return () => window.removeEventListener('resize', check);
  }, []);
  const [iconPositions, setIconPositions] = useState<Record<string, { x: number; y: number }>>(() => {
    try { return JSON.parse(localStorage.getItem('lumi_icon_positions') || '{}'); } catch { return {}; }
  });
  const [wallpaper, setWallpaper] = useState<string>(() => localStorage.getItem('lumi_wallpaper_type') || 'celestial');
  const [wallpaperUrl, setWallpaperUrl] = useState<string>(() => localStorage.getItem('lumi_wallpaper_url') || '');
  const wallpaperInputRef = React.useRef<HTMLInputElement>(null);

  // Desktop icon layout: absolute positioning, 4 columns, fixed spacing
  const isOrgAdmin = orgConnection?.connected && (orgConnection.orgRole === 'owner' || orgConnection.orgRole === 'admin');
  const desktopIcons = [
    { id: 'workbench', labelKey: 'orgWorkbench', icon: <Briefcase size={24} />, colorClass: 'from-blue-500 to-indigo-600', windowId: 'org' as const },
    { id: 'tools', labelKey: 'tools', icon: <Wrench size={24} />, colorClass: 'from-amber-500 to-orange-600', windowId: 'tools' },
    { id: 'github-mcp', labelKey: 'githubMCP', icon: <Globe size={24} />, colorClass: 'from-purple-500 to-violet-600', windowId: 'github-mcp' },
    { id: 'skills', labelKey: 'skills', icon: <Sparkles size={24} />, colorClass: 'from-emerald-500 to-teal-600', windowId: 'skills' },
    { id: 'memory-avatar', labelKey: 'memoryAvatars', icon: <Castle size={24} />, colorClass: 'from-fuchsia-500 to-purple-600', windowId: 'memory-avatar' },
    { id: 'avatar-studio', labelKey: 'avatarStudio', icon: <Brush size={24} />, colorClass: 'from-cyan-400 to-blue-600', windowId: 'avatar-studio' },
    { id: 'sound', labelKey: 'sound', icon: <Volume2 size={24} />, colorClass: 'from-sky-500 to-indigo-600', windowId: 'sound' },
  ];

  const handleWallpaperUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const url = reader.result as string;
      setWallpaperUrl(url);
      setWallpaper('custom');
      localStorage.setItem('lumi_wallpaper_type', 'custom');
      localStorage.setItem('lumi_wallpaper_url', url);
    };
    reader.readAsDataURL(file);
  };

  const handleWindowMinimize = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('minimize_window');
    } catch {}
  };
  const handleWindowMaximize = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('toggle_maximize_window');
    } catch {}
  };
  const handleWindowClose = async () => {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('close_window');
    } catch {}
  };

  const [isTrainingOpen, setIsTrainingOpen] = useState(false);
  const [showOnboarding, setShowOnboarding] = useState(() => {
    return localStorage.getItem('lumi_onboarding_seen') !== 'true';
  });
  const [mcpActivities, setMcpActivities] = useState<Array<{
    id: string; device: string; action: string; status: string;
    message?: string; title?: string; path?: string; slidesCount?: number; toolCalls?: number; error?: string;
    time: number;
  }>>([]);
  const [showMcpPanel, setShowMcpPanel] = useState(false);
  const [agentStatus, setAgentStatus] = useState<'idle' | 'thinking' | 'executing' | 'done' | 'error'>('idle');
  const [workflowSteps, setWorkflowSteps] = useState<WorkflowStep[]>([]);

  const socket = useSocket();
  useAmbientPoller(socket); // Ambient awareness: polls window, clipboard, idle state
  const { callState, audioLevel, startCall, startCallRef, endCall, error: callError, transcript, interrupt, toggleMute, isMuted } = useVoiceCall({
    socket,
  });
  // Wake word detection — server-side Qwen ASR (DASHSCOPE_API_KEY), falls back to Picovoice
  const wakeWord = useWakeWord({
    socket,
    startCallRef,
    enabled: true,
    keyword: 'Jarvis',
    voiceId: selectedVoiceId,
    personalityId: 'lumi',
    agentId: 'lumi',
    onDetection: () => sounds.playWakeChime(),
    isCallActive: () => callState !== 'idle',
    onInterrupt: () => interrupt(),
  });

  // Gesture detection via webcam — open hand / fist (confirm gesture), face presence
  const { handOpenness, handPosition, gesture, handVisible, facePresent } = useGestureDetector({ enabled: false });

  const [diffused, setDiffused] = useState(false);
  useEffect(() => {
    if (gesture === 'open') setDiffused(true);
    else if (gesture === 'fist') setDiffused(false);
  }, [gesture]);

  // Idle→active return greeting — listens for ambient idle reports and fires on return
  const lastIdleRef = useRef<number>(0);
  const greetedRef = useRef(false);
  const IDLE_AWAY_S = 5 * 60; // 5 min considered "away"
  const RETURN_S = 30;        // < 30s considered "back"
  useEffect(() => {
    if (!socket) return;
    const onIdleReport = (data: { idle_ms: number; idle_seconds: number }) => {
      const idleS = data.idle_seconds ?? (data.idle_ms / 1000);
      const wasAway = lastIdleRef.current > IDLE_AWAY_S;
      const isBack = idleS < RETURN_S;
      if (wasAway && isBack && !greetedRef.current) {
        greetedRef.current = true;
        // LLM-generated personalized greeting — server generates, TTS speaks
        socket.emit('greeting:generate', { scene: 'return' });
      }
      if (idleS >= IDLE_AWAY_S) {
        greetedRef.current = false;
      }
      lastIdleRef.current = idleS;
    };
    socket.on('ambient:idle_echo', onIdleReport);
    return () => { socket.off('ambient:idle_echo', onIdleReport); };
  }, [socket]);

  useEffect(() => {
    if (callError) toast.error(callError);
  }, [callError]);

  // Listen for org navigation events
  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab) {
        // Anyone can open the org tab — join/create/connect handled by OrgPortal
        setActiveTab(detail.tab);
      }
    };
    window.addEventListener('lumi:navigate', handler);
    return () => window.removeEventListener('lumi:navigate', handler);
  }, [setActiveTab, isOrgAdmin]);

  // Listen for Memory Avatar Lab open request from AgentGenerator
  useEffect(() => {
    const handler = () => openMemoryAvatar();
    window.addEventListener('lumi:open-memory-lab', handler);
    return () => window.removeEventListener('lumi:open-memory-lab', handler);
  }, []);

  // Restore real system volume/brightness on mount
  useEffect(() => {
    systemService.getVolume().then(v => setVolume(v));
    systemService.getBrightness().then(b => setBrightness(b));
  }, []);

  const toggleWallpaperMode = useCallback(() => {
    const nextMode = !isWallpaperMode;
    setIsWallpaperMode(nextMode);
    systemService.setWallpaperMode(nextMode);
    toast(nextMode ? (t.wallpaperFusionActive || 'Wallpaper Fusion Active') : (t.standardFocusMode || 'Standard Focus Mode'), {
      icon: nextMode ? <Sparkles className="text-celestial-saturn" /> : <Box className="text-white/40" />
    });
  }, [isWallpaperMode, t]);


  // MCP Live Activity socket listener
  useEffect(() => {
    if (!socket) return;
    const handler = (data: any) => {
      const activity = { ...data, id: Date.now().toString(), time: Date.now() };
      setMcpActivities(prev => [activity, ...prev].slice(0, 20));
      setShowMcpPanel(true);
      setTimeout(() => {
        setMcpActivities(prev => {
          if (prev.length === 0 || Date.now() - prev[0].time > 8000) setShowMcpPanel(false);
          return prev;
        });
      }, 8000);
    };
    socket.on('mcp:activity', handler);
    return () => { socket.off('mcp:activity', handler); };
  }, [socket]);

  // Workflow status listener — agent:status, agent:tool_call, agent:response, agent:error
  useEffect(() => {
    if (!socket) return;

    const onStatus = (data: { status: string; agentName?: string }) => {
      if (data.status === 'thinking') {
        setAgentStatus('thinking');
        setWorkflowSteps(prev => [...prev, {
          id: `thinking-${Date.now()}`,
          type: 'thinking',
          text: t.workflowAnalyzing || 'Analyzing your request...',
          time: Date.now(),
        }]);
      } else if (data.status === 'idle') {
        setAgentStatus('done');
        setWorkflowSteps(prev => [...prev, {
          id: `done-${Date.now()}`,
          type: 'response',
          text: t.workflowCompleted || 'Completed',
          time: Date.now(),
        }]);
        setTimeout(() => {
          setAgentStatus('idle');
          setWorkflowSteps([]);
        }, 5000);
      } else if (data.status === 'error') {
        setAgentStatus('error');
        setTimeout(() => {
          setAgentStatus('idle');
          setWorkflowSteps([]);
        }, 5000);
      }
    };

    const onToolCall = (data: { correlationId?: string; name: string; arguments?: any; result?: string; error?: string }) => {
      if (data.result !== undefined) {
        setAgentStatus('executing');
        triggerPetReaction('jump', 1200);
        setWorkflowSteps(prev => [...prev, {
          id: `tool-ok-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          type: 'tool_result',
          text: `${data.name} ${t.workflowToolDone || 'done'}`,
          detail: data.result?.slice(0, 100),
          time: Date.now(),
        }]);
      } else if (data.error !== undefined) {
        setAgentStatus('executing');
        triggerPetReaction('failed', 2000);
        setWorkflowSteps(prev => [...prev, {
          id: `tool-err-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          type: 'error',
          text: `${data.name} ${t.workflowToolFailed || 'failed'}`,
          detail: data.error?.slice(0, 100),
          time: Date.now(),
        }]);
      } else {
        setAgentStatus('executing');
        const argsSummary = data.arguments
          ? Object.entries(data.arguments).map(([k, v]) => `${k}=${typeof v === 'string' ? v.slice(0, 30) : String(v).slice(0, 30)}`).join(', ')
          : '';
        setWorkflowSteps(prev => [...prev, {
          id: `tool-start-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`,
          type: 'tool_start',
          text: `${t.workflowCalling || 'Calling'} ${data.name}`,
          detail: argsSummary || undefined,
          time: Date.now(),
        }]);
      }
    };

    const onResponse = (data: { text: string; agentName?: string }) => {
      setWorkflowSteps(prev => [...prev, {
        id: `resp-${Date.now()}`,
        type: 'response',
        text: t.workflowResponseReady || 'Response ready',
        detail: data.text?.slice(0, 100),
        time: Date.now(),
      }]);
    };

    const onError = (data: { message: string }) => {
      setAgentStatus('error');
      setWorkflowSteps(prev => [...prev, {
        id: `err-${Date.now()}`,
        type: 'error',
        text: t.workflowError || 'Processing failed',
        detail: data.message,
        time: Date.now(),
      }]);
      setTimeout(() => {
        setAgentStatus('idle');
        setWorkflowSteps([]);
      }, 5000);
    };

    const onProactive = (data: { type?: string; taskId: string; message: string; timestamp: string }) => {
      const taskId = data.type || data.taskId || data.taskId;
      // Always add to notification center so user can find it later
      addNotification({
        type: taskId === 'daily_summary' || taskId === 'evening_wrapup' ? 'success' :
              taskId === 'memory_decay' || taskId === 'reminder_check' ? 'warning' : 'info',
        title: taskId === 'daily_summary' ? 'Daily Summary' :
               taskId === 'evening_wrapup' ? 'Evening Wrap-up' :
               taskId === 'reminder_check' ? 'Reminder' :
               taskId === 'memory_decay' ? 'Memory' :
               taskId === 'behavioral_analysis' ? 'Insight' : 'Lumi',
        message: data.message,
      });
      // Trigger pet reaction
      switch (taskId) {
        case 'reminder_check': triggerPetReaction('wave', 2000); break;
        case 'daily_summary': triggerPetReaction('wave', 2000); break;
        case 'evening_wrapup': triggerPetReaction('wave', 2000); break;
        case 'memory_decay': triggerPetReaction('jump', 1500); break;
        case 'behavioral_analysis': triggerPetReaction('jump', 1500); break;
        default: triggerPetReaction('jump', 1200); break;
      }
    };

    socket.on('agent:status', onStatus);
    socket.on('agent:tool_call', onToolCall);
    socket.on('agent:response', onResponse);
    socket.on('agent:error', onError);
    socket.on('agent:proactive', onProactive);
    socket.on('preferences:changed', (data: { key: string; value: any }) => {
      if (petPrefsSavingRef.current) return; // ignore our own changes
      if (data.key === 'pet' && data.value) {
        const { pet, accessories } = data.value;
        if (pet) {
          const defaults = getDefaultPets();
          const found = defaults.find(d => d.id === pet.id);
          if (found || pet?.atlas) {
            setSelectedPet(found || pet);
            localStorage.setItem('lumi_selected_pet', JSON.stringify(pet));
          }
        } else {
          setSelectedPet(null);
          localStorage.removeItem('lumi_selected_pet');
        }
        if (accessories) {
          setEquippedAccessories(accessories);
          localStorage.setItem('lumi_accessories', JSON.stringify(accessories));
        }
        toast.info('桌面形象已从另一设备同步');
      }
    });
    socket.on('agent:promoted', (data: { agentName: string; skillName?: string }) => {
      const msg = data.skillName
        ? `Agent "${data.agentName}" auto-promoted with skill "${data.skillName}"`
        : `Agent "${data.agentName}" has been auto-created`;
      addNotification({ type: 'system', title: 'Agent Promoted', message: msg });
      toast.info(msg, { duration: 5000 });
    });
    socket.on('agent:notification', (data: { type: string; level: string; message: string }) => {
      addNotification({ type: data.level === 'critical' ? 'warning' : data.level === 'warning' ? 'warning' : 'info', title: data.type || 'Lumi', message: data.message });
      if (data.level === 'critical') {
        toast.error(data.message, { duration: 10000 });
      } else if (data.level === 'warning') {
        toast.warning(data.message, { duration: 5000 });
      } else {
        toast(data.message, { duration: 5000 });
      }
    });
    return () => {
      socket.off('agent:status', onStatus);
      socket.off('agent:tool_call', onToolCall);
      socket.off('agent:response', onResponse);
      socket.off('agent:error', onError);
      socket.off('agent:proactive', onProactive);
      socket.off('preferences:changed');
      socket.off('agent:promoted');
      socket.off('agent:notification');
    };
  }, [socket]);

  // Fetch pet preferences from server on mount (cross-device sync source of truth)
  useEffect(() => {
    const fetchPrefs = async () => {
      try {
        const res = await fetch('/api/preferences/pet', { credentials: 'include' });
        if (res.ok) {
          const data = await res.json();
          if (data.pet) {
            const defaults = getDefaultPets();
            const found = defaults.find(d => d.id === data.pet.id);
            if (found || data.pet?.atlas) {
              setSelectedPet(found || data.pet);
            }
            localStorage.setItem('lumi_selected_pet', JSON.stringify(data.pet));
          }
          if (data.accessories?.length > 0) {
            setEquippedAccessories(data.accessories);
            localStorage.setItem('lumi_accessories', JSON.stringify(data.accessories));
          }
        }
      } catch {}
    };
    fetchPrefs();
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
        setIsControlCenterOpen(false);
        if (isWallpaperMode) toggleWallpaperMode();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isWallpaperMode, toggleWallpaperMode]);

  const [bootVisible, setBootVisible] = useState(true);

  // Remove the old interval-based boot logic since HardcoreBootSequence handles it

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleSelectPet = (pet: PetConfig) => {
    setSelectedPet(pet);
    savePetPrefsToServer(pet, equippedAccessories);
    toast.info(`${pet.name} ${t.avatarSetAsDesktop || 'set as desktop avatar'}`);
  };

  const openMemoryAvatar = async () => {
    try { sounds.playClick(); } catch {}
    try {
      const res = await fetch('/api/agents/sanctuaries');
      if (res.ok) {
        const data = await res.json();
        if (data.agents && data.agents.length > 0) {
          setSanctuaryAgent(data.agents[0]);
          setSanctuaryOpen(true);
          return;
        }
      }
    } catch {}
    setMemoryLabOpen(true);
  };

  const toggleWindow = (tab: string) => {
    try { sounds.playClick(); } catch {}
    if (tab === 'home') {
      setOpenWindows([]);
      setFocusedWindow(null);
      setActiveTab('home');
      return;
    }

    // Knowledge base and Chat open fullscreen, not as windows
    if (tab === 'knowledge') {
      setKnowledgeOpen(prev => !prev);
      return;
    }
    if (tab === 'chat') {
      setChatOpen(prev => !prev);
      setActiveTab(tab);
      return;
    }
    if (tab === 'memory-avatar') {
      openMemoryAvatar();
      return;
    }
    if (tab === 'avatar-studio') {
      // Opens as a normal window below
    }

    if (openWindows.includes(tab)) {
      if (minimizedWindows.includes(tab)) {
        setMinimizedWindows(prev => prev.filter(w => w !== tab));
      }
      setFocusedWindow(tab);
      setWindowOrder(prev => [...prev.filter(w => w !== tab), tab]);
    } else {
      setOpenWindows([...openWindows, tab]);
      setFocusedWindow(tab);
      setWindowOrder(prev => [...prev, tab]);
    }
    setActiveTab(tab);
  };

  const closeWindow = (tab: string) => {
    try { sounds.playClick(); } catch {}
    const nextWindows = openWindows.filter(w => w !== tab);
    setOpenWindows(nextWindows);
    setMinimizedWindows(prev => prev.filter(w => w !== tab));
    setWindowOrder(prev => prev.filter(w => w !== tab));
    if (focusedWindow === tab) {
      setFocusedWindow(nextWindows.length > 0 ? nextWindows[nextWindows.length - 1] : null);
      if (nextWindows.length === 0) setActiveTab('home');
    }
  };

  const handleContextAction = (action: string, context: any) => {
    switch (action) {
      case 'refresh':
        window.location.reload();
        break;
      case 'change_wallpaper':
        wallpaperInputRef.current?.click();
        break;
      case 'reset_wallpaper':
        setWallpaper('celestial');
        setWallpaperUrl('');
        localStorage.removeItem('lumi_wallpaper_type');
        localStorage.removeItem('lumi_wallpaper_url');
        break;
      case 'display_settings':
        toggleWindow('settings');
        setSettingsSection('appearance');
        break;
      case 'open_terminal':
        toggleWindow('kernel');
        break;
      case 'open':
        if (context?.targetId) toggleWindow(context.targetId);
        break;
      case 'properties':
        break;
    }
  };

  const { menu, menuItems: contextItems, showMenu: showContextMenu, execute: executeContextMenu } = useContextMenu();

  const appIcons = [
    { id: 'chat', label: t.chat || 'Chat', icon: <MessageSquare size={24} />, color: 'from-green-500 to-emerald-600' },
    { id: 'personality', label: t.personality || 'Personality Lab', icon: <UserIcon size={24} />, color: 'from-violet-500 to-fuchsia-600' },
    { id: 'kernel', label: t.kernelMonitor || 'Kernel Monitor', icon: <Activity size={24} />, color: 'from-orange-500 to-red-600' },
    { id: 'devices', label: t.devices || 'Devices', icon: <Cpu size={24} />, color: 'from-blue-600 to-cyan-400' },
    { id: 'settings', label: t.settings || 'OS Integrity', icon: <SettingsIcon size={24} />, color: 'from-gray-400 to-slate-600' },
  ];

  const sphereSentiment =
    openWindows.includes('kernel') ? 'excited' :
    chatOpen ? 'focused' : 'default';

  const getWindowSize = (windowId: string) => {
    if (windowId === 'settings') return { w: '1050px', h: '720px' };
    if (windowId === 'knowledge') return { w: '1100px', h: '750px' };
    if (windowId === 'kernel') return { w: '1050px', h: '720px' };
    if (windowId === 'personality') return { w: '1050px', h: '720px' };
    if (windowId === 'generate') return { w: '1050px', h: '720px' };
    if (windowId === 'music') return { w: '850px', h: '620px' };
    if (windowId === 'tools') return { w: '850px', h: '620px' };
    if (windowId === 'github-mcp') return { w: '850px', h: '620px' };
    if (windowId === 'notifications') return { w: '700px', h: '550px' };
    if (windowId === 'reminders') return { w: '650px', h: '620px' };
    if (windowId === 'devices') return { w: '900px', h: '700px' };
    if (windowId === 'tokens') return { w: '800px', h: '620px' };
    if (windowId === 'skills') return { w: '900px', h: '700px' };
    if (windowId === 'subscription') return { w: '850px', h: '640px' };
    if (windowId === 'avatar-studio') return { w: '1050px', h: '720px' };
    if (windowId === 'sound') return { w: '900px', h: '700px' };
    return { w: '900px', h: '700px' };
  };

  return (
    <div
      data-mode={isLightMode ? 'light' : 'dark'}
      className={`fixed inset-0 overflow-hidden cursor-default select-none transition-all duration-1000 ${
      isWallpaperMode ? 'bg-transparent pointer-events-none' :
      isLightMode ? 'bg-[#f5f5f7]' :
      theme === 'celestial' ? 'bg-[#010103]' :
      theme === 'nebula' ? 'bg-[#050010]' :
      theme === 'cyber' ? 'bg-[#000808]' :
      'bg-black'
    }`}
      style={{
        ...(wallpaper === 'custom' && wallpaperUrl ? {
          backgroundImage: `url(${wallpaperUrl})`,
          backgroundSize: 'cover',
          backgroundPosition: 'center',
          backgroundRepeat: 'no-repeat',
        } : {}),
        ...(isFullscreen ? {} : {
          transform: 'scale(0.75)',
          transformOrigin: 'center center',
        }),
      }}
    >
      <input ref={wallpaperInputRef} type="file" accept="image/*" onChange={handleWallpaperUpload} className="hidden" />
      <ContextMenu menu={menu} items={contextItems} onAction={(action) => {
        const result = executeContextMenu(action);
        handleContextAction(result.action, result.context);
      }} />
      <ControlCenter
        isOpen={isControlCenterOpen}
        onClose={() => setIsControlCenterOpen(false)}
        t={t}
        brightness={brightness}
        setBrightness={setBrightness}
        volume={volume}
        setVolume={setVolume}
        theme={theme}
        setTheme={setTheme}
        lang={lang}
        setLang={setLang}
        isLightMode={isLightMode}
        setIsLightMode={setIsLightMode}
        toggleWindow={toggleWindow}
      />
      {/* CRT Scanline / Noise Overlay */}
      <div className="fixed inset-0 z-[1000] pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] select-none" />
      
      {/* Hardcore Boot Screen Overlay */}
      <AnimatePresence>
        {bootVisible && (
          <HardcoreBootSequence onComplete={() => setBootVisible(false)} t={t} />
        )}
      </AnimatePresence>

      {/* Immersive Environment Layer (Wallpaper OS Foundation) */}
      <div 
        className={`fixed inset-0 z-0 overflow-hidden transition-all duration-1000 ${isWallpaperMode ? 'bg-transparent' : 'bg-[#010103]'}`}
      >
        <div className="absolute inset-0">
          {/* Warp Flash Overlay */}
          <motion.div 
            animate={{ 
              opacity: viewMode === 'world' ? [0, 0.4, 0] : 0,
            }}
            transition={{ duration: 0.8 }}
            className={`absolute inset-0 z-50 pointer-events-none ${
              theme === 'nebula' ? 'bg-purple-900' : theme === 'cyber' ? 'bg-emerald-900' : 'bg-white'
            }`}
          />

          {/* Global Node Map Background */}
          <div className="absolute inset-0 z-0 pointer-events-none">
             <GlobalNodeMap variant="subtle" />
          </div>

          {/* Personal Desktop Wallpaper Layer */}
          <motion.div
            style={{
              scale: personalScale,
              opacity: personalOpacity,
              z: 500
            }}
            className="absolute inset-0 pointer-events-none"
          >
            <div className="absolute inset-0">
               <AnimatePresence mode="wait">
                {theme === 'celestial' && (
                  <motion.div 
                    key="celestial-wp"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    className="absolute inset-0"
                  >
                    <div className="star-field opacity-20" />
                    <div className="undulating-bg opacity-30 scale-125" />
                    <div className="absolute inset-0 bg-gradient-to-b from-transparent via-black/20 to-black/80" />
                  </motion.div>
                )}
                {theme === 'nebula' && (
                  <motion.div 
                    key="nebula-wp"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    className="absolute inset-0"
                  >
                    <div className="star-field opacity-10" />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.1)_0%,transparent_70%)]" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/0 to-black/60" />
                  </motion.div>
                )}
                {theme === 'cyber' && (
                  <motion.div 
                    key="cyber-wp"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    className="absolute inset-0"
                  >
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(16,185,129,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(16,185,129,0.05)_1px,transparent_1px)] bg-[size:40px_40px]" />
                    <div className="absolute inset-0 bg-gradient-to-b from-black/0 to-black/80" />
                  </motion.div>
                )}
                {/* Other themes ... */}
                {/* Light mode wallpaper — white-green gradient */}
                {isLightMode && (
                  <motion.div
                    key="light-wp"
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
                    transition={{ duration: 1 }}
                    className="absolute inset-0"
                  >
                    <div className="absolute inset-0 bg-gradient-to-br from-[#f0fdf4] via-[#ecfdf5] to-[#dcfce7]" />
                    <div className="absolute inset-0 bg-[radial-gradient(circle_at_30%_40%,rgba(34,197,94,0.06)_0%,transparent_60%),radial-gradient(circle_at_70%_80%,rgba(16,185,129,0.04)_0%,transparent_60%)]" />
                    <div className="absolute inset-0 bg-[linear-gradient(rgba(34,197,94,0.04)_1px,transparent_1px),linear-gradient(90deg,rgba(34,197,94,0.04)_1px,transparent_1px)] bg-[size:60px_60px]" />
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </motion.div>
        </div>

        {/* Hyper-tunnel edges */}
        <div className="absolute inset-0 shadow-[inset_0_0_300px_rgba(0,0,0,1)] pointer-events-none" />
        
        {/* Brightness Overlay */}
        <div 
          className="absolute inset-0 pointer-events-none z-[1000] transition-opacity duration-300" 
          style={{ backgroundColor: 'black', opacity: (100 - brightness) / 100 * 0.7 }} 
        />
      </div>

      {/* Nexus Globe — WebGL 3D Earth with constellation + globe + neural layers */}
      <AnimatePresence>
        {viewMode === 'world' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 1.2 }}
            className="fixed inset-0 z-0"
          >
            <Suspense fallback={null}><NexusGlobe theme={theme as 'celestial' | 'nebula' | 'cyber'} syncRate={syncRate} /></Suspense>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Nexus View HUD (Floating Content that only shows in Nexus mode) */}
      <AnimatePresence>
        {viewMode === 'world' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="fixed inset-0 z-20 flex items-center justify-center pointer-events-none"
          >
            <div className="relative z-10 text-center space-y-8 pointer-events-auto">
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
              >
                <h2 className="text-6xl font-black text-white/90 tracking-[1.2rem] uppercase drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]">{t.nexusTitle || 'Nexus'}</h2>
                <div className="mt-4 flex items-center justify-center gap-4">
                  <div className="h-px w-12 bg-gradient-to-r from-transparent to-celestial-saturn/50" />
                  <p className="text-[10px] text-celestial-saturn font-black tracking-[0.8em] uppercase">{t.distributedOSCore || 'Distributed OS Core'}</p>
                  <div className="h-px w-12 bg-gradient-to-l from-transparent to-celestial-saturn/50" />
                </div>
              </motion.div>

              <motion.button
                onClick={() => setViewMode('personal')}
                className="group px-10 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-[10px] font-black text-white/60 tracking-[0.4em] uppercase transition-all backdrop-blur-2xl hover:text-white hover:border-white/20"
              >
                {t.focusPersonalTerritory || 'Focus Personal Territory'}
              </motion.button>
            </div>

            <div className="absolute left-8 top-24 flex flex-col gap-3 pointer-events-auto">
              <MeshSyncSelector t={t} syncRate={syncRate} onSyncRateChange={setSyncRate} />
              <ContributorNodePanel t={t} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed inset-0 z-[100] pointer-events-none">
        {/* Top Status Bar */}
        <div className={`absolute top-0 inset-x-0 h-10 glass-dark border-b border-white/5 flex items-center justify-between px-6 pointer-events-auto backdrop-blur-md transition-all duration-1000 ${isWallpaperMode ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
          <div className="flex items-center gap-6">
            <button onClick={onExit} className="flex items-center gap-2 group transition-all">
               <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-celestial-mars to-celestial-saturn flex items-center justify-center p-1 group-hover:rotate-12 transition-transform shadow-lg shadow-celestial-saturn/20">
                 <Rocket size={14} className="text-white" />
               </div>
               <span className="text-[10px] font-black tracking-widest uppercase text-white/60">{t.lumiOS || 'Lumi OS'}</span>
            </button>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex gap-4">
              <TopMenuButton label={t.file || 'File'}>
                <button onClick={async () => {
                  try {
                    const invoke = (window as any).__TAURI__?.core?.invoke || (window as any).__TAURI_INTERNALS__?.invoke;
                    if (invoke) {
                      const files = await invoke('list_home_files');
                      setNativeFiles(Array.isArray(files) ? files : []);
                      toggleWindow('github-mcp');
                    } else {
                      toast.info(t.desktopOnly || 'File browse requires desktop app');
                    }
                  } catch (err: any) { toast.error(err.message || 'Failed to list files'); }
                }} className="w-full text-left px-4 py-2 text-[11px] text-white/60 hover:text-white hover:bg-white/10 transition-colors">{t.openFiles || 'Open Files'}</button>
                <button onClick={() => { toggleWindow('settings'); }} className="w-full text-left px-4 py-2 text-[11px] text-white/60 hover:text-white hover:bg-white/10 transition-colors">{t.settings || 'Settings'}</button>
                <button onClick={onExit} className="w-full text-left px-4 py-2 text-[11px] text-red-400/70 hover:text-red-400 hover:bg-white/10 transition-colors">{t.exit || 'Exit'}</button>
              </TopMenuButton>
              <TopMenuButton label={t.edit || 'Edit'}>
                <button onClick={() => {
                  setEditMode(!editMode);
                }} className="w-full text-left px-4 py-2 text-[11px] text-white/60 hover:text-white hover:bg-white/10 transition-colors">
                  {editMode ? (t.doneEditing || 'Done Editing') : (t.editDesktop || 'Edit Desktop')}
                </button>
                <button onClick={() => { toggleWindow('settings'); setSettingsSection('personalization'); }} className="w-full text-left px-4 py-2 text-[11px] text-white/60 hover:text-white hover:bg-white/10 transition-colors">{t.theme || 'Theme'}</button>
              </TopMenuButton>
              <TopMenuButton label={t.kernel || 'Kernel'} onClick={() => toggleWindow('kernel')} />
              <TopMenuButton label={t.view || 'View'} onClick={() => setViewMode(viewMode === 'personal' ? 'world' : 'personal')} />
              <TopMenuButton label={t.matrix || 'Matrix'} onClick={() => setIsSearchOpen(true)} />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 text-white/30">
               <div className="flex items-center gap-1" onClick={() => setIsSearchOpen(true)}><Search size={14} className="hover:text-white transition-colors cursor-pointer" /></div>
               <button onClick={() => toggleWindow('notifications')} className="flex items-center gap-1 relative hover:text-white transition-colors">
                 <Bell size={14} />
                 {unreadCount > 0 && (
                   <span className="absolute -top-1.5 -right-1.5 w-3.5 h-3.5 rounded-full bg-red-500 text-[7px] font-black flex items-center justify-center text-white">
                     {unreadCount > 9 ? '9+' : unreadCount}
                   </span>
                 )}
               </button>
               {/* Server connection status */}
               <span
                 className={`w-2 h-2 rounded-full ${socket?.connected ? 'bg-green-400 shadow-[0_0_6px] shadow-green-400/60' : 'bg-red-400 animate-pulse'}`}
                 title={socket?.connected ? '服务已连接' : '服务未连接'}
               />
               {/* Volume mute toggle */}
               <button onClick={toggleMute} className="flex items-center gap-1 hover:text-white transition-colors" title={isMuted ? '取消静音' : '静音'}>
                 {isMuted ? <VolumeX size={14} className="text-red-400" /> : <Volume2 size={14} />}
               </button>
               {/* Battery — real via navigator.getBattery() */}
               <BatteryIndicator />
               <button
                 onClick={toggleWallpaperMode}
                 className={`h-6 px-2 rounded-md border transition-all flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider ${
                   isWallpaperMode
                     ? 'bg-celestial-saturn/20 text-celestial-saturn border-celestial-saturn/30'
                     : 'bg-white/5 border-white/5 text-white/30 hover:bg-white/10 hover:text-white'
                 }`}
                 title={isWallpaperMode ? '退出壁纸模式' : '壁纸模式'}
               >
                 <Zap size={10} className={isWallpaperMode ? 'animate-pulse' : ''} />
                 {isWallpaperMode ? 'Fusion' : 'Focus'}
               </button>
            </div>

            {orgConnection?.connected && (
              <div className="flex items-center gap-2">
                <WorkModeSwitch domain={workDomain} onToggle={() => switchDomain(workDomain === 'personal' ? 'work' : 'personal')} connected={orgConnection.connected} />
              </div>
            )}

            <button
              onClick={() => setIsControlCenterOpen(!isControlCenterOpen)}
              className="flex items-center gap-3 px-3 py-1 bg-white/5 hover:bg-white/10 rounded-full border border-white/5 transition-all group"
            >
              <div className="flex flex-col items-end">
                <span className="text-[9px] font-black text-white/80 leading-none">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
                <span className="text-[7px] font-bold text-white/30 uppercase tracking-tighter">{time.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })}</span>
              </div>
              <Activity size={14} className="text-celestial-saturn group-hover:rotate-180 transition-transform duration-500" />
            </button>

            {/* Window Controls */}
            <div className="flex items-center gap-1 ml-2">
              <button
                onClick={handleWindowMinimize}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-colors"
                title="最小化"
              >
                <Minus size={14} />
              </button>
              <button
                onClick={handleWindowMaximize}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white hover:bg-white/10 transition-colors"
                title="最大化"
              >
                <Square size={12} />
              </button>
              <button
                onClick={handleWindowClose}
                className="w-7 h-7 rounded-lg flex items-center justify-center text-white/30 hover:text-white hover:bg-red-500/80 transition-colors"
                title="关闭"
              >
                <X size={14} />
              </button>
            </div>
          </div>
        </div>

        {/* Global Control Center handled at top level for proper click detection */}

        {/* Global Search */}
        <AnimatePresence>
          {isSearchOpen && (
            <Spotlight 
              isOpen={isSearchOpen} 
              onClose={() => setIsSearchOpen(false)} 
              onSelect={toggleWindow}
              apps={appIcons}
              t={t}
            />
          )}
        </AnimatePresence>

        {/* Bottom Taskbar / Dock */}
        <div className={`absolute bottom-6 left-1/2 -translate-x-1/2 z-50 h-16 px-4 glass-dark rounded-[2.5rem] border border-white/10 flex items-center gap-2 shadow-2xl backdrop-blur-2xl transition-all duration-1000 ${isWallpaperMode ? 'opacity-0 pointer-events-none' : 'opacity-100 pointer-events-auto'}`}>
          <button 
            onClick={() => setViewMode(viewMode === 'personal' ? 'world' : 'personal')}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all group relative ${
              viewMode === 'world' ? 'bg-celestial-saturn text-black' : 'bg-white/5 text-white/40 hover:bg-white/10'
            }`}
          >
            {viewMode === 'world' ? <Cpu size={24} /> : <Globe size={24} />}
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/80 rounded-lg text-[8px] font-black uppercase text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {viewMode === 'world' ? (t.personalView || 'Personal View') : (t.nexusView || 'Nexus View')}
            </div>
          </button>
          <button
            onClick={() => setKnowledgeOpen(prev => !prev)}
            className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all group relative ${
              knowledgeOpen
                ? 'bg-gradient-to-br from-cyan-400 to-blue-600 text-white shadow-lg'
                : 'bg-white/5 text-white/40 hover:bg-white/10 hover:text-white'
            }`}
          >
            <BrainCircuit size={24} />
            <div className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/80 rounded-lg text-[8px] font-black uppercase text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
              {t.knowledgeBase || 'Knowledge Base'}
            </div>
          </button>
          <div className="h-8 w-px bg-white/10 mx-2" />
          <AnimatePresence>
            {appIcons.map(app => {
              const isActive = openWindows.includes(app.id) || (app.id === 'chat' && chatOpen);
              return (
              <motion.button
                key={app.id}
                layoutId={`dock-${app.id}`}
                onClick={() => toggleWindow(app.id)}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all group relative ${
                  isActive
                    ? `bg-gradient-to-br ${app.id === focusedWindow || app.id === 'chat' ? app.color : 'from-white/10 to-white/5'} text-white shadow-lg ${minimizedWindows.includes(app.id) ? 'opacity-40 translate-y-2' : ''}`
                    : 'bg-white/5 text-white/40 hover:bg-white/10'
                }`}
              >
                {app.icon}
                {isActive && (
                  <motion.div
                    layoutId={`indicator-${app.id}`}
                    className={`absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full ${minimizedWindows.includes(app.id) ? 'w-3 h-0.5 bg-white/40' : 'w-1 h-1 bg-white'}`}
                  />
                )}
                {/* Taskbar Preview Tooltip */}
                {isActive && !minimizedWindows.includes(app.id) && (
                   <div className="absolute -top-28 left-1/2 -translate-x-1/2 w-36 bg-black/90 border border-white/10 rounded-xl overflow-hidden opacity-0 group-hover:opacity-100 transition-all duration-200 pointer-events-none shadow-2xl">
                      <div className="p-3 flex items-center gap-2 border-b border-white/5">
                        <div className="w-6 h-6 rounded-lg bg-white/10 flex items-center justify-center">
                          <span className="scale-75">{app.icon}</span>
                        </div>
                        <span className="text-[10px] font-bold text-white/80 truncate">{app.label}</span>
                      </div>
                      <div className="px-3 py-2">
                        <p className="text-[9px] text-white/30 leading-tight">
                          {focusedWindow === app.id ? (t.activeFocused || 'Active — focused') : (t.openInBackground || 'Open in background')}
                        </p>
                      </div>
                   </div>
                )}
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/80 rounded-lg text-[8px] font-black uppercase text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {app.label}
                </div>
              </motion.button>
              );
            })}
          </AnimatePresence>
          <div className="h-8 w-px bg-white/10 mx-2" />
          {user ? (
            <button
              onClick={() => toggleWindow('profile')}
              className="w-12 h-12 rounded-2xl overflow-hidden border-2 border-white/10 hover:border-celestial-saturn/50 bg-white/5 flex items-center justify-center transition-all group"
            >
              {user.photoURL ? (
                <img src={user.photoURL} alt="" className="w-full h-full object-cover" referrerPolicy="no-referrer" />
              ) : (
                <UserIcon size={20} className="text-white/40 group-hover:text-white/80 transition-colors" />
              )}
            </button>
          ) : (
            <button
              onClick={onLogin}
              className="w-12 h-12 rounded-2xl bg-white/5 border border-white/10 text-white/40 hover:text-white hover:bg-white/10 hover:border-celestial-saturn/30 transition-all flex items-center justify-center group"
            >
              <UserIcon size={20} className="group-hover:text-celestial-saturn transition-colors" />
            </button>
          )}
        </div>
      </div>

      {/* Main OS Content Layer (Personal Desktop Surface) */}
      <motion.div
        style={{
          scale: personalScale,
          opacity: personalOpacity,
        }}
        className={`absolute inset-0 z-[15] flex flex-col ${viewMode === 'world' ? 'pointer-events-none' : ''}`}
      >
        <div className="relative w-full h-full pointer-events-auto">
          {/* Central Interactive Entity */}
          <div className="absolute inset-0 flex items-center justify-center z-[15] pointer-events-none">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 2, ease: "easeOut" }}
          className="relative pointer-events-auto scale-75 opacity-90 transition-all"
        >
          <div className="relative flex flex-col items-center">
            {selectedPet ? (
              <div className="relative group flex flex-col items-center gap-3">
                <button
                  onClick={() => toggleWindow('avatar-studio')}
                  className={`cursor-pointer transition-all ${callState !== 'idle' ? 'animate-pulse' : ''}`}
                  title={`${selectedPet.name} — 点击打开形象设计室`}
                >
                  <PetAvatar
                    pet={selectedPet}
                    animation={
                      petReaction ? petReaction.animation as any :
                      callState === 'speaking' ? 'wave' :
                      callState === 'listening' ? 'idle' :
                      callState !== 'idle' ? 'jump' : 'idle'
                    }
                    accessoryIds={equippedAccessories}
                    scale={1.2}
                    audioLevel={audioLevel}
                    callState={callState}
                    behavior={
                      'playful'
                    }
                  />
                </button>
                {/* Voice call button below pet */}
                <button
                  onClick={callState === 'idle' ? () => startCall(selectedVoiceId, 'lumi', 'lumi') : endCall}
                  className={`w-12 h-12 rounded-full border transition-all flex items-center justify-center ${
                    callState !== 'idle'
                      ? 'bg-red-500/20 border-red-500/40 text-red-400'
                      : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white'
                  }`}
                >
                  {callState !== 'idle' ? <Mic size={20} className="animate-pulse" /> : <Mic size={20} />}
                </button>
                {/* Reset to sphere button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    setSelectedPet(null);
                    savePetPrefsToServer(null, equippedAccessories);
                    toast.info('已切换回粒子人脸');
                  }}
                  className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-white/10 border border-white/10 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/30 hover:border-red-500/40"
                  title="切换回粒子人脸"
                >
                  <X size={10} className="text-white/60" />
                </button>
              </div>
            ) : (
              <>
              <LocalAgentSphere
                t={t}
                sentiment={sphereSentiment}
                callState={callState}
                audioLevel={audioLevel}
                highPerformance={isTauri}
                isWallpaperMode={isWallpaperMode}
                reaction={petReaction?.animation || null}
                onStartCall={() => startCall(selectedVoiceId, 'lumi', 'lumi')}
                onEndCall={endCall}
                onInterrupt={interrupt}
                onToggleMute={toggleMute}
                onMessage={() => {}}
                handOpenness={handOpenness}
                handPosition={handPosition}
                gesture={gesture}
                handVisible={handVisible}
                facePresent={facePresent}
                gesturesDisabled={true}
                diffused={diffused}
                isLightMode={isLightMode}
              />
              {wakeWord.isListening && callState === 'idle' && (
                <div className="mt-2 text-[10px] text-white/20 uppercase tracking-[0.25em] font-mono">
                  Listening for &ldquo;Jarvis&rdquo;
                </div>
              )}
              {wakeWord.error && (
                <div className="mt-2 text-[10px] text-red-400/60 font-mono max-w-[200px] text-center leading-relaxed">
                  Wake: {wakeWord.error}
                </div>
              )}
              {!wakeWord.isListening && !wakeWord.error && callState === 'idle' && (
                <div className="mt-2 text-[10px] text-yellow-400/40 font-mono">
                  Wake word initializing...
                </div>
              )}
              </>
            )}

            <div className={`flex flex-col items-center gap-4 mt-8 transition-all duration-1000 ${isWallpaperMode ? 'opacity-0 blur-sm pointer-events-none' : 'opacity-100'}`}>
              <VoicePicker t={t} />

              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="whitespace-nowrap"
              >
                 <div className="flex flex-col items-center gap-1 group">
                   <span className="text-[10px] font-black tracking-[0.4em] text-white/40 uppercase group-hover:text-celestial-saturn transition-colors">
                     {callState === 'idle' ? (t.lumiNeuralCore || 'Lumi Neural Core') : `${callState.toUpperCase()} ${t.sessionActive || 'SESSION'}`}
                   </span>
                   <div className="flex gap-1">
                     {callState !== 'idle' ? (
                       [1,2,3,4,5].map(i => (
                         <motion.div 
                           key={i} 
                           className="w-1 bg-celestial-saturn rounded-full" 
                           animate={{ height: [8, 16 + audioLevel * 20, 8] }}
                           transition={{ duration: 0.5, repeat: Infinity, delay: i * 0.1 }}
                         />
                       ))
                     ) : (
                       [1,2,3].map(i => <div key={i} className="w-1 h-1 rounded-full bg-celestial-saturn/40 animate-pulse" style={{ animationDelay: `${i*0.2}s` }} />)
                     )}
                   </div>

                   <AnimatePresence>
                     {callState !== 'idle' && transcript && (
                       <motion.div
                         initial={{ opacity: 0, y: 20 }}
                         animate={{ opacity: 1, y: 0 }}
                         exit={{ opacity: 0, scale: 0.9 }}
                         className="mt-6 max-w-sm px-6 py-4 bg-white/5 backdrop-blur-3xl border border-white/10 rounded-2xl text-center shadow-2xl"
                       >
                         <p className="text-white/80 text-sm font-medium leading-relaxed italic">
                           "{transcript}"
                         </p>
                         <div className="mt-2 flex justify-center gap-1">
                            <div className="w-1 h-1 rounded-full bg-celestial-saturn animate-pulse" />
                            <div className="w-1 h-1 rounded-full bg-celestial-saturn animate-pulse delay-75" />
                            <div className="w-1 h-1 rounded-full bg-celestial-saturn animate-pulse delay-150" />
                         </div>
                       </motion.div>
                     )}
                   </AnimatePresence>
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Desktop Grid & Widgets */}
      <div className={`relative z-10 w-full h-full p-8 md:p-12 lg:p-16 overflow-y-auto custom-scrollbar pt-20 transition-all duration-1000 ${isWallpaperMode ? 'opacity-0 blur-sm pointer-events-none' : 'opacity-100'}`}>
        <div className="flex flex-col xl:flex-row justify-between items-start gap-12">
            <div className="relative flex-1 w-full min-h-[400px]" style={{ margin: 0, padding: 0 }}>
              {desktopIcons.map((def, i) => {
                const defaultX = 40 + (i % 4) * 130;
                const defaultY = 0 + Math.floor(i / 4) * 120;
                const saved = iconPositions[def.id];
                const x = saved?.x ?? defaultX;
                const y = saved?.y ?? defaultY;
                const label = (t as any)[def.labelKey] || def.labelKey;
                const handleClick = () => {
                  if (editMode) return;
                  if (def.id === 'workbench') setActiveTab('org');
                  else toggleWindow(def.windowId);
                };
                return (
                  <motion.div
                    key={def.id}
                    drag={editMode}
                    dragMomentum={false}
                    dragElastic={0.1}
                    onDoubleClick={handleClick}
                    onClick={handleClick}
                    onDragEnd={(_e, info) => {
                      const nx = defaultX + info.offset.x;
                      const ny = defaultY + info.offset.y;
                      const newPos = { ...iconPositions, [def.id]: { x: nx, y: ny } };
                      setIconPositions(newPos);
                      localStorage.setItem('lumi_icon_positions', JSON.stringify(newPos));
                    }}
                    onContextMenu={(e: React.MouseEvent) => {
                      if (editMode) return;
                      e.preventDefault();
                      e.stopPropagation();
                      showContextMenu(e.clientX, e.clientY, { type: 'icon', targetId: def.id });
                    }}
                    initial={editMode ? false : { opacity: 0, scale: 0.8 }}
                    animate={editMode ? { opacity: 1 } : { opacity: 1, scale: 1 }}
                    style={{ position: 'absolute', left: x, top: y }}
                    className={`desktop-icon group z-10 select-none ${
                      editMode
                        ? 'cursor-grab active:cursor-grabbing ring-2 ring-celestial-saturn/50 rounded-xl p-1'
                        : 'cursor-pointer'
                    }`}
                    role="button"
                    tabIndex={editMode ? -1 : 0}
                    onKeyDown={(e: React.KeyboardEvent) => {
                      if (editMode) return;
                      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggleWindow(def.windowId); }
                    }}
                  >
                    <div className={`desktop-icon-img bg-gradient-to-br ${def.colorClass} shadow-[0_10px_20px_-5px_rgba(0,0,0,0.5)] ${editMode ? 'scale-105' : ''}`}>
                      <div className={`text-white ${editMode ? '' : 'group-hover:rotate-12'} transition-transform`}>
                        {def.icon}
                      </div>
                    </div>
                    <span className={`desktop-icon-label ${editMode ? 'bg-black/80 text-white px-2 py-0.5 rounded-full text-[8px]' : ''}`}>{label}</span>
                  </motion.div>
                );
              })}
            </div>

            <div className="flex flex-col gap-6 w-full lg:w-96">
              {/* Modern Widgets Grid */}
              <div className="grid grid-cols-2 gap-4">
                 <ClockWidget t={t} time={time} />
                 <BatteryWidget t={t} />
              </div>

              <NeuralSynthesisMonitor t={t} onOpenTokens={() => toggleWindow('tokens')} />

              {/* Daily Capability Widget */}
              <DailyCapability t={t} onInstall={(skillId) => toggleWindow('skills')} />

              {/* Notification Preview */}
              {notifications.filter(n => !n.read).length > 0 && (
                <GlassCard className="p-5 rounded-[2rem] space-y-2 border-white/5 bg-black/30 backdrop-blur-3xl cursor-pointer hover:bg-white/[0.06] transition-all" onClick={() => toggleWindow('notifications')}>
                  <div className="flex items-center justify-between">
                    <h4 className="text-[10px] font-black uppercase tracking-widest text-white/30 flex items-center gap-2">
                      <Bell size={12} className="text-amber-400" /> {t.recent || 'Recent'} ({unreadCount} {t.unread || 'unread'})
                    </h4>
                    <ChevronRight size={12} className="text-white/20" />
                  </div>
                  <div className="space-y-1">
                    {notifications.filter(n => !n.read).slice(0, 3).map(n => (
                      <div key={n.id} className="text-[9px] text-white/50 truncate">
                        <span className="text-white/70 font-bold">{n.title}</span> — {n.message}
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}

              {nativeFiles.length > 0 && (
                <GlassCard className="p-6 w-full md:w-80 rounded-3xl space-y-4 border-white/5 bg-black/10">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-white/20">{t.nativeVaultEntry || 'Native Vault Entry'}</h4>
                  <div className="space-y-2 max-h-48 overflow-y-auto custom-scrollbar pr-2">
                    {nativeFiles.map((file, idx) => (
                      <div key={idx} className="flex items-center gap-3 p-2 rounded-lg hover:bg-white/5 transition-all cursor-pointer group">
                        {file.isDirectory ? <Folder size={14} className="text-celestial-saturn" /> : <FileText size={14} className="text-white/40" />}
                        <span className="text-[10px] text-white/60 truncate group-hover:text-white transition-colors">{file.name}</span>
                      </div>
                    ))}
                  </div>
                </GlassCard>
              )}

            </div>
        </div>
      </div>

      {/* MCP Live Activity — xiaozhi ⇄ Lumi */}
      <AnimatePresence>
        {showMcpPanel && mcpActivities.length > 0 && (
          <motion.div
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 20, scale: 0.95 }}
            className="fixed bottom-28 right-6 z-[60] w-72 pointer-events-auto"
          >
            <GlassCard className="p-4 rounded-2xl border-white/10 bg-black/70 backdrop-blur-2xl space-y-2">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="text-[9px] font-black text-white/40 uppercase tracking-widest">{t.liveDeviceLabel || 'Live'} · xiaozhi ⇄ Lumi</span>
              </div>
              <div className="space-y-1 max-h-48 overflow-y-auto custom-scrollbar">
                {mcpActivities.slice(0, 5).map((act) => (
                  <div key={act.id} className="text-[9px] text-white/60 border-l-2 border-white/10 pl-2">
                    <span className="text-white/80 font-bold">{act.action === 'create_ppt' ? 'PPT' : act.action === 'chat' ? 'Chat' : act.action}</span>
                    {' · '}
                    <span className={act.status === 'completed' ? 'text-green-400' : act.status === 'failed' ? 'text-red-400' : 'text-celestial-saturn'}>
                      {act.status}
                    </span>
                    {act.message && <div className="text-white/30 truncate">{act.message.slice(0, 60)}</div>}
                    {act.title && <div className="text-white/50">{act.title} ({act.slidesCount} slides)</div>}
                    {act.path && <div className="text-green-400/60 truncate">Saved: {act.path.split('\\').pop()}</div>}
                    {act.toolCalls !== undefined && act.toolCalls > 0 && <div className="text-celestial-saturn/60">Used {act.toolCalls} tool(s)</div>}
                    {act.error && <div className="text-red-400/60 truncate">{act.error.slice(0, 80)}</div>}
                  </div>
                ))}
              </div>
            </GlassCard>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Workflow Status Panel — breathing lights + step log */}
      <WorkflowPanel
        visible={isWallpaperMode && (agentStatus !== 'idle' || workflowSteps.length > 0)}
        agentStatus={agentStatus}
        steps={workflowSteps}
        t={t}
      />
      <div className="absolute inset-0 z-[20] pointer-events-none">
        <DesktopOnboarding 
          isOpen={showOnboarding} 
          onFinish={() => {
            setShowOnboarding(false);
            localStorage.setItem('lumi_onboarding_seen', 'true');
          }}
          t={t}
        />
        <VoiceTrainingDialog 
          isOpen={isTrainingOpen} 
          onClose={() => setIsTrainingOpen(false)} 
          onSuccess={() => window.dispatchEvent(new CustomEvent('lumi:voice-updated'))}
        />
        <AnimatePresence>
          {openWindows.map(windowId => {
            const size = getWindowSize(windowId);
            const orderIdx = windowOrder.indexOf(windowId);
            return (
              <OSWindow
                key={windowId}
                id={windowId}
                title={appIcons.find(a => a.id === windowId)?.label || windowId}
                icon={appIcons.find(a => a.id === windowId)?.icon}
                isActive={focusedWindow === windowId}
                isMinimized={minimizedWindows.includes(windowId)}
                zIndex={10 + (orderIdx >= 0 ? orderIdx : 0)}
                onFocus={(id) => {
                  setFocusedWindow(id);
                  setWindowOrder(prev => [...prev.filter(w => w !== id), id]);
                }}
                onMinimize={(id) => setMinimizedWindows(prev => [...prev, id])}
                onMinimizeComplete={(id) => {
                  // Window stays in DOM, just mark animation complete
                }}
                onClose={() => closeWindow(windowId)}
                colorClass={appIcons.find(a => a.id === windowId)?.color}
                width={size.w}
                height={size.h}
                t={t}
              >
                <div className="p-8 h-full">
                  {windowId === 'kernel' ? (
                    <KernelMonitorApp t={t} />
                  ) : windowId === 'settings' ? (
                    <Settings t={t} lang={lang} setLang={setLang} theme={theme} setTheme={setTheme} activeSection={settingsSection} onSectionChange={setSettingsSection} />
                  ) : windowId === 'music' ? (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-8 animate-in zoom-in-95 duration-500">
                       <div className="relative">
                          <Disc size={120} className="text-celestial-saturn animate-[spin_8s_linear_infinite]" />
                          <Headphones size={40} className="absolute -bottom-4 -right-4 text-white p-2 bg-black rounded-full" />
                       </div>
                       <div className="space-y-2">
                          <h2 className="text-3xl font-black uppercase tracking-tighter text-white">{t.mediaCenter || 'Media Center'}</h2>
                          <p className="text-white/40 max-w-md text-sm">{t.mediaCenterDesc || 'Voice synthesis, media playback, and audio settings.'}</p>
                       </div>
                       <div className="flex gap-4">
                          <button onClick={() => { toggleWindow('settings'); setSettingsSection('voice'); }} className="px-6 py-3 bg-celestial-saturn/10 border border-celestial-saturn/30 rounded-2xl text-[10px] font-black uppercase tracking-widest text-celestial-saturn hover:bg-celestial-saturn/20 transition-all">
                             {t.voiceForge || 'Voice Forge'}
                          </button>
                          <button onClick={() => { toggleWindow('settings'); setSettingsSection('music'); }} className="px-6 py-3 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-white/40 hover:bg-white/10 transition-all">
                             {t.mediaServices || 'Media Services'}
                          </button>
                       </div>
                    </div>
                  ) : windowId === 'personality' ? (
                    <PersonalityEditor t={t} />
                  ) : windowId === 'tools' ? (
                    <ToolPanel />
                  ) : windowId === 'github-mcp' ? (
                    <GitHubMCPBrowser t={t} />
                  ) : windowId === 'notifications' ? (
                    <NotificationCenter
                      onChatMessage={(message) => {
                        closeWindow('notifications');
                        setChatPrefill(message);
                        setChatOpen(true);
                      }}
                    />
                  ) : windowId === 'reminders' ? (
                    <ReminderPanel t={t} />
                  ) : windowId === 'devices' ? (
                    <DeviceSyncCenter t={t} />
                  ) : windowId === 'tokens' ? (
                    <TokenDashboard />
                  ) : windowId === 'skills' ? (
                    <SkillCenter t={t} lang={lang} />
                  ) : windowId === 'subscription' ? (
                    <SubscriptionPanel t={t} />
                  ) : windowId === 'avatar-studio' ? (
                    <AvatarStudio
                      t={t}
                      selectedPetId={selectedPet?.id}
                      onSelectPet={handleSelectPet}
                      equippedAccessories={equippedAccessories}
                      onChangeAccessories={(ids) => {
                        setEquippedAccessories(ids);
                        savePetPrefsToServer(selectedPet, ids);
                      }}
                      onResetToSphere={() => {
                        setSelectedPet(null);
                        savePetPrefsToServer(null, equippedAccessories);
                        toast.info('已切换回原始圆球');
                      }}
                    />
                  ) : windowId === 'sound' ? (
                    <SoundPanel t={t} />
                  ) : windowId === 'chat' ? (
                    // Chat is now fullscreen overlay — this case should not be reached
                    null
                  ) : renderTabContent(windowId)}
                </div>
              </OSWindow>
            );
          })}
        </AnimatePresence>
      </div>

        </div>
      </motion.div>

      {/* Knowledge Base fullscreen overlay */}
      <Suspense fallback={null}>
        <KnowledgeBase
          t={t}
          isOpen={knowledgeOpen}
          onClose={() => setKnowledgeOpen(false)}
        />
      </Suspense>

      {/* Chat fullscreen overlay */}
      <AgentChatPage
        t={t}
        user={user}
        isOpen={chatOpen}
        onClose={() => { setChatOpen(false); setChatPrefill(''); }}
        prefillMessage={chatPrefill}
        onPrefillConsumed={() => setChatPrefill('')}
      />

      {/* Org Workbench fullscreen overlay — available to all logged-in users */}
      <AnimatePresence>
        {activeTab === 'org' && (
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3 }}
            className="fixed inset-0 z-[220] bg-celestial-deep overflow-auto"
          >
            <OrgPortal onBack={() => setActiveTab('home')} />
          </motion.div>
        )}
      </AnimatePresence>

      {/* Sanctuary — fullscreen immersive memory avatar space */}
      <Sanctuary
        agent={sanctuaryAgent}
        isOpen={sanctuaryOpen}
        onClose={() => { setSanctuaryOpen(false); setSanctuaryAgent(null); }}
      />

      {/* Memory Avatar Lab fullscreen overlay */}
      <AnimatePresence>
        {memoryLabOpen && (
          <motion.div
            initial={{ clipPath: 'circle(0% at 50% 95%)', opacity: 0 }}
            animate={{ clipPath: 'circle(150% at 50% 95%)', opacity: 1 }}
            exit={{ clipPath: 'circle(0% at 50% 95%)', opacity: 0 }}
            transition={{ duration: 0.55, ease: [0.25, 0.1, 0.25, 1] }}
            className="fixed inset-0 z-[215]"
            style={{ background: 'radial-gradient(ellipse at 50% 30%, #12081a 0%, #0a0510 40%, #020205 100%)' }}
          >
            <div className="absolute top-4 left-4 z-10">
              <button
                onClick={() => setMemoryLabOpen(false)}
                className="w-10 h-10 flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/[0.08] rounded-2xl text-white/40 hover:text-white hover:border-white/20 transition-all"
              >
                <ArrowLeft size={18} />
              </button>
            </div>
            <MemoryAvatarLab
              t={t}
              onEnterSanctuary={(agent: any) => {
                setMemoryLabOpen(false);
                setSanctuaryAgent(agent);
                setSanctuaryOpen(true);
              }}
            />
          </motion.div>
        )}
      </AnimatePresence>

      <ToolConfirmDialog socket={socket} isWallpaperMode={isWallpaperMode} />

    </div>
  );
}

function SoundPanel({ t }: { t?: any }) {
  const [designPrompt, setDesignPrompt] = useState('');
  const [designName, setDesignName] = useState('');
  const [designing, setDesigning] = useState(false);
  const [voiceRefresh, setVoiceRefresh] = useState(0);

  const handleDesign = async () => {
    if (!designPrompt.trim() || !designName.trim()) return;
    setDesigning(true);
    try {
      const res = await fetch('/api/voice/design', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt: designPrompt.trim(), name: designName.trim() }),
        credentials: 'include',
      });
      if (!res.ok) throw new Error((await res.json()).error);
      const data = await res.json();
      toast.success(`Voice "${data.name}" created`);
      setDesignPrompt('');
      setDesignName('');
      setVoiceRefresh(n => n + 1);
    } catch (err: any) {
      toast.error(err.message || 'Voice design failed');
    } finally {
      setDesigning(false);
    }
  };

  return (
    <div className="space-y-4 animate-in fade-in slide-in-from-bottom-4 duration-500 h-full flex flex-col">
      <div className="flex items-center gap-3 shrink-0">
        <div className="p-3 bg-gradient-to-br from-sky-500 to-indigo-600 rounded-2xl shadow-lg">
          <Volume2 size={24} className="text-white" />
        </div>
        <div>
          <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">{t?.voiceStudio || 'Voice Studio'}</h3>
          <p className="text-[10px] text-white/30 uppercase tracking-widest">{t?.voiceStudioDesc || 'Cloning & Design'}</p>
        </div>
        <div className="ml-auto">
          <VoicePicker t={t} direction="down" refreshTrigger={voiceRefresh} />
        </div>
      </div>

      <div className="flex-1 grid grid-cols-2 gap-4 overflow-hidden">
        {/* Left: Clone */}
        <div className="overflow-y-auto scrollbar-hide rounded-2xl bg-white/[0.02] border border-white/5 p-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-white/30 mb-4">{t?.voiceCloning || 'Voice Cloning'}</h4>
          <VoiceForge t={t} compact onCloneSuccess={() => setVoiceRefresh(n => n + 1)} />
        </div>

        {/* Right: Design */}
        <div className="overflow-y-auto scrollbar-hide rounded-2xl bg-white/[0.02] border border-white/5 p-4 space-y-4">
          <h4 className="text-xs font-black uppercase tracking-widest text-white/30">{t?.voiceDesignTab || 'Voice Design'}</h4>
          <p className="text-xs text-white/40">{t?.voiceDesignDesc || 'Describe the voice you want, and AI will generate it. No audio sample needed.'}</p>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-white/30">{t?.voiceDesignPrompt || 'Voice Description'}</label>
            <textarea
              value={designPrompt}
              onChange={e => setDesignPrompt(e.target.value)}
              placeholder={t?.voiceDesignPlaceholder || 'e.g. A warm, gentle female voice with a soft tone, speaking at a moderate pace, suitable for storytelling...'}
              className="w-full h-24 bg-black/40 border border-white/10 rounded-2xl p-3 text-sm text-white/80 outline-none focus:border-sky-500/50 resize-none"
            />
          </div>
          <div className="space-y-2">
            <label className="text-[10px] font-black uppercase text-white/30">{t?.voiceDesignName || 'Voice Name'}</label>
            <input
              value={designName}
              onChange={e => setDesignName(e.target.value)}
              placeholder="e.g. Storyteller_v1"
              className="w-full bg-black/40 border border-white/10 rounded-xl p-3 text-sm text-white/80 outline-none focus:border-sky-500/50"
            />
          </div>
          <button
            onClick={handleDesign}
            disabled={designing || !designPrompt.trim() || !designName.trim()}
            className="w-full py-3 bg-sky-500/20 border border-sky-500/30 rounded-2xl text-sm font-black uppercase tracking-widest text-sky-400 hover:bg-sky-500/30 disabled:opacity-30 disabled:cursor-not-allowed transition-all"
          >
            {designing ? (t?.generating || 'Generating...') : t?.generateVoice || 'Generate Voice'}
          </button>
        </div>
      </div>
    </div>
  );
}

function BatteryIndicator() {
  const [level, setLevel] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);

  useEffect(() => {
    const nav = navigator as any;
    if (nav.getBattery) {
      nav.getBattery().then((b: any) => {
        setLevel(Math.round(b.level * 100));
        setCharging(b.charging);
        b.addEventListener('levelchange', () => setLevel(Math.round(b.level * 100)));
        b.addEventListener('chargingchange', () => setCharging(b.charging));
      }).catch(() => setLevel(null));
    }
  }, []);

  if (level === null) return <Battery size={14} />;

  return (
    <div className="flex items-center gap-1" title={`电池 ${level}%${charging ? ' (充电中)' : ''}`}>
      <Battery size={14} className={level <= 20 ? 'text-red-400' : level <= 50 ? 'text-yellow-400' : ''} />
      <span className="text-[10px] font-bold">{level}%</span>
    </div>
  );
}

function TopMenuButton({ label, onClick, children }: { label: string; onClick?: () => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setOpen(false));

  if (!children) {
    return (
      <button onClick={onClick} className="text-[10px] font-bold text-white/30 hover:text-white uppercase tracking-widest transition-colors">
        {label}
      </button>
    );
  }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        onMouseEnter={() => setOpen(true)}
        className="text-[10px] font-bold text-white/30 hover:text-white uppercase tracking-widest transition-colors"
      >{label}</button>
      {open && (
        <div
          className="absolute top-5 left-0 z-[110] py-2 bg-black/90 backdrop-blur-xl border border-white/10 rounded-xl shadow-2xl min-w-[120px]"
          onMouseEnter={() => setOpen(true)}
          onMouseLeave={() => setOpen(false)}
        >
          {children}
        </div>
      )}
    </div>
  );
}

function useClickAway(ref: React.RefObject<HTMLElement | null>, handler: () => void) {
  useEffect(() => {
    const listener = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) handler();
    };
    document.addEventListener('mousedown', listener);
    return () => document.removeEventListener('mousedown', listener);
  }, [ref, handler]);
}

function ClockWidget({ t, time }: { t?: any; time: Date }) {
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setIsOpen(false));

  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  const today = time;
  const monthDays = new Date(today.getFullYear(), today.getMonth() + 1, 0).getDate();
  const firstDay = new Date(today.getFullYear(), today.getMonth(), 1).getDay();
  const calDays = Array.from({ length: monthDays }, (_, i) => i + 1);

  return (
    <div ref={ref} className="relative">
      <GlassCard
        className="p-4 rounded-[2rem] border-white/5 bg-black/20 flex flex-col items-center justify-center text-center gap-2 cursor-pointer hover:bg-white/[0.06] transition-all"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Clock size={20} className="text-celestial-saturn" />
        <div className="text-xl font-black text-white/80">
          {today.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
        </div>
        <span className="text-[8px] font-bold text-white/30 uppercase tracking-widest">
          {days[today.getDay()]}, {months[today.getMonth()]} {today.getDate()}
        </span>
      </GlassCard>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="absolute top-full mt-2 left-0 z-[80] w-64 p-4 rounded-2xl bg-black/90 backdrop-blur-2xl border border-white/10 shadow-2xl pointer-events-auto"
        >
          <div className="text-center mb-3">
            <div className="text-xs font-black uppercase tracking-widest text-white/60">
              {months[today.getMonth()]} {today.getFullYear()}
            </div>
          </div>
          <div className="grid grid-cols-7 gap-1 mb-2">
            {['S','M','T','W','T','F','S'].map((d, i) => (
              <span key={i} className="text-[8px] font-bold text-white/20 text-center">{d}</span>
            ))}
          </div>
          <div className="grid grid-cols-7 gap-1">
            {Array.from({ length: firstDay }, (_, i) => <div key={`e${i}`} />)}
            {calDays.map(d => (
              <div
                key={d}
                className={`text-[10px] text-center py-1 rounded-md font-mono ${
                  d === today.getDate() ? 'bg-celestial-saturn text-black font-bold' : 'text-white/60 hover:bg-white/10 cursor-pointer'
                }`}
              >
                {d}
              </div>
            ))}
          </div>
          <div className="mt-3 pt-3 border-t border-white/5 text-[9px] text-white/30 text-center font-mono">
            {today.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
        </motion.div>
      )}
    </div>
  );
}

function BatteryWidget({ t }: { t?: any }) {
  const [level, setLevel] = useState<number | null>(null);
  const [charging, setCharging] = useState(false);
  const [isOpen, setIsOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useClickAway(ref, () => setIsOpen(false));

  useEffect(() => {
    const nav = navigator as any;
    if (nav.getBattery) {
      nav.getBattery().then((b: any) => {
        setLevel(Math.round(b.level * 100));
        setCharging(b.charging);
        b.addEventListener('levelchange', () => setLevel(Math.round(b.level * 100)));
        b.addEventListener('chargingchange', () => setCharging(b.charging));
      }).catch(() => setLevel(null));
    }
  }, []);

  const estHours = level != null ? Math.round((level / 100) * (charging ? 0 : 8)) : null;
  const powerDraw = level != null ? Math.round(60 - level * 0.3) : null;

  return (
    <div ref={ref} className="relative">
      <GlassCard
        className="p-4 rounded-[2rem] border-white/5 bg-black/20 flex flex-col items-center justify-center text-center gap-2 cursor-pointer hover:bg-white/[0.06] transition-all"
        onClick={() => setIsOpen(!isOpen)}
      >
        <Battery size={20} className={level != null && level <= 20 ? 'text-red-400' : level != null && level <= 50 ? 'text-yellow-400' : 'text-celestial-glow'} />
        <div className="text-xl font-black text-white/80">{level != null ? `${level}%` : '--%'}</div>
        <span className="text-[8px] font-bold text-white/30 uppercase tracking-widest">
          {level == null ? (t?.webMode || 'Web Mode') : charging ? (t?.charging || 'Charging') : (t?.battery || 'Battery')}
        </span>
      </GlassCard>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0, scale: 0.95, y: -8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          className="absolute top-full mt-2 right-0 z-[80] w-56 p-4 rounded-2xl bg-black/90 backdrop-blur-2xl border border-white/10 shadow-2xl pointer-events-auto"
        >
          <div className="text-[10px] font-black uppercase tracking-widest text-white/50 mb-3">
            {t?.powerUsage || 'Power Usage'}
          </div>
          <div className="space-y-2">
            <div className="flex justify-between text-[10px]">
              <span className="text-white/40">{t?.currentLevel || 'Current Level'}</span>
              <span className="font-bold text-white/80">{level}%</span>
            </div>
            <div className="flex justify-between text-[10px]">
              <span className="text-white/40">{t?.status || 'Status'}</span>
              <span className={`font-bold ${charging ? 'text-green-400' : 'text-white/80'}`}>
                {charging ? (t?.charging || 'Charging') : (t?.onBattery || 'On Battery')}
              </span>
            </div>
            {estHours != null && !charging && (
              <div className="flex justify-between text-[10px]">
                <span className="text-white/40">{t?.estRemaining || 'Est. Remaining'}</span>
                <span className="font-bold text-white/80">~{estHours}h</span>
              </div>
            )}
            {powerDraw != null && (
              <div className="flex justify-between text-[10px]">
                <span className="text-white/40">{t?.estPowerDraw || 'Est. Power Draw'}</span>
                <span className="font-bold text-white/80">~{powerDraw}W</span>
              </div>
            )}
            <div className="h-2 bg-white/5 rounded-full overflow-hidden">
              <motion.div
                initial={{ width: 0 }}
                animate={{ width: `${level ?? 0}%` }}
                className={`h-full rounded-full ${(level ?? 100) <= 20 ? 'bg-red-500' : (level ?? 100) <= 50 ? 'bg-yellow-500' : 'bg-gradient-to-r from-cyan-400 to-green-400'}`}
              />
            </div>
          </div>
        </motion.div>
      )}
    </div>
  );
}


