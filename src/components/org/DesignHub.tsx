import React, { useState } from 'react';
import { Palette, Layout, Sparkles, CheckCircle, Lightbulb, Image, PenTool } from 'lucide-react';
import { useT } from '../../lib/useT';

type DesignView = 'brand' | 'ux-review' | 'creative' | 'spec-check' | 'inspiration' | 'logo';

interface NavItem {
  id: DesignView;
  label: string;
  icon: React.ReactNode;
}

const localText = (t: any, zh: string, en: string) => t.langCode === 'en' ? en : zh;

export function DesignHub() {
  const [view, setView] = useState<DesignView>('brand');
  const t = useT();
  const ui = (zh: string, en: string) => localText(t, zh, en);

  const navItems: NavItem[] = [
    { id: 'brand', label: t.designBrand || ui('品牌设计', 'Brand Design'), icon: <Palette size={16} /> },
    { id: 'logo', label: t.designLogo || ui('Logo 生成', 'Logo Generation'), icon: <PenTool size={16} /> },
    { id: 'ux-review', label: t.designUXReview || ui('UI/UX 审查', 'UI/UX Review'), icon: <Layout size={16} /> },
    { id: 'creative', label: t.designCreative || ui('创意生成', 'Creative Generation'), icon: <Sparkles size={16} /> },
    { id: 'spec-check', label: t.designSpecCheck || ui('规范检查', 'Spec Check'), icon: <CheckCircle size={16} /> },
    { id: 'inspiration', label: t.designInspiration || ui('设计灵感', 'Inspiration'), icon: <Lightbulb size={16} /> },
  ];

  const renderView = () => {
    switch (view) {
      case 'brand': return <BrandDesignView />;
      case 'logo': return <LogoGenView />;
      case 'ux-review': return <UXReviewView />;
      case 'creative': return <CreativeGenView />;
      case 'spec-check': return <SpecCheckView />;
      case 'inspiration': return <InspirationView />;
      default: return <BrandDesignView />;
    }
  };

  return (
    <div className="flex h-full">
      <div className="w-48 border-r border-white/5 bg-white/[0.02] flex flex-col">
        <div className="p-4 border-b border-white/5">
          <h3 className="text-white text-sm font-bold flex items-center gap-2">
            <Palette size={16} className="text-pink-400" />
            {t.designHub || ui('设计所', 'Design Hub')}
          </h3>
        </div>
        <nav className="flex-1 p-2 space-y-1">
          {navItems.map(item => (
            <button
              key={item.id}
              onClick={() => setView(item.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                view === item.id
                  ? 'bg-pink-500/10 text-pink-400'
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

// ── Shared chat helper ──

function useDesignChat() {
  const t = useT();
  const ui = (zh: string, en: string) => localText(t, zh, en);
  const [input, setInput] = useState('');
  const [result, setResult] = useState('');
  const [loading, setLoading] = useState(false);

  const send = async (prompt: string) => {
    if (!prompt.trim() || loading) return;
    setLoading(true);
    setResult('');
    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ messages: [{ role: 'user', content: prompt }] }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ui('设计请求失败', 'Design request failed'));
      setResult(data.text || data.response || data.reply || data.message || JSON.stringify(data));
    } catch (e: any) {
      setResult(ui('错误：', 'Error: ') + e.message);
    } finally {
      setLoading(false);
    }
  };

  return { input, setInput, result, loading, send };
}

// ── Brand Design View ──

function BrandDesignView() {
  const t = useT();
  const ui = (zh: string, en: string) => localText(t, zh, en);
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designBrandTitle || ui('品牌设计', 'Brand Design')}</h2>
      <p className="text-white/50 text-sm">{t.designBrandDesc || ui('描述品牌需求，生成品牌策略和视觉识别方案', 'Describe brand needs to generate brand strategy and visual identity proposals')}</p>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designBrandPlaceholder || ui('描述你的品牌：产品/服务、目标受众、品牌调性偏好、色彩倾向...', 'Describe your brand: product/service, audience, tone, color preferences...')}
        rows={6}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50 resize-none"
      />
      <button
        onClick={() => send(`作为品牌设计师，为以下品牌提供完整的品牌策略和视觉识别方案：\n\n${input}`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Palette size={16} />
        {loading ? ui('设计中...', 'Designing...') : (t.designBrandGenerate || ui('生成方案', 'Generate Proposal'))}
      </button>
      {result && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">{result}</div>
      )}
    </div>
  );
}

// ── Logo Generation View ──

function LogoGenView() {
  const t = useT();
  const ui = (zh: string, en: string) => localText(t, zh, en);
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designLogoTitle || ui('Logo 生成', 'Logo Generation')}</h2>
      <p className="text-white/50 text-sm">{t.designLogoDesc || ui('输入品牌名称和风格偏好，使用 AI 生成 Logo 方案', 'Enter brand name and style preferences to generate logo proposals with AI')}</p>
      <div className="grid grid-cols-2 gap-4">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t.designLogoPlaceholder || ui('品牌名称 + 风格（如：简约几何 / 手绘 / 渐变 / 线条）', 'Brand name + style, e.g. minimal geometry / hand-drawn / gradient / line art')}
          className="col-span-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50"
        />
      </div>
      <button
        onClick={() => send(`作为品牌设计师，使用 generate_image 为"${input}"生成 3 个不同风格的 Logo 方案。每个方案需包含：设计概念说明、适合的使用场景。`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <PenTool size={16} />
        {loading ? ui('生成中...', 'Generating...') : (t.designLogoGenerate || ui('生成 Logo', 'Generate Logo'))}
      </button>
      {result && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">{result}</div>
      )}
    </div>
  );
}

// ── UX Review View ──

function UXReviewView() {
  const t = useT();
  const ui = (zh: string, en: string) => localText(t, zh, en);
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designUXReviewTitle || ui('UI/UX 审查', 'UI/UX Review')}</h2>
      <p className="text-white/50 text-sm">{t.designUXReviewDesc || ui('上传设计稿截图或描述界面，获得 UI/UX 专业审查意见', 'Upload a design screenshot or describe an interface to get a professional UI/UX review')}</p>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designUXReviewPlaceholder || ui('描述你的界面设计（或粘贴截图），标注你关心的审查维度：视觉层级 / 色彩 / 排版 / 交互状态 / 无障碍...', 'Describe your interface or paste a screenshot. Mention review focus: hierarchy / color / typography / interaction states / accessibility...')}
        rows={6}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50 resize-none"
      />
      <button
        onClick={() => send(`作为 UI/UX 设计师，对以下界面进行专业审查。从视觉层级、色彩系统、排版、间距、交互状态、响应式、无障碍 7 个维度逐一分析，输出 P0-P3 优先级问题清单和具体修改方案：\n\n${input}`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Layout size={16} />
        {loading ? ui('审查中...', 'Reviewing...') : (t.designUXReviewAnalyze || ui('开始审查', 'Start Review'))}
      </button>
      {result && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">{result}</div>
      )}
    </div>
  );
}

// ── Creative Generation View ──

function CreativeGenView() {
  const t = useT();
  const ui = (zh: string, en: string) => localText(t, zh, en);
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designCreativeTitle || ui('创意生成', 'Creative Generation')}</h2>
      <p className="text-white/50 text-sm">{t.designCreativeDesc || ui('描述视觉需求，使用 AI 生成创意图像素材：产品渲染、场景图、营销物料', 'Describe visual needs and generate AI image assets: product renders, scenes, marketing materials')}</p>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designCreativePlaceholder || ui('描述你想要的画面：主体 + 风格 + 光照 + 色彩 + 构图...\n例如：一张极简风格的智能手表产品渲染图，白色背景，柔和的侧光，玫瑰金材质质感', 'Describe the image: subject + style + lighting + color + composition...\nExample: a minimalist smartwatch product render, white background, soft side light, rose-gold material')}
        rows={5}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50 resize-none"
      />
      <button
        onClick={() => send(`作为 AI 创意视觉设计师，使用 generate_image 生成以下图像。撰写精准的英文 prompt（包含主体、风格、光照、构图、色彩、分辨率）。最多迭代 3 轮优化：\n\n${input}`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Sparkles size={16} />
        {loading ? ui('生成中...', 'Generating...') : (t.designCreativeGenerate || ui('生成图像', 'Generate Image'))}
      </button>
      {result && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">{result}</div>
      )}
    </div>
  );
}

// ── Spec Check View ──

function SpecCheckView() {
  const t = useT();
  const ui = (zh: string, en: string) => localText(t, zh, en);
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designSpecCheckTitle || ui('设计规范检查', 'Design Spec Check')}</h2>
      <p className="text-white/50 text-sm">{t.designSpecCheckDesc || ui('基于 Material Design / Human Interface / Ant Design 审查界面合规性', 'Check interface compliance against Material Design, Human Interface, or Ant Design')}</p>
      <div className="flex gap-2 mb-2">
        {['Material Design 3', 'Human Interface', 'Ant Design', ui('自定义规范', 'Custom Spec')].map(sys => (
          <button
            key={sys}
            onClick={() => setInput(prev => prev + (prev ? '\n' : '') + `${ui('参考规范', 'Reference spec')}：${sys}`)}
            className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-white/60 hover:text-white hover:border-pink-500/30 transition-colors"
          >
            {sys}
          </button>
        ))}
      </div>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designSpecCheckPlaceholder || ui('粘贴你的界面代码（JSX/HTML）或描述设计 Token 使用情况...', 'Paste interface code (JSX/HTML) or describe design token usage...')}
        rows={8}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50 resize-none font-mono text-sm"
      />
      <button
        onClick={() => send(`作为设计系统专家，检查以下界面是否符合所选设计规范。从 Design Token（颜色/间距/圆角/阴影/字体）、组件一致性、命名规范、深色模式适配、多平台一致性 5 个维度输出结构化报告：\n\n${input}`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <CheckCircle size={16} />
        {loading ? ui('检查中...', 'Checking...') : (t.designSpecCheckAnalyze || ui('开始检查', 'Start Check'))}
      </button>
      {result && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">{result}</div>
      )}
    </div>
  );
}

// ── Inspiration View ──

function InspirationView() {
  const t = useT();
  const ui = (zh: string, en: string) => localText(t, zh, en);
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designInspirationTitle || ui('设计灵感', 'Design Inspiration')}</h2>
      <p className="text-white/50 text-sm">{t.designInspirationDesc || ui('搜索设计趋势、案例分析、风格参考和创意灵感', 'Search design trends, case studies, style references, and creative inspiration')}</p>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designInspirationPlaceholder || ui('搜索设计趋势 / 风格 / 案例... 如：2024 年度色趋势 / SaaS 登录页设计 / 极简品牌案例', 'Search design trends / styles / cases, e.g. 2024 color trends / SaaS login pages / minimal brand cases')}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50"
      />
      <button
        onClick={() => send(`搜索设计趋势和案例分析：${input}。请提供具体案例、设计趋势要点、优秀参考链接，以及可应用到实际项目中的关键建议。`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Lightbulb size={16} />
        {loading ? ui('搜索中...', 'Searching...') : (t.designInspirationSearch || ui('搜索灵感', 'Search Inspiration'))}
      </button>
      {result && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">{result}</div>
      )}
    </div>
  );
}
