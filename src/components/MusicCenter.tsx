import { useState, useEffect, useRef } from 'react';

export function MusicCenter({ isOpen, onClose }: { isOpen: boolean; onClose: () => void }) {
  const [qrImgSrc, setQrImgSrc] = useState<string | null>(null);
  const [loginDone, setLoginDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [appId, setAppId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch('/api/ncm/configure/status').then(r => r.json()).then(s => {
      setConfigured(s.configured);
    }).catch(() => setConfigured(false));
    fetch('/api/ncm/login/status').then(r => r.json()).then(s => {
      if (s.done) setLoginDone(true);
    }).catch(() => {});
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, []);

  const saveCreds = async () => {
    if (!appId.trim() || !privateKey.trim()) return;
    setCfgBusy(true);
    setCfgMsg('');
    try {
      const res = await fetch('/api/ncm/configure', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appId: appId.trim(), privateKey: privateKey.trim() }),
      });
      const data = await res.json();
      if (data.success) {
        setConfigured(true);
        setCfgMsg('凭据已保存');
      } else {
        setCfgMsg(data.error || '保存失败');
      }
    } catch (e: any) {
      setCfgMsg(e.message || '请求失败');
    } finally {
      setCfgBusy(false);
    }
  };

  const startLogin = async () => {
    setLoading(true);
    setQrImgSrc(null);
    try {
      const res = await fetch('/api/ncm/login', { method: 'POST' });
      const data = await res.json();
      if (!data.qrUrl) throw new Error('No QR URL');

      setQrImgSrc(`https://quickchart.io/qr?text=${encodeURIComponent(data.qrUrl)}&size=220`);

      const interval = setInterval(async () => {
        try {
          const sr = await fetch('/api/ncm/login/status');
          const ss = await sr.json();
          if (ss.done) {
            setLoginDone(true);
            setQrImgSrc(null);
            clearInterval(interval);
          }
        } catch {}
      }, 2000);
      pollRef.current = interval;
    } catch (e: any) {
      alert('Failed: ' + (e.message || String(e)));
    } finally {
      setLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="flex flex-col items-center justify-center h-full gap-6">
      {/* API凭据配置 */}
      <div className="w-full rounded-2xl bg-white/[0.02] border border-white/5 p-5 flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">API Credentials</span>
          {configured && <span className="text-[9px] text-emerald-400 font-mono bg-emerald-400/10 px-2 py-0.5 rounded-full">OK</span>}
        </div>
        <p className="text-[10px] text-white/25 leading-relaxed">
          前往 developer.music.163.com 入驻获取 App ID 和 Private Key
        </p>
        <input
          type="text" placeholder="App ID"
          value={appId} onChange={e => setAppId(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white/70 placeholder:text-white/15 outline-none focus:border-red-500/40"
        />
        <input
          type="password" placeholder="Private Key"
          value={privateKey} onChange={e => setPrivateKey(e.target.value)}
          className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white/70 placeholder:text-white/15 outline-none focus:border-red-500/40"
        />
        <button
          onClick={saveCreds} disabled={cfgBusy || !appId.trim() || !privateKey.trim()}
          className="w-full py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white/50 text-xs hover:bg-white/[0.08] transition-all disabled:opacity-20"
        >
          {cfgBusy ? '保存中...' : '保存凭据'}
        </button>
        {cfgMsg && <p className="text-[10px] text-center text-white/30">{cfgMsg}</p>}
      </div>

      {/* 扫码登录 */}
      <div className="w-full rounded-2xl bg-white/[0.02] border border-white/5 p-5 flex flex-col items-center gap-4">
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-bold uppercase tracking-widest text-white/30">NetEase Cloud</span>
          {loginDone && (
            <span className="text-[9px] text-emerald-400 font-mono bg-emerald-400/10 px-2 py-0.5 rounded-full">CONNECTED</span>
          )}
        </div>

        <p className="text-[11px] text-white/35 text-center leading-relaxed">
          登录网易云账号后可播放 VIP 歌曲。只需扫码一次。
        </p>

        {qrImgSrc && (
          <img src={qrImgSrc} alt="QR Code" className="w-44 h-44 rounded-xl bg-white" />
        )}

        <button
          onClick={startLogin}
          disabled={loading}
          className="w-full py-2.5 rounded-xl bg-red-500/15 border border-red-500/25 text-red-400 text-sm font-medium hover:bg-red-500/25 transition-all disabled:opacity-30"
        >
          {loading ? '获取中...' : loginDone ? '已连接' : '扫码登录网易云'}
        </button>
      </div>

      <div className="w-full rounded-2xl bg-white/[0.01] border border-white/[0.03] p-4 text-center">
        <p className="text-[10px] text-white/15 tracking-wider">更多平台即将接入</p>
      </div>
    </div>
  );
}
