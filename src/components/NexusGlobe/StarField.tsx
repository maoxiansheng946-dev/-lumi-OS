import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface StarFieldProps {
  color: string;
  syncRate: number;
}

const STAR_COUNT = 2000;
const SHELL_RADIUS = 50;
const CONSTELLATION_LINES = 180;

const starVertexShader = /* glsl */ `
  attribute float aSize;
  attribute float aPhase;
  varying float vAlpha;
  varying float vBright;
  uniform float uTime;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    gl_PointSize = aSize * (180.0 / -mvPos.z);
    gl_PointSize *= 0.55 + 0.45 * sin(uTime * 1.8 + aPhase);
    gl_Position = projectionMatrix * mvPos;
    vAlpha = 0.4 + 0.6 * sin(uTime * 1.3 + aPhase + 1.7);
    vBright = aSize;
  }
`;

const starFragmentShader = /* glsl */ `
  varying float vAlpha;
  varying float vBright;
  uniform vec3 uColor;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float alpha = 1.0 - smoothstep(0.15, 1.0, d);
    alpha *= vAlpha * (0.35 + 0.65 * vBright);
    gl_FragColor = vec4(uColor, alpha * 0.85);
  }
`;

export function StarField({ color, syncRate }: StarFieldProps) {
  const pointsRef = useRef<THREE.Points>(null);
  const linesRef = useRef<THREE.LineSegments>(null);
  const materialRef = useRef<THREE.ShaderMaterial>(null);

  const { starGeometry, lineGeometry, lineCount } = useMemo(() => {
    const phi = Math.PI * (3 - Math.sqrt(5));

    // Star positions on Fibonacci sphere (radius SHELL_RADIUS)
    const pos = new Float32Array(STAR_COUNT * 3);
    const sizes = new Float32Array(STAR_COUNT);
    const phases = new Float32Array(STAR_COUNT);

    for (let i = 0; i < STAR_COUNT; i++) {
      const y = 1 - (i / (STAR_COUNT - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = phi * i + (Math.random() - 0.5) * 0.15;
      pos[i * 3] = Math.cos(theta) * r * SHELL_RADIUS;
      pos[i * 3 + 1] = y * SHELL_RADIUS;
      pos[i * 3 + 2] = Math.sin(theta) * r * SHELL_RADIUS;
      sizes[i] = 0.2 + Math.random() * 0.8;
      phases[i] = Math.random() * Math.PI * 2;
    }

    const starGeo = new THREE.BufferGeometry();
    starGeo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    starGeo.setAttribute('aSize', new THREE.BufferAttribute(sizes, 1));
    starGeo.setAttribute('aPhase', new THREE.BufferAttribute(phases, 1));

    // Constellation lines: connect bright stars within angular distance
    const brightIndices: number[] = [];
    const threshold = 0.55;
    for (let i = 0; i < STAR_COUNT; i++) {
      if (sizes[i] > threshold) brightIndices.push(i);
    }
    // Limit to ~80 brightest for performance
    const maxBright = 80;
    const selected = brightIndices
      .sort((a, b) => sizes[b] - sizes[a])
      .slice(0, maxBright);

    const linePositions: number[] = [];
    const maxAngularDist = 0.45; // radians on unit sphere ≈ close stars
    for (let i = 0; i < selected.length; i++) {
      const ai = selected[i];
      const ax = pos[ai * 3] / SHELL_RADIUS;
      const ay = pos[ai * 3 + 1] / SHELL_RADIUS;
      const az = pos[ai * 3 + 2] / SHELL_RADIUS;
      for (let j = i + 1; j < selected.length; j++) {
        const aj = selected[j];
        const bx = pos[aj * 3] / SHELL_RADIUS;
        const by = pos[aj * 3 + 1] / SHELL_RADIUS;
        const bz = pos[aj * 3 + 2] / SHELL_RADIUS;
        const dot = ax * bx + ay * by + az * bz;
        const angDist = Math.acos(Math.max(-1, Math.min(1, dot)));
        if (angDist < maxAngularDist && linePositions.length / 6 < CONSTELLATION_LINES) {
          linePositions.push(ax * SHELL_RADIUS, ay * SHELL_RADIUS, az * SHELL_RADIUS);
          linePositions.push(bx * SHELL_RADIUS, by * SHELL_RADIUS, bz * SHELL_RADIUS);
        }
      }
    }

    const lineGeo = new THREE.BufferGeometry();
    lineGeo.setAttribute('position', new THREE.Float32BufferAttribute(linePositions, 3));

    return { starGeometry: starGeo, lineGeometry: lineGeo, lineCount: linePositions.length / 6 };
  }, []);

  const lineMaterial = useMemo(() =>
    new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.08, depthWrite: false }),
    [color]
  );

  const uniformsRef = useRef({ uTime: { value: 0 }, uColor: { value: new THREE.Color(color) } });
  const shaderMaterial = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: starVertexShader,
      fragmentShader: starFragmentShader,
      uniforms: uniformsRef.current,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    materialRef.current = mat;
    return mat;
  }, []);

  // Update color uniform when theme changes
  React.useEffect(() => {
    uniformsRef.current.uColor.value.set(color);
  }, [color]);

  // Update line material color
  React.useEffect(() => {
    lineMaterial.color.set(color);
  }, [color, lineMaterial]);

  useFrame((_, delta) => {
    if (materialRef.current) {
      materialRef.current.uniforms.uTime.value += delta * syncRate;
    }
    if (pointsRef.current) {
      pointsRef.current.rotation.y += delta * 0.015 * syncRate;
    }
  });

  return (
    <group renderOrder={0}>
      <points ref={pointsRef} geometry={starGeometry} material={shaderMaterial} />
      <lineSegments ref={linesRef} geometry={lineGeometry} material={lineMaterial} />
    </group>
  );
}
