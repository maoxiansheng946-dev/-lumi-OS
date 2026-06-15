import { useState, useRef, useEffect, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Send, Mic, MicOff, CheckCircle, XCircle, Loader2, MessageSquare, Plus, Square, Copy, Trash2, Wifi, WifiOff, Check, Sparkles, ChevronRight } from 'lucide-react';
import Markdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import rehypeHighlight from 'rehype-highlight';

export interface ChatMessage {
  id: string;
  type: 'user-text' | 'user-voice' | 'lumi' | 'tool';
  content?: string;
  name?: string;
  args?: Record<string, any>;
  result?: string;
  error?: string;
  status?: 'running' | 'done' | 'error';
  timestamp: string;
}

interface ConvSummary {
  id: string;
  title: string;
  messageCount: number;
  lastActiveAt: string;
  createdAt: string;
  preview: string;
}

interface ChatPanelProps {
  socket: any;
  t?: any;
  onVoiceToggle?: (active: boolean) => void;
  isVoiceActive?: boolean;
  transcript?: string;
}

export function ChatPanel({ socket, t, onVoiceToggle, isVoiceActive, transcript }: ChatPanelProps) {
  const [conversations, setConversations] = useState<ConvSummary[]>([]);
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [connected, setConnected] = useState(false);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [installedSkillNames, setInstalledSkillNames] = useState<string[]>([]);
  const [streamingText, setStreamingText] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const activeConvIdRef = useRef<string | null>(null);
  activeConvIdRef.current = activeConvId;

  const scrollToBottom = useCallback(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, []);

  useEffect(() => { scrollToBottom(); }, [messages, scrollToBottom]);

  // Fetch installed skills for dynamic suggestions
  useEffect(() => {
    fetch('/api/skills').then(r => r.json()).then(data => {
      setInstalledSkillNames((data.skills || []).map((s: any) => s.name?.toLowerCase?.() || ''));
    }).catch(() => {});
  }, []);

  const hasCreativeSkill = installedSkillNames.some((n: string) => ['minimax', 'pixelle', 'video-editor', 'video editor'].some(k => n.includes(k)));
  const hasFetcher = installedSkillNames.some((n: string) => ['fetcher', 'web'].some(k => n.includes(k)));
  const hasDesktop = installedSkillNames.some((n: string) => ['desktop', 'commander'].some(k => n.includes(k)));

  const quickSuggestions = [
    { label: '随便聊聊', prompt: '你好Lumi，今天有什么有趣的发现吗？', show: true },
    { label: '生成图片', prompt: '帮我生成一张星空下的赛博朋克城市图片', show: hasCreativeSkill },
    { label: '总结网页', prompt: '帮我抓取这篇文章的内容并总结要点', show: hasFetcher },
    { label: '桌面整理', prompt: '帮我把桌面上的文件按日期整理一下', show: hasDesktop },
  ];
  const visibleSuggestions = quickSuggestions.filter(s => s.show).slice(0, 4);

  // Track connection status
  useEffect(() => {
    if (!socket) return;
    setConnected(socket.connected);
    const onConnect = () => setConnected(true);
    const onDisconnect = () => setConnected(false);
    socket.on('connect', onConnect);
    socket.on('disconnect', onDisconnect);
    return () => {
      socket.off('connect', onConnect);
      socket.off('disconnect', onDisconnect);
    };
  }, [socket]);

  // Load conversation list — only re-run when socket changes
  useEffect(() => {
    if (!socket) return;

    const onConversations = (data: { conversations: ConvSummary[] }) => {
      setConversations(data.conversations || []);
      setLoaded(true);
    };

    const onMessages = (data: { conversationId: string; messages: ChatMessage[] }) => {
      // Use ref to avoid stale closure on activeConvId
      if (data.conversationId === activeConvIdRef.current) {
        setMessages(data.messages || []);
      }
    };

    socket.on('chat:conversations', onConversations);
    socket.on('chat:messages', onMessages);
    socket.emit('chat:conversations', {});

    return () => {
      socket.off('chat:conversations', onConversations);
      socket.off('chat:messages', onMessages);
    };
  }, [socket]);

  // Refresh conversation list
  const refreshConversations = useCallback(() => {
    if (socket) socket.emit('chat:conversations', {});
  }, [socket]);

  // Live message listeners
  useEffect(() => {
    if (!socket) return;

    const onResponse = (data: { text: string; agentName?: string }) => {
      setIsTyping(false);
      setIsStreaming(false);
      setStreamingText('');
      setMessages(prev => [...prev, {
        id: crypto.randomUUID().slice(0, 9),
        type: 'lumi',
        content: data.text,
        timestamp: new Date().toISOString(),
      }]);
      refreshConversations();
    };

    const onChunk = (data: { text: string; agentName?: string }) => {
      setIsStreaming(true);
      setStreamingText(prev => prev + data.text);
    };

    const onStatus = (data: { status: string }) => {
      if (data.status === 'thinking') setIsTyping(true);
      else if (data.status === 'idle' || data.status === 'error') {
        setIsTyping(false);
        setIsStreaming(false);
        setStreamingText('');
      }
    };

    const onError = (data: { message?: string }) => {
      setIsTyping(false);
      setIsStreaming(false);
      setStreamingText('');
      const message = data.message || (t?.requestFailed || 'Request failed');
      setMessages(prev => [...prev, {
        id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        type: 'lumi',
        content: `${t?.requestFailed || 'Request failed'}\n\n${message}\n\n${toolFailureHint}`,
        timestamp: new Date().toISOString(),
      }]);
      refreshConversations();
    };

    const onToolCall = (data: {
      correlationId?: string;
      name: string;
      arguments: Record<string, any>;
      result?: string;
      error?: string;
    }) => {
      setMessages(prev => {
        if (data.correlationId) {
          const idx = prev.findIndex(m => m.id === data.correlationId);
          if (idx !== -1) {
            const updated = [...prev];
            updated[idx] = {
              ...updated[idx],
              result: data.result,
              error: data.error,
              status: data.error ? 'error' : 'done',
            };
            return updated;
          }
        }
        return [...prev, {
          id: data.correlationId || crypto.randomUUID().slice(0, 9),
          type: 'tool',
          name: data.name,
          args: data.arguments,
          result: data.result,
          error: data.error,
          status: data.result || data.error ? (data.error ? 'error' : 'done') : 'running',
          timestamp: new Date().toISOString(),
        }];
      });
    };

    const onTranscript = (data: { text: string; isFinal: boolean }) => {
      if (data.isFinal && data.text.trim()) {
        setMessages(prev => [...prev, {
          id: crypto.randomUUID().slice(0, 9),
          type: 'user-voice',
          content: data.text,
          timestamp: new Date().toISOString(),
        }]);
        refreshConversations();
      }
    };

    socket.on('agent:response', onResponse);
    socket.on('agent:chunk', onChunk);
    socket.on('agent:status', onStatus);
    socket.on('agent:error', onError);
    socket.on('agent:tool_call', onToolCall);
    socket.on('audio:transcript', onTranscript);

    return () => {
      socket.off('agent:response', onResponse);
      socket.off('agent:chunk', onChunk);
      socket.off('agent:status', onStatus);
      socket.off('agent:error', onError);
      socket.off('agent:tool_call', onToolCall);
      socket.off('audio:transcript', onTranscript);
    };
  }, [socket, refreshConversations]);

  const selectConversation = useCallback((convId: string) => {
    setActiveConvId(convId);
    setMessages([]);
    socket.emit('chat:messages', { conversationId: convId });
  }, [socket]);

  const newConversation = useCallback(() => {
    setActiveConvId(null);
    setMessages([]);
  }, []);

  const handleSend = useCallback((textOverride?: string) => {
    const text = (textOverride || input).trim();
    if (!text || !socket) return;
    if (!textOverride) setInput('');

    setMessages(prev => [...prev, {
      id: crypto.randomUUID().slice(0, 9),
      type: 'user-text',
      content: text,
      timestamp: new Date().toISOString(),
    }]);

    socket.emit('agent:task', { text, conversationId: activeConvIdRef.current });
    refreshConversations();
  }, [input, socket, refreshConversations]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }, [handleSend]);

  const handleCancelTask = useCallback(() => {
    socket?.emit('agent:task_cancel');
  }, [socket]);

  const handleVoiceToggle = useCallback(() => {
    onVoiceToggle?.(!isVoiceActive);
  }, [isVoiceActive, onVoiceToggle]);

  const handleCopyMessage = useCallback(async (content: string, id: string) => {
    try {
      await navigator.clipboard.writeText(content);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  }, []);

  const handleCloseConversation = useCallback(async (convId: string, e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await fetch(`/api/conversations/${encodeURIComponent(convId)}/close`, { method: 'POST' });
      if (activeConvIdRef.current === convId) {
        setActiveConvId(null);
        setMessages([]);
      }
      refreshConversations();
    } catch { /* ignore */ }
  }, [refreshConversations]);

  const formatTime = (ts: string) => {
    try {
      const d = new Date(ts);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    } catch { return ''; }
  };

  const formatDate = (ts: string) => {
    try {
      const d = new Date(ts);
      const now = new Date();
      const diff = now.getTime() - d.getTime();
      if (diff < 86400000 && d.getDate() === now.getDate()) return t?.today || 'Today';
      if (diff < 172800000 && d.getDate() === now.getDate() - 1) return t?.yesterday || 'Yesterday';
      return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
    } catch { return ''; }
  };

  const formatArgs = (args?: Record<string, any>) => {
    if (!args || Object.keys(args).length === 0) return '';
    const first = Object.entries(args)[0];
    const val = typeof first[1] === 'string' ? first[1] : JSON.stringify(first[1]);
    return `${first[0]}: ${val.length > 50 ? val.slice(0, 50) + '...' : val}`;
  };

  const toolFailureHint = t?.toolFailureHint || 'Check permission, adjust the request, or ask Lumi to retry.';

  const toolIcon = (name?: string) => {
    if (name?.startsWith('desktop_open')) return '🖥️';
    if (name?.startsWith('desktop_run')) return '⚡';
    if (name?.startsWith('desktop_list')) return '📂';
    if (name?.includes('search')) return '🔍';
    if (name?.includes('file') || name?.includes('write')) return '📝';
    return '🔧';
  };

  const activeConv = conversations.find(c => c.id === activeConvId);

  // Group messages by time proximity for cleaner display
  const groupedMessages = messages.reduce<{ msg: ChatMessage; showTime: boolean }[]>((acc, msg, i) => {
    const showTime = i === 0 ||
      (new Date(msg.timestamp).getTime() - new Date(messages[i - 1].timestamp).getTime()) > 300000 ||
      messages[i - 1].type !== msg.type;
    acc.push({ msg, showTime });
    return acc;
  }, []);

  return (
    <div className="flex h-full bg-[#0a0a14]/95 rounded-xl overflow-hidden">
      {/* ── Left: Conversation Sidebar ── */}
      <div className="w-56 flex-shrink-0 border-r border-white/10 flex flex-col">
        {/* Header with connection status */}
        <div className="p-3 border-b border-white/10 flex items-center justify-between">
          <button
            onClick={newConversation}
            className={`flex-1 flex items-center gap-2 px-3 py-2 rounded-lg text-xs font-medium transition-all ${
              activeConvId === null
                ? 'bg-celestial-glow/20 text-celestial-glow border border-celestial-glow/30'
                : 'bg-white/5 text-white/50 hover:bg-white/10 hover:text-white/80 border border-transparent'
            }`}
          >
            <Plus size={14} />
            {t?.newConversation || 'New'}
          </button>
          <div className="ml-2 flex-shrink-0" title={connected ? (t?.connected || 'Connected') : (t?.disconnected || 'Disconnected')}>
            {connected ? (
              <Wifi size={12} className="text-green-400/60" />
            ) : (
              <WifiOff size={12} className="text-red-400/60 animate-pulse" />
            )}
          </div>
        </div>

        {/* Conversation list */}
        <div className="flex-1 overflow-y-auto scrollbar-thin">
          {!loaded && (
            <div className="flex justify-center py-8">
              <Loader2 size={16} className="animate-spin text-white/45" />
            </div>
          )}
          {loaded && conversations.length === 0 && (
            <div className="text-center text-white/45 text-xs py-8 px-4">
              {t?.noConversations || 'No conversations yet'}
            </div>
          )}
          {conversations.map(conv => (
            <button
              key={conv.id}
              onClick={() => selectConversation(conv.id)}
              className={`w-full text-left px-3 py-2.5 border-b border-white/5 transition-colors group relative ${
                activeConvId === conv.id
                  ? 'bg-white/10'
                  : 'hover:bg-white/5'
              }`}
            >
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-white/80 truncate max-w-[120px]">
                  {conv.title || (t?.untitled || 'Untitled')}
                </span>
                <span className="text-[12px] text-white/55 flex-shrink-0 ml-1">
                  {formatDate(conv.lastActiveAt)}
                </span>
              </div>
              <div className="flex items-center justify-between mt-0.5">
                <span className="text-xs text-white/55 truncate max-w-[120px]">
                  {conv.preview || ''}
                </span>
                <div className="flex items-center gap-1">
                  {conv.messageCount > 0 && (
                    <span className="text-[12px] text-white/45">{conv.messageCount}</span>
                  )}
                  <span
                    onClick={(e) => handleCloseConversation(conv.id, e)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded hover:bg-red-500/20 text-white/45 hover:text-red-400"
                    title={t?.closeConversation || 'Close conversation'}
                  >
                    <Trash2 size={10} />
                  </span>
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* ── Right: Message Panel ── */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="flex items-center gap-2 px-4 py-2 border-b border-white/10 text-white/80 text-xs font-medium select-none flex-shrink-0">
          <MessageSquare size={14} className="text-celestial-glow" />
          <span className="truncate">
            {activeConv ? activeConv.title : (t?.newConversation || 'New Conversation')}
          </span>
          {activeConv && activeConv.messageCount > 0 && (
            <span className="text-white/40 flex-shrink-0">· {activeConv.messageCount}</span>
          )}
        </div>

        {/* Message list */}
        <div
          ref={scrollRef}
          className="flex-1 overflow-y-auto px-3 py-2 space-y-1 text-xs scrollbar-thin"
        >
          {messages.length === 0 && !isTyping && (
            <div className="text-center text-white/55 py-8 space-y-6">
              <div className="space-y-2">
                <MessageSquare size={24} className="mx-auto opacity-50" />
                <p className="text-xs">{activeConvId ? (t?.chatPanelEmpty || 'Type a message or use voice to start') : (t?.newConversationHint || 'Start a new conversation')}</p>
              </div>
              <div className="grid gap-1.5 px-2">
                {visibleSuggestions.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => handleSend(s.prompt)}
                    className="flex items-center justify-between p-2.5 rounded-xl bg-white/5 border border-white/5 text-xs text-white/40 hover:text-celestial-saturn hover:border-celestial-saturn/20 hover:bg-celestial-saturn/5 transition-all text-left group"
                  >
                    <span>{s.label}</span>
                    <ChevronRight size={11} className="opacity-0 group-hover:opacity-100 transition-opacity" />
                  </button>
                ))}
              </div>
            </div>
          )}

          <AnimatePresence>
            {groupedMessages.map(({ msg, showTime }) => (
              <motion.div
                key={msg.id}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                {msg.type === 'user-text' && (
                  <div className="flex justify-end group">
                    <div className="max-w-[80%] bg-celestial-glow/20 border border-celestial-glow/30 rounded-lg px-3 py-1.5 relative">
                      <div className="markdown-body text-white/80 text-sm leading-relaxed">
                          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                            {msg.content}
                          </Markdown>
                        </div>
                      {showTime && <span className="text-white/55 text-xs">{formatTime(msg.timestamp)}</span>}
                      {msg.content && (
                        <button
                          onClick={() => handleCopyMessage(msg.content!, msg.id)}
                          className="absolute -left-6 top-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-white/45 hover:text-white/60"
                        >
                          {copiedId === msg.id ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {msg.type === 'user-voice' && (
                  <div className="flex justify-end group">
                    <div className="max-w-[80%] bg-purple-500/20 border border-purple-500/30 rounded-lg px-3 py-1.5 relative">
                      <div className="flex items-center gap-1 text-purple-300/60 text-xs mb-0.5">
                        <Mic size={10} /> {t?.voice || 'voice'}
                      </div>
                      <div className="markdown-body text-white/80 text-sm leading-relaxed">
                          <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                            {msg.content}
                          </Markdown>
                        </div>
                      {showTime && <span className="text-white/55 text-xs">{formatTime(msg.timestamp)}</span>}
                    </div>
                  </div>
                )}

                {msg.type === 'lumi' && (
                  <div className="flex justify-start group">
                    <div className="max-w-[85%] bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 relative">
                      <div className="markdown-body text-white/80 text-sm leading-relaxed">
                        <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                          {msg.content}
                        </Markdown>
                      </div>
                      {showTime && <span className="text-white/55 text-xs">{formatTime(msg.timestamp)}</span>}
                      {msg.content && (
                        <button
                          onClick={() => handleCopyMessage(msg.content!, msg.id)}
                          className="absolute -right-6 top-1 opacity-0 group-hover:opacity-100 transition-opacity p-0.5 rounded text-white/45 hover:text-white/60"
                        >
                          {copiedId === msg.id ? <Check size={10} className="text-green-400" /> : <Copy size={10} />}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {msg.type === 'tool' && (
                  <div className="flex justify-start">
                    <div className={`max-w-[85%] border rounded-lg px-2.5 py-1.5 text-xs ${
                      msg.status === 'running' ? 'border-yellow-500/30 bg-yellow-500/5' :
                      msg.status === 'error' ? 'border-red-500/30 bg-red-500/5' :
                      'border-green-500/20 bg-green-500/5'
                    }`}>
                      <div className="flex items-center gap-1.5">
                        <span>{toolIcon(msg.name)}</span>
                        <span className="text-white/70 font-medium">{msg.name}</span>
                        {msg.status === 'running' && <Loader2 size={10} className="animate-spin text-yellow-400" />}
                        {msg.status === 'done' && <CheckCircle size={10} className="text-green-400" />}
                        {msg.status === 'error' && <XCircle size={10} className="text-red-400" />}
                      </div>
                      {formatArgs(msg.args) && (
                        <p className="text-white/40 mt-0.5 ml-5">{formatArgs(msg.args)}</p>
                      )}
                      {msg.result && (
                        <p className="text-green-300/60 mt-0.5 ml-5 truncate">{msg.result.slice(0, 100)}</p>
                      )}
                      {msg.error && (
                        <>
                          <p className="text-red-300/70 mt-0.5 ml-5 break-words">{msg.error}</p>
                          <p className="text-red-200/45 mt-1 ml-5">{toolFailureHint}</p>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </motion.div>
            ))}

            {/* Streaming indicator — live text as it arrives */}
            {isStreaming && streamingText && (
              <motion.div
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex justify-start"
              >
                <div className="max-w-[85%] bg-white/5 border border-celestial-glow/20 rounded-lg px-3 py-1.5">
                  <div className="markdown-body text-white/80 text-sm leading-relaxed">
                    <Markdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                      {streamingText}
                    </Markdown>
                  </div>
                  <span className="inline-block w-1.5 h-3 bg-celestial-glow/60 animate-pulse ml-0.5 align-middle" />
                </div>
              </motion.div>
            )}

            {/* Typing indicator */}
            {isTyping && !isStreaming && (
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                className="flex justify-start items-center gap-2"
              >
                <div className="bg-white/5 border border-white/10 rounded-lg px-3 py-2">
                  <div className="flex gap-1">
                    <span className="w-1.5 h-1.5 bg-celestial-glow/60 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                    <span className="w-1.5 h-1.5 bg-celestial-glow/60 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                    <span className="w-1.5 h-1.5 bg-celestial-glow/60 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                  </div>
                </div>
                <button
                  onClick={handleCancelTask}
                  className="text-xs text-red-400/60 hover:text-red-400 font-bold uppercase tracking-wider flex items-center gap-1 px-2 py-1 rounded-lg hover:bg-red-500/10 transition-colors"
                  title={t?.cancelTask || 'Cancel task'}
                >
                  <Square size={10} />
                  {t?.stop || 'Stop'}
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Input area */}
        <div className="border-t border-white/10 px-3 py-2 flex-shrink-0">
          {/* Quick suggestion chips above input */}
          <div className="flex gap-1 mb-2 flex-wrap">
            {visibleSuggestions.map((s, i) => (
              <button
                key={i}
                onClick={() => { setInput(s.prompt); inputRef.current?.focus(); }}
                className="px-2 py-0.5 rounded-md bg-white/5 border border-white/5 text-xs text-white/55 hover:text-white/60 hover:border-white/10 hover:bg-white/10 transition-all"
              >
                {s.label}
              </button>
            ))}
          </div>
          {isVoiceActive && transcript && (
            <div className="text-xs text-purple-300/50 mb-1 flex items-center gap-1">
              <Mic size={10} className="text-purple-400 animate-pulse" />
              {transcript}
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleVoiceToggle}
              className={`p-1.5 rounded-lg transition-colors ${
                isVoiceActive
                  ? 'bg-purple-500/30 text-purple-300'
                  : 'bg-white/5 text-white/40 hover:text-white/70 hover:bg-white/10'
              }`}
              title={isVoiceActive ? (t?.voiceActive || 'Voice active') : (t?.voiceInactive || 'Start voice')}
            >
              {isVoiceActive ? <Mic size={14} /> : <MicOff size={14} />}
            </button>
            <input
              ref={inputRef}
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={isVoiceActive ? (t?.listening || 'Listening...') : (t?.typeMessage || 'Type a message...')}
              disabled={isVoiceActive}
              className="flex-1 bg-white/5 border border-white/10 rounded-lg px-3 py-1.5 text-xs text-white/80 placeholder-white/30 focus:outline-none focus:border-celestial-glow/40 transition-colors"
            />
            <button
              onClick={() => handleSend()}
              disabled={!input.trim()}
              className="p-1.5 rounded-lg bg-celestial-glow/20 text-celestial-glow hover:bg-celestial-glow/30 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              <Send size={14} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
