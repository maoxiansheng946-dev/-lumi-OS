import { motion } from 'motion/react';
import { useMusicPlayer, MusicLyricLine, MusicScene } from '../hooks/useMusicPlayer';
import { useMemo, useState, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';

// ── LRC parsing ──

function parseLRC(lrc: string): MusicLyricLine[] {
  if (!lrc) return [];
  const lines: MusicLyricLine[] = [];
  for (const line of lrc.split('\n')) {
    const m = line.match(/^\[(\d{2}):(\d{2})\.(\d{2,3})\](.*)$/);
    if (m) {
      const time = parseInt(m[1]) * 60 + parseInt(m[2]) + parseInt(m[3]) / (m[3].length === 3 ? 1000 : 100);
      const text = m[4].trim();
      if (text) lines.push({ time, text });
    }
  }
  return lines;
}

function getCurrentLyricIndex(lyrics: MusicLyricLine[], progress: number): number {
  for (let i = lyrics.length - 1; i >= 0; i--) if (progress >= lyrics[i].time) return i;
  return -1;
}

// ── Paper & ink palette ──

type InkPalette = {
  paper: string;
  paperR: number; paperG: number; paperB: number;
  accentR: number; accentG: number; accentB: number;
};

function paletteFromScene(scene: MusicScene | null): InkPalette {
  const v = scene?.emotion?.valence ?? 0.3;
  const a = scene?.emotion?.arousal ?? 0.5;
  const warmMix = Math.max(0, v);
  const coolMix = Math.max(0, -v);
  const paperR = Math.round(245 - coolMix * 12 + warmMix * 6);
  const paperG = Math.round(235 - coolMix * 6 - warmMix * 2);
  const paperB = Math.round(222 - coolMix * 2 - warmMix * 10);
  return {
    paper: `rgb(${paperR},${paperG},${paperB})`,
    paperR, paperG, paperB,
    accentR: 180 + Math.round(v * 50),
    accentG: 90 + Math.round(a * 80),
    accentB: 60 + Math.round(Math.abs(v) * 40),
  };
}

// ── Fast organic noise ──

function noise(x: number, y: number, t: number): number {
  return (
    Math.sin(x * 1.37 + t * 0.8) * Math.cos(y * 0.91 - t * 0.5) +
    Math.sin(x * 2.15 - y * 1.43 + t * 1.3) * 0.5 +
    Math.cos(x * 0.37 + y * 2.27 + t * 0.6) * 0.35 +
    Math.sin((x + y) * 1.73 + t * 0.9) * 0.25
  ) / 2.1;
}

interface InkParticle {
  x: number; y: number;
  vx: number; vy: number;
  life: number; maxLife: number;
  size: number;
}

const DEFAULT_SCENE: MusicScene = {
  colors: { bg: '#f3eadf', primary: '#2a2418', secondary: '#8f5f35', accent: '#b86b36' },
  scene: 'ambient',
  particles: 'dust',
  lyricsStyle: 'ink',
  intensity: 0.45,
  reason: 'Default local playback mood layer',
  terrainColors: ['#f3eadf', '#d8c4a8', '#8f5f35'],
  emotion: { valence: 0.25, arousal: 0.42 },
};

// ── Main ──

export function MusicMoodLayer() {
  const { visible, isPlaying, track, progress, duration, lyrics, scene, lumiReason, play, pause, hide } = useMusicPlayer();
  const activeScene = scene || DEFAULT_SCENE;

  const [parsedLyrics, setParsedLyrics] = useState<MusicLyricLine[]>([]);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const timeRef = useRef(0);
  const particlesRef = useRef<InkParticle[]>([]);
  const frameRef = useRef(0);

  useEffect(() => {
    if (lyrics.length > 0) setParsedLyrics(lyrics);
    else if (typeof (lyrics as any) === 'string') setParsedLyrics(parseLRC(lyrics as any));
  }, [lyrics]);

  const palette = useMemo(() => paletteFromScene(activeScene), [activeScene]);
  const intensity = activeScene.intensity ?? 0.5;
  const currentLyricIdx = useMemo(() => getCurrentLyricIndex(parsedLyrics, progress), [parsedLyrics, progress]);
  const emotionalNote = useMemo(() => {
    const note = (lumiReason || activeScene.reason || '').trim();
    return note && note !== DEFAULT_SCENE.reason ? note : '';
  }, [activeScene.reason, lumiReason]);

  // ── Keyboard ──
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === 'Escape') hide();
    if (e.key === ' ') { e.preventDefault(); isPlaying ? pause() : play(); }
  }, [hide, isPlaying, pause, play]);

  useEffect(() => {
    if (visible) {
      window.addEventListener('keydown', handleKeyDown);
      return () => window.removeEventListener('keydown', handleKeyDown);
    }
  }, [visible, handleKeyDown]);

  // ── Canvas render loop ──
  useEffect(() => {
    if (!visible || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d')!;
    let running = true;

    // Paper grain — pre-baked noise texture
    const grainCanvas = document.createElement('canvas');
    grainCanvas.width = 256; grainCanvas.height = 256;
    const gctx = grainCanvas.getContext('2d')!;
    const grainData = gctx.createImageData(256, 256);
    for (let i = 0; i < grainData.data.length; i += 4) {
      const v = Math.random() * 6;
      grainData.data[i] = grainData.data[i + 1] = grainData.data[i + 2] = v;
      grainData.data[i + 3] = 10;
    }
    gctx.putImageData(grainData, 0, 0);

    const render = () => {
      if (!running) return;
      const w = canvas.width = window.innerWidth;
      const h = canvas.height = window.innerHeight;
      const cx = w / 2, cy = h * 0.48;
      const t = timeRef.current;
      const dt = 1 / 60;
      timeRef.current += dt;

      // ── 1. Paper background ──
      ctx.fillStyle = palette.paper;
      ctx.fillRect(0, 0, w, h);
      for (let gx = 0; gx < w; gx += 256)
        for (let gy = 0; gy < h; gy += 256)
          ctx.drawImage(grainCanvas, gx, gy);
      const vg = ctx.createRadialGradient(cx, cy, Math.min(w, h) * 0.55, cx, cy, Math.max(w, h) * 0.8);
      vg.addColorStop(0, 'rgba(0,0,0,0)');
      vg.addColorStop(1, 'rgba(0,0,0,0.06)');
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, w, h);

      // ── 2. Ink mass ──
      const inkRadius = Math.min(w, h) * (0.18 + intensity * 0.08);
      const breathe = 1 + Math.sin(t * 0.7) * 0.06 * intensity + Math.sin(t * 1.3) * 0.04;

      // Halo wash
      const haloGrad = ctx.createRadialGradient(cx, cy, inkRadius * breathe * 0.6, cx, cy, inkRadius * breathe * 1.8);
      haloGrad.addColorStop(0, `rgba(${palette.accentR},${palette.accentG},${palette.accentB},0.06)`);
      haloGrad.addColorStop(0.5, `rgba(${palette.accentR},${palette.accentG},${palette.accentB},0.025)`);
      haloGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = haloGrad;
      ctx.fillRect(0, 0, w, h);

      // Mid-density blobs
      const rings = 14;
      for (let i = 0; i < rings; i++) {
        const a = (i / rings) * Math.PI * 2;
        const nd = noise(Math.cos(a) * 3 + t * 0.3, Math.sin(a) * 3 + t * 0.3, t * 0.2);
        const r = inkRadius * breathe * (0.65 + nd * 0.38);
        const ix = cx + Math.cos(a) * r * 0.35;
        const iy = cy + Math.sin(a) * r * 0.25;
        const bg = ctx.createRadialGradient(ix, iy, 0, ix, iy, r);
        bg.addColorStop(0, 'rgba(42,36,24,0.11)');
        bg.addColorStop(0.5, 'rgba(42,36,24,0.035)');
        bg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = bg;
        ctx.beginPath(); ctx.arc(ix, iy, r, 0, Math.PI * 2); ctx.fill();
      }

      // Core
      const coreGrad = ctx.createRadialGradient(cx, cy, 0, cx, cy, inkRadius * breathe * 0.6);
      coreGrad.addColorStop(0, 'rgba(34,28,16,0.68)');
      coreGrad.addColorStop(0.45, 'rgba(42,36,24,0.30)');
      coreGrad.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = coreGrad;
      ctx.beginPath(); ctx.arc(cx, cy, inkRadius * breathe * 0.6, 0, Math.PI * 2); ctx.fill();

      // Pulse ripple
      if (isPlaying) {
        const pulse = Math.abs(Math.sin(t * 1.8 + intensity * 3)) * 0.35 + 0.08;
        const rg = ctx.createRadialGradient(cx, cy, inkRadius * breathe * 0.25, cx, cy, inkRadius * breathe * (0.85 + pulse));
        rg.addColorStop(0, 'rgba(42,36,24,0.05)');
        rg.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = rg;
        ctx.fillRect(cx - inkRadius * 2, cy - inkRadius * 2, inkRadius * 4, inkRadius * 4);
      }

      // ── 3. Particles ──
      const rate = isPlaying ? intensity * 16 : 2;
      if (Math.random() < rate * dt * 10) {
        const a = Math.random() * Math.PI * 2;
        const d = inkRadius * breathe * (0.65 + Math.random() * 0.45);
        particlesRef.current.push({
          x: cx + Math.cos(a) * d,
          y: cy + Math.sin(a) * d,
          vx: Math.cos(a) * (0.2 + Math.random() * 0.7),
          vy: Math.sin(a) * (0.2 + Math.random() * 0.7) - 0.3,
          life: 1, maxLife: 0.8 + Math.random() * 2.2,
          size: 1 + Math.random() * 2.5,
        });
      }
      for (let i = particlesRef.current.length - 1; i >= 0; i--) {
        const p = particlesRef.current[i];
        p.life -= dt / p.maxLife;
        if (p.life <= 0) { particlesRef.current.splice(i, 1); continue; }
        p.x += p.vx * dt * 40; p.y += p.vy * dt * 40;
        p.vx *= 0.995; p.vy *= 0.995;
        const alpha = p.life * 0.2;
        ctx.fillStyle = `rgba(${palette.accentR},${palette.accentG},${palette.accentB},${alpha})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2); ctx.fill();
      }

      // ── 4. Lyrics ──
      if (parsedLyrics.length > 0 && currentLyricIdx >= 0) {
        const cl = parsedLyrics[currentLyricIdx];
        const pl = currentLyricIdx > 0 ? parsedLyrics[currentLyricIdx - 1] : null;
        const nl = currentLyricIdx < parsedLyrics.length - 1 ? parsedLyrics[currentLyricIdx + 1] : null;
        const lyricY = cy + inkRadius * breathe * 0.8 + 40;
        const fs = Math.min(w * 0.04, 28);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        if (pl) {
          ctx.font = `${fs * 0.72}px "STSong", "Songti SC", "SimSun", serif`;
          ctx.fillStyle = 'rgba(42,36,24,0.10)';
          ctx.fillText(pl.text, cx, lyricY - fs * 1.5);
        }
        if (nl) {
          ctx.font = `${fs * 0.65}px "STSong", "Songti SC", "SimSun", serif`;
          ctx.fillStyle = 'rgba(42,36,24,0.05)';
          ctx.fillText(nl.text, cx, lyricY + fs * 1.25);
        }
        // Current — with subtle ink bleed noise
        const bleed = Math.min(1, (progress - cl.time) / 1.5);
        const ca = 0.5 + bleed * 0.3;
        ctx.font = `${fs}px "STSong", "Songti SC", "SimSun", serif`;
        for (let s = 0; s < 3; s++) {
          const sx = cx + noise(cx * 0.01, lyricY * 0.01 + s, t * 0.5) * 2;
          const sy = lyricY + noise(cx * 0.01 + s, lyricY * 0.01, t * 0.5) * 1.5;
          ctx.fillStyle = `rgba(34,28,16,${ca * (0.06 + s * 0.03)})`;
          ctx.fillText(cl.text, sx, sy);
        }
        ctx.fillStyle = `rgba(34,28,16,${ca})`;
        ctx.fillText(cl.text, cx, lyricY);
      } else {
        const markY = cy + inkRadius * 0.8 + 30;
        ctx.font = `${Math.min(w * 0.045, 34)}px serif`;
        ctx.fillStyle = track ? 'rgba(42,36,24,0.06)' : 'rgba(42,36,24,0.10)';
        ctx.textAlign = 'center';
        ctx.fillText(track ? 'music' : 'standby', cx, markY);
      }

      // ── 5. Progress brush line ──
      const progressY = h - 55;
      const pct = duration > 0 ? progress / duration : 0;
      const sw = w * 0.50;
      const sx = (w - sw) / 2;
      const segs = 50;

      // Background line
      ctx.strokeStyle = 'rgba(42,36,24,0.10)';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(sx, progressY);
      for (let i = 0; i <= segs; i++) {
        const px = sx + (sw / segs) * i;
        const py = progressY + Math.sin(px * 0.02 + t * 0.3) * 1.2;
        ctx.lineTo(px, py);
      }
      ctx.stroke();

      // Played portion
      if (pct > 0.005) {
        ctx.strokeStyle = `rgba(${palette.accentR},${palette.accentG},${palette.accentB},0.42)`;
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(sx, progressY);
        for (let i = 0; i <= Math.floor(segs * pct); i++) {
          const px = sx + (sw / segs) * i;
          const py = progressY + Math.sin(px * 0.02 + t * 0.3) * 1.2;
          ctx.lineTo(px, py);
        }
        ctx.stroke();
      }

      ctx.globalCompositeOperation = 'source-over';
      frameRef.current = requestAnimationFrame(render);
    };

    frameRef.current = requestAnimationFrame(render);
    return () => { running = false; cancelAnimationFrame(frameRef.current); };
  }, [visible, palette, isPlaying, intensity, parsedLyrics, currentLyricIdx, progress, duration, activeScene, track]);

  useEffect(() => { if (!visible) particlesRef.current = []; }, [visible]);

  if (!visible) return null;

  const layer = (
    <motion.div
      key="music-mood"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 1.6, ease: [0.22, 1, 0.36, 1] }}
      className="fixed inset-0 z-[100000] select-none"
    >
      <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" />

      {emotionalNote && (
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.8, duration: 0.9 }}
          className="pointer-events-none absolute bottom-14 left-8 max-w-[min(360px,calc(100vw-4rem))] text-left"
        >
          <p className="text-[10px] uppercase tracking-wide font-serif" style={{ color: 'rgba(42,36,24,0.32)' }}>
            Lumi
          </p>
          <p className="mt-1 text-[13px] leading-6 font-serif" style={{ color: 'rgba(42,36,24,0.58)' }}>
            {emotionalNote}
          </p>
        </motion.div>
      )}

      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.6, duration: 1 }}
        className="absolute bottom-14 right-8 text-right"
      >
        <p className="text-[11px] tracking-wide font-serif" style={{ color: 'rgba(42,36,24,0.42)' }}>
          {track?.name || 'Mood layer standby'}
        </p>
        <p className="mt-0.5 max-w-[260px] text-[9px] font-serif" style={{ color: 'rgba(42,36,24,0.22)' }}>
          {track?.artists?.join(' / ') || 'Open Music Center or ask Lumi to play when you are ready.'}
        </p>
      </motion.div>
    </motion.div>
  );

  return typeof document === 'undefined' ? layer : createPortal(layer, document.body);
}
