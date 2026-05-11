import { useEffect, useRef, useState, useCallback } from 'react';

interface UseWakeWordOptions {
  /** Porcupine access key (free at https://picovoice.ai) */
  accessKey?: string;
  /** Built-in keyword to detect. Default: "Porcupine" */
  keyword?: 'Porcupine' | 'Computer' | 'Hey Google' | 'Alexa' | 'Jarvis';
  /** Ref to the startCall function from useVoiceCall */
  startCallRef: React.MutableRefObject<((voiceId?: string, personalityId?: string, agentId?: string) => Promise<void>)>;
  /** Enable/disable wake word */
  enabled?: boolean;
  /** Sensitivity 0-1. Default 0.5 */
  sensitivity?: number;
  /** Voice ID to pass to startCall */
  voiceId?: string;
  /** Personality ID to pass to startCall */
  personalityId?: string;
  /** Agent ID to pass to startCall */
  agentId?: string;
  /** Called when wake word is detected (before startCall) */
  onDetection?: () => void;
}

interface UseWakeWordReturn {
  isListening: boolean;
  isSupported: boolean;
  lastDetection: string | null;
  error: string | null;
  enable: () => Promise<void>;
  disable: () => void;
}

const PICOVOICE_ACCESS_KEY_STORAGE = 'lumi_picovoice_key';

export function useWakeWord({
  accessKey: propKey,
  keyword = 'Computer',
  startCallRef,
  enabled = false,
  sensitivity = 0.5,
  voiceId,
  personalityId,
  agentId,
  onDetection,
}: UseWakeWordOptions): UseWakeWordReturn {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [lastDetection, setLastDetection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const engineRef = useRef<any>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const enabledRef = useRef(enabled);

  enabledRef.current = enabled;

  const accessKey = propKey || localStorage.getItem(PICOVOICE_ACCESS_KEY_STORAGE) || '';

  const disable = useCallback(() => {
    setIsListening(false);
    if (processorRef.current) {
      processorRef.current.disconnect();
      processorRef.current = null;
    }
    if (ctxRef.current && ctxRef.current.state !== 'closed') {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }
    if (engineRef.current) {
      try { engineRef.current.release(); } catch {}
      engineRef.current = null;
    }
  }, []);

  const enable = useCallback(async () => {
    if (!accessKey) {
      // Silently skip — no key configured
      return;
    }

    try {
      setError(null);

      const { Porcupine, BuiltInKeyword } = await import('@picovoice/porcupine-web');

      const keywordMap: Record<string, typeof BuiltInKeyword[keyof typeof BuiltInKeyword]> = {
        'Porcupine': BuiltInKeyword.Porcupine,
        'Computer': BuiltInKeyword.Computer,
        'Hey Google': BuiltInKeyword.HeyGoogle,
        'Alexa': BuiltInKeyword.Alexa,
        'Jarvis': BuiltInKeyword.Jarvis,
      };

      const builtinKeyword = keywordMap[keyword];
      if (builtinKeyword === undefined) {
        setError(`Unknown keyword: ${keyword}`);
        return;
      }

      // Use model from /public/porcupine_params.pv served by Vite
      const engine = await Porcupine.create(
        accessKey,
        { builtin: builtinKeyword, sensitivity },
        (_detection) => {
          // Wake word detected!
          setLastDetection(new Date().toISOString());
          onDetection?.();
          startCallRef.current?.(voiceId, personalityId, agentId);
        },
        { publicPath: '/porcupine_params.pv' },
      );

      engineRef.current = engine;
      setIsSupported(true);

      // Open mic at Porcupine's required sample rate
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;

      const ctx = new AudioContext({ sampleRate: engine.sampleRate });
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(engine.frameLength, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (!enabledRef.current) return;
        try {
          const input = event.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
          }
          engine.process(pcm);
        } catch { /* ignore processing errors */ }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setIsListening(true);
    } catch (err: any) {
      disable();
      const msg = err.message || 'Failed to initialize wake word';
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        setError('Microphone permission denied.');
      } else if (msg.includes('Porcupine') || msg.includes('Pv')) {
        setError(msg);
      } else {
        setError(msg);
      }
    }
  }, [accessKey, keyword, sensitivity, voiceId, personalityId, agentId, startCallRef, disable]);

  // Auto-start if enabled
  useEffect(() => {
    if (enabled && accessKey && !isListening) {
      enable();
    } else if (!enabled && isListening) {
      disable();
    }
  }, [enabled]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { disable(); };
  }, [disable]);

  return { isListening, isSupported, lastDetection, error, enable, disable };
}

export function savePicovoiceKey(key: string) {
  localStorage.setItem(PICOVOICE_ACCESS_KEY_STORAGE, key);
}

export function getPicovoiceKey(): string | null {
  return localStorage.getItem(PICOVOICE_ACCESS_KEY_STORAGE);
}
