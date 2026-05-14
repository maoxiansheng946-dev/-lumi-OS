import { TTSConfig, TTSResult, TTSProvider, VoiceCloneRequest, VoiceListItem } from './types';
import * as gptsovits from './providers/gptsovits';
import * as cosyvoice from './providers/cosyvoice';
import { getKey } from '../config/keys';

export async function synthesizeSpeech(text: string, config: TTSConfig): Promise<TTSResult> {
  switch (config.provider) {
    case 'gptsovits':
      return gptsovits.synthesizeSpeech(text, config.voiceId, config.signal);
    case 'cosyvoice':
      return cosyvoice.synthesizeSpeech(text, config.voiceId, config.signal);
    default:
      throw new Error(`Unknown TTS provider: ${config.provider}`);
  }
}

export async function cloneVoice(request: VoiceCloneRequest, provider: TTSProvider): Promise<string> {
  switch (provider) {
    case 'cosyvoice':
      return cosyvoice.cloneVoice(request.sampleUrls, request.name);
    default:
      throw new Error(`Voice cloning not supported for provider: ${provider}`);
  }
}

export async function designVoice(prompt: string, name: string, provider: TTSProvider = 'cosyvoice'): Promise<string> {
  switch (provider) {
    case 'cosyvoice':
      return cosyvoice.designVoice(prompt, name);
    default:
      throw new Error(`Voice design not supported for provider: ${provider}`);
  }
}

export async function listVoices(provider: TTSProvider): Promise<VoiceListItem[]> {
  switch (provider) {
    case 'cosyvoice':
      return cosyvoice.listVoices();
    case 'gptsovits':
      return gptsovits.listVoices();
    default:
      throw new Error(`Unknown TTS provider: ${provider}`);
  }
}

export function getActiveProvider(): TTSProvider | null {
  const dashscopeKey = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || getKey('DASHSCOPE_API_KEY') || getKey('QWEN_API_KEY');
  if (dashscopeKey) return 'cosyvoice';
  if (process.env.GPTSOVITS_API_URL || process.env.GPTSOVITS_ENABLED === 'true') return 'gptsovits';
  return 'cosyvoice';
}
