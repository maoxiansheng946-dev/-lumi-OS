import React, { useState, useMemo } from 'react';
import { Palette, Layout, Sparkles, CheckCircle, Lightbulb, Image, PenTool } from 'lucide-react';
import { useT } from '../../lib/useT';

type DesignView = 'brand' | 'ux-review' | 'creative' | 'spec-check' | 'inspiration' | 'logo';

interface NavItem {
  id: DesignView;
  label: string;
  icon: React.ReactNode;
}

export function DesignHub() {
  const [view, setView] = useState<DesignView>('brand');
  const t = useT();

  const navItems: NavItem[] = useMemo(() => [
    { id: 'brand', label: t.designBrand || '品牌设计', icon: <Palette size={16} /> },
    { id: 'logo', label: t.designLogo || 'Logo 生成', icon: <PenTool size={16} /> },
    { id: 'ux-review', label: t.designUXReview || 'UI/UX 审查', icon: <Layout size={16} /> },
    { id: 'creative', label: t.designCreative || '创意生成', icon: <Sparkles size={16} /> },
    { id: 'spec-check', label: t.designSpecCheck || '规范检查', icon: <CheckCircle size={16} /> },
    { id: 'inspiration', label: t.designInspiration || '设计灵感', icon: <Lightbulb size={16} /> },
  ], [t]);

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
            {t.designHub || '设计所'}
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
      const data = await res.json();
      setResult(data.text || data.error || JSON.stringify(data));
    } catch (e: any) {
      setResult('Error: ' + e.message);
    } finally {
      setLoading(false);
    }
  };

  return { input, setInput, result, loading, send };
}

// ── Brand Design View ──

function BrandDesignView() {
  const t = useT();
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designBrandTitle || '品牌设计'}</h2>
      <p className="text-white/50 text-sm">{t.designBrandDesc || '描述品牌需求，生成品牌策略和视觉识别方案'}</p>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designBrandPlaceholder || '描述你的品牌：产品/服务、目标受众、品牌调性偏好、色彩倾向...'}
        rows={6}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50 resize-none"
      />
      <button
        onClick={() => send(`作为品牌设计师，为以下品牌提供完整的品牌策略和视觉识别方案：\n\n${input}`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Palette size={16} />
        {loading ? '设计中...' : (t.designBrandGenerate || '生成方案')}
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
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designLogoTitle || 'Logo 生成'}</h2>
      <p className="text-white/50 text-sm">{t.designLogoDesc || '输入品牌名称和风格偏好，使用 AI 生成 Logo 方案'}</p>
      <div className="grid grid-cols-2 gap-4">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder={t.designLogoPlaceholder || '品牌名称 + 风格（如：简约几何 / 手绘 / 渐变 / 线条）'}
          className="col-span-2 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50"
        />
      </div>
      <button
        onClick={() => send(`作为品牌设计师，使用 generate_image 为"${input}"生成 3 个不同风格的 Logo 方案。每个方案需包含：设计概念说明、适合的使用场景。`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <PenTool size={16} />
        {loading ? '生成中...' : (t.designLogoGenerate || '生成 Logo')}
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
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designUXReviewTitle || 'UI/UX 审查'}</h2>
      <p className="text-white/50 text-sm">{t.designUXReviewDesc || '上传设计稿截图或描述界面，获得 UI/UX 专业审查意见'}</p>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designUXReviewPlaceholder || '描述你的界面设计（或粘贴截图），标注你关心的审查维度：视觉层级 / 色彩 / 排版 / 交互状态 / 无障碍...'}
        rows={6}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50 resize-none"
      />
      <button
        onClick={() => send(`作为 UI/UX 设计师，对以下界面进行专业审查。从视觉层级、色彩系统、排版、间距、交互状态、响应式、无障碍 7 个维度逐一分析，输出 P0-P3 优先级问题清单和具体修改方案：\n\n${input}`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Layout size={16} />
        {loading ? '审查中...' : (t.designUXReviewAnalyze || '开始审查')}
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
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designCreativeTitle || '创意生成'}</h2>
      <p className="text-white/50 text-sm">{t.designCreativeDesc || '描述视觉需求，使用 AI 生成创意图像素材：产品渲染、场景图、营销物料'}</p>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designCreativePlaceholder || '描述你想要的画面：主体 + 风格 + 光照 + 色彩 + 构图...\n例如：一张极简风格的智能手表产品渲染图，白色背景，柔和的侧光，玫瑰金材质质感'}
        rows={5}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50 resize-none"
      />
      <button
        onClick={() => send(`作为 AI 创意视觉设计师，使用 generate_image 生成以下图像。撰写精准的英文 prompt（包含主体、风格、光照、构图、色彩、分辨率）。最多迭代 3 轮优化：\n\n${input}`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Sparkles size={16} />
        {loading ? '生成中...' : (t.designCreativeGenerate || '生成图像')}
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
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designSpecCheckTitle || '设计规范检查'}</h2>
      <p className="text-white/50 text-sm">{t.designSpecCheckDesc || '基于 Material Design / Human Interface / Ant Design 审查界面合规性'}</p>
      <div className="flex gap-2 mb-2">
        {['Material Design 3', 'Human Interface', 'Ant Design', '自定义规范'].map(sys => (
          <button
            key={sys}
            onClick={() => setInput(prev => prev + (prev ? '\n' : '') + `参考规范：${sys}`)}
            className="px-3 py-1.5 text-xs bg-white/5 border border-white/10 rounded-lg text-white/60 hover:text-white hover:border-pink-500/30 transition-colors"
          >
            {sys}
          </button>
        ))}
      </div>
      <textarea
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designSpecCheckPlaceholder || '粘贴你的界面代码（JSX/HTML）或描述设计 Token 使用情况...'}
        rows={8}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50 resize-none font-mono text-sm"
      />
      <button
        onClick={() => send(`作为设计系统专家，检查以下界面是否符合所选设计规范。从 Design Token（颜色/间距/圆角/阴影/字体）、组件一致性、命名规范、深色模式适配、多平台一致性 5 个维度输出结构化报告：\n\n${input}`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <CheckCircle size={16} />
        {loading ? '检查中...' : (t.designSpecCheckAnalyze || '开始检查')}
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
  const { input, setInput, result, loading, send } = useDesignChat();

  return (
    <div className="p-6 max-w-3xl mx-auto space-y-4">
      <h2 className="text-xl font-bold text-white">{t.designInspirationTitle || '设计灵感'}</h2>
      <p className="text-white/50 text-sm">{t.designInspirationDesc || '搜索设计趋势、案例分析、风格参考和创意灵感'}</p>
      <input
        value={input}
        onChange={e => setInput(e.target.value)}
        placeholder={t.designInspirationPlaceholder || '搜索设计趋势 / 风格 / 案例... 如：2024 年度色趋势 / SaaS 登录页设计 / 极简品牌案例'}
        className="w-full px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white placeholder:text-white/35 focus:outline-none focus:border-pink-500/50"
      />
      <button
        onClick={() => send(`搜索设计趋势和案例分析：${input}。请提供具体案例、设计趋势要点、优秀参考链接，以及可应用到实际项目中的关键建议。`)}
        disabled={loading || !input.trim()}
        className="px-6 py-3 bg-pink-600 hover:bg-pink-500 disabled:opacity-40 text-white rounded-xl font-medium transition-colors flex items-center gap-2"
      >
        <Lightbulb size={16} />
        {loading ? '搜索中...' : (t.designInspirationSearch || '搜索灵感')}
      </button>
      {result && (
        <div className="bg-white/5 border border-white/10 rounded-xl p-4 whitespace-pre-wrap text-white/80 text-sm">{result}</div>
      )}
    </div>
  );
}
