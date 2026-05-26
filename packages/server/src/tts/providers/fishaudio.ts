import { TTSResult, VoiceListItem } from '../types';

const BASE_URL = 'https://api.fish.audio/v1';

function getApiKey(): string {
  const key = process.env.FISHAUDIO_API_KEY;
  if (!key) throw new Error('FISHAUDIO_API_KEY is not configured');
  return key;
}

export async function synthesizeSpeech(
  text: string,
  voiceId: string,
  signal?: AbortSignal,
): Promise<TTSResult> {
  const apiKey = getApiKey();
  const url = `${BASE_URL}/tts`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      text,
      reference_id: voiceId,
      format: 'mp3',
    }),
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Fish Audio TTS error (${res.status}): ${errorBody}`);
  }

  const arrayBuffer = await res.arrayBuffer();
  return {
    audioBuffer: Buffer.from(arrayBuffer),
    format: 'audio/mpeg',
  };
}

export async function cloneVoice(
  sampleUrls: string[],
  name: string,
): Promise<string> {
  const apiKey = getApiKey();

  // Download samples
  const sampleBuffers = await Promise.all(
    sampleUrls.map(async (url) => {
      const res = await fetch(url);
      const ab = await res.arrayBuffer();
      return new Blob([ab]);
    })
  );

  const form = new FormData();
  form.append('title', name);
  sampleBuffers.forEach((blob, i) => {
    form.append('voices', blob, `sample_${i}.mp3`);
  });

  const res = await fetch(`${BASE_URL}/model`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Fish Audio clone error (${res.status}): ${errorBody}`);
  }

  const data = await res.json() as any;
  return data._id || data.id;
}

export async function listVoices(): Promise<VoiceListItem[]> {
  const apiKey = getApiKey();
  const res = await fetch(`${BASE_URL}/model`, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Fish Audio list voices error (${res.status})`);
  }

  const data = await res.json() as any;
  return (data.items || []).map((v: any) => ({
    voiceId: v._id || v.id,
    name: v.title || v.name,
    category: 'cloned',
    language: v.language || 'zh',
  }));
}
