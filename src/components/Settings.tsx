import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield,
  Globe,
  Cpu,
  Database,
  Radio,
  Key,
  BrainCircuit,
  ChevronDown,
  Music,
  Headphones,
  Volume2,
  MessagesSquare,
  Sparkle,
  Zap,
  Camera,
  Mic,
  CheckCircle,
  AlertCircle,
  LogOut
} from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';

import { usePlatform } from '@/hooks/usePlatform';
import { DeviceSyncCenter } from './DeviceSyncCenter';
import { useApp } from '@/contexts/AppContext';
import { VoiceForge } from './VoiceForge';
import { MCPSettings } from './MCPSettings';
import { RemoteMCPSettings } from './RemoteMCPSettings';
import { FeishuSettings } from './FeishuSettings';

function buildSidebarGroups(t: any) {
  return [
    {
      label: t.sidebarCore || 'Core',
      items: [
        { id: 'general', label: t.sidebarGeneral || 'General', icon: <Globe size={16} /> },
        { id: 'personalization', label: t.personalization || 'Personalization', icon: <Sparkle size={16} /> },
      ],
    },
    {
      label: t.sidebarAiNeural || 'AI & Neural',
      items: [
        { id: 'neural', label: t.neuralEngine || 'Neural Engine', icon: <BrainCircuit size={16} /> },
        { id: 'api', label: t.sidebarApiMatrix || 'API Matrix', icon: <Key size={16} /> },
      ],
    },
    {
      label: t.sidebarVoiceMedia || 'Voice & Media',
      items: [
        { id: 'voice', label: t.voiceForge || 'Voice Forge', icon: <Mic size={16} /> },
        { id: 'music', label: t.sidebarMediaServices || 'Media Services', icon: <Music size={16} /> },
      ],
    },
    {
      label: t.sidebarSystem || 'System',
      items: [
        { id: 'sync', label: t.sidebarSyncHub || 'Sync Hub', icon: <Radio size={16} /> },
        { id: 'security', label: t.settings || 'Security', icon: <Shield size={16} /> },
        { id: 'hardware', label: t.settingsHardware || 'Hardware', icon: <Camera size={16} /> },
        { id: 'mcp', label: t.settingsMCP || 'MCP', icon: <Cpu size={16} /> },
        { id: 'remote-mcp', label: t.remoteMCPSidebar || 'Remote MCP', icon: <Globe size={16} /> },
        { id: 'messaging', label: t.messaging || 'Messaging', icon: <MessagesSquare size={16} /> },
      ],
    },
  ];
}

export function Settings({
  t,
  lang,
  setLang,
  theme,
  setTheme,
  activeSection = 'general',
  onSectionChange
}: {
  t: any;
  lang: 'en' | 'zh';
  setLang: (l: 'en' | 'zh') => void;
  theme?: string;
  setTheme?: (theme: string) => void;
  activeSection?: string;
  onSectionChange?: (section: string) => void;
}) {
  const { platform, isElectron } = usePlatform();
  const { aiConfig, updateAIConfig, logout } = useApp();
  const [providerStatus, setProviderStatus] = useState<Record<string, { available: boolean; model: string }>>({});
  const [collapsedGroups, setCollapsedGroups] = useState<Set<string>>(new Set());

  useEffect(() => {
    fetch('/api/llm/providers')
      .then(r => r.json())
      .then(d => setProviderStatus(d.providers || {}))
      .catch(() => toast.error(t.failedToLoadProviderStatus || 'Failed to load provider status'));
  }, []);

  const handleSectionChange = (section: string) => {
    if (onSectionChange) onSectionChange(section);
  };

  const toggleGroup = (label: string) => {
    setCollapsedGroups(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const renderContent = (section: string) => {
    switch (section) {
      case 'general':
        return (
          <div className="space-y-8">
            <SettingsSection title={t.language || 'Language'} icon={<Globe size={18} className="text-blue-400" />}>
              <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/5 space-y-6">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/50 block mb-4">{t.selectLanguage}</label>
                  <div className="grid grid-cols-2 gap-4">
                    <button onClick={() => setLang('en')}
                      className={`p-6 rounded-2xl border text-sm font-bold transition-all flex items-center justify-center gap-3 ${lang === 'en' ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.2)]' : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10'}`}>
                      {t.englishUS || 'English (US)'}
                    </button>
                    <button onClick={() => setLang('zh')}
                      className={`p-6 rounded-2xl border text-sm font-bold transition-all flex items-center justify-center gap-3 ${lang === 'zh' ? 'bg-white text-black border-white shadow-[0_0_20px_rgba(255,255,255,0.2)]' : 'bg-white/5 border-white/5 text-white/40 hover:bg-white/10'}`}>
                      中文 (简体)
                    </button>
                  </div>
                </div>
              </div>
            </SettingsSection>
          </div>
        );
      case 'personalization':
        return (
          <div className="space-y-8">
            <SettingsSection title={t.appearanceThemes || "Appearance & Themes"} icon={<Sparkle size={18} className="text-celestial-saturn" />}>
              <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/5 space-y-8">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-widest text-white/50 block mb-4">{t.selectMatrixVariant || "Select Global Matrix Variant"}</label>
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { id: 'celestial', label: t.celestial || 'Celestial', color: 'from-orange-400 to-red-500' },
                      { id: 'nebula', label: t.nebula || 'Nebula', color: 'from-indigo-500 to-purple-600' },
                      { id: 'cyber', label: t.cyber || 'Cyber', color: 'from-emerald-400 to-teal-600' }
                    ].map(themeItem => (
                      <button key={themeItem.id} onClick={() => setTheme && setTheme(themeItem.id)}
                        className={`flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all text-center ${theme === themeItem.id ? 'bg-white/10 border-white/20 shadow-lg' : 'border-white/5 hover:bg-white/5'}`}>
                        <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${themeItem.color} shadow-lg ${theme === themeItem.id ? 'ring-2 ring-white/50 ring-offset-2 ring-offset-black' : ''}`} />
                        <span className={`text-[10px] font-black uppercase tracking-widest ${theme === themeItem.id ? 'text-white' : 'text-white/60'}`}>{themeItem.label}</span>
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </SettingsSection>
          </div>
        );
      case 'neural':
        return (
          <div className="space-y-8">
            <SettingsSection title={t.agentFramework || "Agent Framework (Lumi Protocol)"} icon={<BrainCircuit size={18} className="text-celestial-saturn" />}>
              <div className="space-y-6">
                <div className="grid grid-cols-2 gap-4">
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-2">
                    <div className="flex justify-between items-center text-[10px] font-black uppercase text-white/40 tracking-widest"><span>{t.neuralEngine || "Neural Engine"}</span><span className="text-green-500">{t.neuralEngineActive || "Active"}</span></div>
                    <div className="text-xs font-bold text-white/80">{t.autonomousCognitiveLoop || "Autonomous Cognitive Loop"}</div>
                    <p className="text-[10px] text-white/30">{t.autonomousCognitiveLoopDesc || "Allows agents to proactively execute tasks based on context awareness."}</p>
                  </div>
                  <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-2">
                    <div className="flex justify-between items-center text-[10px] font-black uppercase text-white/40 tracking-widest"><span>{t.memoryMesh || "Memory Mesh"}</span><span className="text-blue-500">{t.memoryMeshSyncing || "Syncing"}</span></div>
                    <div className="text-xs font-bold text-white/80">{t.persistentLongTermRecall || "Persistent Long-term Recall"}</div>
                    <p className="text-[10px] text-white/30">{t.persistentLongTermRecallDesc || "Enables cross-session memory shared across all identified node devices."}</p>
                  </div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-black uppercase text-white/30 ml-2">{t.primaryReasoningBrain || "Primary Reasoning Brain"}</label>
                  <div className="relative">
                    <select value={aiConfig.provider} onChange={(e) => updateAIConfig({ provider: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm font-bold appearance-none cursor-pointer focus:border-celestial-saturn/50 outline-none">
                      <option value="deepseek">DeepSeek</option>
                      <option value="qwen">Qwen (DashScope)</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic Claude</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/20" />
                  </div>
                  <p className="text-[9px] text-white/20 px-2">Active model: <span className="text-white/40 font-mono">{aiConfig.model}</span> — change per provider in API Matrix.</p>
                </div>
              </div>
            </SettingsSection>
          </div>
        );
      case 'voice':
        return <VoiceForge t={t} />;
      case 'api':
        return <ApiMatrixPage t={t} providerStatus={providerStatus} />;
      case 'music':
        return (
          <div className="space-y-8">
            <SettingsSection title={t.audioOutput || "Audio & Voice Output"} icon={<Music size={18} className="text-celestial-saturn" />}>
              <div className="space-y-4">
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-white/80">{t.ttsEngine || 'TTS Engine'}</span>
                  </div>
                  <p className="text-[10px] text-white/40">
                    {t.ttsEngineDesc || 'GPT-SoVITS + DashScope CosyVoice configured. Voice synthesis ready for all agents.'}
                  </p>
                </div>
                <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
                  <div className="flex items-center gap-2">
                    <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                    <span className="text-xs font-bold text-white/80">{t.sttEngine || 'STT Engine'}</span>
                  </div>
                  <p className="text-[10px] text-white/40">
                    {t.sttEngineDesc || 'Deepgram speech recognition active. Real-time transcription available.'}
                  </p>
                </div>
                <button
                  onClick={() => onSectionChange?.('voice')}
                  className="w-full p-4 rounded-2xl bg-celestial-saturn/5 border border-celestial-saturn/20 hover:bg-celestial-saturn/10 transition-all text-left"
                >
                  <span className="text-[10px] font-bold text-celestial-saturn uppercase tracking-widest">
                    {t.voiceSettings || 'Voice Settings'} →
                  </span>
                  <p className="text-[10px] text-white/30 mt-1">{t.voiceSettingsDesc || 'Configure speech models, voices, and audio devices.'}</p>
                </button>
              </div>
            </SettingsSection>
          </div>
        );
      case 'sync':
        return (
          <div className="space-y-8">
            <SettingsSection title={t.distributedIntelligenceHub || "Distributed Intelligence Hub"} icon={<Radio size={18} className="text-celestial-saturn" />}>
              <DeviceSyncCenter t={t} />
            </SettingsSection>
          </div>
        );
      case 'security':
        return (
          <div className="space-y-8">
            <SettingsSection title={t.privacySecurity || "Privacy & Security"} icon={<Shield size={18} className="text-celestial-mars" />}>
              <SettingsItem label={t.localEncryption || "Local Encryption"} desc={t.localEncryptionDesc || "Encrypt all Agent data stored on your local disk."} active t={t} />
              <SettingsItem label={t.anonymousMode || "Anonymous Mode"} desc={t.anonymousModeDesc || "Hide your node ID from the collaborative network."} t={t} />
              <SettingsItem label={t.biometricLock || "Biometric Lock"} desc={t.biometricLockDesc || "Require fingerprint or face ID for Agent generation."} t={t} />
            </SettingsSection>
            {isElectron && (
              <SettingsSection title={t.desktopNodeRuntime || "Desktop Node Runtime"} icon={<Database size={18} className="text-celestial-jupiter" />}>
                <div className="p-4 bg-celestial-jupiter/10 rounded-2xl border border-celestial-jupiter/20 space-y-2 mb-4">
                  <div className="flex justify-between items-center text-sm"><span className="text-white/60">{t.platform || "Platform"}:</span><span className="font-mono text-celestial-jupiter uppercase">{platform}</span></div>
                  <div className="flex justify-between items-center text-sm"><span className="text-white/60">{t.nodeStatus || "Node Status"}:</span><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /><span className="font-bold text-green-500 underline decoration-green-500/20 underline-offset-4">{t.nodeActive || "ACTIVE"}</span></div></div>
                </div>
                <SettingsItem label={t.hardwareAcceleration || "Hardware Acceleration"} desc={t.hardwareAccelerationDesc || "Use GPU for neural core inference."} active t={t} />
                <SettingsItem label={t.systemTrayMode || "System Tray Mode"} desc={t.systemTrayModeDesc || "Keep Lumi running in the background."} active t={t} />
              </SettingsSection>
            )}
          </div>
        );
      case 'hardware':
        return <HardwareSettings t={t} />;
      case 'mcp':
        return <MCPSettings t={t} />;
      case 'remote-mcp':
        return <RemoteMCPSettings t={t} />;
      case 'messaging':
        return <FeishuSettings t={t} />;
      default:
        return null;
    }
  };

  return (
    <div className="flex h-full bg-black/40 backdrop-blur-3xl overflow-hidden border border-white/10 shadow-2xl rounded-[2.5rem]">
      {/* Sidebar — fixed height, scrollable */}
      <div className="w-56 flex-shrink-0 bg-white/[0.03] border-r border-white/5 flex flex-col min-h-0">
        <div className="px-4 pt-5 pb-3">
          <h2 className="text-xs font-black uppercase tracking-widest text-white/60">{t.settings || 'Settings'}</h2>
        </div>
        <div className="flex-1 px-2 pb-3 space-y-0.5 overflow-y-auto custom-scrollbar min-h-0">
          {buildSidebarGroups(t).map(group => {
            const isCollapsed = collapsedGroups.has(group.label);
            const hasActiveItem = group.items.some(item => item.id === activeSection);
            return (
              <div key={group.label} className="mb-1">
                <button
                  onClick={() => toggleGroup(group.label)}
                  className="w-full flex items-center gap-1 px-2 py-1 text-[8px] font-black uppercase tracking-widest text-white/20 hover:text-white/40 transition-colors"
                >
                  <ChevronDown size={9} className={`transition-transform ${isCollapsed ? '-rotate-90' : ''}`} />
                  {group.label}
                </button>
                {!isCollapsed && (
                  <div className="space-y-0.5">
                    {group.items.map(item => (
                      <SidebarItem
                        key={item.id}
                        active={activeSection === item.id}
                        onClick={() => handleSectionChange(item.id)}
                        icon={item.icon}
                        label={item.label}
                      />
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="px-2 pb-4 pt-2 border-t border-white/5">
          <button
            onClick={async () => {
              try {
                await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' });
                localStorage.removeItem('lumi_auth_token');
                window.location.reload();
              } catch {
                localStorage.removeItem('lumi_auth_token');
                window.location.reload();
              }
            }}
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-[11px] font-bold text-red-400/60 hover:text-red-300 hover:bg-red-500/10 transition-all"
          >
            <LogOut size={14} />
            Sign Out
          </button>
        </div>
      </div>

      {/* Content — absolute positioned to prevent layout shift during transitions */}
      <div className="flex-1 min-w-0 relative overflow-hidden">
        <div className="absolute inset-0 overflow-y-auto custom-scrollbar p-8">
          <AnimatePresence mode="popLayout">
            <motion.div
              key={activeSection}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.1 }}
            >
              {renderContent(activeSection)}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function HardwareSettings({ t }: { t: any }) {
  const [micStatus, setMicStatus] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [camStatus, setCamStatus] = useState<'prompt' | 'granted' | 'denied'>('prompt');
  const [isRequesting, setIsRequesting] = useState(false);

  const requestPermissions = async (type: 'mic' | 'camera') => {
    setIsRequesting(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: type === 'mic', 
        video: type === 'camera' 
      });
      // Immediately stop the stream after getting permission
      stream.getTracks().forEach(track => track.stop());
      
      if (type === 'mic') setMicStatus('granted');
      if (type === 'camera') setCamStatus('granted');
      
      toast.success(type === 'mic' ? (t.micAccessSynced || 'Microphone access synchronized.') : (t.camAccessSynced || 'Camera access synchronized.'));
    } catch (err: any) {
      if (type === 'mic') setMicStatus('denied');
      if (type === 'camera') setCamStatus('denied');
      toast.error(`${t.sensorLinkFailed || 'Sensor link failed'}: ${err.message}`);
    } finally {
      setIsRequesting(false);
    }
  };

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <SettingsSection title={t.hardwareSensorNetwork || "Hardware Sensor Network"} icon={<Camera size={18} className="text-celestial-saturn" />}>
        <p className="text-sm text-white/40 mb-8 max-w-xl">
          {t.hardwareSensorNetworkDesc || "LumiAI requires access to your physical sensors for real-world contextual awareness and biometric verification. All data is processed locally on your node."}
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
          <HardwareCapCard
            icon={<Mic size={24} />}
            label={t.audioReceptors || "Audio Receptors"}
            desc={t.audioReceptorsDesc || "Enable neural speech recognition and voice cloning."}
            status={micStatus}
            onEnable={() => requestPermissions('mic')}
            disabled={isRequesting}
            t={t}
          />
          <HardwareCapCard
            icon={<Camera size={24} />}
            label={t.visualCortex || "Visual Cortex"}
            desc={t.visualCortexDesc || "Enable multimodal vision and gesture control."}
            status={camStatus}
            onEnable={() => requestPermissions('camera')}
            disabled={isRequesting}
            t={t}
          />
        </div>

        <div className="mt-12 p-6 glass-dark rounded-[2rem] border border-white/5 space-y-4">
           <div className="flex items-center gap-3">
              <Shield className="text-celestial-saturn" size={20} />
              <h4 className="text-sm font-bold uppercase tracking-tight text-white">{t.privacyAssurance || "Privacy Assurance"}</h4>
           </div>
           <p className="text-[11px] text-white/30 leading-relaxed italic">
             {t.privacyAssuranceText || "Our protocol strictly enforces local-only processing. Your visual and auditory data streams are never transmitted outside your sovereign mesh node without direct user-signed override."}
           </p>
        </div>
      </SettingsSection>
    </div>
  );
}

function HardwareCapCard({ icon, label, desc, status, onEnable, disabled, t }: {
  icon: React.ReactNode,
  label: string,
  desc: string,
  status: 'prompt' | 'granted' | 'denied',
  onEnable: () => void,
  disabled: boolean,
  t: any
}) {
  return (
    <div className="p-8 bg-white/5 rounded-[2.5rem] border border-white/5 flex flex-col justify-between gap-6 group hover:border-white/10 transition-all">
      <div className="space-y-4">
        <div className={`w-14 h-14 rounded-2xl flex items-center justify-center transition-all ${
          status === 'granted' ? 'bg-celestial-saturn text-black' : 'bg-white/5 text-white/40'
        }`}>
          {icon}
        </div>
        <div>
          <h4 className="text-lg font-bold text-white">{label}</h4>
          <p className="text-xs text-white/40 leading-relaxed mt-1">{desc}</p>
        </div>
      </div>

      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
           {status === 'granted' ? (
             <div className="flex items-center gap-1.5 text-celestial-saturn text-[10px] font-black uppercase tracking-widest">
               <CheckCircle size={12} />
               {t.linked || "Linked"}
             </div>
           ) : status === 'denied' ? (
             <div className="flex items-center gap-1.5 text-red-500 text-[10px] font-black uppercase tracking-widest">
               <AlertCircle size={12} />
               {t.blocked || "Blocked"}
             </div>
           ) : (
             <div className="text-[10px] font-black uppercase tracking-widest text-white/20">{t.awaitingAccess || "Awaiting Access"}</div>
           )}
        </div>

        {status !== 'granted' && (
          <Button
            onClick={onEnable}
            disabled={disabled}
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-[10px] font-black uppercase tracking-widest px-4 h-9 rounded-xl"
          >
            {status === 'denied' ? (t.retryLink || 'Retry Link') : (t.authorize || 'Authorize')}
          </Button>
        )}
      </div>
    </div>
  );
}

function SidebarItem({ active, onClick, icon, label }: { active: boolean, onClick: () => void, icon: React.ReactNode, label: string }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors duration-150 w-full text-left relative ${active ? 'bg-white/10 text-white' : 'text-white/30 hover:bg-white/5 hover:text-white/50'}`}
    >
      <div className={`flex-shrink-0 w-4 h-4 flex items-center justify-center ${active ? 'text-celestial-saturn' : 'text-current'}`}>{icon}</div>
      <span className="text-[9px] font-bold uppercase tracking-tight truncate">{label}</span>
      {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-celestial-saturn rounded-full" />}
    </button>
  );
}

function LLMProviderRow({ icon, label, providerId, models, placeholder, disabled = false, serverKey, t }: {
  icon: React.ReactNode; label: string; providerId: string; models: string[];
  placeholder: string; disabled?: boolean; serverKey: string; t?: any;
}) {
  const { aiConfig, updateAIConfig, logout } = useApp();
  const [keyValue, setKeyValue] = useState(() => {
    try { return localStorage.getItem(`lumi_${providerId}_key`) || ''; } catch { return ''; }
  });
  const [saved, setSaved] = useState(false);
  const [serverConfigured, setServerConfigured] = useState(false);
  const [showKey, setShowKey] = useState(false);

  const savedModels = (() => {
    try { return JSON.parse(localStorage.getItem('lumi_llm_models') || '{}'); } catch { return {}; }
  })();
  const [model, setModel] = useState(() => {
    return savedModels[providerId] || models[0];
  });

  useEffect(() => {
    fetch('/api/settings/keys')
      .then(r => r.json())
      .then(data => setServerConfigured(!!data[serverKey]))
      .catch(() => {});
  }, [serverKey]);

  const handleRemoveKey = () => {
    localStorage.removeItem(`lumi_${providerId}_key`);
    fetch('/api/settings/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { [serverKey]: '' } }),
    }).then(() => {
      setServerConfigured(false);
      setKeyValue('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }).catch(() => toast.error('Failed to remove key'));
  };

  const handleSaveKey = () => {
    if (!keyValue.trim()) return;
    localStorage.setItem(`lumi_${providerId}_key`, keyValue.trim());
    fetch('/api/settings/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { [serverKey]: keyValue.trim() } }),
    }).then(() => setServerConfigured(true))
      .catch(() => toast.error('Failed to save key'));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const syncToServer = (models: Record<string, string>) => {
    fetch('/api/preferences/llm', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider: aiConfig.provider, models }),
      credentials: 'include',
    }).catch(() => {});
  };

  const handleModelChange = (m: string) => {
    setModel(m);
    const allModels = (() => {
      try { return JSON.parse(localStorage.getItem('lumi_llm_models') || '{}'); } catch { return {}; }
    })();
    allModels[providerId] = m;
    localStorage.setItem('lumi_llm_models', JSON.stringify(allModels));
    syncToServer(allModels);
    if (aiConfig.provider === providerId) {
      updateAIConfig({ model: m });
    }
  };

  return (
    <div className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-white/5 rounded-lg">{icon}</div>
        <label className="text-[10px] font-black uppercase tracking-widest text-white/50">{label}</label>
        {serverConfigured && <span className="text-[8px] px-2 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full font-bold">CONFIGURED</span>}
        {saved && <CheckCircle size={14} className="text-green-400 ml-auto" />}
      </div>
      <div className="flex gap-3">
        <div className="relative flex-1">
          <input
            disabled={disabled}
            type={showKey ? 'text' : 'password'}
            value={keyValue}
            onChange={e => setKeyValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSaveKey()}
            placeholder={serverConfigured && !keyValue ? 'Key saved on server' : placeholder}
            className="w-full bg-black/40 border border-white/10 rounded-xl p-4 pr-16 text-white font-mono text-sm outline-none focus:border-celestial-saturn/50 transition-colors disabled:opacity-50"
          />
          <div className="absolute right-2 top-2 flex gap-1">
            <button type="button" onClick={() => setShowKey(!showKey)}
              className="h-10 px-2 bg-white/5 hover:bg-white/10 text-[8px] font-bold uppercase border border-white/5 rounded-lg">
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>
        <Button
          onClick={handleSaveKey}
          disabled={disabled || !keyValue.trim()}
          className="h-[56px] px-4 bg-celestial-saturn text-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-celestial-saturn/90 transition-all"
        >
          {t?.save || 'Save'}
        </Button>
        <Button
          onClick={handleRemoveKey}
          disabled={disabled || (!keyValue && !serverConfigured)}
          className="h-[56px] px-4 bg-red-500/10 border border-red-500/20 rounded-xl text-[10px] font-black uppercase tracking-widest text-red-400 hover:bg-red-500/20 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
        >
          {t?.remove || 'Remove'}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-[9px] font-black uppercase text-white/30 tracking-wider whitespace-nowrap">Model</label>
        <input
          type="text"
          value={model}
          onChange={e => handleModelChange(e.target.value)}
          list={`models-${providerId}`}
          placeholder={models[0]}
          className="flex-1 bg-black/40 border border-white/10 rounded-xl px-3 py-2 text-xs font-mono font-bold outline-none focus:border-celestial-saturn/50"
        />
        <datalist id={`models-${providerId}`}>
          {models.map(m => <option key={m} value={m} />)}
        </datalist>
        {aiConfig.provider === providerId && (
          <span className="text-[8px] px-2 py-0.5 bg-celestial-saturn/10 border border-celestial-saturn/20 text-celestial-saturn rounded-full font-bold whitespace-nowrap">ACTIVE</span>
        )}
      </div>
    </div>
  );
}

function ApiMatrixPage({ t, providerStatus }: { t: any; providerStatus: Record<string, { available: boolean; model: string }> }) {
  const [tab, setTab] = useState<'llm' | 'voice'>('llm');

  return (
    <div className="space-y-8">
      <SettingsSection title={t.neuralApiMatrix || "API Key Matrix"} icon={<Key size={18} className="text-celestial-saturn" />}>
        {/* Sub-tabs */}
        <div className="flex gap-1 mb-6 p-1 bg-white/5 rounded-xl border border-white/5">
          <button
            onClick={() => setTab('llm')}
            className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              tab === 'llm' ? 'bg-celestial-saturn text-black' : 'text-white/30 hover:text-white/60'
            }`}
          >
            {t.llmProviders || 'LLM Providers'}
          </button>
          <button
            onClick={() => setTab('voice')}
            className={`flex-1 py-2.5 rounded-lg text-[10px] font-black uppercase tracking-widest transition-all ${
              tab === 'voice' ? 'bg-celestial-saturn text-black' : 'text-white/30 hover:text-white/60'
            }`}
          >
            {t.voiceServices || 'Voice Services'}
          </button>
        </div>

        {tab === 'llm' ? (
          <>
            <p className="text-sm text-white/40 max-w-xl mb-6">
              Configure API keys and preferred models for each LLM provider. These keys are stored server-side and shared across all devices.
            </p>
            <div className="grid grid-cols-1 gap-6">
              <LLMProviderRow
                icon={<BrainCircuit size={18} className="text-blue-400" />}
                label="DeepSeek"
                providerId="deepseek"
                models={['deepseek-chat', 'deepseek-reasoner']}
                placeholder="sk-..."
                serverKey="DEEPSEEK_API_KEY"
                t={t}
              />
              <LLMProviderRow
                icon={<Zap size={18} className="text-violet-400" />}
                label="Qwen / DashScope (Alibaba Cloud)"
                providerId="qwen"
                models={['qwen-plus', 'qwen-max', 'qwen-turbo']}
                placeholder="sk-..."
                serverKey="DASHSCOPE_API_KEY"
                t={t}
              />
              <LLMProviderRow
                icon={<BrainCircuit size={18} className="text-blue-400" />}
                label={`Google Gemini${providerStatus.gemini?.available ? ` (${providerStatus.gemini.model})` : ''}`}
                providerId="gemini"
                models={['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']}
                placeholder={providerStatus.gemini?.available ? (t.connectedViaEnv || 'Connected via environment') : (t.noKeyConfigured || 'No key configured')}
                serverKey="GEMINI_API_KEY"
                t={t}
              />
              <LLMProviderRow
                icon={<MessagesSquare size={18} className="text-green-400" />}
                label="OpenAI"
                providerId="openai"
                models={['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']}
                placeholder="sk-..."
                serverKey="OPENAI_API_KEY"
                t={t}
              />
              <LLMProviderRow
                icon={<Sparkle size={18} className="text-purple-400" />}
                label="Anthropic Claude"
                providerId="anthropic"
                models={['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5']}
                placeholder="sk-ant-..."
                serverKey="ANTHROPIC_API_KEY"
                t={t}
              />
            </div>
          </>
        ) : (
          <>
            <p className="text-sm text-white/40 max-w-xl mb-6">
              Both speech recognition (Qwen ASR) and speech synthesis (CosyVoice TTS) run on DashScope. One key covers everything.
            </p>
            <div className="grid grid-cols-1 gap-6">
              <ApiKeyField
                icon={<Zap size={18} className="text-violet-400" />}
                label="DashScope (STT + TTS)"
                placeholder="sk-..."
                storageKey="lumi_dashscope_key"
                serverKey="DASHSCOPE_API_KEY"
                hint="Powers Qwen ASR for speech recognition and CosyVoice for speech synthesis. Get your key at dashscope.aliyun.com"
                t={t}
              />
            </div>
          </>
        )}
      </SettingsSection>
    </div>
  );
}

function ApiKeyField({ icon, label, placeholder, disabled = false, storageKey, serverKey, hint, t }: { icon: React.ReactNode, label: string, placeholder: string, disabled?: boolean, storageKey: string, serverKey?: string, hint?: string, t?: any }) {
  const [value, setValue] = useState(() => {
    try { return localStorage.getItem(storageKey) || ''; } catch { return ''; }
  });
  const [saved, setSaved] = useState(false);
  const [serverConfigured, setServerConfigured] = useState(false);

  useEffect(() => {
    if (!serverKey) return;
    fetch('/api/settings/keys')
      .then(r => r.json())
      .then(data => setServerConfigured(!!data[serverKey]))
      .catch(() => {});
  }, [serverKey]);

  const handleRemove = () => {
    localStorage.removeItem(storageKey);
    if (serverKey) {
      fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: { [serverKey]: '' } }),
      }).then(() => {
        setServerConfigured(false);
        setValue('');
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }).catch(() => {});
    }
    toast.success(t?.apiKeyRemoved || 'API key removed');
  };

  const handleSave = () => {
    if (!value.trim()) return;
    localStorage.setItem(storageKey, value.trim());
    if (serverKey) {
      fetch('/api/settings/keys', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keys: { [serverKey]: value.trim() } }),
      }).then(r => r.json())
        .then(() => setServerConfigured(true))
        .catch(() => toast.error(t?.failedToSaveKey || 'Failed to save key to server'));
    }
    toast.success(t?.apiKeySaved || 'API key saved');
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  return (
    <div className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-white/5 rounded-lg">{icon}</div>
        <label className="text-[10px] font-black uppercase tracking-widest text-white/50">{label}</label>
        {serverConfigured && <span className="text-[8px] px-2 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full font-bold">{t?.configured || 'CONFIGURED'}</span>}
        {saved && <CheckCircle size={14} className="text-green-400 ml-auto" />}
      </div>
      <div className="flex gap-2">
        <div className="relative flex-1">
          <input
            disabled={disabled}
            type="password"
            value={value}
            onChange={e => setValue(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder={serverConfigured && !value ? (t?.keySavedOnServer || 'Key saved on server (type to replace)') : placeholder}
            className="w-full bg-black/40 border border-white/10 rounded-xl p-4 pr-16 text-white font-mono text-sm outline-none focus:border-celestial-saturn/50 transition-colors disabled:opacity-50"
          />
          <button
            type="button"
            onClick={handleRemove}
            disabled={disabled || (!value && !serverConfigured)}
            className="absolute right-2 top-2 h-10 px-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[9px] font-bold uppercase tracking-tight text-red-400 hover:bg-red-500/20 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
          >
            {t?.remove || 'Remove'}
          </button>
        </div>
        <Button
          onClick={handleSave}
          disabled={disabled || !value.trim()}
          className="h-[56px] px-6 bg-celestial-saturn text-black rounded-xl text-[10px] font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-celestial-saturn/90 transition-all"
        >
          {t?.save || 'Save'}
        </Button>
      </div>
      {hint && <p className="text-[9px] text-white/20 leading-relaxed">{hint}</p>}
    </div>
  );
}


function SettingsSection({ title, icon, children }: { title: string; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        {icon}
        <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">{title}</h3>
      </div>
      <div className="space-y-4">
        {children}
      </div>
    </div>
  );
}

function SettingsItem({ label, desc, active = false, storageKey, onChange, t }: { label: string; desc: string; active?: boolean; storageKey?: string; onChange?: (v: boolean) => void; t?: any }) {
  const [isActive, setIsActive] = useState(() => {
    if (storageKey) {
      try { return localStorage.getItem(storageKey) === 'true'; } catch { return active; }
    }
    return active;
  });

  const toggle = () => {
    const next = !isActive;
    setIsActive(next);
    if (storageKey) {
      localStorage.setItem(storageKey, String(next));
    }
    onChange?.(next);
    toast.info(`${label}: ${next ? (t?.enabled || 'Enabled') : (t?.disabled || 'Disabled')}`);
  };

  return (
    <div className="flex items-center justify-between p-4 bg-white/5 rounded-2xl border border-white/5">
      <div className="space-y-1">
        <div className="font-bold text-sm text-white/90">{label}</div>
        <div className="text-[10px] text-white/40 uppercase tracking-widest">{desc}</div>
      </div>
      <div onClick={toggle} className={`w-10 h-5 rounded-full p-1 transition-colors cursor-pointer ${isActive ? 'bg-celestial-saturn' : 'bg-white/10'}`}>
        <div className={`w-3 h-3 rounded-full bg-white transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </div>
  );
}
