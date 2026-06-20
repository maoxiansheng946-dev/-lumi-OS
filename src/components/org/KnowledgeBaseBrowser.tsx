import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { AnimatePresence, motion } from 'motion/react';
import {
  AlertCircle,
  BookOpen,
  ChevronRight,
  Clock,
  FileText,
  Loader2,
  Pencil,
  Plus,
  Search,
  Tag,
} from 'lucide-react';
import { useT } from '../../lib/useT';

interface Article {
  id: string;
  title: string;
  content: string;
  category: string;
  tags: string | string[];
  authorId: string;
  status: string;
  createdAt: string;
  updatedAt?: string;
}

interface SearchResult {
  articleId: string;
  title: string;
  chunk: string;
  score: number;
}

export function KnowledgeBaseBrowser() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');

  const loadArticles = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const res = await fetch('/api/org/kb/articles', { credentials: 'include' });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || ui(`文章加载失败（${res.status}）`, `Failed to load articles (${res.status})`));
      const list = Array.isArray(data) ? data : [];
      setArticles(list);
      setSelectedArticle(prev => {
        if (prev && list.some((item: Article) => item.id === prev.id)) {
          return list.find((item: Article) => item.id === prev.id) || prev;
        }
        return list[0] || null;
      });
    } catch (err: any) {
      setError(err.message || String(err));
      setArticles([]);
      setSelectedArticle(null);
    } finally {
      setLoading(false);
    }
  }, [ui]);

  useEffect(() => {
    loadArticles();
  }, [loadArticles]);

  const handleSearch = useCallback(async (query: string) => {
    if (!query.trim()) {
      setSearchResults([]);
      return;
    }
    setSearching(true);
    setError('');
    try {
      const res = await fetch('/api/org/kb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, limit: 10 }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || ui(`搜索失败（${res.status}）`, `Search failed (${res.status})`));
      setSearchResults(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || String(err));
      setSearchResults([]);
    } finally {
      setSearching(false);
    }
  }, [ui]);

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    if (value.trim().length >= 2) {
      handleSearch(value);
    } else {
      setSearchResults([]);
    }
  };

  const parseTags = (tags: Article['tags']): string[] => {
    if (Array.isArray(tags)) return tags;
    try {
      const parsed = JSON.parse(tags || '[]');
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return String(tags || '').split(',').map(tag => tag.trim()).filter(Boolean);
    }
  };

  const visibleArticles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (query.length < 2) return articles;
    const hitIds = new Set(searchResults.map(result => result.articleId));
    return articles.filter(article =>
      hitIds.has(article.id) ||
      article.title.toLowerCase().includes(query) ||
      article.content.toLowerCase().includes(query) ||
      article.category.toLowerCase().includes(query),
    );
  }, [articles, searchQuery, searchResults]);

  const goNew = () => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'kb-edit' } }));
  const goEdit = (articleId: string) => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'kb-edit', articleId } }));

  return (
    <div className="flex h-full flex-col gap-4 p-6 text-white">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-xl font-semibold text-white">
            <BookOpen size={22} className="text-blue-300" />
            {t.orgKB || ui('组织知识库', 'Knowledge Base')}
          </h2>
          <p className="mt-1 text-sm text-white/50">
            {ui('沉淀制度、项目资料、上传文件和团队经验，供组织 Lumi 检索调用。', 'Store policies, project files, uploads, and team knowledge for organization Lumi.')}
          </p>
        </div>
        <button
          onClick={goNew}
          className="inline-flex items-center gap-2 rounded-lg border border-blue-400/20 bg-blue-500/15 px-3 py-2 text-sm font-medium text-blue-100 transition hover:bg-blue-500/25"
        >
          <Plus size={15} />
          {ui('新建文章', 'New Article')}
        </button>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="grid min-h-0 flex-1 gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="flex min-h-0 flex-col rounded-lg border border-white/10 bg-white/[0.04]">
          <div className="border-b border-white/10 p-3">
            <div className="relative">
              <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/45" />
              <input
                value={searchQuery}
                onChange={event => handleSearchInput(event.target.value)}
                placeholder={ui('搜索组织知识库...', 'Search organization knowledge...')}
                className="w-full rounded-lg border border-white/10 bg-black/20 py-2 pl-9 pr-9 text-sm text-white outline-none placeholder:text-white/35 focus:border-blue-400/35"
              />
              {searching && <Loader2 size={15} className="absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-white/50" />}
            </div>
          </div>

          <AnimatePresence>
            {searchResults.length > 0 && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="border-b border-blue-400/10 bg-blue-500/5"
              >
                <div className="space-y-1 p-3">
                  <p className="text-xs text-blue-100/65">{ui('语义搜索命中', 'Semantic matches')}</p>
                  {searchResults.slice(0, 3).map((result, index) => (
                    <button
                      key={`${result.articleId}-${index}`}
                      onClick={() => {
                        const article = articles.find(item => item.id === result.articleId);
                        if (article) setSelectedArticle(article);
                      }}
                      className="w-full rounded-lg px-2 py-2 text-left transition hover:bg-white/5"
                    >
                      <span className="block truncate text-xs font-medium text-white/85">{result.title}</span>
                      <span className="mt-1 line-clamp-2 block text-xs leading-5 text-white/45">{result.chunk}</span>
                    </button>
                  ))}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          <div className="min-h-0 flex-1 overflow-y-auto p-2">
            {loading ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 text-sm text-white/50">
                <Loader2 size={22} className="animate-spin" />
                <span>{ui('正在加载文章...', 'Loading articles...')}</span>
              </div>
            ) : visibleArticles.length === 0 ? (
              <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center text-sm text-white/45">
                <FileText size={30} className="text-white/20" />
                <span>{ui('还没有可显示的组织资料', 'No organization knowledge to show yet')}</span>
              </div>
            ) : (
              visibleArticles.map(article => {
                const active = selectedArticle?.id === article.id;
                return (
                  <button
                    key={article.id}
                    onClick={() => setSelectedArticle(article)}
                    className={`mb-2 w-full rounded-lg border p-3 text-left transition ${
                      active
                        ? 'border-blue-400/30 bg-blue-500/10'
                        : 'border-white/5 bg-white/[0.03] hover:border-white/10 hover:bg-white/[0.06]'
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-white">{article.title}</p>
                        <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{article.content}</p>
                      </div>
                      <ChevronRight size={14} className="mt-1 shrink-0 text-white/35" />
                    </div>
                    <div className="mt-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-md bg-white/5 px-2 py-1 text-xs text-white/45">{article.category || ui('未分类', 'Uncategorized')}</span>
                      {parseTags(article.tags).slice(0, 2).map(tag => (
                        <span key={tag} className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-xs text-white/50">
                          <Tag size={10} />
                          {tag}
                        </span>
                      ))}
                    </div>
                  </button>
                );
              })
            )}
          </div>
        </section>

        <section className="min-h-0 overflow-hidden rounded-lg border border-white/10 bg-white/[0.04]">
          {selectedArticle ? (
            <div className="flex h-full min-h-0 flex-col">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 p-5">
                <div className="min-w-0 flex-1">
                  <h3 className="text-lg font-semibold text-white">{selectedArticle.title}</h3>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-white/45">
                    <span className="rounded-md bg-blue-500/10 px-2 py-1 text-blue-200">{selectedArticle.category || ui('未分类', 'Uncategorized')}</span>
                    <span className="inline-flex items-center gap-1">
                      <Clock size={12} />
                      {new Date(selectedArticle.updatedAt || selectedArticle.createdAt).toLocaleDateString(isZh ? 'zh-CN' : undefined)}
                    </span>
                    <span>{selectedArticle.status || 'published'}</span>
                  </div>
                </div>
                <button
                  onClick={() => goEdit(selectedArticle.id)}
                  className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
                >
                  <Pencil size={14} />
                  {ui('编辑', 'Edit')}
                </button>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-5">
                <div className="mb-4 flex flex-wrap gap-2">
                  {parseTags(selectedArticle.tags).map(tag => (
                    <span key={tag} className="inline-flex items-center gap-1 rounded-md border border-white/10 bg-white/5 px-2 py-1 text-xs text-white/55">
                      <Tag size={10} />
                      {tag}
                    </span>
                  ))}
                </div>
                <article className="whitespace-pre-wrap text-sm leading-7 text-white/72">
                  {selectedArticle.content}
                </article>
              </div>
            </div>
          ) : (
            <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center text-white/45">
              <BookOpen size={34} className="text-white/20" />
              <p className="text-sm">{ui('选择一篇文章查看详情，或新建组织知识。', 'Select an article to view details, or create organization knowledge.')}</p>
              <button
                onClick={goNew}
                className="rounded-lg border border-blue-400/20 bg-blue-500/10 px-3 py-2 text-sm text-blue-100 transition hover:bg-blue-500/20"
              >
                {ui('新建文章', 'New Article')}
              </button>
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
