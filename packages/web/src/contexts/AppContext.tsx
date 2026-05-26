import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';
import { toast } from 'sonner';
import * as authService from '../services/authService';

interface UserProfile {
  uid: string;
  username: string;
  displayName?: string;
  email?: string;
  photoURL?: string;
  balance: number;
  role: string;
  phone?: string;
  provider: 'custom' | 'google';
}

interface Agent {
  id: string;
  ownerUid: string;
  name: string;
  category: string;
  data: string;
  createdAt: string;
  status: 'active' | 'inactive';
}

interface AIConfig {
  provider: string;
  model: string;
  apiKey: string;
}

interface NotificationItem {
  id: string;
  type: string;
  title: string;
  message: string;
  timestamp: number;
  read: boolean;
}

interface ToolOverride {
  enabled: boolean;
  securityLevel?: string;
}

export interface OrgConnection {
  orgId: string;
  orgRole: string;
  orgName: string;
  connected: boolean;
}

interface AppContextType {
  user: UserProfile | null;
  loading: boolean;
  agents: Agent[];
  aiConfig: AIConfig;
  // Voice
  selectedVoiceId: string | undefined;
  setSelectedVoiceId: (id: string) => void;
  favoriteVoices: string[];
  toggleFavoriteVoice: (id: string) => void;
  // Personality
  personalityId: string;
  setPersonalityId: (id: string) => void;
  // Notifications
  notifications: NotificationItem[];
  unreadCount: number;
  addNotification: (item: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: () => void;
  // Tools
  toolOverrides: Record<string, ToolOverride>;
  setToolOverride: (name: string, override: ToolOverride) => void;
  // Enterprise
  orgConnection: OrgConnection | null;
  workDomain: 'personal' | 'work';
  switchDomain: (domain: 'personal' | 'work') => void;
  // Core
  login: () => Promise<void>;
  logout: () => Promise<void>;
  createAgent: (name: string, category: string, data: any) => Promise<any>;
  deleteAgent: (id: string) => Promise<void>;
  updateBalance: (amount: number) => Promise<void>;
  refreshUser: () => Promise<void>;
  updateAIConfig: (config: Partial<AIConfig>) => void;
}

const AppContext = createContext<AppContextType | undefined>(undefined);

export function AppProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [agents, setAgents] = useState<Agent[]>([]);
  const [loading, setLoading] = useState(true);
  const [aiConfig, setAiConfig] = useState<AIConfig>(() => {
    const saved = localStorage.getItem('lumi_ai_config');
    return saved ? JSON.parse(saved) : { provider: 'deepseek', model: 'deepseek-chat', apiKey: '' };
  });
  // Voice state
  const [selectedVoiceId, setSelectedVoiceIdState] = useState<string | undefined>(() => {
    return localStorage.getItem('lumi_selected_voice_id') || undefined;
  });
  // Personality state
  const [personalityId, setPersonalityIdState] = useState<string>(() => {
    return localStorage.getItem('lumi_personality_id') || 'lumi';
  });
  const setPersonalityId = (id: string) => {
    setPersonalityIdState(id);
    localStorage.setItem('lumi_personality_id', id);
  };
  const [favoriteVoices, setFavoriteVoices] = useState<string[]>(() => {
    try { return JSON.parse(localStorage.getItem('lumi_favorite_voices') || '[]'); } catch { return []; }
  });

  // Notifications state
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const unreadCount = notifications.filter(n => !n.read).length;

  // Tool overrides state
  const [toolOverrides, setToolOverrides] = useState<Record<string, ToolOverride>>(() => {
    try { return JSON.parse(localStorage.getItem('lumi_tool_overrides') || '{}'); } catch { return {}; }
  });

  // Enterprise state
  const [orgConnection, setOrgConnection] = useState<OrgConnection | null>(() => {
    try { return JSON.parse(localStorage.getItem('lumi_org_connection') || 'null'); } catch { return null; }
  });
  const [workDomain, setWorkDomain] = useState<'personal' | 'work'>(() => {
    try { return (localStorage.getItem('lumi_work_domain') as 'personal' | 'work') || 'personal'; } catch { return 'personal'; }
  });

  const switchDomain = (domain: 'personal' | 'work') => {
    setWorkDomain(domain);
    localStorage.setItem('lumi_work_domain', domain);
  };

  const updateAIConfig = (newConfig: Partial<AIConfig>) => {
    setAiConfig(prev => {
      // Auto-resolve model from per-provider preferences when provider changes
      let resolved = { ...newConfig };
      if (newConfig.provider && !newConfig.model) {
        const savedModels = (() => {
          try { return JSON.parse(localStorage.getItem('lumi_llm_models') || '{}'); } catch { return {}; }
        })();
        const defaults: Record<string, string> = {
          qwen: 'qwen-plus', deepseek: 'deepseek-chat', openai: 'gpt-4o',
          gemini: 'gemini-2.0-flash', anthropic: 'claude-sonnet-4-6',
        };
        resolved.model = savedModels[newConfig.provider] || defaults[newConfig.provider] || '';
      }
      const updated = { ...prev, ...resolved };
      localStorage.setItem('lumi_ai_config', JSON.stringify(updated));

      // Also sync apiKey to server so LLM/STT/TTS providers can read it
      if (updated.apiKey && updated.provider) {
        const KEY_MAP: Record<string, string> = {
          qwen: 'DASHSCOPE_API_KEY',
          deepseek: 'DEEPSEEK_API_KEY',
          openai: 'OPENAI_API_KEY',
          gemini: 'GEMINI_API_KEY',
          anthropic: 'ANTHROPIC_API_KEY',
        };
        const serverKey = KEY_MAP[updated.provider];
        if (serverKey) {
          fetch('/api/settings/keys', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ keys: { [serverKey]: updated.apiKey } }),
          }).catch(() => {});
        }
      }

      // Sync LLM prefs (provider + per-provider models) to server for personality evolution
      if (updated.provider || updated.model) {
        const allModels = (() => {
          try { return JSON.parse(localStorage.getItem('lumi_llm_models') || '{}'); } catch { return {}; }
        })();
        if (updated.model && updated.provider) {
          allModels[updated.provider] = updated.model;
        }
        fetch('/api/preferences/llm', {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: updated.provider || prev.provider, models: allModels }),
          credentials: 'include',
        }).catch(() => {});
      }
      return updated;
    });
    toast.success('Neural core configuration synchronized');
  };

  const refreshUser = async () => {
    try {
      const customAuth = await authService.getMe();
      if (customAuth) {
        setUser({ ...customAuth.user, provider: 'custom' } as any);
        const agentsRes = await fetch('/api/agents');
        if (agentsRes.ok) {
          const agentsData = await agentsRes.json();
          setAgents(agentsData);
        }
      } else {
        setUser(null);
        setAgents([]);
      }
    } catch (error) {
      console.error('Error refreshing user:', error);
    }
  };

  useEffect(() => {
    let cancelled = false;
    const init = async () => {
      setLoading(true);
      try {
        const me = await authService.getMe();
        if (!me && !cancelled) {
          // No valid token — try auto-login bootstrap (local admin account)
          const result = await authService.bootstrap();
          if (result.success && !cancelled) {
            console.log('[Auth] Auto-logged in via bootstrap as', result.user?.username);
          }
        }
        if (!cancelled) await refreshUser();
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    init();
    return () => { cancelled = true; };
  }, []);

  const login = async () => {
    window.dispatchEvent(new CustomEvent('lumi:open-login'));
  };

  const logout = async () => {
    try {
      await authService.logout();
      setUser(null);
      setAgents([]);
      toast.info('Returned to the mortal realm');
    } catch (error: any) {
      toast.error('Logout failed: ' + error.message);
    }
  };

  const createAgent = async (name: string, category: string, data: any): Promise<any> => {
    if (!user) {
      toast.error('You must be authenticated to synthesize agents');
      return null;
    }

    try {
      const response = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, category, data: JSON.stringify(data) })
      });

      if (!response.ok) throw new Error('Failed to create agent');

      const newAgent = await response.json();
      setAgents(prev => [...prev, newAgent]);
      addNotification({ type: 'success', title: 'Agent Synthesized', message: `${name} (${category}) has been created and is ready for use.` });
      toast.success(`${name} has been synthesized`);
      return newAgent;
    } catch (error: any) {
      console.error('Synthesis error:', error);
      toast.error('Synthesis failed: ' + error.message);
    }
  };

  const deleteAgent = async (id: string) => {
    try {
      const response = await fetch(`/api/agents/${id}`, {
        method: 'DELETE',
      });

      if (!response.ok) throw new Error('Failed to delete agent');
      
      const deleted = agents.find(a => a.id === id);
      setAgents(prev => prev.filter(a => a.id !== id));
      addNotification({ type: 'info', title: 'Agent Released', message: `"${deleted?.name || id}" has been dissolved.` });
      toast.success('Agent essence has been released');
    } catch (error: any) {
      console.error('Deletion error:', error);
      toast.error('Deletion failed: ' + error.message);
    }
  };

  const updateBalance = async (amount: number) => {
    setUser((prev) => prev ? { ...prev, balance: (prev.balance || 0) + amount } : prev);
  };

  const setSelectedVoiceId = (id: string) => {
    setSelectedVoiceIdState(id);
    localStorage.setItem('lumi_selected_voice_id', id);
  };

  const toggleFavoriteVoice = (id: string) => {
    setFavoriteVoices(prev => {
      const next = prev.includes(id) ? prev.filter(v => v !== id) : [...prev, id];
      localStorage.setItem('lumi_favorite_voices', JSON.stringify(next));
      return next;
    });
  };

  const addNotification = (item: Omit<NotificationItem, 'id' | 'timestamp' | 'read'>) => {
    const notification: NotificationItem = {
      ...item,
      id: `notif-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      timestamp: Date.now(),
      read: false,
    };
    setNotifications(prev => [notification, ...prev].slice(0, 50));
  };

  const markAllNotificationsRead = () => {
    setNotifications(prev => prev.map(n => ({ ...n, read: true })));
  };

  const clearNotifications = () => {
    setNotifications([]);
  };

  const setToolOverride = (name: string, override: ToolOverride) => {
    setToolOverrides(prev => {
      const next = { ...prev, [name]: override };
      localStorage.setItem('lumi_tool_overrides', JSON.stringify(next));
      return next;
    });
  };

  return (
    <AppContext.Provider value={{
      user,
      loading,
      agents,
      aiConfig,
      selectedVoiceId,
      setSelectedVoiceId,
      favoriteVoices,
      toggleFavoriteVoice,
      personalityId,
      setPersonalityId,
      notifications,
      unreadCount,
      addNotification,
      markAllNotificationsRead,
      clearNotifications,
      toolOverrides,
      setToolOverride,
      orgConnection,
      workDomain,
      switchDomain,
      login,
      logout,
      createAgent,
      deleteAgent,
      updateBalance,
      refreshUser,
      updateAIConfig,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  const context = useContext(AppContext);
  if (context === undefined) {
    throw new Error('useApp must be used within an AppProvider');
  }
  return context;
}
