import React, { useState, useEffect, useRef, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Send, Loader2, ArrowLeft, Ghost, Zap, Cpu, Sparkles, Upload, FileText, Mic, Video, CheckCircle2, Pause, Play, Square, ChevronDown, ChevronRight, XCircle, Copy, Check, Layers } from 'lucide-react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { useTTS } from '@/hooks/useTTS';
import { GlassCard, PulseCounter } from './SharedUI';
import { toast } from 'sonner';
import { FoundersSanctuary } from './FoundersSanctuary';
import * as conversationService from '@/services/conversationService';
import * as agentService from '@/services/agentService';
import { usePlatform } from '@/hooks/usePlatform';
import { runAgentLogic, AgentResponse } from '@/services/agentService';
import { useApp } from '@/contexts/AppContext';
import { VoiceCallButton } from './VoiceCallButton';
import { socketService } from '@/services/socketService';
import { useVoiceCall } from '@/hooks/useVoiceCall';
import { useVoiceCloning } from '@/hooks/useVoiceCloning';
import { listVoices } from '@/services/voiceService';

export function AgentChatPage({ t, user, agent, isOpen, onClose, prefillMessage, onPrefillConsumed, onOpenCanvas }: { t: any; user: any; agent?: any; isOpen: boolean; onClose: () => void; prefillMessage?: string; onPrefillConsumed?: () => void; onOpenCanvas?: () => void }) {
  const [messages, setMessages] = useState<any[]>([]);
  const [agentMetadata, setAgentMetadata] = useState<Partial<AgentResponse>>({});
  const { platform, isElectron } = usePlatform();
  const { aiConfig, orgConnection, workDomain } = useApp();
  const socket = socketService.connect();
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
  const [uploadResults, setUploadResults] = useState<any[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const { speak, stop, pause, resume, isSpeaking, isPaused } = useTTS();
  const recognition = useRef<any>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const agentNameRef = useRef<string>('Lumi');
  const seenToolEventIds = useRef<Set<string>>(new Set());

  // Escape to close panels
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showVoicePicker) setShowVoicePicker(false);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showVoicePicker]);

  const agentName = agent?.name || (t.lumiEssence || 'Lumi Essence');
  const agentCategory = agent?.category || (t.friend || 'friend');
  const agentId = agent?.id || 'lumi';
  const toolFailureHint = t.toolFailureHint || 'Check permission, adjust the request, or ask Lumi to retry.';
  const scopedConversationUrl = useCallback((path: string) => {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}domain=${encodeURIComponent(workDomain)}&agentId=${encodeURIComponent(agentId)}`;
  }, [workDomain, agentId]);

  const isFounder = agentId === 'founder' || agentCategory === 'founder' || agentName.includes('Founder') || agentName.includes('创始人');

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

  const handleCopyMessage = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 1500);
    } catch {}
  }, []);

  const normalizePersistedMessages = useCallback((rawMessages: any[]) => {
    const normalized: any[] = [];
    const userName = user?.displayName || user?.username || (t.chatUserFallback || 'User');
    const agentDisplayName = agentNameRef.current || 'Lumi';

    const pushMessage = (message: any) => {
      if (!message.text || !String(message.text).trim()) return;
      normalized.push(message);
    };

    rawMessages.forEach((m: any, index: number) => {
      const baseId = m.id || `persisted-${index}`;
      const timestamp = m.timestamp || m.createdAt || new Date().toISOString();
      const role = m.role || '';
      const userText = role === 'assistant' ? '' : (m.content || m.message || '');
      const assistantText = role === 'assistant'
        ? (m.content || m.message || m.response || '')
        : (m.response || '');

      if (role !== 'tool' && userText) {
        pushMessage({
          id: `${baseId}-user`,
          text: userText,
          userName,
          timestamp,
          type: 'user',
          mode: m.mode,
        });
      }

      if (assistantText) {
        pushMessage({
          id: `${baseId}-assistant`,
          text: assistantText,
          userName: agentDisplayName,
          timestamp,
          type: 'agent',
          mode: m.mode,
        });
      }
    });

    const seen = new Set<string>();
    return normalized.filter((m) => {
      if (seen.has(m.id)) return false;
      seen.add(m.id);
      return true;
    });
  }, [user?.displayName, user?.username, t.chatUserFallback]);

  useEffect(() => {
    if (!agentId || isFounder) return;

    // On agent switch, reset and reload
    if (agentId !== lastAgentIdRef.current) {
      lastAgentIdRef.current = agentId;
      initialLoadDoneRef.current = false;
      setMessages([]);
    }

    // Only load once — don't overwrite live conversation
    if (initialLoadDoneRef.current) return;
    initialLoadDoneRef.current = true;

    // Load the single active conversation messages
    fetch(scopedConversationUrl('/api/conversations/active'))
        .then(r => r.json())
        .then(async (data) => {
          const conv = data.activeConversation;
          if (conv) {
            const msgRes = await fetch(scopedConversationUrl(`/api/conversations/${conv.id}/messages?limit=500`));
            const msgData = await msgRes.json();
            if (msgData.messages && Array.isArray(msgData.messages)) {
              setMessages(normalizePersistedMessages(msgData.messages));
            }
          }
        })
        .catch(() => {});
  }, [agentId, isFounder, normalizePersistedMessages, scopedConversationUrl]);

  const streamingMsgId = useRef<string | null>(null);
  const textChatActiveRef = useRef(false);
  const initialLoadDoneRef = useRef(false);
  const lastAgentIdRef = useRef<string>('');

  useEffect(() => {
    if (isFounder || !socket) return;

    const onProactive = (data: { message: string; timestamp: string }) => {
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
    };

    const onChunk = (data: { text: string; agentName: string }) => {
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
    };

    const onTool = (data: { correlationId?: string; name: string; args?: any; arguments?: any; result?: string; error?: string }) => {
      const eventId = data.correlationId || `tool-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const args = data.arguments ?? data.args;
      const status = data.error ? 'error' : (data.result !== undefined ? 'done' : 'running');
      const nextMessage = {
        id: eventId,
        userName: data.name,
        text: data.error || data.result || '',
        timestamp: new Date().toISOString(),
        type: 'tool',
        toolName: data.name,
        toolArgs: args,
        toolResult: data.result,
        toolError: data.error,
        toolStatus: status,
      };

      setMessages(prev => {
        const existingIndex = prev.findIndex(m => m.id === eventId);
        if (existingIndex !== -1) {
          const updated = [...prev];
          updated[existingIndex] = { ...updated[existingIndex], ...nextMessage };
          return updated;
        }
        if (seenToolEventIds.current.has(eventId)) return prev;
        seenToolEventIds.current.add(eventId);
        return [...prev, nextMessage];
      });
    };

    const onResponse = (data: { text: string; agentName: string; source?: string }) => {
      setIsTyping(false);
      if (streamingMsgId.current) {
        // Finalize streamed message — keep chunked text if response text is empty
        const finalText = (data.text && data.text.trim()) ? data.text : null;
        setMessages(prev => prev.map(m =>
          m.id === streamingMsgId.current
            ? { ...m, text: finalText || m.text }
            : m
        ));
        streamingMsgId.current = null;
      } else if (data.text && data.text.trim()) {
        // No streaming — add as new message (only if non-empty)
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: data.text,
          userName: data.agentName,
          timestamp: new Date().toISOString(),
          type: 'agent'
        }]);
      }
      // Auto-speak disabled
    };

    const onStatus = (data: { status: string }) => {
      setIsTyping(data.status === "thinking");
      if (data.status === "idle" || data.status === "error") {
        // Drop partial streaming chunks that were never finalized
        if (streamingMsgId.current) {
          const sid = streamingMsgId.current;
          setMessages(prev => prev.filter(m => m.id !== sid));
          streamingMsgId.current = null;
        }
      }
    };

    const onError = (data: { message: string; code?: string }) => {
      setIsTyping(false);
      if (streamingMsgId.current) {
        const sid = streamingMsgId.current;
        setMessages(prev => prev.filter(m => m.id !== sid));
        streamingMsgId.current = null;
      }
      const message = data.message || (t.failedToRouteNeuralMesh || 'Failed to route through Neural Mesh.');
      setMessages(prev => {
        const text = `${t.requestFailed || 'Request failed'}\n\n${message}`;
        if (prev.some(m => m.type === 'agent' && m.text === text)) return prev;
        return [...prev, {
          id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text,
          userName: agentNameRef.current || 'Lumi',
          timestamp: new Date().toISOString(),
          type: 'agent',
          source: 'error',
        }];
      });
      toast.error(message);
    };

    // conversation_updated: only reload for non-text-chat channels (voice, etc.)
    // Text chat state is managed live via agent:chunk/agent:response — API reload here
    // would replace messages with different ids, causing React to remount & re-animate them.
    const onConversationUpdated = (data: { conversationId: string; agentId: string }) => {
      if (data.agentId !== agentId) return;
      if (textChatActiveRef.current) return;
      if (!streamingMsgId.current) return;
      streamingMsgId.current = null;
      fetch(scopedConversationUrl(`/api/conversations/${data.conversationId}/messages?limit=100`))
        .then(r => r.json())
        .then(result => {
          if (result.messages && Array.isArray(result.messages)) {
            setMessages(normalizePersistedMessages(result.messages));
          }
        })
        .catch(() => {});
    };

    socket.on("agent:proactive", onProactive);
    socket.on("agent:chunk", onChunk);
    socket.on("agent:tool", onTool);
    socket.on("agent:tool_call", onTool);
    socket.on("agent:response", onResponse);
    socket.on("agent:status", onStatus);
    socket.on("agent:error", onError);
    socket.on("chat:conversation_updated", onConversationUpdated);

    return () => {
      socket.off("agent:proactive", onProactive);
      socket.off("agent:chunk", onChunk);
      socket.off("agent:tool", onTool);
      socket.off("agent:tool_call", onTool);
      socket.off("agent:response", onResponse);
      socket.off("agent:status", onStatus);
      socket.off("agent:error", onError);
      socket.off("chat:conversation_updated", onConversationUpdated);
      stop();
    };
  }, [speak, stop, isFounder, socket, normalizePersistedMessages, scopedConversationUrl]);

  useEffect(() => {
    // Scroll to bottom when messages change (new messages, initial load)
    if (scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [messages]);

  // Scroll to bottom on mount when messages first load
  useEffect(() => {
    if (messages.length > 0 && scrollRef.current) {
      requestAnimationFrame(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      });
    }
  }, [isOpen]);

  const sendText = async (text: string) => {
    if (!text || !user) return;

    textChatActiveRef.current = true;

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

    let resolved = false;
    const safetyTimer = setTimeout(() => {
      if (!resolved) { setIsTyping(false); streamingMsgId.current = null; textChatActiveRef.current = false; }
    }, 30000);

    // Always try socket first
    socket.emit("agent:chat", {
      text,
      history: messages.map(m => ({ role: m.type === 'agent' ? 'assistant' : 'user', content: m.text })),
      personalityId: 'lumi',
      category: agentCategory,
      agentId,
      domain: workDomain,
      orgId: orgConnection?.orgId || null,
    });

    const resolve = () => { resolved = true; clearTimeout(safetyTimer); setIsTyping(false); textChatActiveRef.current = false; };
    const onResponse = () => resolve();
    const onError = () => resolve();
    const onStatus = (data: { status: string }) => {
      if (data.status === 'idle' || data.status === 'error') resolve();
    };
    socket.once('agent:response', onResponse);
    socket.once('agent:error', onError);
    socket.once('agent:status', onStatus);

    // Parallel REST fallback after 5s if socket hasn't responded
    const restFallbackTimer = setTimeout(async () => {
      if (resolved) return;
      try {
        const response = await runAgentLogic(text, { platform, aiConfig });
        if (resolved) return;
        resolve();
        setAgentMetadata(response);
        setMessages(prev => [...prev, {
          id: Date.now().toString(),
          text: response.text,
          userName: agentName,
          timestamp: new Date().toISOString(),
          type: 'agent'
        }]);
      } catch (err) {
        resolve();
        const message = t.failedToRouteNeuralMesh || "Failed to route through Neural Mesh.";
        setMessages(prev => [...prev, {
          id: `err-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          text: `${t.requestFailed || 'Request failed'}\n\n${message}`,
          userName: agentName,
          timestamp: new Date().toISOString(),
          type: 'agent',
          source: 'error',
        }]);
        toast.error(message);
      }
    }, 5000);
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

  const doUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setIsOptimizing(true);
    setOptimizationProgress(30);

    const fileList = Array.from(files);
    const formData = new FormData();
    fileList.forEach(f => formData.append('files', f));

    try {
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData, credentials: 'include' });
      if (res.ok) {
        const d = await res.json();
        setOptimizationProgress(100);
        setTimeout(() => { setIsOptimizing(false); setOptimizationProgress(0); }, 500);

        for (const f of d.files || []) {
          const result: any = {
            id: `upres-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            fileName: f.name,
            timestamp: new Date().toISOString(),
            content: f.content || null,
            preview: f.preview || null,
            ingested: f.ingested || false,
          };
          setUploadResults(prev => [result, ...prev]);

          // Inject file content into chat so Lumi sees it in current conversation
          if (f.content) {
            setMessages(prev => [...prev, {
              id: `filectx-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              text: `[Uploaded: ${f.name}]\n\n${f.content}`,
              userName: user?.displayName || user?.username || 'You',
              timestamp: new Date().toISOString(),
              type: 'file_context',
            }]);
          }
        }
      } else {
        setIsOptimizing(false);
        setOptimizationProgress(0);
        try {
          const err = await res.json();
          toast.error(err.error || (t.uploadFailed || 'Upload failed'));
        } catch {
          toast.error(t.uploadFailed || 'Upload failed');
        }
      }
    } catch {
      setIsOptimizing(false);
      setOptimizationProgress(0);
      toast.error(t.chatConnError || 'Connection error during upload');
    }
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
              className="text-xs font-black uppercase tracking-widest text-white/40 flex items-center gap-2 hover:text-celestial-saturn transition-colors"
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
                      className={`w-full text-left p-2 rounded-xl text-xs font-bold uppercase transition-all ${
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
          {onOpenCanvas && (
            <button
              onClick={() => onOpenCanvas()}
              className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-teal-500/10 flex items-center justify-center text-teal-400 hover:bg-teal-500/20 border border-teal-400/20 hover:border-teal-400/40 transition-all"
              title={t.canvasWorkbench || 'Canvas Workbench'}
            >
              <Layers className="w-4 h-4 md:w-5 md:h-5" />
            </button>
          )}
          <div className="w-8 h-8 md:w-10 md:h-10 rounded-xl bg-celestial-saturn/20 flex items-center justify-center text-celestial-saturn border border-celestial-saturn/20">
            <Ghost className="w-4 h-4 md:w-5 md:h-5" />
          </div>
          <div className="text-right sm:text-left">
            <h2 className="text-base md:text-xl font-bold tracking-tight truncate max-w-[120px] sm:max-w-none flex items-center gap-2">
              {agentName}
              {workDomain === 'work' && orgConnection?.connected && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 font-medium uppercase tracking-wider">
                  {t.orgWorkDomain || 'Work'}
                </span>
              )}
            </h2>
            <p className="text-xs md:text-xs uppercase tracking-widest text-white/40 font-bold">{agentCategory}</p>
          </div>
        </div>
      </div>

      <div className="flex gap-3 flex-1 min-h-0">

        {/* ── Chat Panel ── */}
        <div className="flex-1 flex flex-col glass rounded-[2.5rem] md:rounded-[3rem] border-white/10 overflow-hidden shadow-2xl min-w-0">
          <div className="p-4 md:p-6 border-b border-white/5 flex items-center justify-between bg-white/5">
            <div className="flex items-center gap-3">
              <div className={`w-2 h-2 rounded-full ${isSpeaking ? 'bg-celestial-nebula animate-ping' : 'bg-celestial-saturn animate-pulse'}`} />
              <span className="text-xs md:text-xs font-bold uppercase tracking-widest text-white/60">
                Neural Link
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
                      className="h-6 px-2 text-xs bg-white/10 text-white hover:bg-white/20 rounded-full border border-white/10 flex items-center gap-1"
                    >
                      {isPaused ? <Play size={10} /> : <Pause size={10} />}
                    </Button>
                    <Button 
                      onClick={stop}
                      className="h-6 px-2 text-xs bg-red-500/20 text-red-500 hover:bg-red-500/40 rounded-full border border-red-500/20 flex items-center gap-1"
                    >
                      <Square size={10} />
                    </Button>
                  </div>
                </div>
              )}
            </div>
            <div className="flex items-center gap-2">
              <div className="relative">
                <input
                  type="text"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  placeholder="Search..."
                  className="h-7 w-40 px-3 py-0 text-xs bg-white/5 border border-white/10 rounded-full text-white/60 placeholder:text-white/20 outline-none focus:border-white/20 focus:bg-white/[0.07] transition-colors"
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-white/30 hover:text-white/60"
                  >
                    <XCircle size={12} />
                  </button>
                )}
              </div>
            </div>
            {messages.length > 0 && (
              <button
                onClick={async () => {
                  setMessages([]);
                  try {
                    const r = await fetch(scopedConversationUrl('/api/conversations/active'));
                    const d = await r.json();
                    if (d.activeConversation) {
                      await fetch(scopedConversationUrl(`/api/conversations/${d.activeConversation.id}/close`), {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ summary: '', domain: workDomain }),
                      });
                    }
                  } catch {}
                }}
                className="h-7 px-2 text-[10px] font-bold uppercase tracking-widest text-white/20 hover:text-red-400 hover:bg-red-500/10 rounded-full border border-transparent hover:border-red-500/20 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          <div
            ref={scrollRef}
            className="flex-1 overflow-y-auto p-4 md:p-8 space-y-4 md:space-y-6 custom-scrollbar"
          >
            {messages.length === 0 && (
              <div className="h-full flex flex-col items-center justify-center text-center space-y-8 px-4">
                <div className="space-y-3 opacity-20">
                  <Sparkles size={64} className="text-celestial-saturn mx-auto" />
                  <p className="text-lg font-medium">{t.awakePrompt || 'Your agent has awakened.'}<br/>{t.awakePromptSub || 'Begin the first conversation.'}</p>
                </div>
                {visibleSuggestions.length > 0 && (
                  <div className="space-y-3 max-w-md w-full">
                    <div className="flex items-center gap-2 text-xs uppercase tracking-widest text-white/45 font-bold">
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
            {searchQuery.trim() && messages.length > 0 && (
              <div className="text-[10px] text-white/30 font-mono uppercase tracking-wider text-center">
                {messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase())).length} / {messages.length} messages
              </div>
            )}
            <AnimatePresence initial={false}>
              {(() => {
                const displayMsgs = searchQuery.trim()
                  ? messages.filter(m => m.text?.toLowerCase().includes(searchQuery.toLowerCase()))
                  : messages;
                return displayMsgs.map((msg) => (
                msg.type === 'file_context' ? null /* invisible context */ : msg.type === 'tool' ? (
                  <motion.div
                    key={msg.id}
                    initial={{ opacity: 0, y: 10 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-col items-start"
                  >
                    <div className={`relative max-w-[85%] p-4 rounded-2xl text-xs ${
                      msg.toolStatus === 'error'
                        ? 'bg-red-500/10 border border-red-500/20 text-red-400'
                        : msg.toolStatus === 'done'
                          ? 'bg-emerald-500/10 border border-emerald-500/20 text-emerald-300'
                        : 'bg-amber-500/5 border border-amber-500/20 text-amber-400'
                    }`}>
                      <div className="flex items-center gap-2 mb-1">
                        {msg.toolStatus === 'error' ? (
                          <XCircle size={14} />
                        ) : msg.toolStatus === 'done' ? (
                          <CheckCircle2 size={14} />
                        ) : (
                          <Loader2 size={14} className="animate-spin" />
                        )}
                        <span className="font-bold uppercase tracking-widest text-xs">{msg.toolName}</span>
                      </div>
                      {msg.toolArgs && (
                        <div className="text-xs opacity-50 truncate max-w-[200px]">
                          {JSON.stringify(msg.toolArgs).slice(0, 80)}
                        </div>
                      )}
                      {msg.toolResult && (
                        <div className="text-xs text-green-400/70 mt-1 truncate max-w-[250px]">{msg.toolResult.slice(0, 150)}</div>
                      )}
                      {msg.toolError && (
                        <>
                          <div className="text-xs text-red-400/80 mt-1 break-words">{msg.toolError}</div>
                          <div className="text-xs text-red-300/50 mt-1">{toolFailureHint}</div>
                        </>
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
                  {/* Image / File previews — parse tool results and detect in mid-text agent replies */}
                  {(() => {
                    let imageUrls: string[] = [];
                    try {
                      const parsed = JSON.parse(msg.text || '');
                      if (parsed.images && Array.isArray(parsed.images)) imageUrls = parsed.images;
                      if (parsed.image_base64) imageUrls = [`data:image/png;base64,${parsed.image_base64}`];
                    } catch {}
                    const fileMatch = msg.text?.match(/(?:Saved|created|generated|written).*?:\s*(.+?\.(?:pdf|pptx|docx|xlsx|txt|ts|js|py|json|png|jpg|gif))(?:\s|$)/i);
                    const filePath = fileMatch?.[1];
                    if (imageUrls.length === 0 && !filePath) return null;
                    return (
                      <div className="max-w-[85%] mb-1 space-y-2">
                        {imageUrls.length > 0 && (
                          <div className="flex flex-wrap gap-2">
                            {imageUrls.map((url, i) => (
                              <a key={i} href={url} target="_blank" rel="noopener noreferrer"
                                className="block w-36 h-36 rounded-2xl overflow-hidden border-2 border-white/10 hover:border-celestial-saturn/60 transition-all shadow-lg">
                                <img src={url} alt={`Generated ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
                              </a>
                            ))}
                          </div>
                        )}
                        {filePath && (
                          <div className="flex items-center gap-3 px-3 py-2.5 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                            <FileText size={16} className="text-emerald-400" />
                            <div className="flex-1 min-w-0">
                              <span className="text-xs text-white/70 truncate block">{filePath.split(/[\\/]/).pop()}</span>
                              <span className="text-[12px] text-white/55">{t.fileReady || 'File ready — click to copy path'}</span>
                            </div>
                            <button onClick={() => handleCopyMessage(filePath, msg.id)}
                              className="p-1.5 hover:bg-white/10 rounded-lg transition-colors">
                              <Copy size={12} className="text-white/40" />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })()}

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
                          <Copy size={12} className="text-white/55 hover:text-white/70" />
                        )}
                      </button>
                    )}
                  </div>
                  <span className="text-[12px] uppercase tracking-widest opacity-30 mt-2 px-3">
                    {msg.userName} • {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </motion.div>
              )));
            })()}
            </AnimatePresence>
            {isTyping && (
              <div className="flex flex-col gap-3">
                <div className="flex gap-2 items-center text-celestial-saturn/40 text-xs font-bold uppercase tracking-widest">
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
            <motion.div
              initial={{ opacity: 0, x: 40 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ duration: 0.5, ease: [0.25, 0.1, 0.25, 1], delay: 0.15 }}
              className="w-96 flex-shrink-0 space-y-4 overflow-y-auto custom-scrollbar">
          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.2 }}>
          <GlassCard className="p-6 rounded-[2.5rem] space-y-4 border-celestial-saturn/20" hoverEffect={false}>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-bold uppercase tracking-widest text-white/40">{t.activeCapabilities || 'Active Capabilities'}</h4>
              {isElectron && (
                <div className="px-2 py-0.5 rounded-full bg-celestial-saturn/20 text-xs text-celestial-saturn font-black">NODE_NATIVE</div>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {(agentMetadata.capabilities || [t.neuralCore || 'Neural Core', t.webMesh || 'Web Mesh']).map((cap, i) => (
                <div key={i} className="px-3 py-1.5 rounded-xl bg-white/5 border border-white/5 text-xs text-white/60 font-bold flex items-center gap-2">
                  <div className="w-1 h-1 rounded-full bg-celestial-saturn" />
                  {cap}
                </div>
              ))}
            </div>
          </GlassCard>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.28 }}>
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
                  <div className="text-xs opacity-40">PDF, TXT, DOCX</div>
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
                  <div className="text-xs opacity-40">MP3, WAV, M4A</div>
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
                  <div className="text-xs opacity-40">MP4, MOV, AVI</div>
                </div>
              </Button>
            </div>

            {isOptimizing && (
              <div className="space-y-2 pt-2">
                <div className="flex justify-between text-xs font-bold uppercase tracking-widest">
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

            {uploadResults.length > 0 && (
              <div className="space-y-2 pt-2 border-t border-white/5">
                <h5 className="text-[11px] font-bold text-white/35 uppercase tracking-widest">Uploaded</h5>
                {uploadResults.map(r => (
                  <div key={r.id} className="bg-white/[0.03] border border-white/[0.06] rounded-xl overflow-hidden">
                    <div className="px-3 py-2 flex items-center gap-2">
                      <Upload size={11} className="text-green-400/60 shrink-0" />
                      <span className="text-[11px] text-white/60 truncate flex-1">{r.fileName}</span>
                      {r.content && (
                        <span className="text-[10px] text-white/25 shrink-0">{(r.content?.length || 0).toLocaleString()}c</span>
                      )}
                    </div>
                    {r.preview && (
                      <div className="px-3 py-1.5 bg-black/20 border-t border-white/[0.04] text-[10px] text-white/35 max-h-16 overflow-y-auto font-mono whitespace-pre-wrap">
                        {r.preview.slice(0, 300)}...
                      </div>
                    )}
                    {r.ingested ? (
                      <div className="px-3 py-1 bg-black/20 border-t border-white/[0.04] text-[10px] text-white/25 flex items-center gap-1">
                        <CheckCircle2 size={9} /> In Knowledge Base
                      </div>
                    ) : (
                      <div className="px-3 py-1.5 bg-black/20 border-t border-white/[0.04] flex items-center gap-2">
                        <span className="text-[10px] text-white/35">Add to KB?</span>
                        <button
                          onClick={async () => {
                            try {
                              await fetch('/api/files/ingest', {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify({ fileId: r.fileName, agentId: 'lumi' }),
                              });
                              setUploadResults(prev => prev.map(x => x.id === r.id ? { ...x, ingested: true } : x));
                              toast.success(`"${r.fileName}" added to Knowledge Base`);
                            } catch { toast.error('Failed'); }
                          }}
                          className="px-2 py-0.5 text-[10px] font-bold bg-amber-500/15 hover:bg-amber-500/30 border border-amber-500/20 rounded-md text-amber-400 transition-colors"
                        >
                          Yes
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </GlassCard>
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.36 }}>
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
          </motion.div>

          <motion.div initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease: [0.25, 0.1, 0.25, 1], delay: 0.44 }}>
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
            </motion.div>
      </div>
    </div>

          {/* Bottom hint */}
          <div className="absolute bottom-6 left-1/2 -translate-x-1/2 z-20 pointer-events-none">
            <span className="text-[12px] font-bold text-white/40 uppercase tracking-[0.15em] bg-black/30 px-4 py-1.5 rounded-full border border-white/[0.04]">
              {t.chatEscClose || 'ESC to close'} · {agentName} · {agentCategory}
            </span>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
