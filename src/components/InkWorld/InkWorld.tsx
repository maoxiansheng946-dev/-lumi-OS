import React, { Suspense, useState, useEffect, useMemo } from 'react';
import { Canvas } from '@react-three/fiber';
import { InkTerrain } from './InkTerrain';
import { InkMountains } from './InkMountains';
import { InkFog } from './InkFog';
import { InkParticles } from './InkParticles';
import { InkTrees } from './InkTrees';
import { InkRiver } from './InkRiver';
import { InkAgents } from './InkAgents';
import { InkCamera } from './InkCamera';
import { InkPostProcessing } from './InkPostProcessing';

export interface InkWorldProps {
  theme: 'celestial' | 'nebula' | 'cyber';
  syncRate: number;
}

interface AgentNode {
  id: string;
  x: number;
  z: number;
  y: number;
  label: string;
  active: boolean;
  category: string;
  personalityId: string;
}

function hashToWorld(id: string, max: number): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = ((h << 5) - h) + id.charCodeAt(i);
  return (Math.abs(h) % (max * 2)) - max;
}

function LoadingFallback() {
  return (
    <div className="flex items-center justify-center w-full h-full">
      <div className="text-white/20 text-xs font-mono animate-pulse">INITIALIZING NEXUS...</div>
    </div>
  );
}

export function InkWorld({ theme, syncRate }: InkWorldProps) {
  const [agents, setAgents] = useState<any[]>([]);

  useEffect(() => {
    fetch('/api/agents')
      .then(r => r.ok ? r.json() : [])
      .then(d => setAgents(Array.isArray(d) ? d : d.agents || []))
      .catch(() => {});
  }, []);

  const { nodes, connections } = useMemo(() => {
    if (agents.length === 0) return { nodes: undefined, connections: undefined };

    const terrainSpan = 25; // half of 60x60

    const nodes: AgentNode[] = agents.map(a => ({
      id: a.id,
      x: hashToWorld(a.id, terrainSpan),
      z: hashToWorld(a.id + '_z', terrainSpan),
      y: 0, // height computed by terrain shader; InkAgents reads terrain height
      label: a.name,
      active: a.status === 'active',
      category: a.category || '',
      personalityId: a.personalityId || '',
    }));

    const conns: { from: string; to: string }[] = [];
    for (let i = 0; i < agents.length; i++) {
      for (let j = i + 1; j < agents.length; j++) {
        if (agents[i].personalityId && agents[i].personalityId === agents[j].personalityId) {
          conns.push({ from: agents[i].id, to: agents[j].id });
        }
      }
    }
    // Fallback: category-based
    if (conns.length === 0) {
      for (let i = 0; i < agents.length; i++) {
        for (let j = i + 1; j < agents.length; j++) {
          if (agents[i].category && agents[i].category === agents[j].category) {
            conns.push({ from: agents[i].id, to: agents[j].id });
          }
        }
      }
    }
    // Final fallback: nearest neighbors
    if (conns.length === 0) {
      for (let i = 0; i < Math.min(agents.length, 8); i++) {
        const j = (i + 1) % agents.length;
        conns.push({ from: agents[i].id, to: agents[j].id });
      }
    }

    return { nodes, connections: conns };
  }, [agents]);

  return (
    <div className="w-full h-full">
      <Suspense fallback={<LoadingFallback />}>
        <Canvas
          dpr={[1, 1.5]}
          gl={{ antialias: true, alpha: true }}
          camera={{ position: [0, 18, 28], fov: 50, near: 0.5, far: 120 }}
          style={{ background: 'transparent' }}
        >
          <InkCamera syncRate={syncRate} />

          {/* Atmosphere — furthest to closest */}
          <InkMountains />
          <InkFog />
          <InkTerrain syncRate={syncRate} />
          <InkRiver />
          <InkTrees />
          <InkParticles syncRate={syncRate} theme={theme} />

          {/* Agents — positioned on terrain */}
          <InkAgents
            nodes={nodes}
            connections={connections}
            syncRate={syncRate}
            theme={theme}
          />

          {/* Post-processing */}
          <InkPostProcessing />
        </Canvas>
      </Suspense>
    </div>
  );
}
