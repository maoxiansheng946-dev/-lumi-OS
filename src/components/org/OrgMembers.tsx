import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { motion } from 'motion/react';
import {
  AlertCircle,
  CheckCircle,
  Crown,
  Loader2,
  Shield,
  User,
  UserMinus,
  UserPlus,
  Users,
} from 'lucide-react';
import { useT } from '../../lib/useT';
import { useApp } from '../../contexts/AppContext';
import { appConfirm } from '../../lib/appConfirm';

interface Member {
  id: string;
  userId: string;
  role: string;
  status: string;
  departmentId: string | null;
  joinedAt: string | null;
}

type Feedback = { type: 'success' | 'error'; text: string };

export function OrgMembers() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = useCallback((zh: string, en: string) => (isZh ? zh : en), [isZh]);
  const { orgConnection } = useApp();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState('');
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [feedback, setFeedback] = useState<Feedback | null>(null);

  const loadOrgAndMembers = useCallback(async () => {
    setLoading(true);
    setFeedback(null);
    try {
      let orgIdVal = orgConnection?.orgId || '';
      if (!orgIdVal) {
        const orgsRes = await fetch('/api/org/org', { credentials: 'include' });
        const orgs = await orgsRes.json().catch(() => []);
        if (!orgsRes.ok) throw new Error((orgs as any).error || ui(`组织列表加载失败（${orgsRes.status}）`, `Failed to load organizations (${orgsRes.status})`));
        if (!Array.isArray(orgs) || orgs.length === 0) throw new Error(ui('未找到组织', 'No organization found'));
        orgIdVal = orgs[0].id || orgs[0].orgId;
      }
      setOrgId(orgIdVal);

      const membersRes = await fetch(`/api/org/org/${orgIdVal}/members`, { credentials: 'include' });
      const data = await membersRes.json().catch(() => []);
      if (!membersRes.ok) throw new Error(data.error || ui(`成员加载失败（${membersRes.status}）`, `Failed to load members (${membersRes.status})`));
      setMembers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
      setMembers([]);
    } finally {
      setLoading(false);
    }
  }, [orgConnection?.orgId, ui]);

  useEffect(() => {
    void loadOrgAndMembers();
  }, [loadOrgAndMembers]);

  const handleInvite = async () => {
    if (!inviteUserId.trim() || !orgId) return;
    setInviting(true);
    setFeedback(null);
    try {
      const res = await fetch(`/api/org/org/${orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: inviteUserId.trim(), role: inviteRole }),
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ui(`添加成员失败（${res.status}）`, `Invite failed (${res.status})`));
      setInviteUserId('');
      setFeedback({ type: 'success', text: ui('成员已添加到组织', 'Member added to the organization') });
      void loadOrgAndMembers();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
    } finally {
      setInviting(false);
    }
  };

  const handleRemove = async (userId: string) => {
    const ok = await appConfirm({
      title: ui('移除成员', 'Remove Member'),
      message: ui('确定要从组织中移除此成员吗？', 'Remove this member from the organization?'),
      confirmText: ui('移除', 'Remove'),
      cancelText: ui('取消', 'Cancel'),
      tone: 'danger',
    });
    if (!ok) return;

    setFeedback(null);
    try {
      const res = await fetch(`/api/org/org/${orgId}/members/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || ui(`移除失败（${res.status}）`, `Remove failed (${res.status})`));
      setFeedback({ type: 'success', text: ui('成员已移除', 'Member removed') });
      void loadOrgAndMembers();
    } catch (err: any) {
      setFeedback({ type: 'error', text: err.message || String(err) });
    }
  };

  const activeCount = useMemo(() => members.filter(member => member.status === 'active').length, [members]);

  const roleMeta = (role: string) => {
    const labels: Record<string, string> = {
      owner: t.orgRoleOwner || ui('所有者', 'Owner'),
      admin: t.orgRoleAdmin || ui('管理员', 'Admin'),
      member: t.orgRoleMember || ui('成员', 'Member'),
      viewer: t.orgRoleViewer || ui('查看者', 'Viewer'),
    };
    const styles: Record<string, string> = {
      owner: 'border-amber-400/20 bg-amber-500/10 text-amber-200',
      admin: 'border-red-400/20 bg-red-500/10 text-red-200',
      member: 'border-blue-400/20 bg-blue-500/10 text-blue-200',
      viewer: 'border-white/10 bg-white/5 text-white/55',
    };
    const icons: Record<string, React.ReactNode> = {
      owner: <Crown size={11} />,
      admin: <Shield size={11} />,
      member: <User size={11} />,
      viewer: <User size={11} />,
    };
    return { label: labels[role] || role, style: styles[role] || styles.member, icon: icons[role] || icons.member };
  };

  return (
    <div className="h-full overflow-y-auto p-6 text-white">
      <div className="mx-auto flex max-w-5xl flex-col gap-4">
        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-5">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex items-start gap-3">
              <span className="flex h-10 w-10 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-500/10 text-emerald-300">
                <Users size={22} />
              </span>
              <div>
                <h2 className="text-xl font-semibold text-white">{t.orgMembers || ui('组织成员', 'Organization Members')}</h2>
                <p className="mt-1 text-sm text-white/50">
                  {ui(`${activeCount} 位活跃成员 / 共 ${members.length} 位`, `${activeCount} active / ${members.length} total`)}
                </p>
              </div>
            </div>
            <button
              onClick={loadOrgAndMembers}
              disabled={loading}
              className="rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm text-white/65 transition hover:bg-white/10 disabled:opacity-50"
            >
              {ui('刷新', 'Refresh')}
            </button>
          </div>
        </section>

        {feedback && <FeedbackBanner feedback={feedback} />}

        <section className="rounded-lg border border-white/10 bg-white/[0.04] p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_160px_auto]">
            <label className="block">
              <span className="mb-1 block text-xs text-white/50">{ui('按用户 ID 添加成员', 'Add Member by User ID')}</span>
              <input
                value={inviteUserId}
                onChange={event => setInviteUserId(event.target.value)}
                placeholder={ui('输入用户 ID...', 'Enter user ID...')}
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white outline-none placeholder:text-white/35 focus:border-emerald-400/35"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-white/50">{ui('角色', 'Role')}</span>
              <select
                value={inviteRole}
                onChange={event => setInviteRole(event.target.value)}
                className="w-full rounded-lg border border-white/10 bg-black/20 px-3 py-2 text-sm text-white/75 outline-none"
              >
                <option value="member">{t.orgRoleMember || ui('成员', 'Member')}</option>
                <option value="admin">{t.orgRoleAdmin || ui('管理员', 'Admin')}</option>
                <option value="viewer">{t.orgRoleViewer || ui('查看者', 'Viewer')}</option>
              </select>
            </label>
            <button
              onClick={handleInvite}
              disabled={inviting || !inviteUserId.trim() || !orgId}
              className="self-end inline-flex items-center justify-center gap-2 rounded-lg border border-emerald-400/20 bg-emerald-500/15 px-4 py-2 text-sm font-medium text-emerald-100 transition hover:bg-emerald-500/25 disabled:opacity-50"
            >
              {inviting ? <Loader2 size={15} className="animate-spin" /> : <UserPlus size={15} />}
              {ui('添加', 'Add')}
            </button>
          </div>
        </section>

        <section className="min-h-[260px] rounded-lg border border-white/10 bg-white/[0.04]">
          {loading ? (
            <div className="flex h-64 items-center justify-center text-white/55">
              <Loader2 size={24} className="animate-spin" />
            </div>
          ) : members.length === 0 ? (
            <div className="flex h-64 flex-col items-center justify-center gap-2 text-center text-sm text-white/45">
              <Users size={32} className="text-white/20" />
              <span>{ui('暂无成员。可以通过用户 ID 添加成员。', 'No members yet. Add members by user ID.')}</span>
            </div>
          ) : (
            <div className="divide-y divide-white/8">
              {members.map(member => {
                const meta = roleMeta(member.role);
                return (
                  <motion.div
                    key={member.id}
                    initial={{ opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="flex flex-wrap items-center justify-between gap-3 p-4 transition hover:bg-white/[0.04]"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-white/60">
                        <User size={17} />
                      </span>
                      <div className="min-w-0">
                        <p className="truncate text-sm font-medium text-white">{member.userId}</p>
                        <p className="mt-1 text-xs text-white/45">
                          {member.joinedAt
                            ? ui(`加入于 ${new Date(member.joinedAt).toLocaleDateString('zh-CN')}`, `Joined ${new Date(member.joinedAt).toLocaleDateString()}`)
                            : ui('待加入', 'Pending')}
                          {member.status !== 'active' && <span className="ml-2 text-amber-300">{member.status}</span>}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${meta.style}`}>
                        {meta.icon}
                        {meta.label}
                      </span>
                      {member.role !== 'owner' && (
                        <button
                          onClick={() => handleRemove(member.userId)}
                          className="rounded-lg border border-red-400/15 bg-red-500/5 p-2 text-red-200/70 transition hover:bg-red-500/15 hover:text-red-200"
                          title={ui('移除成员', 'Remove member')}
                        >
                          <UserMinus size={14} />
                        </button>
                      )}
                    </div>
                  </motion.div>
                );
              })}
            </div>
          )}
        </section>
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
