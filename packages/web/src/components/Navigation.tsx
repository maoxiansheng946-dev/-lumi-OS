import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Sparkles, Menu, X, LogIn, LogOut, User, Wallet, Rocket, Shield, Globe, Github, Twitter, MessageSquare, Cpu } from 'lucide-react';
import { Button } from './ui/button';
import { useApp } from '../contexts/AppContext';
import { GlassCard } from './SharedUI';

import { usePlatform } from '@/hooks/usePlatform';

export function Navbar({ t }: { t: any }) {
  const [isOpen, setIsOpen] = useState(false);
  const { user, login, logout, loading } = useApp();
  const { platform, isElectron, isMobile } = usePlatform();

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between">
        {/* Logo */}
        <motion.div 
          initial={{ opacity: 0, x: -20 }}
          animate={{ opacity: 1, x: 0 }}
          className="flex items-center gap-3 group cursor-pointer"
          onClick={() => window.scrollTo({ top: 0, behavior: 'smooth' })}
        >
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-celestial-mars to-celestial-saturn flex items-center justify-center group-hover:rotate-12 transition-transform shadow-[0_0_20px_rgba(255,163,26,0.3)]">
            <Sparkles className="text-black" size={20} />
          </div>
          <div className="flex flex-col -space-y-1">
            <span className="text-2xl font-black tracking-tighter glow-text">LUMIAI</span>
            {(isElectron || isMobile) && (
              <span className="text-[8px] font-bold uppercase tracking-[0.2em] text-celestial-saturn opacity-80">
                {isElectron ? 'Desktop Node' : `${platform} client`}
              </span>
            )}
          </div>
        </motion.div>

        {/* Desktop Nav */}
        <div className="hidden md:flex items-center gap-8">
          <NavLink href="#docs">{t.docs}</NavLink>
          <NavLink href="#multimodal">{t.multimodal}</NavLink>
          <NavLink href="#generator">{t.generator}</NavLink>
          <NavLink href="#ecosystem">{t.ecosystem}</NavLink>
          
          <div className="h-6 w-px bg-white/10 mx-2" />

          {isElectron && (
            <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-celestial-saturn/10 border border-celestial-saturn/20">
              <div className="w-1.5 h-1.5 rounded-full bg-celestial-saturn animate-pulse" />
              <span className="text-[10px] font-bold uppercase tracking-widest text-celestial-saturn">Vault Synced</span>
            </div>
          )}

          {loading ? (
            <div className="w-32 h-10 rounded-full bg-white/5 animate-pulse" />
          ) : user ? (
            <div className="flex items-center gap-4">
              <div className="flex flex-col items-end">
                <span className="text-xs font-bold text-white/40 uppercase tracking-widest">Balance</span>
                <span className="text-sm font-black text-celestial-saturn">{user.balance.toFixed(2)} ETH</span>
              </div>
              <div className="relative group">
                <img 
                  src={user.photoURL || `https://api.dicebear.com/7.x/avataaars/svg?seed=${user.uid}`} 
                  alt={user.displayName}
                  className="w-10 h-10 rounded-full border-2 border-white/10 group-hover:border-celestial-saturn transition-colors cursor-pointer"
                />
                <div className="absolute top-full right-0 mt-2 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all">
                  <GlassCard className="p-4 rounded-2xl border-white/10 space-y-2">
                    <p className="text-sm font-bold truncate">{user.displayName}</p>
                    <button 
                      onClick={logout}
                      className="w-full flex items-center gap-2 text-xs text-red-400 hover:text-red-300 transition-colors py-2"
                    >
                      <LogOut size={14} />
                      Sign Out
                    </button>
                  </GlassCard>
                </div>
              </div>
            </div>
          ) : (
            <Button 
              onClick={login}
              className="bg-white text-black font-bold rounded-full px-6 hover:scale-105 transition-transform flex items-center gap-2"
            >
              <LogIn size={18} />
              Ascend
            </Button>
          )}
        </div>

        {/* Mobile Menu Toggle */}
        <button className="md:hidden text-white" onClick={() => setIsOpen(!isOpen)}>
          {isOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>

      {/* Mobile Menu */}
      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -20 }}
            className="absolute top-full left-0 right-0 bg-black/95 backdrop-blur-xl border-b border-white/10 p-6 md:hidden space-y-6"
          >
            <div className="flex flex-col gap-4">
              <MobileNavLink href="#docs" onClick={() => setIsOpen(false)}>{t.docs}</MobileNavLink>
              <MobileNavLink href="#multimodal" onClick={() => setIsOpen(false)}>{t.multimodal}</MobileNavLink>
              <MobileNavLink href="#generator" onClick={() => setIsOpen(false)}>{t.generator}</MobileNavLink>
              <MobileNavLink href="#ecosystem" onClick={() => setIsOpen(false)}>{t.ecosystem}</MobileNavLink>
            </div>
            
            <div className="pt-6 border-t border-white/10">
              {user ? (
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-3">
                    <img src={user.photoURL} className="w-10 h-10 rounded-full" />
                    <div>
                      <p className="font-bold">{user.displayName}</p>
                      <p className="text-xs text-celestial-saturn">{user.balance.toFixed(2)} ETH</p>
                    </div>
                  </div>
                  <Button onClick={logout} variant="ghost" className="text-red-400">
                    <LogOut size={18} />
                  </Button>
                </div>
              ) : (
                <Button onClick={login} className="w-full bg-white text-black font-bold">
                  Ascend
                </Button>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </nav>
  );
}

function NavLink({ href, children }: { href: string; children: React.ReactNode }) {
  return (
    <a 
      href={href} 
      className="text-sm font-bold text-white/60 hover:text-white transition-colors uppercase tracking-widest"
    >
      {children}
    </a>
  );
}

function MobileNavLink({ href, children, onClick }: { href: string; children: React.ReactNode; onClick: () => void }) {
  return (
    <a 
      href={href} 
      onClick={onClick}
      className="text-xl font-bold text-white/60 hover:text-white transition-colors block"
    >
      {children}
    </a>
  );
}

export function Footer({ t }: { t: any }) {
  const { isWeb, isElectron, isMobile } = usePlatform();

  return (
    <footer className="py-20 px-6 border-t border-white/5 relative overflow-hidden">
      <div className="absolute top-0 left-1/2 -translate-x-1/2 w-full h-px bg-gradient-to-r from-transparent via-celestial-saturn/50 to-transparent" />
      
      <div className="max-w-7xl mx-auto grid md:grid-cols-4 gap-12">
        <div className="space-y-6">
          <div className="flex items-center gap-2">
            <Sparkles className="text-celestial-saturn" size={24} />
            <span className="text-2xl font-black tracking-tighter">LUMIAI</span>
          </div>
          <p className="text-sm text-white/40 leading-relaxed">
            Synthesizing digital immortality through neural resonance and celestial architecture.
          </p>
          <div className="flex gap-4">
            <SocialIcon icon={<Twitter size={18} />} />
            <SocialIcon icon={<Github size={18} />} />
            <SocialIcon icon={<MessageSquare size={18} />} />
          </div>
        </div>

        <div>
          <h4 className="font-bold mb-6 uppercase tracking-widest text-xs text-white/20">Protocol</h4>
          <ul className="space-y-4 text-sm text-white/60">
            <li><FooterLink>Neural Core</FooterLink></li>
            <li><FooterLink>Spirit Engine</FooterLink></li>
            <li><FooterLink>Marketplace</FooterLink></li>
            <li><FooterLink>Docs</FooterLink></li>
          </ul>
        </div>

        <div>
          <h4 className="font-bold mb-6 uppercase tracking-widest text-xs text-white/20">Company</h4>
          <ul className="space-y-4 text-sm text-white/60">
            <li><FooterLink>About</FooterLink></li>
            <li><FooterLink>Vision</FooterLink></li>
            <li><FooterLink>Privacy</FooterLink></li>
            <li><FooterLink>Terms</FooterLink></li>
          </ul>
        </div>

        <div className="space-y-6">
          <h4 className="font-bold uppercase tracking-widest text-xs text-white/20">Newsletter</h4>
          <div className="flex gap-2">
            <input 
              type="email" 
              placeholder="Enter email" 
              className="bg-white/5 border border-white/10 rounded-xl px-4 py-2 text-sm focus:outline-none focus:border-celestial-saturn/50 transition-colors flex-1"
            />
            <Button className="bg-celestial-saturn text-black font-bold rounded-xl px-4">
              Join
            </Button>
          </div>
          <p className="text-[10px] text-white/20">
            By joining, you agree to our neural data processing protocols.
          </p>
        </div>
      </div>

        <div className="max-w-7xl mx-auto mt-20 pt-8 border-t border-white/5 flex flex-col md:flex-row justify-between items-center gap-8 text-[10px] uppercase tracking-widest text-white/20 font-bold">
          <p>© 2026 LUMIAI PROTOCOL. ALL RIGHTS RESERVED.</p>
          
          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-white/5 bg-white/5">
              <Globe size={10} className={isWeb ? 'text-celestial-saturn' : ''} />
              <span className={isWeb ? 'text-white' : ''}>Web Portal</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-white/5 bg-white/5">
              <Cpu size={10} className={isElectron ? 'text-celestial-saturn' : ''} />
              <span className={isElectron ? 'text-white' : ''}>Desktop Node</span>
            </div>
            <div className="flex items-center gap-2 px-3 py-1 rounded-full border border-white/5 bg-white/5">
              <Shield size={10} className={isMobile ? 'text-celestial-saturn' : ''} />
              <span className={isMobile ? 'text-white' : ''}>Mobile Sense</span>
            </div>
          </div>

          <div className="flex gap-8">
            <span>Status: Operational</span>
            <span>Version: 2.4.0-Celestial</span>
          </div>
        </div>
    </footer>
  );
}

function FooterLink({ children }: { children: React.ReactNode }) {
  return (
    <a href="#" className="hover:text-celestial-saturn transition-colors">
      {children}
    </a>
  );
}

function SocialIcon({ icon }: { icon: React.ReactNode }) {
  return (
    <a href="#" className="w-10 h-10 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-white/40 hover:text-celestial-saturn hover:border-celestial-saturn/50 transition-all">
      {icon}
    </a>
  );
}
