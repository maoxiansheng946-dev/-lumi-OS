import React, { useRef, useState } from 'react';
import { FileText, Upload, Download, Loader2 } from 'lucide-react';
import { useT } from '../../lib/useT';
import { toast } from 'sonner';

export function LegalBidWorkbench({ onSwitchView: _onSwitchView }: { onSwitchView?: (v: any) => void }) {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const [requirements, setRequirements] = useState('');
  const [projectName, setProjectName] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true);
    try {
      const formData = new FormData();
      Array.from(files).forEach(file => formData.append('files', file));
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ui('文件上传解析失败', 'File upload parsing failed'));
      const text = (data.files || [])
        .map((file: any) => String(file.content || file.preview || '').trim())
        .filter(Boolean)
        .join('\n\n');
      if (!text) throw new Error(ui('没有提取到可生成标书的文本', 'No bid requirements text extracted'));
      setRequirements(prev => [prev, text].filter(Boolean).join('\n\n'));
      toast.success(ui('文件已解析并填入招标要求', 'File parsed into bid requirements'));
    } catch (err: any) {
      const message = err?.message || ui('文件上传解析失败', 'File upload parsing failed');
      setResult(`${ui('错误', 'Error')}: ${message}`);
      toast.error(message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const generateBid = async () => {
    if (!requirements.trim() || loading) return;
    setLoading(true);
    setResult('');
    try {
      const msg = projectName
        ? `请使用 legal_generate_bid 工具为项目“${projectName}”生成标书：\n\n${requirements}`
        : `请使用 legal_generate_bid 工具根据以下招标要求生成标书：\n\n${requirements}`;
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: msg, stream: false }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ui('标书生成失败', 'Bid generation failed'));
      setResult(data.text || data.response || data.reply || data.message || JSON.stringify(data));
    } catch (e: any) {
      setResult(`${ui('错误', 'Error')}: ${e.message}`);
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
        <div className="flex-1 flex flex-col space-y-3 min-w-0">
          <input
            type="text"
            value={projectName}
            onChange={e => setProjectName(e.target.value)}
            placeholder={ui('项目名称（可选）', 'Project name (optional)')}
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
              disabled={uploading || loading}
              className="px-4 py-2.5 bg-white/10 hover:bg-white/15 text-white/80 rounded-xl transition-colors flex items-center gap-2 text-sm disabled:opacity-40"
            >
              {uploading ? <Loader2 size={14} className="animate-spin" /> : <Upload size={14} />}
              {t.legalBidGenUpload}
            </button>
            <input ref={fileRef} type="file" accept=".pdf,.docx,.txt,.md" onChange={handleFileUpload} className="hidden" />
          </div>
          <p className="text-white/30 text-xs">{t.legalBidGenPaste}</p>
        </div>

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-white/70 text-sm font-semibold">{ui('输出', 'Output')}</h3>
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
                {ui('生成的标书内容会显示在这里。', 'Generated bid proposal will appear here.')}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
