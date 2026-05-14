export type TTSProvider = 'gptsovits' | 'cosyvoice';

export interface TTSConfig {
  provider: TTSProvider;
  voiceId: string;
  model?: string;
  stability?: number;
  similarityBoost?: number;
  signal?: AbortSignal;
}

export interface TTSResult {
  audioBuffer: Buffer;
  format: string;
}

export interface VoiceCloneRequest {
  sampleUrls: string[];
  name: string;
}

export interface VoiceListItem {
  voiceId: string;
  name: string;
  category: 'cloned' | 'premade';
  language?: string;
}
