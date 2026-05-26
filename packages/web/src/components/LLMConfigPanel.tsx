import { useState } from 'react';
import { motion } from 'motion/react';
import { BrainCircuit, Key, TestTube, CheckCircle, XCircle, Loader2, Globe } from 'lucide-react';
import { useApp } from '@/contexts/AppContext';

const PROVIDERS = [
  { id: 'qwen', label: 'Qwen (DashScope)', models: ['qwen-plus', 'qwen-max', 'qwen-turbo'] },
  { id: 'deepseek', label: 'DeepSeek', models: ['deepseek-chat', 'deepseek-reasoner'] },
  { id: 'openai', label: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini', 'gpt-4-turbo'] },
  { id: 'gemini', label: 'Gemini', models: ['gemini-2.0-flash', 'gemini-1.5-pro', 'gemini-1.5-flash'] },
  { id: 'anthropic', label: 'Anthropic', models: ['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'] },
];

export function LLMConfigPanel() {
  const { aiConfig, updateAIConfig } = useApp();
  const [testStatus, setTestStatus] = useState<'idle' | 'testing' | 'success' | 'failed'>('idle');
  const [provider, setProvider] = useState(aiConfig.provider || 'qwen');
  const [model, setModel] = useState(aiConfig.model || 'qwen-plus');
  const [apiKey, setApiKey] = useState(aiConfig.apiKey || '');
  const [showKey, setShowKey] = useState(false);

  const currentModels = PROVIDERS.find(p => p.id === provider)?.models || [];

  const handleSave = () => {
    updateAIConfig({ provider, model, apiKey });
    setTestStatus('idle');
  };

  const handleTestConnection = async () => {
    setTestStatus('testing');
    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, model, apiKey }),
      });
      if (res.ok) {
        setTestStatus('success');
        updateAIConfig({ provider, model, apiKey });
      } else {
        setTestStatus('failed');
      }
    } catch {
      setTestStatus('failed');
    }
  };

  return (
    <div className="h-full flex flex-col bg-zinc-950/60 backdrop-blur-xl text-white overflow-y-auto">
      <div className="flex items-center gap-3 px-6 py-4 border-b border-white/5">
        <div className="w-10 h-10 rounded-xl bg-blue-500/20 flex items-center justify-center">
          <BrainCircuit size={20} className="text-blue-400" />
        </div>
        <div>
          <h2 className="text-sm font-bold text-white/90">LLM Configuration</h2>
          <p className="text-[10px] text-white/30">Select the AI brain powering Lumi</p>
        </div>
      </div>

      <div className="flex-1 p-6 space-y-5">
        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-white/30 tracking-wider">Provider</label>
          <div className="grid grid-cols-5 gap-2">
            {PROVIDERS.map(p => (
              <button
                key={p.id}
                onClick={() => { setProvider(p.id); setModel(PROVIDERS.find(x => x.id === p.id)?.models[0] || ''); }}
                className={`px-2 py-2 rounded-xl text-[10px] font-bold uppercase transition-all ${
                  provider === p.id
                    ? 'bg-blue-500/20 border border-blue-500/50 text-blue-300'
                    : 'bg-white/5 border border-white/5 text-white/40 hover:bg-white/10 hover:text-white/60'
                }`}
              >
                {p.label.split(' ')[0]}
              </button>
            ))}
          </div>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-white/30 tracking-wider">Model</label>
          <select
            value={model}
            onChange={e => setModel(e.target.value)}
            className="w-full bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm font-medium outline-none focus:border-blue-500/50 appearance-none"
          >
            {currentModels.map(m => (
              <option key={m} value={m}>{m}</option>
            ))}
            <option value="__custom__">Custom model name...</option>
          </select>
        </div>

        <div className="space-y-2">
          <label className="text-[10px] font-black uppercase text-white/30 tracking-wider flex items-center gap-2">
            <Key size={12} /> API Key
          </label>
          <div className="flex gap-2">
            <input
              type={showKey ? 'text' : 'password'}
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder={`Enter ${PROVIDERS.find(p => p.id === provider)?.label} API key...`}
              className="flex-1 bg-white/5 border border-white/10 rounded-xl px-4 py-2.5 text-sm outline-none focus:border-blue-500/50"
            />
            <button
              onClick={() => setShowKey(!showKey)}
              className="px-3 py-2 rounded-xl bg-white/5 text-white/30 text-xs hover:bg-white/10"
            >
              {showKey ? 'Hide' : 'Show'}
            </button>
          </div>
        </div>

        <div className="flex gap-3 pt-2">
          <button
            onClick={handleSave}
            className="flex-1 py-2.5 rounded-xl bg-blue-500/20 border border-blue-500/30 text-blue-300 text-xs font-bold uppercase tracking-wider hover:bg-blue-500/30 transition-all"
          >
            Save Config
          </button>
          <button
            onClick={handleTestConnection}
            disabled={testStatus === 'testing'}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition-all ${
              testStatus === 'testing' ? 'bg-white/5 text-white/20 cursor-wait' :
              testStatus === 'success' ? 'bg-emerald-500/20 border border-emerald-500/30 text-emerald-400' :
              testStatus === 'failed' ? 'bg-red-500/20 border border-red-500/30 text-red-400' :
              'bg-white/5 border border-white/10 text-white/40 hover:bg-white/10'
            }`}
          >
            {testStatus === 'testing' ? <Loader2 size={14} className="animate-spin" /> :
             testStatus === 'success' ? <CheckCircle size={14} /> :
             testStatus === 'failed' ? <XCircle size={14} /> :
             <TestTube size={14} />}
            {testStatus === 'testing' ? 'Testing...' :
             testStatus === 'success' ? 'Connected!' :
             testStatus === 'failed' ? 'Failed' :
             'Test'}
          </button>
        </div>

        {testStatus === 'success' && (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-2 text-[10px] text-emerald-400 font-bold uppercase tracking-wider">
            <Globe size={12} /> Connection verified — model available
          </motion.div>
        )}
      </div>
    </div>
  );
}
