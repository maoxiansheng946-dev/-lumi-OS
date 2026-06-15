import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  Cpu,
  Database,
  HardDrive,
  Loader2,
  Mic,
  Monitor,
  RefreshCw,
  Shield,
  Sparkles,
  Wrench,
  XCircle,
} from 'lucide-react';
import { toast } from 'sonner';
import { usePlatform } from '@/hooks/usePlatform';

interface DiskInfo {
  name: string;
  totalGB: number;
  freeGB: number;
  fsType?: string;
}

interface SystemSnapshot {
  id?: string;
  timestamp?: string;
  type?: 'first_boot' | 'daily_scan';
  hardware?: {
    platform?: string;
    arch?: string;
    hostname?: string;
    cpus?: { model?: string; cores?: number; threads?: number };
    totalMemoryGB?: number;
    gpus?: string[];
    disks?: DiskInfo[];
  };
  software?: {
    osVersion?: string;
    installedApps?: string[];
    startupPrograms?: string[];
    nodeVersion?: string;
    pythonVersion?: string;
    runningServices?: string[];
  };
  filesystem?: {
    homeDir?: string;
    desktopFiles?: number;
    documentsFiles?: number;
    downloadsFiles?: number;
    totalUserFiles?: number;
    largeDirs?: { path: string; sizeMB: number }[];
  };
  network?: {
    hostname?: string;
    interfaces?: string[];
    ipAddresses?: string[];
  };
  changeSummary?: string;
}

interface ProfessionProfile {
  profession: string;
  confidence?: number | string;
  score?: number;
}

interface EcosystemStats {
  skillCount?: number;
  enabledSkillCount?: number;
  connectedSkillCount?: number;
  toolCount?: number;
  agentCount?: number;
}

interface ProviderStatus {
  available: boolean;
  model?: string;
}

type PermissionStateValue = 'granted' | 'denied' | 'prompt' | 'unknown' | 'available' | 'unavailable';

interface AdaptationReport {
  status: 'ready' | 'partial' | 'needs_setup';
  readyCount: number;
  totalCount: number;
  capabilities: CapabilityItem[];
  suggestions: SetupSuggestion[];
}

interface CapabilityItem {
  id: string;
  label: string;
  status: 'ready' | 'partial' | 'missing';
  detail: string;
  actionLabel?: string;
  actionSection?: string;
}

interface SetupSuggestion {
  id: string;
  text: string;
  actionLabel?: string;
  actionSection?: string;
  priority: 'high' | 'medium' | 'low';
}

const COMMON_APP_MATCHERS = [
  { id: 'browser', label: 'Browser', patterns: [/chrome/i, /edge/i, /firefox/i, /brave/i] },
  { id: 'vscode', label: 'VS Code', patterns: [/visual studio code/i, /\bvs code\b/i] },
  { id: 'git', label: 'Git', patterns: [/\bgit\b/i] },
  { id: 'node', label: 'Node.js', patterns: [/node\.js/i] },
  { id: 'python', label: 'Python', patterns: [/python/i] },
  { id: 'wps', label: 'WPS / Office', patterns: [/wps/i, /microsoft office/i, /word/i, /powerpoint/i, /excel/i] },
  { id: 'wechat', label: 'WeChat', patterns: [/wechat/i, /weixin/i, /wechat work/i] },
  { id: 'netease', label: 'NetEase Music', patterns: [/netease/i, /cloud music/i, /music\.163/i] },
];

function percent(value: number) {
  return `${Math.round(value * 100)}%`;
}

function formatTime(value?: string) {
  if (!value) return 'Never';
  try { return new Date(value).toLocaleString(); } catch { return value; }
}

function statusColor(status: CapabilityItem['status'] | AdaptationReport['status']) {
  if (status === 'ready') return 'text-emerald-300 bg-emerald-400/10 border-emerald-400/20';
  if (status === 'partial') return 'text-amber-300 bg-amber-400/10 border-amber-400/20';
  return 'text-red-300 bg-red-400/10 border-red-400/20';
}

function StatusIcon({ status }: { status: CapabilityItem['status'] }) {
  if (status === 'ready') return <CheckCircle2 size={16} className="text-emerald-300" />;
  if (status === 'partial') return <AlertCircle size={16} className="text-amber-300" />;
  return <XCircle size={16} className="text-red-300" />;
}

function isAppDetected(apps: string[], matcher: (typeof COMMON_APP_MATCHERS)[number]) {
  return apps.some(app => matcher.patterns.some(pattern => pattern.test(app)));
}

function getPermissionLabel(value?: PermissionStateValue) {
  if (!value || value === 'unknown') return 'Unknown';
  if (value === 'granted') return 'Granted';
  if (value === 'denied') return 'Denied';
  if (value === 'prompt') return 'Not requested';
  if (value === 'available') return 'Available';
  return 'Unavailable';
}

function buildReport(
  latest: SystemSnapshot | null,
  permissions: Record<string, PermissionStateValue>,
  ecosystem: EcosystemStats | null,
  providers: Record<string, ProviderStatus>,
  isDesktop: boolean,
): AdaptationReport {
  const apps = latest?.software?.installedApps || [];
  const detectedApps = COMMON_APP_MATCHERS.filter(item => isAppDetected(apps, item));
  const llmReady = Object.values(providers).filter(p => p.available).length;
  const nodeReady = Boolean(latest?.software?.nodeVersion) || detectedApps.some(a => a.id === 'node');
  const pythonReady = Boolean(latest?.software?.pythonVersion) || detectedApps.some(a => a.id === 'python');
  const hasOffice = detectedApps.some(a => a.id === 'wps');
  const hasComms = detectedApps.some(a => a.id === 'wechat');
  const hasMusic = detectedApps.some(a => a.id === 'netease');

  const capabilities: CapabilityItem[] = [
    {
      id: 'desktop_shell',
      label: 'Desktop shell',
      status: isDesktop ? 'ready' : 'missing',
      detail: isDesktop ? 'Native desktop automation bridge is available.' : 'Desktop automation requires the Tauri client.',
    },
    {
      id: 'local_runtime',
      label: 'Local runtime',
      status: nodeReady && pythonReady ? 'ready' : nodeReady || pythonReady ? 'partial' : 'missing',
      detail: `Node ${latest?.software?.nodeVersion || 'not detected'} / Python ${latest?.software?.pythonVersion || 'not detected'}`,
      actionLabel: nodeReady && pythonReady ? undefined : 'Review MCP',
      actionSection: nodeReady && pythonReady ? undefined : 'mcp',
    },
    {
      id: 'llm',
      label: 'AI providers',
      status: llmReady > 0 ? 'ready' : 'partial',
      detail: llmReady > 0 ? `${llmReady} provider(s) configured.` : 'No provider key detected yet.',
      actionLabel: llmReady > 0 ? undefined : 'Add provider',
      actionSection: llmReady > 0 ? undefined : 'llm-providers',
    },
    {
      id: 'mcp',
      label: 'MCP and skills',
      status: (ecosystem?.enabledSkillCount || 0) > 0 ? 'ready' : (ecosystem?.skillCount || 0) > 0 ? 'partial' : 'missing',
      detail: `${ecosystem?.enabledSkillCount || 0}/${ecosystem?.skillCount || 0} skills enabled, ${ecosystem?.toolCount || 0} tools registered.`,
      actionLabel: (ecosystem?.enabledSkillCount || 0) > 0 ? undefined : 'Open MCP',
      actionSection: (ecosystem?.enabledSkillCount || 0) > 0 ? undefined : 'mcp',
    },
    {
      id: 'files',
      label: 'Files workspace',
      status: latest?.filesystem?.homeDir ? 'ready' : 'partial',
      detail: latest?.filesystem?.homeDir ? `Home detected: ${latest.filesystem.homeDir}` : 'Home directory not reported yet.',
    },
    {
      id: 'sensors',
      label: 'Mic and camera',
      status: permissions.microphone === 'granted' || permissions.camera === 'granted'
        ? 'ready'
        : permissions.microphone === 'denied' || permissions.camera === 'denied'
          ? 'missing'
          : 'partial',
      detail: `Mic ${getPermissionLabel(permissions.microphone)}, Camera ${getPermissionLabel(permissions.camera)}`,
      actionLabel: permissions.microphone === 'granted' && permissions.camera === 'granted' ? undefined : 'Open hardware',
      actionSection: permissions.microphone === 'granted' && permissions.camera === 'granted' ? undefined : 'hardware',
    },
    {
      id: 'office',
      label: 'Office and documents',
      status: hasOffice ? 'ready' : 'partial',
      detail: hasOffice ? 'Office/WPS app detected.' : 'No WPS/Office app detected in the latest scan.',
    },
    {
      id: 'messaging',
      label: 'Messaging apps',
      status: hasComms ? 'ready' : 'partial',
      detail: hasComms ? 'WeChat/enterprise messaging app detected.' : 'Messaging app not detected yet.',
    },
    {
      id: 'music',
      label: 'Music workflow',
      status: hasMusic ? 'ready' : 'partial',
      detail: hasMusic ? 'NetEase/Cloud Music app detected.' : 'Music app not detected; Lumi music mode can still use configured services.',
    },
  ];

  const readyCount = capabilities.filter(c => c.status === 'ready').length;
  const partialCount = capabilities.filter(c => c.status === 'partial').length;
  const totalCount = capabilities.length;
  const status: AdaptationReport['status'] =
    readyCount >= totalCount - 1 ? 'ready' :
    readyCount + partialCount >= Math.ceil(totalCount * 0.7) ? 'partial' :
    'needs_setup';

  const suggestions: SetupSuggestion[] = [];
  if (!isDesktop) suggestions.push({
    id: 'desktop',
    text: 'Install or launch the desktop client to enable native file and desktop control.',
    priority: 'high',
  });
  if (!nodeReady) suggestions.push({
    id: 'node',
    text: 'Install Node.js if you want local MCP tools and generated skills to run smoothly.',
    actionLabel: 'Open MCP',
    actionSection: 'mcp',
    priority: 'medium',
  });
  if (!pythonReady) suggestions.push({
    id: 'python',
    text: 'Install Python if you want document, image, video, or automation skills that depend on Python.',
    actionLabel: 'Open MCP',
    actionSection: 'mcp',
    priority: 'medium',
  });
  if (llmReady === 0) suggestions.push({
    id: 'llm',
    text: 'Add at least one API key in Settings > LLM Providers.',
    actionLabel: 'Add provider',
    actionSection: 'llm-providers',
    priority: 'high',
  });
  if ((ecosystem?.enabledSkillCount || 0) === 0) suggestions.push({
    id: 'mcp',
    text: 'Enable at least one MCP skill from Skill Center or MCP Settings.',
    actionLabel: 'Open MCP',
    actionSection: 'mcp',
    priority: 'medium',
  });
  if (permissions.microphone !== 'granted') suggestions.push({
    id: 'microphone',
    text: 'Grant microphone access when you want voice, meetings, wake word, or voiceprint.',
    actionLabel: 'Open hardware',
    actionSection: 'hardware',
    priority: 'medium',
  });
  if (permissions.camera !== 'granted') suggestions.push({
    id: 'camera',
    text: 'Grant camera access only when you want presence, face recognition, or gesture features.',
    actionLabel: 'Open hardware',
    actionSection: 'hardware',
    priority: 'low',
  });
  if (!hasOffice) suggestions.push({
    id: 'office',
    text: 'Install or connect your preferred document suite if Lumi should operate Office/WPS workflows.',
    priority: 'low',
  });

  return { status, readyCount, totalCount, capabilities, suggestions };
}

export function SystemExplorer({ t, onSectionChange }: { t?: any; onSectionChange?: (section: string) => void }) {
  const { isDesktop, isTauri } = usePlatform();
  const [latest, setLatest] = useState<SystemSnapshot | null>(null);
  const [history, setHistory] = useState<SystemSnapshot[]>([]);
  const [profiles, setProfiles] = useState<ProfessionProfile[]>([]);
  const [ecosystem, setEcosystem] = useState<EcosystemStats | null>(null);
  const [providers, setProviders] = useState<Record<string, ProviderStatus>>({});
  const [permissions, setPermissions] = useState<Record<string, PermissionStateValue>>({});
  const [loading, setLoading] = useState(true);
  const [scanning, setScanning] = useState(false);

  const readPermission = useCallback(async (name: string): Promise<PermissionStateValue> => {
    try {
      if (!navigator.permissions?.query) return 'unknown';
      const status = await navigator.permissions.query({ name } as any);
      return (status.state || 'unknown') as PermissionStateValue;
    } catch {
      return 'unknown';
    }
  }, []);

  const loadPermissions = useCallback(async () => {
    const [microphone, camera, notifications] = await Promise.all([
      readPermission('microphone'),
      readPermission('camera'),
      readPermission('notifications'),
    ]);
    setPermissions({
      microphone,
      camera,
      notifications,
      nativeFiles: isTauri ? 'available' : 'unavailable',
      desktopAutomation: isTauri ? 'available' : 'unavailable',
    });
  }, [isTauri, readPermission]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try {
      const [statusRes, historyRes, profRes, ecoRes, providerRes] = await Promise.all([
        fetch('/api/explore/status', { credentials: 'include' }),
        fetch('/api/explore/history', { credentials: 'include' }),
        fetch('/api/explore/profession', { credentials: 'include' }),
        fetch('/api/ecosystem/stats', { credentials: 'include' }),
        fetch('/api/llm/providers', { credentials: 'include' }),
        loadPermissions(),
      ]);
      const status = await statusRes.json().catch(() => ({}));
      const historyData = await historyRes.json().catch(() => ({}));
      const professionData = await profRes.json().catch(() => ({}));
      const ecosystemData = await ecoRes.json().catch(() => ({}));
      const providerData = await providerRes.json().catch(() => ({}));
      setLatest(status.latest || null);
      setHistory(historyData.snapshots || []);
      setProfiles(professionData.profiles || []);
      setEcosystem(ecosystemData || null);
      setProviders(providerData.providers || {});
    } catch (err: any) {
      toast.error(err?.message || 'Failed to load adaptation report');
    } finally {
      setLoading(false);
    }
  }, [loadPermissions]);

  useEffect(() => {
    void loadAll();
  }, [loadAll]);

  const runScan = async () => {
    setScanning(true);
    try {
      const res = await fetch('/api/explore/scan', { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Computer scan failed');
      if (data.snapshot) {
        setLatest(data.snapshot);
        setHistory(prev => [data.snapshot, ...prev.filter(item => item.id !== data.snapshot.id)]);
      }
      toast.success('Computer adaptation report refreshed');
    } catch (err: any) {
      toast.error(err?.message || 'Computer scan failed');
    } finally {
      setScanning(false);
    }
  };

  const installProfessionAgents = async () => {
    try {
      const res = await fetch('/api/explore/profession/install', { method: 'POST', credentials: 'include' });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Failed to install profession agents');
      setProfiles(data.profiles || profiles);
      toast.success(`Installed ${data.installed || 0} profession agent(s)`);
    } catch (err: any) {
      toast.error(err?.message || 'Failed to install profession agents');
    }
  };

  const report = useMemo(
    () => buildReport(latest, permissions, ecosystem, providers, isDesktop),
    [ecosystem, isDesktop, latest, permissions, providers],
  );

  const apps = latest?.software?.installedApps || [];
  const detectedAppGroups = COMMON_APP_MATCHERS
    .map(item => ({
      ...item,
      matches: apps.filter(app => item.patterns.some(pattern => pattern.test(app))).slice(0, 4),
    }))
    .filter(item => item.matches.length > 0);

  const copyReport = async () => {
    const lines = [
      '# Lumi Computer Adaptation Report',
      '',
      `Status: ${report.status}`,
      `Score: ${report.readyCount}/${report.totalCount} ready`,
      `Host: ${latest?.hardware?.hostname || latest?.network?.hostname || 'Unknown'}`,
      `OS: ${latest?.software?.osVersion || latest?.hardware?.platform || 'Unknown'}`,
      `CPU: ${latest?.hardware?.cpus?.model || 'Unknown'}`,
      `Memory: ${latest?.hardware?.totalMemoryGB || 'Unknown'} GB`,
      `Last scan: ${formatTime(latest?.timestamp)}`,
      '',
      '## Capabilities',
      ...report.capabilities.map(item => `- ${item.label}: ${item.status} — ${item.detail}`),
      '',
      '## Suggestions',
      ...(report.suggestions.length > 0 ? report.suggestions.map(item => `- [${item.priority}] ${item.text}`) : ['- No setup suggestions.']),
    ];
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      toast.success('Adaptation report copied');
    } catch (err: any) {
      toast.error(err?.message || 'Failed to copy report');
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-[420px] items-center justify-center text-white/45">
        <Loader2 size={18} className="mr-2 animate-spin" />
        Loading computer adaptation report...
      </div>
    );
  }

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Monitor size={20} className="text-cyan-300" />
            <h3 className="text-xl font-bold uppercase tracking-normal text-white/90">
              {t?.computerAdaptation || 'Computer Adaptation'}
            </h3>
          </div>
          <p className="mt-2 max-w-2xl text-sm leading-relaxed text-white/45">
            Lumi checks this computer's runtime, permissions, common apps, MCP tools, and workspace state. It does not index the full disk or request sensor access from this page.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={copyReport}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] px-4 text-xs font-black uppercase tracking-widest text-white/55 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <Copy size={14} />
            Copy Report
          </button>
          <button
            onClick={runScan}
            disabled={scanning}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-cyan-300/25 bg-cyan-300/10 px-4 text-xs font-black uppercase tracking-widest text-cyan-100 transition-colors hover:bg-cyan-300/16 disabled:opacity-40"
          >
            <RefreshCw size={14} className={scanning ? 'animate-spin' : ''} />
            {scanning ? 'Scanning' : 'Refresh Report'}
          </button>
        </div>
      </div>

      <section className={`rounded-2xl border p-5 ${statusColor(report.status)}`}>
        <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-xs font-black uppercase tracking-[0.18em] opacity-70">Adaptation Score</div>
            <div className="mt-1 text-3xl font-black text-white">
              {report.readyCount}/{report.totalCount} ready
            </div>
          </div>
          <div className="text-sm leading-relaxed text-white/65 md:max-w-md">
            {report.status === 'ready'
              ? 'Lumi has a strong map of this computer and can route most desktop workflows safely.'
              : report.status === 'partial'
                ? 'Lumi can work here, but a few permissions or local tools would make the client smoother.'
                : 'Lumi needs a few setup steps before this computer feels fully adapted.'}
          </div>
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <InfoPanel
          icon={<Cpu size={17} />}
          title="System"
          rows={[
            ['Host', latest?.hardware?.hostname || latest?.network?.hostname || 'Unknown'],
            ['OS', latest?.software?.osVersion || `${latest?.hardware?.platform || 'unknown'} ${latest?.hardware?.arch || ''}`],
            ['CPU', latest?.hardware?.cpus?.model || 'Unknown'],
            ['Memory', latest?.hardware?.totalMemoryGB ? `${latest.hardware.totalMemoryGB} GB` : 'Unknown'],
          ]}
        />
        <InfoPanel
          icon={<HardDrive size={17} />}
          title="Storage"
          rows={[
            ['Home', latest?.filesystem?.homeDir || 'Unknown'],
            ['Desktop items', String(latest?.filesystem?.desktopFiles ?? 'Unknown')],
            ['Documents items', String(latest?.filesystem?.documentsFiles ?? 'Unknown')],
            ['Downloads items', String(latest?.filesystem?.downloadsFiles ?? 'Unknown')],
          ]}
        />
        <InfoPanel
          icon={<Database size={17} />}
          title="Lumi Runtime"
          rows={[
            ['Skills', `${ecosystem?.enabledSkillCount || 0}/${ecosystem?.skillCount || 0} enabled`],
            ['Tools', String(ecosystem?.toolCount || 0)],
            ['Agents', String(ecosystem?.agentCount || 0)],
            ['Last scan', formatTime(latest?.timestamp)],
          ]}
        />
      </div>

      <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
        <div className="mb-4 flex items-center gap-2">
          <Shield size={17} className="text-white/55" />
          <h4 className="text-sm font-black uppercase tracking-widest text-white/70">Capability Map</h4>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {report.capabilities.map(item => (
            <div key={item.id} className="rounded-xl border border-white/8 bg-black/20 p-4">
              <div className="flex items-start gap-3">
                <StatusIcon status={item.status} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-white/82">{item.label}</div>
                  <div className="mt-1 text-xs leading-relaxed text-white/42">{item.detail}</div>
                </div>
                {item.actionSection && onSectionChange && (
                  <button
                    onClick={() => onSectionChange(item.actionSection!)}
                    className="shrink-0 rounded-lg border border-white/10 bg-white/[0.04] px-2.5 py-1.5 text-[10px] font-black uppercase tracking-widest text-white/45 hover:bg-white/[0.08] hover:text-white"
                  >
                    {item.actionLabel || 'Open'}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
          <div className="mb-4 flex items-center gap-2">
            <Wrench size={17} className="text-white/55" />
            <h4 className="text-sm font-black uppercase tracking-widest text-white/70">Detected Apps</h4>
          </div>
          {detectedAppGroups.length > 0 ? (
            <div className="space-y-3">
              {detectedAppGroups.map(group => (
                <div key={group.id} className="rounded-xl bg-black/18 px-3 py-2">
                  <div className="text-xs font-black uppercase tracking-widest text-white/55">{group.label}</div>
                  <div className="mt-1 text-xs leading-relaxed text-white/38">
                    {group.matches.join(' · ')}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-sm text-white/40">No common apps were matched in the latest scan.</p>
          )}
          <div className="mt-4 text-xs text-white/30">
            Latest scan saw {apps.length} installed app entries.
          </div>
        </section>

        <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
          <div className="mb-4 flex items-center gap-2">
            <Mic size={17} className="text-white/55" />
            <h4 className="text-sm font-black uppercase tracking-widest text-white/70">Permissions</h4>
          </div>
          <div className="space-y-2">
            {Object.entries(permissions).map(([key, value]) => (
              <div key={key} className="flex items-center justify-between rounded-xl bg-black/18 px-3 py-2 text-xs">
                <span className="font-bold capitalize text-white/55">{key.replace(/([A-Z])/g, ' $1')}</span>
                <span className="text-white/40">{getPermissionLabel(value)}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {profiles.length > 0 && (
        <section className="rounded-2xl border border-amber-300/12 bg-amber-300/[0.04] p-5">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <div className="flex items-center gap-2">
                <Sparkles size={17} className="text-amber-200" />
                <h4 className="text-sm font-black uppercase tracking-widest text-white/75">Work Profile</h4>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                {profiles.map(profile => {
                  const confidence = Number(profile.confidence ?? profile.score ?? 0);
                  return (
                    <span key={profile.profession} className="rounded-full border border-amber-300/16 bg-amber-300/8 px-3 py-1 text-xs font-bold text-amber-100/80">
                      {profile.profession} {confidence ? percent(confidence) : ''}
                    </span>
                  );
                })}
              </div>
            </div>
            <button
              onClick={installProfessionAgents}
              className="h-10 rounded-xl border border-amber-300/25 bg-amber-300/10 px-4 text-xs font-black uppercase tracking-widest text-amber-100 transition-colors hover:bg-amber-300/16"
            >
              Install Agents
            </button>
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
        <div className="mb-4 text-sm font-black uppercase tracking-widest text-white/70">Ready Workflows</div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          <WorkflowTile
            title="Local files"
            detail={latest?.filesystem?.homeDir ? 'Browse home, desktop, documents, and downloads from the Files workspace.' : 'File workspace needs a fresh scan.'}
            ready={Boolean(latest?.filesystem?.homeDir)}
          />
          <WorkflowTile
            title="Voice and meetings"
            detail={permissions.microphone === 'granted' ? 'Meeting mode and speech interaction can use the microphone.' : 'Grant microphone only when you want voice or meetings.'}
            ready={permissions.microphone === 'granted'}
          />
          <WorkflowTile
            title="Generated skills"
            detail={(ecosystem?.enabledSkillCount || 0) > 0 ? 'MCP skills are enabled and visible to Lumi.' : 'Enable MCP skills before relying on generated tool workflows.'}
            ready={(ecosystem?.enabledSkillCount || 0) > 0}
          />
          <WorkflowTile
            title="Document work"
            detail={detectedAppGroups.some(group => group.id === 'wps') ? 'Office/WPS workflow is likely available.' : 'No Office/WPS app was detected in the latest scan.'}
            ready={detectedAppGroups.some(group => group.id === 'wps')}
          />
          <WorkflowTile
            title="Developer work"
            detail={detectedAppGroups.some(group => group.id === 'vscode' || group.id === 'git') ? 'Developer tools were detected.' : 'Install VS Code/Git/Node for stronger local dev workflows.'}
            ready={detectedAppGroups.some(group => group.id === 'vscode' || group.id === 'git')}
          />
          <WorkflowTile
            title="Music mode"
            detail={detectedAppGroups.some(group => group.id === 'netease') ? 'Music app detected; Lumi music mode can coordinate playback.' : 'Music mode can still work through configured music services.'}
            ready={detectedAppGroups.some(group => group.id === 'netease')}
          />
        </div>
      </section>

      <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
        <div className="mb-4 text-sm font-black uppercase tracking-widest text-white/70">Recommended Setup</div>
        {report.suggestions.length > 0 ? (
          <div className="space-y-2">
            {report.suggestions.map(item => (
              <div key={item.id} className="flex flex-col gap-3 rounded-xl bg-black/18 px-3 py-3 text-sm leading-relaxed text-white/52 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex gap-3">
                  <AlertCircle size={15} className={`mt-0.5 shrink-0 ${
                    item.priority === 'high' ? 'text-red-200/75' : item.priority === 'medium' ? 'text-amber-200/75' : 'text-cyan-200/70'
                  }`} />
                  <span>{item.text}</span>
                </div>
                {item.actionSection && onSectionChange && (
                  <button
                    onClick={() => onSectionChange(item.actionSection!)}
                    className="shrink-0 self-start rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-[10px] font-black uppercase tracking-widest text-white/45 hover:bg-white/[0.08] hover:text-white sm:self-center"
                  >
                    {item.actionLabel || 'Open'}
                  </button>
                )}
              </div>
            ))}
          </div>
        ) : (
          <div className="flex gap-3 rounded-xl bg-emerald-300/8 px-3 py-2 text-sm text-emerald-100/70">
            <CheckCircle2 size={15} />
            This computer looks ready for Lumi desktop workflows.
          </div>
        )}
      </section>

      {latest?.hardware?.disks && latest.hardware.disks.length > 0 && (
        <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
          <div className="mb-4 text-sm font-black uppercase tracking-widest text-white/70">Disks</div>
          <div className="space-y-2">
            {latest.hardware.disks.map(disk => (
              <div key={disk.name} className="rounded-xl bg-black/18 p-3">
                <div className="flex items-center justify-between text-xs text-white/52">
                  <span className="font-bold">{disk.name}</span>
                  <span>{disk.freeGB} GB free / {disk.totalGB} GB</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                  <div
                    className="h-full rounded-full bg-cyan-300/65"
                    style={{ width: `${Math.max(4, Math.min(100, ((disk.totalGB - disk.freeGB) / Math.max(1, disk.totalGB)) * 100))}%` }}
                  />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {history.length > 0 && (
        <div className="text-xs text-white/30">
          Scan history: {history.length} snapshot(s). Latest type: {latest?.type || 'unknown'}.
        </div>
      )}
    </div>
  );
}

function WorkflowTile({ title, detail, ready }: { title: string; detail: string; ready: boolean }) {
  return (
    <div className="rounded-xl border border-white/8 bg-black/20 p-4">
      <div className="flex items-center gap-2">
        {ready ? <CheckCircle2 size={16} className="text-emerald-300" /> : <AlertCircle size={16} className="text-amber-300" />}
        <div className="text-sm font-bold text-white/78">{title}</div>
      </div>
      <div className="mt-2 text-xs leading-relaxed text-white/38">{detail}</div>
    </div>
  );
}

function InfoPanel({ icon, title, rows }: { icon: React.ReactNode; title: string; rows: Array<[string, string]> }) {
  return (
    <section className="rounded-2xl border border-white/8 bg-white/[0.03] p-5">
      <div className="mb-4 flex items-center gap-2">
        <span className="text-white/55">{icon}</span>
        <h4 className="text-sm font-black uppercase tracking-widest text-white/70">{title}</h4>
      </div>
      <div className="space-y-2">
        {rows.map(([label, value]) => (
          <div key={label} className="flex items-start justify-between gap-3 text-xs">
            <span className="shrink-0 text-white/35">{label}</span>
            <span className="min-w-0 truncate text-right font-mono text-white/58" title={value}>{value}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
