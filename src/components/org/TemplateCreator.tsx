import React, { useCallback, useState } from 'react';
import { motion } from 'motion/react';
import { AlertCircle, ArrowLeft, CheckCircle, Loader2, Package, Send } from 'lucide-react';
import { useT } from '../../lib/useT';

export function TemplateCreator() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);
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

  const goBack = () => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'templates' } }));

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
        throw new Error(`${t.invalidJSON || ui('JSON 格式错误', 'Invalid JSON')}: ${err.message}`);
      }

      const res = await fetch('/api/org/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), description: description.trim(), category, config, icon: icon.trim() || 'Bot' }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ui(`模板创建失败（${res.status}）`, `Template create failed (${res.status})`));

      const submitRes = await fetch(`/api/org/templates/${data.id}/submit`, {
        method: 'POST',
        credentials: 'include',
      });
      const submitData = await submitRes.json().catch(() => ({}));
      if (!submitRes.ok) throw new Error(submitData.error || ui(`模板提交失败（${submitRes.status}）`, `Template submit failed (${submitRes.status})`));
      setDone(true);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally {
      setSubmitting(false);
    }
  };

  if (done) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-white">
        <div className="w-full max-w-md rounded-lg border border-white/10 bg-white/[0.04] p-6 text-center">
          <motion.div initial={{ scale: 0.85, opacity: 0 }} animate={{ scale: 1, opacity: 1 }}>
            <CheckCircle size={48} className="mx-auto text-emerald-300" />
          </motion.div>
          <h3 className="mt-4 text-xl font-semibold text-white">{t.templateSubmitted || ui('模板已提交', 'Template Submitted')}</h3>
          <p className="mt-2 text-sm leading-6 text-white/50">
            {t.templatePendingReview || ui('模板已进入审核队列，管理员通过后会自动发布到市场。', 'Your template is pending admin review. Once approved, it will be published to Marketplace.')}
          </p>
          <button
            onClick={goBack}
            className="mt-5 inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-sm text-white/70 transition hover:bg-white/10 hover:text-white"
          >
            <ArrowLeft size={16} />
            {t.backToMarketplace || ui('返回模板市场', 'Back to Marketplace')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto p-6 text-white">
      <div className="mx-auto flex max-w-3xl flex-col gap-4">
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-start gap-3">
            <button
              onClick={goBack}
              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white"
              aria-label={ui('返回', 'Back')}
            >
              <ArrowLeft size={17} />
            </button>
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-violet-400/20 bg-violet-500/10 text-violet-300">
              <Package size={22} />
            </span>
            <div className="min-w-0">
              <h2 className="text-xl font-semibold text-white">{t.submitTemplate || ui('提交模板', 'Submit Template')}</h2>
              <p className="mt-1 text-sm text-white/50">
                {t.templateDesc || ui('把成熟的智能体配置提交给组织审核，通过后其他成员可以安装使用。', 'Submit a mature agent configuration for organization review so other members can install it.')}
              </p>
            </div>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-200">
            <AlertCircle size={16} className="mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="grid gap-4 md:grid-cols-[1fr_120px]">
            <label>
              <span className="mb-1 block text-xs text-white/50">{t.templateName || ui('模板名称', 'Template name')}</span>
              <input
                value={name}
                onChange={event => setName(event.target.value)}
                placeholder={ui('例如：合同审查助手', 'e.g. Contract Review Assistant')}
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-violet-400/35"
              />
            </label>
            <label>
              <span className="mb-1 block text-xs text-white/50">{t.iconLabel || 'Icon'}</span>
              <input
                value={icon}
                onChange={event => setIcon(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-center text-sm text-white outline-none focus:border-violet-400/35"
              />
            </label>
          </div>

          <label className="mt-4 block">
            <span className="mb-1 block text-xs text-white/50">{t.briefDescription || ui('简短描述', 'Brief description')}</span>
            <input
              value={description}
              onChange={event => setDescription(event.target.value)}
              placeholder={ui('说明这个智能体能做什么、适合谁使用...', 'Describe what this agent does and who should use it...')}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-violet-400/35"
            />
          </label>

          <label className="mt-4 block">
            <span className="mb-1 block text-xs text-white/50">{ui('分类', 'Category')}</span>
            <select
              value={category}
              onChange={event => setCategory(event.target.value)}
              className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/75 outline-none focus:border-violet-400/35"
            >
              <option value="productivity">{t.categoryProductivity || ui('效率工具', 'Productivity')}</option>
              <option value="data-analysis">{t.categoryDataAnalysis || ui('数据分析', 'Data Analysis')}</option>
              <option value="customer-support">{t.categoryCustomerSupport || ui('客户支持', 'Customer Support')}</option>
              <option value="engineering">{t.categoryEngineering || ui('工程研发', 'Engineering')}</option>
              <option value="legal">{ui('法律', 'Legal')}</option>
              <option value="design">{ui('设计', 'Design')}</option>
              <option value="finance">{ui('财务', 'Finance')}</option>
              <option value="hr">{t.categoryHR || 'HR'}</option>
              <option value="sales">{t.categorySales || ui('销售', 'Sales')}</option>
              <option value="creative">{t.categoryCreative || ui('创意', 'Creative')}</option>
              <option value="other">{t.categoryOther || ui('其他', 'Other')}</option>
            </select>
          </label>
        </section>

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <span className="text-sm font-medium text-white">{t.agentConfigJSON || ui('智能体配置 JSON', 'Agent Configuration JSON')}</span>
            <span className="text-xs text-white/40">{ui('提交前会校验 JSON 格式', 'JSON is validated before submit')}</span>
          </div>
          <textarea
            value={configStr}
            onChange={event => setConfigStr(event.target.value)}
            className="h-64 w-full resize-y rounded-lg border border-white/10 bg-black/25 px-3 py-2 font-mono text-xs leading-5 text-white/75 outline-none focus:border-violet-400/35"
          />
        </section>

        <button
          onClick={handleSubmit}
          disabled={submitting || !name.trim() || !description.trim()}
          className="inline-flex items-center justify-center gap-2 rounded-lg border border-violet-400/20 bg-violet-500/15 px-4 py-3 text-sm font-medium text-violet-100 transition hover:bg-violet-500/25 disabled:opacity-50"
        >
          {submitting ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
          {t.submitForReview || ui('提交审核', 'Submit for Review')}
        </button>
      </div>
    </div>
  );
}
