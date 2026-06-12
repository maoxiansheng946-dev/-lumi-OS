import React, { useState, useMemo } from 'react';
import {
  Building2, BookOpen, Package, Users, Settings,
  ClipboardCheck, ScrollText, MessageSquare, ArrowLeft,
  Shield, User, Briefcase, Home, Scale,
} from 'lucide-react';
import { BranchDashboard } from './BranchDashboard';
import { KnowledgeBaseBrowser } from './KnowledgeBaseBrowser';
import { KnowledgeBaseEditor } from './KnowledgeBaseEditor';
import { TemplateMarketplace } from './TemplateMarketplace';
import { TemplateCreator } from './TemplateCreator';
import { TemplateReviewQueue } from './TemplateReviewQueue';
import { CentralLumiChat } from './CentralLumiChat';
import { OrgMembers } from './OrgMembers';
import { OrgSettings } from './OrgSettings';
import { AuditLogViewer } from './AuditLogViewer';
import { LegalHub } from './LegalHub';
import { useApp } from '../../contexts/AppContext';
import { useT } from '../../lib/useT';

type SubView = 'dashboard' | 'kb' | 'kb-edit' | 'templates' | 'templates-create' | 'review' | 'chat' | 'members' | 'settings' | 'audit' | 'legal';

interface NavItem {
  id: SubView;
  label: string;
  icon: React.ReactNode;
  roles: Array<'owner' | 'admin' | 'member' | 'viewer'>;
}

export function OrgHub() {
  const [subView, setSubView] = useState<SubView>('dashboard');
  const { workDomain, switchDomain, orgConnection } = useApp();
  const t = useT();

  const allNavItems: NavItem[] = useMemo(() => [
    { id: 'dashboard', label: t.orgDashboard, icon: <Home size={16} />, roles: ['owner', 'admin', 'member', 'viewer'] },
    { id: 'chat', label: t.orgChat, icon: <MessageSquare size={16} />, roles: ['owner', 'admin', 'member', 'viewer'] },
    { id: 'kb', label: t.orgKB, icon: <BookOpen size={16} />, roles: ['owner', 'admin', 'member', 'viewer'] },
    { id: 'templates', label: t.orgTemplates, icon: <Package size={16} />, roles: ['owner', 'admin', 'member', 'viewer'] },
    { id: 'review', label: t.orgReview, icon: <ClipboardCheck size={16} />, roles: ['owner', 'admin'] },
    { id: 'members', label: t.orgMembers, icon: <Users size={16} />, roles: ['owner', 'admin'] },
    { id: 'audit', label: t.orgAudit, icon: <ScrollText size={16} />, roles: ['owner', 'admin'] },
    { id: 'legal', label: t.legalHub || 'Law Firm', icon: <Scale size={16} />, roles: ['owner', 'admin', 'member', 'viewer'] },
    { id: 'settings', label: t.orgSettings, icon: <Settings size={16} />, roles: ['owner', 'admin'] },
  ], [t]);

  const roleLabel: Record<string, { label: string; icon: React.ReactNode; color: string }> = useMemo(() => ({
    owner:  { label: t.orgRoleOwner,  icon: <Shield size={10} />, color: 'text-amber-400 bg-amber-500/10' },
    admin:  { label: t.orgRoleAdmin,  icon: <Shield size={10} />, color: 'text-red-400 bg-red-500/10' },
    member: { label: t.orgRoleMember, icon: <User size={10} />,   color: 'text-blue-400 bg-blue-500/10' },
    viewer: { label: t.orgRoleViewer, icon: <User size={10} />,   color: 'text-white/40 bg-white/5' },
  }), [t]);

  React.useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (detail?.tab === 'org' && detail?.sub) {
        setSubView(detail.sub as SubView);
      }
    };
    window.addEventListener('lumi:navigate', handler);
    return () => window.removeEventListener('lumi:navigate', handler);
  }, []);

  const orgRole = orgConnection?.orgRole || 'member';
  const visibleItems = allNavItems.filter(item => item.roles.includes(orgRole as any));
  const roleInfo = roleLabel[orgRole] || roleLabel.member;

  const renderView = () => {
    switch (subView) {
      case 'dashboard': return <BranchDashboard />;
      case 'kb': return <KnowledgeBaseBrowser />;
      case 'kb-edit': return <KnowledgeBaseEditor onSaved={() => setSubView('kb')} />;
      case 'templates': return <TemplateMarketplace />;
      case 'templates-create': return <TemplateCreator />;
      case 'review': return <TemplateReviewQueue />;
      case 'chat': return <CentralLumiChat />;
      case 'members': return <OrgMembers />;
      case 'settings': return <OrgSettings />;
      case 'audit': return <AuditLogViewer />;
      case 'legal': return <LegalHub />;
      default: return <BranchDashboard />;
    }
  };

  return (
    <div className="flex h-full">
      {/* Sidebar */}
      <div className="w-56 border-r border-white/5 bg-white/[0.02] flex flex-col">
        <div className="p-4 border-b border-white/5 space-y-3">
          <h3 className="text-white text-sm font-bold flex items-center gap-2">
            <Building2 size={16} className="text-blue-400" />
            {t.orgWorkSpace}
          </h3>
          {orgConnection?.orgName && (
            <p className="text-white/55 text-xs">{orgConnection.orgName}</p>
          )}
          {/* Role badge */}
          <span className={`text-xs px-2 py-0.5 rounded-full inline-flex items-center gap-1 ${roleInfo.color}`}>
            {roleInfo.icon} {roleInfo.label}
          </span>
          {/* Domain switch */}
          <button
            onClick={() => switchDomain(workDomain === 'personal' ? 'work' : 'personal')}
            className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs transition-all ${
              workDomain === 'work'
                ? 'bg-blue-500/10 text-blue-400 border border-blue-500/30'
                : 'bg-white/5 text-white/40 border border-white/5 hover:text-white/60'
            }`}
          >
            {workDomain === 'work' ? <Briefcase size={12} /> : <User size={12} />}
            {workDomain === 'work' ? t.orgWorkDomain : t.orgPersonalDomain}
          </button>
        </div>

        <nav className="flex-1 p-2 space-y-1">
          {visibleItems.map(item => (
            <button
              key={item.id}
              onClick={() => setSubView(item.id)}
              className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm transition-all ${
                subView === item.id
                  ? 'bg-blue-500/10 text-blue-400'
                  : 'text-white/50 hover:text-white/80 hover:bg-white/5'
              }`}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
          <div className="my-2 border-t border-white/5" />
          <button
            onClick={() => { window.location.href = '/'; }}
            className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-white/40 hover:text-white/60 hover:bg-white/5 transition-all"
          >
            <ArrowLeft size={16} />
            {t.orgExitWorkSpace}
          </button>
        </nav>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {renderView()}
      </div>
    </div>
  );
}
