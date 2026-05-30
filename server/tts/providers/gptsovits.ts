import { TTSResult, VoiceListItem } from '../types';
import fs from 'fs';
import path from 'path';
import { getDataPath } from '../../config/data_path';

const BASE_URL = 'http://127.0.0.1:9880';

const SEGMENTS_DIR = getDataPath('voice_training/segments');

function listReferenceFiles(): { path: string; name: string }[] {
  try {
    if (!fs.existsSync(SEGMENTS_DIR)) return [];
    return fs.readdirSync(SEGMENTS_DIR)
      .filter(f => f.endsWith('.wav'))
      .map(f => ({
        path: path.join(SEGMENTS_DIR, f),
        name: f.replace(/\.wav$/, '').replace(/_/g, ' '),
      }));
  } catch {
    return [];
  }
}

export function listVoices(): VoiceListItem[] {
  const refs = listReferenceFiles();
  if (refs.length === 0) {
    return [{ voiceId: 'lumi', name: 'Lumi Voice', category: 'cloned', language: 'zh' }];
  }
  return refs.map(r => ({
    voiceId: `gptsovits:${r.name.replace(/\s+/g, '_')}`,
    name: r.name,
    category: 'cloned' as const,
    language: 'zh',
  }));
}

export async function synthesizeSpeech(
  text: string,
  voiceId?: string,
  signal?: AbortSignal,
): Promise<TTSResult> {
  // Resolve reference audio based on voiceId
  let refAudioPath: string;
  let promptText: string;

  const refs = listReferenceFiles();
  if (voiceId && voiceId.startsWith('gptsovits:')) {
    const voiceName = voiceId.replace('gptsovits:', '').replace(/_/g, ' ');
    const match = refs.find(r => r.name === voiceName);
    if (match) {
      refAudioPath = match.path;
      promptText = match.name;
    } else {
      // Fallback to first available or default
      refAudioPath = refs.length > 0 ? refs[0].path : getDataPath('voice_training/segments/segment_0000.wav');
      promptText = refs.length > 0 ? refs[0].name : '各位朋友大家好，今天想和大家分享的';
    }
  } else if (refs.length > 0) {
    refAudioPath = refs[0].path;
    promptText = refs[0].name;
  } else {
    refAudioPath = getDataPath('voice_training/segments/segment_0000.wav');
    promptText = '各位朋友大家好，今天想和大家分享的';
  }

  const body: Record<string, unknown> = {
    text,
    text_lang: 'zh',
    ref_audio_path: refAudioPath,
    prompt_text: promptText,
    prompt_lang: 'zh',
    text_split_method: 'cut0',
    batch_size: 1,
    media_type: 'wav',
    streaming_mode: false,
  };

  const res = await fetch(`${BASE_URL}/tts`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ message: res.statusText }));
    throw new Error(`GPT-SoVITS TTS error (${res.status}): ${err.message || err.detail}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    format: 'audio/wav',
  };
}
