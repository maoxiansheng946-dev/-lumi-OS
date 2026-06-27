import React, { useCallback, useState, useRef, useEffect } from 'react';
import { motion } from 'motion/react';
import { BrainCircuit, Building2, Send, Loader2, User, Bot, Settings } from 'lucide-react';
import { useApp } from '../../contexts/AppContext';
import { useSocket } from '../../hooks/useSocket';
import { useT } from '../../lib/useT';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
  source?: 'socket' | 'history' | 'error' | 'system';
}

interface OrgLlmPolicy {
  inheritPersonal?: boolean;
  configured?: boolean;
  provider?: string;
  model?: string;
  inheritedProvider?: string;
  inheritedModel?: string;
}

function makeMessageId(prefix = 'org-msg') {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function normalizeHistoryMessage(item: any): Message | null {
  if (item?.role === 'tool') return null;
  const role = item?.role === 'assistant' ? 'assistant' : item?.role === 'user' ? 'user' : null;
  if (!role) return null;
  const content = String(item.message || item.response || item.content || '').trim();
  if (!content) return null;
  return {
    id: item.id || makeMessageId('org-history'),
    role,
    content,
    timestamp: item.timestamp ? new Date(item.timestamp).getTime() : Date.now(),
    source: 'history',
  };
}

export function CentralLumiChat() {
  const t = useT();
  const socket = useSocket();
  const { orgConnection } = useApp();
  const isZh = t.langCode !== 'en';
  const ui = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);
  const greeting = useCallback((): Message => ({
    id: 'org-lumi-greeting',
    role: 'assistant',
    content: ui('你好，我是你们公司的 Lumi。我可以协助查询制度、文化、知识库和组织信息。你想了解什么？', "Hello! I'm your company's Lumi. I can help with policies, culture, knowledge base, and more. What would you like to know?"),
    timestamp: Date.now(),
    source: 'system',
  }), [ui]);
  const [messages, setMessages] = useState<Message[]>(() => [greeting()]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [llmPolicy, setLlmPolicy] = useState<OrgLlmPolicy | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const activeRequestIdRef = useRef<string | null>(null);
  const streamingMessageIdRef = useRef<string | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearActiveRequest = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    activeRequestIdRef.current = null;
    streamingMessageIdRef.current = null;
    setLoading(false);
  }, []);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  useEffect(() => {
    let cancelled = false;
    const loadLlmPolicy = async () => {
      if (!orgConnection?.orgId) {
        setLlmPolicy(null);
        return;
      }
      try {
        const res = await fetch('/api/preferences/org-llm', { credentials: 'include' });
        const data = await res.json().catch(() => ({}));
        if (!cancelled && res.ok) setLlmPolicy(data);
      } catch {
        if (!cancelled) setLlmPolicy(null);
      }
    };
    void loadLlmPolicy();
    return () => { cancelled = true; };
  }, [orgConnection?.orgId]);

  const llmPolicyLabel = llmPolicy
    ? llmPolicy.inheritPersonal
      ? ui('继承个人模型', 'Inherits personal model')
      : ui('组织独立模型', 'Organization model')
    : ui('模型策略', 'Model policy');
  const llmPolicyModel = llmPolicy
    ? `${llmPolicy.provider || llmPolicy.inheritedProvider || '-'} / ${llmPolicy.model || llmPolicy.inheritedModel || '-'}`
    : ui('加载中', 'Loading');
  const openOrgSettings = () => {
    window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'settings' } }));
  };

  useEffect(() => {
    let cancelled = false;
    const loadConversation = async () => {
      try {
        const activeRes = await fetch('/api/conversations/active?domain=work&agentId=lumi', {
          credentials: 'include',
        });
        const activeData = await activeRes.json().catch(() => ({}));
        const conversationId = activeData.activeConversation?.id;
        if (!activeRes.ok || !conversationId) {
          if (!cancelled) setMessages(prev => (prev.length ? prev : [greeting()]));
          return;
        }
        const messagesRes = await fetch(`/api/conversations/${conversationId}/messages?domain=work&limit=80`, {
          credentials: 'include',
        });
        const messagesData = await messagesRes.json().catch(() => ({}));
        if (!messagesRes.ok) return;
        const history = Array.isArray(messagesData.messages)
          ? messagesData.messages.map(normalizeHistoryMessage).filter(Boolean) as Message[]
          : [];
        if (!cancelled) setMessages(history.length > 0 ? history : [greeting()]);
      } catch {
        if (!cancelled) setMessages(prev => (prev.length ? prev : [greeting()]));
      }
    };
    loadConversation();
    return () => { cancelled = true; };
  }, [greeting]);

  useEffect(() => {
    if (!socket) return;

    const isCurrent = (data?: { requestId?: string }) => {
      return Boolean(activeRequestIdRef.current && data?.requestId === activeRequestIdRef.current);
    };

    const onChunk = (data: { text?: string; agentName?: string; requestId?: string }) => {
      if (!isCurrent(data) || !data.text) return;
      setLoading(false);
      setMessages(prev => {
        const streamingId = streamingMessageIdRef.current;
        if (streamingId) {
          return prev.map(message => (
            message.id === streamingId
              ? { ...message, content: message.content + data.text }
              : message
          ));
        }
        const nextId = makeMessageId('org-stream');
        streamingMessageIdRef.current = nextId;
        return [...prev, {
          id: nextId,
          role: 'assistant',
          content: data.text || '',
          timestamp: Date.now(),
          source: 'socket',
        }];
      });
    };

    const onResponse = (data: { text?: string; requestId?: string }) => {
      if (!isCurrent(data)) return;
      const finalText = (data.text || '').trim();
      setMessages(prev => {
        const streamingId = streamingMessageIdRef.current;
        if (streamingId) {
          return prev.map(message => (
            message.id === streamingId
              ? { ...message, content: finalText || message.content }
              : message
          ));
        }
        if (!finalText) return prev;
        return [...prev, {
          id: makeMessageId('org-response'),
          role: 'assistant',
          content: finalText,
          timestamp: Date.now(),
          source: 'socket',
        }];
      });
      clearActiveRequest();
    };

    const onStatus = (data: { status?: string; requestId?: string }) => {
      if (!isCurrent(data)) return;
      if (data.status === 'thinking' || data.status === 'responding') {
        setLoading(true);
      }
      if (data.status === 'idle' || data.status === 'error') {
        clearActiveRequest();
      }
    };

    const onError = (data: { message?: string; requestId?: string }) => {
      if (!isCurrent(data)) return;
      setMessages(prev => [...prev, {
        id: makeMessageId('org-error'),
        role: 'assistant',
        content: data.message || ui('公司 Lumi 暂时无法回答这个问题。', "Company Lumi can't answer right now."),
        timestamp: Date.now(),
        source: 'error',
      }]);
      clearActiveRequest();
    };

    socket.on('agent:chunk', onChunk);
    socket.on('agent:response', onResponse);
    socket.on('agent:status', onStatus);
    socket.on('agent:error', onError);

    return () => {
      socket.off('agent:chunk', onChunk);
      socket.off('agent:response', onResponse);
      socket.off('agent:status', onStatus);
      socket.off('agent:error', onError);
      clearActiveRequest();
    };
  }, [clearActiveRequest, socket, ui]);

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading) return;
    if (!socket) {
      setMessages(prev => [...prev, {
        id: makeMessageId('org-error'),
        role: 'assistant',
        content: ui('组织聊天通道还没有连接好，请稍后再试。', 'The organization chat channel is not connected yet. Please try again shortly.'),
        timestamp: Date.now(),
        source: 'error',
      }]);
      return;
    }
    if (!orgConnection?.orgId) {
      setMessages(prev => [...prev, {
        id: makeMessageId('org-error'),
        role: 'assistant',
        content: ui('请先连接或切换到组织工作域。', 'Please connect or switch to an organization work domain first.'),
        timestamp: Date.now(),
        source: 'error',
      }]);
      return;
    }

    const requestId = `org_chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const history = messages
      .filter(message => message.source !== 'error' && message.source !== 'system')
      .map(message => ({ role: message.role, content: message.content }));
    const userMsg: Message = {
      id: makeMessageId('org-user'),
      role: 'user',
      content: text,
      timestamp: Date.now(),
      source: 'socket',
    };

    activeRequestIdRef.current = requestId;
    streamingMessageIdRef.current = null;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (activeRequestIdRef.current !== requestId) return;
      setMessages(prev => [...prev, {
        id: makeMessageId('org-timeout'),
        role: 'assistant',
        content: ui('公司 Lumi 响应超时了，请稍后重试。', 'Company Lumi timed out. Please try again shortly.'),
        timestamp: Date.now(),
        source: 'error',
      }]);
      clearActiveRequest();
    }, 60000);

    setMessages(prev => [...prev, userMsg]);
    setInput('');
    setLoading(true);
    socket.emit('agent:chat', {
      text,
      history,
      personalityId: 'lumi',
      category: 'organization',
      agentId: 'lumi',
      domain: 'work',
      orgId: orgConnection.orgId,
      source: 'org-chat',
      requestId,
    });
  };

  return (
    <div className="flex flex-col h-[calc(100vh-12rem)]">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-6 pb-4 border-b border-white/5">
        <div className="w-10 h-10 rounded-xl bg-blue-500/10 flex items-center justify-center">
          <Building2 size={20} className="text-blue-400" />
        </div>
        <div>
          <h2 className="text-lg font-bold text-white">{t.orgChat}</h2>
          <p className="text-white/55 text-xs">{ui('组织 AI：询问制度、文化和知识', 'Organizational AI — ask about policies, culture, and knowledge')}</p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex min-w-0 items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-white/60" title={llmPolicyModel}>
            <BrainCircuit size={14} className={llmPolicy?.inheritPersonal ? 'text-white/45' : 'text-blue-300'} />
            <span className="whitespace-nowrap">{llmPolicyLabel}</span>
            <span className="hidden max-w-[180px] truncate text-white/35 md:inline">{llmPolicyModel}</span>
          </div>
          <button
            type="button"
            onClick={openOrgSettings}
            className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/50 transition hover:bg-white/10 hover:text-white"
            title={ui('组织设置', 'Organization settings')}
            aria-label={ui('打开组织设置', 'Open organization settings')}
          >
            <Settings size={15} />
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        {messages.map((msg) => (
          <motion.div
            key={msg.id}
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
