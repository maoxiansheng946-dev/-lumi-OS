import React, { useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { Building2, Send, Loader2, User, Bot } from 'lucide-react';
import { useT } from '../../lib/useT';

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export function CentralLumiChat() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const [messages, setMessages] = useState<Message[]>([
    { role: 'assistant', content: ui('你好，我是你们公司的 Lumi。我可以协助查询制度、文化、知识库和组织信息。你想了解什么？', "Hello! I'm your company's Lumi. I can help with policies, culture, knowledge base, and more. What would you like to know?"), timestamp: Date.now() },
  ]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if (!input.trim() || loading) return;
    const userMsg: Message = { role: 'user', content: input.trim(), timestamp: Date.now() };
    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);

    try {
      // Search KB for relevant context
      const kbRes = await fetch('/api/org/kb/search', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: userMsg.content, limit: 3 }),
        credentials: 'include',
      });
      let kbContext = '';
      if (kbRes.ok) {
        const results = await kbRes.json().catch(() => []);
        if (results.length > 0) {
          kbContext = '\n\nRelevant knowledge base context:\n' +
            results.map((r: any) => `[${r.title}] ${r.chunk}`).join('\n\n');
        }
      }

      // Call LLM with KB context
      const chatRes = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messages: [
            { role: 'system', content: `You are the company Lumi, the organizational AI assistant. Answer questions using the provided knowledge base context when available. Be professional, helpful, and aligned with company culture.${kbContext}` },
            ...messages.map(m => ({ role: m.role, content: m.content })),
            { role: 'user', content: userMsg.content },
          ],
        }),
        credentials: 'include',
      });

      const data = await chatRes.json().catch(() => ({}));
      if (!chatRes.ok) throw new Error(data.error || ui('公司 Lumi 暂时无法回答这个问题', "Company Lumi can't answer right now."));
      const reply = data.text || data.response || data.reply || data.message || ui('我现在处理这个问题有点困难。', "I'm having trouble processing that right now.");

      setMessages(prev => [...prev, { role: 'assistant', content: reply, timestamp: Date.now() }]);
    } catch (err: any) {
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: err?.message || ui('我现在无法连接公司服务，请检查网络或组织服务状态。', "I'm currently unable to reach the company server. Please check your connection."),
        timestamp: Date.now(),
      }]);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="flex items-center gap-3 p-6 pb-4 border-b border-white/5">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
          <Building2 size={20} className="text-blue-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">{t.orgChat}</h2>
          <p className="text-white/55 text-xs">{ui('组织 AI：询问制度、文化和知识', 'Organizational AI — ask about policies, culture, and knowledge')}</p>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg, i) => (
          <motion.div
            key={i}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : ''}`}
          >
            <div className={`w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 ${
              msg.role === 'user' ? 'bg-purple-500/10' : 'bg-blue-500/10'
            }`}>
              {msg.role === 'user' ? (
                <User size={14} className="text-purple-400" />
              ) : (
                <Bot size={14} className="text-blue-400" />
              )}
            </div>
            <div className={`max-w-[70%] rounded-2xl px-4 py-3 ${
              msg.role === 'user'
                ? 'bg-purple-500/10 border border-purple-500/20 text-white/90'
                : 'bg-white/5 border border-white/10 text-white/80'
            }`}>
              <p className="text-sm leading-relaxed whitespace-pre-wrap">{msg.content}</p>
              <span className="text-xs text-white/45 mt-1 block">
                {new Date(msg.timestamp).toLocaleTimeString(isZh ? 'zh-CN' : undefined, { hour: '2-digit', minute: '2-digit' })}
              </span>
            </div>
          </motion.div>
        ))}
        {loading && (
          <div className="flex gap-3">
            <div className="w-8 h-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
              <Bot size={14} className="text-blue-400" />
            </div>
            <div className="bg-white/5 border border-white/10 rounded-2xl px-4 py-3">
              <Loader2 size={16} className="animate-spin text-blue-400" />
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Input */}
      <div className="p-4 border-t border-white/5">
        <div className="flex items-center gap-3">
          <input
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleSend()}
            placeholder={ui('询问公司制度、知识库...', 'Ask about company policies, knowledge base...')}
            className="flex-1 px-4 py-3 bg-white/5 border border-white/10 rounded-xl text-white text-sm placeholder:text-white/45 focus:outline-none focus:border-blue-500/40"
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className="p-3 rounded-xl bg-blue-600 hover:bg-blue-500 disabled:opacity-30 disabled:cursor-not-allowed text-white transition-colors"
          >
            {loading ? <Loader2 size={18} className="animate-spin" /> : <Send size={18} />}
          </button>
        </div>
      </div>
    </div>
  );
}
