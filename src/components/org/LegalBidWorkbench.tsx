import React, { useState, useRef } from 'react';
import { useT } from '../../lib/useT';
import { FileText, Upload, Download, Loader2 } from 'lucide-react';

export function LegalBidWorkbench({ onSwitchView }: { onSwitchView?: (v: any) => void }) {
  const t = useT();
  const [requirements, setRequirements] = useState('');
  const [projectName, setProjectName] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      const text = ev.target?.result as string;
      setRequirements(prev => prev + '\n\n' + text);
    };
    reader.readAsText(file);
  };

  const generateBid = async () => {
    if (!requirements.trim() || loading) return;
    setLoading(true);
    setResult('');
    try {
      const msg = projectName
        ? `使用 legal_generate_bid 工具为项目"${projectName}"生成标书：\n\n${requirements}`
        : `使用 legal_generate_bid 工具根据以下招标要求生成标书：\n\n${requirements}`;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, stream: false }),
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

  const exportBid = () => {
    const blob = new Blob([result], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${projectName || 'bid'}.md`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <h2 className="text-xl font-bold text-white mb-2">{t.legalBidGenTitle}</h2>
      <p className="text-white/50 text-sm mb-6">{t.legalBidGenDesc}</p>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left: Input */}
        <div className="flex-1 flex flex-col space-y-3 min-w-0">
          <input
            type="text"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder="Project name (optional)"
            className="w-full px-4 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-amber-500/50"
          />
          <textarea
            value={requirements}
            onChange={e => setRequirements(e.target.value)}
            placeholder={t.legalBidGenPlaceholder}
            rows={12}
            className="flex-1 w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-amber-500/50 resize-none"
          />
          <div className="flex items-center gap-3">
            <button
              onClick={generateBid}
              disabled={loading || !requirements.trim()}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <FileText size={16} />}
              {t.legalBidGenGenerate}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/15 text-white/80 rounded-xl transition-colors flex items-center gap-2 text-sm"
            >
              <Upload size={14} />
              {t.legalBidGenUpload}
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" onChange={handleFileUpload} className="hidden" />
          </div>
          <p className="text-white/30 text-xs">{t.legalBidGenPaste}</p>
        </div>

        {/* Right: Result */}
        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white/70 text-sm font-semibold">Output</h3>
            {result && (
              <button
                onClick={exportBid}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-white/10 hover:bg-white/15 text-white/70 rounded-lg text-xs transition-colors"
              >
                <Download size={12} />
                {t.legalBidGenExport}
              </button>
            )}
          </div>
          <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 overflow-y-auto">
            {result ? (
              <div className="prose prose-invert prose-sm max-w-none whitespace-pre-wrap text-white/80 text-sm">
                {result}
              </div>
            ) : (
              <p className="text-white/25 text-sm italic">
                Generated bid proposal will appear here...
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
