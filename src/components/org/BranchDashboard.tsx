import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import {
  Building2, Users, BookOpen, Package, Activity,
  Clock, Wifi, WifiOff, RefreshCw, ArrowRight,
} from 'lucide-react';
import { useT } from '../../lib/useT';
import { useApp } from '../../contexts/AppContext';

interface DashboardStats {
  memberCount: number;
  kbArticleCount: number;
  templateCount: number;
  recentActivity: string;
  syncStatus: 'connected' | 'offline' | 'syncing';
  lastSync: string | null;
}

export function BranchDashboard() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const { orgConnection } = useApp();
  const [stats, setStats] = useState<DashboardStats>({
    memberCount: 0,
    kbArticleCount: 0,
    templateCount: 0,
    recentActivity: '',
    syncStatus: 'connected',
    lastSync: null,
  });
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadStats();
  }, []);

  const loadStats = async () => {
    try {
      const res = await fetch('/api/org/status', { credentials: 'include' });
      if (!res.ok) return;
      const status = await res.json();
      let orgId = orgConnection?.orgId || status.orgId || '';
      if (!orgId) {
        const orgs = await fetch('/api/org/org', { credentials: 'include' }).then(r => r.ok ? r.json() : []);
        orgId = Array.isArray(orgs) ? (orgs[0]?.id || orgs[0]?.orgId || '') : '';
      }

      // Load org-specific stats
      const [membersRes, kbRes, templatesRes] = await Promise.all([
        orgId ? fetch(`/api/org/org/${orgId}/members`, { credentials: 'include' }).then(r => r.ok ? r.json() : []) : Promise.resolve([]),
        fetch('/api/org/kb/articles?status=published', { credentials: 'include' }).then(r => r.json()),
        fetch('/api/org/templates?status=published', { credentials: 'include' }).then(r => r.json()),
      ]);

      setStats({
        memberCount: Array.isArray(membersRes) ? membersRes.length : 0,
        kbArticleCount: Array.isArray(kbRes) ? kbRes.length : 0,
        templateCount: Array.isArray(templatesRes) ? templatesRes.length : 0,
        recentActivity: ui('已连接', 'Connected'),
        syncStatus: status.connected ? 'connected' : 'offline',
        lastSync: new Date().toISOString(),
      });
    } catch {
      setStats(s => ({ ...s, syncStatus: 'offline' }));
    } finally {
      setLoading(false);
    }
  };

  const cards = [
    { label: t.orgMembers, value: stats.memberCount, icon: <Users size={20} />, color: 'text-green-400', bg: 'bg-green-500/10' },
    { label: t.orgKB, value: stats.kbArticleCount, icon: <BookOpen size={20} />, color: 'text-blue-400', bg: 'bg-blue-500/10' },
    { label: t.orgTemplates, value: stats.templateCount, icon: <Package size={20} />, color: 'text-purple-400', bg: 'bg-purple-500/10' },
  ];

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white flex items-center gap-3">
            <Building2 size={28} className="text-blue-400" />
            {ui('组织仪表盘', 'Organization Dashboard')}
          </h1>
          <p className="text-white/40 text-sm mt-1">{ui('你的工作域概览', 'Your work domain overview')}</p>
        </div>
        <div className="flex items-center gap-3">
          <span className={`flex items-center gap-1 text-xs px-3 py-1 rounded-full ${
            stats.syncStatus === 'connected' ? 'bg-green-500/10 text-green-400' : 'bg-amber-500/10 text-amber-400'
          }`}>
            {stats.syncStatus === 'connected' ? <Wifi size={12} /> : <WifiOff size={12} />}
            {stats.syncStatus === 'connected' ? t.orgConnectionOnline : t.orgConnectionOffline}
          </span>
          <button
            onClick={loadStats}
            className="p-2 rounded-lg bg-white/5 hover:bg-white/10 text-white/40 hover:text-white/70 transition-colors"
          >
            <RefreshCw size={16} />
          </button>
        </div>
      </div>

      {/* Stats cards */}
      {loading ? (
        <div className="grid grid-cols-3 gap-4">
          {[1, 2, 3].map(i => (
            <div key={i} className="bg-white/5 rounded-xl p-6 animate-pulse h-24" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-3 gap-4">
          {cards.map((card) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              className="bg-white/5 border border-white/10 rounded-xl p-6 hover:bg-white/[0.07] transition-colors"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-white/40 text-sm">{card.label}</span>
                <span className={`p-2 rounded-lg ${card.bg} ${card.color}`}>{card.icon}</span>
              </div>
              <span className="text-3xl font-bold text-white">{card.value}</span>
            </motion.div>
          ))}
        </div>
      )}

      {/* Quick actions */}
      <div className="grid grid-cols-2 gap-4">
        <QuickAction
          icon={<BookOpen size={18} />}
          label={ui('浏览知识库', 'Browse Knowledge Base')}
          desc={ui('搜索公司制度、SOP 和文档', 'Search company policies, SOPs, and documentation')}
          color="blue"
          onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'kb' } }))}
        />
        <QuickAction
          icon={<Package size={18} />}
          label={ui('模板市场', 'Template Marketplace')}
          desc={ui('发现团队共享的智能体模板', 'Discover agent templates from your team')}
          color="purple"
          onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'templates' } }))}
        />
        <QuickAction
          icon={<Activity size={18} />}
          label={ui('和公司 Lumi 对话', 'Talk to Company Lumi')}
          desc={ui('询问文化、制度和组织知识', 'Ask about culture, policies, and organizational knowledge')}
          color="green"
          onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'chat' } }))}
        />
        <QuickAction
          icon={<Users size={18} />}
          label={ui('团队目录', 'Team Directory')}
          desc={ui('查看成员和部门', 'View members and departments')}
          color="amber"
          onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'members' } }))}
        />
      </div>

      {stats.lastSync && (
        <div className="flex items-center gap-2 text-white/45 text-xs">
          <Clock size={12} />
          <span>{ui(`最近同步：${new Date(stats.lastSync).toLocaleString('zh-CN')}`, `Last synced: ${new Date(stats.lastSync).toLocaleString()}`)}</span>
        </div>
      )}
    </div>
  );
}

function QuickAction({ icon, label, desc, color, onClick }: {
  icon: React.ReactNode; label: string; desc: string; color: string; onClick: () => void;
}) {
  const borders: Record<string, string> = { blue: 'border-l-blue-500/40', purple: 'border-l-purple-500/40', green: 'border-l-green-500/40', amber: 'border-l-amber-500/40' };
  return (
    <motion.button
      whileHover={{ scale: 1.02 }}
      onClick={onClick}
      className={`flex items-center gap-4 bg-white/5 border border-white/10 border-l-2 ${borders[color]} rounded-xl p-4 text-left hover:bg-white/[0.07] transition-colors`}
    >
      <span className="text-white/50">{icon}</span>
      <div>
        <span className="text-white text-sm font-medium">{label}</span>
        <p className="text-white/55 text-xs">{desc}</p>
      </div>
      <ArrowRight size={14} className="text-white/45 ml-auto" />
    </motion.button>
  );
}
