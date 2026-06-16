// Enterprise WeChat (企业微信) settings panel
import { useState, useEffect } from 'react';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { toast } from 'sonner';
import { ExternalLink, CheckCircle, Loader2 } from 'lucide-react';

export function WeComSettings({ t }: { t?: any }) {
  const isZh = t?.langCode !== 'en';
  const ui = (zh: string, en: string) => isZh ? zh : en;
  const [config, setConfig] = useState<any>(null);
  const [form, setForm] = useState({ corpId: '', agentId: '', appSecret: '', token: '', encodingAESKey: '' });
  const [saving, setSaving] = useState(false);

  const load = () => {
    fetch('/api/wecom/config', { credentials: 'include' })
      .then(r => r.json())
      .then(d => {
        setConfig(d);
        setForm({ corpId: d.corpId || '', agentId: d.agentId || '', appSecret: '', token: '', encodingAESKey: '' });
      })
      .catch(() => {});
  };
  useEffect(() => { load(); }, []);

  const save = async () => {
    setSaving(true);
    try {
      const body: any = {};
      if (form.corpId) body.corpId = form.corpId;
      if (form.agentId) body.agentId = form.agentId;
      if (form.appSecret) body.appSecret = form.appSecret;
      if (form.token) body.token = form.token;
      if (form.encodingAESKey) body.encodingAESKey = form.encodingAESKey;
      const res = await fetch('/api/wecom/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      const d = await res.json();
      if (d.success) { toast.success(t?.saved || 'Saved'); load(); }
      else toast.error(d.error || ui('保存失败', 'Save failed'));
    } catch { toast.error(ui('网络错误', 'Network error')); }
    finally { setSaving(false); }
  };

  const configured = config?.corpId && config?.hasSecret;

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-black uppercase tracking-widest text-white/40">{t?.status || 'Status'}</span>
        <span className={`text-xs font-bold px-3 py-1 rounded-full ${configured ? 'bg-green-500/10 text-green-400' : 'bg-white/5 text-white/55'}`}>
          <CheckCircle size={10} className="inline mr-1" />
          {configured ? (t?.connected || 'Connected') : (t?.notConfigured || 'Not configured')}
        </span>
      </div>

      <div className="space-y-3">
        <div>
          <label className="text-xs font-bold text-white/40 uppercase block mb-1">{ui('Corp ID (企业ID)', 'Corp ID')}</label>
          <Input value={form.corpId} onChange={e => setForm(prev => ({ ...prev, corpId: e.target.value }))}
            className="bg-white/5 border-white/10 rounded-xl text-white text-xs" placeholder="ww..." />
        </div>
        <div>
          <label className="text-xs font-bold text-white/40 uppercase block mb-1">{ui('Agent ID (应用ID)', 'Agent ID')}</label>
          <Input value={form.agentId} onChange={e => setForm(prev => ({ ...prev, agentId: e.target.value }))}
            className="bg-white/5 border-white/10 rounded-xl text-white text-xs" placeholder="1000001" />
        </div>
        <div>
          <label className="text-xs font-bold text-white/40 uppercase block mb-1">{ui('App Secret (应用Secret)', 'App Secret')}</label>
          <Input type="password" value={form.appSecret} onChange={e => setForm(prev => ({ ...prev, appSecret: e.target.value }))}
            className="bg-white/5 border-white/10 rounded-xl text-white text-xs" placeholder={config?.hasSecret ? '(stored)' : ''} />
        </div>
        <div>
          <label className="text-xs font-bold text-white/40 uppercase block mb-1">{ui('Token (回调Token)', 'Token')}</label>
          <Input value={form.token} onChange={e => setForm(prev => ({ ...prev, token: e.target.value }))}
            className="bg-white/5 border-white/10 rounded-xl text-white text-xs" placeholder={ui('随机字符串', 'Random string')} />
        </div>
        <div>
          <label className="text-xs font-bold text-white/40 uppercase block mb-1">Encoding AES Key</label>
          <Input value={form.encodingAESKey} onChange={e => setForm(prev => ({ ...prev, encodingAESKey: e.target.value }))}
            className="bg-white/5 border-white/10 rounded-xl text-white text-xs font-mono" placeholder={ui('43位Base64字符串', '43-character Base64 string')} />
        </div>
      </div>

      <Button onClick={save} disabled={saving} className="w-full bg-celestial-saturn hover:bg-celestial-saturn/90 text-black font-bold rounded-xl h-10">
        {saving ? <Loader2 size={14} className="animate-spin" /> : (t?.save || 'Save')}
      </Button>

      <div className="p-3 rounded-xl bg-white/5 border border-white/5 text-xs text-white/55 space-y-1">
        <p>{ui('1. 前往', '1. Go to')} <a href="https://work.weixin.qq.com/wework_admin/frame#apps" target="_blank" rel="noopener noreferrer" className="text-celestial-saturn underline inline-flex items-center gap-0.5">{ui('企业微信管理后台', 'WeCom Admin Console')} <ExternalLink size={9} /></a> {ui('创建应用', 'and create an app')}</p>
        <p>{ui('2. 复制 Corp ID、Agent ID、App Secret', '2. Copy Corp ID, Agent ID, and App Secret')}</p>
        <p>{ui('3. 「接收消息」-> 设置回调 URL：', '3. In Receive Messages, set callback URL to:')}<code className="text-celestial-jupiter bg-white/5 px-1 rounded">https://lumiai.asia/api/wecom/events</code></p>
        <p>{ui('4. 随机生成 Token 和 EncodingAESKey（推荐 43 位），填入上面表单并保存', '4. Generate Token and EncodingAESKey, fill the form above, and save')}</p>
        <p>{ui('5. 回到企业微信后台，填入相同的 Token 和 AESKey，点击「保存」完成验证', '5. Return to WeCom, enter the same Token and AESKey, then save to verify')}</p>
      </div>
    </div>
  );
}
