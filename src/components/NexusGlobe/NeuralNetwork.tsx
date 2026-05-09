import React, { useMemo, useRef, useEffect } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import { generateDemoNodes, generateDemoConnections } from './mockData';

interface NeuralNetworkProps {
  color: string;
  syncRate: number;
  accentColor: string;
}

const GLOBE_RADIUS = 1.85;

function latLngToVec3(lat: number, lng: number, radius: number): THREE.Vector3 {
  const phi = (90 - lat) * (Math.PI / 180);
  const theta = (lng + 180) * (Math.PI / 180);
  return new THREE.Vector3(
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  );
}

export function NeuralNetwork({ color, syncRate, accentColor }: NeuralNetworkProps) {
  const pulseGroupRef = useRef<THREE.Group>(null);
  const linesRef = useRef<THREE.Group>(null);

  const { nodes, connections, nodeMeshes, arcCurves } = useMemo(() => {
    const nodes = generateDemoNodes();
    const connections = generateDemoConnections(nodes);
    const nodeMap = new Map(nodes.map(n => [n.id, n]));

    // Node mesh data
    const nodeMeshes = nodes.map(node => ({
      position: latLngToVec3(node.lat, node.lng, GLOBE_RADIUS),
      active: node.active,
      label: node.label,
    }));

    // Build bezier arcs for each connection
    const arcCurves: { curve: THREE.QuadraticBezierCurve3; bandwidth: number }[] = [];
    for (const conn of connections) {
      const fromNode = nodeMap.get(conn.from);
      const toNode = nodeMap.get(conn.to);
      if (!fromNode || !toNode) continue;

      const start = latLngToVec3(fromNode.lat, fromNode.lng, GLOBE_RADIUS);
      const end = latLngToVec3(toNode.lat, toNode.lng, GLOBE_RADIUS);

      // Midpoint pushed outward from globe surface
      const mid = new THREE.Vector3().addVectors(start, end).multiplyScalar(0.5);
      mid.normalize().multiplyScalar(GLOBE_RADIUS * 1.45);

      const curve = new THREE.QuadraticBezierCurve3(start, mid, end);
      arcCurves.push({ curve, bandwidth: conn.bandwidth });
    }

    return { nodes, connections, nodeMeshes, arcCurves };
  }, []);

  // Node geometry — small icosahedrons
  const nodeGeo = useMemo(() => new THREE.IcosahedronGeometry(0.03, 0), []);
  const activeMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(color) }), [color]);
  const inactiveMat = useMemo(() => new THREE.MeshBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.2 }), [color]);

  // Arc line material
  const arcMaterial = useMemo(() =>
    new THREE.LineBasicMaterial({ color: new THREE.Color(color), transparent: true, opacity: 0.25, depthWrite: true }),
    [color]
  );

  // Pulse dots
  const pulseCount = 60;
  const pulseData = useMemo(() => {
    const data: { arcIndex: number; t: number; speed: number }[] = [];
    for (let i = 0; i < pulseCount; i++) {
      data.push({
        arcIndex: i % arcCurves.length,
        t: Math.random(),
        speed: 0.08 + Math.random() * 0.2,
      });
    }
    return data;
  }, [arcCurves.length]);

  const pulseGeo = useMemo(() => new THREE.SphereGeometry(0.012, 4, 4), []);
  const pulseMat = useMemo(() =>
    new THREE.MeshBasicMaterial({ color: new THREE.Color(accentColor || '#ffffff') }),
    [accentColor]
  );

  // Build line geometries from curves
  const lineGeometries = useMemo(() => {
    return arcCurves.map(({ curve }) => {
      const pts = curve.getPoints(50);
      const geo = new THREE.BufferGeometry().setFromPoints(pts);
      return geo;
    });
  }, [arcCurves]);

  React.useEffect(() => {
    activeMat.color.set(color);
    inactiveMat.color.set(color);
    arcMaterial.color.set(color);
    pulseMat.color.set(accentColor || '#ffffff');
  }, [color, accentColor, activeMat, inactiveMat, arcMaterial, pulseMat]);

  const pulseRefs = useRef<THREE.Mesh[]>([]);

  useFrame((_, delta) => {
    const dt = delta * syncRate;
    // Update pulse positions along arcs
    for (let i = 0; i < pulseRefs.current.length; i++) {
      const pulse = pulseRefs.current[i];
      if (!pulse) continue;
      const pd = pulseData[i];
      pd.t += pd.speed * dt;
      if (pd.t > 1) pd.t -= 1;
      if (pd.t < 0) pd.t += 1;
      const curve = arcCurves[pd.arcIndex]?.curve;
      if (curve) {
        const pt = curve.getPoint(pd.t);
        pulse.position.copy(pt);
      }
    }
  });

  // Imperatively add lines to group to avoid SVG <line> JSX conflict
  useEffect(() => {
    const group = linesRef.current;
    if (!group) return;
    group.clear();
    for (const geo of lineGeometries) {
      group.add(new THREE.Line(geo, arcMaterial));
    }
    return () => { group.clear(); };
  }, [lineGeometries, arcMaterial]);

  return (
    <group renderOrder={2}>
      {/* Node markers */}
      {nodeMeshes.map((nm, i) => (
        <mesh
          key={`node-${i}`}
          geometry={nodeGeo}
          material={nm.active ? activeMat : inactiveMat}
          position={nm.position}
        />
      ))}

      {/* Connection arcs — built imperatively */}
      <group ref={linesRef} />

      {/* Traveling pulse dots */}
      <group ref={pulseGroupRef}>
        {pulseData.map((pd, i) => (
          <mesh
            key={`pulse-${i}`}
            ref={(el) => { pulseRefs.current[i] = el!; }}
            geometry={pulseGeo}
            material={pulseMat}
          />
        ))}
      </group>
    </group>
  );
}
