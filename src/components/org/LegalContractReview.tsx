import React, { useState, useRef } from 'react';
import { useT } from '../../lib/useT';
import { Shield, Upload, Loader2, AlertTriangle, Check, HelpCircle, FileText } from 'lucide-react';

interface RiskItem {
  level: 'high' | 'medium' | 'low';
  clause: string;
  reason: string;
  suggestion: string;
  statuteRef: string;
}

export function LegalContractReview() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const [contract, setContract] = useState('');
  const [result, setResult] = useState('');
  const [risks, setRisks] = useState<RiskItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedRisk, setSelectedRisk] = useState<RiskItem | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => setContract(ev.target?.result as string);
    reader.readAsText(file);
  };

  const review = async () => {
    if (!contract.trim() || loading) return;
    setLoading(true);
    setResult('');
    setRisks([]);
    setSelectedRisk(null);
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: `使用 legal_review_contract 审查以下合同，注意标注风险等级（高/中/低）、法律依据和修改建议：\n\n${contract.slice(0, 10000)}`,
          stream: false,
        }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ui('合同审查失败', 'Contract review failed'));
      const text = data.text || data.response || data.reply || data.message || '';
      setResult(text);
      setRisks(parseRisks(text));
    } catch (e: any) {
      setResult(ui('错误：', 'Error: ') + e.message);
    } finally {
      setLoading(false);
    }
  };

  const riskLevelMeta = {
    high: { icon: <AlertTriangle size={14} />, color: 'text-red-400', bg: 'bg-red-500/10', border: 'border-red-500/20', label: 'High Risk' },
    medium: { icon: <HelpCircle size={14} />, color: 'text-yellow-400', bg: 'bg-yellow-500/10', border: 'border-yellow-500/20', label: 'Medium Risk' },
    low: { icon: <Check size={14} />, color: 'text-green-400', bg: 'bg-green-500/10', border: 'border-green-500/20', label: 'Low Risk' },
  };

  return (
    <div className="p-6 h-full flex flex-col">
      <h2 className="text-xl font-bold text-white mb-2">{t.legalContractReviewTitle}</h2>
      <p className="text-white/50 text-sm mb-4">{t.legalContractReviewDesc}</p>

      <div className="flex-1 flex gap-4 min-h-0">
        {/* Left: Contract Input */}
        <div className="flex-1 flex flex-col min-w-0">
          <textarea
            value={contract}
            onChange={e => setContract(e.target.value)}
            placeholder={t.legalContractReviewPlaceholder}
            rows={14}
            className="flex-1 w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-amber-500/50 resize-none font-mono text-sm"
          />
          <div className="flex items-center gap-3 mt-3">
            <button
              onClick={review}
              disabled={loading || !contract.trim()}
              className="px-5 py-2.5 bg-amber-600 hover:bg-amber-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
            >
              {loading ? <Loader2 size={16} className="animate-spin" /> : <Shield size={16} />}
              {t.legalContractReviewReview}
            </button>
            <button
              onClick={() => fileRef.current?.click()}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/15 text-white/80 rounded-xl transition-colors flex items-center gap-2 text-sm"
            >
              <Upload size={14} />
              Upload
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" onChange={handleFileUpload} className="hidden" />
          </div>
        </div>

        {/* Right: Review Results */}
        <div className="flex-1 flex flex-col min-w-0">
          {risks.length > 0 && (
            <>
              <h3 className="text-white/70 text-sm font-semibold mb-2 flex items-center gap-2">
                <AlertTriangle size={14} className="text-amber-400" />
                {t.legalContractReviewRisks} ({risks.length})
              </h3>
              <div className="flex-1 overflow-y-auto space-y-2">
                {risks.map((risk, i) => {
                  const meta = riskLevelMeta[risk.level];
                  return (
                    <button
                      key={i}
                      onClick={() => setSelectedRisk(risk)}
                      className={`w-full text-left p-3 rounded-xl border transition-all ${meta.bg} ${meta.border} ${
                        selectedRisk === risk ? 'ring-1 ring-white/20' : 'hover:ring-1 hover:ring-white/10'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={meta.color}>{meta.icon}</span>
                        <span className={`text-xs font-medium ${meta.color}`}>{meta.label}</span>
                      </div>
                      <div className="mt-1 text-white/80 text-sm truncate">{risk.clause}</div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {/* Selected risk detail */}
          {selectedRisk && (
            <div className="mt-3 bg-white/5 border border-white/10 rounded-xl p-4">
              <div className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs mb-2 ${riskLevelMeta[selectedRisk.level].bg} ${riskLevelMeta[selectedRisk.level].color}`}>
                {riskLevelMeta[selectedRisk.level].icon}
                {riskLevelMeta[selectedRisk.level].label}
              </div>
              <div className="text-white/85 text-sm font-medium mb-1">{selectedRisk.clause}</div>
              <div className="text-white/60 text-xs mb-1">Reason: {selectedRisk.reason}</div>
              {selectedRisk.statuteRef && <div className="text-white/45 text-xs mb-2">Law: {selectedRisk.statuteRef}</div>}
              <div className="text-green-400/80 text-xs">Suggestion: {selectedRisk.suggestion}</div>
            </div>
          )}

          {result && risks.length === 0 && (
            <div className="flex-1 bg-white/5 border border-white/10 rounded-xl p-4 overflow-y-auto whitespace-pre-wrap text-white/70 text-sm">
              {result}
            </div>
          )}

          {!result && risks.length === 0 && (
            <div className="flex-1 flex items-center justify-center">
              <p className="text-white/25 text-sm italic">
                Review results will appear here...
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Parse risks from LLM output ──
function parseRisks(text: string): RiskItem[] {
  const risks: RiskItem[] = [];

  // Try structured patterns: [高风险] / [中风险] / [低风险] or ⚠️ markers
  const blockRe = /(?:\[高风险\]|\[中风险\]|\[低风险\]|⚠️)\s*(.+?)(?=(?:\[高|\[中|\[低\]|⚠️|$))/gs;
  let match: RegExpExecArray | null;
  while ((match = blockRe.exec(text)) !== null) {
    const block = match[0];
    let level: RiskItem['level'] = 'medium';
    if (block.includes('高风险') || block.includes('High')) level = 'high';
    else if (block.includes('低风险') || block.includes('Low')) level = 'low';

    const clause = block.match(/[⚠️].*?\s(.+)/)?.[1]?.slice(0, 80) || block.slice(0, 80);
    const reason = block.match(/(?:理由|依据|法律依据)[：:]\s*(.+)/)?.[1] || '';
    const suggestion = block.match(/(?:建议|修改建议|修改)[：:]\s*(.+)/)?.[1] || '';
    const statuteRef = block.match(/《([^》]+)》/)?.[0] || '';

    risks.push({ level, clause: clause.trim(), reason: reason.trim(), suggestion: suggestion.trim(), statuteRef });
  }

  // Fallback: split by numbered items and classify by keywords
  if (risks.length === 0) {
    const items = text.split(/\n(?=\d+\.\s*[*]{0,2})/);
    for (const item of items) {
      let level: RiskItem['level'] = 'medium';
      if (/高风险|严重风险|无效|违法|重大/.test(item)) level = 'high';
      else if (/低风险|轻微|措辞|表述不清/.test(item)) level = 'low';

      const clause = item.slice(0, 80).replace(/^\d+\.\s*\*{0,2}/, '').trim();
      if (clause.length > 10) {
        risks.push({ level, clause, reason: '', suggestion: '', statuteRef: '' });
      }
    }
  }

  return risks;
}
