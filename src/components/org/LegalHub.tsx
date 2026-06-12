import React, { useState, useMemo } from 'react';
import {
  Scale, FileText, Search, Crosshair, Shield, Brain, CheckCircle, Upload,
} from 'lucide-react';
import { LegalBidWorkbench } from './LegalBidWorkbench';
import { LegalCaseSearch } from './LegalCaseSearch';
import { LegalAssetTrace } from './LegalAssetTrace';
import { LegalContractReview } from './LegalContractReview';
import { useT } from '../../lib/useT';

type LegalView = 'bid' | 'case-search' | 'asset-trace' | 'contract-review' | 'strategy' | 'verify' | 'import';

interface NavItem {
  id: LegalView;
  label: string;
  icon: React.ReactNode;
}

export function LegalHub() {
  const [view, setView] = useState<LegalView>('case-search');
  const t = useT();

  const navItems: NavItem[] = useMemo(() => [
    { id: 'bid', label: t.legalBidWorkbench, icon: <FileText size={16} /> },
    { id: 'case-search', label: t.legalCaseSearch, icon: <Search size={16} /> },
    { id: 'asset-trace', label: t.legalAssetTrace, icon: <Crosshair size={16} /> },
    { id: 'contract-review', label: t.legalContractReview, icon: <Shield size={16} /> },
    { id: 'strategy', label: t.legalCaseStrategy, icon: <Brain size={16} /> },
    { id: 'verify', label: t.legalVerifyCitation, icon: <CheckCircle size={16} /> },
    { id: 'import', label: t.legalImportJudgment, icon: <Upload size={16} /> },
  ], [t]);

  const renderView = () => {
    switch (view) {
      case 'bid': return <LegalBidWorkbench onSwitchView={setView} />;
      case 'case-search': return <LegalCaseSearch />;
      case 'asset-trace': return <LegalAssetTrace />;
      case 'contract-review': return <LegalContractReview />;
      case 'strategy': return <LegalStrategyView />;
      case 'verify': return <LegalVerifyView />;
      case 'import': return <LegalImportView />;
      default: return <LegalCaseSearch />;
    }
  };

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-white/5 bg-white/[0.02] flex flex-col">
        <div className="p-4 border-b border-white/5">
          <h3 className="text-white text-sm font-bold flex items-center gap-2">
            <Scale size={16} className="text-amber-400" />
            {t.legalHub || 'Law Firm'}
          </h3>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                view === item.id
                  ? 'bg-amber-500/10 text-amber-400'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </nav>
      </div>
      <div className="flex-1 overflow-y-auto">
        {renderView()}
      </div>
    </div>
  );
}

// ── Stub views for strategy, verify, import ──

function LegalStrategyView() {
  const t = useT();
  const [facts, setFacts] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const analyze = async () => {
    if (!facts.trim() || loading) return;
    setLoading(true);
    setResult('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `使用 legal_case_strategy 工具分析以下案件事实：\n\n${facts}`,
          stream: false,
        }),
        credentials: 'include',
      });
      const data = await res.json();
      setResult(data.response || data.message || JSON.stringify(data));
    } catch (e: any) {
      setResult('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.legalCaseStrategyTitle}</h2>
      <p className="text-white/50 text-sm">{t.legalCaseStrategyDesc}</p>
      <textarea
        value={facts}
        onChange={e => setFacts(e.target.value)}
        placeholder={t.legalCaseStrategyPlaceholder}
        rows={8}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-amber-500/50 resize-none"
      />
      <button
        onClick={analyze}
        disabled={loading || !facts.trim()}
        className="px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Brain size={16} />
        {loading ? 'Analyzing...' : t.legalCaseStrategyAnalyze}
      </button>
      {result && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">
          {result}
        </div>
      )}
    </div>
  );
}

function LegalVerifyView() {
  const t = useT();
  const [text, setText] = useState('');
  const [results, setResults] = useState<any[] | null>(null);
  const [loading, setLoading] = useState(false);

  const verify = async () => {
    if (!text.trim() || loading) return;
    setLoading(true);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `使用 legal_verify_citation 验证以下文本中所有法条引用：\n\n${text}`,
          stream: false,
        }),
        credentials: 'include',
      });
      const data = await res.json();
      setResults([{ content: data.response || data.message || 'Verification complete' }]);
    } catch (e: any) {
      setResults([{ error: e.message }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.legalVerifyCitationTitle}</h2>
      <p className="text-white/50 text-sm">{t.legalVerifyCitationDesc}</p>
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder={t.legalVerifyCitationPlaceholder}
        rows={6}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-amber-500/50 resize-none"
      />
      <button
        onClick={verify}
        disabled={loading || !text.trim()}
        className="px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <CheckCircle size={16} />
        {loading ? 'Verifying...' : t.legalVerifyCitationVerify}
      </button>
      {results && results.length > 0 && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">
          {results.map((r: any, i: number) => (
            <div key={i} className={r.error ? 'text-red-400' : ''}>{r.content || r.error}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function LegalImportView() {
  const t = useT();
  const [content, setContent] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);

  const importJudgment = async () => {
    if (!content.trim() || loading) return;
    setLoading(true);
    setStatus('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `使用 legal_import_judgment 导入以下裁判文书：\n\n${content}`,
          stream: false,
        }),
        credentials: 'include',
      });
      const data = await res.json();
      setStatus(data.response || data.message || 'Import request sent');
    } catch (e: any) {
      setStatus('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.legalImportJudgmentTitle}</h2>
      <p className="text-white/50 text-sm">{t.legalImportJudgmentDesc}</p>
      <textarea
        value={content}
        onChange={e => setContent(e.target.value)}
        placeholder="Paste judgment document content here, or use the file upload in chat to import PDF/DOCX files..."
        rows={12}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-amber-500/50 resize-none font-mono text-sm"
      />
      <button
        onClick={importJudgment}
        disabled={loading || !content.trim()}
        className="px-6 py-3 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Upload size={16} />
        {loading ? 'Importing...' : 'Import Judgment'}
      </button>
      {status && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">
          {status}
        </div>
      )}
    </div>
  );
}
