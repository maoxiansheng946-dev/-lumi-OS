import { useEffect, useRef, useState } from 'react';
import { Maximize2, Pause, Play, Search, SkipBack, SkipForward, Volume2, X } from 'lucide-react';
import { toast } from 'sonner';
import { useMusicPlayer } from '../hooks/useMusicPlayer';
import { useSocket } from '../hooks/useSocket';

function formatTime(seconds: number) {
  if (!Number.isFinite(seconds) || seconds <= 0) return '0:00';
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

export function MusicCenter({ isOpen, onClose, t }: { isOpen: boolean; onClose: () => void; t?: any }) {
  const player = useMusicPlayer();
  const socket = useSocket();
  const [qrImgSrc, setQrImgSrc] = useState<string | null>(null);
  const [loginDone, setLoginDone] = useState(false);
  const [loading, setLoading] = useState(false);
  const [configured, setConfigured] = useState<boolean | null>(null);
  const [appId, setAppId] = useState('');
  const [privateKey, setPrivateKey] = useState('');
  const [cfgBusy, setCfgBusy] = useState(false);
  const [cfgMsg, setCfgMsg] = useState('');
  const [musicPrompt, setMusicPrompt] = useState('');
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const promptInputRef = useRef<HTMLInputElement | null>(null);
  const isZh = t?.langCode !== 'en';
  const ui = (zh: string, en: string) => isZh ? zh : en;

  useEffect(() => {
    fetch('/api/ncm/configure/status').then(r => r.json()).then(s => {
      setConfigured(s.configured);
    }).catch(() => setConfigured(false));
    fetch('/api/ncm/login/status').then(r => r.json()).then(s => {
      if (s.done) setLoginDone(true);
      if (s.qrUrl) setQrImgSrc(`https://quickchart.io/qr?text=${encodeURIComponent(s.qrUrl)}&size=220`);
    }).catch(() => {});
    socket?.emit('music:get_state');
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [socket]);

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
      if (!res.ok || !data.success) throw new Error(data.error || ui('保存凭据失败', 'Failed to save credentials'));
      setConfigured(true);
      setCfgMsg(t?.musicCredentialsSaved || ui('凭据已保存', 'Credentials saved'));
      toast.success(t?.musicCredentialsSaved || ui('凭据已保存', 'Credentials saved'));
    } catch (e: any) {
      const message = e.message || ui('请求失败', 'Request failed');
      setCfgMsg(message);
      toast.error(message);
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
      if (!res.ok || !data.qrUrl) throw new Error(data.error || ui('没有 QR 登录地址', 'No QR URL'));

      setQrImgSrc(`https://quickchart.io/qr?text=${encodeURIComponent(data.qrUrl)}&size=220`);

      const interval = setInterval(async () => {
        try {
          const sr = await fetch('/api/ncm/login/status');
          const ss = await sr.json();
          if (ss.done) {
            setLoginDone(true);
            setQrImgSrc(null);
            clearInterval(interval);
            toast.success(t?.musicConnected || ui('网易云音乐已连接', 'NetEase Cloud connected'));
          }
        } catch {}
      }, 2000);
      pollRef.current = interval;
    } catch (e: any) {
      toast.error(e.message || ui('登录失败', 'Login failed'));
    } finally {
      setLoading(false);
    }
  };

  const askLumiToPlay = () => {
    const text = musicPrompt.trim();
    if (!text) return;
    if (!socket?.connected) {
      toast.error(t?.serverNotConnected || ui('服务器未连接', 'Server is not connected'));
      return;
    }
    socket.emit('agent:chat', {
      text,
      history: [],
      personalityId: 'lumi',
      source: 'music-center',
    });
    toast.info(t?.musicRequestSent || ui('音乐请求已发送给 Lumi', 'Music request sent to Lumi'));
    setMusicPrompt('');
  };

  const toggleMoodLayer = () => {
    if (player.visible) player.hide();
    else if (player.track) player.show();
    else {
      toast.info(t?.musicLayerNeedsTrack || ui('先让 Lumi 播放一首歌，再打开氛围层。', 'Ask Lumi to play music first, then open the mood layer.'));
      promptInputRef.current?.focus();
    }
  };

  if (!isOpen) return null;

  const progressMax = Math.max(1, Math.floor(player.duration || 0));

  return (
    <div className="h-full overflow-y-auto custom-scrollbar p-1">
      <div className="space-y-5">
        <section className="rounded-2xl bg-red-500/[0.04] border border-red-400/10 p-5 space-y-4">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="flex items-center gap-2">
                <span className={`w-2 h-2 rounded-full ${player.isPlaying ? 'bg-emerald-400 animate-pulse' : 'bg-white/25'}`} />
                <h3 className="text-sm font-black text-white/85 uppercase tracking-wider">
                  {t?.musicPlayer || ui('音乐播放器', 'Music Player')}
                </h3>
              </div>
              <p className="mt-1 text-xs text-white/40">
                {player.track ? (t?.musicNowPlaying || ui('正在播放', 'Now playing')) : (t?.musicIdleHint || ui('让 Lumi 播放歌曲、歌单、心情音乐或每日推荐。', 'Ask Lumi to play a song, mood, playlist, or daily recommendation.'))}
              </p>
            </div>
            <button
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl text-white/35 hover:text-white hover:bg-white/10 transition-colors"
              title={t?.close || ui('关闭', 'Close')}
            >
              <X size={16} />
            </button>
          </div>

          <div className="rounded-2xl bg-black/30 border border-white/5 p-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <div className="text-base font-bold text-white/85 truncate">
                  {player.track?.name || t?.musicNoTrack || ui('暂无播放曲目', 'No track loaded')}
                </div>
                <div className="text-xs text-white/40 truncate">
                  {player.track?.artists?.join(' / ') || t?.musicControlHint || ui('语音、聊天和此面板共用同一个播放引擎。', 'Voice, chat, and this panel share the same playback engine.')}
                </div>
              </div>
              <button
                onClick={toggleMoodLayer}
                className={`h-9 px-3 rounded-xl border transition-colors flex items-center gap-2 text-xs font-bold ${
                  player.visible
                    ? 'bg-red-500/20 border-red-400/30 text-red-200'
                    : 'bg-white/5 border-white/10 text-white/50 hover:text-white hover:bg-white/10'
                }`}
                title={player.visible ? (t?.hideMusicLayer || ui('隐藏氛围层', 'Hide mood layer')) : (t?.showMusicLayer || ui('显示氛围层', 'Show mood layer'))}
              >
                <Maximize2 size={14} />
                {player.visible ? (t?.moodLayerOn || ui('氛围层已开', 'Mood layer on')) : (t?.moodLayerOff || ui('氛围层', 'Mood layer'))}
              </button>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <button onClick={player.prev} className="w-9 h-9 rounded-xl bg-white/5 text-white/45 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
                <SkipBack size={16} />
              </button>
              <button
                onClick={player.isPlaying ? player.pause : player.play}
                className="w-11 h-11 rounded-2xl bg-red-500/20 border border-red-400/25 text-red-300 hover:bg-red-500/30 flex items-center justify-center transition-colors"
              >
                {player.isPlaying ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button onClick={player.next} className="w-9 h-9 rounded-xl bg-white/5 text-white/45 hover:text-white hover:bg-white/10 flex items-center justify-center transition-colors">
                <SkipForward size={16} />
              </button>
              <div className="flex-1 min-w-0">
                <input
                  type="range"
                  min={0}
                  max={progressMax}
                  value={Math.min(player.progress || 0, progressMax)}
                  onChange={(e) => player.seek(Number(e.target.value))}
                  className="w-full accent-red-400"
                />
                <div className="flex justify-between text-[10px] text-white/30 font-mono">
                  <span>{formatTime(player.progress || 0)}</span>
                  <span>{formatTime(player.duration || 0)}</span>
                </div>
              </div>
            </div>

            <div className="mt-4 flex items-center gap-3">
              <Volume2 size={15} className="text-white/35" />
              <input
                type="range"
                min={0}
                max={100}
                value={player.volume}
                onChange={(e) => player.setVolume(Number(e.target.value))}
                className="flex-1 accent-red-400"
              />
              <span className="w-9 text-right text-[10px] text-white/35 font-mono">{player.volume}%</span>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex-1 flex items-center gap-2 bg-white/[0.04] border border-white/10 rounded-xl px-3 py-2">
              <Search size={15} className="text-white/30" />
              <input
                ref={promptInputRef}
                value={musicPrompt}
                onChange={(e) => setMusicPrompt(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') askLumiToPlay(); }}
                placeholder={t?.musicPromptPlaceholder || ui('播放周杰伦、每日推荐，或雨天专注音乐...', 'Play Jay Chou, daily recommendations, or rainy focus music...')}
                className="flex-1 bg-transparent outline-none text-xs text-white/80 placeholder:text-white/25"
              />
            </div>
            <button
              onClick={askLumiToPlay}
              disabled={!musicPrompt.trim()}
              className="px-4 py-2 rounded-xl bg-red-500/15 border border-red-400/25 text-xs font-bold text-red-300 hover:bg-red-500/25 disabled:opacity-30 transition-colors"
            >
              {t?.play || ui('播放', 'Play')}
            </button>
          </div>
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-5 flex flex-col gap-3">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">{ui('API 凭据', 'API Credentials')}</span>
              {configured && <span className="text-[9px] text-emerald-400 font-mono bg-emerald-400/10 px-2 py-0.5 rounded-full">OK</span>}
            </div>
            <p className="text-[10px] text-white/35 leading-relaxed">
              {ui('配置网易云音乐开发者 App ID 和 Private Key，用于授权播放。', 'Configure NetEase Cloud Music developer App ID and Private Key for authenticated playback.')}
            </p>
            <input
              type="text" placeholder={ui('App ID', 'App ID')}
              value={appId} onChange={e => setAppId(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white/70 placeholder:text-white/20 outline-none focus:border-red-500/40"
            />
            <input
              type="password" placeholder={ui('Private Key', 'Private Key')}
              value={privateKey} onChange={e => setPrivateKey(e.target.value)}
              className="w-full bg-white/[0.04] border border-white/10 rounded-lg px-3 py-2 text-xs text-white/70 placeholder:text-white/20 outline-none focus:border-red-500/40"
            />
            <button
              onClick={saveCreds} disabled={cfgBusy || !appId.trim() || !privateKey.trim()}
              className="w-full py-2 rounded-lg bg-white/[0.04] border border-white/10 text-white/55 text-xs hover:bg-white/[0.08] transition-all disabled:opacity-20"
            >
              {cfgBusy ? (t?.saving || ui('保存中...', 'Saving...')) : (t?.saveCredentials || ui('保存凭据', 'Save credentials'))}
            </button>
            {cfgMsg && <p className="text-[10px] text-center text-white/40">{cfgMsg}</p>}
          </section>

          <section className="rounded-2xl bg-white/[0.02] border border-white/5 p-5 flex flex-col items-center gap-4">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-bold uppercase tracking-widest text-white/35">{ui('网易云音乐', 'NetEase Cloud')}</span>
              {loginDone && (
                <span className="text-[9px] text-emerald-400 font-mono bg-emerald-400/10 px-2 py-0.5 rounded-full">{ui('已连接', 'CONNECTED')}</span>
              )}
            </div>
            <p className="text-[11px] text-white/40 text-center leading-relaxed">
              {ui('扫码一次即可启用账号播放、歌单、推荐，以及可用的 VIP 曲目。', 'Scan once to enable account playback, playlists, recommendations, and VIP songs when available.')}
            </p>

            {qrImgSrc ? (
              <img src={qrImgSrc} alt={ui('二维码', 'QR Code')} className="w-40 h-40 rounded-xl bg-white" />
            ) : (
              <div className="w-40 h-40 rounded-xl bg-white/[0.03] border border-white/5 flex items-center justify-center text-xs text-white/25">
                {loginDone ? ui('已连接', 'Connected') : ui('扫码登录', 'QR Login')}
              </div>
            )}

            <button
              onClick={startLogin}
              disabled={loading}
              className="w-full py-2.5 rounded-xl bg-red-500/15 border border-red-500/25 text-red-400 text-sm font-medium hover:bg-red-500/25 transition-all disabled:opacity-30"
            >
              {loading ? (t?.loading || ui('加载中...', 'Loading...')) : loginDone ? (t?.musicConnected || ui('已连接', 'Connected')) : (t?.scanToLogin || ui('扫码登录', 'Scan to login'))}
            </button>
          </section>
        </div>
      </div>
    </div>
  );
}
