import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { ClipboardCheck, CheckCircle, XCircle, Loader2, Eye, AlertCircle } from 'lucide-react';
import { Button } from '../ui/button';
import { useT } from '../../lib/useT';
import { useSocket } from '../../hooks/useSocket';

interface ReviewTemplate {
  id: string;
  name: string;
  description: string;
  category: string;
  status: string;
  authorId: string;
  version: number;
  createdAt: string;
}

export function TemplateReviewQueue() {
  const t = useT();
  const socket = useSocket();
  const [queue, setQueue] = useState<ReviewTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReviewTemplate | null>(null);
  const [comment, setComment] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  useEffect(() => { loadQueue(); }, []);

  useEffect(() => {
    if (!socket) return;
    const onSubmitted = () => loadQueue();
    const onApproved = (data: { templateId: string }) => {
      setQueue(prev => prev.filter(t => t.id !== data.templateId));
    };
    const onRejected = (data: { templateId: string }) => {
      setQueue(prev => prev.filter(t => t.id !== data.templateId));
    };
    socket.on('template:submitted', onSubmitted);
    socket.on('template:approved', onApproved);
    socket.on('template:rejected', onRejected);
    return () => {
      socket.off('template:submitted', onSubmitted);
      socket.off('template:approved', onApproved);
      socket.off('template:rejected', onRejected);
    };
  }, [socket]);

  const loadQueue = async () => {
    setFeedback(null);
    try {
      const res = await fetch('/api/org/templates?status=pending_review', { credentials: 'include' });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error(data.error || `Failed to load review queue (${res.status})`);
      setQueue(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
    } finally { setLoading(false); }
  };

  const handleAction = async (templateId: string, action: 'approve' | 'reject') => {
    setActionLoading(templateId);
    setFeedback(null);
    try {
      const endpoint = action === 'approve' ? 'approve' : 'reject';
      const body = action === 'reject' ? { comment } : comment ? { comment } : {};
      const res = await fetch(`/api/org/templates/${templateId}/${endpoint}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `${endpoint} failed (${res.status})`);

      if (action === 'approve') {
        const publishRes = await fetch(`/api/org/templates/${templateId}/publish`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
        });
        const publishData = await publishRes.json().catch(() => ({}));
        if (!publishRes.ok) {
          throw new Error(publishData.error || `Approved, but publish failed (${publishRes.status})`);
        }
      }

      setQueue(prev => prev.filter(t => t.id !== templateId));
      setSelected(null);
      setComment('');
      setFeedback({
        type: 'success',
        text: action === 'approve'
          ? (t.templateApprovedPublished || 'Template approved and published to Marketplace')
          : (t.templateRejected || 'Template rejected'),
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
    } finally { setActionLoading(null); }
  };

  return (
    <div className="p-6 space-y-6">
      <div>
        <h2 className="text-xl font-bold text-white flex items-center gap-2">
          <ClipboardCheck size={24} className="text-amber-400" />
          {t.templateReviewQueue || 'Template Review Queue'}
        </h2>
        <p className="text-white/40 text-sm">{queue.length} {t.templatesPendingReview || 'template(s) pending review'}</p>
      </div>

      {feedback && (
        <div className={`flex items-start gap-2 rounded-xl border px-4 py-3 text-sm ${
          feedback.type === 'success'
            ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-300'
            : 'border-red-500/20 bg-red-500/10 text-red-300'
        }`}>
          {feedback.type === 'success' ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
          <span>{feedback.text}</span>
        </div>
      )}

      {loading ? (
        <div className="text-center py-12 text-white/55"><Loader2 size={24} className="mx-auto animate-spin" /></div>
      ) : queue.length === 0 ? (
        <div className="text-center py-12 text-white/55">
          <CheckCircle size={32} className="mx-auto mb-2 text-green-400/50" />
          {t.allTemplatesReviewed || 'All templates have been reviewed!'}
        </div>
      ) : (
        <div className="space-y-3">
          {queue.map(template => (
            <motion.div
              key={template.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className={`bg-white/5 border rounded-xl p-4 transition-all ${
                selected?.id === template.id ? 'border-amber-500/30' : 'border-white/10 hover:bg-white/[0.07]'
              }`}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="text-white font-medium">{template.name}</h3>
                  <p className="text-white/40 text-xs mt-1">{template.description}</p>
                  <div className="flex items-center gap-2 mt-2">
                    <span className="text-xs px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400">{template.category}</span>
                    <span className="text-xs text-white/55">v{template.version}</span>
                    <span className="text-xs text-white/45">{new Date(template.createdAt).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex items-center gap-2 ml-4">
                  {selected?.id === template.id ? (
                    <>
                      <input
                        value={comment}
                        onChange={e => setComment(e.target.value)}
                        placeholder={t.reviewComment || 'Review comment...'}
                        className="px-3 py-1.5 bg-white/5 border border-white/10 rounded-lg text-white text-xs placeholder:text-white/45 focus:outline-none"
                      />
                      <Button
                        onClick={() => handleAction(template.id, 'approve')}
                        disabled={actionLoading === template.id}
                        className="bg-green-600 hover:bg-green-500 text-white text-xs rounded-lg px-3 py-1.5 flex items-center gap-1"
                      >
                        {actionLoading === template.id ? <Loader2 size={12} className="animate-spin" /> : <CheckCircle size={12} />}
                        {t.approveAndPublish || 'Approve & Publish'}
                      </Button>
                      <Button
                        onClick={() => handleAction(template.id, 'reject')}
                        disabled={actionLoading === template.id || !comment.trim()}
                        className="bg-red-600 hover:bg-red-500 text-white text-xs rounded-lg px-3 py-1.5 flex items-center gap-1"
                      >
                        <XCircle size={12} /> {t.reject || 'Reject'}
                      </Button>
                    </>
                  ) : (
                    <Button
                      onClick={() => setSelected(template)}
                      className="bg-white/10 hover:bg-white/20 text-white/70 text-xs rounded-lg flex items-center gap-1"
                    >
                      <Eye size={12} /> {t.review || 'Review'}
                    </Button>
                  )}
                </div>
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
