import { useState, useRef, useCallback, useEffect } from 'react';

export type CallState = 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'queued';

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
  const audioQueueContext = useRef<AudioContext | null>(null);
  const callStartTime = useRef<number>(0);
  const timerInterval = useRef<ReturnType<typeof setInterval> | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);

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
    isTtsPlaying.current = false;
    // Re-enable mic track
    if (streamRef.current) {
      streamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });
    }
  }, []);

  const audioQueue = useRef<ArrayBuffer[]>([]);

  useEffect(() => {
    if (!socket) return;

    socket.on('audio:status', (data: { status: string }) => {
      const map: Record<string, CallState> = {
        listening: 'listening',
        thinking: 'thinking',
        speaking: 'speaking',
        queued: 'queued',
        idle: 'idle',
      };
      setCallState(map[data.status] || 'idle');
    });

    const playAudioChunk = (buffer: ArrayBuffer) => {
      if (!isCallActive.current) return;
      try {
        isTtsPlaying.current = true;
        if (streamRef.current) {
          streamRef.current.getAudioTracks().forEach(t => { t.enabled = false; });
        }

        const blob = new Blob([buffer], { type: 'audio/mp3' });
        const url = URL.createObjectURL(blob);
        const audio = new Audio(url);

        const onDone = () => {
          isTtsPlaying.current = false;
          if (streamRef.current) {
            streamRef.current.getAudioTracks().forEach(t => { t.enabled = true; });
          }
          URL.revokeObjectURL(url);
          audioElementRef.current = null;
          // Play next queued chunk
          if (audioQueue.current.length > 0) {
            const next = audioQueue.current.shift()!;
            playAudioChunk(next);
          }
        };

        audio.onended = () => onDone();
        audio.onerror = () => onDone();

        audioElementRef.current = audio;
        audio.play();
      } catch (err) {
        console.error('[VoiceCall] Audio play failed:', err);
        isTtsPlaying.current = false;
      }
    };

    socket.on('audio:response', (buffer: ArrayBuffer) => {
      if (!isCallActive.current) { console.log('[VoiceCall] Ignoring audio:response, call ended'); return; }
      if (audioElementRef.current && !audioElementRef.current.paused) {
        // Currently playing — queue this chunk
        audioQueue.current.push(buffer);
        return;
      }
      playAudioChunk(buffer);
    });

    socket.on('audio:transcript', (data: { text: string; isFinal: boolean }) => {
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

    return () => {
      socket.off('audio:status');
      socket.off('audio:response');
      socket.off('audio:transcript');
      socket.off('agent:response');
      socket.off('audio:error');
      socket.off('audio:interrupt-ack');
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
        if (isTtsPlaying.current) return; // Don't capture mic while TTS is playing
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

      isCallActive.current = true;
      callStartTime.current = Date.now();
      timerInterval.current = setInterval(() => {
        setElapsedSeconds(Math.floor((Date.now() - callStartTime.current) / 1000));
      }, 1000);
      socket.emit('audio:start', { voiceId, personalityId, agentId });
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

  const endCall = useCallback(() => {
    isCallActive.current = false;
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
  }, [socket, stopAllPlayback]);

  // Detect interruption: only allow interrupt when TTS audio is actually playing
  useEffect(() => {
    const threshold = 0.15;
    if (
      audioLevel > threshold &&
      isTtsPlaying.current &&
      (callState === 'speaking' || callState === 'thinking')
    ) {
      interrupt();
    }
  }, [audioLevel, callState, interrupt]);

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
