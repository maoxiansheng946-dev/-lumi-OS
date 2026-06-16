import { useCallback, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { CanvasCard, CanvasEdge } from './types';

interface UseCanvasSocketOptions {
  socket: Socket | null;
  cards?: CanvasCard[];
  edges?: CanvasEdge[];
  domain?: 'personal' | 'work';
  onCards: (cards: CanvasCard[]) => void;
  onEdges: (edges: CanvasEdge[]) => void;
  onStatusChange: (status: string) => void;
}

interface SubmitTaskOptions {
  parentCardId?: string;
  edgeLabel?: string;
}

export function useCanvasSocket({ socket, cards, edges, domain = 'personal', onCards, onEdges, onStatusChange }: UseCanvasSocketOptions) {
  const cardsRef = useRef<CanvasCard[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const groupIdRef = useRef<string>('');
  const pendingChunkRef = useRef<string>('');
  const chunkCardIdRef = useRef<string | null>(null);
  const lastCardIdRef = useRef<string | null>(null);
  const activeCanvasRequestIdRef = useRef<string | null>(null);
  const rafRef = useRef<number>(0);
  const pendingRef = useRef(false);

  useEffect(() => { if (cards) cardsRef.current = cards; }, [cards]);
  useEffect(() => { if (edges) edgesRef.current = edges; }, [edges]);

  const flush = useCallback(() => {
    if (!pendingRef.current) return;
    pendingRef.current = false;
    onCards([...cardsRef.current]);
    onEdges([...edgesRef.current]);
  }, [onCards, onEdges]);

  const scheduleFlush = useCallback(() => {
    pendingRef.current = true;
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      flush();
    });
  }, [flush]);

  const addEdge = useCallback((sourceId: string, targetId: string, opts?: { dashed?: boolean; color?: string; label?: string }) => {
    const existing = edgesRef.current.find(e => e.sourceId === sourceId && e.targetId === targetId);
    if (existing) return;
    edgesRef.current = [...edgesRef.current, {
      id: `edge_${sourceId}_${targetId}`,
      sourceId,
      targetId,
      label: opts?.label,
      dashed: opts?.dashed,
      color: opts?.color,
    }];
    scheduleFlush();
  }, [scheduleFlush]);

  const addCard = useCallback((card: CanvasCard) => {
    cardsRef.current = [...cardsRef.current, card];
    // Draw edge from previous card in group
    if (lastCardIdRef.current) {
      addEdge(lastCardIdRef.current, card.id);
    }
    lastCardIdRef.current = card.id;
    scheduleFlush();
  }, [scheduleFlush, addEdge]);

  const updateCard = useCallback((cardId: string, updates: Partial<CanvasCard>) => {
    cardsRef.current = cardsRef.current.map(c =>
      c.id === cardId ? { ...c, ...updates } : c
    );
    scheduleFlush();
  }, [scheduleFlush]);

  const clearCards = useCallback(() => {
    cardsRef.current = [];
    edgesRef.current = [];
    chunkCardIdRef.current = null;
    pendingChunkRef.current = '';
    lastCardIdRef.current = null;
    onCards([]);
    onEdges([]);
  }, [onCards, onEdges]);

  const newGroupId = useCallback(() => {
    groupIdRef.current = `group_${Date.now()}`;
    lastCardIdRef.current = null;
    return groupIdRef.current;
  }, []);

  useEffect(() => {
    if (!socket) return;

    const isCanvasEvent = (data?: { requestId?: string; source?: string }) => {
      if (data?.requestId) return data.requestId === activeCanvasRequestIdRef.current;
      return data?.source === 'canvas';
    };

    const onStatus = (data: { status: string; agentName?: string; requestId?: string; source?: string }) => {
      if (!isCanvasEvent(data)) return;
      onStatusChange(data.status);

      if (data.status === 'thinking') {
        addCard({
          id: `stage_${Date.now()}`,
          type: 'stage_header',
          text: data.agentName ? `${data.agentName}` : 'Analyzing...',
          timestamp: Date.now(),
          groupId: groupIdRef.current,
          status: 'running',
        });
      }

      if (data.status === 'idle' || data.status === 'error') {
        if (chunkCardIdRef.current && pendingChunkRef.current) {
          updateCard(chunkCardIdRef.current, {
            text: pendingChunkRef.current,
            status: 'done',
          });
          chunkCardIdRef.current = null;
          pendingChunkRef.current = '';
        }
        cardsRef.current = cardsRef.current.map(c =>
          c.status === 'running' && c.type === 'stage_header'
            ? { ...c, status: data.status === 'error' ? 'error' as const : 'done' as const }
            : c
        );
        scheduleFlush();
        if (data.requestId && data.requestId === activeCanvasRequestIdRef.current) {
          activeCanvasRequestIdRef.current = null;
        }
      }
    };

    const onChunk = (data: { text: string; requestId?: string; source?: string }) => {
      if (!isCanvasEvent(data)) return;
      if (!data.text) return;
      pendingChunkRef.current += data.text;

      if (!chunkCardIdRef.current) {
        const id = `reasoning_${Date.now()}`;
        chunkCardIdRef.current = id;
        addCard({
          id,
          type: 'reasoning_text',
          text: pendingChunkRef.current,
          timestamp: Date.now(),
          groupId: groupIdRef.current,
          status: 'running',
        });
      } else {
        updateCard(chunkCardIdRef.current, { text: pendingChunkRef.current });
      }
    };

    const onTool = (data: { correlationId?: string; toolCallId?: string; name: string; args?: any; arguments?: any; result?: string; error?: string; requestId?: string; source?: string }) => {
      if (!isCanvasEvent(data)) return;
      const toolName = data.name || 'unknown_tool';
      const toolArgs = data.args ?? data.arguments;
      const argsStr = toolArgs ? JSON.stringify(toolArgs).slice(0, 200) : '';
      const stableKey = data.correlationId || data.toolCallId || `${toolName}:${argsStr}`;
      const id = `tool_${groupIdRef.current}_${stableKey}`.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 128);
      const status = data.error ? 'error' : (data.result !== undefined ? 'done' : 'running');
      const existing = cardsRef.current.find(c => c.id === id);
      const metadata = {
        ...(existing?.metadata || {}),
        toolName,
        args: toolArgs,
        result: data.result !== undefined ? data.result?.slice(0, 500) : existing?.metadata?.result,
        error: data.error !== undefined ? data.error : existing?.metadata?.error,
        correlationId: data.correlationId || existing?.metadata?.correlationId,
      };

      if (existing) {
        updateCard(id, {
          text: toolName,
          detail: argsStr || existing.detail,
          status,
          metadata,
        });
        return;
      }

      addCard({
        id,
        type: 'tool_call',
        text: toolName,
        detail: argsStr,
        timestamp: Date.now(),
        groupId: groupIdRef.current,
        status,
        metadata,
      });
    };

    const onToolCall = (data: { correlationId?: string; toolCallId?: string; name: string; arguments?: any; result?: string; error?: string; requestId?: string; source?: string }) => {
      onTool(data);
    };

    const onResponse = (data: { text: string; agentName?: string; requestId?: string; source?: string }) => {
      if (!isCanvasEvent(data)) return;
      if (!data.text) return;

      if (chunkCardIdRef.current) {
        updateCard(chunkCardIdRef.current, { status: 'done' });
        chunkCardIdRef.current = null;
        pendingChunkRef.current = '';
      }

      const existingOutput = cardsRef.current.find(
        c => c.groupId === groupIdRef.current && c.type === 'final_output'
      );
      if (existingOutput) {
        updateCard(existingOutput.id, {
          text: data.text,
          status: 'done',
          metadata: { ...existingOutput.metadata, agentName: data.agentName },
        });
        return;
      }

      addCard({
        id: `output_${Date.now()}`,
        type: 'final_output',
        text: data.text,
        timestamp: Date.now(),
        groupId: groupIdRef.current,
        status: 'done',
        metadata: { agentName: data.agentName },
      });
    };

    const onError = (data: { message: string; code?: string; requestId?: string; source?: string }) => {
      if (!isCanvasEvent(data)) return;
      addCard({
        id: `error_${Date.now()}`,
        type: 'error',
        text: data.message || 'Unknown error',
        detail: data.code,
        timestamp: Date.now(),
        groupId: groupIdRef.current,
        status: 'error',
      });
      if (data.requestId && data.requestId === activeCanvasRequestIdRef.current) {
        activeCanvasRequestIdRef.current = null;
      }
    };

    const onProactive = (data: { type?: string; message: string; requestId?: string; source?: string }) => {
      if (!isCanvasEvent(data)) return;
      if (data.type === 'distill_hint') {
        addCard({
          id: `proactive_${Date.now()}`,
          type: 'stage_header',
          text: data.message,
          timestamp: Date.now(),
          groupId: groupIdRef.current,
          metadata: { proactiveType: data.type },
        });
      }
    };

    socket.on('agent:status', onStatus);
    socket.on('agent:chunk', onChunk);
    socket.on('agent:tool', onTool);
    socket.on('agent:tool_call', onToolCall);
    socket.on('agent:response', onResponse);
    socket.on('agent:error', onError);
    socket.on('agent:proactive', onProactive);

    return () => {
      socket.off('agent:status', onStatus);
      socket.off('agent:chunk', onChunk);
      socket.off('agent:tool', onTool);
      socket.off('agent:tool_call', onToolCall);
      socket.off('agent:response', onResponse);
      socket.off('agent:error', onError);
      socket.off('agent:proactive', onProactive);
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = 0;
      }
    };
  }, [socket, addCard, updateCard, scheduleFlush, onStatusChange, addEdge]);

  const submitTask = useCallback((text: string, options: SubmitTaskOptions = {}) => {
    if (!text.trim()) return;

    // Start a new group WITHOUT clearing old cards — canvas accumulates
    const groupId = newGroupId();
    const requestId = `canvas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    activeCanvasRequestIdRef.current = requestId;

    const userCard: CanvasCard = {
      id: `user_${Date.now()}`,
      type: 'user_request',
      text: text.trim(),
      timestamp: Date.now(),
      groupId,
      status: 'done',
    };

    // Add the user card first so the visible route always starts from the task.
    addCard(userCard);
    if (options.parentCardId) {
      addEdge(options.parentCardId, userCard.id, {
        dashed: true,
        color: 'rgba(45,212,191,0.45)',
        label: options.edgeLabel,
      });
    }

    // REST fallback after 4s
    const fallbackTimer = setTimeout(async () => {
      try {
        const r = await fetch('/api/ai/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ provider: 'deepseek', model: 'deepseek-chat', prompt: text.trim() }),
        });
        if (r.ok) {
          const data = await r.json();
          addCard({
            id: `output_${Date.now()}`,
            type: 'final_output',
            text: data.text || data.error || 'No response',
            timestamp: Date.now(),
            groupId,
            status: data.error ? 'error' : 'done',
          });
        }
      } catch {}
    }, 4000);

    const cleanupSocketDone = () => {
      socket?.off('agent:response', onSocketDone);
      socket?.off('agent:error', onSocketDone);
    };
    const onSocketDone = (data?: { requestId?: string; source?: string }) => {
      const matches = data?.requestId ? data.requestId === requestId : data?.source === 'canvas';
      if (!matches) return;
      clearTimeout(fallbackTimer);
      cleanupSocketDone();
    };
    socket?.on('agent:response', onSocketDone);
    socket?.on('agent:error', onSocketDone);

    socket?.emit('agent:chat', {
      text: text.trim(),
      history: [],
      personalityId: 'lumi',
      category: undefined,
      agentId: undefined,
      domain,
      orgId: null,
      source: 'canvas',
      requestId,
    });
  }, [socket, newGroupId, addCard, addEdge, domain]);

  const retryFromCard = useCallback((cardId: string) => {
    // Find the card and its group, re-submit the user request for that group
    const card = cardsRef.current.find(c => c.id === cardId);
    if (!card) return;

    // Find the user_request card in the same group
    const userRequest = cardsRef.current.find(
      c => c.groupId === card.groupId && c.type === 'user_request'
    );
    if (userRequest) {
      // Mark all subsequent cards in the group as stale by fading their edges
      const groupCards = cardsRef.current
        .filter(c => c.groupId === card.groupId)
        .sort((a, b) => a.timestamp - b.timestamp);
      const cardIdx = groupCards.findIndex(c => c.id === cardId);
      const afterCards = groupCards.slice(cardIdx + 1);
      const afterCardIds = new Set(afterCards.map(c => c.id));

      // Remove cards after the retry point while preserving the selected node and its incoming route.
      cardsRef.current = cardsRef.current.filter(c => !afterCardIds.has(c.id));
      // Keep the card being retried, mark it as running
      updateCard(cardId, {
        status: 'running',
        text: card.text.includes('[Retrying...]') ? card.text : `${card.text}\n[Retrying...]`,
      });

      // Remove edges only for removed downstream cards.
      edgesRef.current = edgesRef.current.filter(
        e => !afterCardIds.has(e.sourceId) && !afterCardIds.has(e.targetId)
      );
      groupIdRef.current = card.groupId;
      lastCardIdRef.current = cardId;

      scheduleFlush();

      // Re-emit
      const requestId = `canvas_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      activeCanvasRequestIdRef.current = requestId;
      socket?.emit('agent:chat', {
        text: userRequest.text,
        history: [],
        personalityId: 'lumi',
        domain,
        source: 'canvas',
        requestId,
      });
    }
  }, [socket, updateCard, scheduleFlush, domain]);

  return { submitTask, clearCards, retryFromCard };
}
