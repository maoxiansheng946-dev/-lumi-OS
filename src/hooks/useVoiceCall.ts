import { useState, useRef, useCallback, useEffect } from 'react';
import { isTauriRuntime } from '../services/apiBridge';

const isMacOS = typeof navigator !== 'undefined' && navigator.userAgent.includes('Mac');
const isTauri = isTauriRuntime();
const useServerMic = isMacOS && isTauri;

export type CallState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'queued' | 'passive';

interface UseVoiceCallOptions {
  socket: any;
  onTranscript?: (text: string, isFinal: boolean) => void;
  onResponse?: (text: string) => void;
}

export function useVoiceCall({ socket, onTranscript, onResponse }: UseVoiceCallOptions) {
  const [callState, setCallState] = useState<CallState>('idle');
  const [audioLevel, setAudioLevel] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<string>('');
  const [responseText, setResponseText] = useState<string>('');
  const [isMuted, setIsMuted] = useState(false);
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [connectionQuality, setConnectionQuality] = useState<'good' | 'fair' | 'poor'>('good');

  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const animationFrame = useRef<number>(0);
  const pendingAudio = useRef<ArrayBuffer[]>([]);
  const isPlaying = useRef(false);
  const playbackSource = useRef<AudioBufferSourceNode | null>(null);
  const proactiveSource = useRef<AudioBufferSourceNode | null>(null);
  const proactiveContext = useRef<AudioContext | null>(null);
  const audioQueueContext = useRef<AudioContext | null>(null);
  const callStartTime = useRef<number>(0);
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const passiveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const disconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const prevCallState = useRef<CallState>('idle');

  const updateAudioLevel = useCallback(() => {
    if (!analyser.current) return;
    const dataArray = new Uint8Array(analyser.current.frequencyBinCount);
    analyser.current.getByteTimeDomainData(dataArray);
    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const v = (dataArray[i] - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / dataArray.length);
    setAudioLevel(rms);
    animationFrame.current = requestAnimationFrame(updateAudioLevel);
  }, []);

  // Play audio buffer queue
  const playNextInQueue = useCallback(() => {
    if (isPlaying.current || pendingAudio.current.length === 0) return;

    const buffer = pendingAudio.current.shift()!;
    console.log('[VoiceCall] Playing audio chunk, size:', buffer.byteLength, 'remaining:', pendingAudio.current.length);
    isPlaying.current = true;

    if (!audioQueueContext.current) {
      audioQueueContext.current = new AudioContext();
      // Resume if suspended by autoplay policy
      if (audioQueueContext.current.state === 'suspended') {
        audioQueueContext.current.resume();
      }
      console.log('[VoiceCall] Created AudioContext, state:', audioQueueContext.current.state);
    }

    // Ensure context is running before decoding
    if (audioQueueContext.current.state === 'suspended') {
      audioQueueContext.current.resume();
    }

    audioQueueContext.current.decodeAudioData(buffer.slice(0), (decoded) => {
      console.log('[VoiceCall] Audio decoded, duration:', decoded.duration, 'sampleRate:', decoded.sampleRate);
      if (playbackSource.current) {
        try { playbackSource.current.stop(); } catch {}
      }

      const source = audioQueueContext.current!.createBufferSource();
      source.buffer = decoded;
      source.connect(audioQueueContext.current!.destination);
      playbackSource.current = source;

      source.onended = () => {
        console.log('[VoiceCall] Playback ended');
        isPlaying.current = false;
        playbackStartTime.current = 0;
        playbackSource.current = null;
        if (pendingAudio.current.length > 0) {
          playNextInQueue();
        }
      };

      source.start(0);
      playbackStartTime.current = Date.now();
      console.log('[VoiceCall] Playback started, interrupt enabled in 1.5s');
    }, (err) => {
      console.error('[VoiceCall] Decode failed:', err);
      isPlaying.current = false;
      playbackStartTime.current = 0;
      if (pendingAudio.current.length > 0) playNextInQueue();
    });
  }, []);

  const audioElementRef = useRef<HTMLAudioElement | null>(null);
  const isTtsPlaying = useRef(false);
  const isCallActive = useRef(false);
  const playbackStartTime = useRef(0);
  // Streaming TTS: pre-buffer and cross-fade to eliminate gaps between chunks
  const ttsContext = useRef<AudioContext | null>(null);
  const ttsGainNode = useRef<GainNode | null>(null);
  const ttsSourceRef = useRef<AudioBufferSourceNode | null>(null);
  const nextStartTime = useRef(0);  // When the next chunk should start playing
  const pendingDecodes = useRef(0);

  const ensureTtsContext = useCallback(() => {
    if (!ttsContext.current) {
      ttsContext.current = new AudioContext();
      ttsGainNode.current = ttsContext.current.createGain();
      ttsGainNode.current.connect(ttsContext.current.destination);
      if (ttsContext.current.state === 'suspended') {
        ttsContext.current.resume();
      }
      nextStartTime.current = 0;
    }
    return ttsContext.current;
  }, []);

  const stopAllPlayback = useCallback(() => {
    // Stop queue-based playback
    if (playbackSource.current) {
      try { playbackSource.current.stop(); } catch {}
      playbackSource.current = null;
    }
    pendingAudio.current = [];
    isPlaying.current = false;
    playbackStartTime.current = 0;
    // Clear sentence audio queue
    audioQueue.current = [];
    // Stop direct Audio element
    if (audioElementRef.current) {
      try {
        audioElementRef.current.pause();
        URL.revokeObjectURL(audioElementRef.current.src);
      } catch {}
      audioElementRef.current = null;
    }
    // Stop proactive speech (greetings, check-ins) — now interruptible
    if (proactiveSource.current) {
      try { proactiveSource.current.stop(); } catch {}
      proactiveSource.current = null;
    }
    if (proactiveContext.current) {
      try { proactiveContext.current.close(); } catch {}
      proactiveContext.current = null;
    }
    // Stop currently playing TTS source
    if (ttsSourceRef.current) {
      try { ttsSourceRef.current.stop(); } catch {}
      ttsSourceRef.current = null;
    }
    // Reset streaming TTS context
    if (ttsContext.current) {
      nextStartTime.current = 0;
      if (ttsGainNode.current) {
        ttsGainNode.current.gain.value = 1.0;
      }
    }
    isTtsPlaying.current = false;
  }, []);

  const audioQueue = useRef<Array<ArrayBuffer | { buffer: ArrayBuffer; volumeGain?: number }>>([]);

  useEffect(() => {
    if (!socket) return;

    socket.on('audio:status', (data: { status: string }) => {
      const map: Record<string, CallState> = {
        listening: 'listening',
        thinking: 'thinking',
        speaking: 'speaking',
        queued: 'queued',
        idle: 'idle',
        passive: 'passive',
      };
      const next = map[data.status] || 'idle';
      setCallState(prev => {
        // Start passive timer when transitioning to listening (server waiting for speech)
        if (next === 'listening' && prev !== 'listening') {
          if (passiveTimer.current) { clearTimeout(passiveTimer.current); passiveTimer.current = null; }
          if (disconnectTimer.current) { clearTimeout(disconnectTimer.current); disconnectTimer.current = null; }
          const alwaysOn = localStorage.getItem('lumi_always_on_voice') === 'true';
          const passiveDelay = alwaysOn ? 5 * 60 * 1000 : 15 * 1000;   // 5min in always-on, 15s default
          passiveTimer.current = setTimeout(() => {
            setCallState('passive');
            if (!alwaysOn) {
              disconnectTimer.current = setTimeout(() => {
                endCall();
              }, 5 * 60 * 1000);
            }
            // In always-on mode, never auto-disconnect — stay passive until user speaks or manually ends
          }, passiveDelay);
        }
        prevCallState.current = next;
        return next;
      });
    });

    /**
     * Play a TTS audio chunk using Web Audio API with cross-fade scheduling.
     * Pre-buffers: starts decoding while the previous chunk is still playing.
     * Cross-fade: overlaps the last 50ms of previous audio with the first 50ms of next.
     * VolumeGain: applies server-computed volume adaptation.
     */
    const playAudioChunk = (buffer: ArrayBuffer, volumeGain?: number) => {
      if (!isCallActive.current) return;
      const ctx = ensureTtsContext();
      isTtsPlaying.current = true;

      ctx.decodeAudioData(buffer.slice(0), (decoded) => {
        if (!isCallActive.current) return;
        const now = ctx.currentTime;

        // When to start this chunk: right after the previous one, minus cross-fade overlap
        const crossFadeSec = 0.05; // 50ms cross-fade
        const effectiveStart = nextStartTime.current > 0
          ? Math.max(now, nextStartTime.current - crossFadeSec)
          : now;
        nextStartTime.current = effectiveStart + decoded.duration;

        const source = ctx.createBufferSource();
        source.buffer = decoded;

        // Volume: apply server-computed gain, default 1.0
        const gain = typeof volumeGain === 'number' ? Math.max(0.3, Math.min(1.5, volumeGain)) : 1.0;
        if (ttsGainNode.current) {
          ttsGainNode.current.gain.setValueAtTime(gain, effectiveStart);
        }

        source.connect(ttsGainNode.current!);
        ttsSourceRef.current = source;

        source.onended = () => {
          ttsSourceRef.current = null;
          // Check if more chunks are queued
          if (audioQueue.current.length > 0) {
            const next = audioQueue.current.shift()!;
            const nextGain = typeof next === 'object' ? (next as any).volumeGain : undefined;
            const nextBuffer = typeof next === 'object' ? (next as any).buffer : next;
            playAudioChunk(nextBuffer, nextGain);
          } else {
            isTtsPlaying.current = false;
          }
        };

        source.start(effectiveStart);
      }, (err) => {
        console.error('[VoiceCall] Decode failed:', err);
        isTtsPlaying.current = false;
        if (audioQueue.current.length > 0) {
          const next = audioQueue.current.shift()!;
          const nextBuffer = typeof next === 'object' ? (next as any).buffer : next;
          playAudioChunk(nextBuffer);
        }
      });
    };

    // Handle both old format (raw ArrayBuffer) and new format ({ buffer, volumeGain })
    socket.on('audio:response', (data: ArrayBuffer | { buffer: ArrayBuffer; volumeGain?: number }) => {
      if (!isCallActive.current) { console.log('[VoiceCall] Ignoring audio:response, call ended'); return; }
      const actualBuffer = data instanceof ArrayBuffer ? data : data.buffer;
      const actualGain = data instanceof ArrayBuffer ? undefined : data.volumeGain;

      if (isTtsPlaying.current) {
        // Currently playing — queue this chunk
        audioQueue.current.push(data instanceof ArrayBuffer ? data : { buffer: actualBuffer, volumeGain: actualGain });
        return;
      }
      playAudioChunk(actualBuffer, actualGain);
    });

    socket.on('audio:transcript', (data: { text: string; isFinal: boolean }) => {
      // Reset passive timer — user is speaking
      if (passiveTimer.current) { clearTimeout(passiveTimer.current); passiveTimer.current = null; }
      if (disconnectTimer.current) { clearTimeout(disconnectTimer.current); disconnectTimer.current = null; }
      if (prevCallState.current === 'passive') setCallState('listening');
      setTranscript(data.text);
      onTranscript?.(data.text, data.isFinal);
      if (data.isFinal) {
        setTimeout(() => setTranscript(''), 2000); // Clear after 2s if final
      }
    });

    socket.on('agent:response', (data: { text: string }) => {
      setTranscript(''); // Clear user transcript when AI starts responding
      setResponseText(data.text);
      onResponse?.(data.text);
    });

    socket.on('audio:error', (data: { message: string }) => {
      setError(data.message);
      setCallState('idle');
    });

    socket.on('audio:interrupt-ack', () => {
      stopAllPlayback();
      setCallState('listening');
    });

    socket.on('audio:proactive_speak', (data: { audioBuffer: ArrayBuffer; text: string; timestamp: string }) => {
      try {
        // Stop any currently-playing proactive speech before starting new one
        if (proactiveSource.current) {
          try { proactiveSource.current.stop(); } catch {}
          proactiveSource.current = null;
        }
        if (proactiveContext.current) {
          try { proactiveContext.current.close(); } catch {}
          proactiveContext.current = null;
        }
        isTtsPlaying.current = true;
        const ctx = new AudioContext();
        proactiveContext.current = ctx;
        ctx.decodeAudioData(data.audioBuffer.slice(0), (decoded) => {
          const source = ctx.createBufferSource();
          proactiveSource.current = source;
          source.buffer = decoded;
          source.connect(ctx.destination);
          source.onended = () => {
            proactiveSource.current = null;
            proactiveContext.current = null;
            isTtsPlaying.current = false;
            ctx.close();
          };
          source.start(0);
        }, () => {
          proactiveSource.current = null;
          proactiveContext.current = null;
          isTtsPlaying.current = false;
          ctx.close();
        });
        // Briefly show speaking state for visual feedback
        const prev = prevCallState.current;
        setCallState('speaking');
        const duration = Math.max(2, (data.audioBuffer.byteLength / 16000) * 1000 + 500);
        setTimeout(() => {
          setCallState(prev);
          isTtsPlaying.current = false;
        }, duration);
      } catch (err) {
        console.error('[ProactiveVoice] Playback failed:', err);
        isTtsPlaying.current = false;
      }
    });

    return () => {
      socket.off('audio:status');
      socket.off('audio:response');
      socket.off('audio:transcript');
      socket.off('agent:response');
      socket.off('audio:error');
      socket.off('audio:interrupt-ack');
      socket.off('audio:proactive_speak');
    };
  }, [socket, onTranscript, onResponse, stopAllPlayback]);

  // Push audio emotion perception events when call state changes
  useEffect(() => {
    if (!socket?.connected || callState === 'idle' || callState === 'connecting') return;
    const emotionMap: Record<string, { emotion: string; intensity: number }> = {
      listening: { emotion: 'attentive', intensity: 0.4 },
      thinking: { emotion: 'focused', intensity: 0.6 },
      speaking: { emotion: 'engaged', intensity: 0.7 },
    };
    const entry = emotionMap[callState];
    if (entry) {
      socket.emit('perception:audio_emotion', entry);
    }
  }, [callState, socket]);

  const startCall = useCallback(async (voiceId?: string, personalityId: string = 'lumi', agentId?: string) => {
    try {
      setError(null);
      setCallState('connecting');

      if (useServerMic) {
        // macOS unsigned Tauri app can't access getUserMedia.
        // Server captures mic via ffmpeg/avfoundation and pipes to STT.
        console.log('[VoiceCall] Using server-side mic capture');
      } else {
        const stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          },
        });
        streamRef.current = stream;

        // Set up audio level monitoring (16000 Hz matches Deepgram linear16 config)
        audioContext.current = new AudioContext({ sampleRate: 16000 });
        const source = audioContext.current.createMediaStreamSource(stream);
        analyser.current = audioContext.current.createAnalyser();
        analyser.current.fftSize = 256;
        source.connect(analyser.current);
        updateAudioLevel();

        // Set up ScriptProcessorNode to capture raw PCM (linear16) for Deepgram
        const bufferSize = 4096;
        const scriptProcessor = audioContext.current.createScriptProcessor(bufferSize, 1, 1);

        scriptProcessor.onaudioprocess = (event) => {
          if (!socket?.connected) return;
          // Always send mic audio — server STT handles barge-in detection
          // Echo cancellation is in getUserMedia (echoCancellation: true)
          const input = event.inputBuffer.getChannelData(0);
          // Convert float32 [-1,1] to int16 PCM
          const int16 = new Int16Array(input.length);
          for (let i = 0; i < input.length; i++) {
            const s = Math.max(-1, Math.min(1, input[i]));
            int16[i] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          socket.emit('audio:chunk', new Uint8Array(int16.buffer));
        };

        source.connect(scriptProcessor);
        // Mute output to speakers to prevent feedback loop
        const zeroGain = audioContext.current.createGain();
        zeroGain.gain.value = 0;
        scriptProcessor.connect(zeroGain);
        zeroGain.connect(audioContext.current.destination);

        scriptProcessorRef.current = scriptProcessor;
      }

      isCallActive.current = true;
      callStartTime.current = Date.now();
      timerInterval.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - callStartTime.current) / 1000));
      }, 1000);
      socket.emit('audio:start', { voiceId, personalityId, agentId, useServerMic });
    } catch (err: any) {
      setError(err.message || 'Failed to start voice call');
      setCallState('idle');
    }
  }, [socket, updateAudioLevel]);

  const startCallRef = useRef(startCall);
  startCallRef.current = startCall;

  const interrupt = useCallback(() => {
    if (callState === 'speaking' || callState === 'thinking') {
      socket?.emit('audio:interrupt');
      stopAllPlayback();
    }
  }, [socket, callState, stopAllPlayback]);

  const toggleMute = useCallback(() => {
    setIsMuted(prev => {
      const next = !prev;
      if (streamRef.current) {
        streamRef.current.getAudioTracks().forEach(t => { t.enabled = !next; });
      }
      return next;
    });
  }, []);

  const clearPassiveTimers = useCallback(() => {
    if (passiveTimer.current) { clearTimeout(passiveTimer.current); passiveTimer.current = null; }
    if (disconnectTimer.current) { clearTimeout(disconnectTimer.current); disconnectTimer.current = null; }
  }, []);

  const endCall = useCallback(() => {
    isCallActive.current = false;
    clearPassiveTimers();
    socket?.emit('audio:stop');
    stopAllPlayback();

    if (streamRef.current) {
      streamRef.current.getTracks().forEach(t => t.stop());
      streamRef.current = null;
    }

    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    if (audioContext.current) {
      audioContext.current.close();
      audioContext.current = null;
    }

    if (timerInterval.current) {
      clearInterval(timerInterval.current);
      timerInterval.current = null;
    }

    isTtsPlaying.current = false;
    setIsMuted(false);
    setElapsedSeconds(0);

    cancelAnimationFrame(animationFrame.current);
    setCallState('idle');
    setAudioLevel(0);
  }, [socket, stopAllPlayback, clearPassiveTimers]);

  // Barge-in: detect user speaking over TTS via audio level
  useEffect(() => {
    const threshold = 0.12;
    if (
      audioLevel > threshold &&
      isTtsPlaying.current &&
      (callState === 'speaking' || callState === 'thinking')
    ) {
      socket?.emit('audio:interrupt');
      stopAllPlayback();
      setCallState('listening');
    }
  }, [audioLevel, callState, socket, stopAllPlayback]);

  // Monitor connection quality via socket latency
  useEffect(() => {
    if (!socket || callState === 'idle') return;
    const interval = setInterval(() => {
      const start = Date.now();
      const onPong = () => {
        const latency = Date.now() - start;
        if (latency < 150) setConnectionQuality('good');
        else if (latency < 400) setConnectionQuality('fair');
        else setConnectionQuality('poor');
      };
      if (socket.connected) {
        socket.emit('ping');
        socket.once('pong', onPong);
      } else {
        setConnectionQuality('poor');
      }
    }, 5000);
    return () => clearInterval(interval);
  }, [socket, callState]);

  // Report ambient noise level to server every 5s for environment-aware behavior
  useEffect(() => {
    if (!socket || callState === 'idle') return;
    const interval = setInterval(() => {
      socket.emit('ambient:noise_level', {
        rms: audioLevel,
        isSpeaking: isTtsPlaying.current,
        callState,
        timestamp: new Date().toISOString(),
      });
    }, 5000);
    return () => clearInterval(interval);
  }, [socket, callState, audioLevel]);

  return {
    callState,
    audioLevel,
    error,
    transcript,
    responseText,
    isMuted,
    elapsedSeconds,
    connectionQuality,
    startCall,
    startCallRef,
    endCall,
    interrupt,
    toggleMute,
    clearError: () => setError(null),
  };
}
