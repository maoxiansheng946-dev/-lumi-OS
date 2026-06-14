import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Save, FileText, Tag, Loader2, BookOpen, AlertCircle, CheckCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { useT } from '../../lib/useT';

interface Props {
  articleId?: string;
  onSaved?: () => void;
}

export function KnowledgeBaseEditor({ articleId, onSaved }: Props) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [category, setCategory] = useState('general');
  const [tags, setTags] = useState('');
  const [status, setStatus] = useState<'draft' | 'published'>('draft');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setError('');
    setSuccess('');
    if (articleId) {
      setLoading(true);
      fetch(`/api/org/kb/articles/${articleId}`, { credentials: 'include' })
        .then(async r => {
          const data = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(data.error || `Failed to load article (${r.status})`);
          return data;
        })
        .then(a => {
          setTitle(a.title || '');
          setContent(a.content || '');
          setCategory(a.category || 'general');
          setStatus(a.status || 'draft');
          try { setTags(JSON.parse(a.tags).join(', ')); } catch { setTags(''); }
        })
        .catch((err: any) => setError(err.message || String(err)))
        .finally(() => setLoading(false));
    } else {
      setTitle('');
      setContent('');
      setCategory('general');
      setTags('');
      setStatus('draft');
    }
  }, [articleId]);

  const handleSave = async () => {
    if (!title.trim() || !content.trim()) {
      setError(t.articleRequiredFields || 'Title and content are required');
      return;
    }
    setSaving(true);
    setError('');
    setSuccess('');
    try {
      const url = articleId
        ? `/api/org/kb/articles/${articleId}`
        : '/api/org/kb/articles';
      const method = articleId ? 'PUT' : 'POST';
      const tagArr = tags.split(',').map(t => t.trim()).filter(Boolean);

      const res = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, content, category, tags: tagArr, status }),
        credentials: 'include',
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Save failed (${res.status})`);

      setSuccess(articleId ? (t.articleUpdated || 'Article updated') : (t.articleCreated || 'Article created'));
      if (!articleId) { setTitle(''); setContent(''); setTags(''); }
      setTimeout(() => onSaved?.(), 350);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally { setSaving(false); }
  };

  if (loading) {
    return (
      <div className="p-6 text-center text-white/55">
        <Loader2 size={24} className="mx-auto animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-4 max-w-3xl mx-auto">
      <h2 className="text-xl font-bold text-white flex items-center gap-2">
        <FileText size={24} className="text-blue-400" />
        {articleId ? (t.editArticle || 'Edit Article') : (t.newArticle || 'New Article')}
      </h2>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle size={16} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      <div className="flex items-center gap-3">
        <input
          value={title}
          onChange={e => setTitle(e.target.value)}
          placeholder={t.articleTitle || 'Article title...'}
          className="flex-1 px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/45 focus:outline-none focus:border-blue-500/40"
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white/70 text-sm focus:outline-none"
        >
          <option value="general">{t.catGeneral || 'General'}</option>
          <option value="policy">{t.catPolicy || 'Policy'}</option>
          <option value="sop">{t.catSOP || 'SOP'}</option>
          <option value="product">{t.catProduct || 'Product'}</option>
          <option value="culture">{t.catCulture || 'Culture'}</option>
          <option value="hr">{t.catHR || 'HR'}</option>
          <option value="tech">{t.catTechnical || 'Technical'}</option>
        </select>
        <select
          value={status}
          onChange={e => setStatus(e.target.value as any)}
          className="px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white/70 text-sm focus:outline-none"
        >
          <option value="draft">{t.draftStatus || 'Draft'}</option>
          <option value="published">{t.publishedStatus || 'Published'}</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <Tag size={14} className="text-white/55" />
        <input
          value={tags}
          onChange={e => setTags(e.target.value)}
          placeholder={t.tagsCommaSeparated || 'Tags (comma separated)'}
          className="flex-1 px-3 py-2 bg-white/5 border border-white/10 rounded-lg text-white text-sm placeholder:text-white/45 focus:outline-none focus:border-blue-500/40"
        />
      </div>

      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={t.writeArticleContent || 'Write your article content here... Markdown supported.'}
        className="w-full h-64 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-white/45 focus:outline-none focus:border-blue-500/40 resize-y font-mono"
      />

      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={saving || !title.trim() || !content.trim()}
          className="bg-blue-600 hover:bg-blue-500 text-white rounded-lg flex items-center gap-2"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {articleId ? (t.updateArticle || 'Update Article') : (t.createArticle || 'Create Article')}
        </Button>
        <Button
          onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'kb' } }))}
          className="bg-white/10 hover:bg-white/20 text-white/70 rounded-lg flex items-center gap-2"
        >
          <BookOpen size={16} /> {t.backToKB || 'Back to KB'}
        </Button>
      </div>
    </div>
  );
}
