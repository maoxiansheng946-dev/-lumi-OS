/**
 * Server-side wake word detection using Qwen ASR (DashScope).
 * Replaces browser SpeechRecognition fallback — works in WebView2.
 */
import { logger } from '../../logger';
import { getKey } from '../config/keys';

const WAKE_WORDS = [
  'Jarvis', 'jarvis', '贾维斯',
  '计算机', '电脑',
  'lumi', 'Lumi', 'LUMI',
  '卢米', '路米', '鲁米', '露米',
  // "嘿 Lumi" + common Qwen ASR misrecognition variants
  '嘿 Lumi', '嘿 lumi', '嘿lumi', 'hey lumi', 'Hey Lumi', 'Hey lumi',
  '黑卢米', '嘿路米', '黑鲁米', '嘿卢米', '黑路米', '嗨卢米', '嗨路米',
  'hi lumi', 'Hi Lumi', 'hi Lumi', '黑 lumi', '嗨 lumi',
  'hi 卢米', 'hi 路米', 'hey 卢米', 'hey 路米',
  '嘿 卢米', '嘿 路米', '嗨 卢米', '嗨 路米',
];

export function isWakeWord(text: string): string | null {
  const normalized = text.toLowerCase().trim();
  for (const w of WAKE_WORDS) {
    if (normalized.includes(w.toLowerCase())) return w;
  }
  return null;
}

export interface WakeDetectorSession {
  sendAudio(chunk: Buffer): void;
  stop(): void;
  onWake: (callback: (keyword: string) => void) => void;
  onError: (callback: (err: Error) => void) => void;
}

export function createWakeDetector(
  accessKey?: string,
  echoFilter?: (text: string) => boolean,
): WakeDetectorSession {
  const apiKey = accessKey
    || process.env.DASHSCOPE_API_KEY
    || process.env.QWEN_API_KEY
    || getKey('DASHSCOPE_API_KEY')
    || getKey('QWEN_API_KEY');
  if (!apiKey) throw new Error('DASHSCOPE_API_KEY required for wake word detection');

  const model = 'qwen3-asr-flash-realtime';
  const url = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${model}`;

  const WebSocketImpl = (globalThis as any).WebSocket || require('ws');

  const ws = new WebSocketImpl(url, {
    headers: { Authorization: `bearer ${apiKey}` },
  });

  const wakeCallbacks: Array<(keyword: string) => void> = [];
  const errorCallbacks: Array<(err: Error) => void> = [];
  const audioQueue: Buffer[] = [];
  let sessionReady = false;
  let eventCounter = 0;

  function nextId(): string {
    return `wk_${++eventCounter}_${Date.now()}`;
  }

  ws.onopen = () => {
    logger.info('[WakeDetector] Qwen ASR connected');
    ws.send(JSON.stringify({
      event_id: nextId(),
      type: 'session.update',
      session: {
        input_audio_format: 'pcm',
        sample_rate: 16000,
        input_audio_transcription: { enabled: true, language: 'zh' },
        turn_detection: {
          type: 'server_vad',
          threshold: 0.0,
          silence_duration_ms: 1500,
          prefix_padding_ms: 200,
        },
      },
    }));
  };

  ws.onmessage = (event: MessageEvent) => {
    try {
      const msg = JSON.parse(event.data as string);

      switch (msg.type) {
        case 'session.created':
          sessionReady = true;
          logger.info('[WakeDetector] Session ready');
          for (const chunk of audioQueue) {
            ws.send(JSON.stringify({
              event_id: nextId(),
              type: 'input_audio_buffer.append',
              audio: Buffer.from(chunk).toString('base64'),
            }));
          }
          audioQueue.length = 0;
          break;

        case 'conversation.item.input_audio_transcription.completed': {
          const transcript = msg.transcript || '';
          if (transcript) {
            logger.info(`[WakeDetector] Transcript: "${transcript}"`);
            if (echoFilter && echoFilter(transcript)) {
              logger.info(`[WakeDetector] Echo filtered: "${transcript}"`);
              break;
            }
            const matched = isWakeWord(transcript);
            if (matched) {
              logger.info(`[WakeDetector] WAKE WORD "${matched}" in: "${transcript}"`);
              wakeCallbacks.forEach(cb => cb(matched));
            }
          }
          break;
        }

        case 'error':
          logger.error('[WakeDetector] Error:', msg.message || msg);
          errorCallbacks.forEach(cb => cb(new Error(msg.message || 'ASR error')));
          break;
      }
    } catch {
      // binary data, ignore
    }
  };

  ws.onerror = () => {
    errorCallbacks.forEach(cb => cb(new Error('Wake detector WebSocket error')));
  };

  ws.onclose = (event: CloseEvent) => {
    logger.info(`[WakeDetector] Closed (code=${event.code})`);
  };

  return {
    sendAudio(chunk: Buffer) {
      if (ws.readyState !== WebSocketImpl.OPEN) return;
      if (!sessionReady) {
        audioQueue.push(chunk);
        return;
      }
      ws.send(JSON.stringify({
        event_id: nextId(),
        type: 'input_audio_buffer.append',
        audio: Buffer.from(chunk).toString('base64'),
      }));
    },
    stop() {
      if (ws.readyState === WebSocketImpl.OPEN) {
        ws.send(JSON.stringify({ event_id: nextId(), type: 'session.finish' }));
        setTimeout(() => { try { ws.close(); } catch {} }, 500);
      }
    },
    onWake(callback) {
      wakeCallbacks.push(callback);
    },
    onError(callback) {
      errorCallbacks.push(callback);
    },
  };
}
