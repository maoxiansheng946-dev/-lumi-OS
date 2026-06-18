import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Package, Search, Download, Star, Clock, Tag,
  Loader2, ExternalLink, CheckCircle, AlertCircle, Send,
} from 'lucide-react';
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
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const socket = useSocket();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [filtered, setFiltered] = useState<Template[]>([]);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<Template | null>(null);
  const [installing, setInstalling] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

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
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback({ type: 'error', text: data.error || `${t.templateLoadFailed || ui('模板加载失败', 'Failed to load templates')} (${res.status})` });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
    } finally { setLoading(false); }
  };

  const handleInstall = async (templateId: string) => {
    setInstalling(templateId);
    setFeedback(null);
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
        window.dispatchEvent(new CustomEvent('lumi:agents-changed', { detail: { agent: data.agent } }));
        setFeedback({
          type: 'success',
          text: data.alreadyInstalled
            ? ui(`已安装过，正在使用现有智能体：${data.agent?.name || data.template.name}`, `Already installed. Using existing agent: ${data.agent?.name || data.template.name}`)
            : `${t.templateAdded || ui('模板已添加到你的智能体', 'Template added to your agents')}: ${data.agent?.name || data.template.name}`,
        });
      } else {
        const data = await res.json().catch(() => ({}));
        setFeedback({ type: 'error', text: data.error || `${t.templateInstallFailed || ui('模板安装失败', 'Template install failed')} (${res.status})` });
      }
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
    } finally { setInstalling(null); }
  };

  const categories = [...new Set(templates.map(t => t.category))];

  return (
    <div className="space-y-6 p-6">
      <div className="lumi-panel flex items-start justify-between gap-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-[0.08em] text-white/90">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-purple-300/15 bg-purple-400/10 text-purple-300">
              <Package size={24} />
            </span>
            {t.templateMarketplace || ui('模板市场', 'Template Marketplace')}
          </h2>
          <p className="mt-1 text-sm text-white/40">{t.templateMarketplaceDesc || ui('发现并安装组织内的智能体模板', 'Discover and install agent templates from your organization')}</p>
        </div>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'templates-create' } }))}
          className="lumi-button-primary shrink-0 border-purple-400/25 bg-purple-500/15 text-purple-200 hover:bg-purple-500/25"
        >
          <Send size={14} />
          {t.submitTemplate || ui('提交模板', 'Submit Template')}
        </button>
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
          feedback.type === 'success'
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/20 bg-red-500/10 text-red-300'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3">
        <div className="relative flex-1">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/55" />
          <input
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder={t.searchTemplates || ui('搜索模板...', 'Search templates...')}
            className="lumi-field h-10 w-full rounded-lg py-2 pl-9 pr-4 text-sm focus:border-purple-500/40"
          />
        </div>
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="lumi-field h-10 rounded-lg text-sm text-white/60"
        >
          <option value="">{t.allCategoriesFilter || ui('全部分类', 'All Categories')}</option>
          {categories.map(c => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {/* Grid */}
      {loading ? (
        <div className="lumi-panel py-12 text-center text-white/55"><Loader2 size={24} className="mx-auto animate-spin" /></div>
      ) : filtered.length === 0 ? (
        <div className="lumi-panel py-12 text-center text-white/55">
          <Package size={32} className="mx-auto mb-2 opacity-30" />
          {t.noTemplatesFound || ui('未找到模板', 'No templates found')}
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-4">
          {filtered.map(template => (
            <motion.div
              key={template.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              onClick={() => setSelected(template)}
              className="lumi-panel group cursor-pointer p-5 transition-colors hover:border-purple-500/25 hover:bg-white/[0.07]"
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
            className="lumi-surface w-full max-w-md rounded-2xl p-8"
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
                <Download size={12} /> {selected.downloadCount} {t.numInstalls || ui('次安装', 'installs')}
              </span>
              <span className="text-xs text-white/40 flex items-center gap-1">
                <Clock size={12} /> v{selected.version}
              </span>
            </div>

            <button
              onClick={() => handleInstall(selected.id)}
              disabled={installing === selected.id}
              className="lumi-button-primary w-full border-purple-400/25 bg-purple-500/15 py-3 text-purple-200 hover:bg-purple-500/25"
            >
              {installing === selected.id ? (
                <Loader2 size={16} className="animate-spin" />
              ) : (
                <Download size={16} />
              )}
              {installing === selected.id ? (t.installingTemplate || ui('安装中...', 'Installing...')) : (t.installTemplate || ui('安装模板', 'Install Template'))}
            </button>

            {feedback?.type === 'success' && (
              <p className="text-center text-green-400 text-xs mt-2 flex items-center justify-center gap-1">
                <CheckCircle size={12} /> {feedback.text}
              </p>
            )}
          </motion.div>
        </motion.div>
      )}
    </div>
  );
}
