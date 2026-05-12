import React, { useState, useEffect, lazy, Suspense } from 'react';
import * as authService from './services/authService';
import { Navbar } from './components/Navbar';
import { UnifiedAgent } from './components/UnifiedAgent';
import { LumiEcosystem } from './components/LumiEcosystem';
import { JoinUs } from './components/JoinUs';
import { usePlatform } from './hooks/usePlatform';
import { LandingSections } from './components/LandingSections';
import { Footer } from './components/Footer';
import { Profile } from './components/Profile';
import { Settings } from './components/Settings';
import { Docs } from './components/Docs';
import { ProtocolsWorld } from './components/ProtocolsWorld';
import { AgentChatPage } from './components/AgentChatPage';
import { SkillMarketplace } from './components/SkillMarketplace';
import { MultimodalProducts } from './components/MultimodalProducts';
import { ProductDetailPage } from './components/ProductDetailPage';
import { Solutions } from './components/Solutions';
import { FoundersSanctuary } from './components/FoundersSanctuary';
import { LocalAgentSphere } from './components/LocalAgentSphere';
import { FloatingAgent } from './components/FloatingAgent';
import { ErrorBoundary } from './components/ErrorBoundary';
import { ProactiveNotifications } from './components/ProactiveNotifications';
import { LoadingFallback } from './components/LoadingFallback';
import { Toaster } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';
import { Rocket, Sparkles, Layout } from 'lucide-react';
import { translations } from './lib/translations';
import { useApp } from './contexts/AppContext';
import { LoginRequired, LoginModal } from './core/components/Auth';

const WebPlatform = lazy(() => import('./platforms/web/WebPlatform').then(m => ({ default: m.WebPlatform })));
const DesktopPlatform = lazy(() => import('./platforms/desktop/DesktopPlatform').then(m => ({ default: m.DesktopPlatform })));
const MobilePlatform = lazy(() => import('./platforms/mobile/MobilePlatform').then(m => ({ default: m.MobilePlatform })));

export default function App() {
  const { user, loading: appLoading, logout: appLogout, login: appLogin, refreshUser } = useApp();
  const { isDesktop } = usePlatform();
  const [uiMode, setUiMode] = useState<'web' | 'desktop' | 'mobile'>(() => {
    return isDesktop ? 'desktop' : 'web';
  });

  useEffect(() => {
    if (isDesktop) {
      setUiMode('desktop');
    }
  }, [isDesktop]);
  const [activeTab, setActiveTab] = useState('home');
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [selectedProduct, setSelectedProduct] = useState<any>(null);
  const [lang, setLang] = useState<'en' | 'zh'>('zh');
  const [isLoginModalOpen, setIsLoginModalOpen] = useState(false);

  const t = translations[lang];



  useEffect(() => {
    if (uiMode === 'desktop') {
      document.body.classList.add('overflow-hidden');
    } else {
      document.body.classList.remove('overflow-hidden');
    }
  }, [uiMode]);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, [activeTab, uiMode]);

  const handleLogout = async () => {
    await appLogout();
  };

  const handleLogin = async () => {
    setIsLoginModalOpen(true);
  };

  const handleGoogleLogin = async () => {
    setIsLoginModalOpen(true);
  };

  useEffect(() => {
    const handler = () => setIsLoginModalOpen(true);
    window.addEventListener('lumi:open-login', handler);
    return () => window.removeEventListener('lumi:open-login', handler);
  }, []);

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
      case 'home':
        return null; // Home is the desktop itself
      case 'protocols':
        return <ProtocolsWorld t={t} />;
      case 'marketplace':
      case 'ecosystem':
        return (
          <div className="space-y-24">
            <LumiEcosystem t={t} onChatAgent={(agent) => { setSelectedAgent(agent); setActiveTab('agent-chat'); }} />
            <SkillMarketplace t={t} />
          </div>
        );
      case 'agent-chat':
        return !user ? <LoginRequired t={t} onLogin={handleLogin} /> : <AgentChatPage t={t} user={user} agent={selectedAgent} isOpen={true} onClose={() => setActiveTab('ecosystem')} />;
      case 'multimodal':
        return <MultimodalProducts t={t} onSelectProduct={(product) => {
          setSelectedProduct(product);
          setActiveTab('product-detail');
        }} />;
      case 'product-detail':
        if (!selectedProduct) return <MultimodalProducts t={t} onSelectProduct={(product) => {
          setSelectedProduct(product);
          setActiveTab('product-detail');
        }} />;
        return (
          <ProductDetailPage 
            t={t} 
            product={selectedProduct} 
            onBack={() => setActiveTab('multimodal')} 
          />
        );
      case 'docs':
        return <Docs t={t} />;
      case 'solutions':
        return <Solutions t={t} />;
      case 'join':
        return <JoinUs t={t} />;
      case 'founders':
        return <FoundersSanctuary t={t} user={user} onBack={() => setActiveTab('home')} />;
      case 'profile':
        return !user ? <LoginRequired t={t} onLogin={handleLogin} /> : <Profile t={t} />;
      case 'settings':
        return !user ? <LoginRequired t={t} onLogin={handleLogin} /> : <Settings t={t} lang={lang} setLang={setLang} />;
      case 'voice':
      case 'memory':
      case 'mcp':
      case 'personality':
      case 'sync':
        return !user ? <LoginRequired t={t} onLogin={handleLogin} /> : <Settings t={t} lang={lang} setLang={setLang} activeSection={tab} />;
      default:
        return null;
    }
  };

  return (
    <div className={`min-h-screen overflow-x-hidden transition-all duration-1000 ${
      isDesktop && uiMode === 'desktop' 
        ? 'bg-transparent' 
        : isDesktop 
          ? 'bg-celestial-deep/90 backdrop-blur-3xl' 
          : 'bg-celestial-deep'
    }`}>
      <ErrorBoundary>
      <ProactiveNotifications />
      <Toaster position="top-right" theme="dark" />
      <Suspense fallback={<LoadingFallback />}>
        <AnimatePresence mode="wait">
          {uiMode === 'mobile' ? (
            <MobilePlatform
              t={t}
              user={user}
              lang={lang}
              setLang={setLang}
              onLogin={handleLogin}
              onExit={() => setUiMode('web')}
              renderTabContent={renderTabContent}
            />
          ) : uiMode === 'desktop' ? (
            <DesktopPlatform
              t={t}
              user={user}
              lang={lang}
              setLang={setLang}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              onLogin={handleLogin}
              setUiMode={setUiMode}
              renderTabContent={renderTabContent}
            />
          ) : (
            <WebPlatform
              user={user}
              activeTab={activeTab}
              setActiveTab={setActiveTab}
              lang={lang}
              setLang={setLang}
              t={t}
              onLogin={handleLogin}
              onLogout={handleLogout}
              renderTabContent={renderTabContent}
              isDesktop={isDesktop}
              setUiMode={setUiMode}
            />
          )}
        </AnimatePresence>
      </Suspense>

      <LoginModal 
        t={t} 
        isOpen={isLoginModalOpen} 
        onClose={() => setIsLoginModalOpen(false)} 
        onLoginSuccess={() => refreshUser()}
        onGoogleLogin={handleGoogleLogin}
      />
      
      {uiMode === 'web' && !isDesktop && <FloatingAgent t={t} />}
      </ErrorBoundary>
    </div>
  );
}
