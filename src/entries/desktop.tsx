// Desktop entry — fullscreen transparent Tauri WebView2 OS shell
import { useState, useEffect } from 'react';
import { ProactiveNotifications } from '../components/ProactiveNotifications';
import { LoginModal } from '../core/components/Auth';
import { Toaster } from 'sonner';
import { motion } from 'motion/react';
import { Rocket } from 'lucide-react';
import { installApiBridge } from '../services/apiBridge';
import '@fontsource-variable/geist';
import '../index.css';
import { DesktopUI } from '../components/DesktopUI';
import { LumiEcosystem } from '../components/LumiEcosystem';
import { SkillHall } from '../components/SkillHall';
import { AgentChatPage } from '../components/AgentChatPage';
import { LoginRequired } from '../core/components/Auth';
import { Settings } from '../components/Settings';
import { Profile } from '../components/Profile';
import { Docs } from '../components/Docs';
import { FoundersSanctuary } from '../components/FoundersSanctuary';
import { OrgPortal } from '../components/OrgPortal';
import { SetupWizard } from '../components/SetupWizard';
import { useAppShell } from './useAppShell';

installApiBridge();

const SETUP_DONE_KEY = 'lumi_setup_complete';

export function DesktopApp() {
  const shell = useAppShell();
  const [activeTab, setActiveTab] = useState('home');
  const [selectedAgent, setSelectedAgent] = useState<any>(null);
  const [showSetup, setShowSetup] = useState(() => localStorage.getItem(SETUP_DONE_KEY) !== '1');

  useEffect(() => { document.body.classList.add('overflow-hidden'); return () => document.body.classList.remove('overflow-hidden'); }, []);
  useEffect(() => { window.scrollTo(0, 0); }, [activeTab]);

  if (shell.loading) {
    return (
      <div className="flex items-center justify-center h-screen bg-transparent">
        <motion.div animate={{ scale: [1, 1.1, 1], opacity: [0.5, 1, 0.5] }} transition={{ duration: 2, repeat: Infinity }} className="flex flex-col items-center gap-4">
          <Rocket size={48} className="text-celestial-saturn" />
          <div className="text-xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-celestial-mars to-celestial-saturn">Lumi OS Booting...</div>
        </motion.div>
      </div>
    );
  }

  const renderTabContent = (tab: string) => {
    switch (tab) {
      case 'home': return null;
      case 'ecosystem': return <div className="space-y-24"><LumiEcosystem t={shell.t} onChatAgent={(a: any) => { setSelectedAgent(a); setActiveTab('agent-chat'); }} /><SkillHall t={shell.t} lang={shell.lang} /></div>;
      case 'generate': return !shell.user ? <LoginRequired t={shell.t} onLogin={shell.handleLogin} /> : <SkillHall t={shell.t} lang={shell.lang} initialTab="generate" />;
      case 'agent-chat': return !shell.user ? <LoginRequired t={shell.t} onLogin={shell.handleLogin} /> : <AgentChatPage t={shell.t} user={shell.user} agent={selectedAgent} isOpen={true} onClose={() => setActiveTab('ecosystem')} />;
      case 'docs': return <Docs t={shell.t} />;
      case 'founders': return <FoundersSanctuary t={shell.t} user={shell.user} onBack={() => setActiveTab('home')} />;
      case 'profile': return !shell.user ? <LoginRequired t={shell.t} onLogin={shell.handleLogin} /> : <Profile t={shell.t} />;
      case 'org': return !shell.user ? <LoginRequired t={shell.t} onLogin={shell.handleLogin} /> : <OrgPortal />;
      case 'settings': return !shell.user ? <LoginRequired t={shell.t} onLogin={shell.handleLogin} /> : <Settings t={shell.t} lang={shell.lang} setLang={shell.setLang} />;
      case 'voice': case 'memory': case 'mcp': case 'personality': case 'sync':
        return !shell.user ? <LoginRequired t={shell.t} onLogin={shell.handleLogin} /> : <Settings t={shell.t} lang={shell.lang} setLang={shell.setLang} activeSection={tab} />;
      default: return null;
    }
  };

  return (
    <div className="h-screen w-full bg-transparent overflow-hidden">
      <ProactiveNotifications />
      <Toaster position="top-right" theme="dark" />
      {showSetup ? (
        <div className="h-full w-full flex items-center justify-center bg-black/80 p-8">
          <SetupWizard onFinish={() => { setShowSetup(false); localStorage.setItem(SETUP_DONE_KEY, '1'); }} />
        </div>
      ) : (
        <>
          <motion.div initial={{ scale: 0.95, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ duration: 0.5 }} className="h-full w-full">
            <DesktopUI t={shell.t} user={shell.user} lang={shell.lang} setLang={shell.setLang} activeTab={activeTab} setActiveTab={setActiveTab}
              onLogin={shell.handleLogin} renderTabContent={renderTabContent} />
          </motion.div>
          <LoginModal t={shell.t} isOpen={shell.isLoginModalOpen} onClose={() => shell.setIsLoginModalOpen(false)} onLoginSuccess={() => shell.refreshUser()} onGoogleLogin={shell.handleLogin} />
        </>
      )}
    </div>
  );
}
