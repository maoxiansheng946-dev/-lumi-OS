import { useEffect, useRef, useState, useCallback } from 'react';
import type { Socket } from 'socket.io-client';
import { isTauriRuntime } from '../services/apiBridge';

const isMacOS = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
const isTauri = isTauriRuntime();
const useServerMic = isMacOS && isTauri;

interface UseWakeWordOptions {
  /** Socket.IO connection for server-side Qwen ASR wake word detection */
  socket?: Socket | null;
  /** Porcupine access key (free at https://picovoice.ai) — optional, server-side Qwen ASR is the default */
  accessKey?: string;
  /** Keyword to detect. Default 'Jarvis' */
  keyword?: string;
  /** Ref to the startCall function from useVoiceCall */
  startCallRef: React.MutableRefObject<((voiceId?: string, personalityId?: string, agentId?: string) => Promise<void>)>;
  /** Enable/disable wake word */
  enabled?: boolean;
  /** Sensitivity 0-1. Default 0.5 (Picovoice only) */
  sensitivity?: number;
  /** Voice ID to pass to startCall */
  voiceId?: string;
  /** Personality ID to pass to startCall */
  personalityId?: string;
  /** Agent ID to pass to startCall */
  agentId?: string;
  /** Called when wake word is detected (before startCall) */
  onDetection?: () => void;
  /** If provided and returns true, skip starting a new call (e.g. already in a call) */
  isCallActive?: () => boolean;
  /** Called to interrupt an active call when wake word fires during one */
  onInterrupt?: () => void;
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
  socket,
  accessKey: propKey,
  keyword = 'Jarvis',
  startCallRef,
  enabled = false,
  sensitivity = 0.5,
  voiceId,
  personalityId,
  agentId,
  onDetection,
  isCallActive,
  onInterrupt,
}: UseWakeWordOptions): UseWakeWordReturn {
  const [isListening, setIsListening] = useState(false);
  const [isSupported, setIsSupported] = useState(false);
  const [lastDetection, setLastDetection] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const streamRef = useRef<MediaStream | null>(null);
  const ctxRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const enabledRef = useRef(enabled);
  const socketRef = useRef(socket);

  enabledRef.current = enabled;
  socketRef.current = socket;

  const accessKey = propKey || localStorage.getItem(PICOVOICE_ACCESS_KEY_STORAGE) || '';

  const cleanupAudio = useCallback(() => {
    if (processorRef.current) {
      try { processorRef.current.disconnect(); } catch {}
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
  }, []);

  const disable = useCallback(() => {
    setIsListening(false);
    const s = socketRef.current;
    if (s?.connected) {
      s.emit('wake:stop');
      s.off('wake:detected');
      s.off('wake:started');
      s.off('wake:error');
    }
    cleanupAudio();
  }, [cleanupAudio]);

  // ── Server-side Qwen ASR wake detection (primary) ──

  const enableQwenWake = useCallback(async () => {
    const s = socketRef.current;
    if (!s?.connected) {
      setError('Socket not connected — retrying...');
      return;
    }

    try {
      setError(null);
      console.log('[WakeWord-Qwen] Opening microphone...');

      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
      streamRef.current = stream;
      console.log('[WakeWord-Qwen] Mic opened, setting up AudioContext');

      const ctx = new AudioContext({ sampleRate: 16000 });
      ctxRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (event) => {
        if (!enabledRef.current) return;
        try {
          const input = event.inputBuffer.getChannelData(0);
          const pcm = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            pcm[i] = Math.max(-32768, Math.min(32767, Math.round(input[i] * 32767)));
          }
          socketRef.current?.emit('wake:audio', { audio: Array.from(pcm) });
        } catch { /* ignore */ }
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      // Set up listeners BEFORE emitting wake:start
      s.off('wake:detected');
      s.off('wake:started');
      s.off('wake:error');

      s.on('wake:detected', (data: { keyword: string; timestamp: string }) => {
        console.log('[WakeWord-Qwen] Detected:', data.keyword);
        setLastDetection(data.timestamp);
        onDetection?.();

        if (isCallActive?.()) {
          onInterrupt?.();
        } else {
          startCallRef.current?.(voiceId, personalityId, agentId);
        }
      });

      s.on('wake:started', () => {
        console.log('[WakeWord-Qwen] Server confirmed, listening');
        setIsListening(true);
        setIsSupported(true);
      });

      s.on('wake:error', (data: { message: string }) => {
        console.warn('[WakeWord-Qwen] Server error:', data.message);
        setError(data.message);
      });

      console.log('[WakeWord-Qwen] Emitting wake:start');
      s.emit('wake:start');
    } catch (err: any) {
      cleanupAudio();
      const msg = err.message || 'Failed to start wake word';
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        setError('Microphone permission denied. Please allow mic access.');
      } else {
        setError(msg);
      }
    }
  }, [voiceId, personalityId, agentId, startCallRef, cleanupAudio, onDetection, isCallActive, onInterrupt]);

  // ── Server-side mic wake detection (macOS unsigned app fallback) ──
  // When getUserMedia fails on macOS (unsigned Tauri app can't trigger TCC),
  // the server captures mic via ffmpeg/avfoundation and runs wake detection.

  const enableServerMicWake = useCallback(async () => {
    const s = socketRef.current;
    if (!s?.connected) {
      setError('Socket not connected — retrying...');
      return;
    }

    try {
      setError(null);
      console.log('[WakeWord-ServerMic] Using server-side microphone capture');

      s.off('wake:detected');
      s.off('wake:started');
      s.off('wake:error');

      s.on('wake:detected', (data: { keyword: string; timestamp: string }) => {
        console.log('[WakeWord-ServerMic] Detected:', data.keyword);
        setLastDetection(data.timestamp);
        onDetection?.();

        if (isCallActive?.()) {
          onInterrupt?.();
        } else {
          startCallRef.current?.(voiceId, personalityId, agentId);
        }
      });

      s.on('wake:started', () => {
        console.log('[WakeWord-ServerMic] Server confirmed, listening');
        setIsListening(true);
        setIsSupported(true);
      });

      s.on('wake:error', (data: { message: string }) => {
        console.warn('[WakeWord-ServerMic] Server error:', data.message);
        setError(data.message);
      });

      console.log('[WakeWord-ServerMic] Emitting wake:start_server_mic');
      s.emit('wake:start_server_mic');
    } catch (err: any) {
      setError(err.message || 'Failed to start server mic wake detection');
    }
  }, [voiceId, personalityId, agentId, startCallRef, onDetection, isCallActive, onInterrupt]);

  // ── Picovoice on-device detection (fallback) ──

  const enablePicovoice = useCallback(async () => {
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

      const detectionCallback = (_detection: any) => {
        setLastDetection(new Date().toISOString());
        onDetection?.();
        if (isCallActive?.()) {
          onInterrupt?.();
          return;
        }
        startCallRef.current?.();
      };

      let engine: any;
      const builtinKeyword = keywordMap[keyword];

      if (builtinKeyword) {
        engine = await Porcupine.create(
          accessKey,
          { builtin: builtinKeyword, sensitivity },
          detectionCallback,
          { publicPath: '/porcupine_params.pv' },
        );
      } else {
        const safeName = keyword.toLowerCase().replace(/\s+/g, '_').replace(/[^a-z0-9_]/g, '');
        const customPath = `/porcupine/${safeName}.ppn`;
        try {
          engine = await Porcupine.create(
            accessKey,
            { publicPath: customPath, label: keyword, sensitivity },
            detectionCallback,
            { publicPath: '/porcupine_params.pv' },
          );
        } catch {
          console.warn(`[WakeWord] Custom keyword "${keyword}" not found, falling back to "Jarvis"`);
          engine = await Porcupine.create(
            accessKey,
            { builtin: BuiltInKeyword.Jarvis, sensitivity },
            detectionCallback,
            { publicPath: '/porcupine_params.pv' },
          );
        }
      }

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
        } catch { /* ignore */ }
      };

      source.connect(processor);
      processor.connect(ctx.destination);
      setIsListening(true);
      setIsSupported(true);
    } catch (err: any) {
      cleanupAudio();
      const msg = err.message || 'Failed to initialize wake word';
      if (msg.includes('NotAllowedError') || msg.includes('Permission')) {
        setError('Microphone permission denied.');
      } else if (msg.includes('Porcupine') || msg.includes('Pv')) {
        setError(msg);
      } else {
        setError(msg);
      }
    }
  }, [accessKey, keyword, sensitivity, voiceId, personalityId, agentId, startCallRef, cleanupAudio]);

  const enable = useCallback(async () => {
    // Stop any existing session first
    disable();

    if (useServerMic) {
      console.log('[WakeWord] Using server mic (macOS Tauri workaround)');
      await enableServerMicWake();
    } else if (accessKey) {
      console.log('[WakeWord] Using Picovoice (on-device)');
      await enablePicovoice();
    } else if (socketRef.current?.connected) {
      console.log('[WakeWord] Using Qwen ASR (server-side)');
      await enableQwenWake();
    } else {
      console.log('[WakeWord] No Picovoice key and socket not connected, waiting...');
      setError('Waiting for connection...');
    }
  }, [accessKey, disable, enablePicovoice, enableQwenWake, enableServerMicWake]);

  // Auto-start / stop — includes socket state so it retries when connection becomes available
  useEffect(() => {
    console.log('[WakeWord] State change — enabled:', enabled, 'isListening:', isListening, 'socket:', !!socketRef.current?.connected);
    if (enabled && !isListening) {
      enable();
    } else if (!enabled && isListening) {
      disable();
    }
  }, [enabled, isListening, enable, disable, socket?.connected]);

  // Cleanup on unmount
  useEffect(() => {
    return () => { disable(); };
  }, []);

  return { isListening, isSupported, lastDetection, error, enable, disable };
}

export function savePicovoiceKey(key: string) {
  localStorage.setItem(PICOVOICE_ACCESS_KEY_STORAGE, key);
}

export function getPicovoiceKey(): string | null {
  return localStorage.getItem(PICOVOICE_ACCESS_KEY_STORAGE);
}
