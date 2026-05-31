import { motion, AnimatePresence } from 'motion/react';
import { Bell, X, CheckCheck, Trash2, Info, AlertTriangle, CheckCircle, Zap, MessageSquare } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';
import { useT } from '../lib/useT';
import { useEffect, useState } from 'react';

const ICONS: Record<string, React.ReactNode> = {
  info: <Info size={14} className="text-blue-400" />,
  warning: <AlertTriangle size={14} className="text-amber-400" />,
  success: <CheckCircle size={14} className="text-emerald-400" />,
  system: <Zap size={14} className="text-violet-400" />,
};

export function NotificationCenter({ onChatMessage }: { onChatMessage?: (message: string) => void }) {
  const { notifications, unreadCount, markAllNotificationsRead, clearNotifications } = useApp();
  const t = useT();
  const [historical, setHistorical] = useState<any[]>([]);

  // Load persisted proactive interactions from server
  useEffect(() => {
    fetch('/api/interactions?mode=proactive', { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        if (Array.isArray(data)) {
          setHistorical(data.reverse().slice(0, 30));
        }
      })
      .catch(() => {});
  }, []);

  // Merge in-memory notifications with historical proactive interactions
  const allItems = [
    ...notifications,
    ...historical
      .filter((h: any) => {
        const histMsg = (h.message || h.content || '').replace(/^\[.*?\]\s*/, '');
        return !notifications.some(n => n.message === histMsg);
      })
      .map((h: any) => ({
        id: h.id,
        type: h.mode === 'proactive' ? 'system' : 'info',
        title: h.personality || 'Lumi',
        message: (h.message || h.content || '').replace(/^\[.*?\]\s*/, ''),
        timestamp: h.timestamp ? new Date(h.timestamp).getTime() : Date.now(),
        read: true,
      })),
  ].sort((a, b) => b.timestamp - a.timestamp);

  return (
    <div className="h-full flex flex-col bg-zinc-950/60 backdrop-blur-xl text-white overflow-y-auto">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
        <div className="w-10 h-10 rounded-xl bg-amber-500/20 flex items-center justify-center relative">
          <Bell size={20} className="text-amber-400" />
          {unreadCount > 0 && (
            <span className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-red-500 text-[8px] font-black flex items-center justify-center">
              {unreadCount > 9 ? '9+' : unreadCount}
            </span>
          )}
        </div>
        <div>
          <h2 className="text-sm font-bold text-white/90">{t.ncTitle || 'Notification Center'}</h2>
          <p className="text-[10px] text-white/30">
            {unreadCount > 0 ? unreadCount + ' ' + (t.unreadCount || 'unread') : (t.allCaughtUp || 'All caught up')}
          </p>
        </div>
        <div className="flex-1" />
        {allItems.length > 0 && (
          <div className="flex gap-2">
            <button
              onClick={markAllNotificationsRead}
              className="p-2 rounded-lg bg-white/5 text-white/30 hover:text-white hover:bg-white/10 transition-all"
            >
              <CheckCheck size={14} />
            </button>
            <button
              onClick={clearNotifications}
              className="p-2 rounded-lg bg-white/5 text-white/30 hover:text-red-400 hover:bg-white/10 transition-all"
            >
              <Trash2 size={14} />
            </button>
          </div>
        )}
      </div>

      <div className="flex-1 p-4">
        {allItems.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-white/15">
            <Bell size={48} className="mb-4 opacity-20" />
            <span className="text-xs font-bold uppercase tracking-widest">{t.ncEmpty || 'No notifications'}</span>
            <span className="text-[10px] mt-1">{t.systemEventsHere || 'System events and alerts will appear here'}</span>
          </div>
        ) : (
          <div className="space-y-1">
            <AnimatePresence>
              {allItems.map(n => (
                <motion.div
                  key={n.id}
                  initial={{ opacity: 0, x: -20 }}
                  animate={{ opacity: 1, x: 0 }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={e => { if (e.key === 'Enter') onChatMessage?.(n.message); }}
                  onClick={() => onChatMessage?.(n.message)}
                  className={`flex items-start gap-3 px-4 py-3 rounded-xl transition-all cursor-pointer hover:bg-white/[0.08] ${
                    n.read ? 'bg-white/[0.02]' : 'bg-white/5 border border-white/5'
                  }`}
                >
                  <div className="flex-shrink-0 mt-0.5">
                    {ICONS[n.type] || ICONS.info}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-bold text-white/80">{n.title}</span>
                      <span className="text-[8px] text-white/20">{new Date(n.timestamp).toLocaleString()}</span>
                    </div>
                    <p className="text-[10px] text-white/40 mt-0.5">{n.message}</p>
                  </div>
                  <div className="flex-shrink-0">
                    {!n.read ? (
                      <div className="w-2 h-2 rounded-full bg-blue-400 mt-1.5" />
                    ) : (
                      <MessageSquare size={12} className="text-white/10 mt-1 opacity-0 group-hover:opacity-100 transition-opacity" />
                    )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>
          </div>
        )}
      </div>
    </div>
  );
}
