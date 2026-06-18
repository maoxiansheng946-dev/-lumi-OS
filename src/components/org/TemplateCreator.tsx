import React, { useState } from 'react';
import { motion } from 'motion/react';
import { Package, Send, Loader2, ArrowLeft, AlertCircle } from 'lucide-react';
import { useT } from '../../lib/useT';

export function TemplateCreator() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('productivity');
  const [icon, setIcon] = useState('Bot');
  const [configStr, setConfigStr] = useState(JSON.stringify({
    initialPrompt: '',
    personalityId: 'lumi',
    allowedTools: '*',
    memoryPolicy: { retrieveLimit: 10, autoExtract: true },
  }, null, 2));
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async () => {
    if (!name.trim() || !description.trim()) {
      setError(t.templateRequiredFields || ui('名称和描述不能为空', 'Name and description are required'));
      return;
    }
    setSubmitting(true);
    setError('');
    try {
      let config: any;
      try {
        config = JSON.parse(configStr);
      } catch (err: any) {
        throw new Error(`${t.invalidJSON || 'Invalid JSON'}: ${err.message}`);
      }

      const res = await fetch('/api/org/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, description, category, config, icon }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${t.templateSubmitFailed || ui('模板提交失败', 'Template submit failed')} (${res.status})`);

      const submitRes = await fetch(`/api/org/templates/${data.id}/submit`, {
        method: 'POST',
        credentials: 'include',
      });
      const submitData = await submitRes.json().catch(() => ({}));
      if (!submitRes.ok) throw new Error(submitData.error || `${t.templateSubmitFailed || ui('模板提交失败', 'Template submit failed')} (${submitRes.status})`);
      setDone(true);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally { setSubmitting(false); }
  };

  if (done) {
    return (
      <div className="mx-auto max-w-md space-y-4 p-6 text-center">
        <motion.div initial={{ scale: 0 }} animate={{ scale: 1 }}>
          <Send size={48} className="mx-auto text-green-400" />
        </motion.div>
        <h3 className="text-xl font-bold text-white">{t.templateSubmitted || ui('模板已提交', 'Template Submitted!')}</h3>
        <p className="text-white/40 text-sm">{t.templatePendingReview || ui('你的模板正在等待管理员审核。', 'Your template is pending review by an admin.')}</p>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'templates' } }))}
          className="lumi-button mx-auto"
        >
          <ArrowLeft size={16} className="mr-1" /> {t.backToMarketplace || ui('返回模板市场', 'Back to Marketplace')}
        </button>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-4 p-6">
      <div className="lumi-panel flex items-center gap-2 p-5">
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'templates' } }))}
          className="lumi-icon-button h-8 w-8"
        >
          <ArrowLeft size={18} />
        </button>
        <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-[0.08em] text-white/90">
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-purple-300/15 bg-purple-400/10 text-purple-300">
            <Package size={24} />
          </span>
          {t.submitTemplate || ui('提交模板', 'Submit a Template')}
        </h2>
      </div>
      <p className="text-white/40 text-sm">{t.templateDesc || ui('从你的智能体创建模板，并分享给组织使用', 'Create a template from one of your agents to share with the organization')}</p>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      <div className="flex gap-3">
        <input
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t.templateName || ui('模板名称', 'Template name')}
          className="lumi-field min-w-0 flex-1 focus:border-purple-500/40"
        />
        <input
          value={icon}
          onChange={e => setIcon(e.target.value)}
          placeholder={t.iconLabel || 'Icon'}
          className="lumi-field w-20 text-center"
        />
      </div>

      <input
        value={description}
        onChange={e => setDescription(e.target.value)}
        placeholder={t.briefDescription || ui('简单描述这个智能体能做什么...', 'Brief description of what this agent does...')}
        className="lumi-field w-full focus:border-purple-500/40"
      />

      <select
        value={category}
        onChange={e => setCategory(e.target.value)}
        className="lumi-field w-full text-sm text-white/70"
      >
        <option value="productivity">{t.categoryProductivity || 'Productivity'}</option>
        <option value="data-analysis">{t.categoryDataAnalysis || 'Data Analysis'}</option>
        <option value="customer-support">{t.categoryCustomerSupport || 'Customer Support'}</option>
        <option value="engineering">{t.categoryEngineering || 'Engineering'}</option>
        <option value="hr">{t.categoryHR || 'HR'}</option>
        <option value="sales">{t.categorySales || 'Sales'}</option>
        <option value="creative">{t.categoryCreative || 'Creative'}</option>
        <option value="other">{t.categoryOther || 'Other'}</option>
      </select>

      <div>
        <p className="text-white/55 text-xs mb-2">{t.agentConfigJSON || ui('智能体配置（JSON）', 'Agent Configuration (JSON)')}</p>
        <textarea
          value={configStr}
          onChange={e => setConfigStr(e.target.value)}
          className="lumi-field h-48 w-full resize-y font-mono text-xs focus:border-purple-500/40"
        />
      </div>

      <button
        onClick={handleSubmit}
        disabled={submitting || !name.trim() || !description.trim()}
        className="lumi-button-primary w-full border-purple-400/25 bg-purple-500/15 py-3 text-purple-200 hover:bg-purple-500/25"
      >
        {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
        {t.submitForReview || ui('提交审核', 'Submit for Review')}
      </button>
    </div>
  );
}
