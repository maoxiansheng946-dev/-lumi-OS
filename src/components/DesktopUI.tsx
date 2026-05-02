import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence, useMotionValue, useTransform } from 'motion/react';
import { HardcoreBootSequence } from './HardcoreBootSequence';
import { GlobalNodeMap } from './GlobalNodeMap';
import { sounds } from '../services/soundService';
import { 
  Rocket, 
  MessageSquare, 
  Cpu, 
  Globe, 
  Users, 
  BookOpen, 
  Settings as SettingsIcon,
  Shield,
  Award,
  Layout,
  ShoppingBag,
  Zap,
  X,
  User as UserIcon,
  Search,
  Handshake,
  Folder,
  FileText,
  Activity,
  Wifi,
  Volume2,
  Battery,
  Bluetooth,
  Moon,
  Sun,
  Maximize2,
  ChevronRight,
  ChevronDown,
  Clock,
  Calendar as CalendarIcon,
  Bell,
  Music,
  MessagesSquare,
  Disc,
  Headphones,
  BrainCircuit,
  Sparkles
} from 'lucide-react';
import { GlassCard } from './SharedUI';
import { LocalAgentSphere } from './LocalAgentSphere';
import { VoiceCallButton } from './VoiceCallButton';
import { useSocket } from '@/hooks/useSocket';
import { useVoiceCall } from '@/hooks/useVoiceCall';
import { listVoices } from '@/services/voiceService';
import { NeuralFileManager } from './NeuralFileManager';
import { Settings } from './Settings';
import { systemService } from '@/services/systemService';
import { usePlatform } from '@/hooks/usePlatform';

// Define the shape of the native API
interface NativeFile {
  name: string;
  path: string;
  isDirectory: boolean;
}

interface SystemInfo {
  platform: string;
  hostname: string;
  freeMemory: number;
}

declare global {
  interface Window {
    lumiElectron?: {
      getSystemInfo: () => Promise<SystemInfo>;
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
  isMinimized: boolean;
  t: any;
  colorClass?: string;
  width?: string | number;
  height?: string | number;
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
  isMinimized, 
  t,
  colorClass = 'from-celestial-mars to-celestial-saturn',
  width = 'auto',
  height = 'auto'
}: WindowProps) {
  const [isMaximized, setIsMaximized] = useState(false);
  const [snapZone, setSnapZone] = useState<'none' | 'left' | 'right'>('none');
  const constraintsRef = React.useRef(null);

  if (isMinimized) return null;

  return (
    <motion.div
      drag={!isMaximized}
      dragMomentum={false}
      dragConstraints={{ top: 40, left: 0, right: 0, bottom: 0 }}
      onDragEnd={(e, info) => {
        if (info.point.x < 100) setSnapZone('left');
        else if (info.point.x > window.innerWidth - 100) setSnapZone('right');
        else setSnapZone('none');
      }}
      initial={{ opacity: 0, scale: 0.9, y: 20 }}
      animate={{ 
        opacity: 1, 
        scale: 1, 
        width: isMaximized ? '100vw' : snapZone !== 'none' ? '50vw' : width,
        height: isMaximized ? 'calc(100vh - 40px)' : snapZone !== 'none' ? 'calc(100vh - 40px)' : height,
        top: isMaximized || snapZone !== 'none' ? '40px' : '50%',
        left: isMaximized ? '0' : snapZone === 'left' ? '0' : snapZone === 'right' ? '50%' : '50%',
        x: isMaximized || snapZone !== 'none' ? 0 : '-50%',
        y: isMaximized || snapZone !== 'none' ? 0 : '-50%',
      }}
      exit={{ opacity: 0, scale: 0.9, y: 20 }}
      style={{ 
        zIndex: isActive ? 50 : 10,
        position: isMaximized || snapZone !== 'none' ? 'fixed' : 'absolute' 
      }}
      onClick={() => onFocus(id)}
      className={`os-window overflow-hidden ${isMaximized ? 'rounded-none' : 'rounded-[2.5rem]'}`}
    >
      <div 
        className="os-window-header cursor-default px-6"
        onDoubleClick={() => setIsMaximized(!isMaximized)}
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
          <div className="h-6 w-px bg-white/5 mr-2" />
          <button 
            onClick={() => onMinimize(id)}
            className="w-3 h-3 rounded-full bg-blue-500/20 border border-blue-500/40 hover:bg-blue-500/60 transition-colors" 
          />
          <button 
            onClick={() => setIsMaximized(!isMaximized)}
            className="w-3 h-3 rounded-full bg-yellow-500/20 border border-yellow-500/40 hover:bg-yellow-500/60 transition-colors" 
          />
          <button className="w-3 h-3 rounded-full bg-green-500/20 border border-green-500/40 hover:bg-green-500/60 transition-colors" />
          <button 
            onClick={(e) => { e.stopPropagation(); onClose(id); }}
            className="w-3 h-3 rounded-full bg-red-500/40 border border-red-500/60 hover:bg-red-500/80 flex items-center justify-center transition-colors group/close"
          >
            <X size={6} className="text-white opacity-0 group-hover/close:opacity-100 transition-opacity" />
          </button>
        </div>
      </div>
      <div className="os-window-content bg-[#05050a]/98 backdrop-blur-3xl custom-scrollbar h-full">
        {children}
      </div>
    </motion.div>
  );
}

function ControlCenter({ isOpen, onClose, t, brightness, setBrightness, volume, setVolume, theme, setTheme, lang, setLang }: { 
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
}) {
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
             <button className="w-10 h-10 rounded-full bg-blue-500 flex items-center justify-center text-white active:scale-95 transition-transform" title={t.wifi}><Wifi size={18} /></button>
             <button className="w-10 h-10 rounded-full bg-white/10 flex items-center justify-center text-white/40 active:scale-95 transition-transform" title={t.bluetooth}><Bluetooth size={18} /></button>
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
               <Sun size={12} />
             </div>
             <div className="h-4 w-full bg-white/5 rounded-full relative group cursor-pointer" onClick={(e) => {
               const rect = e.currentTarget.getBoundingClientRect();
               const percent = (e.clientX - rect.left) / rect.width;
               setBrightness(Math.min(100, Math.max(0, percent * 100)));
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
                setVolume(Math.min(100, Math.max(0, percent * 100)));
             }}>
               <motion.div 
                 animate={{ width: `${volume}%` }}
                 className="h-full bg-celestial-saturn rounded-full" 
               />
             </div>
           </div>
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
        <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-orange-500/20 flex items-center justify-center text-orange-500"><Sun size={16} /></div>
            <span className="text-xs font-bold text-white/80">{t.nightShift || 'Night Shift'}</span>
          </div>
          <ChevronRight size={14} className="text-white/20" />
        </div>
        <div className="flex items-center justify-between p-3 bg-white/5 rounded-xl">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-500"><Maximize2 size={16} /></div>
            <span className="text-xs font-bold text-white/80">{t.focusMode || 'Focus Mode'}</span>
          </div>
          <ChevronRight size={14} className="text-white/20" />
        </div>
      </div>
      
      <div className="mt-6 pt-6 border-t border-white/5 flex items-center justify-between font-sans">
        <span className="text-[10px] font-bold text-white/20 tracking-widest uppercase">Lumi OS v2.0.4</span>
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
}

function DesktopIcon({ label, icon, colorClass, onClick }: DesktopIconProps) {
  return (
    <motion.div 
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      onClick={onClick}
      className="desktop-icon group"
    >
      <div className={`desktop-icon-img bg-gradient-to-br ${colorClass} shadow-[0_10px_20px_-5px_rgba(0,0,0,0.5)]`}>
        <div className="text-white group-hover:rotate-12 transition-transform">
          {icon}
        </div>
      </div>
      <span className="desktop-icon-label">{label}</span>
    </motion.div>
  );
}

function KernelMonitorApp({ t }: { t: any }) {
  const [data, setData] = useState<number[]>([]);
  
  useEffect(() => {
    const interval = setInterval(() => {
      setData(prev => {
        const next = [...prev, Math.random() * 50 + 25];
        return next.slice(-30);
      });
    }, 400);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="p-8 h-full flex flex-col space-y-6 font-sans">
      <div className="flex justify-between items-center bg-black/40 p-5 rounded-[2rem] border border-white/5 backdrop-blur-xl">
        <div className="flex items-center gap-4">
          <div className="w-12 h-12 rounded-2xl bg-celestial-saturn/10 flex items-center justify-center text-celestial-saturn border border-celestial-saturn/20 shadow-[0_0_20px_rgba(255,200,80,0.1)]">
            <Cpu size={24} />
          </div>
          <div>
            <div className="text-[10px] font-black text-white/40 uppercase tracking-widest leading-none mb-1">{t.localIntelNode || 'Local Intelligence Node'}</div>
            <div className="text-lg font-black text-white tracking-tight">SILICON_ADAPTIVE_V2.4</div>
          </div>
        </div>
        <div className="text-right">
          <div className="text-[10px] font-black text-celestial-saturn uppercase tracking-widest leading-none mb-1">{t.status || 'Status'}: {t.optimal || 'Optimal'}</div>
          <div className="text-xs font-mono text-white/40">0.02ms {t.meshLatency || 'Latency'} / 824.2 TOPs</div>
        </div>
      </div>

      <div className="grid grid-cols-3 gap-4">
        {[
          { label: t.neuralThroughput || 'Neural Throughput', value: '82.4 GB/s', color: 'bg-celestial-saturn' },
          { label: t.synapticLoad || 'Synaptic Load', value: '14.2%', color: 'bg-emerald-500' },
          { label: t.meshLatency || 'Mesh Latency', value: '0.12 ms', color: 'bg-blue-500' }
        ].map((stat, i) => (
          <div key={i} className="p-5 bg-white/5 rounded-[2rem] border border-white/5 space-y-3 hover:bg-white/10 transition-colors cursor-default">
            <div className="text-[9px] font-black text-white/20 uppercase tracking-[0.2em]">{stat.label}</div>
            <div className="text-xl font-black text-white tracking-tighter">{stat.value}</div>
            <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
               <motion.div 
                 initial={{ width: 0 }}
                 animate={{ width: `${Math.random() * 60 + 20}%` }}
                 transition={{ duration: 2, repeat: Infinity, repeatType: 'reverse' }}
                 className={`h-full ${stat.color} shadow-[0_0_10px_currentColor]`} 
                />
            </div>
          </div>
        ))}
      </div>

      <div className="flex-1 bg-black/40 rounded-[2.5rem] border border-white/5 p-8 relative overflow-hidden flex flex-col">
        <div className="absolute inset-0 opacity-10 bg-[linear-gradient(rgba(255,200,80,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(255,200,80,0.05)_1px,transparent_1px)] bg-[size:30px_30px]" />
        
        <div className="relative z-10 space-y-6 h-full flex flex-col text-white/90">
           <div className="flex justify-between items-center">
             <div className="flex items-center gap-3">
               <Activity size={14} className="text-celestial-saturn animate-pulse" />
               <span className="text-[10px] font-black text-white/40 uppercase tracking-[0.3em] italic">{t.memoryAllocShards || 'Memory Allocation Shards'}</span>
             </div>
             <span className="text-[10px] font-mono text-celestial-saturn opacity-50 tracking-widest whitespace-nowrap overflow-hidden w-32 border-b border-celestial-saturn/20">0xEF4A92F...01</span>
           </div>

           <div className="grid grid-cols-10 gap-2 flex-1 items-start content-start">
              {[...Array(60)].map((_, i) => (
                <motion.div 
                  key={i}
                  animate={{ 
                    opacity: [0.2, 0.8, 0.2],
                    backgroundColor: Math.random() > 0.85 ? '#ffcc00' : 'rgba(255,255,255,0.05)'
                  }}
                  transition={{ duration: 2 + Math.random() * 4, repeat: Infinity, delay: i * 0.05 }}
                  className="aspect-square rounded shadow-inner"
                />
              ))}
           </div>
           
           <div className="mt-auto pt-8 border-t border-white/5 flex justify-between items-end">
              <div className="space-y-2">
                 <div className="text-[9px] font-black text-white/20 uppercase tracking-widest">{t.activeMeshPeers || 'Active Mesh Peers Registered'}</div>
                 <div className="flex gap-2 text-[10px] font-mono text-emerald-500">
                    <span className="animate-pulse">●</span>
                    <span className="font-black">LUMI_GATEWAY_NODE_MOBILE_0x2</span>
                 </div>
              </div>
              <button className="h-10 bg-celestial-saturn/10 border border-celestial-saturn/20 text-celestial-saturn text-[10px] font-black uppercase tracking-widest px-6 rounded-2xl hover:bg-celestial-saturn hover:text-black transition-all active:scale-95 shadow-xl">
                {t.forceCacheReshard || 'FORCE CACHE RE-SHARD'}
              </button>
           </div>
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
      className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-start justify-center pt-[15vh] px-4"
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
  const cameraRotateX = useMotionValue(0);
  const cameraRotateY = useMotionValue(0);

  useEffect(() => {
    cameraZ.set(viewMode === 'personal' ? 0 : -1000);
  }, [viewMode]);

  const handleMouseMove = (e: React.MouseEvent) => {
    const { clientX, clientY } = e;
    const moveX = (clientX - window.innerWidth / 2) / 50;
    const moveY = (clientY - window.innerHeight / 2) / 50;
    cameraRotateX.set(-moveY);
    cameraRotateY.set(moveX);
  };

  const personalScale = useTransform(cameraZ, [0, -1000], [1, 0.4]);
  const personalOpacity = useTransform(cameraZ, [0, -400], [1, 0]);
  const worldOpacity = useTransform(cameraZ, [0, -1000], [0.1, 1]);
  const worldScale = useTransform(cameraZ, [0, -1000], [2, 1]);
  const { isTauri } = usePlatform();

  const [openWindows, setOpenWindows] = useState<string[]>(activeTab !== 'home' ? [activeTab] : []);
  const [minimizedWindows, setMinimizedWindows] = useState<string[]>([]);
  const [focusedWindow, setFocusedWindow] = useState<string | null>(activeTab !== 'home' ? activeTab : null);
  const [theme, setTheme] = useState<string>('celestial');
  const [nativeFiles, setNativeFiles] = useState<NativeFile[]>([]);
  const [systemInfo, setSystemInfo] = useState<SystemInfo | null>(null);
  const [terminalInput, setTerminalInput] = useState('');
  const [terminalOutput, setTerminalOutput] = useState<string[]>(['Lumi Virtual Node OS [Version 2.0.4]', '(c) Lumi Artificial Intelligence. All rights mesh nodes.']);
  const [isControlCenterOpen, setIsControlCenterOpen] = useState(false);
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState('general');
  const [brightness, setBrightness] = useState(85);
  const [volume, setVolume] = useState(60);
  const [time, setTime] = useState(new Date());
  const [isWallpaperMode, setIsWallpaperMode] = useState(false);

  const socket = useSocket();
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | undefined>();
  const [voices, setVoices] = useState<any[]>([]);
  const [showVoicePicker, setShowVoicePicker] = useState(false);

  const { callState, audioLevel, startCall, endCall, error: callError } = useVoiceCall({
    socket,
    onTranscript: (text, isFinal) => {
      if (isFinal) {
        setTerminalOutput(prev => [...prev, `[You]: ${text}`]);
      }
    },
    onResponse: (text) => {
      setTerminalOutput(prev => [...prev, `[Lumi]: ${text}`]);
    }
  });

  useEffect(() => {
    listVoices().then(data => {
      const all = [...data.cloned, ...data.premade];
      setVoices(all);
      if (all.length > 0 && !selectedVoiceId) {
        setSelectedVoiceId(all[0].voiceId);
      }
    }).catch(() => {});
  }, [selectedVoiceId]);

  useEffect(() => {
    if (callError) toast.error(callError);
  }, [callError]);

  const toggleWallpaperMode = async () => {
    const nextMode = !isWallpaperMode;
    setIsWallpaperMode(nextMode);
    await systemService.setClickThrough(nextMode);
    toast(nextMode ? 'Wallpaper Fusion Active' : 'Standard Focus Mode', {
      icon: nextMode ? <Sparkles className="text-celestial-saturn" /> : <Box className="text-white/40" />
    });
  };

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setIsSearchOpen(true);
      }
      if (e.key === 'Escape') {
        setIsSearchOpen(false);
        setIsControlCenterOpen(false);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);
  const [showBootScreen, setShowBootScreen] = useState(true);
  const [bootVisible, setBootVisible] = useState(true);

  // Remove the old interval-based boot logic since HardcoreBootSequence handles it

  useEffect(() => {
    const timer = setInterval(() => setTime(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const handleTerminalSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!terminalInput.trim()) return;
    
    const cmd = terminalInput.toLowerCase().trim();
    setTerminalOutput(prev => [...prev, `> ${terminalInput}`]);
    setTerminalInput('');

    if (cmd === 'lumi --vision') {
      setTerminalOutput(prev => [...prev, 'LUMI_WORLD_READY: The universe is decentralized. Every node is a heartbeat.']);
      return;
    }
    if (cmd === 'node --status') {
      setTerminalOutput(prev => [...prev, 'SCANNING_MESH_NODES...', 'ACTIVE: 42,901', 'ORPHAN_NODES: 0', 'HEALTH: 100%']);
      sounds.playSuccess();
      return;
    }
    if (cmd === 'shard --rebuild') {
      setTerminalOutput(prev => [...prev, 'INITIATING_REBUILD_SEQUENCE...', 'PARSING_LOCAL_ENTROPY...', 'RE-BUILDING_SHARDS_0-4096...', 'SYNCHRONIZATION_COMPLETE.']);
      sounds.playPulse();
      // Visual feedback: toggle a state or trigger animation?
      return;
    }

    const result = await systemService.runCommand(cmd);
    setTerminalOutput(prev => [...prev, result.output]);
  };

  useEffect(() => {
    const fetchNativeData = async () => {
      try {
        const stats = await systemService.getSystemStats();
        setSystemInfo(stats);
        // We could also add listHomeFiles to systemService if needed
      } catch (err) {
        console.error('Failed to fetch native data:', err);
      }
    };
    fetchNativeData();
  }, []);

  const toggleWindow = (tab: string) => {
    sounds.playClick();
    if (tab === 'home') {
      setOpenWindows([]);
      setFocusedWindow(null);
      setActiveTab('home');
      return;
    }

    if (openWindows.includes(tab)) {
      if (minimizedWindows.includes(tab)) {
        setMinimizedWindows(prev => prev.filter(w => w !== tab));
      }
      setFocusedWindow(tab);
    } else {
      setOpenWindows([...openWindows, tab]);
      setFocusedWindow(tab);
    }
    setActiveTab(tab);
  };

  const closeWindow = (tab: string) => {
    sounds.playClick();
    const nextWindows = openWindows.filter(w => w !== tab);
    setOpenWindows(nextWindows);
    if (focusedWindow === tab) {
      setFocusedWindow(nextWindows.length > 0 ? nextWindows[nextWindows.length - 1] : null);
      if (nextWindows.length === 0) setActiveTab('home');
    }
  };

  const appIcons = [
    { id: 'home', label: t.neuralCore || 'Neural Core', icon: <Sparkles size={24} />, color: 'from-celestial-saturn to-yellow-600' },
    { id: 'fs', label: t.fileExplorer || 'Neural FS', icon: <Folder size={24} />, color: 'from-blue-400 to-indigo-500' },
    { id: 'kernel', label: t.kernelMonitor || 'Kernel Monitor', icon: <Activity size={24} />, color: 'from-orange-500 to-red-600' },
    { id: 'protocols', label: t.lostProtocols || 'Lost Protocols', icon: <Disc size={24} />, color: 'from-purple-500 to-indigo-600' },
    { id: 'terminal', label: t.terminal || 'Neural Terminal', icon: <Rocket size={24} />, color: 'from-blue-600 to-cyan-400' },
    { id: 'network', label: t.nexusStream || 'Nexus Stream', icon: <Globe size={24} />, color: 'from-green-500 to-emerald-600' },
    { id: 'music', label: t.mediaCenter || 'Cosmic Drift', icon: <Music size={24} />, color: 'from-pink-500 to-rose-500' },
    { id: 'settings', label: t.settings || 'OS Integrity', icon: <SettingsIcon size={24} />, color: 'from-gray-400 to-slate-600' },
  ];

  const themeConfig = {
    celestial: { 
      accent: 'celestial-saturn', 
      hex: '#ffcc00', 
      glow: 'shadow-[0_0_20px_rgba(255,200,80,0.3)]',
      bg: 'bg-celestial-saturn/40'
    },
    nebula: { 
      accent: 'purple-500', 
      hex: '#a855f7', 
      glow: 'shadow-[0_0_20px_rgba(168,85,247,0.3)]',
      bg: 'bg-purple-500/40'
    },
    cyber: { 
      accent: 'emerald-500', 
      hex: '#10b981', 
      glow: 'shadow-[0_0_20px_rgba(16,185,129,0.3)]',
      bg: 'bg-emerald-500/40'
    },
  }[theme as 'celestial' | 'nebula' | 'cyber'] || {
    accent: 'celestial-saturn',
    hex: '#ffcc00',
    glow: 'shadow-[0_0_20px_rgba(255,200,80,0.3)]',
    bg: 'bg-celestial-saturn/40'
  };

  const sphereSentiment = 
    openWindows.includes('kernel') ? 'excited' : 
    openWindows.includes('terminal') ? 'focused' :
    openWindows.includes('music') ? 'zen' : 'default';

  const settingsSizes: { [key: string]: { w: string, h: string } } = {
    general: { w: '600px', h: '450px' },
    neural: { w: '950px', h: '750px' },
    api: { w: '850px', h: '700px' },
    music: { w: '900px', h: '650px' },
    sync: { w: '1100px', h: '800px' },
    security: { w: '750px', h: '600px' },
    hardware: { w: '900px', h: '750px' },
    voice: { w: '1000px', h: '800px' }
  };

  return (
    <div className={`fixed inset-0 h-screen w-screen overflow-hidden cursor-default select-none transition-all duration-1000 ${
      theme === 'celestial' ? 'bg-[#010103]' : 
      theme === 'nebula' ? 'bg-[#050010]' : 
      theme === 'cyber' ? 'bg-[#000808]' : 
      'bg-black'
    }`}>
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
      />
      {/* CRT Scanline / Noise Overlay */}
      <div className="fixed inset-0 z-[1000] pointer-events-none opacity-[0.03] bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%] select-none" />
      
      {/* Hardcore Boot Screen Overlay */}
      <AnimatePresence>
        {bootVisible && (
          <HardcoreBootSequence onComplete={() => setBootVisible(false)} />
        )}
      </AnimatePresence>

      {/* Immersive Environment Layer (Wallpaper OS Foundation) */}
      <div 
        className="fixed inset-0 z-0 overflow-hidden bg-[#010103] perspective-[1000px]"
        onMouseMove={handleMouseMove}
      >
        <motion.div 
          style={{ rotateX: cameraRotateX, rotateY: cameraRotateY }}
          className="absolute inset-0 preserve-3d"
        >
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

          {/* World/Nexus Layer - Deep Background */}
          <motion.div 
            style={{ 
              opacity: worldOpacity,
              scale: worldScale,
              z: -1200
            }}
            className="absolute inset-0 flex items-center justify-center preserve-3d"
          >
            <div className="absolute inset-0 preserve-3d">
              <div className={`absolute inset-0 opacity-40 transition-colors duration-1000 ${
                theme === 'celestial' ? 'bg-[radial-gradient(circle_at_center,rgba(255,200,80,0.05)_0%,transparent_70%)]' :
                theme === 'nebula' ? 'bg-[radial-gradient(circle_at_center,rgba(168,85,247,0.05)_0%,transparent_70%)]' :
                'bg-[radial-gradient(circle_at_center,rgba(16,185,129,0.05)_0%,transparent_70%)]'
              }`} />
              <div className="star-field opacity-60" />

              {/* 3D Tunnel Grids (Floor/Ceiling) */}
              <div className="absolute inset-0 preserve-3d">
                <motion.div 
                  animate={{ z: viewMode === 'world' ? [-400, -300] : -400 }}
                  className={`absolute inset-x-0 top-0 h-[800px] border-t transition-all duration-1000 [mask-image:radial-gradient(rgba(0,0,0,1),transparent_80%)] [transform:rotateX(90deg)_translateZ(-400px)] ${
                    theme === 'celestial' ? 'bg-[linear-gradient(to_bottom,transparent,rgba(255,200,80,0.1)_50%)] border-celestial-saturn/20' :
                    theme === 'nebula' ? 'bg-[linear-gradient(to_bottom,transparent,rgba(168,85,247,0.1)_50%)] border-purple-500/20' :
                    'bg-[linear-gradient(to_bottom,transparent,rgba(16,185,129,0.1)_50%)] border-emerald-500/20'
                  }`}
                  style={{ 
                    backgroundSize: '60px 60px', 
                    backgroundImage: `linear-gradient(to right, ${themeConfig.hex}0d 1px, transparent 1px), linear-gradient(to bottom, ${themeConfig.hex}0d 1px, transparent 1px)` 
                  }} 
                />
                <motion.div 
                  animate={{ z: viewMode === 'world' ? [-400, -300] : -400 }}
                  className={`absolute inset-x-0 bottom-0 h-[800px] border-b transition-all duration-1000 [mask-image:radial-gradient(rgba(0,0,0,1),transparent_80%)] [transform:rotateX(-90deg)_translateZ(-400px)] ${
                    theme === 'celestial' ? 'bg-[linear-gradient(to_top,transparent,rgba(255,200,80,0.1)_50%)] border-celestial-saturn/20' :
                    theme === 'nebula' ? 'bg-[linear-gradient(to_top,transparent,rgba(168,85,247,0.1)_50%)] border-purple-500/20' :
                    'bg-[linear-gradient(to_top,transparent,rgba(16,185,129,0.1)_50%)] border-emerald-500/20'
                  }`}
                  style={{ 
                    backgroundSize: '60px 60px', 
                    backgroundImage: `linear-gradient(to right, ${themeConfig.hex}0d 1px, transparent 1px), linear-gradient(to bottom, ${themeConfig.hex}0d 1px, transparent 1px)` 
                  }} 
                />
              </div>
              
              {/* Dynamic Neural Particles */}
              {[...Array(60)].map((_, i) => (
                <motion.div
                  key={i}
                  initial={{ z: -3000, opacity: 0, x: (Math.random() - 0.5) * 2000, y: (Math.random() - 0.5) * 2000 }}
                  animate={{ z: 1200, opacity: [0, 1, 0.5, 0] }}
                  transition={{ duration: (4 + Math.random() * 6) / syncRate, repeat: Infinity, delay: i * 0.1, ease: "linear" }}
                  className={`absolute rounded-full transition-all duration-1000 ${themeConfig.glow} ${i % 5 === 0 ? themeConfig.bg : 'bg-white/10'} ${i % 5 === 0 ? 'w-4 h-4' : 'w-1 h-1'}`}
                  style={{ transformStyle: 'preserve-3d' }}
                />
              ))}

              {/* Emergency Assistance Requests */}
              {[...Array(4)].map((_, i) => (
                <motion.div
                   key={`emergency-${i}`}
                   initial={{ z: -1500, opacity: 0, x: (Math.random() - 0.5) * 1200, y: (Math.random() - 0.5) * 1000 }}
                   animate={{ z: 300, opacity: [0, 1, 0.5, 1, 0], scale: [1, 1.2, 1] }}
                   transition={{ duration: 8 / syncRate, repeat: Infinity, delay: i * 2, ease: "linear" }}
                   className="absolute pointer-events-auto group/sos"
                   style={{ transformStyle: 'preserve-3d' }}
                >
                  <div className="flex flex-col items-center">
                    <div className="w-6 h-6 rounded-full bg-orange-600/20 border border-orange-500 animate-ping absolute" />
                    <div className="w-6 h-6 rounded-full bg-orange-600/40 border-2 border-orange-400 flex items-center justify-center relative shadow-[0_0_20px_#ff4400]">
                      <Handshake size={14} className="text-white" />
                    </div>
                  </div>
                </motion.div>
              ))}

              {/* Neural Residents */}
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={`resident-${i}`}
                  style={{ transformStyle: 'preserve-3d' }}
                  initial={{ opacity: 0, z: -1800, x: (Math.random() - 0.5) * 1400, y: (Math.random() - 0.5) * 1200 }}
                  animate={{ z: 400, opacity: [0, 1, 0.8, 0] }}
                  transition={{ duration: 12 + Math.random() * 8, repeat: Infinity, delay: i * 1.5, ease: "linear" }}
                  className="absolute pointer-events-none"
                >
                  <div className="flex flex-col items-center gap-2 pointer-events-auto group/resident">
                    <div className="w-8 h-8 rounded-full border border-celestial-saturn/30 bg-black/40 backdrop-blur-xl flex items-center justify-center">
                      <Sparkles size={12} className="text-celestial-saturn" />
                    </div>
                  </div>
                </motion.div>
              ))}

              {/* Vertical Data Beams */}
              {[...Array(8)].map((_, i) => (
                <motion.div
                  key={`beam-${i}`}
                  initial={{ z: -2500, x: (Math.random() - 0.5) * 1600, opacity: 0 }}
                  animate={{ z: 500, opacity: [0, 0.3, 0] }}
                  transition={{ duration: 8 / syncRate, repeat: Infinity, delay: i * 1.2 }}
                  className="absolute inset-y-0 w-px bg-gradient-to-b from-transparent via-celestial-saturn/40 to-transparent"
                  style={{ transformStyle: 'preserve-3d' }}
                />
              ))}

              {/* Fragmented Lore Shards (Floating in deep space) */}
              {[...Array(4)].map((_, i) => (
                <motion.div
                   key={`shard-${i}`}
                   initial={{ opacity: 0, z: -2000, x: (Math.random() - 0.5) * 2000, y: (Math.random() - 0.5) * 1500 }}
                   animate={{ z: 500, opacity: [0, 0.2, 0] }}
                   transition={{ duration: 20 / syncRate, repeat: Infinity, delay: i * 5, ease: "linear" }}
                   className="absolute font-mono text-[8px] text-celestial-saturn/30 whitespace-nowrap"
                   style={{ transformStyle: 'preserve-3d' }}
                >
                   {["MUTUAL_AID_REQUIRED", "DISTRIBUTED_NODE_404", "VOID_SYNC_INIT", "LUMI_CORE_V2"][i]}
                </motion.div>
              ))}

              {/* Residents and Nodes would go here, kept for brevity in this architectural change */}
              <div className="absolute inset-0 bg-[conic-gradient(from_0deg_at_50%_50%,transparent_0deg,rgba(255,200,80,0.02)_180deg,transparent_360deg)] animate-[spin_20s_linear_infinite]" />
            </div>
          </motion.div>

          {/* Personal Desktop Wallpaper Layer - Sits on top of Nexus */}
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
              </AnimatePresence>
            </div>
          </motion.div>
        </motion.div>

        {/* Hyper-tunnel edges */}
        <div className="absolute inset-0 shadow-[inset_0_0_300px_rgba(0,0,0,1)] pointer-events-none" />
        
        {/* Brightness Overlay */}
        <div 
          className="absolute inset-0 pointer-events-none z-[1000] transition-opacity duration-300" 
          style={{ backgroundColor: 'black', opacity: (100 - brightness) / 100 * 0.7 }} 
        />
      </div>

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
                <h2 className="text-6xl font-black text-white/90 tracking-[1.2rem] uppercase drop-shadow-[0_0_30px_rgba(255,255,255,0.1)]">Nexus</h2>
                <div className="mt-4 flex items-center justify-center gap-4">
                  <div className="h-px w-12 bg-gradient-to-r from-transparent to-celestial-saturn/50" />
                  <p className="text-[10px] text-celestial-saturn font-black tracking-[0.8em] uppercase">Distributed OS Core</p>
                  <div className="h-px w-12 bg-gradient-to-l from-transparent to-celestial-saturn/50" />
                </div>
              </motion.div>

              <div className="flex flex-col items-center gap-4 py-8">
                <div className="flex gap-2">
                  {[0.5, 1, 1.5, 2].map((rate) => (
                    <button
                      key={rate}
                      onClick={() => setSyncRate(rate)}
                      className={`w-12 h-12 rounded-full border flex flex-col items-center justify-center transition-all ${
                        syncRate === rate 
                          ? 'bg-celestial-saturn/20 border-celestial-saturn text-celestial-saturn shadow-[0_0_15px_rgba(255,200,80,0.3)]' 
                          : 'bg-white/5 border-white/10 text-white/30 hover:bg-white/10'
                      }`}
                    >
                      <div className="text-[8px] font-black">{rate}x</div>
                      <Zap size={10} className={syncRate === rate ? 'animate-pulse' : 'opacity-20'} />
                    </button>
                  ))}
                </div>
                <span className="text-[8px] font-black text-white/20 uppercase tracking-[0.4em]">{t.meshSyncRate || 'Mesh Sync Rate'}</span>
              </div>

              <motion.button 
                whileHover={{ scale: 1.05 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => setViewMode('personal')}
                className="group px-10 py-4 bg-white/5 hover:bg-white/10 border border-white/10 rounded-full text-[10px] font-black text-white/60 tracking-[0.4em] uppercase transition-all backdrop-blur-2xl hover:text-white hover:border-white/20"
              >
                {t.focusPersonalTerritory || 'Focus Personal Territory'}
              </motion.button>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      <div className="fixed inset-0 z-[100] pointer-events-none">
        {/* Top Status Bar */}
        <div className="absolute top-0 inset-x-0 h-10 glass-dark border-b border-white/5 flex items-center justify-between px-6 pointer-events-auto backdrop-blur-md">
          <div className="flex items-center gap-6">
            <button onClick={onExit} className="flex items-center gap-2 group transition-all">
               <div className="w-6 h-6 rounded-lg bg-gradient-to-br from-celestial-mars to-celestial-saturn flex items-center justify-center p-1 group-hover:rotate-12 transition-transform shadow-lg shadow-celestial-saturn/20">
                 <Rocket size={14} className="text-white" />
               </div>
               <span className="text-[10px] font-black tracking-widest uppercase text-white/60">Lumi OS</span>
            </button>
            <div className="h-4 w-px bg-white/10" />
            <div className="flex gap-4">
               {[
                 { key: 'File', label: t.file || 'File' },
                 { key: 'Edit', label: t.edit || 'Edit' },
                 { key: 'Kernel', label: t.kernel || 'Kernel' },
                 { key: 'View', label: t.view || 'View' },
                 { key: 'Matrix', label: t.matrix || 'Matrix' }
               ].map(item => (
                 <button key={item.key} className="text-[10px] font-bold text-white/30 hover:text-white uppercase tracking-widest transition-colors">{item.key === 'Matrix' ? (
                   <span className="flex items-center gap-1">{item.label} <Search size={10} className="text-celestial-saturn" onClick={() => setIsSearchOpen(true)} /></span>
                 ) : item.label}</button>
               ))}
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-4 text-white/30">
               <div className="flex items-center gap-1" onClick={() => setIsSearchOpen(true)}><Search size={14} className="hover:text-white transition-colors cursor-pointer" /></div>
               <div className="flex items-center gap-1"><Wifi size={14} /></div>
               <div className="flex items-center gap-1"><Volume2 size={14} /></div>
               <div className="flex items-center gap-1"><Battery size={14} /> <span className="text-[10px] font-bold">98%</span></div>
            </div>

            {!navigator.userAgent.toLowerCase().includes('electron') && (
              <button 
                onClick={onExit} 
                className="bg-red-500/10 hover:bg-red-500 text-red-500 hover:text-white px-3 py-1 rounded-lg text-[9px] font-black transition-all border border-red-500/20 uppercase tracking-widest"
              >
                {t.termSession || 'Term Session'}
              </button>
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
        <div className="absolute bottom-6 left-1/2 -translate-x-1/2 pointer-events-auto h-16 px-4 glass-dark rounded-[2.5rem] border border-white/10 flex items-center gap-2 shadow-2xl backdrop-blur-2xl">
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
          <div className="h-8 w-px bg-white/10 mx-2" />
          <AnimatePresence>
            {appIcons.map(app => (
              <motion.button
                key={app.id}
                layoutId={`dock-${app.id}`}
                onClick={() => toggleWindow(app.id)}
                className={`w-12 h-12 rounded-2xl flex items-center justify-center transition-all group relative ${
                  openWindows.includes(app.id) 
                    ? `bg-gradient-to-br ${app.id === focusedWindow ? app.color : 'from-white/10 to-white/5'} text-white shadow-lg ${minimizedWindows.includes(app.id) ? 'opacity-40 translate-y-2' : ''}` 
                    : 'bg-white/5 text-white/40 hover:bg-white/10'
                }`}
              >
                {app.icon}
                {openWindows.includes(app.id) && (
                  <motion.div 
                    layoutId={`indicator-${app.id}`}
                    className={`absolute -bottom-1 left-1/2 -translate-x-1/2 rounded-full ${minimizedWindows.includes(app.id) ? 'w-3 h-0.5 bg-white/40' : 'w-1 h-1 bg-white'}`} 
                  />
                )}
                {/* Taskbar Preview Tooltip Logic Mockup */}
                {openWindows.includes(app.id) && !minimizedWindows.includes(app.id) && (
                   <div className="absolute -top-32 left-1/2 -translate-x-1/2 w-32 h-20 bg-black/80 border border-white/10 rounded-xl overflow-hidden opacity-0 group-hover:opacity-100 transition-all pointer-events-none p-1 shadow-2xl">
                      <div className="w-full h-full bg-white/5 rounded-lg flex items-center justify-center overflow-hidden">
                         <div className="scale-[0.2] origin-center opacity-40">
                           {app.icon}
                         </div>
                      </div>
                   </div>
                )}
                <div className="absolute -top-12 left-1/2 -translate-x-1/2 px-3 py-1 bg-black/80 rounded-lg text-[8px] font-black uppercase text-white opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                  {app.label}
                </div>
              </motion.button>
            ))}
          </AnimatePresence>
        </div>
      </div>

      {/* Main OS Content Layer (Personal Desktop Surface) */}
      <motion.div
        style={{
          scale: personalScale,
          opacity: personalOpacity,
        }}
        className="absolute inset-0 z-10 flex flex-col pointer-events-none"
      >
        <div className="relative w-full h-full pointer-events-auto">
          {/* Desktop Files Icons */}
          <div className="p-8 grid grid-flow-col grid-rows-6 gap-8 items-start justify-start w-fit">
            <DesktopIcon 
              label="Neural Vault" 
              icon={<Shield size={24} />} 
              colorClass="from-indigo-600 to-blue-500" 
              onClick={() => toggleWindow('vault')} 
            />
            <DesktopIcon 
              label="OS Kernel" 
              icon={<Cpu size={24} />} 
              colorClass="from-orange-600 to-red-500" 
              onClick={() => toggleWindow('kernel')} 
            />
            {nativeFiles.map((file, idx) => (
              <DesktopIcon 
                key={idx}
                label={file.name}
                icon={file.isDirectory ? <Folder size={24} /> : <FileText size={24} />}
                colorClass={file.isDirectory ? "from-yellow-600 to-orange-500" : "from-blue-400 to-blue-600"}
                onClick={() => {
                  if (!file.isDirectory) toggleWindow('terminal');
                }}
              />
            ))}
          </div>

          {/* Desktop Widgets */}
          <div className="absolute top-20 right-8 space-y-6 pointer-events-auto">
             <div className="glass-dark p-6 rounded-[2.5rem] border border-white/5 w-64 backdrop-blur-3xl shadow-xl">
                <div className="flex justify-between items-start mb-6">
                   <div className="text-4xl font-black text-white">{time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false })}</div>
                   <div className="text-[10px] font-black text-celestial-saturn uppercase tracking-widest bg-celestial-saturn/10 px-2 py-1 rounded">Live</div>
                </div>
                <div className="space-y-4">
                   <div className="flex justify-between items-center text-[10px] font-black text-white/30 uppercase tracking-[0.2em]">
                      <span>Mesh Connectivity</span>
                      <span className="text-green-400">Excellent</span>
                   </div>
                   <div className="flex gap-1 h-1">
                      {[1,1,1,1,1,1,0,0,0,0].map((v, i) => (
                        <div key={i} className={`flex-1 rounded-full ${v ? 'bg-celestial-saturn' : 'bg-white/5'}`} />
                      ))}
                   </div>
                </div>
             </div>

             <div className="glass-dark p-6 rounded-[2.5rem] border border-white/5 w-64 backdrop-blur-3xl shadow-xl overflow-hidden relative group">
                <div className="absolute inset-0 bg-gradient-to-br from-purple-500/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
                <div className="relative z-10 flex items-center gap-4">
                   <div className="w-12 h-12 rounded-2xl bg-white/5 flex items-center justify-center text-purple-400">
                      <Music size={24} />
                   </div>
                   <div>
                      <div className="text-[10px] font-black text-white/40 uppercase tracking-widest">Now Streaming</div>
                      <div className="text-sm font-bold text-white truncate w-32">Stellar Drift v2.4</div>
                   </div>
                </div>
             </div>
          </div>

          {/* Removed Neural Integrity Monitor as requested for manual removal */}

          {/* Central Interactive Entity */}
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
        <motion.div 
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          transition={{ duration: 2, ease: "easeOut" }}
          className="relative pointer-events-auto scale-75 opacity-90 transition-all"
        >
          <div className="relative flex flex-col items-center">
            <LocalAgentSphere 
              t={t} 
              sentiment={sphereSentiment}
              callState={callState}
              audioLevel={audioLevel}
              highPerformance={isTauri}
              isWallpaperMode={isWallpaperMode}
              onMessage={(text) => {
                setTerminalOutput(prev => [...prev, `[Voice Input]: ${text}`]);
                systemService.runCommand(text).then(res => {
                  setTerminalOutput(prev => [...prev, res.output]);
                });
              }} 
            />

            <div className="flex flex-col items-center gap-4 mt-8">
              <div className="flex items-center gap-3">
                <div className="relative">
                  <button
                    onClick={() => setShowVoicePicker(!showVoicePicker)}
                    className="h-10 px-4 rounded-xl bg-white/5 border border-white/10 text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-2 hover:bg-white/10 hover:text-white transition-all shadow-xl"
                  >
                    {voices.find(v => v.voiceId === selectedVoiceId)?.name || 'Nexus Voice'}
                    <ChevronDown size={12} />
                  </button>
                  
                  <AnimatePresence>
                    {showVoicePicker && (
                      <motion.div
                        initial={{ opacity: 0, y: 10 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: 10 }}
                        className="absolute bottom-full left-0 mb-2 w-48 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-2 z-50 shadow-2xl max-h-64 overflow-y-auto custom-scrollbar"
                      >
                        {voices.map(v => (
                          <button
                            key={v.voiceId}
                            onClick={() => {
                              setSelectedVoiceId(v.voiceId);
                              setShowVoicePicker(false);
                            }}
                            className={`w-full text-left p-2 rounded-xl text-[10px] font-bold uppercase transition-all ${
                              selectedVoiceId === v.voiceId ? 'bg-celestial-saturn text-black' : 'text-white/60 hover:bg-white/5 hover:text-white'
                            }`}
                          >
                            {v.name}
                          </button>
                        ))}
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>

                <VoiceCallButton 
                  callState={callState}
                  audioLevel={audioLevel}
                  onStart={() => startCall(selectedVoiceId)}
                  onEnd={endCall}
                  hasVoice={voices.length > 0}
                />

                {isTauri && (
                  <button
                    onClick={toggleWallpaperMode}
                    className={`h-10 px-4 rounded-xl border transition-all flex items-center gap-2 text-[10px] font-black uppercase tracking-widest shadow-xl ${
                      isWallpaperMode 
                        ? 'bg-celestial-saturn text-black border-celestial-saturn' 
                        : 'bg-white/5 border-white/10 text-white/40 hover:bg-white/10 hover:text-white'
                    }`}
                  >
                    <Zap size={14} className={isWallpaperMode ? 'animate-pulse' : ''} />
                    {isWallpaperMode ? 'Fusion On' : 'Wallpaper Mode'}
                  </button>
                )}
              </div>

              <motion.div 
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="whitespace-nowrap"
              >
                 <div className="flex flex-col items-center gap-1 group">
                   <span className="text-[10px] font-black tracking-[0.4em] text-white/40 uppercase group-hover:text-celestial-saturn transition-colors">
                     {callState === 'idle' ? 'Lumi Neural Core' : `${callState.toUpperCase()} SESSION`}
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
                </div>
              </motion.div>
            </div>
          </div>
        </motion.div>
      </div>

      {/* Desktop Grid & Widgets */}
      <div className="relative z-10 w-full h-full p-8 md:p-12 lg:p-16 overflow-y-auto custom-scrollbar pt-20">
        <div className="flex flex-col xl:flex-row justify-between items-start gap-12">
            <div className="desktop-grid !h-auto !p-0 !grid-cols-[repeat(auto-fill,minmax(110px,1fr))] max-w-2xl flex-1 w-full">
              {appIcons.map((app) => (
                <DesktopIcon 
                  key={app.id}
                  label={app.label}
                  icon={app.icon}
                  colorClass={app.color}
                  onClick={() => toggleWindow(app.id)}
                />
              ))}
            </div>

            <div className="flex flex-col gap-6 w-full lg:w-96">
              {/* Modern Widgets Grid */}
              <div className="grid grid-cols-2 gap-4">
                 <GlassCard className="p-4 rounded-[2rem] border-white/5 bg-black/20 flex flex-col items-center justify-center text-center gap-2">
                    <Clock size={20} className="text-celestial-saturn" />
                    <div className="text-xl font-black text-white/80">
                       {time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </div>
                    <span className="text-[8px] font-bold text-white/30 uppercase tracking-widest">{time.toLocaleDateString(undefined, { weekday: 'long' })}</span>
                 </GlassCard>
                 <GlassCard className="p-4 rounded-[2rem] border-white/5 bg-black/20 flex flex-col items-center justify-center text-center gap-2">
                    <div className="text-celestial-glow"><Battery size={20} /></div>
                    <div className="text-xl font-black text-white/80">98%</div>
                    <span className="text-[8px] font-bold text-white/30 uppercase tracking-widest">Optimized</span>
                 </GlassCard>
              </div>

              <GlassCard className="p-6 rounded-[2.5rem] space-y-4 border-white/5 bg-black/30 backdrop-blur-3xl">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-white/30 flex items-center gap-2">
                    <Activity size={12} /> Neural Synthesis
                  </h4>
                  <div className="w-2 h-2 rounded-full bg-green-500 shadow-[0_0_10px_#22c55e]" />
                </div>
                <div className="space-y-4">
                    <div className="space-y-2">
                      <div className="flex justify-between items-center text-[10px] font-bold">
                        <span className="text-white/40">Collective IQ Sync</span>
                        <span className="text-celestial-saturn">0.89 TFLOPS</span>
                      </div>
                      <div className="w-full h-1.5 bg-white/5 rounded-full overflow-hidden">
                        <motion.div 
                          initial={{ width: 0 }}
                          animate={{ width: '85%' }}
                          className="h-full bg-gradient-to-r from-celestial-mars to-celestial-saturn" 
                        />
                      </div>
                    </div>
                    {systemInfo && (
                      <>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-white/40">Node Host</span>
                          <span className="text-white/80 font-mono text-[10px]">{systemInfo.hostname}</span>
                        </div>
                        <div className="flex justify-between items-center text-xs">
                          <span className="text-white/40">MEM Index</span>
                          <span className="text-white/80 font-mono text-[10px]">{(systemInfo.freeMemory / 1024 / 1024 / 1024).toFixed(1)} GB Free</span>
                        </div>
                      </>
                    )}
                </div>
              </GlassCard>

              {nativeFiles.length > 0 && (
                <GlassCard className="p-6 w-full md:w-80 rounded-3xl space-y-4 border-white/5 bg-black/10">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-white/20">Native Vault Entry</h4>
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

              <GlassCard className="p-6 rounded-[2.5rem] space-y-4 border-white/5 bg-black/40">
                <div className="flex items-center justify-between">
                  <h4 className="text-[10px] font-black uppercase tracking-widest text-white/30 flex items-center gap-2">
                    <Cpu size={12} /> Root Terminal
                  </h4>
                  <button className="text-[10px] text-celestial-saturn hover:underline" onClick={() => setTerminalOutput(['Session Reset...'])}>Clear</button>
                </div>
                <div className="bg-black/60 rounded-2xl p-4 font-mono text-[10px] h-48 overflow-y-auto custom-scrollbar space-y-1.5 border border-white/5 shadow-inner">
                  {terminalOutput.map((line, i) => (
                    <div key={i} className="text-white/60 leading-relaxed">
                      {line.startsWith('>') ? <span className="text-celestial-saturn font-bold mr-2">{line}</span> : line}
                    </div>
                  ))}
                </div>
                <form onSubmit={handleTerminalSubmit} className="relative mt-2">
                  <input 
                    type="text"
                    value={terminalInput}
                    onChange={(e) => setTerminalInput(e.target.value)}
                    placeholder="Type a command..."
                    className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-3 text-[11px] font-mono text-celestial-saturn focus:outline-none focus:border-celestial-saturn/50 transition-all placeholder:text-white/10"
                  />
                </form>
              </GlassCard>
            </div>
        </div>
      </div>

      {/* OS Windows Container */}
      <div className="absolute inset-0 z-20 pointer-events-none">
        <AnimatePresence>
          {openWindows.map(windowId => (
            <div key={windowId} className="pointer-events-auto h-full w-full absolute inset-0">
              <OSWindow
                id={windowId}
                title={appIcons.find(a => a.id === windowId)?.label || windowId}
                icon={appIcons.find(a => a.id === windowId)?.icon}
                isActive={focusedWindow === windowId}
                isMinimized={minimizedWindows.includes(windowId)}
                onFocus={(id) => setFocusedWindow(id)}
                onMinimize={(id) => setMinimizedWindows(prev => [...prev, id])}
                onClose={() => closeWindow(windowId)}
                colorClass={appIcons.find(a => a.id === windowId)?.color}
                width={windowId === 'settings' ? (settingsSizes[settingsSection]?.w || '800px') : windowId === 'music' ? '800px' : windowId === 'claude' ? '800px' : windowId === 'fs' ? '1000px' : windowId === 'kernel' ? '900px' : '900px'}
                height={windowId === 'settings' ? (settingsSizes[settingsSection]?.h || '600px') : windowId === 'music' ? '600px' : windowId === 'claude' ? '600px' : windowId === 'fs' ? '700px' : windowId === 'kernel' ? '700px' : '700px'}
                t={t}
              >
                <div className="p-8 h-full">
                  {windowId === 'fs' ? (
                    <NeuralFileManager t={t} />
                  ) : windowId === 'kernel' ? (
                    <KernelMonitorApp t={t} />
                  ) : windowId === 'settings' ? (
                    <Settings t={t} lang={lang} setLang={setLang} activeSection={settingsSection} onSectionChange={setSettingsSection} />
                  ) : windowId === 'music' ? (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-12 animate-in zoom-in-95 duration-500">
                       <div className="relative">
                          <Disc size={120} className="text-celestial-saturn animate-[spin_8s_linear_infinite]" />
                          <Headphones size={40} className="absolute -bottom-4 -right-4 text-white p-2 bg-black rounded-full" />
                       </div>
                       <div className="space-y-4">
                          <h2 className="text-5xl font-black uppercase tracking-tighter text-white">Lumi Music Lab</h2>
                          <p className="text-white/40 max-w-md mx-auto italic">Synchronize your frequencies. Neural integration with streaming providers is active in standby mode.</p>
                       </div>
                       <div className="flex gap-4">
                          <div className="px-6 py-3 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[#1DB954]">Spotify API</div>
                          <div className="px-6 py-3 bg-white/5 border border-white/10 rounded-2xl text-[10px] font-black uppercase tracking-widest text-[#FA243C]">Apple Music</div>
                       </div>
                       <button onClick={() => toggleWindow('settings')} className="bg-celestial-saturn text-black font-black px-12 py-5 rounded-2xl hover:scale-105 active:scale-95 transition-all">
                          Link Media Keys
                       </button>
                    </div>
                  ) : windowId === 'claude' ? (
                    <div className="flex flex-col items-center justify-center h-full text-center space-y-12 animate-in zoom-in-95 duration-500">
                       <MessagesSquare size={120} className="text-orange-500 animate-pulse" />
                       <div className="space-y-4">
                          <h2 className="text-5xl font-black uppercase tracking-tighter text-white">Claude Link</h2>
                          <p className="text-white/40 max-w-md mx-auto italic">Unlock Anthropic's reasoning core. Use your own Claude 3.5 API key for prioritized kernel access.</p>
                       </div>
                       <button onClick={() => toggleWindow('settings')} className="bg-orange-500 text-white font-black px-12 py-5 rounded-2xl hover:scale-105 active:scale-95 transition-all shadow-[0_0_50px_rgba(249,115,22,0.3)]">
                          Configure Claude API Key
                       </button>
                    </div>
                  ) : renderTabContent(windowId)}
                </div>
              </OSWindow>
            </div>
          ))}
        </AnimatePresence>
      </div>

        </div>
      </motion.div>

    </div>
  );
}
