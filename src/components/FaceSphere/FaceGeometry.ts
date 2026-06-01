// Procedural face topology — generates 3D particle positions for a human face.
// Particle layout: ~4000 points across head, eyes, nose, mouth regions.
// Returns Float32Array of [x,y,z, regionId] interleaved (4 floats per particle).

export interface FaceParticle {
  position: [number, number, number]; // x, y, z
  region: 'head' | 'eye-left' | 'eye-right' | 'nose' | 'mouth' | 'brow-left' | 'brow-right';
}

// ── 3D face shape parameters (normalized to ~1 unit) ──

const HEAD_W = 0.72;
const HEAD_H = 0.90;
const HEAD_D = 0.55;

function isInsideHead(x: number, y: number, z: number): boolean {
  // Ellipsoid head shape
  const dx = x / HEAD_W;
  const dy = y / HEAD_H;
  const dz = z / HEAD_D;
  return dx * dx + dy * dy + dz * dz <= 1.0;
}

function isInEye(x: number, y: number, z: number, sign: number): boolean {
  const ex = x - sign * 0.22; // offset from center
  const ey = y - 0.18;        // eye height
  const ez = z - 0.35;        // slightly forward
  return ex * ex * 8 + ey * ey * 12 + ez * ez * 4 <= 0.08;
}

function isInMouth(x: number, y: number, z: number): boolean {
  const mx = x;
  const my = y + 0.25;
  const mz = z - 0.30;
  return mx * mx * 6 + my * my * 9 + mz * mz * 4 <= 0.05;
}

function classifyParticle(x: number, y: number, z: number): FaceParticle['region'] {
  if (isInEye(x, y, z, 1)) return 'eye-right';
  if (isInEye(x, y, z, -1)) return 'eye-left';
  if (isInMouth(x, y, z)) return 'mouth';
  if (y > -0.25 && Math.abs(x) < 0.35 && z > 0.25) return 'nose'; // nose bridge rough
  if (y > 0.15 && Math.abs(x) > 0.25 && Math.abs(x) < 0.45 && z > 0.25) return 'brow-right';
  if (y > 0.15 && Math.abs(x) > 0.25 && Math.abs(x) < 0.45 && z > 0.25) return 'brow-left';
  return 'head';
}

export function generateFaceParticles(count: number = 4000): FaceParticle[] {
  const particles: FaceParticle[] = [];

  // Generate points on the head ellipsoid surface + some interior fill
  while (particles.length < count) {
    // Rejection sampling inside head volume
    const x = (Math.random() - 0.5) * HEAD_W * 2 * 1.1;
    const y = (Math.random() - 0.5) * HEAD_H * 2 * 1.1;
    const z = (Math.random() - 0.5) * HEAD_D * 2 * 1.1;

    if (isInsideHead(x, y, z)) {
      // Push to surface for better visual
      const dx = x / HEAD_W;
      const dy = y / HEAD_H;
      const dz = z / HEAD_D;
      const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      const sx = (dx / len) * HEAD_W * (0.85 + Math.random() * 0.15);
      const sy = (dy / len) * HEAD_H * (0.85 + Math.random() * 0.15);
      const sz = (dz / len) * HEAD_D * (0.85 + Math.random() * 0.15);

      const region = classifyParticle(sx, sy, sz);
      particles.push({ position: [sx, sy, sz], region });
    }
  }

  return particles;
}

export interface VertexData {
  positions: Float32Array;  // xyz interleaved
  colors: Float32Array;     // rgb interleaved
  eyeLeftIndices: number[];
  eyeRightIndices: number[];
  mouthIndices: number[];
  browLeftIndices: number[];
  browRightIndices: number[];
  headIndices: number[];
  noseIndices: number[];
}

const COLORS: Record<FaceParticle['region'], [number, number, number]> = {
  head:   [0.55, 0.70, 0.95],
  'eye-left':  [0.15, 0.20, 0.35],
  'eye-right': [0.15, 0.20, 0.35],
  mouth: [0.70, 0.40, 0.45],
  nose:  [0.50, 0.60, 0.75],
  'brow-left': [0.30, 0.35, 0.50],
  'brow-right': [0.30, 0.35, 0.50],
};

export function buildVertexData(particles: FaceParticle[]): VertexData {
  const n = particles.length;
  const positions = new Float32Array(n * 3);
  const colors = new Float32Array(n * 3);
  const indices: Record<string, number[]> = {
    eyeLeft: [], eyeRight: [], mouth: [], browLeft: [], browRight: [], head: [], nose: [],
  };

  particles.forEach((p, i) => {
    positions[i * 3] = p.position[0];
    positions[i * 3 + 1] = p.position[1];
    positions[i * 3 + 2] = p.position[2];

    const c = COLORS[p.region];
    colors[i * 3] = c[0];
    colors[i * 3 + 1] = c[1];
    colors[i * 3 + 2] = c[2];

    const idxMap: Record<string, number[]> = {
      head: indices.head, 'eye-left': indices.eyeLeft, 'eye-right': indices.eyeRight,
      mouth: indices.mouth, nose: indices.nose, 'brow-left': indices.browLeft, 'brow-right': indices.browRight,
    };
    idxMap[p.region]?.push(i);
  });

  return {
    positions, colors,
    eyeLeftIndices: indices.eyeLeft, eyeRightIndices: indices.eyeRight,
    mouthIndices: indices.mouth, browLeftIndices: indices.browLeft,
    browRightIndices: indices.browRight, headIndices: indices.head,
    noseIndices: indices.nose,
  };
}
