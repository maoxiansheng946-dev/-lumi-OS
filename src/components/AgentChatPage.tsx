import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, MessageSquare, Loader2, ArrowLeft, Ghost, Zap, Cpu, Sparkles, Upload, FileText, Mic, Video, CheckCircle2, Pause, Play, Square, ChevronDown, ChevronRight, XCircle, History, Clock, Plus, Info, Copy, Check, Trash2 } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { socketService } from '@/services/socketService';
import { useTTS } from '@/hooks/useTTS';
import { GlassCard, PulseCounter } from './SharedUI';
import { toast } from 'sonner';
import { FoundersSanctuary } from './FoundersSanctuary';
import { usePlatform } from '@/hooks/usePlatform';
import { runAgentLogic, AgentResponse } from '@/services/agentService';
import { useApp } from '@/contexts/AppContext';
import { VoiceCallButton } from './VoiceCallButton';
import { useSocket } from '@/hooks/useSocket';
import { useVoiceCall } from '@/hooks/useVoiceCall';
import { useVoiceCloning } from '@/hooks/useVoiceCloning';
import { listVoices } from '@/services/voiceService';

export function AgentChatPage({ t, user, agent, isOpen, onClose, prefillMessage, onPrefillConsumed }: { t: any; user: any; agent?: any; isOpen: boolean; onClose: () => void; prefillMessage?: string; onPrefillConsumed?: () => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [agentMetadata, setAgentMetadata] = useState<Partial<AgentResponse>>({});
  const { platform, isElectron } = usePlatform();
  const { aiConfig, orgConnection, workDomain } = useApp();
  const socket = useSocket();
  const [selectedVoiceId, setSelectedVoiceId] = useState<string | undefined>();
  const [voices, setVoices] = useState<any[]>([]);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
  const voicePickerRef = useRef<HTMLDivElement>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [installedSkillNames, setInstalledSkillNames] = useState<string[]>([]);

  // Fetch installed skills to generate dynamic suggestions
  useEffect(() => {
    fetch('/api/skills').then(r => r.json()).then(data => {
      setInstalledSkillNames((data.skills || []).map((s: any) => s.name?.toLowerCase?.() || ''));
    }).catch(() => {});
  }, []);

  const hasCreativeSkill = installedSkillNames.some((n: string) => ['minimax', 'pixelle', 'video-editor', 'video editor'].some(k => n.includes(k)));
  const hasFetcher = installedSkillNames.some((n: string) => ['fetcher', 'web'].some(k => n.includes(k)));
  const hasDesktop = installedSkillNames.some((n: string) => ['desktop', 'commander'].some(k => n.includes(k)));

  const quickSuggestions = [
    { id: 'chat', label: t.suggestChat || '随便聊聊', prompt: '你好Lumi，今天有什么有趣的发现吗？', show: true },
    { id: 'creative', label: t.suggestCreative || '生成一张图片', prompt: '帮我生成一张星空下的赛博朋克城市图片', show: hasCreativeSkill },
    { id: 'fetch', label: t.suggestFetch || '总结网页内容', prompt: '帮我抓取这篇文章的内容并总结要点', show: hasFetcher },
    { id: 'desktop', label: t.suggestDesktop || '桌面整理', prompt: '帮我把桌面上的文件按日期整理一下', show: hasDesktop },
    { id: 'music', label: t.suggestMusic || '创作一首音乐', prompt: '帮我创作一首舒缓的钢琴曲，带有海浪的声音', show: hasCreativeSkill },
  ];

  const visibleSuggestions = quickSuggestions.filter(s => s.show).slice(0, 4);

  const { callState, audioLevel, startCall, endCall, error: callError } = useVoiceCall({
    socket,
    onTranscript: (text, isFinal) => {
      if (isFinal) {
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text,
          userName: user?.displayName || user?.username || 'You',
          timestamp: new Date().toISOString(),
          type: 'user',
          source: 'voice',
        }]);
      }
    },
  });

  useEffect(() => {
    listVoices().then(data => {
      const all = [...data.cloned, ...data.premade];
      setVoices(all);
      if (all.length > 0 && !selectedVoiceId) {
        setSelectedVoiceId(all[0].voiceId);
      }
    }).catch(err => toast.error(t.failedToLoadVoices || 'Failed to load voices'));
  }, [selectedVoiceId]);

  useEffect(() => {
    if (callError) toast.error(callError);
  }, [callError]);

  // Click outside to close voice picker
  useEffect(() => {
    if (!showVoicePicker) return;
    const onClick = (e: MouseEvent) => {
      if (voicePickerRef.current && !voicePickerRef.current.contains(e.target as Node)) {
        setShowVoicePicker(false);
      }
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [showVoicePicker]);

  const [newMessage, setNewMessage] = useState('');
  const [isTyping, setIsTyping] = useState(false);
  const [isOptimizing, setIsOptimizing] = useState(false);
  const [isListening, setIsListening] = useState(false);
  const [optimizationProgress, setOptimizationProgress] = useState(0);
  const [activeConversation, setActiveConversation] = useState<any>(null);
  const [showResumePrompt, setShowResumePrompt] = useState(false);
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [isLoadingMessages, setIsLoadingMessages] = useState(false);
  const [showInfoPanel, setShowInfoPanel] = useState(false);
  const { speak, stop, pause, resume, isSpeaking, isPaused } = useTTS();
  const recognition = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const activeCidRef = useRef<string | null>(null);
  const agentNameRef = useRef<string>('Lumi');

  // Escape to close panels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showVoicePicker) setShowVoicePicker(false);
        else if (showInfoPanel) setShowInfoPanel(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showVoicePicker, showInfoPanel]);

  const agentName = agent?.name || (t.lumiEssence || 'Lumi Essence');
  const agentCategory = agent?.category || (t.friend || 'friend');
  const agentId = agent?.id || 'lumi';

  const isFounder = agentId === 'founder' || agentCategory === 'founder' || agentName.includes('Founder') || agentName.includes('创始人');

  // Keep refs in sync for socket callback closures
  useEffect(() => { activeCidRef.current = activeConversationId; }, [activeConversationId]);
  useEffect(() => { agentNameRef.current = agentName; }, [agentName]);

  useEffect(() => {
    // Initialize Speech Recognition
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      recognition.current = new SpeechRecognition();
      recognition.current.continuous = false;
      recognition.current.interimResults = false;
      recognition.current.lang = 'zh-CN'; // Default to Chinese, can be dynamic

      recognition.current.onresult = (event: any) => {
        const transcript = event.results[0][0].transcript;
        setNewMessage(transcript);
        setIsListening(false);
      };

      recognition.current.onerror = (event: any) => {
        console.error('Speech recognition error', event.error);
        setIsListening(false);
        toast.error(`${t.speechNotSupported || 'Speech recognition error'}: ${event.error}`);
      };

      recognition.current.onend = () => {
        setIsListening(false);
      };
    }
  }, []);

  const handleResumeConversation = useCallback(async (conversationId: string) => {
    try {
      const res = await fetch(`/api/conversations/${conversationId}/messages?limit=100`);
      const data = await res.json();
      if (data.messages && Array.isArray(data.messages)) {
        const historyMessages = data.messages.map((m: any, idx: number) => ({
          id: `resume-${idx}`,
          text: m.content || m.message || '',
          userName: m.role === 'assistant' ? agentName : (user?.displayName || user?.username || (t.chatUserFallback || 'User')),
          timestamp: m.timestamp || new Date().toISOString(),
          type: m.role === 'assistant' ? 'agent' : 'user'
        }));
        setMessages(historyMessages);
      }
      setShowResumePrompt(false);
    } catch (err) {
      console.error("Failed to resume conversation", err);
    }
  }, [agentName, user]);

  const fetchConversations = useCallback(async () => {
    setIsLoadingConversations(true);
    try {
      const res = await fetch('/api/conversations');
      const data = await res.json();
      if (data.conversations) setConversations(data.conversations);
    } catch (err) {
      console.error('Failed to fetch conversations', err);
    } finally {
      setIsLoadingConversations(false);
    }
  }, []);

  const handleSelectConversation = useCallback(async (convId: string) => {
    if (convId === activeConversationId) return;
    setIsLoadingMessages(true);
    try {
      const res = await fetch(`/api/conversations/${convId}/messages?limit=100`);
      const data = await res.json();
      if (data.messages && Array.isArray(data.messages)) {
        const historyMessages = data.messages.map((m: any, idx: number) => ({
          id: `conv-${idx}`,
          text: m.content || m.message || '',
          userName: m.role === 'assistant' ? agentName : (user?.displayName || user?.username || (t.chatUserFallback || 'User')),
          timestamp: m.timestamp || new Date().toISOString(),
          type: m.role === 'assistant' ? 'agent' : 'user'
        }));
        setMessages(historyMessages);
        setActiveConversationId(convId);
        setShowResumePrompt(false);
        const conv = conversations.find(c => c.id === convId);
        if (conv) setActiveConversation(conv);
      }
    } catch (err) {
      toast.error(t.failedToLoadConversation || 'Failed to load conversation');
    } finally {
      setIsLoadingMessages(false);
    }
  }, [activeConversationId, agentName, user, conversations, t.failedToLoadConversation]);

  const handleNewConversation = useCallback(async () => {
    if (activeConversationId) {
      try {
        await fetch(`/api/conversations/${activeConversationId}/close`, { method: 'POST' });
      } catch (err) {
        console.error('Failed to close conversation', err);
      }
    }
    setMessages([]);
    setActiveConversationId(null);
    setActiveConversation(null);
    setShowResumePrompt(false);
    fetchConversations();
  }, [activeConversationId, fetchConversations]);

  const handleCopyMessage = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  }, []);

  useEffect(() => {
    if (agentId && !isFounder) {
      fetchConversations();

      fetch(`/api/agents/${agentId}/history`)
        .then(res => res.json())
        .then(data => {
          if (Array.isArray(data)) {
            const historyMessages = data.map((m: any, idx: number) => ({
              id: `history-${idx}`,
              text: m.content,
              userName: m.role === 'assistant' ? agentName : (user?.displayName || user?.username || (t.chatUserFallback || 'User')),
              timestamp: new Date().toISOString(),
              type: m.role === 'assistant' ? 'agent' : 'user'
            }));
            setMessages(historyMessages);
          }
        })
        .catch(err => console.error(t.failedToLoadChatHistory || "Failed to load chat history", err));

      fetch('/api/conversations/active')
        .then(res => res.json())
        .then(data => {
          if (data.activeConversation) {
            setActiveConversation(data.activeConversation);
            setActiveConversationId(data.activeConversation.id);
            if (data.activeConversation.agentId !== agentId) {
              setShowResumePrompt(true);
            }
          }
        })
        .catch(err => toast.error(t.failedToLoadConversation || 'Failed to load conversation'));
    }
  }, [agentId, agentName, user, isFounder, fetchConversations, t.failedToLoadChatHistory, t.failedToLoadConversation]);

  const streamingMsgId = useRef<string | null>(null);

  useEffect(() => {
    if (isFounder || !socket) return;

    socket.on("agent:proactive", (data: { message: string; timestamp: string }) => {
      setMessages(prev => {
        if (prev.some(m => m.text === data.message && m.type === 'agent')) return prev;
        return [...prev, {
          id: `proactive-${Date.now()}`,
          text: data.message,
          userName: agentName,
          timestamp: data.timestamp || new Date().toISOString(),
          type: 'agent',
          source: 'proactive',
        }];
      });
    });

    socket.on("agent:chunk", (data: { text: string; agentName: string }) => {
      if (streamingMsgId.current) {
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgId.current ? { ...m, text: m.text + data.text } : m
        ));
      } else {
        const id = Date.now().toString();
        streamingMsgId.current = id;
        setMessages(prev => [...prev, {
          id,
          text: data.text,
          userName: data.agentName,
          timestamp: new Date().toISOString(),
          type: 'agent'
        }]);
      }
    });

    socket.on("agent:tool", (data: { name: string; args: any; result?: string; error?: string }) => {
      setMessages(prev => [...prev, {
        id: `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        userName: data.name,
        text: data.error || data.result || '',
        timestamp: new Date().toISOString(),
        type: 'tool',
        toolName: data.name,
        toolArgs: data.args,
        toolResult: data.result,
        toolError: data.error,
        toolStatus: data.error ? 'error' : 'done',
      }]);
    });

    socket.on("agent:response", (data: { text: string; agentName: string; source?: string }) => {
      setIsTyping(false);
      if (streamingMsgId.current) {
        // Finalize streamed message with complete text
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgId.current ? { ...m, text: data.text } : m
        ));
        streamingMsgId.current = null;
      } else {
        // No streaming — add as new message
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: data.text,
          userName: data.agentName,
          timestamp: new Date().toISOString(),
          type: 'agent'
        }]);
      }
      // Auto-speak disabled
    });

    socket.on("agent:status", (data: { status: string }) => {
      setIsTyping(data.status === "thinking");
      if (data.status === "idle" || data.status === "error") {
        // Drop partial streaming chunks that were never finalized
        if (streamingMsgId.current) {
          const sid = streamingMsgId.current;
          setMessages(prev => prev.filter(m => m.id !== sid));
          streamingMsgId.current = null;
        }
      }
    });

    socket.on("agent:error", (data: { message: string; code?: string }) => {
      setIsTyping(false);
      if (streamingMsgId.current) {
        const sid = streamingMsgId.current;
        setMessages(prev => prev.filter(m => m.id !== sid));
        streamingMsgId.current = null;
      }
      toast.error(data.message);
    });

    // Live-refresh messages from API when voice/other sources save to conversation.
    // Skip if a chunk stream is in-progress OR local state is already up-to-date.
    socket.on("chat:conversation_updated", (data: { conversationId: string; agentId: string }) => {
      if (data.agentId !== agentId) return;
      fetchConversations();
      if (streamingMsgId.current) return;
      const cid = activeCidRef.current;
      if (cid && data.conversationId === cid) {
        fetch(`/api/conversations/${data.conversationId}/messages?limit=100`)
          .then(r => r.json())
          .then(result => {
            if (!result.messages || !Array.isArray(result.messages)) return;
            // Only replace if API has more messages (e.g. voice added some).
            // If counts match, local state is already correct — no-op to avoid flicker.
            setMessages(prev => {
              if (prev.length >= result.messages.length) return prev;
              return result.messages.map((m: any, idx: number) => ({
                id: m.id || `hist-${idx}`,
                text: m.content,
                userName: m.role === 'assistant' ? (agentNameRef.current || (t.lumi || 'Lumi')) : (user?.displayName || (t.you || 'You')),
                timestamp: m.createdAt,
                type: m.role === 'assistant' ? 'agent' : 'user',
                mode: m.mode,
              }));
            });
          })
          .catch(() => {});
      }
    });

    return () => {
      socket.off("agent:proactive");
      socket.off("agent:chunk");
      socket.off("agent:tool");
      socket.off("agent:response");
      socket.off("agent:status");
      socket.off("agent:error");
      socket.off("chat:conversation_updated");
      stop();
    };
  }, [speak, stop, isFounder, socket]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  const sendText = async (text: string) => {
    if (!text || !user) return;

    const userMsg = {
      id: Date.now().toString(),
      text,
      userName: user.displayName || user.username || (t.chatUserFallback || 'User'),
      timestamp: new Date().toISOString(),
      type: 'user'
    };

    setMessages(prev => [...prev, userMsg]);
    setNewMessage('');
    stop();
    setIsTyping(true);

    // Safety timeout: reset typing state if no response within 30s
    const safetyTimer = setTimeout(() => {
      setIsTyping(false);
      streamingMsgId.current = null;
    }, 30000);

    if (socket?.connected) {
      socket.emit("agent:chat", {
        text,
        history: messages.map(m => ({ role: m.type === 'agent' ? 'assistant' : 'user', content: m.text })),
        personalityId: 'lumi',
        category: agentCategory,
        agentId,
        domain: workDomain,
        orgId: orgConnection?.orgId || null,
      });

      // Clear safety timer when response arrives
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
    } else {
      clearTimeout(safetyTimer);
      // Fallback to REST if socket not connected
      try {
        const response = await runAgentLogic(text, { platform, aiConfig });
        setAgentMetadata(response);
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: response.text,
          userName: agentName,
          timestamp: new Date().toISOString(),
          type: 'agent'
        }]);
      } catch (err) {
        toast.error(t.failedToRouteNeuralMesh || "Failed to route through Neural Mesh.");
      } finally {
        setIsTyping(false);
      }
    }
  };

  // When prefillMessage comes from notification center, show it as a Lumi message
  const sentRef = useRef<string>('');
  useEffect(() => {
    if (prefillMessage && prefillMessage !== sentRef.current) {
      sentRef.current = prefillMessage;
      setMessages(prev => {
        if (prev.some(m => m.text === prefillMessage && m.type === 'agent')) return prev;
        return [...prev, {
          id: `proactive-${Date.now()}`,
          text: prefillMessage,
          userName: agentName,
          timestamp: new Date().toISOString(),
          type: 'agent',
          source: 'proactive',
        }];
      });
      onPrefillConsumed?.();
    }
  }, [prefillMessage, onPrefillConsumed]);

  const handleSendMessage = (e: React.FormEvent) => {
    e.preventDefault();
    sendText(newMessage.trim());
  };

  const toggleListening = () => {
    if (!recognition.current) {
      toast.error(t.speechNotSupported || "Speech recognition is not supported in this browser.");
      return;
    }

    if (isListening) {
      recognition.current.stop();
    } else {
      stop(); // Stop TTS if speaking
      recognition.current.start();
      setIsListening(true);
    }
  };

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importType, setImportType] = useState<'text' | 'voice' | 'video'>('text');

  const acceptMap: Record<string, string> = {
    text: '.txt,.md,.json,.csv,.pdf,.docx,.ts,.tsx,.js,.jsx,.py,.html,.css,.yaml,.yml,.xml,.log',
    voice: '.mp3,.wav,.m4a,.ogg,.flac,.webm',
    video: '.mp4,.mov,.avi,.webm,.mkv',
  };

  const handleImportData = (type: 'text' | 'voice' | 'video') => {
    setImportType(type);
    fileInputRef.current?.click();
  };

  const doUpload = (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsOptimizing(true);
    setOptimizationProgress(0);

    const formData = new FormData();
    Array.from(files).forEach(f => formData.append('files', f));

    const xhr = new XMLHttpRequest();
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable) {
        setOptimizationProgress(Math.round((e.loaded / e.total) * 90));
      }
    };
    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        setOptimizationProgress(100);
        setTimeout(() => {
          setIsOptimizing(false);
          setOptimizationProgress(0);
        }, 500);
        toast.success(`${t.chatKnowledgeAdded || 'Added to Knowledge Base'}: ${files.length} file(s)`);
      } else {
        setIsOptimizing(false);
        try {
          const err = JSON.parse(xhr.responseText);
          toast.error(err.error || (t.uploadFailed || 'Upload failed'));
        } catch {
          toast.error(t.uploadFailed || 'Upload failed');
        }
      }
    };
    xhr.onerror = () => {
      setIsOptimizing(false);
      toast.error(t.chatConnError || 'Connection error during upload');
    };
    xhr.open('POST', '/api/files/upload');
    xhr.withCredentials = true;
    xhr.send(formData);
  };

  if (isFounder) {
    return <FoundersSanctuary t={t} user={user} onBack={onClose} />;
  }

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ clipPath: 'circle(0% at 50% 95%)', opacity: 0 }}
          animate={{ clipPath: 'circle(150% at 50% 95%)', opacity: 1 }}
          exit={{ clipPath: 'circle(0% at 50% 95%)', opacity: 0 }}
          transition={{ duration: 0.65, ease: [0.25, 0.1, 0.25, 1] }}
          className="fixed inset-0 z-[210] flex flex-col"
          style={{
            background: 'radial-gradient(ellipse at 50% 30%, #0a0f1e 0%, #060810 40%, #020205 100%)',
          }}
        >
      <input
        type="file"
        ref={fileInputRef}
        className="hidden"
        multiple
        accept={acceptMap[importType]}
        onChange={(e) => { doUpload(e.target.files); e.target.value = ''; }}
      />
    <div className="flex-1 max-w-[90rem] mx-auto w-full space-y-4 md:space-y-8 pb-32 md:pb-0 overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-4 md:px-0 pt-6 flex-shrink-0">
        <button
          onClick={onClose}
          className="w-10 h-10 flex items-center justify-center bg-black/40 backdrop-blur-xl border border-white/[0.08] rounded-2xl text-white/40 hover:text-white hover:border-white/20 transition-all"
        >
          <ArrowLeft size={18} />
        </button>
        <div className="flex items-center gap-3">
          <div className="relative">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowVoicePicker(!showVoicePicker)}
              className="text-[10px] font-black uppercase tracking-widest text-white/40 flex items-center gap-2 hover:text-celestial-saturn transition-colors"
            >
              {voices.find(v => v.voiceId === selectedVoiceId)?.name || (t.selectVoice || 'Select Voice')}
              <ChevronDown size={12} />
            </Button>
            
            <AnimatePresence>
              {showVoicePicker && (
                <motion.div
                  ref={voicePickerRef}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 10 }}
                  className="absolute top-full left-0 mt-2 w-48 bg-black/80 backdrop-blur-xl border border-white/10 rounded-2xl p-2 z-50 shadow-2xl max-h-64 overflow-y-auto custom-scrollbar"
                >
                  {voices.map(v => (
                    <button
                      key={v.voiceId}
                      onClick={() => {
                        setSelectedVoiceId(v.voiceId);
                        setShowVoicePicker(false);
                      }}
                      className={`w-full text-left p-2 rounded-xl text-[10px] font-bold uppercase transition-all ${
                        selectedVoiceId === v.voiceId ? 'bg-celestial-saturn text-black' : 'text-white/60 hover:bg-white/5 hover:text-white'
                      }`}
                    >
                      {v.name}
                    </button>
                  ))}
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <VoiceCallButton 
            callState={callState}
            audioLevel={audioLevel}
            onStart={() => startCall(selectedVoiceId, 'lumi', agentId)}
            onEnd={endCall}
            hasVoice={voices.length > 0}
          />
          <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-celestial-saturn/20 flex items-center justify-center text-celestial-saturn border border-celestial-saturn/20">
            <Ghost className="w-4 h-4 md:w-5 md:h-5" />
          </div>
          <div className="text-right sm:text-left">
            <h2 className="text-base md:text-xl font-bold tracking-tight truncate max-w-[120px] sm:max-w-none flex items-center gap-2">
              {agentName}
              {workDomain === 'work' && orgConnection?.connected && (
                <span className="text-[8px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium uppercase tracking-wider">
                  {t.orgWorkDomain || 'Work'}
                </span>
              )}
            </h2>
            <p className="text-[8px] md:text-[10px] uppercase tracking-widest text-white/40 font-bold">{agentCategory}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3 flex-1 min-h-0">
        {/* ── Conversation Sidebar ── */}
        <div className="w-56 flex-shrink-0 flex flex-col glass rounded-[2.5rem] border-white/10 overflow-hidden">
          <div className="p-4 border-b border-white/5">
            <h3 className="text-xs font-bold uppercase tracking-widest text-white/40 mb-3">
              {t.conversations || 'Conversations'}
            </h3>
            <Button
              onClick={handleNewConversation}
              className="w-full justify-start gap-2 bg-white/5 border border-white/10 hover:bg-white/10 rounded-xl py-2 text-xs font-bold text-white/70"
            >
              <Plus size={14} />
              {t.newConversation || 'New Conversation'}
            </Button>
          </div>
          <div className="flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar">
            {isLoadingConversations ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={20} className="animate-spin text-white/20" />
              </div>
            ) : conversations.length === 0 ? (
              <div className="text-center py-8 text-[10px] text-white/20 font-bold uppercase tracking-widest">
                {t.noConversations || 'No conversations yet'}
              </div>
            ) : (
              conversations.map(conv => (
                <div key={conv.id} className="group relative">
                  <button
                    onClick={() => handleSelectConversation(conv.id)}
                    className={`w-full text-left p-3 rounded-xl transition-all ${
                      activeConversationId === conv.id
                        ? 'bg-white/10'
                        : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="text-xs font-bold text-white/70 truncate pr-6">
                      {conv.title || t.untitled || 'Untitled'}
                    </div>
                    <div className="text-[10px] text-white/30 mt-0.5 truncate">
                      {conv.summary || ''}
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-white/20">
                        {(() => {
                          if (!conv.lastActiveAt) return '';
                          const d = new Date(conv.lastActiveAt);
                          const now = new Date();
                          const diffDays = Math.floor((now.getTime() - d.getTime()) / 86400000);
                          if (diffDays === 0) return t.today || 'Today';
                          if (diffDays === 1) return t.yesterday || 'Yesterday';
                          return d.toLocaleDateString();
                        })()}
                      </span>
                      {conv.messageCount > 0 && (
                        <span className="text-[9px] text-white/20">{conv.messageCount} {t.chatMsgs || 'msgs'}</span>
                      )}
                    </div>
                  </button>
                  <button
                    onClick={async (e) => {
                      e.stopPropagation();
                      try {
                        await fetch(`/api/conversations/${conv.id}/close`, { method: 'POST' });
                        if (activeConversationId === conv.id) {
                          setActiveConversationId(null);
                          setMessages([]);
                          setActiveConversation(null);
                        }
                        fetchConversations();
                      } catch {}
                    }}
                    className="absolute top-2 right-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md hover:bg-red-500/20 text-white/20 hover:text-red-400"
                    title={t.chatCloseConv || 'Close conversation'}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))
            )}
          </div>
        </div>

        {/* ── Chat Panel ── */}
        <div className="flex-1 flex flex-col glass rounded-[2.5rem] md:rounded-[3rem] border-white/10 overflow-hidden shadow-2xl min-w-0">
          <div className="p-4 md:p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-celestial-nebula animate-ping' : 'bg-celestial-saturn animate-pulse'}`} />
              <span className="text-[10px] md:text-xs font-bold uppercase tracking-widest text-white/60">
                {activeConversation?.title || activeConversation?.summary?.slice(0, 30) || t.neuralLink || 'Neural Link'}
              </span>
              {isSpeaking && (
                <div className="flex items-center gap-3 ml-2 md:ml-4 scale-75 md:scale-100 origin-left">
                  <div className="flex items-end gap-1 h-4">
                    {[...Array(5)].map((_, i) => (
                      <motion.div
                        key={i}
                        animate={{ height: [4, 16, 4] }}
                        transition={{ 
                          duration: 0.5 + Math.random() * 0.5, 
                          repeat: Infinity,
                          ease: "easeInOut"
                        }}
                        className="w-1 bg-celestial-nebula rounded-full"
                      />
                    ))}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button 
                      onClick={isPaused ? resume : pause}
                      className="h-6 px-2 text-[8px] bg-white/10 text-white hover:bg-white/20 rounded-full border border-white/10 flex items-center gap-1"
                    >
                      {isPaused ? <Play size={10} /> : <Pause size={10} />}
                    </Button>
                    <Button 
                      onClick={stop}
                      className="h-6 px-2 text-[8px] bg-red-500/20 text-red-500 hover:bg-red-500/40 rounded-full border border-red-500/20 flex items-center gap-1"
                    >
                      <Square size={10} />
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <Button
              onClick={() => setShowInfoPanel(!showInfoPanel)}
              variant="ghost"
              className={`h-7 px-2 text-[10px] font-bold uppercase tracking-widest flex items-center gap-1 rounded-full border transition-colors ${
                showInfoPanel
                  ? 'bg-white/10 text-white border-white/20'
                  : 'text-white/20 hover:text-white/60 border-transparent hover:bg-white/5'
              }`}
            >
              <Info size={12} />
              {showInfoPanel ? (t.chatHide || 'Hide') : (t.chatInfo || 'Info')}
            </Button>
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 md:space-y-6 custom-scrollbar"
          >
            {/* Resume conversation prompt */}
            {showResumePrompt && activeConversation && (
              <motion.div
                initial={{ opacity: 0, y: -10 }}
                animate={{ opacity: 1, y: 0 }}
                className="p-4 bg-amber-500/10 border border-amber-500/20 rounded-2xl flex items-center justify-between gap-4"
              >
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 flex items-center justify-center">
                    <History size={16} className="text-amber-400" />
                  </div>
                  <div>
                    <p className="text-xs font-bold text-amber-300 uppercase tracking-tight">{t.unfinishedConversation || 'Unfinished conversation'}</p>
                    <p className="text-[10px] text-white/40 flex items-center gap-1">
                      <Clock size={10} />
                      {new Date(activeConversation.lastActiveAt).toLocaleString()}
                      {activeConversation.messageCount > 0 && (
                        <span> &middot; {activeConversation.messageCount} {t.messagesCount || 'messages'}</span>
                      )}
                    </p>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    onClick={() => handleResumeConversation(activeConversation.id)}
                    className="bg-amber-500 text-black font-bold text-[10px] px-3 py-1.5 rounded-xl hover:scale-105 transition-transform"
                  >
                    {t.continueBtn || 'Continue'}
                  </Button>
                  <Button
                    onClick={handleNewConversation}
                    variant="ghost"
                    className="text-white/20 hover:text-white/60 text-[10px] px-2"
                  >
                    {t.newBtn || 'New'}
                  </Button>
                </div>
              </motion.div>
            )}

            {/* Active conversation indicator */}
            {activeConversation && !showResumePrompt && activeConversation.agentId === agentId && activeConversation.messageCount > 0 && (
              <div className="flex items-center gap-2 text-[9px] text-white/20 font-bold uppercase tracking-widest">
                <History size={10} />
                <span>{activeConversation.messageCount} {t.messagesCount || 'messages'}</span>
                <span>&middot;</span>
                <span>{t.lastActive || 'Last active'} {new Date(activeConversation.lastActiveAt).toLocaleString()}</span>
              </div>
            )}
            {isLoadingMessages ? (
              <div className="h-full flex flex-col items-center justify-center gap-3">
                <Loader2 size={28} className="animate-spin text-white/20" />
                <span className="text-[10px] text-white/20 font-bold uppercase tracking-widest">{t.loading || 'Loading...'}</span>
              </div>
            ) : messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-8 px-4">
                <div className="space-y-3 opacity-20">
                  <Sparkles size={64} className="text-celestial-saturn mx-auto" />
                  <p className="text-lg font-medium">{t.awakePrompt || 'Your agent has awakened.'}<br/>{t.awakePromptSub || 'Begin the first conversation.'}</p>
                </div>
                {visibleSuggestions.length > 0 && (
                  <div className="space-y-3 max-w-md w-full">
                    <div className="flex items-center gap-2 text-[10px] uppercase tracking-widest text-white/20 font-bold">
                      <Sparkles size={12} />
                      {t.tryThese || 'Try these'}
                    </div>
                    <div className="grid gap-2">
                      {visibleSuggestions.map(s => (
                        <button
                          key={s.id}
                          onClick={() => sendText(s.prompt)}
                          className="flex items-center justify-between p-4 rounded-2xl bg-white/5 border border-white/10 text-sm text-white/60 hover:text-celestial-saturn hover:border-celestial-saturn/30 hover:bg-celestial-saturn/5 transition-all text-left group"
                        >
                          <span>{s.label}</span>
                          <ChevronRight size={14} className="opacity-0 group-hover:opacity-100 transition-opacity text-celestial-saturn" />
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
            <AnimatePresence initial={false}>
              {messages.map((msg) => (
                msg.type === 'tool' ? (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-start"
                  >
                    <div className={`relative max-w-[85%] p-4 rounded-2xl text-xs ${
                      msg.toolStatus === 'error'
                        ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                        : 'bg-amber-500/5 border border-amber-500/20 text-amber-400'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        {msg.toolStatus === 'error' ? (
                          <XCircle size={14} />
                        ) : (
                          <Loader2 size={14} className="animate-spin" />
                        )}
                        <span className="font-bold uppercase tracking-widest text-[10px]">{msg.toolName}</span>
                      </div>
                      {msg.toolArgs && (
                        <div className="text-[10px] opacity-50 truncate max-w-[200px]">
                          {JSON.stringify(msg.toolArgs).slice(0, 80)}
                        </div>
                      )}
                      {msg.toolResult && (
                        <div className="text-[10px] text-green-400/70 mt-1 truncate max-w-[250px]">{msg.toolResult.slice(0, 150)}</div>
                      )}
                      {msg.toolError && (
                        <div className="text-[10px] text-red-400/70 mt-1">{msg.toolError}</div>
                      )}
                    </div>
                  </motion.div>
                ) : (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`flex flex-col ${msg.type === 'agent' ? 'items-start' : 'items-end'}`}
                >
                  <div className={`relative group max-w-[85%] p-5 rounded-3xl text-sm leading-relaxed ${
                    msg.type === 'agent'
                      ? 'bg-celestial-saturn/10 text-celestial-saturn border border-celestial-saturn/20 rounded-tl-none'
                      : 'bg-white/5 text-white/80 border border-white/10 rounded-tr-none'
                  }`}>
                    <span className="whitespace-pre-wrap">{msg.text}</span>
                    {msg.text && (
                      <button
                        onClick={() => handleCopyMessage(msg.text, msg.id)}
                        className={`absolute top-2 opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-lg hover:bg-white/10 ${
                          msg.type === 'agent' ? 'right-2' : 'left-2'
                        }`}
                      >
                        {copiedId === msg.id ? (
                          <Check size={12} className="text-green-400" />
                        ) : (
                          <Copy size={12} className="text-white/30 hover:text-white/70" />
                        )}
                      </button>
                    )}
                  </div>
                  <span className="text-[9px] uppercase tracking-widest opacity-30 mt-2 px-3">
                    {msg.userName} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </motion.div>
              )))}
            </AnimatePresence>
            {isTyping && (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2 items-center text-celestial-saturn/40 text-[10px] font-bold uppercase tracking-widest">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: "linear" }}
                  >
                    <Loader2 size={14} />
                  </motion.div>
                  {t.neuralProcessing || 'Neural Processing...'}
                </div>
                <div className="flex gap-1">
                  {[...Array(3)].map((_, i) => (
                    <motion.div
                      key={i}
                      animate={{ 
                        scale: [1, 1.5, 1],
                        opacity: [0.3, 1, 0.3]
                      }}
                      transition={{ 
                        duration: 1, 
                        repeat: Infinity, 
                        delay: i * 0.2 
                      }}
                      className="w-1.5 h-1.5 rounded-full bg-celestial-saturn"
                    />
                  ))}
                </div>
              </div>
            )}
          </div>

          <div className="p-6 bg-white/5 border-t border-white/5">
            <form onSubmit={handleSendMessage} className="relative flex gap-3">
              <div className="relative flex-1">
                <Input
                  value={newMessage}
                  onChange={(e) => setNewMessage(e.target.value)}
                  placeholder={t.communicatePlaceholder || "Communicate with your essence..."}
                  className="bg-black/40 border-white/10 rounded-2xl py-6 pr-12 focus-visible:ring-celestial-saturn/50"
                />
                <Button
                  type="button"
                  onClick={toggleListening}
                  variant="ghost"
                  className={`absolute right-2 top-1/2 -translate-y-1/2 h-8 w-8 p-0 rounded-full transition-colors ${
                    isListening ? 'text-celestial-mars bg-celestial-mars/20 animate-pulse' : 'text-white/40 hover:text-white'
                  }`}
                >
                  <Mic size={18} />
                </Button>
              </div>
              {isTyping ? (
                <Button
                  type="button"
                  onClick={() => { socket?.emit('agent:abort_chat'); setIsTyping(false); }}
                  className="bg-red-500 text-white rounded-2xl px-6 hover:scale-105 transition-transform"
                >
                  <Square size={20} />
                </Button>
              ) : (
                <Button
                  type="submit"
                  disabled={!newMessage.trim()}
                  className="bg-celestial-saturn text-black rounded-2xl px-6 hover:scale-105 transition-transform disabled:opacity-50 disabled:hover:scale-100"
                >
                  <Send size={20} />
                </Button>
              )}
            </form>
          </div>
        </div>

        {/* ── Info Sidebar ── */}
        <AnimatePresence>
          {showInfoPanel && (
            <motion.div
              initial={{ width: 0, opacity: 0 }}
              animate={{ width: 'auto', opacity: 1 }}
              exit={{ width: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="w-72 flex-shrink-0 space-y-4 overflow-y-auto custom-scrollbar"
            >
          <GlassCard className="p-6 rounded-[2.5rem] space-y-4 border-celestial-saturn/20" hoverEffect={false}>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">{t.activeCapabilities || 'Active Capabilities'}</h4>
              {isElectron && (
                <div className="px-2 py-0.5 rounded-full bg-celestial-saturn/20 text-[8px] text-celestial-saturn font-black">NODE_NATIVE</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(agentMetadata.capabilities || [t.neuralCore || 'Neural Core', t.webMesh || 'Web Mesh']).map((cap, i) => (
                <div key={i} className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-[10px] text-white/60 font-bold flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-celestial-saturn" />
                  {cap}
                </div>
              ))}
            </div>
          </GlassCard>

          <GlassCard className="p-6 rounded-[2.5rem] space-y-4" hoverEffect={false}>
            <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">{t.optimizeKnowledge || 'Knowledge Optimization'}</h4>
            <div className="grid grid-cols-1 gap-3">
              <Button 
                onClick={() => handleImportData('text')}
                disabled={isOptimizing}
                variant="ghost" 
                className="w-full justify-start gap-3 bg-white/5 border border-white/5 hover:bg-white/10 rounded-2xl py-6"
              >
                <div className="w-8 h-8 rounded-lg bg-blue-500/20 flex items-center justify-center text-blue-400">
                  <FileText size={16} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold">{t.textData || 'Text'}</div>
                  <div className="text-[10px] opacity-40">PDF, TXT, DOCX</div>
                </div>
              </Button>

              <Button 
                onClick={() => handleImportData('voice')}
                disabled={isOptimizing}
                variant="ghost" 
                className="w-full justify-start gap-3 bg-white/5 border border-white/5 hover:bg-white/10 rounded-2xl py-6"
              >
                <div className="w-8 h-8 rounded-lg bg-purple-500/20 flex items-center justify-center text-purple-400">
                  <Mic size={16} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold">{t.voiceData || 'Voice'}</div>
                  <div className="text-[10px] opacity-40">MP3, WAV, M4A</div>
                </div>
              </Button>

              <Button 
                onClick={() => handleImportData('video')}
                disabled={isOptimizing}
                variant="ghost" 
                className="w-full justify-start gap-3 bg-white/5 border border-white/5 hover:bg-white/10 rounded-2xl py-6"
              >
                <div className="w-8 h-8 rounded-lg bg-red-500/20 flex items-center justify-center text-red-400">
                  <Video size={16} />
                </div>
                <div className="text-left">
                  <div className="text-sm font-bold">{t.videoData || 'Video'}</div>
                  <div className="text-[10px] opacity-40">MP4, MOV, AVI</div>
                </div>
              </Button>
            </div>

            {isOptimizing && (
              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-[10px] font-bold uppercase tracking-widest">
                  <span className="text-celestial-saturn animate-pulse">{t.optimizing || 'Optimizing...'}</span>
                  <span>{optimizationProgress}%</span>
                </div>
                <div className="h-1 w-full bg-white/5 rounded-full overflow-hidden">
                  <motion.div 
                    className="h-full bg-celestial-saturn"
                    initial={{ width: 0 }}
                    animate={{ width: `${optimizationProgress}%` }}
                  />
                </div>
              </div>
            )}
          </GlassCard>

          <GlassCard className="p-6 rounded-[2.5rem] space-y-4" hoverEffect={false}>
            <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">{t.agentStats || 'Agent Stats'}</h4>
            <div className="space-y-4">
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/60 flex items-center gap-2"><Cpu size={14}/> {t.logicEngine || 'Logic Engine'}</span>
                <span className="text-sm font-bold text-celestial-saturn">v1.0.2</span>
              </div>
              <div className="flex justify-between items-center">
                <span className="text-sm text-white/60 flex items-center gap-2"><Zap size={14}/> {t.syncSpeed || 'Sync Speed'}</span>
                <span className="text-sm font-bold text-celestial-mars">8.4ms</span>
              </div>
            </div>
          </GlassCard>

          <GlassCard className="p-6 rounded-[2.5rem] space-y-4" hoverEffect={false}>
            <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">{t.neuralMeshStatus || 'Neural Mesh Status'}</h4>
            <div className="flex items-center gap-3">
              <div className="w-3 h-3 rounded-full bg-green-500 animate-pulse" />
              <span className="text-sm font-bold">{t.encryptedLinkActive || 'Encrypted Link Active'}</span>
            </div>
            <p className="text-xs text-white/40 leading-relaxed">
              {t.agentSyncDesc || 'Your agent is currently synchronized with the local node. All interactions are stored in your private neural cloud.'}
            </p>
          </GlassCard>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>

          {/* Bottom hint */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <span className="text-[9px] font-bold text-white/15 uppercase tracking-[0.15em] bg-black/30 px-4 py-1.5 rounded-full border border-white/[0.04]">
              {t.chatEscClose || 'ESC to close'} · {agentName} · {agentCategory}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
