// 3D Particle Face — real-time particle system rendering a human face.
// Features: audio-reactive mouth, eye blinking, expression shifts, head rotation.
import React, { useRef, useMemo, useEffect, useState, useCallback } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { generateFaceParticles, buildVertexData, type VertexData } from './FaceGeometry';

// ── Static: build face data once per mount ──
let cachedVertexData: VertexData | null = null;
function getOrBuildVertexData(): VertexData {
  if (!cachedVertexData) {
    cachedVertexData = buildVertexData(generateFaceParticles(4000));
  }
  // Deep-copy the Float32Arrays so each instance gets its own mutable buffer
  return {
    positions: new Float32Array(cachedVertexData.positions),
    colors: new Float32Array(cachedVertexData.colors),
    eyeLeftIndices: [...cachedVertexData.eyeLeftIndices],
    eyeRightIndices: [...cachedVertexData.eyeRightIndices],
    mouthIndices: [...cachedVertexData.mouthIndices],
    browLeftIndices: [...cachedVertexData.browLeftIndices],
    browRightIndices: [...cachedVertexData.browRightIndices],
    headIndices: [...cachedVertexData.headIndices],
    noseIndices: [...cachedVertexData.noseIndices],
  };
}

// ── Circle texture for soft particles ──
function createCircleTexture(): THREE.Texture {
  const size = 64;
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, 'rgba(255,255,255,1)');
  gradient.addColorStop(0.15, 'rgba(255,255,255,0.9)');
  gradient.addColorStop(0.5, 'rgba(255,255,255,0.3)');
  gradient.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  tex.needsUpdate = true;
  return tex;
}

let cachedTexture: THREE.Texture | null = null;
function getCircleTexture(): THREE.Texture {
  if (!cachedTexture) cachedTexture = createCircleTexture();
  return cachedTexture;
}

// ── Props ──
interface FaceSphereProps {
  audioLevel?: number;
  callState?: string;
  sentiment?: { valence?: number; arousal?: number };
  theme?: string;
  scale?: number;
}

// ── The particle mesh ──
function FaceParticles({ audioLevel, callState, sentiment, scale: faceScale }: FaceSphereProps) {
  const meshRef = useRef<THREE.Points>(null);
  const { positions, colors, eyeLeftIndices, eyeRightIndices, mouthIndices, browLeftIndices, browRightIndices } =
    useMemo(() => getOrBuildVertexData(), []);

  const restPositions = useMemo(() => new Float32Array(positions), [positions]);
  const geoRef = useRef<THREE.BufferGeometry>(null);

  // Blink state
  const [blinkProgress, setBlinkProgress] = useState(0);
  const blinkTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const nextBlinkAt = useRef(Date.now() + 2000 + Math.random() * 4000);

  const scheduleBlink = useCallback(() => {
    blinkTimer.current = setTimeout(() => {
      setBlinkProgress(1); // start blink
      setTimeout(() => setBlinkProgress(0), 120); // open
      nextBlinkAt.current = Date.now() + 2500 + Math.random() * 5000;
    }, Math.max(0, nextBlinkAt.current - Date.now()));
  }, []);

  useEffect(() => { scheduleBlink(); return () => clearTimeout(blinkTimer.current); }, [scheduleBlink]);

  const texture = useMemo(() => getCircleTexture(), []);

  useFrame((_state, delta) => {
    if (!geoRef.current || !meshRef.current) return;

    const posAttr = geoRef.current.getAttribute('position') as THREE.BufferAttribute;
    const arr = posAttr.array as Float32Array;

    const talk = callState === 'speaking' && audioLevel != null && audioLevel > 0.02;
    const talkAmount = talk ? Math.min(1, audioLevel! * 3) * 0.12 : 0;
    const mouthOpen = talkAmount * (0.5 + 0.5 * Math.sin(Date.now() * 0.03));
    const valence = sentiment?.valence ?? 0;

    // Mouth — expand outward on Z and slightly on Y
    for (const idx of mouthIndices) {
      const i3 = idx * 3;
      const ry = restPositions[i3 + 1];
      const rz = restPositions[i3 + 2];
      arr[i3 + 2] = rz + mouthOpen * 0.3 * (1 - Math.abs(ry + 0.25) * 2);
    }

    // Eyes — blink
    if (blinkProgress > 0) {
      const blinkAmount = blinkProgress; // 0→1 during blink
      for (const ei of [...eyeLeftIndices, ...eyeRightIndices]) {
        const i3 = ei * 3;
        const ry = restPositions[i3 + 1];
        // Upper lid presses down
        if (ry > 0.15) {
          arr[i3 + 1] = ry - blinkAmount * 0.08;
        }
        // Lower lid comes up
        if (ry < 0.22) {
          arr[i3 + 1] = ry + blinkAmount * 0.04;
        }
      }
    } else {
      // Reset eye particles to resting
      for (const ei of [...eyeLeftIndices, ...eyeRightIndices]) {
        arr[ei * 3 + 1] = restPositions[ei * 3 + 1];
      }
    }

    // Brows — raise/lower based on valence (happy=slightly raised, sad=lowered)
    for (const bi of [...browLeftIndices, ...browRightIndices]) {
      const i3 = bi * 3;
      arr[i3 + 1] = restPositions[i3 + 1] + valence * 0.015;
    }

    // Reset non-animated regions to resting
    for (const hi of [...positions.keys()].filter((_, i) =>
      !mouthIndices.includes(i) && !eyeLeftIndices.includes(i) && !eyeRightIndices.includes(i)
      && !browLeftIndices.includes(i) && !browRightIndices.includes(i)
    ).slice(0, 100)) {
      // Only reset a subset each frame for performance; head/nose stay put
      break;
    }
    // Actually reset all head/nose positions lazily — they don't animate, so skip for performance

    posAttr.needsUpdate = true;

    // Schedule next blink
    if (blinkProgress === 0 && Date.now() > nextBlinkAt.current) {
      scheduleBlink();
    }

    // Gentle idle rotation when not actively interacting
    if (callState === 'idle' || callState == null) {
      meshRef.current.rotation.y += delta * 0.15;
    } else {
      meshRef.current.rotation.y += delta * 0.05;
    }
  });

  const particleSize = faceScale && faceScale > 0 ? 0.018 * faceScale : 0.018;

  return (
    <points ref={meshRef}>
      <bufferGeometry ref={geoRef}>
        <bufferAttribute
          attach="attributes-position"
          count={positions.length / 3}
          array={positions}
          itemSize={3}
        />
        <bufferAttribute
          attach="attributes-color"
          count={colors.length / 3}
          array={colors}
          itemSize={3}
        />
      </bufferGeometry>
      <pointsMaterial
        size={particleSize}
        vertexColors
        blending={THREE.AdditiveBlending}
        depthWrite={false}
        transparent
        map={texture}
        sizeAttenuation
      />
    </points>
  );
}

// ── R3F Canvas wrapper ──
export function FaceSphere(props: FaceSphereProps) {
  return (
    <div style={{ width: '100%', height: '100%' }}>
      <Canvas
        camera={{ position: [0, 0.05, 1.5], fov: 45, near: 0.1, far: 10 }}
        gl={{ alpha: true, antialias: true }}
        style={{ background: 'transparent' }}
      >
        <ambientLight intensity={0.3} />
        <FaceParticles {...props} />
      </Canvas>
    </div>
  );
}

export default FaceSphere;
