import React, { useCallback, useEffect, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle,
  ClipboardCheck,
  Eye,
  Loader2,
  XCircle,
} from 'lucide-react';
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

type Feedback = { type: 'success' | 'error'; text: string };

export function TemplateReviewQueue() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);
  const socket = useSocket();
  const [queue, setQueue] = useState<ReviewTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<ReviewTemplate | null>(null);
  const [comment, setComment] = useState('');
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadQueue = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      const res = await fetch('/api/org/templates?status=pending_review', { credentials: 'include' });
      const data = await res.json().catch(() => []);
      if (!res.ok) throw new Error((data as any).error || ui(`审核队列加载失败（${res.status}）`, `Failed to load review queue (${res.status})`));
      setQueue(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
      setQueue([]);
    } finally {
      setLoading(false);
    }
  }, [ui]);

  useEffect(() => {
    void loadQueue();
  }, [loadQueue]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => void loadQueue();
    const remove = (data: { templateId: string }) => {
      setQueue(prev => prev.filter(item => item.id !== data.templateId));
    };
    socket.on('template:submitted', refresh);
    socket.on('template:approved', remove);
    socket.on('template:rejected', remove);
    return () => {
      socket.off('template:submitted', refresh);
      socket.off('template:approved', remove);
      socket.off('template:rejected', remove);
    };
  }, [loadQueue, socket]);

  const handleAction = async (templateId: string, action: 'approve' | 'reject') => {
    if (action === 'reject' && !comment.trim()) {
      setFeedback({ type: 'error', text: ui('拒绝模板必须填写审核意见。', 'Rejecting a template requires a review comment.') });
      return;
    }

    setActionLoading(templateId);
    setFeedback(null);
    try {
      const endpoint = action === 'approve' ? 'approve' : 'reject';
      const body = action === 'reject' ? { comment: comment.trim() } : comment.trim() ? { comment: comment.trim() } : {};
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
        if (!publishRes.ok) throw new Error(publishData.error || ui(`已通过审核，但发布失败（${publishRes.status}）`, `Approved, but publish failed (${publishRes.status})`));
      }

      setQueue(prev => prev.filter(item => item.id !== templateId));
      setSelected(null);
      setComment('');
      setFeedback({
        type: 'success',
        text: action === 'approve'
          ? (t.templateApprovedPublished || ui('模板已通过并发布到市场', 'Template approved and published to Marketplace'))
          : (t.templateRejected || ui('模板已拒绝', 'Template rejected')),
      });
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
    } finally {
      setActionLoading(null);
    }
  };

  return (
    <div className="h-full overflow-y-auto p-6 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex items-start gap-3">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-amber-400/20 bg-amber-500/10 text-amber-300">
              <ClipboardCheck size={22} />
            </span>
            <div>
              <h2 className="text-xl font-semibold text-white">{t.templateReviewQueue || ui('模板审核队列', 'Template Review Queue')}</h2>
              <p className="mt-1 text-sm text-white/50">
                {ui(`${queue.length} 个模板等待审核`, `${queue.length} template(s) pending review`)}
              </p>
            </div>
          </div>
        </section>

        {feedback && <FeedbackBanner feedback={feedback} />}

        {loading ? (
          <div className="flex h-64 items-center justify-center rounded-lg border border-white/10 bg-white/[0.04] text-white/55">
            <Loader2 size={24} className="animate-spin" />
          </div>
        ) : queue.length === 0 ? (
          <div className="flex h-64 flex-col items-center justify-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] text-center text-sm text-white/45">
            <CheckCircle size={34} className="text-emerald-300/60" />
            <span>{t.allTemplatesReviewed || ui('所有模板都已审核完成', 'All templates have been reviewed.')}</span>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {queue.map(template => {
              const active = selected?.id === template.id;
              return (
                <motion.div
                  key={template.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={`rounded-lg border p-4 transition ${
                    active ? 'border-amber-400/30 bg-amber-500/8' : 'border-white/10 bg-white/[0.04] hover:bg-white/[0.06]'
                  }`}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <h3 className="text-sm font-medium text-white">{template.name}</h3>
                      <p className="mt-1 line-clamp-2 text-xs leading-5 text-white/45">{template.description}</p>
                      <div className="mt-3 flex flex-wrap gap-2 text-xs text-white/45">
                        <span className="rounded-md bg-amber-500/10 px-2 py-1 text-amber-200">{template.category}</span>
                        <span className="rounded-md bg-white/5 px-2 py-1">v{template.version}</span>
                        <span className="rounded-md bg-white/5 px-2 py-1">{new Date(template.createdAt).toLocaleDateString(isZh ? 'zh-CN' : undefined)}</span>
                      </div>
                    </div>

                    {!active && (
                      <button
                        onClick={() => { setSelected(template); setComment(''); }}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/65 transition hover:bg-white/10 hover:text-white"
                      >
                        <Eye size={14} />
                        {t.review || ui('审核', 'Review')}
                      </button>
                    )}
                  </div>

                  {active && (
                    <div className="mt-4 rounded-lg border border-white/10 bg-black/15 p-3">
                      <label className="block">
                        <span className="mb-1 block text-xs text-white/50">{t.reviewComment || ui('审核意见', 'Review comment')}</span>
                        <input
                          value={comment}
                          onChange={event => setComment(event.target.value)}
                          placeholder={ui('通过可选填，拒绝必须填写原因...', 'Optional for approval, required for rejection...')}
                          className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-amber-400/35"
                        />
                      </label>
                      <div className="mt-3 flex flex-wrap justify-end gap-2">
                        <button
                          onClick={() => { setSelected(null); setComment(''); }}
                          className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/60 transition hover:bg-white/10"
                        >
                          {ui('取消', 'Cancel')}
                        </button>
                        <button
                          onClick={() => handleAction(template.id, 'reject')}
                          disabled={actionLoading === template.id || !comment.trim()}
                          className="inline-flex items-center gap-2 rounded-lg border border-red-400/20 bg-red-500/10 px-3 py-2 text-sm font-medium text-red-200 transition hover:bg-red-500/20 disabled:opacity-50"
                        >
                          <XCircle size={14} />
                          {t.reject || ui('拒绝', 'Reject')}
                        </button>
                        <button
                          onClick={() => handleAction(template.id, 'approve')}
                          disabled={actionLoading === template.id}
                          className="inline-flex items-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/15 px-3 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-50"
                        >
                          {actionLoading === template.id ? <Loader2 size={14} className="animate-spin" /> : <CheckCircle size={14} />}
                          {t.approveAndPublish || ui('通过并发布', 'Approve & Publish')}
                        </button>
                      </div>
                    </div>
                  )}
                </motion.div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function FeedbackBanner({ feedback }: { feedback: Feedback }) {
  return (
    <div className={`flex items-start gap-2 rounded-lg border px-3 py-2 text-sm ${
      feedback.type === 'success'
        ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-200'
        : 'border-red-500/20 bg-red-500/10 text-red-200'
    }`}>
      {feedback.type === 'success' ? <CheckCircle size={16} className="mt-0.5 shrink-0" /> : <AlertCircle size={16} className="mt-0.5 shrink-0" />}
      <span>{feedback.text}</span>
    </div>
  );
}
