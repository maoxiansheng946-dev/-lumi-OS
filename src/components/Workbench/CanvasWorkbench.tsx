import React, { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Menu } from 'lucide-react';
import { socketService } from '@/services/socketService';
import { useCanvasSocket } from './useCanvasSocket';
import { CanvasViewport } from './CanvasViewport';
import { CanvasSessionPanel } from './CanvasSessionPanel';
import { CanvasInputBar } from './CanvasInputBar';
import { CanvasCard, CanvasEdge, CanvasSessionSummary } from './types';
import { toast } from 'sonner';

interface CanvasWorkbenchProps {
  isOpen: boolean;
  onClose: () => void;
  t: any;
  user: any;
  domain?: 'personal' | 'work';
  orgId?: string | null;
  initialTask?: string;
  onInitialTaskConsumed?: () => void;
}

function normalizeLoadedCanvasCards(cards: CanvasCard[]): CanvasCard[] {
  const staleBefore = Date.now() - 10 * 60 * 1000;
  return cards.map(card => {
    if (card.status !== 'running') return card;
    if (card.timestamp && card.timestamp > staleBefore) return card;
    return {
      ...card,
      status: 'error',
      detail: card.detail || 'This saved canvas step was still running when the session was restored. Rerun from this card if it still matters.',
      metadata: {
        ...(card.metadata || {}),
        restoredStaleRunning: true,
      },
    };
  });
}

export function CanvasWorkbench({ isOpen, onClose, t, user, domain = 'personal', orgId = null, initialTask, onInitialTaskConsumed }: CanvasWorkbenchProps) {
  const socket = socketService.connect();
  const [sessions, setSessions] = useState<CanvasSessionSummary[]>([]);
  const [currentSessionId, setCurrentSessionId] = useState<string | null>(null);
  const [cards, setCards] = useState<CanvasCard[]>([]);
  const [edges, setEdges] = useState<CanvasEdge[]>([]);
  const [showSessionPanel, setShowSessionPanel] = useState(false);
  const [statusText, setStatusText] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [selectedEdgeId, setSelectedEdgeId] = useState<string | null>(null);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cardsRef = useRef<CanvasCard[]>([]);
  const edgesRef = useRef<CanvasEdge[]>([]);
  const consumedInitialTaskRef = useRef('');

  useEffect(() => { cardsRef.current = cards; }, [cards]);
  useEffect(() => { edgesRef.current = edges; }, [edges]);

  useEffect(() => {
    const currentSession = sessions.find(session => session.id === currentSessionId);
    const runningCount = cards.filter(card => card.status === 'running').length;
    const errorCount = cards.filter(card => card.status === 'error' || card.type === 'error').length;
    window.dispatchEvent(new CustomEvent('lumi:canvas-state', {
      detail: {
        open: isOpen,
        sessionId: currentSessionId,
        taskText: currentSession?.taskText || currentSession?.title || '',
        cardCount: cards.length,
        edgeCount: edges.length,
        runningCount,
        errorCount,
        selectedEdgeId,
        saveState,
        status: statusText ? 'working' : 'idle',
        domain,
        orgId: domain === 'work' ? orgId : null,
        updatedAt: Date.now(),
      },
    }));
  }, [cards, currentSessionId, domain, edges, isOpen, orgId, saveState, selectedEdgeId, sessions, statusText]);

  useEffect(() => {
    return () => {
      window.dispatchEvent(new CustomEvent('lumi:canvas-state', {
        detail: { open: false, updatedAt: Date.now() },
      }));
    };
  }, []);

  const scopedCanvasUrl = useCallback((path: string) => {
    const separator = path.includes('?') ? '&' : '?';
    return `${path}${separator}domain=${encodeURIComponent(domain)}`;
  }, [domain]);

  const onCardsReceived = useCallback((newCards: CanvasCard[]) => {
    setCards(newCards);
  }, []);

  const onEdgesReceived = useCallback((newEdges: CanvasEdge[]) => {
    setEdges(newEdges);
  }, []);

  const onStatusChange = useCallback((status: string) => {
    if (status === 'thinking') setStatusText('Working...');
    else if (status === 'responding') setStatusText('Responding...');
    else setStatusText('');
  }, []);

  const { submitTask, clearCards, retryFromCard } = useCanvasSocket({
    socket,
    cards,
    edges,
    domain,
    orgId,
    onCards: onCardsReceived,
    onEdges: onEdgesReceived,
    onStatusChange,
  });

  const loadSessions = useCallback(() => {
    fetch(scopedCanvasUrl('/api/canvas/sessions'))
      .then(async r => {
        if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || 'Failed to load canvas sessions');
        return r.json();
      })
      .then(data => setSessions(data.sessions || []))
      .catch((err) => toast.error(err.message || 'Failed to load canvas sessions'));
  }, [scopedCanvasUrl]);

  // Load session list
  useEffect(() => {
    if (isOpen) loadSessions();
  }, [isOpen, loadSessions]);

  // Auto-save
  const autoSave = useCallback(() => {
    if (!currentSessionId) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveState('saving');
      try {
        const res = await fetch(scopedCanvasUrl(`/api/canvas/sessions/${currentSessionId}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ cards: cardsRef.current, edges: edgesRef.current }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Canvas autosave failed');
        setSaveState('saved');
        setSessions(prev => prev.map(s =>
          s.id === currentSessionId
            ? { ...s, cardCount: cardsRef.current.length, updatedAt: new Date().toISOString() }
            : s
        ));
      } catch (err: any) {
        setSaveState('error');
        toast.error(err.message || 'Canvas autosave failed');
      }
    }, 2000);
  }, [currentSessionId, scopedCanvasUrl]);

  useEffect(() => {
    if (currentSessionId) autoSave();
  }, [cards, edges, currentSessionId, autoSave]);

  const handleNewSession = useCallback(async () => {
    try {
      const res = await fetch(scopedCanvasUrl('/api/canvas/sessions'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create canvas');
      const session = await res.json();
      setCurrentSessionId(session.id);
      setCards([]);
      setEdges([]);
      setSelectedEdgeId(null);
      setSaveState('saved');
      setSessions(prev => [
        { id: session.id, title: session.title, taskText: session.taskText, status: session.status, cardCount: 0, createdAt: session.createdAt, updatedAt: session.updatedAt },
        ...prev,
      ]);
      setShowSessionPanel(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to create canvas');
    }
  }, [scopedCanvasUrl]);

  const handleLoadSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(scopedCanvasUrl(`/api/canvas/sessions/${id}`));
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load canvas');
      const session = await res.json();
      setCurrentSessionId(session.id);
      setCards(normalizeLoadedCanvasCards(session.cards || []));
      setEdges(session.edges || []);
      setSelectedEdgeId(null);
      setSaveState('saved');
      setShowSessionPanel(false);
    } catch (err: any) {
      toast.error(err.message || 'Failed to load canvas');
    }
  }, [scopedCanvasUrl]);

  const handleDeleteSession = useCallback(async (id: string) => {
    try {
      const res = await fetch(scopedCanvasUrl(`/api/canvas/sessions/${id}`), { method: 'DELETE' });
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to delete canvas');
      setSessions(prev => prev.filter(s => s.id !== id));
      if (currentSessionId === id) {
        setCurrentSessionId(null);
        setCards([]);
        setEdges([]);
        setSelectedEdgeId(null);
        setSaveState('idle');
      }
      toast.success('Canvas deleted');
    } catch (err: any) {
      toast.error(err.message || 'Failed to delete canvas');
    }
  }, [currentSessionId, scopedCanvasUrl]);

  const handleClearCanvas = useCallback(() => {
    setSelectedEdgeId(null);
    clearCards();
  }, [clearCards]);

  const handleImportFiles = useCallback(async (files: FileList) => {
    const fileList = Array.from(files || []);
    if (fileList.length === 0) return;

    try {
      if (!currentSessionId) {
        const res = await fetch(scopedCanvasUrl('/api/canvas/sessions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskText: 'Imported files', title: 'Imported files' }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create canvas');
        const session = await res.json();
        setCurrentSessionId(session.id);
        setSaveState('saving');
        setSessions(prev => [
          { id: session.id, title: session.title, taskText: session.taskText, status: session.status, cardCount: 0, createdAt: session.createdAt, updatedAt: session.updatedAt },
          ...prev,
        ]);
      }

      const formData = new FormData();
      fileList.forEach(file => formData.append('files', file));
      const res = await fetch('/api/files/upload', { method: 'POST', body: formData, credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || t.uploadFailed || 'Upload failed');

      const groupId = `import_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
      const importedCards: CanvasCard[] = (data.files || []).map((file: any, index: number) => {
        const content = String(file.content || file.preview || '').trim();
        return {
          id: `artifact_import_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 6)}`,
          type: 'artifact',
          text: file.name || file.fileName || `File ${index + 1}`,
          detail: content || (file.path || ''),
          timestamp: Date.now() + index,
          groupId,
          status: 'done',
          metadata: {
            artifactKind: 'imported_file',
            fileName: file.name || file.fileName,
            filepath: file.path,
            path: file.path,
            preview: file.preview || content.slice(0, 1000),
            content,
            ingested: Boolean(file.ingested),
            extracted: Boolean(file.extracted),
          },
        };
      });

      setCards(prev => [...prev, ...importedCards]);
      setEdges(prev => {
        const next = [...prev];
        for (let i = 1; i < importedCards.length; i++) {
          next.push({
            id: `edge_${importedCards[i - 1].id}_${importedCards[i].id}`,
            sourceId: importedCards[i - 1].id,
            targetId: importedCards[i].id,
            label: 'import',
            dashed: true,
            color: 'rgba(34,211,238,0.35)',
          });
        }
        return next;
      });
      toast.success(t.canvasFilesImported || `${importedCards.length} file(s) imported to canvas`);
    } catch (err: any) {
      toast.error(err.message || t.uploadFailed || 'Upload failed');
    }
  }, [currentSessionId, scopedCanvasUrl, t]);

  const handleTaskSubmit = useCallback(async (text: string) => {
    if (!currentSessionId) {
      try {
        const res = await fetch(scopedCanvasUrl('/api/canvas/sessions'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ taskText: text, title: text.slice(0, 60) }),
        });
        if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to create canvas');
        const session = await res.json();
        setCurrentSessionId(session.id);
        setSaveState('saving');
        setSessions(prev => [
          { id: session.id, title: session.title, taskText: session.taskText, status: session.status, cardCount: 0, createdAt: session.createdAt, updatedAt: session.updatedAt },
          ...prev,
        ]);
        fetch(scopedCanvasUrl(`/api/canvas/sessions/${session.id}`), {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ title: text.slice(0, 60), taskText: text }),
        }).catch(() => {});
      } catch (err: any) {
        toast.error(err.message || 'Failed to create canvas');
        return;
      }
    }

    submitTask(text);
  }, [currentSessionId, submitTask, scopedCanvasUrl]);

  useEffect(() => {
    const task = initialTask?.trim();
    if (!isOpen || !task || consumedInitialTaskRef.current === task) return;
    consumedInitialTaskRef.current = task;
    void handleTaskSubmit(task);
    onInitialTaskConsumed?.();
  }, [handleTaskSubmit, initialTask, isOpen, onInitialTaskConsumed]);

  useEffect(() => {
    if (!initialTask) consumedInitialTaskRef.current = '';
  }, [initialTask]);

  const handleEdgeSelect = useCallback((edge: CanvasEdge | null) => {
    setSelectedEdgeId(edge?.id || null);
  }, []);

  const handleEdgeModify = useCallback((edge: CanvasEdge, instruction: string) => {
    const source = cardsRef.current.find(card => card.id === edge.sourceId);
    const target = cardsRef.current.find(card => card.id === edge.targetId);
    const prompt = [
      'Revise only the selected canvas path step.',
      `Source step:\n${source?.text || edge.sourceId}`,
      `Current step:\n${target?.text || edge.targetId}`,
      `User instruction:\n${instruction}`,
      'Keep unrelated canvas work intact. Return the revised step, the changed output, and any tool actions needed.',
    ].join('\n\n');

    submitTask(prompt, {
      parentCardId: edge.targetId,
      edgeLabel: 'revise',
    });
    setSelectedEdgeId(null);
    toast.success('Revision added to canvas path');
  }, [submitTask]);

  const handleEdgeBranch = useCallback((edge: CanvasEdge, instruction: string) => {
    const source = cardsRef.current.find(card => card.id === edge.sourceId);
    const target = cardsRef.current.find(card => card.id === edge.targetId);
    const branchInstruction = instruction.trim() || 'Try a useful alternative branch from this step.';
    const prompt = [
      'Create a new branch from the selected canvas path.',
      `Source step:\n${source?.text || edge.sourceId}`,
      `Branch point:\n${target?.text || edge.targetId}`,
      `Branch instruction:\n${branchInstruction}`,
      'Keep the existing canvas route intact. Add the alternative path as a new branch and explain what changed.',
    ].join('\n\n');

    submitTask(prompt, {
      parentCardId: edge.targetId,
      edgeLabel: 'branch',
    });
    setSelectedEdgeId(null);
    toast.success('Branch added to canvas path');
  }, [submitTask]);

  const handleEdgeRerun = useCallback((edge: CanvasEdge) => {
    retryFromCard(edge.targetId);
    setSelectedEdgeId(null);
    toast.success('Rerunning selected canvas step');
  }, [retryFromCard]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !showSessionPanel) onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose, showSessionPanel]);

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          className="fixed inset-0 z-[220] bg-[#0a0a10]"
        >
          <div className="absolute top-0 left-0 right-0 z-40 h-12 flex items-center justify-between px-4 bg-gradient-to-b from-black/60 to-transparent">
            <div className="flex items-center gap-3">
              <button
                onClick={() => setShowSessionPanel(true)}
                className="w-9 h-9 flex items-center justify-center rounded-xl text-white/50 hover:text-white hover:bg-white/10 transition-colors"
              ><Menu size={18} /></button>
              <span className="text-sm font-medium text-white/70">
                {t.canvasWorkbench || 'Canvas'}
              </span>
              {statusText && (
                <span className="text-[10px] text-amber-400/70 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                  {statusText}
                </span>
              )}
              {saveState !== 'idle' && (
                <span className={`text-[10px] flex items-center gap-1 ${
                  saveState === 'error' ? 'text-red-400/80' :
                  saveState === 'saving' ? 'text-cyan-300/70' :
                  'text-emerald-300/70'
                }`}>
                  <span className={`w-1.5 h-1.5 rounded-full ${
                    saveState === 'error' ? 'bg-red-400' :
                    saveState === 'saving' ? 'bg-cyan-300 animate-pulse' :
                    'bg-emerald-300'
                  }`} />
                  {saveState === 'saving' ? 'Saving...' : saveState === 'error' ? 'Save failed' : 'Saved'}
                </span>
              )}
            </div>
            <button
              onClick={onClose}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-white/40 hover:text-white hover:bg-white/10 transition-colors"
            ><X size={18} /></button>
          </div>

          <CanvasViewport
            cards={cards}
            edges={edges}
            t={t}
            onRetry={retryFromCard}
            onClear={handleClearCanvas}
            selectedEdgeId={selectedEdgeId}
            onEdgeSelect={handleEdgeSelect}
            onEdgeModify={handleEdgeModify}
            onEdgeBranch={handleEdgeBranch}
            onEdgeRerun={handleEdgeRerun}
          />

          <CanvasSessionPanel
            isOpen={showSessionPanel}
            onClose={() => setShowSessionPanel(false)}
            sessions={sessions}
            currentId={currentSessionId}
            onSelect={handleLoadSession}
            onNew={handleNewSession}
            onDelete={handleDeleteSession}
            t={t}
          />

          <CanvasInputBar
            onSend={handleTaskSubmit}
            onImportFiles={handleImportFiles}
            disabled={statusText !== ''}
            t={t}
          />
        </motion.div>
      )}
    </AnimatePresence>
  );
}
