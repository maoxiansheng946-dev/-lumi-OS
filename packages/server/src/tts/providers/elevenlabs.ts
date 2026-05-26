import { TTSResult, VoiceListItem } from '../types';

const BASE_URL = 'https://api.elevenlabs.io/v1';

function getApiKey(): string {
  const key = process.env.ELEVENLABS_API_KEY;
  if (!key) throw new Error('ELEVENLABS_API_KEY is not configured');
  return key;
}

export async function synthesizeSpeech(
  text: string,
  voiceId: string,
  model: string = 'eleven_multilingual_v2',
  stability: number = 0.5,
  similarityBoost: number = 0.75,
  signal?: AbortSignal,
): Promise<TTSResult> {
  const apiKey = getApiKey();
  const url = `${BASE_URL}/text-to-speech/${voiceId}/stream`;

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'xi-api-key': apiKey,
      'Accept': 'audio/mpeg',
    },
    body: JSON.stringify({
      text,
      model_id: model,
      voice_settings: { stability, similarity_boost: similarityBoost },
    }),
    signal,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`ElevenLabs TTS error (${res.status}): ${errorBody}`);
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
  description: string = '',
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
  form.append('name', name);
  form.append('description', description);
  sampleBuffers.forEach((blob, i) => {
    form.append('files', blob, `sample_${i}.mp3`);
  });

  const res = await fetch(`${BASE_URL}/voices/add`, {
    method: 'POST',
    headers: { 'xi-api-key': apiKey },
    body: form,
  });

  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`ElevenLabs clone error (${res.status}): ${errorBody}`);
  }

  const data = await res.json() as any;
  return data.voice_id;
}

export async function listVoices(): Promise<VoiceListItem[]> {
  const apiKey = getApiKey();
  const res = await fetch(`${BASE_URL}/voices`, {
    headers: { 'xi-api-key': apiKey },
  });

  if (!res.ok) {
    throw new Error(`ElevenLabs list voices error (${res.status})`);
  }

  const data = await res.json() as any;
  return (data.voices || []).map((v: any) => ({
    voiceId: v.voice_id,
    name: v.name,
    category: v.category || 'premade',
    language: v.labels?.language,
  }));
}
