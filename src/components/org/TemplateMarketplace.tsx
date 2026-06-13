import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Package, Search, Download, Star, Clock, Tag,
  Loader2, ExternalLink, CheckCircle,
} from 'lucide-react';
import { Button } from '../ui/button';
import { useT } from '../../lib/useT';
import { useSocket } from '../../hooks/useSocket';

interface Template {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  status: string;
  authorId: string;
  downloadCount: number;
  version: number;
  createdAt: string;
}

export function TemplateMarketplace() {
  const t = useT();
  const socket = useSocket();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filtered, setFiltered] = useState<Template[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Template | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);

  useEffect(() => { loadTemplates(); }, []);

  useEffect(() => {
    if (!socket) return;
    const onPublished = () => loadTemplates();
    const onStatus = () => loadTemplates();
    socket.on('template:published', onPublished);
    socket.on('template:status', onStatus);
    return () => {
      socket.off('template:published', onPublished);
      socket.off('template:status', onStatus);
    };
  }, [socket]);

  useEffect(() => {
    let result = templates;
    if (search) {
      result = result.filter(t =>
        t.name.toLowerCase().includes(search.toLowerCase()) ||
        t.description.toLowerCase().includes(search.toLowerCase())
      );
    }
    if (category) result = result.filter(t => t.category === category);
    setFiltered(result);
  }, [search, category, templates]);

  const loadTemplates = async () => {
    try {
      const res = await fetch('/api/org/templates?status=published', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTemplates(data);
        setFiltered(data);
      }
    } catch {} finally { setLoading(false); }
  };

  const handleInstall = async (templateId: string) => {
    setInstalling(templateId);
    try {
      const res = await fetch(`/api/org/templates/${templateId}/install`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
      });
      if (res.ok) {
        const data = await res.json();
        // Refresh list to update download count
        loadTemplates();
        alert(`${t.templateAdded || 'Template added to your agents'}: ${data.template.name}`);
      }
    } catch {} finally { setInstalling(null); }
  };

  const categories = [...new Set(templates.map(t => t.category))];

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <Package size={24} className="text-purple-400" />
          {t.templateMarketplace || 'Template Marketplace'}
        </h2>
        <p className="text-white/40 text-sm">{t.templateMarketplaceDesc || 'Discover and install agent templates from your organization'}</p>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/55" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.searchTemplates || 'Search templates...'}
            className="w-full pl-9 pr-4 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/45 focus:outline-none focus:border-purple-500/40"
          />
        </div>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white/60 text-sm"
        >
          <option value="">{t.allCategoriesFilter || 'All Categories'}</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="text-center py-12 text-white/55"><Loader2 size={24} className="mx-auto animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="text-center py-12 text-white/55">
          <Package size={32} className="mx-auto mb-2 opacity-30" />
          {t.noTemplatesFound || 'No templates found'}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filtered.map(template => (
            <motion.div
              key={template.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => setSelected(template)}
              className="bg-white/5 border border-white/10 rounded-xl p-5 hover:bg-white/[0.07] hover:border-purple-500/20 transition-all cursor-pointer group"
            >
              <div className="flex items-start justify-between mb-3">
                <span className="text-2xl">{template.icon || 'Bot'}</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-purple-500/10 text-purple-400">
                  v{template.version}
                </span>
              </div>
              <h3 className="text-white font-medium group-hover:text-purple-400 transition-colors">
                {template.name}
              </h3>
              <p className="text-white/40 text-xs mt-1 line-clamp-2">{template.description}</p>
              <div className="flex items-center gap-3 mt-3">
                <span className="text-xs px-2 py-0.5 rounded-full bg-white/5 text-white/40 flex items-center gap-1">
                  <Tag size={10} /> {template.category}
                </span>
                <span className="text-xs text-white/55 flex items-center gap-1">
                  <Download size={10} /> {template.downloadCount}
                </span>
              </div>
            </motion.div>
          ))}
        </div>
      )}

      {/* Detail panel */}
      {selected && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-6"
          onClick={() => setSelected(null)}
        >
          <motion.div
            initial={{ scale: 0.95 }}
            animate={{ scale: 1 }}
            onClick={e => e.stopPropagation()}
            className="bg-celestial-deep border border-white/10 rounded-2xl p-8 max-w-md w-full"
          >
            <div className="text-center mb-6">
              <span className="text-4xl">{selected.icon || 'Bot'}</span>
              <h3 className="text-xl font-bold text-white mt-3">{selected.name}</h3>
              <p className="text-white/40 text-sm mt-1">{selected.description}</p>
            </div>

            <div className="flex items-center justify-center gap-4 mb-6">
              <span className="text-xs text-white/40 flex items-center gap-1">
                <Tag size={12} /> {selected.category}
              </span>
              <span className="text-xs text-white/40 flex items-center gap-1">
                <Download size={12} /> {selected.downloadCount} {t.numInstalls || 'installs'}
              </span>
              <span className="text-xs text-white/40 flex items-center gap-1">
                <Clock size={12} /> v{selected.version}
              </span>
            </div>

            <Button
              onClick={() => handleInstall(selected.id)}
              disabled={installing === selected.id}
              className="w-full bg-purple-600 hover:bg-purple-500 text-white rounded-xl py-3 flex items-center justify-center gap-2"
            >
              {installing === selected.id ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              {installing === selected.id ? (t.installingTemplate || 'Installing...') : (t.installTemplate || 'Install Template')}
            </Button>

            {installing === selected.id && (
              <p className="text-center text-green-400 text-xs mt-2 flex items-center justify-center gap-1">
                <CheckCircle size={12} /> {t.templateAdded || 'Template added to your agents'}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
