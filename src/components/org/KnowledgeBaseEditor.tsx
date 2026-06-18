import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Save, FileText, Tag, Loader2, BookOpen, AlertCircle, CheckCircle } from 'lucide-react';
import { useT } from '../../lib/useT';

interface Props {
  articleId?: string;
  onSaved?: () => void;
}

export function KnowledgeBaseEditor({ articleId, onSaved }: Props) {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
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
          if (!r.ok) throw new Error(data.error || ui(`文章加载失败（${r.status}）`, `Failed to load article (${r.status})`));
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
      setError(t.articleRequiredFields || ui('标题和正文不能为空', 'Title and content are required'));
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
      if (!res.ok) throw new Error(data.error || ui(`保存失败（${res.status}）`, `Save failed (${res.status})`));

      setSuccess(articleId ? (t.articleUpdated || ui('文章已更新', 'Article updated')) : (t.articleCreated || ui('文章已创建', 'Article created')));
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
    <div className="mx-auto max-w-3xl space-y-4 p-6">
      <div className="lumi-panel p-5">
        <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-[0.08em] text-white/90">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-blue-300/15 bg-blue-400/10 text-blue-300">
            <FileText size={24} />
          </span>
          {articleId ? (t.editArticle || ui('编辑文章', 'Edit Article')) : (t.newArticle || ui('新建文章', 'New Article'))}
        </h2>
      </div>

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
          placeholder={t.articleTitle || ui('文章标题...', 'Article title...')}
          className="lumi-field min-w-0 flex-1 focus:border-blue-500/40"
        />
        <select
          value={category}
          onChange={e => setCategory(e.target.value)}
          className="lumi-field text-sm text-white/70"
        >
          <option value="general">{t.catGeneral || ui('通用', 'General')}</option>
          <option value="policy">{t.catPolicy || ui('制度', 'Policy')}</option>
          <option value="sop">{t.catSOP || 'SOP'}</option>
          <option value="product">{t.catProduct || ui('产品', 'Product')}</option>
          <option value="culture">{t.catCulture || ui('文化', 'Culture')}</option>
          <option value="hr">{t.catHR || 'HR'}</option>
          <option value="tech">{t.catTechnical || ui('技术', 'Technical')}</option>
        </select>
        <select
          value={status}
          onChange={e => setStatus(e.target.value as any)}
          className="lumi-field text-sm text-white/70"
        >
          <option value="draft">{t.draftStatus || ui('草稿', 'Draft')}</option>
          <option value="published">{t.publishedStatus || ui('已发布', 'Published')}</option>
        </select>
      </div>

      <div className="flex items-center gap-2">
        <Tag size={14} className="text-white/55" />
        <input
          value={tags}
          onChange={e => setTags(e.target.value)}
          placeholder={t.tagsCommaSeparated || ui('标签（用逗号分隔）', 'Tags (comma separated)')}
          className="lumi-field min-w-0 flex-1 rounded-lg text-sm focus:border-blue-500/40"
        />
      </div>

      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder={t.writeArticleContent || ui('在这里编写文章内容，支持 Markdown。', 'Write your article content here... Markdown supported.')}
        className="lumi-field h-64 w-full resize-y font-mono text-sm focus:border-blue-500/40"
      />

      <div className="flex items-center gap-3">
        <button
          onClick={handleSave}
          disabled={saving || !title.trim() || !content.trim()}
          className="lumi-button-primary border-blue-400/25 bg-blue-500/15 text-blue-200 hover:bg-blue-500/25"
        >
          {saving ? <Loader2 size={16} className="animate-spin" /> : <Save size={16} />}
          {articleId ? (t.updateArticle || ui('更新文章', 'Update Article')) : (t.createArticle || ui('创建文章', 'Create Article'))}
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'kb' } }))}
          className="lumi-button"
        >
          <BookOpen size={16} /> {t.backToKB || ui('返回知识库', 'Back to KB')}
        </button>
      </div>
    </div>
  );
}
