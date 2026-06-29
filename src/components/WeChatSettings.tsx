// Personal WeChat connection — QR code login flow
import { useState, useEffect, useRef } from 'react';
import { Button } from './ui/button';
import { toast } from 'sonner';
import { Loader2 } from 'lucide-react';

export function WeChatSettings({ t }: { t?: any }) {
  const [status, setStatus] = useState<any>(null);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrId, setQrId] = useState<string | null>(null);
  const [step, setStep] = useState<'idle' | 'show_qr' | 'scanning' | 'connected'>('idle');
  const [loading, setLoading] = useState(false);
  const pollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRunRef = useRef(0);

  const clearPolling = () => {
    pollRunRef.current += 1;
    if (pollTimerRef.current) {
      clearTimeout(pollTimerRef.current);
      pollTimerRef.current = null;
    }
  };

  const loadStatus = () => {
    fetch('/api/wechat/status', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setStatus(d);
        if (d.configured) setStep('connected');
      })
      .catch(() => {});
  };
  useEffect(() => {
    loadStatus();
    return () => clearPolling();
  }, []);

  const handleGetQR = async () => {
    clearPolling();
    setLoading(true);
    try {
      const res = await fetch('/api/wechat/qrcode', { credentials: 'include' });
      const data = await res.json();
      if (data.qrcode) {
        // qrcode is the QR ID string — generate a real QR PNG using the QR API
        const qrId = data.qrcode_id || data.qrcode;
        setQrId(qrId);
        // Use Google Charts API or qrserver to generate the QR image
        setQrCode(`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(data.qrcode_img_content)}`);
        setStep('show_qr');
        if (qrId) startPolling(qrId);
      } else {
        toast.error(data.error || 'Failed to get QR code');
      }
    } catch { toast.error('Network error'); }
    finally { setLoading(false); }
  };

  const startPolling = (qrId: string) => {
    const runId = ++pollRunRef.current;
    setStep('scanning');
    const schedule = (delay: number) => {
      if (pollTimerRef.current) clearTimeout(pollTimerRef.current);
      pollTimerRef.current = setTimeout(check, delay);
    };
    const check = async () => {
      if (runId !== pollRunRef.current) return;
      try {
        const res = await fetch(`/api/wechat/qrcode/status?qrcode_id=${encodeURIComponent(qrId)}`, { credentials: 'include' });
        const data = await res.json();
        if (runId !== pollRunRef.current) return;
        if (data.status === 'confirmed') {
          setStep('connected');
          loadStatus();
          toast.success(t?.wechatLoggedIn || 'WeChat logged in!');
          return;
        }
        if (data.status === 'expired') {
          setStep('idle');
          setQrCode(null);
          toast.error(t?.qrExpired || 'QR code expired');
          return;
        }
        schedule(2000);
      } catch { schedule(3000); }
    };
    schedule(2000);
  };

  return (
    <div className="space-y-5">
      {status?.configured ? (
        <div className="p-4 rounded-2xl bg-green-500/10 border border-green-500/20 space-y-3">
          <div className="flex items-center gap-2">
            <div className="w-2 h-2 rounded-full bg-green-400 animate-pulse" />
            <span className="text-xs font-bold text-green-400">{t?.connected || 'Connected'}</span>
          </div>
          <p className="text-xs text-white/40">{t?.wechatConnected || 'Lumi is listening on WeChat.'}</p>
          <button
            onClick={async () => {
              clearPolling();
              try {
                await fetch('/api/wechat/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include', body: JSON.stringify({ botToken: '', botId: '' }) });
              } catch {}
              setStatus(null); setStep('idle'); setQrCode(null); setQrId(null);
            }}
            className="w-full px-4 py-2 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-xs font-bold hover:bg-red-500/20 transition-all"
          >
            {t?.reconnect || 'Reconnect'}
          </button>
        </div>
      ) : (
        <div className="space-y-3">
          <p className="text-xs text-white/40">{t?.wechatSetupHelp || 'Scan the QR code with WeChat to connect your personal account.'}</p>

          {qrCode && (
            <div className="flex flex-col items-center gap-3 p-4 bg-white/5 rounded-2xl border border-white/10">
              <img src={qrCode} alt="WeChat QR" className="w-48 h-48 rounded-xl" />
              <span className="text-xs text-white/55">
                {step === 'scanning' ? (t?.scanning || 'Waiting for scan...') : (t?.scanQR || 'Scan with WeChat')}
              </span>
            </div>
          )}

          <Button onClick={handleGetQR} disabled={loading} className="w-full rounded-xl h-10 font-bold bg-celestial-saturn hover:bg-celestial-saturn/90 text-black">
            {loading ? <Loader2 size={14} className="animate-spin" /> : (qrCode ? (t?.refreshQR || 'Refresh') : (t?.getQRCode || 'Get QR Code'))}
          </Button>
        </div>
      )}
    </div>
  );
}
