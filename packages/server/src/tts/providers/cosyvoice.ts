import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import os from 'os';
import { TTSResult, VoiceListItem } from '../types';
import { getKey } from '../../config/keys';
import { getDataDir } from '../../utils/paths';

const BASE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/SpeechSynthesizer';

function getApiKey(): string {
  const key = process.env.DASHSCOPE_API_KEY || process.env.QWEN_API_KEY || getKey('DASHSCOPE_API_KEY') || getKey('QWEN_API_KEY');
  if (!key) throw new Error('DASHSCOPE_API_KEY is not configured. Add it in Settings → Voice Services.');
  return key;
}

const PRESET_VOICES: VoiceListItem[] = [
  { voiceId: 'longxiaochun_v3', name: 'Long Xiaochun - bright female', category: 'premade', language: 'zh' },
  { voiceId: 'longxiaoxia_v3', name: 'Long Xiaoxia - calm female', category: 'premade', language: 'zh' },
  { voiceId: 'longyumi_v3', name: 'YUMI - youthful female', category: 'premade', language: 'zh' },
  { voiceId: 'longanyun_v3', name: 'Long Anyun - warm male', category: 'premade', language: 'zh' },
  { voiceId: 'longanwen_v3', name: 'Long Anwen - elegant female', category: 'premade', language: 'zh' },
  { voiceId: 'longanli_v3', name: 'Long Anli - composed female', category: 'premade', language: 'zh' },
  { voiceId: 'longanlang_v3', name: 'Long Anlang - clear male', category: 'premade', language: 'zh' },
  { voiceId: 'longyingmu_v3', name: 'Long Yingmu - refined female', category: 'premade', language: 'zh' },
  { voiceId: 'longanyang', name: 'Long Anyang - sunny male', category: 'premade', language: 'zh' },
  { voiceId: 'longanhuan', name: 'Long Anhuan - upbeat female', category: 'premade', language: 'zh' },
  { voiceId: 'longhua_v3', name: 'Long Hua - sweet female', category: 'premade', language: 'zh' },
  { voiceId: 'longcheng_v3', name: 'Long Cheng - smart male', category: 'premade', language: 'zh' },
  { voiceId: 'longze_v3', name: 'Long Ze - warm male', category: 'premade', language: 'zh' },
  { voiceId: 'longxing_v3', name: 'Long Xing - gentle female', category: 'premade', language: 'zh' },
  { voiceId: 'longtian_v3', name: 'Long Tian - rational male', category: 'premade', language: 'zh' },
  { voiceId: 'longwan_v3', name: 'Long Wan - soft female', category: 'premade', language: 'zh' },
  { voiceId: 'longanya_v3', name: 'Long Anya - graceful female', category: 'premade', language: 'zh' },
  { voiceId: 'longanqin_v3', name: 'Long Anqin - friendly female', category: 'premade', language: 'zh' },
  { voiceId: 'longanrou_v3', name: 'Long Anrou - tender female', category: 'premade', language: 'zh' },
  { voiceId: 'longhan_v3', name: 'Long Han - affectionate male', category: 'premade', language: 'zh' },
  { voiceId: 'loongkyong_v3', name: 'Kyong - Korean female', category: 'premade', language: 'ko' },
  { voiceId: 'loongriko_v3', name: 'Riko - Japanese female', category: 'premade', language: 'ja' },
  { voiceId: 'loongtomoka_v3', name: 'Tomoka - Japanese female', category: 'premade', language: 'ja' },
  { voiceId: 'longjiaxin_v3', name: 'Long Jiaxin - Cantonese female', category: 'premade', language: 'yue' },
  { voiceId: 'longlaotie_v3', name: 'Long Laotie - Northeastern male', category: 'premade', language: 'zh' },
];

export async function synthesizeSpeech(
  text: string,
  voiceId: string = 'longxiaochun_v3',
  signal?: AbortSignal,
  speechRate?: number,
  pitch?: number,
  volume?: number,
): Promise<TTSResult> {
  const apiKey = getApiKey();

  const input: Record<string, any> = {
    text,
    voice: voiceId,
    format: 'mp3',
    sample_rate: 22050,
  };
  if (speechRate !== undefined) input.speech_rate = speechRate;
  if (pitch !== undefined) input.pitch = pitch;
  if (volume !== undefined) input.volume = volume;

  const body = { model: 'cosyvoice-v3-flash', input };

  const res = await fetch(BASE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`CosyVoice TTS error (${res.status}): ${err.message || err.code || 'Unknown'}`);
  }

  const json = await res.json();
  const audioUrl = json.output?.audio?.url;
  if (!audioUrl) {
    throw new Error(`CosyVoice response missing audio URL: ${JSON.stringify(json)}`);
  }

  const audioRes = await fetch(audioUrl, { signal });
  if (!audioRes.ok) {
    throw new Error(`CosyVoice audio download failed (${audioRes.status})`);
  }

  const arrayBuffer = await audioRes.arrayBuffer();
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    format: 'audio/mp3',
  };
}

export async function listVoices(): Promise<VoiceListItem[]> {
  return PRESET_VOICES;
}

const CLONE_URL = 'https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization';

/** Clone a voice from local audio file(s). Uses CosyVoice voice-enrollment API. */
export async function cloneVoice(sampleUrls: string[], name: string): Promise<string> {
  const apiKey = getApiKey();

  const firstUrl = sampleUrls[0];

  // Resolve uploaded file to local disk path
  let localPath: string;
  try {
    const u = new URL(firstUrl);
    const relativePath = u.pathname.replace(/^\/api\/voice\/samples\//, '');
    localPath = path.join(getDataDir(), 'voice_samples', relativePath);
    if (!fs.existsSync(localPath)) {
      throw new Error(`Sample file not found: ${localPath}`);
    }
  } catch (err: any) {
    if (err.message?.includes('Sample file not found')) throw err;
    throw new Error(`Invalid sample URL: ${firstUrl}`);
  }

  // Convert to 16kHz mono WAV if not already WAV (CosyVoice requires PCM)
  const ext = path.extname(localPath).toLowerCase();
  let wavPath: string;
  if (ext === '.wav') {
    wavPath = localPath;
  } else {
    wavPath = path.join(os.tmpdir(), `lumi_voice_${Date.now()}.wav`);
    try {
      execSync(`ffmpeg -y -i "${localPath}" -acodec pcm_s16le -ar 16000 -ac 1 "${wavPath}"`, {
        stdio: 'pipe',
        timeout: 15000,
      });
    } catch (ffErr: any) {
      throw new Error(`Audio conversion failed: ${ffErr.stderr?.toString()?.slice(0, 200) || ffErr.message}`);
    }
  }

  const buf = fs.readFileSync(wavPath);
  const audioBase64 = buf.toString('base64');

  // Clean up temp file
  if (wavPath !== localPath) {
    try { fs.unlinkSync(wavPath); } catch {}
  }

  // Sanitize prefix: lowercase letters/numbers only, max 10 chars
  const prefix = name
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 10) || 'voice';

  const body = {
    model: 'voice-enrollment',
    input: {
      action: 'create_voice',
      target_model: 'cosyvoice-v3-flash',
      url: `data:audio/wav;base64,${audioBase64}`,
      prefix,
    },
  };

  const res = await fetch(CLONE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`CosyVoice clone error (${res.status}): ${err.message || err.code || 'Unknown'}`);
  }

  const json = await res.json();
  const voiceId = json.output?.voice_id || json.output?.voiceId;
  if (!voiceId) {
    throw new Error(`CosyVoice clone response missing voice_id: ${JSON.stringify(json)}`);
  }

  return voiceId;
}

/** Design a new voice from a text description. Uses Qwen Voice Design API. */
export async function designVoice(voicePrompt: string, name: string): Promise<string> {
  const apiKey = getApiKey();

  const body = {
    model: 'qwen-voice-design',
    input: {
      action: 'create',
      voice_prompt: voicePrompt,
      preview_text: '你好，这是我的声音。',
      target_model: 'qwen3-tts-vd-realtime-2025-12-16',
      preferred_name: name,
    },
  };

  const res = await fetch(CLONE_URL, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`Voice design error (${res.status}): ${err.message || err.code || 'Unknown'}`);
  }

  const json = await res.json();
  const voiceId = json.output?.voice_id || json.output?.voiceId;
  if (!voiceId) {
    throw new Error(`Voice design response missing voice_id: ${JSON.stringify(json)}`);
  }

  return voiceId;
}
