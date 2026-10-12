import { Matrix4 } from 'three';
import { buildBVH, fibonacciDirections, rayDistance } from '../geometry/bvh';
import { fitCircle2D, fitSphere, pca } from '../math/fitting';
import { v3, type Vec3 } from '../math/linalg';
import { sampleSurface } from '../mesh/sample';
import { computeBounds, type MeshData } from '../mesh/types';
import type { PieceCategory } from './types';

export interface OrientationHints {
  category?: PieceCategory;
  openingDown?: boolean;
}

export interface Opening {
  direction: Vec3;
  size: number;
}

export interface OrientationResult {
  matrix: number[];
  category: PieceCategory;
  confidence: number;
  reasons: string[];
  contactPoint: Vec3;
  contactNormal: Vec3;
  center: Vec3;
  enclosure: number;
  openings: Opening[];
  radius: number;
}

const N_DIRS = 400;

interface Cluster {
  dirs: number[];
  mean: Vec3;
  size: number;
}

function clusterEscapes(dirs: Float64Array, escaped: Uint8Array): Cluster[] {
  const n = escaped.length;
  const spacing = Math.sqrt((4 * Math.PI) / n);
  const cosThr = Math.cos(spacing * 2.2);
  const label = new Int32Array(n).fill(-1);
  const clusters: Cluster[] = [];
  for (let s = 0; s < n; s++) {
    if (!escaped[s] || label[s] !== -1) continue;
    const c: Cluster = { dirs: [], mean: [0, 0, 0], size: 0 };
    const stack = [s];
    label[s] = clusters.length;
    while (stack.length) {
      const i = stack.pop()!;
      c.dirs.push(i);
      for (let j = 0; j < n; j++) {
        if (!escaped[j] || label[j] !== -1) continue;
        const d =
          dirs[i * 3] * dirs[j * 3] + dirs[i * 3 + 1] * dirs[j * 3 + 1] + dirs[i * 3 + 2] * dirs[j * 3 + 2];
        if (d > cosThr) {
          label[j] = clusters.length;
          stack.push(j);
        }
      }
    }
    for (const i of c.dirs) {
      c.mean[0] += dirs[i * 3];
      c.mean[1] += dirs[i * 3 + 1];
      c.mean[2] += dirs[i * 3 + 2];
    }
    c.mean = v3.norm(c.mean);
    c.size = c.dirs.length / n;
    clusters.push(c);
  }
  return clusters.sort((a, b) => b.size - a.size);
}

function deepestDirection(dirs: Float64Array, escaped: Uint8Array, members: number[]): Vec3 {
  const blocked: number[] = [];
  for (let i = 0; i < escaped.length; i++) if (!escaped[i]) blocked.push(i);
  const scored = members.map((i) => {
    let maxDot = -1;
    for (const j of blocked) {
      const d =
        dirs[i * 3] * dirs[j * 3] + dirs[i * 3 + 1] * dirs[j * 3 + 1] + dirs[i * 3 + 2] * dirs[j * 3 + 2];
      if (d > maxDot) maxDot = d;
    }
    return { i, maxDot };
  });
  scored.sort((a, b) => a.maxDot - b.maxDot);
  let sum: Vec3 = [0, 0, 0];
  for (const { i } of scored.slice(0, 3)) sum = v3.add(sum, [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]]);
  return v3.norm(sum);
}

function fileUpPrior(normal: Vec3): { up: Vec3; strength: number } {
  const cands: Vec3[] = [
    [0, 1, 0],
    [0, 0, 1],
  ];
  let best = { up: cands[0], strength: -1 };
  for (const c of cands) {
    const t = v3.sub(c, v3.scale(normal, v3.dot(c, normal)));
    const s = v3.len(t);
    if (s > best.strength + 0.05) best = { up: v3.norm(t), strength: s };
  }
  return best;
}

function orthonormalFrame(up: Vec3, front: Vec3): [Vec3, Vec3, Vec3] {
  const y = v3.norm(up);
  let z = v3.sub(front, v3.scale(y, v3.dot(front, y)));
  if (v3.len(z) < 1e-6) {
    const helper: Vec3 = Math.abs(y[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
    z = v3.sub(helper, v3.scale(y, v3.dot(helper, y)));
  }
  z = v3.norm(z);
  const x = v3.cross(y, z);
  return [x, y, z];
}

export function autoOrient(mesh: MeshData, hints: OrientationHints = {}): OrientationResult {
  const reasons: string[] = [];
  const samples = sampleSurface(mesh, 3000, 11);
  const pts = samples.points;
  const b = computeBounds(mesh.positions);
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const pc = pca(pts);
  const sphere = fitSphere(pts);
  const centroid = pc.mean;

  let center: Vec3 = centroid;
  let radius = size / 2;
  let sphereOk = false;
  if (sphere && sphere.radius < size * 3) {
    center = sphere.center;
    radius = sphere.radius;
    sphereOk = sphere.rms < sphere.radius * 0.35;
  }

  const { bvh } = buildBVH(mesh);
  const dirs = fibonacciDirections(N_DIRS);
  const escaped = new Uint8Array(N_DIRS);
  let blocked = 0;
  for (let i = 0; i < N_DIRS; i++) {
    const d: Vec3 = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
    const t = rayDistance(bvh, center, d, size * 4);
    if (t === Infinity) escaped[i] = 1;
    else blocked++;
  }
  const enclosure = blocked / N_DIRS;
  const clusters = clusterEscapes(dirs, escaped).filter((c) => c.size > 0.004);

  let category: PieceCategory;
  const big = clusters.filter((c) => c.size > 0.01);
  const antipodal = big.length >= 2 && v3.dot(big[0].mean, big[1].mean) < -0.5;
  if (enclosure > 0.6 && antipodal) category = 'tube';
  else if (enclosure > 0.45 && big.length >= 1) category = 'cap';
  else category = 'shell';
  let confidence = 0.75;
  if (hints.category && hints.category !== category) {
    reasons.push(`Shape looks like a ${category}, but the piece type suggests a ${hints.category}.`);
    if (!(category === 'tube' && enclosure > 0.8)) category = hints.category;
    confidence -= 0.15;
  }

  let up: Vec3;
  let front: Vec3;
  let contactNormal: Vec3;
  let contactPoint: Vec3;
  const openings: Opening[] = clusters.map((c) => ({ direction: c.mean, size: c.size }));

  if (category === 'tube') {
    let axis: Vec3;
    if (antipodal) axis = v3.norm(v3.sub(big[0].mean, big[1].mean));
    else {
      axis = pc.axes[0];
      confidence -= 0.15;
      reasons.push('No two open ends found, so the long axis is taken as the limb axis.');
    }
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < pts.length; i += 3) {
      const t = v3.dot(v3.sub([pts[i], pts[i + 1], pts[i + 2]], center), axis);
      lo = Math.min(lo, t);
      hi = Math.max(hi, t);
    }
    const endRadius = (sign: number) => {
      const xy: number[] = [];
      const helper: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
      const u = v3.norm(v3.cross(axis, helper));
      const w = v3.cross(axis, u);
      for (let i = 0; i < pts.length; i += 3) {
        const p: Vec3 = [pts[i] - center[0], pts[i + 1] - center[1], pts[i + 2] - center[2]];
        const t = v3.dot(p, axis);
        const edge = sign > 0 ? hi - t : t - lo;
        if (edge < (hi - lo) * 0.15) xy.push(v3.dot(p, u), v3.dot(p, w));
      }
      return fitCircle2D(xy)?.radius ?? 0;
    };
    const rTop = endRadius(1);
    const rBottom = endRadius(-1);
    up = rTop >= rBottom ? axis : v3.scale(axis, -1);
    const taper = Math.abs(rTop - rBottom) / Math.max(rTop, rBottom, 1e-6);
    if (taper < 0.05) {
      confidence -= 0.2;
      reasons.push('Both ends are about the same size, so which end is up is a guess.');
    } else reasons.push('The wider end is treated as the top (elbow/knee end).');
    const prior = fileUpPrior(up);
    const fileFront: Vec3 = Math.abs(up[2]) < 0.8 ? [0, 0, 1] : [0, 1, 0];
    front = fileFront;
    void prior;
    radius = (rTop + rBottom) / 2;
    contactNormal = up;
    contactPoint = center;
    reasons.push('Open at both ends: treated as a tube that wraps a limb.');
  } else if (category === 'cap') {
    const main = big[0] ?? clusters[0];
    const openingDown = hints.openingDown ?? true;
    const deepest = main ? deepestDirection(dirs, escaped, main.dirs) : ([0, -1, 0] as Vec3);
    up = openingDown ? v3.scale(deepest, -1) : deepest;
    let faceSum: Vec3 = [0, 0, 0];
    let faceCount = 0;
    for (let i = 0; i < N_DIRS; i++) {
      if (!escaped[i]) continue;
      const d: Vec3 = [dirs[i * 3], dirs[i * 3 + 1], dirs[i * 3 + 2]];
      if (Math.abs(v3.dot(d, up)) < 0.45) {
        faceSum = v3.add(faceSum, d);
        faceCount++;
      }
    }
    const faceDir = v3.sub(faceSum, v3.scale(up, v3.dot(faceSum, up)));
    if (faceCount >= N_DIRS * 0.01 && v3.len(faceDir) > faceCount * 0.3) {
      front = v3.norm(faceDir);
      reasons.push('Front taken from the face opening.');
    } else {
      const horiz = pc.axes.map((a) => v3.sub(a, v3.scale(up, v3.dot(a, up))));
      horiz.sort((p, q) => v3.len(q) - v3.len(p));
      front = v3.norm(horiz[0]);
      const ref: Vec3 = Math.abs(up[2]) < 0.8 ? [0, 0, 1] : [0, -1, 0];
      if (v3.dot(front, ref) < 0) front = v3.scale(front, -1);
      confidence -= 0.25;
      reasons.push('No face opening found; front/back direction is a guess.');
    }
    contactNormal = up;
    contactPoint = center;
    reasons.push(
      openingDown
        ? 'Main opening points down (like a helmet).'
        : 'Main opening points up (like a boot or glove).',
    );
  } else {
    let inward: Vec3;
    if (sphereOk) {
      inward = v3.norm(v3.sub(center, centroid));
      reasons.push('Concave side (centre of curvature) faces the body.');
    } else {
      inward = v3.scale(pc.axes[2], -1);
      confidence -= 0.35;
      reasons.push('Piece is nearly flat: which side faces the body is a guess.');
    }
    const outward = v3.scale(inward, -1);
    const prior = fileUpPrior(outward);
    if (prior.strength > 0.85) {
      up = prior.up;
      reasons.push('Up direction taken from the file’s own axes.');
    } else {
      const t = v3.sub(pc.axes[0], v3.scale(outward, v3.dot(pc.axes[0], outward)));
      up = v3.norm(t);
      if (v3.dot(up, prior.up) < 0) up = v3.scale(up, -1);
      confidence -= 0.25;
      reasons.push('Up direction guessed from the long axis; please check.');
    }
    front = outward;
    contactNormal = outward;
    let ic: Vec3 = [0, 0, 0];
    let nIn = 0;
    for (let i = 0; i < samples.normals.length; i += 3) {
      const n: Vec3 = [samples.normals[i], samples.normals[i + 1], samples.normals[i + 2]];
      if (v3.dot(n, inward) > 0.3) {
        ic = v3.add(ic, [pts[i], pts[i + 1], pts[i + 2]]);
        nIn++;
      }
    }
    ic = nIn ? v3.scale(ic, 1 / nIn) : centroid;
    const back = v3.sub(ic, v3.scale(outward, size));
    const t = rayDistance(bvh, back, outward, size * 3);
    contactPoint = t < Infinity ? v3.add(back, v3.scale(outward, t)) : ic;
    if (sphereOk && sphere) radius = sphere.radius;
  }

  let x: Vec3;
  let y: Vec3;
  let z: Vec3;
  if (category === 'shell') {
    [x, y, z] = orthonormalFrame(up, front);
  } else {
    [x, y, z] = orthonormalFrame(up, front);
  }
  const R = new Matrix4().makeBasis(
    { x: x[0], y: x[1], z: x[2] } as never,
    { x: y[0], y: y[1], z: y[2] } as never,
    { x: z[0], y: z[1], z: z[2] } as never,
  );
  R.transpose();
  const toLocal = (p: Vec3): Vec3 => [v3.dot(p, x), v3.dot(p, y), v3.dot(p, z)];
  const origin = toLocal(category === 'shell' ? contactPoint : center);
  const T = new Matrix4().makeTranslation(-origin[0], -origin[1], -origin[2]);
  const M = T.multiply(R);

  if (!sphereOk && category !== 'shell') confidence -= 0.1;
  confidence = Math.max(0.05, Math.min(1, confidence));
  return {
    matrix: M.elements.slice(),
    category,
    confidence,
    reasons,
    contactPoint: v3.sub(toLocal(contactPoint), origin),
    contactNormal: toLocal(contactNormal),
    center: v3.sub(toLocal(center), origin),
    enclosure,
    openings: openings.map((o) => ({ direction: toLocal(o.direction), size: o.size })),
    radius,
  };
}
