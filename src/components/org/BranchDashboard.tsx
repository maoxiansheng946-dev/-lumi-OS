import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  BookOpen,
  Building2,
  Clock,
  Package,
  RefreshCw,
  ShieldCheck,
  Users,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { useT } from '../../lib/useT';
import { useApp } from '../../contexts/AppContext';

interface DashboardStats {
  memberCount: number;
  kbArticleCount: number;
  templateCount: number;
  syncStatus: 'connected' | 'offline' | 'syncing';
  lastSync: string | null;
}

export function BranchDashboard() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);
  const { orgConnection, workDomain } = useApp();
  const [stats, setStats] = useState<DashboardStats>({
    memberCount: 0,
    kbArticleCount: 0,
    templateCount: 0,
    syncStatus: 'connected',
    lastSync: null,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const readArray = useCallback(async (url: string) => {
    const response = await fetch(url, { credentials: 'include' });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || `${url} failed (${response.status})`);
    if (Array.isArray(data)) return data;
    if (Array.isArray(data.articles)) return data.articles;
    if (Array.isArray(data.templates)) return data.templates;
    if (Array.isArray(data.members)) return data.members;
    return [];
  }, []);

  const loadStats = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const statusRes = await fetch('/api/org/status', { credentials: 'include' });
      const status = await statusRes.json().catch(() => ({}));
      if (!statusRes.ok) throw new Error(status.error || ui('组织状态加载失败', 'Failed to load organization status'));

      let orgId = orgConnection?.orgId || status.orgId || '';
      if (!orgId) {
        const orgs = await readArray('/api/org/org');
        orgId = orgs[0]?.id || orgs[0]?.orgId || '';
      }

      const partialErrors: string[] = [];
      const [members, articles, templates] = await Promise.all([
        orgId ? readArray(`/api/org/org/${orgId}/members`).catch(err => { partialErrors.push(err.message); return []; }) : Promise.resolve([]),
        readArray('/api/org/kb/articles?status=published').catch(err => { partialErrors.push(err.message); return []; }),
        readArray('/api/org/templates?status=published').catch(err => { partialErrors.push(err.message); return []; }),
      ]);

      if (partialErrors.length > 0) {
        setError(ui('部分组织数据加载失败，请刷新重试。', 'Some organization data failed to load. Try refreshing.'));
      }

      setStats({
        memberCount: members.length,
        kbArticleCount: articles.length,
        templateCount: templates.length,
        syncStatus: status.connected ? 'connected' : 'offline',
        lastSync: new Date().toISOString(),
      });
    } catch (err: any) {
      setError(err?.message || ui('组织工作台加载失败', 'Failed to load organization workspace'));
      setStats(prev => ({ ...prev, syncStatus: 'offline' }));
    } finally {
      setLoading(false);
    }
  }, [orgConnection?.orgId, readArray, ui]);

  useEffect(() => {
    loadStats();
  }, [loadStats]);

  const cards = useMemo(() => [
    {
      label: t.orgMembers || ui('成员', 'Members'),
      value: stats.memberCount,
      icon: <Users size={18} />,
      tone: 'text-emerald-300 bg-emerald-500/10 border-emerald-400/20',
    },
    {
      label: t.orgKB || ui('组织知识库', 'Knowledge Base'),
      value: stats.kbArticleCount,
      icon: <BookOpen size={18} />,
      tone: 'text-blue-300 bg-blue-500/10 border-blue-400/20',
    },
    {
      label: t.orgTemplates || ui('模板', 'Templates'),
      value: stats.templateCount,
      icon: <Package size={18} />,
      tone: 'text-violet-300 bg-violet-500/10 border-violet-400/20',
    },
  ], [stats.kbArticleCount, stats.memberCount, stats.templateCount, t.orgKB, t.orgMembers, t.orgTemplates, ui]);

  return (
    <div className="h-full overflow-y-auto p-6 text-white">
      <div className="mx-auto flex max-w-6xl flex-col gap-5">
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="min-w-0">
              <div className="mb-2 flex items-center gap-3">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-blue-400/20 bg-blue-500/10 text-blue-300">
                  <Building2 size={22} />
                </span>
                <div>
                  <h1 className="text-xl font-semibold text-white">{ui('组织工作台', 'Organization Workspace')}</h1>
                  <p className="text-sm text-white/55">
                    {orgConnection?.orgName || ui('本地组织域', 'Local organization domain')}
                    {' · '}
                    {workDomain === 'work' ? ui('当前在工作域', 'Work domain active') : ui('当前在个人域', 'Personal domain active')}
                  </p>
                </div>
              </div>
              <p className="max-w-2xl text-sm leading-6 text-white/60">
                {ui(
                  '集中查看组织成员、知识库、模板市场和工作状态。这里保留所有组织能力，只把入口和反馈整理得更清楚。',
                  'Review members, knowledge, templates, and workspace health in one place. All organization capabilities remain available with clearer entry points and feedback.',
                )}
              </p>
            </div>

            <div className="flex items-center gap-2">
              <span className={`inline-flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
                stats.syncStatus === 'connected'
                  ? 'border-emerald-400/20 bg-emerald-500/10 text-emerald-300'
                  : 'border-amber-400/20 bg-amber-500/10 text-amber-300'
              }`}>
                {stats.syncStatus === 'connected' ? <Wifi size={14} /> : <WifiOff size={14} />}
                {stats.syncStatus === 'connected'
                  ? (t.orgConnectionOnline || ui('已连接', 'Connected'))
                  : (t.orgConnectionOffline || ui('未连接', 'Offline'))}
              </span>
              <button
                onClick={loadStats}
                disabled={loading}
                className="inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/60 transition hover:bg-white/10 hover:text-white disabled:opacity-50"
                aria-label={ui('刷新', 'Refresh')}
              >
                <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
              </button>
            </div>
          </div>
        </section>

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-400/20 bg-amber-500/10 px-3 py-2 text-sm text-amber-100/80">
            <AlertTriangle size={16} className="mt-0.5 shrink-0 text-amber-300" />
            <span>{error}</span>
          </div>
        )}

        <section className="grid gap-3 md:grid-cols-3">
          {loading ? [1, 2, 3].map(item => (
            <div key={item} className="h-28 animate-pulse rounded-lg border border-white/10 bg-white/[0.04]" />
          )) : cards.map((card, index) => (
            <motion.div
              key={card.label}
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.04 }}
              className="rounded-lg border border-white/10 bg-white/[0.04] p-4"
            >
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm text-white/55">{card.label}</span>
                <span className={`rounded-lg border p-2 ${card.tone}`}>{card.icon}</span>
              </div>
              <div className="text-3xl font-semibold text-white">{card.value}</div>
            </motion.div>
          ))}
        </section>

        <section className="grid gap-3 md:grid-cols-2">
          <QuickAction
            icon={<BookOpen size={18} />}
            label={ui('进入组织知识库', 'Open Knowledge Base')}
            desc={ui('查看、检索和编辑组织资料，工作域上传的文件会同步到这里。', 'Browse, search, and edit organization knowledge. Work-domain uploads sync here.')}
            onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'kb' } }))}
          />
          <QuickAction
            icon={<Package size={18} />}
            label={ui('模板市场', 'Template Marketplace')}
            desc={ui('审核、发布、安装组织内共享的智能体模板。', 'Review, publish, and install organization agent templates.')}
            onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'templates' } }))}
          />
          <QuickAction
            icon={<Activity size={18} />}
            label={ui('组织 Lumi', 'Organization Lumi')}
            desc={ui('向组织知识、制度、项目和团队资料发起查询。', 'Ask organization-level questions about knowledge, policies, projects, and teams.')}
            onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'chat' } }))}
          />
          <QuickAction
            icon={<ShieldCheck size={18} />}
            label={ui('成员与权限', 'Members and Access')}
            desc={ui('查看成员、角色和组织访问状态。', 'Review members, roles, and organization access state.')}
            onClick={() => window.dispatchEvent(new CustomEvent('lumi:navigate', { detail: { tab: 'org', sub: 'members' } }))}
          />
        </section>

        {stats.lastSync && (
          <div className="flex items-center gap-2 text-xs text-white/45">
            <Clock size={13} />
            <span>{ui(`最近刷新：${new Date(stats.lastSync).toLocaleString('zh-CN')}`, `Last refreshed: ${new Date(stats.lastSync).toLocaleString()}`)}</span>
          </div>
        )}
      </div>
    </div>
  );
}

function QuickAction({
  icon,
  label,
  desc,
  onClick,
}: {
  icon: React.ReactNode;
  label: string;
  desc: string;
  onClick: () => void;
}) {
  return (
    <motion.button
      whileHover={{ y: -1 }}
      onClick={onClick}
      className="group flex items-center gap-4 rounded-lg border border-white/10 bg-white/[0.04] p-4 text-left transition hover:border-blue-400/25 hover:bg-white/[0.07]"
    >
      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/65 group-hover:text-blue-300">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium text-white">{label}</span>
        <span className="mt-1 block text-xs leading-5 text-white/50">{desc}</span>
      </span>
      <ArrowRight size={15} className="shrink-0 text-white/35 group-hover:text-blue-300" />
    </motion.button>
  );
}
