import React, { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';

interface ParticleGlobeProps {
  color: string;
  syncRate: number;
}

const PARTICLE_COUNT = 4000;
const GLOBE_RADIUS = 1.8;
const ATMO_RADIUS = 1.95;

// Procedural land/ocean check — approximate continent coverage
function isLand(lat: number, lng: number): number {
  // lat/lng in degrees
  const regions: [number, number, number, number][] = [
    [15, 70, -170, -50],   // North America
    [-55, 12, -80, -35],   // South America
    [35, 70, -10, 40],     // Europe
    [-35, 37, -20, 50],    // Africa
    [10, 75, 40, 180],     // Asia (approx)
    [-40, -10, 110, 155],  // Australia
    [-10, 10, 95, 140],    // Indonesia / SE Asia islands
    [50, 70, 130, 180],    // Far East Russia
    [-85, -60, -70, -20],  // Antarctica peninsula
  ];
  for (const [latMin, latMax, lngMin, lngMax] of regions) {
    if (lat >= latMin && lat <= latMax && lng >= lngMin && lng <= lngMax) {
      return 0.6 + Math.random() * 0.4; // land brightness
    }
  }
  return Math.random() * 0.15; // ocean — dim
}

// Atmosphere fresnel vertex shader
const atmoVertexShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  void main() {
    vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
    vNormal = normalize(mat3(modelViewMatrix) * normal);
    vViewDir = normalize(-mvPos.xyz);
    gl_Position = projectionMatrix * mvPos;
  }
`;

const atmoFragmentShader = /* glsl */ `
  varying vec3 vNormal;
  varying vec3 vViewDir;
  uniform vec3 uColor;
  uniform float uTime;
  void main() {
    float fresnel = 1.0 - abs(dot(vNormal, vViewDir));
    fresnel = pow(fresnel, 3.5);
    float alpha = fresnel * 0.35;
    alpha *= 0.8 + 0.2 * sin(uTime * 0.5) * 0.2;
    gl_FragColor = vec4(uColor, alpha);
  }
`;

export function ParticleGlobe({ color, syncRate }: ParticleGlobeProps) {
  const globeRef = useRef<THREE.Points>(null);
  const atmoRef = useRef<THREE.Mesh>(null);
  const atmoMatRef = useRef<THREE.ShaderMaterial>(null);

  const { globeGeometry, globeSizes } = useMemo(() => {
    const phi = Math.PI * (3 - Math.sqrt(5));
    const pos = new Float32Array(PARTICLE_COUNT * 3);
    const sizes = new Float32Array(PARTICLE_COUNT);

    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const y = 1 - (i / (PARTICLE_COUNT - 1)) * 2;
      const r = Math.sqrt(1 - y * y);
      const theta = phi * i;

      const x = Math.cos(theta) * r;
      const z = Math.sin(theta) * r;

      pos[i * 3] = x * GLOBE_RADIUS;
      pos[i * 3 + 1] = y * GLOBE_RADIUS;
      pos[i * 3 + 2] = z * GLOBE_RADIUS;

      // Convert to lat/lng for land check
      const lat = Math.asin(y) * (180 / Math.PI);
      const lng = Math.atan2(z, x) * (180 / Math.PI);

      sizes[i] = isLand(lat, lng) * (0.025 + Math.random() * 0.04);
    }

    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('size', new THREE.BufferAttribute(sizes, 1));

    return { globeGeometry: geo, globeSizes: sizes };
  }, []);

  const globeMaterial = useMemo(() => new THREE.PointsMaterial({
    size: 0.022,
    color: new THREE.Color(color),
    blending: THREE.AdditiveBlending,
    depthWrite: true,
    transparent: true,
    opacity: 0.85,
    sizeAttenuation: true,
  }), [color]);

  React.useEffect(() => {
    globeMaterial.color.set(color);
  }, [color, globeMaterial]);

  const atmoUniforms = useRef({
    uColor: { value: new THREE.Color(color) },
    uTime: { value: 0 },
  });

  const atmoMaterial = useMemo(() => {
    const mat = new THREE.ShaderMaterial({
      vertexShader: atmoVertexShader,
      fragmentShader: atmoFragmentShader,
      uniforms: atmoUniforms.current,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    atmoMatRef.current = mat;
    return mat;
  }, []);

  React.useEffect(() => {
    atmoUniforms.current.uColor.value.set(color);
  }, [color]);

  useFrame((_, delta) => {
    if (atmoMatRef.current) {
      atmoMatRef.current.uniforms.uTime.value += delta * syncRate;
    }
  });

  return (
    <group renderOrder={1}>
      <points ref={globeRef} geometry={globeGeometry} material={globeMaterial} />
      <mesh ref={atmoRef} geometry={useMemo(() => new THREE.SphereGeometry(ATMO_RADIUS, 64, 64), [])} material={atmoMaterial} />
    </group>
  );
}
