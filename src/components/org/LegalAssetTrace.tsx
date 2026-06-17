import React, { useState } from 'react';
import { useT } from '../../lib/useT';
import { Search, Loader2, Building2, AlertTriangle, Network, FileText } from 'lucide-react';

interface TraceResult {
  company?: string;
  legalPerson?: string;
  capital?: string;
  status?: string;
  establishDate?: string;
  shareholders?: { name: string; ratio: number }[];
  enforcements?: { caseNumber: string; court: string; target: string; date: string }[];
  risks?: { type: string; count: number }[];
  raw?: string;
}

export function LegalAssetTrace() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const [name, setName] = useState('');
  const [result, setResult] = useState<TraceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'enforcement' | 'equity'>('info');

  const trace = async () => {
    if (!name.trim() || loading) return;
    setLoading(true);
    setResult(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `使用 legal_trace_assets 工具追踪被执行人"${name}"的财产线索，然后再使用 legal_equity_penetration 工具分析其股权结构。`,
          stream: false,
        }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ui('财产线索追踪失败', 'Asset trace failed'));
      const text = data.text || data.response || data.reply || data.message || '';

      const traceResult: TraceResult = { raw: text };

      // Parse company info
      const nameMatch = text.match(/名称[：:]\s*(.+)/);
      if (nameMatch) traceResult.company = nameMatch[1].trim();
      const personMatch = text.match(/法定代表人[：:]\s*(.+)/);
      if (personMatch) traceResult.legalPerson = personMatch[1].trim();
      const capMatch = text.match(/注册资本[：:]\s*(.+)/);
      if (capMatch) traceResult.capital = capMatch[1].trim();
      const statusMatch = text.match(/状态[：:]\s*(.+)/);
      if (statusMatch) traceResult.status = statusMatch[1].trim();

      // Parse shareholders
      const shareholders: { name: string; ratio: number }[] = [];
      const shRe = /[-•]\s*(.+?)[：:]\s*持股\s*(\d+)%/g;
      let m: RegExpExecArray | null;
      while ((m = shRe.exec(text)) !== null) {
        shareholders.push({ name: m[1].trim(), ratio: parseInt(m[2]) });
      }
      if (shareholders.length > 0) traceResult.shareholders = shareholders;

      // Parse enforcement records
      const enforcements: { caseNumber: string; court: string; target: string; date: string }[] = [];
      const enRe = /\[([^\]]+)\]\s*([^|]+)\|\s*立案[：:]?\s*([^|]*)\|\s*执行标的[：:]?\s*(.+)/g;
      let em: RegExpExecArray | null;
      while ((em = enRe.exec(text)) !== null) {
        enforcements.push({
          caseNumber: em[1].trim(),
          court: em[2].trim(),
          date: em[3].trim(),
          target: em[4].trim(),
        });
      }
      if (enforcements.length > 0) traceResult.enforcements = enforcements;

      setResult(traceResult);
    } catch (e: any) {
      setResult({ raw: ui('错误：', 'Error: ') + e.message });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <h2 className="text-xl font-bold text-white mb-2">{t.legalAssetTraceTitle}</h2>
      <p className="text-white/50 text-sm mb-4">{t.legalAssetTraceDesc}</p>

      <div className="flex gap-3 mb-4">
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') trace(); }}
          placeholder={t.legalAssetTracePlaceholder}
          className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-amber-500/50"
        />
        <button
          onClick={trace}
          disabled={loading || !name.trim()}
          className="px-5 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
        >
          {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
          {t.legalAssetTraceSearch}
        </button>
      </div>

      {result && (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tabs */}
          <div className="flex gap-1 mb-3 border-b border-white/5 pb-2">
            {([
              ['info', Building2, 'Enterprise Info'],
              ['enforcement', AlertTriangle, 'Enforcement'],
              ['equity', Network, 'Equity Structure'],
            ] as const).map(([tab, Icon, label]) => (
              <button
                key={tab}
                onClick={() => setActiveTab(tab)}
                className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm transition-all ${
                  activeTab === tab ? 'bg-amber-500/10 text-amber-400' : 'text-white/50 hover:text-white/70'
                }`}
              >
                <Icon size={14} /> {label}
              </button>
            ))}
          </div>

          <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 overflow-y-auto">
            {activeTab === 'info' && (
              <div className="space-y-3">
                {result.company && <div className="text-white font-semibold text-lg">{result.company}</div>}
                {result.legalPerson && <div className="text-white/60 text-sm">Legal Person: {result.legalPerson}</div>}
                {result.capital && <div className="text-white/60 text-sm">Capital: {result.capital}</div>}
                {result.status && (
                  <div className="text-white/60 text-sm flex items-center gap-2">
                    Status: <span className={`px-2 py-0.5 rounded text-xs ${result.status.includes('存续') ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'}`}>{result.status}</span>
                  </div>
                )}
                {result.establishDate && <div className="text-white/60 text-sm">Established: {result.establishDate}</div>}
                {!result.company && <p className="text-white/35 text-sm">No structured data. Raw output below.</p>}
              </div>
            )}
            {activeTab === 'enforcement' && (
              <div className="space-y-2">
                {result.enforcements && result.enforcements.length > 0 ? (
                  result.enforcements.map((e, i) => (
                    <div key={i} className="bg-white/5 rounded-lg p-3 border border-white/5">
                      <div className="flex items-center gap-2 text-white/80 text-sm font-medium">
                        <FileText size={12} className="text-red-400" />
                        {e.caseNumber}
                      </div>
                      <div className="mt-1 text-white/45 text-xs space-y-0.5">
                        <div>Court: {e.court}</div>
                        <div>Filing: {e.date}</div>
                        <div>Target: {e.target}</div>
                      </div>
                    </div>
                  ))
                ) : (
                  <p className="text-white/35 text-sm">No enforcement records found in public databases.</p>
                )}
              </div>
            )}
            {activeTab === 'equity' && (
              <div className="space-y-2">
                {result.shareholders && result.shareholders.length > 0 ? (
                  result.shareholders.map((s, i) => (
                    <div key={i} className="flex items-center justify-between bg-white/5 rounded-lg p-3 border border-white/5">
                      <span className="text-white/80 text-sm">{s.name}</span>
                      <span className="text-amber-400 text-sm font-mono">{s.ratio}%</span>
                    </div>
                  ))
                ) : (
                  <p className="text-white/35 text-sm">Equity structure details unavailable. Raw output below.</p>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* Raw output fallback */}
      {result?.raw && !result.company && !result.shareholders && !result.enforcements && (
        <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 overflow-y-auto whitespace-pre-wrap text-white/70 text-sm">
          {result.raw}
        </div>
      )}
    </div>
  );
}
