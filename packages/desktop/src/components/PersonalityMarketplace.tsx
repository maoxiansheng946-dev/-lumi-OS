import React, { useState, useEffect, useCallback } from 'react';
import { Globe, Download, Check, Eye, Star, Tag } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import { motion, AnimatePresence } from 'motion/react';

interface CommunityPersonality {
  id: string;
  name: string;
  author: string;
  version: string;
  description: string;
  downloadCount: number;
  gistUrl: string;
  tags: string[];
}

export function PersonalityMarketplace({ t }: { t?: any }) {
  const [personalities, setPersonalities] = useState<CommunityPersonality[]>([]);
  const [installed, setInstalled] = useState<Set<string>>(new Set());
  const [installing, setInstalling] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [previewId, setPreviewId] = useState<string | null>(null);

  const fetchMarketplace = useCallback(async () => {
    try {
      const res = await fetch('/api/marketplace/personalities');
      const data = await res.json();
      setPersonalities(data);
    } catch {
      // marketplace unavailable
    } finally {
      setLoading(false);
    }
  }, []);

  // Also fetch locally installed personalities to mark already-installed
  const fetchInstalled = useCallback(async () => {
    try {
      const res = await fetch('/api/personalities');
      const data = await res.json();
      setInstalled(new Set(data.map((p: any) => p.id)));
    } catch {}
  }, []);

  useEffect(() => { fetchMarketplace(); fetchInstalled(); }, [fetchMarketplace, fetchInstalled]);

  const handleInstall = async (personality: CommunityPersonality) => {
    if (installed.has(personality.id)) {
      toast.success(`${personality.name} already installed`);
      return;
    }
    setInstalling(prev => new Set(prev).add(personality.id));
    try {
      const res = await fetch('/api/marketplace/personalities/install', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: personality.id, name: personality.name, gistUrl: personality.gistUrl }),
      });
      if (!res.ok) throw new Error('Install failed');
      setInstalled(prev => new Set(prev).add(personality.id));
      toast.success(`${personality.name} installed`);
    } catch (err: any) {
      toast.error(err.message);
    } finally {
      setInstalling(prev => {
        const next = new Set(prev);
        next.delete(personality.id);
        return next;
      });
    }
  };

  if (loading) {
    return (
      <div className="space-y-8 animate-in fade-in duration-500">
        <div className="flex items-center gap-3">
          <Globe className="text-celestial-saturn" />
          <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">Personality Market</h3>
        </div>
        <p className="text-white/40 text-sm">Loading community personalities...</p>
      </div>
    );
  }

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Globe className="text-celestial-saturn" />
          <h3 className="text-xl font-bold uppercase tracking-tighter text-white/90">Personality Market</h3>
        </div>
        <span className="text-[10px] text-white/20 font-mono">{personalities.length} available</span>
      </div>

      <p className="text-sm text-white/40 max-w-xl">
        Discover and install community-created AI personalities. Each personality has its own motivation,
        boundaries, expression style, and tool policy. Installed personalities appear in your editor.
      </p>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <AnimatePresence>
          {personalities.map(p => (
            <motion.div
              key={p.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="p-6 bg-white/5 rounded-3xl border border-white/5 hover:border-white/10 transition-all group"
            >
              {/* Header */}
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1 min-w-0">
                  <h4 className="font-bold text-white/90 text-sm">{p.name}</h4>
                  <span className="text-[10px] text-white/30 font-mono">by {p.author} · v{p.version}</span>
                </div>
                {installed.has(p.id) && (
                  <span className="flex items-center gap-1 px-2 py-1 bg-green-500/10 rounded-full text-[9px] font-bold uppercase text-green-400">
                    <Check size={10} /> Installed
                  </span>
                )}
              </div>

              <p className="text-xs text-white/50 leading-relaxed mb-4 line-clamp-2">{p.description}</p>

              {/* Tags */}
              <div className="flex items-center gap-2 flex-wrap mb-4">
                {p.tags.map(tag => (
                  <span key={tag} className="flex items-center gap-1 px-2 py-0.5 bg-white/5 rounded-full text-[9px] text-white/30">
                    <Tag size={8} /> {tag}
                  </span>
                ))}
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1 text-[10px] text-white/20">
                    <Download size={10} /> {p.downloadCount}
                  </span>
                  {previewId === p.id ? (
                    <button
                      onClick={() => setPreviewId(null)}
                      className="text-[10px] text-celestial-saturn hover:underline"
                    >
                      <Eye size={12} className="inline mr-0.5" /> Hide
                    </button>
                  ) : (
                    <button
                      onClick={() => setPreviewId(previewId === p.id ? null : p.id)}
                      className="text-[10px] text-white/30 hover:text-white/60"
                    >
                      <Eye size={12} className="inline mr-0.5" /> Preview
                    </button>
                  )}
                </div>

                <Button
                  onClick={() => handleInstall(p)}
                  disabled={installed.has(p.id) || installing.has(p.id)}
                  className={`text-[10px] font-bold px-3 py-1.5 h-auto rounded-xl transition-all ${
                    installed.has(p.id)
                      ? 'bg-green-500/20 text-green-400 cursor-default'
                      : installing.has(p.id)
                        ? 'bg-celestial-saturn/50 text-black cursor-wait'
                        : 'bg-celestial-saturn text-black hover:scale-105'
                  }`}
                >
                  {installed.has(p.id) ? (
                    <><Check size={12} className="mr-1" /> Installed</>
                  ) : installing.has(p.id) ? (
                    'Installing...'
                  ) : (
                    <><Download size={12} className="mr-1" /> Install</>
                  )}
                </Button>
              </div>

              {/* Preview */}
              <AnimatePresence>
                {previewId === p.id && (
                  <motion.div
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: 'auto', opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    className="overflow-hidden"
                  >
                    <div className="mt-4 pt-4 border-t border-white/5 space-y-2">
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-white/30">Version</span>
                        <span className="text-white/60 font-mono">{p.version}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-white/30">Author</span>
                        <span className="text-white/60">{p.author}</span>
                      </div>
                      <div className="flex items-center justify-between text-[10px]">
                        <span className="text-white/30">Downloads</span>
                        <span className="text-white/60">{p.downloadCount}</span>
                      </div>
                      {p.gistUrl && (
                        <div className="flex items-center justify-between text-[10px]">
                          <span className="text-white/30">Source</span>
                          <span className="text-celestial-saturn font-mono text-[9px] truncate max-w-[180px]">{p.gistUrl}</span>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {personalities.length === 0 && (
        <div className="p-16 bg-white/5 rounded-[2rem] border border-white/5 text-center">
          <Globe size={40} className="text-white/20 mx-auto mb-4" />
          <p className="text-white/40 font-bold uppercase tracking-widest text-sm">No community personalities yet</p>
          <p className="text-white/20 text-xs mt-2">Check back soon or share your own via GitHub Gist</p>
        </div>
      )}

      {/* Share section */}
      <div className="p-6 glass-dark rounded-[2rem] border border-white/5 space-y-4">
        <div className="flex items-center gap-3">
          <Star className="text-celestial-saturn" size={18} />
          <h4 className="text-sm font-bold uppercase tracking-tight text-white">Share Your Personality</h4>
        </div>
        <p className="text-[11px] text-white/30 leading-relaxed">
          Export a personality as JSON and share it via GitHub Gist. Tag it with
          <code className="text-white/50 mx-1">lumiOS-personality</code> to make it discoverable.
          Coming soon: automatic Gist publishing from the editor.
        </p>
      </div>
    </div>
  );
}
