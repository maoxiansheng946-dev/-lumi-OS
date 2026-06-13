import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Shield,
  Globe,
  Cpu,
  Database,
  Radio,
  BrainCircuit,
  ChevronDown,
  Music,
  Headphones,
  MessagesSquare,
  Sparkle,
  Zap,
  Camera,
  Mic,
  CheckCircle,
  AlertCircle,
  Loader2,
  LogOut,
  Cloud,
  Volume2
} from 'lucide-react';
import { Button } from './ui/button';
import { toast } from 'sonner';

import { usePlatform } from '@/hooks/usePlatform';
import { DeviceSyncCenter } from './DeviceSyncCenter';
import { BiometricsEnrollPanel } from './biometrics/BiometricsEnrollPanel';
import { useApp } from '@/contexts/AppContext';
import { VoiceForge } from './VoiceForge';
import { VoiceProviderSwitch } from './VoiceProviderSwitch';
import { MCPSettings } from './MCPSettings';
import { RemoteMCPSettings } from './RemoteMCPSettings';
import { MessagingHub } from './MessagingHub';
import { SystemExplorer } from './SystemExplorer';
import { ContactsPanel } from './ContactsPanel';
import { OrgBranchPanel } from './OrgBranchPanel';

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
        { id: 'llm-providers', label: t.llmProviders || 'LLM Providers', icon: <BrainCircuit size={16} /> },
        { id: 'voice-services', label: t.voiceServices || 'Voice Services', icon: <Mic size={16} /> },
      ],
    },
    {
      label: t.sidebarSystem || 'System',
      items: [
        { id: 'security', label: t.settings || 'Security', icon: <Shield size={16} /> },
        { id: 'biometrics', label: '生物特征', icon: <Shield size={16} /> },
        { id: 'hardware', label: t.settingsHardware || 'Hardware', icon: <Camera size={16} /> },
        { id: 'mcp', label: t.settingsMCP || 'MCP', icon: <Cpu size={16} /> },
        { id: 'remote-mcp', label: t.remoteMCPSidebar || 'Remote MCP', icon: <Globe size={16} /> },
        { id: 'messaging', label: t.messaging || 'Messaging', icon: <MessagesSquare size={16} /> },
        { id: 'explore', label: t.systemExplorer || 'System Explorer', icon: <Cpu size={16} /> },
        { id: 'contacts', label: t.contacts || 'Contacts', icon: <Globe size={16} /> },
        { id: 'branch', label: t.branchTerminal || 'Branch Terminal', icon: <Zap size={16} /> },
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
  const { aiConfig, updateAIConfig, logout, operationMode, setOperationMode } = useApp();
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
                  <label className="text-xs font-black uppercase tracking-widest text-white/50 block mb-4">{t.selectLanguage}</label>
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
                  <label className="text-xs font-black uppercase tracking-widest text-white/50 block mb-4">{t.selectMatrixVariant || "Select Global Matrix Variant"}</label>
                  <div className="grid grid-cols-3 gap-4">
                    {[
                      { id: 'celestial', label: t.celestial || 'Celestial', color: 'from-orange-400 to-red-500' },
                      { id: 'nebula', label: t.nebula || 'Nebula', color: 'from-indigo-500 to-purple-600' },
                      { id: 'cyber', label: t.cyber || 'Cyber', color: 'from-emerald-400 to-teal-600' }
                    ].map(themeItem => (
                      <button key={themeItem.id} onClick={() => setTheme && setTheme(themeItem.id)}
                        className={`flex flex-col items-center gap-3 p-4 rounded-2xl border transition-all text-center ${theme === themeItem.id ? 'bg-white/10 border-white/20 shadow-lg' : 'border-white/5 hover:bg-white/5'}`}>
                        <div className={`w-16 h-16 rounded-full bg-gradient-to-br ${themeItem.color} shadow-lg ${theme === themeItem.id ? 'ring-2 ring-white/50 ring-offset-2 ring-offset-black' : ''}`} />
                        <span className={`text-xs font-black uppercase tracking-widest ${theme === themeItem.id ? 'text-white' : 'text-white/60'}`}>{themeItem.label}</span>
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
                <AutonomousSettingsPanel t={t} operationMode={operationMode} setOperationMode={setOperationMode} />
                <div className="space-y-1">
                  <label className="text-xs font-black uppercase text-white/55 ml-2">{t.primaryReasoningBrain || "Primary Reasoning Brain"}</label>
                  <div className="relative">
                    <select value={aiConfig.provider} onChange={(e) => updateAIConfig({ provider: e.target.value })}
                      className="w-full bg-white/5 border border-white/10 rounded-2xl px-4 py-3 text-sm font-bold appearance-none cursor-pointer focus:border-celestial-saturn/50 outline-none">
                      <option value="deepseek">DeepSeek</option>
                      <option value="qwen">Qwen (DashScope)</option>
                      <option value="gemini">Google Gemini</option>
                      <option value="openai">OpenAI</option>
                      <option value="anthropic">Anthropic Claude</option>
                      <option value="ark">Doubao / 豆包 (Ark)</option>
                      <option value="xiaomi">Xiaomi / 小米</option>
                      <option value="kimi">Kimi / 月之暗面</option>
                      <option value="glm">GLM / 智谱</option>
                      <option value="relay">中转站 (API Relay)</option>
                    </select>
                    <ChevronDown size={14} className="absolute right-4 top-1/2 -translate-y-1/2 text-white/45" />
                  </div>
                  <p className="text-[12px] text-white/45 px-2">{t?.activeModel || 'Active model'}: <span className="text-white/40 font-mono">{aiConfig.model}</span> — {t?.changePerProvider || 'change per provider in API Matrix.'}</p>
                </div>
              </div>
            </SettingsSection>
          </div>
        );
      case 'voice':
        return <VoiceForge t={t} />;
      case 'llm-providers':
        return <LLMProvidersPage t={t} providerStatus={providerStatus} />;
      case 'voice-services':
        return <VoiceServicesPage t={t} />;
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
              <SettingsItem label={t.localEncryption || "Local Encryption"} desc={t.localEncryptionDesc || "Encrypt all Agent data stored on your local disk."} storageKey="lumi_sec_local_encryption" t={t} />
              <SettingsItem label={t.anonymousMode || "Anonymous Mode"} desc={t.anonymousModeDesc || "Hide your node ID from the collaborative network."} storageKey="lumi_sec_anonymous_mode" t={t} />
              <SettingsItem label={t.biometricLock || "Biometric Lock"} desc={t.biometricLockDesc || "Require fingerprint or face ID for Agent generation."} storageKey="lumi_sec_biometric_lock" t={t} />
            </SettingsSection>
            {isElectron && (
              <SettingsSection title={t.desktopNodeRuntime || "Desktop Node Runtime"} icon={<Database size={18} className="text-celestial-jupiter" />}>
                <div className="p-4 bg-celestial-jupiter/10 rounded-2xl border border-celestial-jupiter/20 space-y-2 mb-4">
                  <div className="flex justify-between items-center text-sm"><span className="text-white/60">{t.platform || "Platform"}:</span><span className="font-mono text-celestial-jupiter uppercase">{platform}</span></div>
                  <div className="flex justify-between items-center text-sm"><span className="text-white/60">{t.nodeStatus || "Node Status"}:</span><div className="flex items-center gap-2"><div className="w-2 h-2 rounded-full bg-green-500 animate-pulse" /><span className="font-bold text-green-500 underline decoration-green-500/20 underline-offset-4">{t.nodeActive || "ACTIVE"}</span></div></div>
                </div>
                <SettingsItem label={t.hardwareAcceleration || "Hardware Acceleration"} desc={t.hardwareAccelerationDesc || "Use GPU for neural core inference."} storageKey="lumi_sec_hw_accel" t={t} />
                <SettingsItem label={t.systemTrayMode || "System Tray Mode"} desc={t.systemTrayModeDesc || "Keep Lumi running in the background."} storageKey="lumi_sec_system_tray" t={t} />
              </SettingsSection>
            )}
          </div>
        );
      case 'biometrics':
        return (
          <div className="space-y-8">
            <SettingsSection title="生物特征录入" icon={<Shield size={18} className="text-amber-400" />}>
              <div className="p-6 bg-white/5 rounded-[2.5rem] border border-white/5">
                <BiometricsEnrollPanel />
              </div>
            </SettingsSection>
          </div>
        );
      case 'hardware':
        return <HardwareSettings t={t} />;
      case 'mcp':
        return <MCPSettings t={t} />;
      case 'remote-mcp':
        return <RemoteMCPSettings t={t} />;
      case 'messaging':
        return <MessagingHub t={t} />;
      case 'explore':
        return <SystemExplorer />;
      case 'contacts':
        return <ContactsPanel />;
      case 'branch':
        return <OrgBranchPanel />;
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
                  className="w-full flex items-center gap-1 px-2 py-1 text-xs font-black uppercase tracking-widest text-white/45 hover:text-white/40 transition-colors"
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
            className="w-full flex items-center gap-2 px-3 py-2.5 rounded-xl text-xs font-bold text-red-400/60 hover:text-red-300 hover:bg-red-500/10 transition-all"
          >
            <LogOut size={14} />
            {t?.signOut || 'Sign Out'}
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
           <p className="text-xs text-white/55 leading-relaxed italic">
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
             <div className="flex items-center gap-1.5 text-celestial-saturn text-xs font-black uppercase tracking-widest">
               <CheckCircle size={12} />
               {t.linked || "Linked"}
             </div>
           ) : status === 'denied' ? (
             <div className="flex items-center gap-1.5 text-red-500 text-xs font-black uppercase tracking-widest">
               <AlertCircle size={12} />
               {t.blocked || "Blocked"}
             </div>
           ) : (
             <div className="text-xs font-black uppercase tracking-widest text-white/45">{t.awaitingAccess || "Awaiting Access"}</div>
           )}
        </div>

        {status !== 'granted' && (
          <Button
            onClick={onEnable}
            disabled={disabled}
            className="bg-white/5 hover:bg-white/10 border border-white/10 text-xs font-black uppercase tracking-widest px-4 h-9 rounded-xl"
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
      className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors duration-150 w-full text-left relative ${active ? 'bg-white/10 text-white' : 'text-white/55 hover:bg-white/5 hover:text-white/50'}`}
    >
      <div className={`flex-shrink-0 w-4 h-4 flex items-center justify-center ${active ? 'text-celestial-saturn' : 'text-current'}`}>{icon}</div>
      <span className="text-[12px] font-bold uppercase tracking-tight truncate">{label}</span>
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
    }).then(r => {
      if (!r.ok) throw new Error('Remove failed');
      setServerConfigured(false);
      setKeyValue('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    }).catch(() => toast.error(t?.failedToRemoveKey || 'Failed to remove key'));
  };

  const handleSaveKey = () => {
    if (!keyValue.trim()) return;
    localStorage.setItem(`lumi_${providerId}_key`, keyValue.trim());
    fetch('/api/settings/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { [serverKey]: keyValue.trim() } }),
    }).then(r => {
      if (!r.ok) throw new Error('Save failed');
      setServerConfigured(true);
    }).catch(() => toast.error(t?.failedToSaveKey || 'Failed to save key'));
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
        <label className="text-xs font-black uppercase tracking-widest text-white/50">{label}</label>
        {serverConfigured && <span className="text-xs px-2 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full font-bold">{t?.configured || 'CONFIGURED'}</span>}
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
            placeholder={serverConfigured && !keyValue ? (t?.keySavedOnServer || 'Key saved on server') : placeholder}
            className="w-full bg-black/40 border border-white/10 rounded-xl p-4 pr-16 text-white font-mono text-sm outline-none focus:border-celestial-saturn/50 transition-colors disabled:opacity-50"
          />
          <div className="absolute right-2 top-2 flex gap-1">
            <button type="button" onClick={() => setShowKey(!showKey)}
              className="h-10 px-2 bg-white/5 hover:bg-white/10 text-xs font-bold uppercase border border-white/5 rounded-lg">
              {showKey ? (t?.hide || 'Hide') : (t?.show || 'Show')}
            </button>
          </div>
        </div>
        <Button
          onClick={handleSaveKey}
          disabled={disabled || !keyValue.trim()}
          className="h-[56px] px-4 bg-celestial-saturn text-black rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-celestial-saturn/90 transition-all"
        >
          {t?.save || 'Save'}
        </Button>
        <Button
          onClick={handleRemoveKey}
          disabled={disabled || (!keyValue && !serverConfigured)}
          className="h-[56px] px-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs font-black uppercase tracking-widest text-red-400 hover:bg-red-500/20 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
        >
          {t?.remove || 'Remove'}
        </Button>
      </div>
      <div className="flex items-center gap-3">
        <label className="text-[12px] font-black uppercase text-white/55 tracking-wider whitespace-nowrap">{t?.model || 'Model'}</label>
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
          <span className="text-xs px-2 py-0.5 bg-celestial-saturn/10 border border-celestial-saturn/20 text-celestial-saturn rounded-full font-bold whitespace-nowrap">{t?.activeBadge || 'ACTIVE'}</span>
        )}
      </div>
    </div>
  );
}

function ProactiveVoiceToggle() {
  const storageKey = 'lumi_allow_proactive_voice';
  const [enabled, setEnabled] = useState(() => localStorage.getItem(storageKey) !== 'false');

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem(storageKey, String(next));
  };

  return (
    <button
      onClick={toggle}
      className={`w-11 h-6 rounded-full transition-all relative ${enabled ? 'bg-celestial-saturn' : 'bg-white/10 border border-white/20'}`}
    >
      <motion.div
        animate={{ x: enabled ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-md"
      />
    </button>
  );
}

function AlwaysOnVoiceToggle() {
  const storageKey = 'lumi_always_on_voice';
  const [enabled, setEnabled] = useState(() => localStorage.getItem(storageKey) === 'true');

  const toggle = () => {
    const next = !enabled;
    setEnabled(next);
    localStorage.setItem(storageKey, String(next));
  };

  return (
    <button
      onClick={toggle}
      className={`w-11 h-6 rounded-full transition-all relative ${enabled ? 'bg-celestial-saturn' : 'bg-white/10 border border-white/20'}`}
    >
      <motion.div
        animate={{ x: enabled ? 20 : 2 }}
        transition={{ type: 'spring', stiffness: 500, damping: 30 }}
        className="absolute top-1 w-4 h-4 bg-white rounded-full shadow-md"
      />
    </button>
  );
}

function LLMProvidersPage({ t, providerStatus }: { t: any; providerStatus: Record<string, { available: boolean; model: string }> }) {
  return (
    <div className="space-y-8">
      <SettingsSection title={t.llmProviders || "LLM Providers"} icon={<BrainCircuit size={18} className="text-celestial-saturn" />}>
        <p className="text-sm text-white/40 max-w-xl mb-6">
          {t.apiMatrixLLMDesc || 'Configure API keys and preferred models for each LLM provider.'}
        </p>
        <div className="grid grid-cols-1 gap-6">
          <LLMProviderRow icon={<BrainCircuit size={18} className="text-blue-400" />} label="DeepSeek" providerId="deepseek" models={['deepseek-chat', 'deepseek-reasoner']} placeholder="sk-..." serverKey="DEEPSEEK_API_KEY" t={t} />
          <LLMProviderRow icon={<Zap size={18} className="text-violet-400" />} label="Qwen / DashScope (Alibaba Cloud)" providerId="qwen" models={['qwen-plus', 'qwen-max', 'qwen-turbo']} placeholder="sk-..." serverKey="DASHSCOPE_API_KEY" t={t} />
          <LLMProviderRow icon={<Cloud size={18} className="text-cyan-400" />} label="Doubao / 豆包 (Ark)" providerId="ark" models={['doubao-1-5-pro-32k', 'doubao-1-5-lite-32k', 'doubao-1-5-vision-pro-32k']} placeholder="Enter Ark API key..." serverKey="ARK_API_KEY" t={t} />
          <LLMProviderRow icon={<Cpu size={18} className="text-orange-400" />} label="Xiaomi / 小米" providerId="xiaomi" models={['xiaomi-chat']} placeholder="Enter Xiaomi API key..." serverKey="XIAOMI_API_KEY" t={t} />
          <LLMProviderRow icon={<Sparkle size={18} className="text-rose-400" />} label="Kimi / 月之暗面 (Moonshot)" providerId="kimi" models={['moonshot-v1-8k', 'moonshot-v1-32k', 'moonshot-v1-128k']} placeholder="sk-..." serverKey="KIMI_API_KEY" t={t} />
          <LLMProviderRow icon={<Sparkle size={18} className="text-cyan-400" />} label="GLM / 智谱 (Zhipu AI)" providerId="glm" models={['glm-4-plus', 'glm-4-flash', 'glm-4-air']} placeholder="Enter GLM API key..." serverKey="GLM_API_KEY" t={t} />
          <LLMProviderRow icon={<BrainCircuit size={18} className="text-blue-400" />} label={`Google Gemini${providerStatus.gemini?.available ? ` (${providerStatus.gemini.model})` : ''}`} providerId="gemini" models={['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash']} placeholder={providerStatus.gemini?.available ? (t.connectedViaEnv || 'Connected via environment') : (t.noKeyConfigured || 'No key configured')} serverKey="GEMINI_API_KEY" t={t} />
          <LLMProviderRow icon={<MessagesSquare size={18} className="text-green-400" />} label="OpenAI" providerId="openai" models={['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo']} placeholder="sk-..." serverKey="OPENAI_API_KEY" t={t} />
          <LLMProviderRow icon={<Sparkle size={18} className="text-purple-400" />} label="Anthropic Claude" providerId="anthropic" models={['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5']} placeholder="sk-ant-..." serverKey="ANTHROPIC_API_KEY" t={t} />
          <OllamaProviderRow t={t} />
          <LmStudioProviderRow t={t} />
          <RelayProviderRow t={t} />
        </div>
      </SettingsSection>
    </div>
  );
}

function OllamaProviderRow({ t }: { t?: any }) {
  const [baseUrl, setBaseUrl] = useState(() => {
    try { return localStorage.getItem('lumi_ollama_url') || 'http://localhost:11434'; } catch { return 'http://localhost:11434'; }
  });
  const [detected, setDetected] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    // Load current config on mount
    fetch('/api/ollama/config')
      .then(r => r.json())
      .then(cfg => {
        setBaseUrl(cfg.baseUrl || 'http://localhost:11434');
        setDetected(!!cfg.detected);
        setModels(cfg.models || []);
      })
      .catch(() => {});
  }, []);

  const handleDetect = async () => {
    setChecking(true);
    try {
      const resp = await fetch('/api/ollama/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl }),
      });
      const cfg = await resp.json();
      setDetected(!!cfg.detected);
      setModels(cfg.models || []);
      localStorage.setItem('lumi_ollama_url', baseUrl);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { setDetected(false); setModels([]); }
    setChecking(false);
  };

  const llmModels = models.filter(m => !m.includes('embed') && !m.includes('whisper'));

  return (
    <div className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-white/5 rounded-lg"><Cpu size={18} className="text-emerald-400" /></div>
        <label className="text-xs font-black uppercase tracking-widest text-white/50">Ollama (Local AI)</label>
        {detected && <span className="text-xs px-2 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full font-bold">CONNECTED</span>}
        {saved && <CheckCircle size={14} className="text-green-400 ml-auto" />}
      </div>
      <div className="flex gap-3">
        <input
          type="text"
          value={baseUrl}
          onChange={e => { setBaseUrl(e.target.value); setSaved(false); }}
          onKeyDown={e => e.key === 'Enter' && handleDetect()}
          placeholder="http://localhost:11434"
          className="flex-1 bg-black/40 border border-white/10 rounded-xl p-4 text-white font-mono text-sm outline-none focus:border-emerald-400/50 transition-colors"
        />
        <Button
          onClick={handleDetect}
          disabled={checking || !baseUrl.trim()}
          className="h-[56px] px-5 bg-emerald-600 text-white rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-30 hover:bg-emerald-500 transition-all"
        >
          {checking ? <Loader2 size={16} className="animate-spin" /> : 'Detect'}
        </Button>
      </div>
      {detected && llmModels.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {llmModels.map(m => (
            <span key={m} className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/60 font-mono">{m}</span>
          ))}
        </div>
      )}
      {!detected && !checking && baseUrl && (
        <p className="text-xs text-white/40">No local models found at this address. Make sure Ollama is running.</p>
      )}
    </div>
  );
}

function LmStudioProviderRow({ t }: { t?: any }) {
  const [baseUrl, setBaseUrl] = useState(() => {
    try { return localStorage.getItem('lumi_lmstudio_url') || 'http://localhost:1234'; } catch { return 'http://localhost:1234'; }
  });
  const [detected, setDetected] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [checking, setChecking] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/lmstudio/config')
      .then(r => r.json())
      .then(cfg => {
        setBaseUrl(cfg.baseUrl || 'http://localhost:1234');
        setDetected(!!cfg.detected);
        setModels(cfg.models || []);
      })
      .catch(() => {});
  }, []);

  const handleDetect = async () => {
    setChecking(true);
    try {
      const resp = await fetch('/api/lmstudio/config', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl }),
      });
      const cfg = await resp.json();
      setDetected(!!cfg.detected);
      setModels(cfg.models || []);
      localStorage.setItem('lumi_lmstudio_url', baseUrl);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch { setDetected(false); setModels([]); }
    setChecking(false);
  };

  return (
    <div className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-white/5 rounded-lg"><Cpu size={18} className="text-amber-400" /></div>
        <label className="text-xs font-black uppercase tracking-widest text-white/50">LM Studio (Local AI)</label>
        {detected && <span className="text-xs px-2 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full font-bold">CONNECTED</span>}
        {saved && <CheckCircle size={14} className="text-green-400 ml-auto" />}
      </div>
      <div className="flex gap-3">
        <input
          type="text"
          value={baseUrl}
          onChange={e => { setBaseUrl(e.target.value); setSaved(false); }}
          onKeyDown={e => e.key === 'Enter' && handleDetect()}
          placeholder="http://localhost:1234"
          className="flex-1 bg-black/40 border border-white/10 rounded-xl p-4 text-white font-mono text-sm outline-none focus:border-amber-400/50 transition-colors"
        />
        <Button
          onClick={handleDetect}
          disabled={checking || !baseUrl.trim()}
          className="h-[56px] px-5 bg-amber-600 text-white rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-30 hover:bg-amber-500 transition-all"
        >
          {checking ? <Loader2 size={16} className="animate-spin" /> : 'Detect'}
        </Button>
      </div>
      {detected && models.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {models.map(m => (
            <span key={m} className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/60 font-mono">{m}</span>
          ))}
        </div>
      )}
      {!detected && !checking && baseUrl && (
        <p className="text-xs text-white/40">No models found. Make sure LM Studio is running and a model is loaded.</p>
      )}
    </div>
  );
}

function VoiceServicesPage({ t }: { t: any }) {
  return (
    <div className="space-y-8">
      <SettingsSection title={t.audioOutput || "Audio & Voice Output"} icon={<Music size={18} className="text-celestial-saturn" />}>
        <div className="space-y-4 mb-6">
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-white/80">{t.ttsEngine || 'TTS Engine'}</span>
            </div>
            <p className="text-xs text-white/40">{t.ttsEngineDesc || 'GPT-SoVITS + DashScope CosyVoice configured.'}</p>
          </div>
          <div className="p-4 rounded-2xl bg-white/5 border border-white/5 space-y-2">
            <div className="flex items-center gap-2">
              <div className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <span className="text-xs font-bold text-white/80">{t.sttEngine || 'STT Engine'}</span>
            </div>
            <p className="text-xs text-white/40">{t.sttEngineDesc || 'Deepgram speech recognition active.'}</p>
          </div>
          <VoiceProviderSwitch t={t} />
        </div>
        <p className="text-sm text-white/40 max-w-xl mb-6">
          {t.voiceServicesDesc || 'Speech recognition (ASR) and speech synthesis (TTS). Doubao Speech is auto-prioritized when configured.'}
        </p>
        <div className="grid grid-cols-1 gap-6">
          <ApiKeyField icon={<Volume2 size={18} className="text-emerald-400" />} label={t.doubaoSpeechLabel || 'Doubao Speech (STT + TTS)'} placeholder="AppID:AccessToken" storageKey="lumi_doubao_speech" serverKey="DOUBAO_SPEECH_KEY" hint={t.doubaoSpeechHint || 'Format: AppID:AccessToken. Get both from console.volcengine.com/speech → App Management'} t={t} />
          <ApiKeyField icon={<Zap size={18} className="text-violet-400" />} label={t.dashscopeLabel || 'DashScope (STT + TTS)'} placeholder="sk-..." storageKey="lumi_dashscope_key" serverKey="DASHSCOPE_API_KEY" hint={t.dashscopeHint || 'Powers Qwen ASR and CosyVoice TTS. Get your key at dashscope.aliyun.com'} t={t} />
        </div>
        <div className="mt-6 p-4 bg-white/5 rounded-xl border border-white/10">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-xs font-bold text-white/80">{t.proactiveVoiceGreeting || '允许Lumi主动语音问候'}</p>
              <p className="text-xs text-white/55 mt-0.5">{t.proactiveVoiceGreetingDesc || '开启后，Lumi会在检测到异常或长时间不活动时主动开口说话'}</p>
            </div>
            <ProactiveVoiceToggle />
          </div>
          <div className="flex items-center justify-between mt-3">
            <div>
              <p className="text-xs font-bold text-white/80">{t.alwaysOnVoiceLabel || '持续语音通道 (Always-On Voice)'}</p>
              <p className="text-xs text-white/55 mt-0.5">{t.alwaysOnVoiceDesc || '开启后麦克风不会自动断开，Lumi始终在听。'}</p>
            </div>
            <AlwaysOnVoiceToggle />
          </div>
        </div>
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
      }).then(r => {
        if (!r.ok) throw new Error('Remove failed');
        setServerConfigured(false);
        setValue('');
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }).catch(() => toast.error(t?.failedToRemoveKey || 'Failed to remove key'));
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
      }).then(r => {
        if (!r.ok) throw new Error('Save failed');
        return r.json();
      }).then(() => setServerConfigured(true))
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
        <label className="text-xs font-black uppercase tracking-widest text-white/50">{label}</label>
        {serverConfigured && <span className="text-xs px-2 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full font-bold">{t?.configured || 'CONFIGURED'}</span>}
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
            className="absolute right-2 top-2 h-10 px-3 bg-red-500/10 border border-red-500/20 rounded-lg text-[12px] font-bold uppercase tracking-tight text-red-400 hover:bg-red-500/20 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
          >
            {t?.remove || 'Remove'}
          </button>
        </div>
        <Button
          onClick={handleSave}
          disabled={disabled || !value.trim()}
          className="h-[56px] px-6 bg-celestial-saturn text-black rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-celestial-saturn/90 transition-all"
        >
          {t?.save || 'Save'}
        </Button>
      </div>
      {hint && <p className="text-[12px] text-white/45 leading-relaxed">{hint}</p>}
    </div>
  );
}


function RelayProviderRow({ t }: { t?: any }) {
  const [apiKey, setApiKey] = useState(() => {
    try { return localStorage.getItem('lumi_relay_key') || ''; } catch { return ''; }
  });
  const [baseUrl, setBaseUrl] = useState(() => {
    try { return localStorage.getItem('lumi_relay_url') || 'https://api.example.com/v1'; } catch { return 'https://api.example.com/v1'; }
  });
  const [serverKeyOk, setServerKeyOk] = useState(false);
  const [serverUrlOk, setServerUrlOk] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch('/api/settings/keys')
      .then(r => r.json())
      .then(data => {
        setServerKeyOk(!!data['RELAY_API_KEY']);
        setServerUrlOk(!!data['RELAY_BASE_URL']);
      })
      .catch(() => {});
  }, []);

  const handleSave = () => {
    if (!apiKey.trim() || !baseUrl.trim()) return;
    localStorage.setItem('lumi_relay_key', apiKey.trim());
    localStorage.setItem('lumi_relay_url', baseUrl.trim());
    fetch('/api/settings/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { RELAY_API_KEY: apiKey.trim(), RELAY_BASE_URL: baseUrl.trim() } }),
    }).then(r => {
      if (r.ok) { setServerKeyOk(true); setServerUrlOk(true); }
    }).catch(() => toast.error(t?.failedToSaveKey || 'Failed to save'));
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleRemove = () => {
    localStorage.removeItem('lumi_relay_key');
    localStorage.removeItem('lumi_relay_url');
    fetch('/api/settings/keys', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ keys: { RELAY_API_KEY: '', RELAY_BASE_URL: '' } }),
    }).then(r => {
      if (r.ok) { setServerKeyOk(false); setServerUrlOk(false); setApiKey(''); setBaseUrl(''); }
    }).catch(() => {});
  };

  return (
    <div className="p-6 bg-white/5 rounded-3xl border border-white/5 space-y-4">
      <div className="flex items-center gap-2">
        <div className="p-2 bg-white/5 rounded-lg"><Globe size={18} className="text-cyan-400" /></div>
        <label className="text-xs font-black uppercase tracking-widest text-white/50">中转站 (API Relay)</label>
        {(serverKeyOk || serverUrlOk) && <span className="text-xs px-2 py-0.5 bg-green-500/10 border border-green-500/20 text-green-400 rounded-full font-bold">CONFIGURED</span>}
        {saved && <CheckCircle size={14} className="text-green-400 ml-auto" />}
      </div>
      <div className="space-y-3">
        <div className="flex gap-2">
          <input
            type="password"
            value={apiKey}
            onChange={e => setApiKey(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="API Key"
            className="flex-1 bg-black/40 border border-white/10 rounded-xl p-4 text-white font-mono text-sm outline-none focus:border-cyan-400/50 transition-colors"
          />
        </div>
        <div className="flex gap-2">
          <input
            type="text"
            value={baseUrl}
            onChange={e => setBaseUrl(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSave()}
            placeholder="https://your-relay.example.com/v1"
            className="flex-1 bg-black/40 border border-white/10 rounded-xl p-4 text-white font-mono text-sm outline-none focus:border-cyan-400/50 transition-colors"
          />
        </div>
      </div>
      <div className="flex gap-3">
        <Button
          onClick={handleSave}
          disabled={!apiKey.trim() || !baseUrl.trim()}
          className="h-[48px] px-6 bg-cyan-600 text-white rounded-xl text-xs font-black uppercase tracking-widest disabled:opacity-30 disabled:cursor-not-allowed hover:bg-cyan-500 transition-all"
        >
          {t?.save || 'Save'}
        </Button>
        <Button
          onClick={handleRemove}
          disabled={!apiKey && !serverKeyOk && !serverUrlOk}
          className="h-[48px] px-4 bg-red-500/10 border border-red-500/20 rounded-xl text-xs font-black uppercase tracking-widest text-red-400 hover:bg-red-500/20 disabled:opacity-20 disabled:cursor-not-allowed transition-all"
        >
          {t?.remove || 'Remove'}
        </Button>
      </div>
      <p className="text-[12px] text-white/45 leading-relaxed">OpenAI-compatible API relay. Enter the base URL and API key of your proxy/relay service.</p>
    </div>
  );
}

function AutonomousSettingsPanel({ t, operationMode, setOperationMode }: { t: any; operationMode: 'desktop_control' | 'terminal' | 'autonomous'; setOperationMode: (m: 'desktop_control' | 'terminal' | 'autonomous') => void }) {
  const [gateConfig, setGateConfig] = useState({ allowedHours: [{ start: 8, end: 22 }], requireIdle: true, minIdleSeconds: 120, maxTokensPerHour: 3000 });
  const [taskList, setTaskList] = useState<any[]>([]);
  const [tasksExpanded, setTasksExpanded] = useState(false);

  useEffect(() => {
    fetch('/api/autonomy/gate_config')
      .then(r => r.json())
      .then(d => setGateConfig(d))
      .catch(() => {});
    fetch('/api/scheduler/tasks')
      .then(r => r.json())
      .then(d => setTaskList(d.tasks || []))
      .catch(() => {});
  }, []);

  const updateGate = (partial: Record<string, any>) => {
    const updated = { ...gateConfig, ...partial };
    setGateConfig(updated);
    fetch('/api/autonomy/gate_config', {
      method: 'PUT', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(partial),
    }).catch(() => {});
  };

  const toggleTask = async (taskId: string) => {
    try {
      const r = await fetch(`/api/scheduler/tasks/${taskId}/toggle`, { method: 'POST', credentials: 'include' });
      const data = await r.json();
      setTaskList(prev => prev.map(t => t.id === taskId ? { ...t, enabled: data.enabled } : t));
    } catch {}
  };

  const isAutonomous = operationMode === 'autonomous';

  return (
    <div className="space-y-4">
      {/* Operation Mode */}
      <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-widest text-white/60">Autonomous Mode</div>
            <p className="text-xs text-white/40 mt-1">Enable background autonomous work — Lumi can self-initiate tasks when idle.</p>
          </div>
          <button
            onClick={() => setOperationMode(isAutonomous ? 'desktop_control' : 'autonomous')}
            className={`w-11 h-6 rounded-full transition-all ${isAutonomous ? 'bg-cyan-500' : 'bg-white/10'}`}
          >
            <div className={`w-4 h-4 rounded-full bg-white transition-transform ${isAutonomous ? 'translate-x-[24px]' : 'translate-x-[2px]'}`} />
          </button>
        </div>
        {isAutonomous && (
          <div className="flex items-center gap-2 text-xs text-cyan-400/70">
            <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
            Autonomous mode active — Lumi will generate tasks when you're idle
          </div>
        )}
      </div>

      {/* Safety Gates */}
      <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-4">
        <div className="text-xs font-black uppercase tracking-widest text-white/60">Safety Gates</div>

        <div className="flex items-center justify-between">
          <span className="text-xs text-white/50">Require user idle</span>
          <button
            onClick={() => updateGate({ requireIdle: !gateConfig.requireIdle })}
            className={`w-10 h-5 rounded-full transition-all ${gateConfig.requireIdle ? 'bg-cyan-500' : 'bg-white/10'}`}
          >
            <div className={`w-3 h-3 rounded-full bg-white transition-transform ${gateConfig.requireIdle ? 'translate-x-[22px]' : 'translate-x-[2px]'}`} />
          </button>
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-white/50">Min idle time: {gateConfig.minIdleSeconds}s</span>
          </div>
          <input
            type="range" min={30} max={600} step={30} value={gateConfig.minIdleSeconds}
            onChange={e => updateGate({ minIdleSeconds: parseInt(e.target.value) })}
            className="w-full accent-cyan-500"
          />
        </div>

        <div>
          <div className="flex items-center justify-between mb-1">
            <span className="text-xs text-white/50">Max tokens/hour: {gateConfig.maxTokensPerHour}</span>
          </div>
          <input
            type="range" min={500} max={10000} step={500} value={gateConfig.maxTokensPerHour}
            onChange={e => updateGate({ maxTokensPerHour: parseInt(e.target.value) })}
            className="w-full accent-cyan-500"
          />
        </div>
      </div>

      {/* Scheduler Tasks */}
      <div className="p-4 bg-white/5 rounded-2xl border border-white/5 space-y-3">
        <button onClick={() => setTasksExpanded(!tasksExpanded)} className="w-full flex items-center justify-between">
          <div className="text-xs font-black uppercase tracking-widest text-white/60">Background Tasks</div>
          <ChevronDown size={14} className={`text-white/40 transition-transform ${tasksExpanded ? 'rotate-180' : ''}`} />
        </button>

        {tasksExpanded && (
          <div className="max-h-60 overflow-y-auto custom-scrollbar space-y-1">
            {taskList.map((task: any) => (
              <div key={task.id} className="flex items-center justify-between py-1.5 px-2 rounded-lg hover:bg-white/[0.02]">
                <div className="flex-1 min-w-0">
                  <div className="text-xs font-bold text-white/60 truncate">{task.id}</div>
                  <div className="text-[11px] text-white/30">{task.cron} {task.lastRun ? `· Last: ${new Date(task.lastRun).toLocaleTimeString()}` : ''}</div>
                </div>
                <button
                  onClick={() => toggleTask(task.id)}
                  className={`w-8 h-4 rounded-full transition-all ${task.enabled !== false ? 'bg-cyan-500/50' : 'bg-white/10'}`}
                >
                  <div className={`w-3 h-3 rounded-full bg-white transition-transform ${task.enabled !== false ? 'translate-x-[18px]' : 'translate-x-[1px]'}`} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
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
        <div className="text-xs text-white/40 uppercase tracking-widest">{desc}</div>
      </div>
      <div onClick={toggle} className={`w-10 h-5 rounded-full p-1 transition-colors cursor-pointer ${isActive ? 'bg-celestial-saturn' : 'bg-white/10'}`}>
        <div className={`w-3 h-3 rounded-full bg-white transition-transform ${isActive ? 'translate-x-5' : 'translate-x-0'}`} />
      </div>
    </div>
  );
}
