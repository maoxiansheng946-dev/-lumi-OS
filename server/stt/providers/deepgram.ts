import { STTResult } from '../types';
import { logger } from '../../../logger';

function getApiKey(): string {
  const key = process.env.DEEPGRAM_API_KEY;
  if (!key) throw new Error('DEEPGRAM_API_KEY is not configured');
  return key;
}

export interface DeepgramStreamSession {
  sendAudio(chunk: Buffer): void;
  end(): void;
  onResult: (callback: (result: STTResult) => void) => void;
  onError: (callback: (err: Error) => void) => void;
}

export function createStream(
  language: string = 'zh-CN',
  interimResults: boolean = true,
): DeepgramStreamSession {
  const apiKey = getApiKey();
  const params = new URLSearchParams({
    encoding: 'linear16',
    sample_rate: '16000',
    channels: '1',
    model: 'nova-2',
    language,
    interim_results: String(interimResults),
    punctuate: 'true',
    smart_format: 'true',
    endpointing: '300',
    utterance_end_ms: '1000',
  });

  const url = `wss://api.deepgram.com/v1/listen?${params.toString()}`;

  const WebSocketImpl = (globalThis as any).WebSocket;
  if (!WebSocketImpl) {
    throw new Error('WebSocket not available. Requires Node.js 22+ or install ws package.');
  }
  const ws = new WebSocketImpl(url, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  const resultCallbacks: Array<(result: STTResult) => void> = [];
  const errorCallbacks: Array<(err: Error) => void> = [];

  ws.onopen = () => {
    logger.info('[Deepgram] Streaming session started');
  };

  ws.onmessage = (event: MessageEvent) => {
    const raw = event.data as string;
    try {
      const msg = JSON.parse(raw);
      const { type, channel } = msg;

      if (type === 'Results') {
        const alternatives = channel?.alternatives || msg?.channel?.alternatives;
        const is_final = msg.is_final ?? true;
        logger.info(`[Deepgram] Result: is_final=${msg.is_final} speech_final=${msg.speech_final} text="${alternatives?.[0]?.transcript || ''}"`);
        if (alternatives && alternatives.length > 0) {
          const text = alternatives[0].transcript || '';
          const result: STTResult = { text, isFinal: Boolean(is_final) };
          resultCallbacks.forEach(cb => cb(result));
        }
      }
    } catch {
      // Binary data, ignore
    }
  };

  ws.onerror = (event: Event) => {
    logger.error('[Deepgram] WebSocket error:', (event as any).message || event.type || 'unknown');
    errorCallbacks.forEach(cb => cb(new Error('Deepgram WebSocket error')));
  };

  ws.onclose = (event: CloseEvent) => {
    logger.info(`[Deepgram] Streaming session closed (code=${event.code}, reason=${event.reason || 'none'})`);
  };

  return {
    sendAudio(chunk: Buffer) {
      if (ws.readyState === WebSocketImpl.OPEN) {
        ws.send(chunk);
      }
    },
    end() {
      if (ws.readyState === WebSocketImpl.OPEN) {
        ws.send(JSON.stringify({ type: 'CloseStream' }));
        setTimeout(() => ws.close(), 500);
      }
    },
    onResult(callback) {
      resultCallbacks.push(callback);
    },
    onError(callback) {
      errorCallbacks.push(callback);
    },
  };
}
