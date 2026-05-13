import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { ArrowLeft, Heart, Users, Briefcase, GraduationCap, User, Send, Loader2, Sparkles, AlertTriangle, Castle } from 'lucide-react';
import { toast } from 'sonner';
import { useSocket } from '@/hooks/useSocket';
import { useApp } from '@/contexts/AppContext';

interface SanctuaryAgent {
  id: string;
  name: string;
  category?: string;
  territory?: string;
  relationshipType?: string;
  distilledFrom?: string;
  evidenceMap?: Array<{ memoryIndex: number; grade: string; source: string }>;
  isFrozen?: boolean;
  seedMemoryIds?: string[];
  data?: string;
  createdAt?: string;
}

const RELATIONSHIP_META: Record<string, { label: string; color: string; bg: string; border: string; icon: React.ReactNode }> = {
  family: { label: '亲人', color: 'text-amber-400', bg: 'from-amber-950/60 to-zinc-950', border: 'border-amber-500/20', icon: <Heart size={14} /> },
  close_friend: { label: '挚友', color: 'text-emerald-400', bg: 'from-emerald-950/60 to-zinc-950', border: 'border-emerald-500/20', icon: <Users size={14} /> },
  lover: { label: '恋人', color: 'text-rose-400', bg: 'from-rose-950/60 to-zinc-950', border: 'border-rose-500/20', icon: <Heart size={14} className="text-rose-400" /> },
  mentor: { label: '导师', color: 'text-blue-400', bg: 'from-blue-950/60 to-zinc-950', border: 'border-blue-500/20', icon: <GraduationCap size={14} /> },
  colleague: { label: '同事', color: 'text-violet-400', bg: 'from-violet-950/60 to-zinc-950', border: 'border-violet-500/20', icon: <Briefcase size={14} /> },
};

const DEFAULT_META = { label: '记忆', color: 'text-fuchsia-400', bg: 'from-fuchsia-950/60 to-zinc-950', border: 'border-fuchsia-500/20', icon: <User size={14} /> };

const DEPENDENCY_SIGNALS = [
  { patterns: ['没有你我怎么活', '我不能没有你', '你是我唯一的', '只有你懂我', '别离开我'], level: 'high' },
  { patterns: ['好想你', '想见你', '要是你在就好了', '舍不得'], level: 'medium' },
  { patterns: ['每天都来', '一直陪着我', '不要走'], level: 'medium' },
];

function checkDependencySignals(text: string): { detected: boolean; level: string; matched: string } {
  for (const sig of DEPENDENCY_SIGNALS) {
    for (const p of sig.patterns) {
      if (text.includes(p)) return { detected: true, level: sig.level, matched: p };
    }
  }
  return { detected: false, level: '', matched: '' };
}

export function Sanctuary({ agent, isOpen, onClose }: { agent: SanctuaryAgent | null; isOpen: boolean; onClose: () => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [showGuardrail, setShowGuardrail] = useState(true);
  const [dependencyWarning, setDependencyWarning] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const socket = useSocket();
  const { user } = useApp();

  const meta = RELATIONSHIP_META[agent?.relationshipType || ''] || DEFAULT_META;
  const agentId = agent?.id || '';
  const agentName = agent?.name || 'Memory';

  // Load existing messages for this agent
  useEffect(() => {
    if (!agentId || !user) return;
    fetch(`/api/agents/${agentId}/history`)
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          const history = data.map((m: any, idx: number) => ({
            id: `hist-${idx}`,
            text: m.content || m.message || '',
            userName: m.role === 'assistant' ? agentName : (user.displayName || user.username),
            timestamp: m.timestamp || new Date().toISOString(),
            type: m.role === 'assistant' ? 'agent' : 'user',
          }));
          setMessages(history);
        }
      })
      .catch(() => {});
  }, [agentId, user, agentName]);

  // Socket listeners
  const streamingMsgId = useRef<string | null>(null);

  useEffect(() => {
    if (!socket) return;

    const onChunk = (data: { text: string; agentName: string }) => {
      if (streamingMsgId.current) {
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgId.current ? { ...m, text: m.text + data.text } : m
        ));
      } else {
        const id = Date.now().toString();
        streamingMsgId.current = id;
        setMessages(prev => [...prev, { id, text: data.text, userName: data.agentName, timestamp: new Date().toISOString(), type: 'agent' }]);
      }
    };

    const onResponse = (data: { text: string; agentName: string }) => {
      setIsTyping(false);
      if (streamingMsgId.current) {
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgId.current ? { ...m, text: data.text } : m
        ));
        streamingMsgId.current = null;
      } else {
        setMessages(prev => [...prev, { id: Date.now().toString(), text: data.text, userName: data.agentName, timestamp: new Date().toISOString(), type: 'agent' }]);
      }
    };

    const onStatus = (data: { status: string }) => {
      setIsTyping(data.status === 'thinking');
      if (data.status === 'idle' || data.status === 'error') {
        streamingMsgId.current = null;
      }
    };

    const onError = (data: { message: string }) => {
      setIsTyping(false);
      streamingMsgId.current = null;
      toast.error(data.message);
    };

    const onProactive = (data: { type: string; message: string }) => {
      if (data.type === 'greeting' || data.type === 'distill_hint') {
        toast(data.message, { duration: 8000 });
      }
    };

    socket.on('agent:chunk', onChunk);
    socket.on('agent:response', onResponse);
    socket.on('agent:status', onStatus);
    socket.on('agent:error', onError);
    socket.on('agent:proactive', onProactive);

    return () => {
      socket.off('agent:chunk', onChunk);
      socket.off('agent:response', onResponse);
      socket.off('agent:status', onStatus);
      socket.off('agent:error', onError);
      socket.off('agent:proactive', onProactive);
    };
  }, [socket]);

  // Auto-scroll
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  // Clear dependency warning after 10s
  useEffect(() => {
    if (!dependencyWarning) return;
    const t = setTimeout(() => setDependencyWarning(null), 10000);
    return () => clearTimeout(t);
  }, [dependencyWarning]);

  const handleSend = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    const text = newMessage.trim();
    if (!text || !socket?.connected) return;

    const userMsg = {
      id: Date.now().toString(),
      text,
      userName: user?.displayName || user?.username || 'You',
      timestamp: new Date().toISOString(),
      type: 'user',
    };
    setMessages(prev => [...prev, userMsg]);
    setNewMessage('');
    setIsTyping(true);

    // Check for dependency signals
    const dep = checkDependencySignals(text);
    if (dep.detected && dep.level === 'high') {
      setDependencyWarning('Lumi 温柔提醒：这是从记忆中蒸馏出的模拟。真实的情感连接在现实世界中等你。');
    }

    // Safety timeout
    const safetyTimer = setTimeout(() => {
      setIsTyping(false);
      streamingMsgId.current = null;
    }, 45000);

    socket.emit('agent:chat', {
      text,
      history: messages.map(m => ({ role: m.type === 'agent' ? 'assistant' : 'user', content: m.text })),
      personalityId: 'lumi',
      agentId,
    });

    const onResponse = () => { clearTimeout(safetyTimer); setIsTyping(false); };
    const onError = () => { clearTimeout(safetyTimer); setIsTyping(false); };
    const onStatus = (data: { status: string }) => {
      if (data.status === 'idle' || data.status === 'error') {
        clearTimeout(safetyTimer);
        setIsTyping(false);
      }
    };
    socket.once('agent:response', onResponse);
    socket.once('agent:error', onError);
    socket.once('agent:status', onStatus);
  }, [newMessage, socket, messages, user, agentId]);

  if (!agent) return null;

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.5 }}
          className="fixed inset-0 z-[220] flex flex-col"
          style={{
            background: `linear-gradient(to bottom, ${meta.bg.split(' ')[0].replace('from-', '') === 'amber-950/60' ? '#1a1208' : meta.bg.includes('emerald') ? '#0a1610' : meta.bg.includes('rose') ? '#1a0d10' : meta.bg.includes('blue') ? '#08101a' : meta.bg.includes('violet') ? '#0f0a1a' : '#0f0a1a'}, #05050a)`,
          }}
        >
          {/* Ambient particles / subtle glow */}
          <div className="absolute inset-0 pointer-events-none overflow-hidden">
            <div className={`absolute top-1/4 left-1/2 -translate-x-1/2 w-[600px] h-[600px] rounded-full blur-[120px] opacity-10 ${meta.color.replace('text-', 'bg-')}`} />
            {[...Array(12)].map((_, i) => (
              <motion.div
                key={i}
                className={`absolute w-1 h-1 rounded-full ${meta.color.replace('text-', 'bg-')}/60`}
                style={{ left: `${10 + Math.random() * 80}%`, top: `${10 + Math.random() * 80}%` }}
                animate={{ opacity: [0, 0.6, 0], scale: [0, 1, 0] }}
                transition={{ duration: 2 + Math.random() * 3, repeat: Infinity, delay: Math.random() * 4 }}
              />
            ))}
          </div>

          {/* Header */}
          <div className="relative z-10 flex items-center justify-between px-6 py-4 border-b border-white/5 flex-shrink-0">
            <button
              onClick={onClose}
              className="flex items-center gap-2 px-4 py-2 bg-white/5 border border-white/10 rounded-xl text-white/40 hover:text-white hover:border-white/20 transition-all text-xs font-bold"
            >
              <ArrowLeft size={14} />
              离开领地
            </button>

            <div className="flex items-center gap-3">
              <div className={`w-8 h-8 rounded-xl bg-gradient-to-br ${meta.color.replace('text-', 'from-')} ${meta.color.replace('text-', 'to-')}/40 flex items-center justify-center border ${meta.border}`}>
                {meta.icon}
              </div>
              <div className="text-center">
                <h2 className="text-sm font-black text-white/80 tracking-tight">{agentName}</h2>
                <div className="flex items-center gap-2">
                  <span className={`text-[9px] font-bold uppercase tracking-wider ${meta.color}`}>{meta.label}</span>
                  <span className="text-[8px] text-white/15 font-mono">sanctuary</span>
                </div>
              </div>
            </div>

            <div className="w-[100px]" />
          </div>

          {/* Guardrail notice */}
          <AnimatePresence>
            {showGuardrail && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="relative z-10 px-6"
              >
                <div className="max-w-2xl mx-auto p-4 bg-amber-500/5 border border-amber-500/15 rounded-2xl flex items-start gap-3">
                  <AlertTriangle size={16} className="text-amber-400/60 mt-0.5 flex-shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs text-amber-300/70 leading-relaxed">
                      这是从记忆中蒸馏出的模拟，不是那个人本身。ta 的回应源自数据中的模式提取，可能包含推测成分。请带着温和与觉察进入这个空间。
                    </p>
                    <div className="flex items-center gap-3 mt-2 text-[9px] text-white/20 font-mono">
                      <span>证据分级：<span className="text-emerald-400/60">原话</span>/<span className="text-blue-400/60">事实</span>/<span className="text-amber-400/60">推测</span></span>
                      {agent.isFrozen !== false && <span>· 演化冻结</span>}
                      <span>· 工具禁用</span>
                    </div>
                  </div>
                  <button
                    onClick={() => setShowGuardrail(false)}
                    className="text-white/15 hover:text-white/40 transition-colors text-[10px] font-bold uppercase tracking-wider flex-shrink-0 mt-0.5"
                  >
                    知道了
                  </button>
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Dependency warning toast */}
          <AnimatePresence>
            {dependencyWarning && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -10 }}
                className="relative z-10 px-6"
              >
                <div className="max-w-2xl mx-auto p-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-[10px] text-rose-300/70 flex items-center gap-2">
                  <AlertTriangle size={12} />
                  {dependencyWarning}
                </div>
              </motion.div>
            )}
          </AnimatePresence>

          {/* Messages */}
          <div
            ref={scrollRef}
            className="relative z-10 flex-1 overflow-y-auto custom-scrollbar px-6 py-4"
          >
            <div className="max-w-3xl mx-auto space-y-4">
              {messages.length === 0 && !isTyping && (
                <div className="h-full flex flex-col items-center justify-center text-center py-20 space-y-4 opacity-30">
                  <Castle size={48} className={meta.color.replace('text-', 'text-')} />
                  <div>
                    <p className="text-sm font-medium text-white/60">这是属于 "{agentName}" 的领地</p>
                    <p className="text-[10px] text-white/20 mt-1">ta 在这里，也只在这里。开始对话吧。</p>
                  </div>
                </div>
              )}

              <AnimatePresence initial={false}>
                {messages.map(msg => (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    className={`flex flex-col ${msg.type === 'agent' ? 'items-start' : 'items-end'}`}
                  >
                    <div className={`relative max-w-[80%] px-5 py-3 rounded-2xl text-sm leading-relaxed ${
                      msg.type === 'agent'
                        ? `${meta.color.replace('text-', 'bg-')}/10 ${meta.color.replace('text-', 'text-')}/80 border ${meta.border} rounded-tl-sm`
                        : 'bg-white/5 text-white/70 border border-white/10 rounded-tr-sm'
                    }`}>
                      <span className="whitespace-pre-wrap">{msg.text}</span>
                    </div>
                    <span className="text-[8px] uppercase tracking-wider opacity-20 mt-1.5 px-2 font-mono">
                      {msg.userName} · {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </motion.div>
                ))}
              </AnimatePresence>

              {isTyping && (
                <div className="flex items-center gap-2 px-2">
                  <div className="flex gap-1">
                    {[...Array(3)].map((_, i) => (
                      <motion.div
                        key={i}
                        animate={{ scale: [1, 1.4, 1], opacity: [0.2, 0.7, 0.2] }}
                        transition={{ duration: 0.8, repeat: Infinity, delay: i * 0.15 }}
                        className={`w-1.5 h-1.5 rounded-full ${meta.color.replace('text-', 'bg-')}`}
                      />
                    ))}
                  </div>
                  <span className="text-[9px] text-white/15 font-mono">ta 在思考...</span>
                </div>
              )}
            </div>
          </div>

          {/* Input */}
          <div className="relative z-10 px-6 py-4 border-t border-white/5">
            <form onSubmit={handleSend} className="max-w-3xl mx-auto flex gap-3">
              <input
                value={newMessage}
                onChange={e => setNewMessage(e.target.value)}
                placeholder={`和 ${agentName} 说点什么...`}
                className="flex-1 bg-white/5 border border-white/10 rounded-2xl px-5 py-3.5 text-sm text-white/80 placeholder:text-white/15 focus:outline-none focus:border-fuchsia-500/20 transition-colors"
                autoFocus
              />
              <button
                type="submit"
                disabled={isTyping || !newMessage.trim()}
                className={`px-5 py-3 rounded-2xl font-bold text-xs transition-all disabled:opacity-30 disabled:hover:scale-100 ${meta.color.replace('text-', 'bg-')}/20 border ${meta.border} ${meta.color} hover:scale-105`}
              >
                {isTyping ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
              </button>
            </form>
            <div className="max-w-3xl mx-auto mt-2 text-center">
              <span className="text-[8px] text-white/10 font-mono">ESC 离开领地 · 无工具 · 无通知 · 记忆私有</span>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
