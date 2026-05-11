import React, { useRef, useEffect, useCallback } from 'react';

interface Vec2 {
  x: number;
  y: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseAlpha: number;
  alpha: number;
  hue: number;
}

interface NodeGlow {
  x: number; // 0-1 percentage
  y: number; // 0-1 percentage
  radius: number; // glow radius in px
  hue: number;
}

interface ParticleCanvasProps {
  nodePositions?: { x: number; y: number; id: string; hue?: number }[];
  highlightedNodeIds?: Set<string>;
  className?: string;
}

const PARTICLE_COUNT = 150;
const CONNECTION_DIST = 130;
const MOUSE_ATTRACT_DIST = 100;
const MOUSE_ATTRACT_FORCE = 0.015;
const CELL_SIZE = 130;

function hashPos(x: number, y: number): string {
  return `${Math.floor(x / CELL_SIZE)},${Math.floor(y / CELL_SIZE)}`;
}

export function ParticleCanvas({ nodePositions = [], highlightedNodeIds = new Set(), className }: ParticleCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const particlesRef = useRef<Particle[]>([]);
  const mouseRef = useRef<Vec2 | null>(null);
  const rafRef = useRef<number>(0);
  const dimsRef = useRef({ w: 0, h: 0 });
  const nodeGlowsRef = useRef<NodeGlow[]>([]);
  const nodePositionsRef = useRef(nodePositions);
  const highlightedIdsRef = useRef(highlightedNodeIds);

  // Keep refs in sync without restarting animation loop
  useEffect(() => { nodePositionsRef.current = nodePositions; }, [nodePositions]);
  useEffect(() => { highlightedIdsRef.current = highlightedNodeIds; }, [highlightedNodeIds]);

  // Initialize particles
  const initParticles = useCallback((w: number, h: number) => {
    const particles: Particle[] = [];
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * w,
        y: Math.random() * h,
        vx: (Math.random() - 0.5) * 0.4,
        vy: (Math.random() - 0.5) * 0.4,
        radius: Math.random() * 2 + 0.8,
        baseAlpha: Math.random() * 0.25 + 0.08,
        alpha: 0,
        hue: Math.random() < 0.33 ? 210 : Math.random() < 0.5 ? 42 : 200, // blue, gold, cyan defaults
      });
    }
    return particles;
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let particles = particlesRef.current;

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const w = parent.clientWidth;
      const h = parent.clientHeight;
      const dpr = window.devicePixelRatio || 1;
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.width = `${w}px`;
      canvas.style.height = `${h}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      dimsRef.current = { w, h };

      if (particles.length === 0) {
        particles = initParticles(w, h);
        particlesRef.current = particles;
      } else {
        // Adjust to new bounds
        for (const p of particles) {
          p.x = Math.min(w, Math.max(0, p.x));
          p.y = Math.min(h, Math.max(0, p.y));
        }
      }
    };

    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas.parentElement!);

    const handleMouse = (e: MouseEvent) => {
      const rect = canvas.getBoundingClientRect();
      mouseRef.current = { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };
    const handleLeave = () => { mouseRef.current = null; };
    canvas.addEventListener('mousemove', handleMouse);
    canvas.addEventListener('mouseleave', handleLeave);
    // Touch support
    const handleTouch = (e: TouchEvent) => {
      if (e.touches.length > 0) {
        const rect = canvas.getBoundingClientRect();
        mouseRef.current = { x: e.touches[0].clientX - rect.left, y: e.touches[0].clientY - rect.top };
      }
    };
    canvas.addEventListener('touchmove', handleTouch);
    canvas.addEventListener('touchend', handleLeave);

    const loop = () => {
      const { w, h } = dimsRef.current;
      ctx.clearRect(0, 0, w, h);

      const mouse = mouseRef.current;
      const positions = nodePositionsRef.current;
      const highlighted = highlightedIdsRef.current;

      // Update node glows based on highlights
      const glows: NodeGlow[] = positions
        .filter(n => highlighted.size === 0 || highlighted.has(n.id))
        .map(n => ({
          x: n.x * w,
          y: n.y * h,
          radius: highlighted.has(n.id) ? 80 : 40,
          hue: n.hue ?? 210,
        }));
      nodeGlowsRef.current = glows;

      // Draw node glows on canvas
      for (const g of glows) {
        const grad = ctx.createRadialGradient(g.x, g.y, 0, g.x, g.y, g.radius);
        grad.addColorStop(0, `hsla(${g.hue}, 60%, 50%, 0.06)`);
        grad.addColorStop(0.5, `hsla(${g.hue}, 50%, 40%, 0.03)`);
        grad.addColorStop(1, 'transparent');
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.arc(g.x, g.y, g.radius, 0, Math.PI * 2);
        ctx.fill();
      }

      // Mouse glow
      if (mouse) {
        const mg = ctx.createRadialGradient(mouse.x, mouse.y, 0, mouse.x, mouse.y, 80);
        mg.addColorStop(0, 'hsla(200, 50%, 50%, 0.05)');
        mg.addColorStop(1, 'transparent');
        ctx.fillStyle = mg;
        ctx.beginPath();
        ctx.arc(mouse.x, mouse.y, 80, 0, Math.PI * 2);
        ctx.fill();
      }

      // Update & draw particles
      for (const p of particles) {
        // Attract toward mouse
        if (mouse) {
          const dx = mouse.x - p.x;
          const dy = mouse.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < MOUSE_ATTRACT_DIST && dist > 1) {
            const force = (1 - dist / MOUSE_ATTRACT_DIST) * MOUSE_ATTRACT_FORCE;
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }

        // Attract toward highlighted node positions
        for (const g of glows) {
          const dx = g.x - p.x;
          const dy = g.y - p.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < g.radius && dist > 0.5) {
            const force = (1 - dist / g.radius) * 0.008;
            p.vx += (dx / dist) * force;
            p.vy += (dy / dist) * force;
          }
        }

        // Damping
        p.vx *= 0.995;
        p.vy *= 0.995;

        // Speed clamp
        const speed = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
        if (speed > 0.6) {
          p.vx = (p.vx / speed) * 0.6;
          p.vy = (p.vy / speed) * 0.6;
        }

        p.x += p.vx;
        p.y += p.vy;

        // Wrap edges
        if (p.x < -10) p.x = w + 10;
        if (p.x > w + 10) p.x = -10;
        if (p.y < -10) p.y = h + 10;
        if (p.y > h + 10) p.y = -10;

        // Smooth alpha toward base
        p.alpha += (p.baseAlpha - p.alpha) * 0.03;

        // Boost alpha near mouse or nodes
        let boost = 0;
        if (mouse) {
          const dm = Math.sqrt((mouse.x - p.x) ** 2 + (mouse.y - p.y) ** 2);
          if (dm < 60) boost = Math.max(boost, (1 - dm / 60) * 0.3);
        }
        for (const g of glows) {
          const dg = Math.sqrt((g.x - p.x) ** 2 + (g.y - p.y) ** 2);
          if (dg < g.radius * 0.6) boost = Math.max(boost, (1 - dg / (g.radius * 0.6)) * 0.25);
        }
        const targetAlpha = Math.min(1, p.baseAlpha + boost);
        p.alpha += (targetAlpha - p.alpha) * 0.05;

        // Draw particle
        const hue = p.hue;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.radius, 0, Math.PI * 2);
        ctx.fillStyle = `hsla(${hue}, 40%, 70%, ${p.alpha})`;
        ctx.fill();

        // Tiny glow for brighter particles
        if (p.alpha > 0.3) {
          const glow = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.radius * 3);
          glow.addColorStop(0, `hsla(${hue}, 50%, 60%, ${p.alpha * 0.5})`);
          glow.addColorStop(1, 'transparent');
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.radius * 3, 0, Math.PI * 2);
          ctx.fill();
        }
      }

      // Draw connection lines (spatial hash)
      const grid = new Map<string, Particle[]>();
      for (const p of particles) {
        const key = hashPos(p.x, p.y);
        if (!grid.has(key)) grid.set(key, []);
        grid.get(key)!.push(p);
      }

      const checked = new Set<string>();
      for (const [key, cell] of grid) {
        const [cx, cy] = key.split(',').map(Number);
        for (let dx = -1; dx <= 1; dx++) {
          for (let dy = -1; dy <= 1; dy++) {
            const nKey = `${cx + dx},${cy + dy}`;
            const nCell = grid.get(nKey);
            if (!nCell) continue;
            for (const a of cell) {
              for (const b of nCell) {
                if (a === b) continue;
                const pairKey = a < b ? `${a.x},${a.y}:${b.x},${b.y}` : `${b.x},${b.y}:${a.x},${a.y}`;
                if (checked.has(pairKey)) continue;
                checked.add(pairKey);

                const dist = Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
                if (dist < CONNECTION_DIST) {
                  const lineAlpha = (1 - dist / CONNECTION_DIST) * Math.min(a.alpha, b.alpha) * 0.5;
                  ctx.strokeStyle = `hsla(${(a.hue + b.hue) / 2}, 30%, 55%, ${lineAlpha})`;
                  ctx.lineWidth = 0.5;
                  ctx.beginPath();
                  ctx.moveTo(a.x, a.y);
                  ctx.lineTo(b.x, b.y);
                  ctx.stroke();
                }
              }
            }
          }
        }
      }

      rafRef.current = requestAnimationFrame(loop);
    };

    // Fade-in: particles start with alpha=0 and fade up
    rafRef.current = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(rafRef.current);
      ro.disconnect();
      canvas.removeEventListener('mousemove', handleMouse);
      canvas.removeEventListener('mouseleave', handleLeave);
      canvas.removeEventListener('touchmove', handleTouch);
      canvas.removeEventListener('touchend', handleLeave);
    };
  }, [initParticles]);

  return (
    <canvas
      ref={canvasRef}
      className={className}
      style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
    />
  );
}
