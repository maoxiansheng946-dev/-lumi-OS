import React, { useState } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import {
  Sparkles,
  Search,
  Zap,
  Mic,
  ChevronRight,
  MessageSquare,
  MousePointer2,
  Keyboard,
  CheckCircle2,
} from 'lucide-react';

interface OnboardingProps {
  isOpen: boolean;
  onFinish: () => void;
  t: any;
}

type PreviewType = 'desktop' | 'chat' | 'mode' | 'search';

interface TutorialStep {
  eyebrow: string;
  title: string;
  description: string;
  action: string;
  bullets: string[];
  icon: React.ReactNode;
  accent: string;
  preview: PreviewType;
}

export function DesktopOnboarding({ isOpen, onFinish, t }: OnboardingProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const isZh = t?.langCode !== 'en';
  const ui = (zh: string, en: string) => isZh ? zh : en;

  const steps: TutorialStep[] = [
    {
      eyebrow: ui('01 / 桌面入口', '01 / Desktop Entry'),
      title: ui('先从桌面开始', 'Start From The Desktop'),
      description: ui('Lumi 的主要能力都放在桌面图标、Dock 和搜索里。打开一个入口后，窗口会像桌面应用一样停留在工作区。', 'Lumi keeps the main abilities in desktop icons, the dock, and search. Open an entry and its window stays in the workspace like a real desktop app.'),
      action: ui('试着打开 Chat 或 Skill Center', 'Try opening Chat or Skill Center'),
      bullets: [
        ui('双击桌面图标打开功能', 'Double-click desktop icons to open features'),
        ui('底部 Dock 保留常用入口', 'The dock keeps common entries nearby'),
        ui('已打开窗口会自动出现在 Dock', 'Open windows appear in the dock automatically'),
      ],
      icon: <Sparkles size={34} className="text-celestial-saturn" />,
      accent: 'bg-celestial-saturn',
      preview: 'desktop',
    },
    {
      eyebrow: ui('02 / 交代任务', '02 / Give A Task'),
      title: ui('用一句话告诉 Lumi 要做什么', 'Tell Lumi What To Do In One Sentence'),
      description: ui('你可以点中心球、打开 Chat，或者用麦克风说话。适合让它打开软件、处理文件、查信息、执行连续步骤。', 'Click the center orb, open Chat, or speak through the microphone. Use this for opening apps, handling files, checking information, and running multi-step work.'),
      action: ui('输入或说出一个明确任务', 'Type or speak a clear task'),
      bullets: [
        ui('文字适合复杂任务', 'Text is best for complex tasks'),
        ui('语音适合快速指令', 'Voice is best for quick commands'),
        ui('执行前会显示关键状态', 'Key execution states stay visible'),
      ],
      icon: <MessageSquare size={34} className="text-blue-300" />,
      accent: 'bg-blue-400',
      preview: 'chat',
    },
    {
      eyebrow: ui('03 / 执行模式', '03 / Execution Mode'),
      title: ui('先看模式，再让 AI 动手', 'Check The Mode Before Lumi Acts'),
      description: ui('模式会影响 Lumi 的执行方式。聊天适合纯交流，助手会按任务调用能力，自动执行适合多步可见流程。', 'Modes affect how Lumi acts. Chat is conversation-only, Assistant chooses abilities for the task, and Auto Execute handles visible multi-step work.'),
      action: ui('根据任务切换聊天 / 助手 / 自动执行', 'Switch between Chat / Assistant / Auto Execute'),
      bullets: [
        ui('聊天：只回答，不主动动手', 'Chat: answer only, no proactive actions'),
        ui('助手：按需调用工具、技能和团队', 'Assistant: use tools, skills, and teams as needed'),
        ui('自动执行：多步任务，敏感操作仍会确认', 'Auto Execute: multi-step work, sensitive actions still require confirmation'),
      ],
      icon: <MousePointer2 size={34} className="text-cyan-300" />,
      accent: 'bg-cyan-400',
      preview: 'mode',
    },
    {
      eyebrow: ui('04 / 快速查找', '04 / Quick Search'),
      title: ui('找不到入口就搜索', 'Search When You Cannot Find An Entry'),
      description: ui('顶部搜索可以直接打开 Chat、Settings、Knowledge Base、Skill Center 等功能。记不住位置时，搜索最快。', 'Top search can open Chat, Settings, Knowledge Base, Skill Center, and more. When you do not remember where something lives, search is fastest.'),
      action: ui('搜索一个功能名并回车打开', 'Search a feature name and press Enter'),
      bullets: [
        ui('输入功能名即可筛选', 'Type a feature name to filter'),
        ui('回车打开第一个结果', 'Press Enter to open the first result'),
        ui('适合快速切换常用工具', 'Useful for switching common tools quickly'),
      ],
      icon: <Search size={34} className="text-purple-300" />,
      accent: 'bg-purple-400',
      preview: 'search',
    },
  ];

  const step = steps[currentStep];

  const renderPreview = () => {
    if (step.preview === 'desktop') {
      return (
        <div className="relative h-full min-h-[280px] overflow-hidden rounded-2xl border border-white/10 bg-[#10131d] p-5">
          <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-[0.22em] text-white/35">
            <span>Lumi Desktop</span>
            <span>09:41</span>
          </div>
          <div className="mt-7 grid grid-cols-3 gap-4">
            {['Chat', 'Skills', 'Files', 'Canvas', 'Settings', 'Tools'].map((label, index) => (
              <motion.div
                key={label}
                initial={false}
                animate={index === 0 ? { scale: [1, 1.04, 1] } : {}}
                transition={{ repeat: Infinity, duration: 1.8 }}
                className={`flex h-20 flex-col items-center justify-center gap-2 rounded-xl border ${
                  index === 0
                    ? 'border-celestial-saturn/70 bg-celestial-saturn/15 shadow-[0_0_28px_rgba(255,204,92,0.18)]'
                    : 'border-white/10 bg-white/[0.04]'
                }`}
              >
                <div className={`h-7 w-7 rounded-lg ${index === 0 ? 'bg-celestial-saturn' : 'bg-white/15'}`} />
                <span className="text-xs font-semibold text-white/70">{label}</span>
              </motion.div>
            ))}
          </div>
          <div className="absolute bottom-4 left-1/2 flex -translate-x-1/2 gap-2 rounded-2xl border border-white/10 bg-black/35 px-4 py-3 backdrop-blur-xl">
            {[0, 1, 2, 3].map(item => (
              <div key={item} className="h-8 w-8 rounded-lg bg-white/12" />
            ))}
          </div>
        </div>
      );
    }

    if (step.preview === 'chat') {
      return (
        <div className="flex h-full min-h-[280px] flex-col justify-between rounded-2xl border border-white/10 bg-[#0d1220] p-5">
          <div className="space-y-4">
            <div className="max-w-[78%] rounded-2xl rounded-tl-sm bg-white/10 px-4 py-3 text-sm text-white/72">
              {ui('帮我打开浏览器，并整理今天要处理的文件。', 'Open the browser and organize the files I need to handle today.')}
            </div>
            <div className="ml-auto max-w-[82%] rounded-2xl rounded-tr-sm border border-blue-300/25 bg-blue-400/12 px-4 py-3 text-sm text-blue-50">
              {ui('我会先确认执行模式，然后打开浏览器和文件入口。', 'I will confirm the execution mode first, then open the browser and file entry.')}
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-2xl border border-white/10 bg-black/28 p-3">
            <div className="flex-1 rounded-xl bg-white/8 px-4 py-3 text-sm text-white/35">{ui('输入任务...', 'Type a task...')}</div>
            <button className="flex h-11 w-11 items-center justify-center rounded-xl bg-blue-400 text-black">
              <Mic size={18} />
            </button>
          </div>
        </div>
      );
    }

    if (step.preview === 'mode') {
      return (
        <div className="h-full min-h-[280px] rounded-2xl border border-white/10 bg-[#0c1420] p-5">
          <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-black/25 p-2">
            {[
              [ui('聊天', 'Chat'), ui('只交流', 'Talk only'), MessageSquare],
              [ui('助手', 'Assistant'), ui('调用能力', 'Use abilities'), MousePointer2],
              [ui('自动执行', 'Auto'), ui('多步执行', 'Multi-step'), Zap],
            ].map(([label, hint, Icon], index) => {
              const ActiveIcon = Icon as typeof MousePointer2;
              return (
                <div
                  key={label as string}
                  className={`rounded-xl border px-3 py-4 text-center ${
                    index === 0 ? 'border-cyan-300/60 bg-cyan-300/15 text-cyan-50' : 'border-white/8 bg-white/[0.03] text-white/45'
                  }`}
                >
                  <ActiveIcon size={20} className="mx-auto mb-2" />
                  <div className="text-sm font-black">{label as string}</div>
                  <div className="mt-1 text-[11px] font-semibold">{hint as string}</div>
                </div>
              );
            })}
          </div>
          <div className="mt-5 rounded-2xl border border-cyan-300/20 bg-cyan-300/10 p-4">
            <div className="text-sm font-black text-cyan-50">{ui('当前：助手模式', 'Current: Assistant Mode')}</div>
            <p className="mt-2 text-sm leading-relaxed text-cyan-50/68">
              {ui('适合按任务选择工具、技能、团队、画布或键鼠操作。需要动手前，Lumi 会显示正在做什么。', 'Lumi can choose tools, skills, teams, canvas, or desktop control for the task. Before acting, Lumi shows what is happening.')}
            </p>
          </div>
          <div className="mt-4 space-y-2">
            {[
              ui('理解当前任务', 'Understand the task'),
              ui('选择合适能力', 'Choose the right ability'),
              ui('展示执行进度', 'Show execution progress'),
            ].map(label => (
              <div key={label} className="flex items-center gap-3 rounded-xl bg-white/[0.04] px-3 py-2 text-sm text-white/55">
                <CheckCircle2 size={16} className="text-cyan-300" />
                {label}
              </div>
            ))}
          </div>
        </div>
      );
    }

    return (
      <div className="h-full min-h-[280px] rounded-2xl border border-white/10 bg-[#101020] p-5">
        <div className="flex items-center gap-3 rounded-2xl border border-purple-300/30 bg-purple-300/12 px-4 py-3">
          <Search size={18} className="text-purple-200" />
          <span className="text-sm font-semibold text-white">settings</span>
        </div>
        <div className="mt-4 space-y-2">
          {['Settings', 'Skill Center', 'Knowledge Base', 'Chat'].map((label, index) => (
            <div
              key={label}
              className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
                index === 0 ? 'border-purple-300/45 bg-purple-300/14' : 'border-white/8 bg-white/[0.04]'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className={`h-8 w-8 rounded-lg ${index === 0 ? 'bg-purple-300' : 'bg-white/12'}`} />
                <span className="text-sm font-bold text-white/78">{label}</span>
              </div>
              <span className="text-[10px] font-black uppercase tracking-[0.18em] text-white/28">Open</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  if (!isOpen) return null;

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-[200] flex items-center justify-center p-4 pointer-events-auto">
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="absolute inset-0 bg-black/88 backdrop-blur-2xl"
        />

        <motion.div
          initial={{ opacity: 0, scale: 0.96, y: 18 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 18 }}
          className="relative grid w-full max-w-5xl overflow-hidden rounded-3xl border border-white/10 bg-[#080a10]/95 shadow-2xl md:min-h-[580px] md:grid-cols-[300px_1fr]"
        >
          <button
            onClick={onFinish}
            className="absolute right-5 top-5 z-10 text-xs font-black uppercase tracking-[0.2em] text-white/35 transition-colors hover:text-white/70"
          >
            {t.skip || ui('跳过', 'Skip')}
          </button>

          <aside className="border-b border-white/10 bg-white/[0.03] p-6 md:border-b-0 md:border-r">
            <div className="text-xs font-black uppercase tracking-[0.28em] text-white/32">First Run</div>
            <h2 className="mt-3 text-2xl font-black text-white">{ui('Lumi 桌面教程', 'Lumi Desktop Tutorial')}</h2>
            <p className="mt-3 text-sm leading-relaxed text-white/50">
              {ui('跟着四步先摸清入口、对话、执行模式和搜索。', 'Follow four steps to understand entries, chat, execution modes, and search.')}
            </p>

            <div className="mt-7 space-y-2">
              {steps.map((item, index) => (
                <button
                  key={item.title}
                  onClick={() => setCurrentStep(index)}
                  className={`flex w-full items-center gap-3 rounded-2xl border px-3 py-3 text-left transition-all ${
                    index === currentStep
                      ? 'border-white/18 bg-white/10 text-white'
                      : 'border-transparent bg-transparent text-white/45 hover:bg-white/[0.04] hover:text-white/70'
                  }`}
                >
                  <span className={`h-2.5 w-2.5 rounded-full ${index <= currentStep ? item.accent : 'bg-white/14'}`} />
                  <span className="min-w-0">
                    <span className="block text-[10px] font-black uppercase tracking-[0.18em] opacity-50">{item.eyebrow}</span>
                    <span className="mt-1 block truncate text-sm font-bold">{item.title}</span>
                  </span>
                </button>
              ))}
            </div>
          </aside>

          <section className="p-6 pt-14 md:p-8 md:pt-14">
            <div className="grid gap-7 lg:grid-cols-[1fr_360px]">
              <div className="flex min-h-[420px] flex-col">
                <motion.div
                  key={`copy-${currentStep}`}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  className="flex-1"
                >
                  <div className="flex h-16 w-16 items-center justify-center rounded-2xl border border-white/10 bg-white/[0.05]">
                    {step.icon}
                  </div>
                  <div className="mt-7 text-xs font-black uppercase tracking-[0.28em] text-white/35">{step.eyebrow}</div>
                  <h1 className="mt-3 text-4xl font-black tracking-normal text-white">{step.title}</h1>
                  <p className="mt-5 max-w-2xl text-base leading-8 text-white/62">{step.description}</p>

                  <div className="mt-7 rounded-2xl border border-white/10 bg-white/[0.04] p-4">
                    <div className="text-xs font-black uppercase tracking-[0.22em] text-white/35">{ui('现在要做', 'Do Now')}</div>
                    <div className="mt-2 text-lg font-black text-white">{step.action}</div>
                  </div>

                  <div className="mt-5 grid gap-2">
                    {step.bullets.map(item => (
                      <div key={item} className="flex items-center gap-3 text-sm font-semibold text-white/58">
                        <CheckCircle2 size={17} className="shrink-0 text-celestial-saturn" />
                        {item}
                      </div>
                    ))}
                  </div>
                </motion.div>

                <div className="mt-7 flex items-center gap-3">
                  {currentStep > 0 && (
                    <button
                      onClick={() => setCurrentStep(prev => prev - 1)}
                      className="h-12 rounded-2xl border border-white/10 px-5 text-sm font-black text-white/55 transition-colors hover:bg-white/8 hover:text-white"
                    >
                      {ui('上一步', 'Previous')}
                    </button>
                  )}
                  {currentStep < steps.length - 1 ? (
                    <button
                      onClick={() => setCurrentStep(prev => prev + 1)}
                      className="flex h-12 min-w-36 items-center justify-center gap-2 rounded-2xl bg-white px-6 text-sm font-black text-black transition-transform hover:scale-[1.02] active:scale-95"
                    >
                      {ui('下一步', 'Next')}
                      <ChevronRight size={18} />
                    </button>
                  ) : (
                    <button
                      onClick={onFinish}
                      className="flex h-12 min-w-40 items-center justify-center gap-2 rounded-2xl bg-celestial-saturn px-6 text-sm font-black text-black shadow-[0_0_34px_rgba(255,200,80,0.25)] transition-transform hover:scale-[1.02] active:scale-95"
                    >
                      {ui('进入桌面', 'Enter Desktop')}
                      <Zap size={18} fill="currentColor" />
                    </button>
                  )}
                </div>
              </div>

              <motion.div
                key={`preview-${currentStep}`}
                initial={{ opacity: 0, x: 18 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: 0.08 }}
                className="lg:pt-2"
              >
                {renderPreview()}
              </motion.div>
            </div>
          </section>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
