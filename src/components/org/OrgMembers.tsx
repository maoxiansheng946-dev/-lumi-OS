import React, { useState, useEffect } from 'react';
import { motion } from 'motion/react';
import { Users, UserPlus, Shield, UserMinus, Loader2, Crown, User, AlertCircle, CheckCircle } from 'lucide-react';
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

export function OrgMembers() {
  const t = useT();
  const isZh = t.langCode !== 'en';
  const ui = (zh: string, en: string) => (isZh ? zh : en);
  const { orgConnection } = useApp();
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [orgId, setOrgId] = useState('');
  const [inviteUserId, setInviteUserId] = useState('');
  const [inviteRole, setInviteRole] = useState('member');
  const [inviting, setInviting] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    loadOrgAndMembers();
  }, []);

  const loadOrgAndMembers = async () => {
    setError('');
    try {
      let orgIdVal = orgConnection?.orgId || '';
      if (!orgIdVal) {
        const orgsRes = await fetch('/api/org/org', { credentials: 'include' });
        if (!orgsRes.ok) throw new Error(ui(`组织列表加载失败（${orgsRes.status}）`, `Failed to load organizations (${orgsRes.status})`));
        const orgs = await orgsRes.json();
        if (orgs.length === 0) throw new Error(ui('未找到组织', 'No organization found'));
        orgIdVal = orgs[0].id || orgs[0].orgId;
      }
      setOrgId(orgIdVal);

      const membersRes = await fetch(`/api/org/org/${orgIdVal}/members`, { credentials: 'include' });
      const data = await membersRes.json().catch(() => []);
      if (!membersRes.ok) throw new Error(data.error || ui(`成员加载失败（${membersRes.status}）`, `Failed to load members (${membersRes.status})`));
      setMembers(Array.isArray(data) ? data : []);
    } catch (err: any) {
      setError(err.message || String(err));
    } finally { setLoading(false); }
  };

  const handleInvite = async () => {
    if (!inviteUserId.trim() || !orgId) return;
    setInviting(true);
    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/org/org/${orgId}/members`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: inviteUserId, role: inviteRole }),
        credentials: 'include',
      });
      if (res.ok) {
        setInviteUserId('');
        setSuccess(ui('成员已添加到组织', 'Member added to the organization'));
        void loadOrgAndMembers();
      } else {
        const data = await res.json().catch(() => ({}));
        setError(data.error || ui(`邀请失败（${res.status}）`, `Invite failed (${res.status})`));
      }
    } catch (err: any) {
      setError(err.message || String(err));
    } finally { setInviting(false); }
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

    setError('');
    setSuccess('');
    try {
      const res = await fetch(`/api/org/org/${orgId}/members/${userId}`, {
        method: 'DELETE',
        credentials: 'include',
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error || ui(`移除失败（${res.status}）`, `Remove failed (${res.status})`));
      }
      setSuccess(ui('成员已移除', 'Member removed'));
      void loadOrgAndMembers();
    } catch (err: any) {
      setError(err.message || String(err));
    }
  };

  const roleBadge = (role: string) => {
    const map: Record<string, { color: string; icon: React.ReactNode }> = {
      owner: { color: 'text-amber-400 bg-amber-500/10', icon: <Crown size={10} /> },
      admin: { color: 'text-red-400 bg-red-500/10', icon: <Shield size={10} /> },
      member: { color: 'text-blue-400 bg-blue-500/10', icon: <User size={10} /> },
      viewer: { color: 'text-white/40 bg-white/5', icon: <User size={10} /> },
    };
    const s = map[role] || map.member;
    return (
      <span className={`text-xs px-2 py-0.5 rounded-full flex items-center gap-1 ${s.color}`}>
        {s.icon} {role === 'owner' ? t.orgRoleOwner : role === 'admin' ? t.orgRoleAdmin : role === 'viewer' ? t.orgRoleViewer : t.orgRoleMember}
      </span>
    );
  };

  return (
    <div className="space-y-6 p-6">
      <div className="lumi-panel flex items-center justify-between gap-4 p-5">
        <div>
          <h2 className="flex items-center gap-2 text-xl font-black uppercase tracking-[0.08em] text-white/90">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-green-300/15 bg-green-400/10 text-green-300">
              <Users size={24} />
            </span>
            {t.orgMembers}
        </h2>
          <p className="mt-1 text-sm text-white/40">{ui(`${members.length} 位成员`, `${members.length} member(s)`)}</p>
        </div>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-300">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />
          <span>{error}</span>
        </div>
      )}
      {success && (
        <div className="flex items-start gap-2 rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-300">
          <CheckCircle size={16} className="mt-0.5 shrink-0" />
          <span>{success}</span>
        </div>
      )}

      {/* Invite */}
      <div className="lumi-panel flex items-end gap-3 p-4">
        <div className="flex-1">
          <label className="text-white/55 text-xs mb-1 block">{ui('按用户 ID 邀请', 'Invite User by ID')}</label>
          <input
            value={inviteUserId}
            onChange={e => setInviteUserId(e.target.value)}
            placeholder={ui('用户 ID...', 'User ID...')}
            className="lumi-field h-10 w-full rounded-lg text-sm"
          />
        </div>
        <div>
          <label className="text-white/55 text-xs mb-1 block">{ui('角色', 'Role')}</label>
          <select
            value={inviteRole}
            onChange={e => setInviteRole(e.target.value)}
            className="lumi-field h-10 rounded-lg text-sm text-white/70"
          >
            <option value="member">{t.orgRoleMember}</option>
            <option value="admin">{t.orgRoleAdmin}</option>
            <option value="viewer">{t.orgRoleViewer}</option>
          </select>
        </div>
        <button
          onClick={handleInvite}
          disabled={inviting || !inviteUserId.trim()}
          className="lumi-button-primary h-10 border-green-400/25 bg-green-500/15 text-green-200 hover:bg-green-500/25"
        >
          {inviting ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />}
          {ui('添加', 'Add')}
        </button>
      </div>

      {/* Members list */}
      {loading ? (
        <div className="lumi-panel py-12 text-center text-white/55"><Loader2 size={24} className="mx-auto animate-spin" /></div>
      ) : members.length === 0 ? (
        <div className="lumi-panel py-12 text-center text-sm text-white/35">
          {ui('暂无成员。可以通过用户 ID 添加成员。', 'No members yet. Add members by user ID.')}
        </div>
      ) : (
        <div className="space-y-2">
          {members.map(member => (
            <motion.div
              key={member.id}
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="lumi-panel flex items-center justify-between p-4 transition-colors hover:border-white/15 hover:bg-white/[0.07]"
            >
              <div className="flex items-center gap-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/[0.08] bg-white/10">
                  <User size={16} className="text-white/60" />
                </div>
                <div>
                  <p className="text-white text-sm font-medium">{member.userId}</p>
                  <p className="text-white/55 text-xs">
                    {member.joinedAt ? ui(`加入于 ${new Date(member.joinedAt).toLocaleDateString('zh-CN')}`, `Joined ${new Date(member.joinedAt).toLocaleDateString()}`) : ui('待加入', 'Pending')}
                    {member.status !== 'active' && <span className="text-amber-400 ml-2">{member.status}</span>}
                  </p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                {roleBadge(member.role)}
                {member.role !== 'owner' && (
                  <button
                    onClick={() => handleRemove(member.userId)}
                    className="p-1.5 rounded-lg hover:bg-red-500/10 text-white/45 hover:text-red-400 transition-colors"
                    title={ui('移除成员', 'Remove member')}
                  >
                    <UserMinus size={14} />
                  </button>
                )}
              </div>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
