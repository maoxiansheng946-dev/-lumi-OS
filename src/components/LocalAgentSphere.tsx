import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';
import { Mic, MicOff, Sparkles, Volume2, Box, User as UserIcon, Pause, Wifi, WifiOff, Clock } from 'lucide-react';
import { Button } from './ui/button';

export function LocalAgentSphere({
  t,
  onMessage,
  sentiment = 'default',
  callState = 'idle',
  audioLevel = 0,
  isMuted = false,
  elapsedSeconds = 0,
  connectionQuality = 'good',
  highPerformance = false,
  isWallpaperMode = false,
  onStartCall,
  onEndCall,
  onInterrupt,
  onToggleMute,
  reaction,
  handOpenness = 0,
  handPosition = { x: 0, y: 0 },
  gesture = 'none',
  handVisible = false,
  facePresent = false,
  gesturesDisabled = false,
  diffused = false,
  spatialMode: extMode,
  onSetSpatialMode,
}: {
  t: any;
  onMessage?: (text: string) => void;
  sentiment?: 'default' | 'excited' | 'focused' | 'zen';
  callState?: 'idle' | 'connecting' | 'listening' | 'thinking' | 'speaking' | 'queued' | 'passive';
  audioLevel?: number;
  isMuted?: boolean;
  elapsedSeconds?: number;
  connectionQuality?: 'good' | 'fair' | 'poor';
  highPerformance?: boolean;
  isWallpaperMode?: boolean;
  onStartCall?: () => void;
  onEndCall?: () => void;
  onInterrupt?: () => void;
  onToggleMute?: () => void;
  reaction?: string | null;
  handOpenness?: number;
  handPosition?: { x: number; y: number };
  gesture?: string;
  handVisible?: boolean;
  facePresent?: boolean;
  gesturesDisabled?: boolean;
  diffused?: boolean;
  spatialMode?: 'geometric' | 'humanoid';
  onSetSpatialMode?: (m: 'geometric' | 'humanoid') => void;
}) {
  const [interactionPulse, setInteractionPulse] = useState(0);
  const [reactionColor, setReactionColor] = useState('rgba(255,200,80,0.2)');

  useEffect(() => {
    if (reaction) {
      setInteractionPulse(p => p + 1);
      setReactionColor(
        reaction === 'failed' ? 'rgba(255,60,60,0.25)' :
        reaction === 'jump' ? 'rgba(80,255,120,0.2)' :
        'rgba(255,200,80,0.2)'
      );
    }
  }, [reaction]);

  const [_innerMode, _innerSetMode] = useState<'geometric' | 'humanoid'>('geometric');
  const spatialMode = extMode ?? _innerMode;
  const setSpatialMode = onSetSpatialMode ?? _innerSetMode;
  const mainCanvasRef = useRef<HTMLCanvasElement>(null);
  const portalCanvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const mouseRef = useRef({ x: 0, y: 0, isDown: false });
  const rotationRef = useRef({ x: 0, y: 0 });
  const particleCount = highPerformance ? 2200 : 800;

  // Shared particle array (both canvases read from it)
  const particlesRef = useRef<any[]>([]);

  // Gesture refs (synced to latest props)
  const opennessRef = useRef(0);
  const fingerDirRef = useRef({ x: 0, y: 0 });
  const handVisibleRef = useRef(false);
  const facePresentRef = useRef(false);
  const callStateRef = useRef(callState);
  const sentimentRef = useRef(sentiment);
  const audioLevelRef = useRef(audioLevel);
  const highPerfRef = useRef(highPerformance);

  useEffect(() => { opennessRef.current = handOpenness; }, [handOpenness]);
  useEffect(() => { fingerDirRef.current = handPosition; }, [handPosition]);
  useEffect(() => { handVisibleRef.current = handVisible; }, [handVisible]);
  useEffect(() => { facePresentRef.current = facePresent; }, [facePresent]);
  useEffect(() => { callStateRef.current = callState; }, [callState]);
  useEffect(() => { sentimentRef.current = sentiment; }, [sentiment]);
  useEffect(() => { audioLevelRef.current = audioLevel; }, [audioLevel]);
  useEffect(() => { highPerfRef.current = highPerformance; }, [highPerformance]);
  const disabledRef = useRef(gesturesDisabled);
  useEffect(() => { disabledRef.current = gesturesDisabled; }, [gesturesDisabled]);
  const diffusedRef = useRef(diffused);
  useEffect(() => { diffusedRef.current = diffused; }, [diffused]);
  const gestureRef = useRef(gesture);
  useEffect(() => { gestureRef.current = gesture; }, [gesture]);

  const handleSphereClick = () => setInteractionPulse(prev => prev + 1);

  // Particle class — shared between both canvases
  const sphereRadius = 180;

  class OrbParticle {
    x: number; y: number; z: number;
    baseX: number; baseY: number; baseZ: number;
    color: string; size: number; type: 'signal' | 'core' | 'void';

    constructor(mode: 'geometric' | 'humanoid') {
      if (mode === 'humanoid') {
        const rand = Math.random();
        if (rand < 0.2) {
          const u = Math.random(), v = Math.random();
          const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
          const r = Math.pow(Math.random(), 1/3) * 40;
          this.baseX = r * Math.sin(phi) * Math.cos(theta);
          this.baseY = r * Math.sin(phi) * Math.sin(theta) - 140;
          this.baseZ = r * Math.cos(phi);
        } else if (rand < 0.7) {
          this.baseX = (Math.random() - 0.5) * 80;
          this.baseY = (Math.random() - 0.5) * 120 - 40;
          this.baseZ = (Math.random() - 0.5) * 40;
        } else {
          this.baseX = (Math.random() - 0.5) * 140;
          this.baseY = (Math.random() - 0.5) * 180 + 40;
          this.baseZ = (Math.random() - 0.5) * 20;
        }
      } else {
        const u = Math.random(), v = Math.random();
        const theta = 2 * Math.PI * u, phi = Math.acos(2 * v - 1);
        const r = Math.pow(Math.random(), 1/3) * sphereRadius;
        this.baseX = r * Math.sin(phi) * Math.cos(theta);
        this.baseY = r * Math.sin(phi) * Math.sin(theta);
        this.baseZ = r * Math.cos(phi);
      }
      this.x = this.baseX; this.y = this.baseY; this.z = this.baseZ;
      const rand = Math.random();
      if (rand < 0.4) {
        this.type = 'signal';
        this.color = '#ff4d4d';
      } else if (rand < 0.8) {
        this.type = 'core'; this.color = '#ffffff';
      } else {
        this.type = 'void'; this.color = '#000000';
      }
      this.size = Math.random() * 1.5 + 0.5;
    }

    update(time: number, rotX: number, rotY: number, currentCallState: string, currentAudioLevel: number, sphereScale: number) {
      if (this.type === 'signal') {
        if (sphereScale > 1.8) {
          const hue = (Math.sin(time * 0.0005 + this.baseX * 0.03) * 30 + 195);
          this.color = `hsl(${hue}, 90%, 65%)`;
        } else {
          this.color = currentCallState === 'listening' ? '#ffcc00' : currentCallState === 'speaking' ? '#ffffff' : '#ff4d4d';
        }
      }
      const audioWave = currentAudioLevel * 50;
      const wave = Math.sin(time * 0.002 + (this.baseX + this.baseY + this.baseZ) * 0.01) * (15 + audioWave);
      const radialUnit = Math.sqrt(this.baseX ** 2 + this.baseY ** 2 + this.baseZ ** 2) + 0.001;
      const effectiveR = radialUnit * sphereScale + wave;
      const rFactor = effectiveR / radialUnit;
      let tx = this.baseX * rFactor;
      let ty = this.baseY * rFactor;
      let tz = this.baseZ * rFactor;
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);
      const y1 = ty * cosX - tz * sinX;
      const z1 = ty * sinX + tz * cosX;
      ty = y1; tz = z1;
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      const x2 = tx * cosY + tz * sinY;
      const z2 = -tx * sinY + tz * cosY;
      tx = x2; tz = z2;
      this.x = tx; this.y = ty; this.z = tz;
    }

    drawLocal(ctx: CanvasRenderingContext2D, cx: number, cy: number, isDispersed: boolean) {
      const pz = Math.max(-300, Math.min(this.z, 590));
      const perspective = 600 / (600 - pz);
      const x = this.x * perspective + cx;
      const y = this.y * perspective + cy;
      const size = this.size * perspective;
      if (this.color === '#000000') {
        ctx.globalAlpha = 1;
        ctx.strokeStyle = 'rgba(255,255,255,0.2)';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = this.color;
        ctx.globalAlpha = Math.max(0.1, perspective - 0.4);
        ctx.beginPath(); ctx.arc(x, y, size, 0, Math.PI * 2); ctx.fill();
        if (isDispersed && this.type === 'signal') {
          ctx.globalAlpha = Math.max(0.03, (perspective - 0.4) * 0.3);
          ctx.beginPath(); ctx.arc(x, y, size * 2.5, 0, Math.PI * 2); ctx.fill();
        }
      }
    }

    drawPortal(ctx: CanvasRenderingContext2D, screenCx: number, screenCy: number, scale: number) {
      const pz = Math.max(-300, Math.min(this.z, 590));
      const perspective = 600 / (600 - pz);
      const dx = this.x * perspective;
      const dy = this.y * perspective;
      const sx = screenCx + dx * scale;
      const sy = screenCy + dy * scale;
      const size = this.size * perspective * scale;
      if (size < 0.3) return;
      if (this.color === '#000000') {
        ctx.strokeStyle = 'rgba(255,255,255,0.15)';
        ctx.lineWidth = 0.5;
        ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.stroke();
      } else {
        ctx.fillStyle = this.color;
        ctx.beginPath(); ctx.arc(sx, sy, size, 0, Math.PI * 2); ctx.fill();
      }
    }
  }

  // Initialize particles when spatialMode changes
  useEffect(() => {
    const ptcls: OrbParticle[] = [];
    for (let i = 0; i < particleCount; i++) ptcls.push(new OrbParticle(spatialMode));
    particlesRef.current = ptcls;
  }, [spatialMode, particleCount]);

  // === Unified rAF loop: updates particles once, renders to BOTH canvases ===
  useEffect(() => {
    const mainCanvas = mainCanvasRef.current;
    if (!mainCanvas) return;
    const mainCtx = mainCanvas.getContext('2d');
    if (!mainCtx) return;

    let animId: number;
    const sphereScaleRef = { current: 1 };

    const render = (time: number) => {
      try {
        // ---- Update & render main canvas ----
        mainCtx.clearRect(0, 0, mainCanvas.width, mainCanvas.height);
        const centerX = mainCanvas.width / 2;
        const centerY = mainCanvas.height / 2;

        const currentCallState = callStateRef.current;
        const isCallActive = currentCallState !== 'idle';

        // Sphere scale: toggle by gesture (open→big, fist→normal)
        if (disabledRef.current) {
          sphereScaleRef.current += (1 - sphereScaleRef.current) * 0.05;
        } else {
          const targetScale = isCallActive ? 1 : diffusedRef.current ? 4.0 : 1;
          const lerpRate = 0.04;
          sphereScaleRef.current += (targetScale - sphereScaleRef.current) * lerpRate;
        }
        const sphereScale = sphereScaleRef.current;

        // Rotation: finger-point driven or auto-rotate
        if (!mouseRef.current.isDown) {
          if (gestureRef.current === 'point') {
            const fd = fingerDirRef.current;
            rotationRef.current.y += fd.x * 0.015;
            rotationRef.current.x += fd.y * 0.015;
          } else {
            const speedFactor = currentCallState === 'thinking' ? 4 : sentimentRef.current === 'excited' ? 3 : sentimentRef.current === 'focused' ? 2 : sentimentRef.current === 'zen' ? 0.5 : 1;
            rotationRef.current.y += 0.005 * speedFactor;
            rotationRef.current.x += 0.002 * speedFactor;
          }
        }

        const pts = particlesRef.current;
        if (pts.length === 0) { animId = requestAnimationFrame(render); return; }

        const isParticleSea = sphereScale > 2.0;

        // Face present glow — warm breathing pulse around orb
        if (facePresentRef.current) {
          const pulse = 0.06 + Math.sin(time * 0.003) * 0.02;
          const glow = mainCtx.createRadialGradient(centerX, centerY, 100, centerX, centerY, 260);
          glow.addColorStop(0, `rgba(255,200,100,${pulse.toFixed(3)})`);
          glow.addColorStop(0.5, `rgba(255,180,60,${(pulse * 0.5).toFixed(3)})`);
          glow.addColorStop(1, 'rgba(255,150,30,0)');
          mainCtx.fillStyle = glow;
          mainCtx.fillRect(centerX - 260, centerY - 260, 520, 520);
        }

        // Update particles
        for (const p of pts) {
          p.update(time, rotationRef.current.x, rotationRef.current.y, currentCallState, audioLevelRef.current, sphereScale);
        }

        // Sort for proper z-ordering
        pts.sort((a, b) => a.z - b.z);

        // Connection lines (particle sea) — main canvas only
        if (isParticleSea) {
          const projected: { x: number; y: number }[] = [];
          for (const p of pts) {
            const pz = Math.max(-300, Math.min(p.z, 590));
            const perspective = 600 / (600 - pz);
            projected.push({ x: p.x * perspective + centerX, y: p.y * perspective + centerY });
          }
          const checkRange = Math.min(15, pts.length - 1);
          const threshold = 60 + (sphereScale - 1) * 80;
          for (let i = 0; i < pts.length; i++) {
            const pi = projected[i];
            for (let j = i + 1; j <= i + checkRange && j < pts.length; j++) {
              const pj = projected[j];
              const dist = Math.hypot(pi.x - pj.x, pi.y - pj.y);
              if (dist < threshold) {
                const alpha = (1 - dist / threshold) * (sphereScale - 1) * 0.25;
                mainCtx.strokeStyle = `rgba(0,200,255,${alpha.toFixed(2)})`;
                mainCtx.lineWidth = 0.4;
                mainCtx.beginPath(); mainCtx.moveTo(pi.x, pi.y); mainCtx.lineTo(pj.x, pj.y); mainCtx.stroke();
              }
            }
          }
        }

        // Draw particles on main canvas
        for (const p of pts) {
          p.drawLocal(mainCtx, centerX, centerY, isParticleSea);
        }
        mainCtx.globalAlpha = 1;

        // ---- Render portal canvas (sphere overflow beyond container) ----
        if (!disabledRef.current) {
          const portalCanvas = portalCanvasRef.current;
          if (portalCanvas) {
            const portalCtx = portalCanvas.getContext('2d');
            if (portalCtx) {
              if (portalCanvas.width !== window.innerWidth || portalCanvas.height !== window.innerHeight) {
                portalCanvas.width = window.innerWidth;
                portalCanvas.height = window.innerHeight;
              }

              const rect = containerRef.current?.getBoundingClientRect();
              const pcx = rect ? rect.left + rect.width / 2 : window.innerWidth / 2;
              const pcy = rect ? rect.top + rect.height / 2 : window.innerHeight / 2;

              if (sphereScale > 1.05) {
                // Pure black background
                portalCtx.fillStyle = '#000000';
                portalCtx.fillRect(0, 0, portalCanvas.width, portalCanvas.height);
                const containerWidth = rect ? rect.width : 500;
                const portalScale = containerWidth / 600;

                // Compute projected positions
                const projected: { sx: number; sy: number }[] = [];
                for (const p of pts) {
                  const ppz = Math.max(-300, Math.min(p.z, 590));
                  const pp = 600 / (600 - ppz);
                  projected.push({
                    sx: pcx + p.x * pp * portalScale,
                    sy: pcy + p.y * pp * portalScale,
                  });
                }

                // Connection lines (particle sea)
                const connThreshold = 50 + (sphereScale - 1) * 70;
                const checkRange = Math.min(12, pts.length - 1);
                for (let i = 0; i < pts.length; i++) {
                  const pi = projected[i];
                  for (let j = i + 1; j <= i + checkRange && j < pts.length; j++) {
                    const pj = projected[j];
                    const dist = Math.hypot(pi.sx - pj.sx, pi.sy - pj.sy);
                    if (dist < connThreshold) {
                      const a = (1 - dist / connThreshold) * (sphereScale - 1) * 0.18;
                      portalCtx.strokeStyle = `rgba(0,200,255,${a.toFixed(3)})`;
                      portalCtx.lineWidth = 0.3;
                      portalCtx.beginPath();
                      portalCtx.moveTo(pi.sx, pi.sy);
                      portalCtx.lineTo(pj.sx, pj.sy);
                      portalCtx.stroke();
                    }
                  }
                }

                // Draw particles
                for (const p of pts) {
                  p.drawPortal(portalCtx, pcx, pcy, portalScale);
                }
              } else {
                portalCtx.clearRect(0, 0, portalCanvas.width, portalCanvas.height);
              }
            }
          }
        }
      } catch (e) {
        // never let an exception kill the render loop
      }

      animId = requestAnimationFrame(render);
    };

    animId = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animId);
  }, []);

  // Portal to document.body — escapes CSS transform ancestors (only when gestures active)
  const portal = gesturesDisabled ? null : createPortal(
    <canvas
      ref={portalCanvasRef}
      width={window.innerWidth}
      height={window.innerHeight}
      className="fixed inset-0 z-[1] pointer-events-none"
    />,
    document.body,
  );

  // Mouse/touch handlers
  const handleMouseDown = (e: React.MouseEvent | React.TouchEvent) => {
    mouseRef.current.isDown = true;
    const pos = 'touches' in e ? e.touches[0] : e;
    mouseRef.current.x = pos.clientX;
    mouseRef.current.y = pos.clientY;
  };
  const handleMouseMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!mouseRef.current.isDown) return;
    const pos = 'touches' in e ? e.touches[0] : e;
    const dx = pos.clientX - mouseRef.current.x;
    const dy = pos.clientY - mouseRef.current.y;
    rotationRef.current.y += dx * 0.01;
    rotationRef.current.x -= dy * 0.01;
    mouseRef.current.x = pos.clientX;
    mouseRef.current.y = pos.clientY;
  };
  const handleMouseUp = () => { mouseRef.current.isDown = false; };

  return (
    <>
      {portal}
      <div className={`relative w-full flex flex-col items-center justify-center py-20 transition-all duration-1000 ${isWallpaperMode ? 'opacity-40 scale-[0.8] blur-[1px]' : 'opacity-100 scale-100'}`}>
        <div className={`absolute inset-0 bg-gradient-to-b from-red-500/5 via-transparent to-transparent pointer-events-none transition-opacity ${isWallpaperMode ? 'opacity-0' : 'opacity-100'}`} />

        <div
          ref={containerRef}
          className="relative w-80 h-80 md:w-[500px] md:h-[500px] flex items-center justify-center cursor-grab active:cursor-grabbing group"
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          onTouchStart={handleMouseDown}
          onTouchMove={handleMouseMove}
          onTouchEnd={handleMouseUp}
          onClick={handleSphereClick}
        >
          <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
            <motion.div
              className="absolute w-64 h-64 md:w-96 md:h-96 rounded-full bg-red-500 blur-[80px] opacity-10 will-change-transform"
              animate={{ scale: [1, 1.1, 1] }}
              transition={{ duration: 5, repeat: Infinity }}
            />
          </div>

          <canvas
            ref={mainCanvasRef}
            width={600}
            height={600}
            className="relative z-10 pointer-events-none"
            style={{ width: '100%', height: '100%' }}
          />

          <AnimatePresence>
            {[...Array(2)].map((_, i) => (
              <motion.div
                key={`${interactionPulse}-${i}`}
                className="absolute inset-0 rounded-full border pointer-events-none will-change-transform"
                style={{ borderColor: reactionColor }}
                initial={{ scale: 0.5, opacity: 0 }}
                animate={{ scale: 1.5, opacity: 0 }}
                transition={{ duration: 1.5, delay: i * 0.3 }}
              />
            ))}
          </AnimatePresence>

          <motion.div
            className="absolute inset-[-40px] rounded-full border border-white/5 border-dashed pointer-events-none will-change-transform"
            animate={{ rotate: 360 }}
            transition={{ duration: 60, repeat: Infinity, ease: "linear" }}
          />
        </div>

        {/* Controls */}
        <div className="mt-12 flex flex-col items-center gap-6 z-10">
          <div className="flex items-center gap-4 p-1 bg-white/5 rounded-2xl border border-white/10">
            <button
              onClick={() => setSpatialMode('geometric')}
              className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${
                spatialMode === 'geometric' ? 'bg-celestial-saturn text-black' : 'text-white/40 hover:text-white'
              }`}
            >
              <Box size={14} />
              {t.geometric || 'Geometric'}
            </button>
            <button
              onClick={() => setSpatialMode('humanoid')}
              className={`px-4 py-2 rounded-xl text-[10px] font-bold uppercase tracking-widest flex items-center gap-2 transition-all ${
                spatialMode === 'humanoid' ? 'bg-celestial-saturn text-black' : 'text-white/40 hover:text-white'
              }`}
            >
              <UserIcon size={14} />
              {t.humanoid || 'Humanoid'}
            </button>
          </div>

          <div className="flex items-center gap-3">
            {callState !== 'idle' && onToggleMute && (
              <Button
                onClick={onToggleMute}
                className={`w-10 h-10 rounded-full flex items-center justify-center transition-all duration-300 ${
                  isMuted ? 'bg-amber-500 text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'
                }`}
                title={isMuted ? (t.voiceUnmuted || 'Unmute') : (t.voiceMuted || 'Mute')}
              >
                {isMuted ? <MicOff size={18} /> : <Mic size={18} />}
              </Button>
            )}

            <Button
              onClick={callState === 'idle' ? onStartCall : onEndCall}
              className={`w-16 h-16 rounded-full flex items-center justify-center transition-all duration-500 ${
                callState !== 'idle'
                  ? 'bg-red-500 text-white shadow-[0_0_30px_rgba(239,68,68,0.5)] scale-110'
                  : 'bg-white/5 text-white/60 hover:bg-white/10'
              }`}
            >
              {callState !== 'idle' ? <Mic size={24} className="animate-pulse" /> : <MicOff size={24} />}
            </Button>

            {(callState === 'speaking' || callState === 'thinking') && onInterrupt && (
              <Button
                onClick={onInterrupt}
                className="w-10 h-10 rounded-full bg-white/10 text-white/60 hover:bg-white/20 flex items-center justify-center transition-all duration-300"
                title={t.voiceInterrupt || "Interrupt"}
              >
                <Pause size={18} />
              </Button>
            )}

            <div className="flex flex-col">
              <span className="text-xs font-bold uppercase tracking-widest text-white/40">
                {callState === 'listening' ? t.listening : callState === 'thinking' ? t.processing : callState === 'speaking' ? t.speaking : callState === 'idle' ? t.voiceInteract : callState === 'passive' ? (t.passive || 'Passive') : callState.toUpperCase()}
              </span>
              <span className="text-sm font-medium text-white/80">
                {callState === 'idle' ? (t.clickToStartSession || "Click to start voice session") : (t.sessionActiveClickToEnd || "Session active - Click to end")}
              </span>
              {callState !== 'idle' && (
                <div className="flex items-center gap-2 mt-1">
                  <Clock size={10} className="text-white/40" />
                  <span className="text-[10px] text-white/40 tabular-nums">
                    {String(Math.floor(elapsedSeconds / 60)).padStart(2, '0')}:{String(elapsedSeconds % 60).padStart(2, '0')}
                  </span>
                  {connectionQuality === 'good' && <Wifi size={10} className="text-emerald-400" />}
                  {connectionQuality === 'fair' && <Wifi size={10} className="text-amber-400" />}
                  {connectionQuality === 'poor' && <WifiOff size={10} className="text-red-400" />}
                </div>
              )}
            </div>
          </div>

          <AnimatePresence>
            {callState !== 'idle' && (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 10 }}
                className="flex gap-1"
              >
                {[...Array(5)].map((_, i) => (
                  <motion.div
                    key={i}
                    className="w-1 bg-red-500 rounded-full"
                    style={{ height: 30 }}
                    animate={{
                      scaleY: callState === 'listening' ? [0.33, 1, 0.33] : [0.33, 0.5, 0.33],
                    }}
                    transition={{
                      duration: 0.5,
                      repeat: Infinity,
                      delay: i * 0.1,
                    }}
                  />
                ))}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </div>
    </>
  );
}
