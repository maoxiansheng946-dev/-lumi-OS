import React, { useState } from 'react';
import { useT } from '../../lib/useT';
import { Search, Loader2, FileText, MapPin, Hash } from 'lucide-react';

interface CaseResult {
  articleId: string;
  title: string;
  caseNumber?: string;
  court?: string;
  chunk: string;
  score: number;
  date?: string;
}

export function LegalCaseSearch() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<CaseResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [selected, setSelected] = useState<CaseResult | null>(null);

  const search = async () => {
    if (!query.trim() || loading) return;
    setLoading(true);
    setSearched(true);
    setSelected(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `使用 legal_search_case 工具检索：${query}`,
          stream: false,
        }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ui('类案检索失败', 'Case search failed'));
      const text = data.text || data.response || data.reply || data.message || '';

      // Parse structured results from LLM output
      const lines = text.split('\n');
      const parsed: CaseResult[] = [];
      let current: Partial<CaseResult> = {};
      for (const line of lines) {
        const match = line.match(/^\d+\.\s*\*\*(.+?)\*\*\s*\[相似度:\s*([\d.]+)\]/);
        if (match) {
          if (current.title) parsed.push(current as CaseResult);
          current = { title: match[1].trim(), score: parseFloat(match[2]), articleId: '', chunk: '' };
        } else if (line.includes('案号:')) {
          current.caseNumber = line.split('案号:')[1]?.split('|')[0]?.trim() || '';
        } else if (line.includes('法院:')) {
          current.court = line.split('法院:')[1]?.split('|')[0]?.trim() || '';
        } else if (line.includes('摘要:')) {
          current.chunk = line.split('摘要:')[1]?.trim() || '';
        }
      }
      if (current.title) parsed.push(current as CaseResult);

      if (parsed.length > 0) {
        setResults(parsed);
      } else {
        setResults([{ articleId: 'raw', title: t.legalCaseSearchResults, chunk: text, score: 0 }]);
      }
    } catch (e: any) {
      setResults([{ articleId: 'error', title: ui('检索失败', 'Error'), chunk: e.message, score: 0 }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <h2 className="text-xl font-bold text-white mb-2">{t.legalCaseSearchTitle}</h2>
      <p className="text-white/50 text-sm mb-4">{t.legalCaseSearchDesc}</p>

      <div className="flex gap-3 mb-6">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') search(); }}
          placeholder={t.legalCaseSearchPlaceholder}
          className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-amber-500/50"
        />
        <button
          onClick={search}
          disabled={loading || !query.trim()}
          className="px-5 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {t.legalCaseSearchSearch}
        </button>
      </div>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Results list */}
        <div className="w-72 flex-shrink-0 overflow-y-auto space-y-2">
          {searched && results.length === 0 && !loading && (
            <p className="text-white/35 text-sm">{t.legalCaseSearchNoResults}</p>
          )}
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => setSelected(r)}
              className={`w-full text-left p-3 rounded-xl transition-all ${
                selected?.articleId === r.articleId && selected?.title === r.title
                  ? 'bg-amber-500/10 border border-amber-500/30'
                  : 'bg-white/5 border border-white/5 hover:border-white/10'
              }`}
            >
              <div className="flex items-center gap-1.5 text-white/90 text-sm font-medium truncate">
                <FileText size={12} className="text-white/50 flex-shrink-0" />
                {r.title}
              </div>
              {r.caseNumber && (
                <div className="flex items-center gap-1 mt-1 text-white/35 text-xs">
                  <Hash size={10} /> {r.caseNumber}
                </div>
              )}
              {r.court && (
                <div className="flex items-center gap-1 text-white/35 text-xs">
                  <MapPin size={10} /> {r.court}
                </div>
              )}
              {r.score > 0 && (
                <div className="mt-1 text-xs text-amber-400">
                  {t.legalScore}: {(r.score * 100).toFixed(1)}%
                </div>
              )}
            </button>
          ))}
        </div>

        {/* Detail view */}
        <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 overflow-y-auto min-w-0">
          {selected ? (
            <div className="space-y-3">
              <h3 className="text-white font-bold">{selected.title}</h3>
              <div className="flex flex-wrap gap-3 text-xs text-white/40">
                {selected.caseNumber && <span className="flex items-center gap-1"><Hash size={10} /> {selected.caseNumber}</span>}
                {selected.court && <span className="flex items-center gap-1"><MapPin size={10} /> {selected.court}</span>}
                {selected.score > 0 && <span>{t.legalScore}: {(selected.score * 100).toFixed(1)}%</span>}
              </div>
              <div className="border-t border-white/5 pt-3 text-white/75 text-sm whitespace-pre-wrap leading-relaxed">
                {selected.chunk}
              </div>
            </div>
          ) : (
            <p className="text-white/25 text-sm italic">
              Select a case from the list to view details
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
