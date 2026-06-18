import { useCallback, useEffect, useRef } from 'react';
import { Socket } from 'socket.io-client';
import { CanvasCard, CanvasEdge } from './types';

interface UseCanvasSocketOptions {
  socket: Socket | null;
  cards?: CanvasCard[];
  edges?: CanvasEdge[];
  domain?: 'personal' | 'work';
  orgId?: string | null;
  onCards: (cards: CanvasCard[]) => void;
  onEdges: (edges: CanvasEdge[]) => void;
  onStatusChange: (status: string) => void;
}

interface SubmitTaskOptions {
  parentCardId?: string;
  edgeLabel?: string;
}

function basename(value: string): string {
  return value.split(/[\\/]/).filter(Boolean).pop() || value;
}

function buildCanvasContext(cards: CanvasCard[]): string {
  const artifacts = cards
    .filter(card => card.type === 'artifact' && (card.metadata?.content || card.metadata?.preview || card.metadata?.filepath || card.detail))
    .slice(-6);
  if (artifacts.length === 0) return '';

  let budget = 7000;
  const sections: string[] = [];
  for (const card of artifacts) {
    if (budget <= 0) break;
    const title = String(card.metadata?.fileName || card.text || 'Canvas artifact');
    const path = String(card.metadata?.filepath || card.metadata?.path || '');
    const content = String(card.metadata?.content || card.metadata?.preview || card.detail || '').trim();
    const perArtifactLimit = Math.min(1200, budget);
    const body = content.length > perArtifactLimit
      ? `${content.slice(0, perArtifactLimit)}\n[Canvas artifact preview truncated: ${content.length} characters total. Use read_file/extract tools on the path for full content.]`
      : content;
    budget -= body.length;
    sections.push([
      `### ${title}`,
      path ? `Path: ${path}` : '',
      body ? `Content:\n${body}` : '',
    ].filter(Boolean).join('\n'));
  }
  return sections.join('\n\n');
}

function tryParseJson(value: string): any | null {
  try { return JSON.parse(value); } catch { return null; }
}

const ARTIFACT_EXTENSIONS = 'dxf|dwg|svg|pdf|pptx|docx|xlsx|xls|txt|md|json|csv|png|jpe?g|webp|html|ts|tsx|js|jsx|py';
const ARTIFACT_EXTENSION_RE = new RegExp(`\\.(?:${ARTIFACT_EXTENSIONS})$`, 'i');

function normalizeArtifactRef(candidate: string): string {
  return candidate
    .trim()
    .replace(/^[`"'“”‘’]+/, '')
    .replace(/[`"'“”‘’.,;，。；:：)）\]]+$/g, '')
    .trim();
}

function isAbsoluteArtifactRef(value: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(value) || /^https?:\/\//i.test(value) || /^\\\\/.test(value);
}

function collectArtifactPaths(value: string, parsed: any): string[] {
  const paths = new Set<string>();
  const add = (candidate: any) => {
    if (typeof candidate !== 'string') return;
    const clean = normalizeArtifactRef(candidate);
    if (ARTIFACT_EXTENSION_RE.test(clean)) {
      paths.add(clean);
    }
  };
  if (parsed && typeof parsed === 'object') {
    const walk = (node: any) => {
      if (!node) return;
      if (Array.isArray(node)) {
        node.forEach(walk);
        return;
      }
      if (typeof node === 'object') {
        ['path', 'filePath', 'filepath', 'outputPath', 'url', 'name', 'fileName', 'filename'].forEach(key => add(node[key]));
        Object.values(node).forEach(walk);
        return;
      }
      add(node);
    };
    walk(parsed);
  }
  const filePathRegex = new RegExp(`[A-Za-z]:\\\\[^\\n\\r"']+\\.(?:${ARTIFACT_EXTENSIONS})`, 'gi');
  for (const match of value.match(filePathRegex) || []) paths.add(match.trim());
  const quotedFileRegex = new RegExp("[`\"'“”‘’]([^`\"'“”‘’\\r\\n]{1,260}\\.(?:" + ARTIFACT_EXTENSIONS + "))[`\"'“”‘’]", 'gi');
  for (const match of value.matchAll(quotedFileRegex)) add(match[1]);
  const looseFileRegex = new RegExp("(^|[\\s:：，,。;；（(])([^`\"'“”‘’<>\\r\\n]{1,180}\\.(?:" + ARTIFACT_EXTENSIONS + "))(?=$|[\\s，,。;；）)\\]])", 'gi');
  for (const match of value.matchAll(looseFileRegex)) add(match[2]);
  return Array.from(paths).slice(0, 6);
}

function buildArtifactCard(path: string, source: string, detail: string, timestamp: number, extraMetadata: Record<string, any> = {}): CanvasCard {
  const absolute = isAbsoluteArtifactRef(path);
  return {
    id: `artifact_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    type: 'artifact',
    text: basename(path),
    detail: detail.slice(0, 6000),
    timestamp,
    groupId: '',
    status: 'done',
    metadata: {
      artifactKind: absolute ? 'file' : 'reported_file',
      ...(absolute ? { filepath: path } : { reportedName: path }),
      path,
      source,
      preview: detail.slice(0, 1200),
      ...extraMetadata,
    },
  };
}

function extractArtifactsFromTool(toolName: string, toolArgs: any, result?: string): CanvasCard[] {
  if (!result?.trim()) return [];
  const parsed = tryParseJson(result);
  const paths = collectArtifactPaths(result, parsed);
  const now = Date.now();
  const artifacts: CanvasCard[] = [];

  paths.forEach((path, index) => {
    const isCadPreview = toolName === 'cad_generate_dxf' && parsed?.previewPath && String(parsed.previewPath) === path;
    const isCadDxf = toolName === 'cad_generate_dxf' && parsed?.path && String(parsed.path) === path;
    artifacts.push(buildArtifactCard(path, 'tool_result', parsed?.note || parsed?.analysis || result.slice(0, 1200), now + index, {
      toolName,
      args: toolArgs,
      ...(isCadPreview ? { artifactKind: 'cad_preview', svgPreview: parsed?.previewSvg, companionDxfPath: parsed?.path } : {}),
      ...(isCadDxf ? { artifactKind: 'cad_dxf', companionPreviewPath: parsed?.previewPath, svgPreview: parsed?.previewSvg } : {}),
    }));
  });

  const content = parsed?.analysis || parsed?.content || parsed?.text || parsed?.summary || parsed?.output;
  const shouldShowContent = typeof content === 'string' && content.trim().length > 0;
  if (shouldShowContent && artifacts.length < 3) {
    artifacts.push({
      id: `artifact_${now}_content_${Math.random().toString(36).slice(2, 6)}`,
      type: 'artifact',
      text: parsed?.title || `${toolName} result`,
      detail: content.slice(0, 6000),
      timestamp: now + artifacts.length,
      groupId: '',
      status: 'done',
      metadata: {
        artifactKind: 'content',
        toolName,
        args: toolArgs,
        content: content.slice(0, 50000),
        preview: content.slice(0, 1000),
        filepath: parsed?.path || parsed?.filePath || parsed?.filepath,
      },
    });
  }

  if (artifacts.length === 0 && /^(ocr_image_file|extract_document_text|cad_generate_dxf|create_ppt|generate_image|write_file|desktop_path_info)$/i.test(toolName)) {
    artifacts.push({
      id: `artifact_${now}_result_${Math.random().toString(36).slice(2, 6)}`,
      type: 'artifact',
      text: `${toolName} result`,
      detail: result.slice(0, 6000),
      timestamp: now,
      groupId: '',
      status: 'done',
      metadata: {
        artifactKind: 'tool_result',
        toolName,
        args: toolArgs,
        content: result.slice(0, 50000),
        preview: result.slice(0, 1000),
      },
    });
  }

  return artifacts;
}

function extractArtifactsFromText(text: string, source: string): CanvasCard[] {
  if (!text?.trim()) return [];
  const parsed = tryParseJson(text);
  const refs = collectArtifactPaths(text, parsed);
  const now = Date.now();
  return refs.map((path, index) => buildArtifactCard(path, source, text, now + index));
}

export function useCanvasSocket({ socket, cards, edges, domain = 'personal', orgId = null, onCards, onEdges, onStatusChange }: UseCanvasSocketOptions) {
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
    if (existing) {
      edgesRef.current = edgesRef.current.map(e =>
        e.id === existing.id
          ? { ...e, dashed: opts?.dashed ?? e.dashed, color: opts?.color ?? e.color, label: opts?.label ?? e.label }
          : e
      );
      scheduleFlush();
      return;
    }
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

  const armRequestTimeout = useCallback((requestId: string, groupId: string) => {
    if (!socket) return () => {};

    const matches = (data?: { requestId?: string; source?: string }) =>
      data?.requestId ? data.requestId === requestId : data?.source === 'canvas';

    const cleanup = () => {
      clearTimeout(timeout);
      socket.off('agent:response', onDone);
      socket.off('agent:error', onDone);
      socket.off('agent:status', onStatusDone);
    };

    const onDone = (data?: { requestId?: string; source?: string }) => {
      if (!matches(data)) return;
      cleanup();
    };

    const onStatusDone = (data?: { status?: string; requestId?: string; source?: string }) => {
      if (!matches(data)) return;
      if (data?.status === 'idle' || data?.status === 'error') cleanup();
    };

    const timeout = setTimeout(() => {
      addCard({
        id: `error_${Date.now()}`,
        type: 'error',
        text: 'Canvas request timed out. Lumi may still be busy; try rerunning this step if no result appears.',
        timestamp: Date.now(),
        groupId,
        status: 'error',
      });
      if (activeCanvasRequestIdRef.current === requestId) {
        activeCanvasRequestIdRef.current = null;
      }
      cleanup();
    }, 180000);

    socket.on('agent:response', onDone);
    socket.on('agent:error', onDone);
    socket.on('agent:status', onStatusDone);
    return cleanup;
  }, [socket, addCard]);

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

    const addArtifactsForOutput = (outputId: string, text: string) => {
      const artifacts = extractArtifactsFromText(text, 'final_output')
        .map((card, index) => ({ ...card, groupId: groupIdRef.current, parentId: outputId, timestamp: Date.now() + index + 1 }));
      for (const artifact of artifacts) {
        if (cardsRef.current.some(c => c.parentId === outputId && c.type === 'artifact' && c.text === artifact.text)) continue;
        addCard(artifact);
        addEdge(outputId, artifact.id, { dashed: true, color: 'rgba(34,211,238,0.45)', label: 'result' });
      }
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
        if (status === 'done' && data.result !== undefined) {
          const artifacts = extractArtifactsFromTool(toolName, toolArgs, data.result)
            .map((card, index) => ({ ...card, groupId: groupIdRef.current, parentId: id, timestamp: Date.now() + index }));
          for (const artifact of artifacts) {
            if (cardsRef.current.some(c => c.parentId === id && c.type === 'artifact' && c.text === artifact.text)) continue;
            addCard(artifact);
            addEdge(id, artifact.id, { dashed: true, color: 'rgba(34,211,238,0.45)', label: 'result' });
          }
        }
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

      if (status === 'done' && data.result !== undefined) {
        const artifacts = extractArtifactsFromTool(toolName, toolArgs, data.result)
          .map((card, index) => ({ ...card, groupId: groupIdRef.current, parentId: id, timestamp: Date.now() + index + 1 }));
        for (const artifact of artifacts) {
          addCard(artifact);
          addEdge(id, artifact.id, { dashed: true, color: 'rgba(34,211,238,0.45)', label: 'result' });
        }
      }
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
        addArtifactsForOutput(existingOutput.id, data.text);
        return;
      }

      const outputId = `output_${Date.now()}`;
      addCard({
        id: outputId,
        type: 'final_output',
        text: data.text,
        timestamp: Date.now(),
        groupId: groupIdRef.current,
        status: 'done',
        metadata: { agentName: data.agentName },
      });
      addArtifactsForOutput(outputId, data.text);
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

    if (!socket?.connected) {
      addCard({
        id: `error_${Date.now()}`,
        type: 'error',
        text: 'Canvas is offline. Reconnect Lumi and run this task again.',
        timestamp: Date.now(),
        groupId,
        status: 'error',
      });
      activeCanvasRequestIdRef.current = null;
      return;
    }

    armRequestTimeout(requestId, groupId);

    const canvasContext = buildCanvasContext(cardsRef.current);
    const outgoingText = canvasContext
      ? `${text.trim()}\n\n## Canvas Context\nThe following files/results are already on this canvas. Use them as task context when relevant.\n\n${canvasContext}`
      : text.trim();

    socket?.emit('agent:chat', {
      text: outgoingText,
      history: [],
      personalityId: 'lumi',
      category: undefined,
      agentId: undefined,
      domain,
      orgId: domain === 'work' ? orgId : null,
      source: 'canvas',
      requestId,
    });
  }, [socket, newGroupId, addCard, addEdge, domain, orgId, armRequestTimeout]);

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
      if (!socket?.connected) {
        addCard({
          id: `error_${Date.now()}`,
          type: 'error',
          text: 'Canvas is offline. Reconnect Lumi and rerun this step.',
          timestamp: Date.now(),
          groupId: card.groupId,
          status: 'error',
        });
        activeCanvasRequestIdRef.current = null;
        return;
      }
      armRequestTimeout(requestId, card.groupId);
      const canvasContext = buildCanvasContext(cardsRef.current);
      const outgoingText = canvasContext
        ? `${userRequest.text}\n\n## Canvas Context\nThe following files/results are already on this canvas. Use them as task context when relevant.\n\n${canvasContext}`
        : userRequest.text;
      socket?.emit('agent:chat', {
        text: outgoingText,
        history: [],
        personalityId: 'lumi',
        domain,
        orgId: domain === 'work' ? orgId : null,
        source: 'canvas',
        requestId,
      });
    }
  }, [socket, updateCard, scheduleFlush, domain, orgId, addCard, armRequestTimeout]);

  return { submitTask, clearCards, retryFromCard };
}
