import React, { Suspense } from 'react';
import { Canvas } from '@react-three/fiber';
import { OrbitControls } from '@react-three/drei';
import { StarField } from './StarField';
import { ParticleGlobe } from './ParticleGlobe';
import { NeuralNetwork } from './NeuralNetwork';

interface NexusGlobeProps {
  theme: 'celestial' | 'nebula' | 'cyber';
  syncRate: number;
}

const THEME_COLORS: Record<string, { primary: string; accent: string }> = {
  celestial: { primary: '#ffcc00', accent: '#ffffff' },
  nebula: { primary: '#a855f7', accent: '#e2b0ff' },
  cyber: { primary: '#10b981', accent: '#a7f3d0' },
};

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="text-white/20 text-xs font-mono animate-pulse">INITIALIZING NEXUS...</div>
    </div>
  );
}

export function NexusGlobe({ theme, syncRate }: NexusGlobeProps) {
  const colors = THEME_COLORS[theme] || THEME_COLORS.celestial;

  return (
    <div className="w-full h-full">
      <Suspense fallback={<LoadingFallback />}>
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 0.6, 5.5], fov: 42, near: 0.1, far: 80 }}
          style={{ background: 'transparent' }}
        >
          <OrbitControls
            enablePan={false}
            enableZoom={true}
            minDistance={3.2}
            maxDistance={9}
            autoRotate={true}
            autoRotateSpeed={0.25 * syncRate}
            maxPolarAngle={Math.PI * 0.75}
            minPolarAngle={Math.PI * 0.25}
          />

          <StarField color={colors.primary} syncRate={syncRate} />
          <ParticleGlobe color={colors.primary} syncRate={syncRate} />
          <NeuralNetwork color={colors.primary} syncRate={syncRate} accentColor={colors.accent} />
        </Canvas>
      </Suspense>
    </div>
  );
}
