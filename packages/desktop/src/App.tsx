import React, { useState, useEffect, lazy, Suspense } from 'react';
import { setLang } from './lib/useT';
import * as authService from './services/authService';
import { Settings } from './components/Settings';
import { AgentChatPage } from './components/AgentChatPage';
import { SkillMarketplace } from './components/SkillMarketplace';
import { LumiEcosystem } from './components/LumiEcosystem';
import { EnterpriseHub } from './components/enterprise/EnterpriseHub';
import { Profile } from './components/Profile';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProactiveNotifications } from './components/ProactiveNotifications';
import { LoadingFallback } from './components/LoadingFallback';
import { Toaster } from 'sonner';
import { motion } from 'motion/react';
import { Rocket } from 'lucide-react';
import { translations } from './lib/translations';
import { useApp } from './contexts/AppContext';
import { LoginRequired, LoginModal } from './core/components/Auth';

const DesktopPlatform = lazy(() => import('./platforms/desktop/DesktopPlatform').then(m => ({ default: m.DesktopPlatform })));

export default function App() {
  const { user, loading: appLoading, logout: appLogout, login: appLogin, refreshUser } = useApp();
  const [activeTab, setActiveTab] = useState('home');
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [lang, setLangState] = useState<'en' | 'zh'>('zh');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const t = translations[lang];

  useEffect(() => {
    setLang(lang);
  }, [lang]);

  useEffect(() => {
    document.body.classList.add('overflow-hidden');
    return () => document.body.classList.remove('overflow-hidden');
  }, []);

  useEffect(() => {
    const handler = () => setIsLoginModalOpen(true);
    window.addEventListener('lumi:open-login', handler);
    return () => window.removeEventListener('lumi:open-login', handler);
  }, []);

  const handleSetLang = (l: 'en' | 'zh') => setLangState(l);

  if (appLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-celestial-deep">
        <motion.div
          animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }}
          transition={{ duration: 2, repeat: Infinity }}
          className="flex flex-col items-center gap-4"
        >
          <Rocket size={48} className="text-celestial-saturn" />
          <div className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-celestial-mars to-celestial-saturn">
            {t.appInitializing || 'Lumi Core v2.0 Initializing...'}
          </div>
          <div className="text-[10px] text-white/20 font-mono uppercase tracking-widest">
            {t.validatingEthics}
          </div>
        </motion.div>
      </div>
    );
  }

  const renderTabContent = (tab: string) => {
    switch (tab) {
      case 'marketplace':
      case 'ecosystem':
        return (
          <div className="space-y-24">
            <LumiEcosystem t={t} onChatAgent={(agent: any) => { setSelectedAgent(agent); setActiveTab('agent-chat'); }} />
            <SkillMarketplace t={t} lang={lang} />
          </div>
        );
      case 'agent-chat':
        return !user ? <LoginRequired t={t} onLogin={() => setIsLoginModalOpen(true)} /> : <AgentChatPage t={t} user={user} agent={selectedAgent} isOpen={true} onClose={() => setActiveTab('ecosystem')} />;
      case 'enterprise':
        return !user ? <LoginRequired t={t} onLogin={() => setIsLoginModalOpen(true)} /> : <EnterpriseHub />;
      case 'settings':
        return !user ? <LoginRequired t={t} onLogin={() => setIsLoginModalOpen(true)} /> : <Settings t={t} lang={lang} setLang={handleSetLang} />;
      case 'profile':
        return !user ? <LoginRequired t={t} onLogin={() => setIsLoginModalOpen(true)} /> : <Profile t={t} />;
      case 'voice':
      case 'memory':
      case 'mcp':
      case 'personality':
      case 'sync':
        return !user ? <LoginRequired t={t} onLogin={() => setIsLoginModalOpen(true)} /> : <Settings t={t} lang={lang} setLang={handleSetLang} activeSection={tab} />;
      default:
        return null;
    }
  };

  return (
    <div className="min-h-screen overflow-x-hidden transition-all duration-1000 bg-transparent">
      <ErrorBoundary>
        <ProactiveNotifications />
        <Toaster position="top-right" theme="dark" />
        <Suspense fallback={<LoadingFallback />}>
          <DesktopPlatform
            t={t}
            user={user}
            lang={lang}
            setLang={handleSetLang}
            activeTab={activeTab}
            setActiveTab={setActiveTab}
            onLogin={() => setIsLoginModalOpen(true)}
            setUiMode={() => {}}
            renderTabContent={renderTabContent}
          />
        </Suspense>
        <LoginModal
          t={t}
          isOpen={isLoginModalOpen}
          onClose={() => setIsLoginModalOpen(false)}
          onLoginSuccess={() => refreshUser()}
          onGoogleLogin={() => setIsLoginModalOpen(true)}
        />
      </ErrorBoundary>
    </div>
  );
}
