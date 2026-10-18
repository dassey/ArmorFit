import { v3, type Vec3 } from '../math/linalg';
import { MEASUREMENT_KEYS, QUICK_KEYS, type MeasurementKey } from '../measurements/schema';
import type { PieceTypeId } from '../pieces/types';
import { decodeRegion, type RegionId } from './regions';

export type BodyPartId =
  'full' | 'head' | 'torso' | 'shoulders' | 'arms' | 'hands' | 'waist' | 'legs' | 'feet';

export interface BodyPartInfo {
  id: BodyPartId;
  label: string;
  noun: string;
  measurements: MeasurementKey[];
  pieces: PieceTypeId[];
  frame: 'both' | 'left';
}

export const BODY_PARTS: BodyPartInfo[] = [
  {
    id: 'full',
    label: 'Full body',
    noun: 'a full suit',
    measurements: MEASUREMENT_KEYS,
    pieces: [],
    frame: 'both',
  },
  {
    id: 'head',
    label: 'Helmet',
    noun: 'a helmet',
    measurements: ['headCirc', 'headLength', 'headWidth', 'neckCirc'],
    pieces: ['helmet'],
    frame: 'both',
  },
  {
    id: 'torso',
    label: 'Chest & back',
    noun: 'chest and back armor',
    measurements: ['chest', 'waist', 'shoulderWidth', 'torsoLength', 'neckCirc'],
    pieces: ['chest', 'back', 'abdomen', 'gorget'],
    frame: 'both',
  },
  {
    id: 'shoulders',
    label: 'Shoulders',
    noun: 'pauldrons',
    measurements: ['shoulderWidth', 'bicepCirc', 'upperArmLength', 'chest'],
    pieces: ['pauldron'],
    frame: 'both',
  },
  {
    id: 'arms',
    label: 'Arms',
    noun: 'arm armor',
    measurements: ['upperArmLength', 'bicepCirc', 'forearmLength', 'forearmCirc', 'wristCirc'],
    pieces: ['bicep', 'elbow', 'forearm'],
    frame: 'left',
  },
  {
    id: 'hands',
    label: 'Hands',
    noun: 'gloves and gauntlets',
    measurements: ['handLength', 'handWidth', 'wristCirc'],
    pieces: ['hand'],
    frame: 'left',
  },
  {
    id: 'waist',
    label: 'Waist & hips',
    noun: 'a belt and tassets',
    measurements: ['waist', 'hips', 'thighCirc'],
    pieces: ['belt', 'tasset'],
    frame: 'both',
  },
  {
    id: 'legs',
    label: 'Legs',
    noun: 'leg armor',
    measurements: ['thighLength', 'thighCirc', 'shinLength', 'calfCirc'],
    pieces: ['thigh', 'knee', 'shin', 'calf'],
    frame: 'both',
  },
  {
    id: 'feet',
    label: 'Feet',
    noun: 'boots',
    measurements: ['footLength', 'calfCirc'],
    pieces: ['boot'],
    frame: 'both',
  },
];

const BY_ID = new Map(BODY_PARTS.map((b) => [b.id, b]));

export function bodyPart(id: BodyPartId): BodyPartInfo {
  return BY_ID.get(id)!;
}

export function isBodyPartId(x: unknown): x is BodyPartId {
  return typeof x === 'string' && BY_ID.has(x as BodyPartId);
}

export function partForPiece(type: PieceTypeId): BodyPartId {
  return BODY_PARTS.find((b) => b.pieces.includes(type))?.id ?? 'full';
}

export function partMeasurements(part: BodyPartId, mode: 'quick' | 'detailed'): MeasurementKey[] {
  if (part === 'full') return mode === 'quick' ? QUICK_KEYS : MEASUREMENT_KEYS;
  return bodyPart(part).measurements;
}

export const SEGMENTS = ['axial', 'armL', 'armR', 'legL', 'legR'] as const;
const S = SEGMENTS.length;

const ARM: ReadonlySet<RegionId> = new Set(['deltoid', 'upperArm', 'elbow', 'forearm', 'wrist', 'hand']);
const LEG: ReadonlySet<RegionId> = new Set(['thigh', 'knee', 'shin', 'calf', 'foot']);

export function segmentOf(code: number): number {
  const { region, side } = decodeRegion(code);
  if (ARM.has(region)) return side === 2 ? 2 : 1;
  if (LEG.has(region)) return side === 2 ? 4 : 3;
  return 0;
}

export function segmentWeights(
  indices: ArrayLike<number>,
  regions: ArrayLike<number>,
  iterations = 12,
): Float32Array {
  const n = regions.length;
  const deg = new Uint32Array(n + 1);
  for (let i = 0; i < indices.length; i++) deg[indices[i] + 1] += 2;
  for (let v = 0; v < n; v++) deg[v + 1] += deg[v];
  const nbr = new Uint32Array(deg[n]);
  const fill = deg.slice(0, n);
  for (let i = 0; i < indices.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const a = indices[i + k];
      nbr[fill[a]++] = indices[i + ((k + 1) % 3)];
      nbr[fill[a]++] = indices[i + ((k + 2) % 3)];
    }
  }
  let w = new Float32Array(n * S);
  for (let v = 0; v < n; v++) w[v * S + segmentOf(regions[v])] = 1;
  let next = new Float32Array(n * S);
  for (let it = 0; it < iterations; it++) {
    for (let v = 0; v < n; v++) {
      const a = deg[v];
      const b = deg[v + 1];
      if (a === b) {
        for (let s = 0; s < S; s++) next[v * S + s] = w[v * S + s];
        continue;
      }
      const inv = 0.5 / (b - a);
      for (let s = 0; s < S; s++) {
        let sum = 0;
        for (let q = a; q < b; q++) sum += w[nbr[q] * S + s];
        next[v * S + s] = 0.5 * w[v * S + s] + sum * inv;
      }
    }
    [w, next] = [next, w];
  }
  return w;
}

export interface PartContext {
  positions: ArrayLike<number>;
  joints: Record<string, Vec3>;
  landmarks: Record<string, Vec3>;
}

type Field = (x: number, y: number, z: number) => number;

const REACH = 60;
const KEEP: Field = () => REACH;
const DROP: Field = () => -REACH;

function plane(point: Vec3, normal: Vec3): Field {
  const [a, b, c] = v3.norm(normal);
  const d = a * point[0] + b * point[1] + c * point[2];
  return (x, y, z) => a * x + b * y + c * z - d;
}

function both(f: Field, g: Field): Field {
  return (x, y, z) => Math.min(f(x, y, z), g(x, y, z));
}

function across(from: Vec3, to: Vec3, t: number, keepTo: boolean): Field {
  const dir = v3.norm(v3.sub(to, from));
  return plane(v3.lerp(from, to, t), keepTo ? dir : v3.scale(dir, -1));
}

function segmentFields(part: BodyPartId, ctx: PartContext): Field[] {
  const J = ctx.joints;
  const L = ctx.landmarks;
  const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
  const level = (y: number, keepAbove: boolean) => plane([0, y, 0], [0, keepAbove ? 1 : -1, 0]);
  const neck = (t: number, keepAbove: boolean) => {
    const dir = v3.norm(v3.sub(J.headBase, J.neckBase));
    return plane(v3.lerp(J.neckBase, J.headBase, t), keepAbove ? dir : v3.scale(dir, -1));
  };
  const sides = (f: (s: 'L' | 'R') => Field): [Field, Field] => [f('L'), f('R')];
  const navelY = L.omphalion[1];
  const sternumY = L.suprasternale[1];
  const hipY = (J.hipL[1] + J.hipR[1]) / 2;
  switch (part) {
    case 'full':
      return [KEEP, KEEP, KEEP, KEEP, KEEP];
    case 'head':
      return [neck(0.2, true), DROP, DROP, DROP, DROP];
    case 'torso':
      return [
        both(neck(0.55, false), level(lerp(hipY, navelY, 0.45), true)),
        ...sides((s) => across(J[`shoulder${s}`], J[`elbow${s}`], 0.04, false)),
        DROP,
        DROP,
      ];
    case 'shoulders':
      return [
        both(neck(0.55, false), level(lerp(navelY, sternumY, 0.45), true)),
        ...sides((s) => across(J[`shoulder${s}`], J[`elbow${s}`], 0.7, false)),
        DROP,
        DROP,
      ];
    case 'arms':
      return [DROP, ...sides((s) => across(J[`shoulder${s}`], J[`elbow${s}`], -0.12, true)), DROP, DROP];
    case 'hands':
      return [DROP, ...sides((s) => across(J[`elbow${s}`], J[`wrist${s}`], 0.5, true)), DROP, DROP];
    case 'waist':
      return [
        level(lerp(navelY, sternumY, 0.35), false),
        DROP,
        DROP,
        ...sides((s) => across(J[`hip${s}`], J[`knee${s}`], 0.5, false)),
      ];
    case 'legs': {
      const top = level(lerp(hipY, navelY, 0.2), false);
      return [top, DROP, DROP, top, top];
    }
    case 'feet':
      return [DROP, DROP, DROP, ...sides((s) => across(J[`knee${s}`], J[`ankle${s}`], 0.12, true))];
  }
}

export function partField(part: BodyPartId, weights: Float32Array, ctx: PartContext): Float32Array {
  const fields = segmentFields(part, ctx);
  const P = ctx.positions;
  const n = weights.length / S;
  const out = new Float32Array(n);
  for (let v = 0; v < n; v++) {
    const x = P[v * 3];
    const y = P[v * 3 + 1];
    const z = P[v * 3 + 2];
    let f = 0;
    for (let s = 0; s < S; s++) {
      const w = weights[v * S + s];
      if (w > 1e-4) f += w * Math.min(REACH, Math.max(-REACH, fields[s](x, y, z)));
    }
    out[v] = f;
  }
  return out;
}

export function partBounds(
  keep: Float32Array,
  positions: ArrayLike<number>,
  frame: BodyPartInfo['frame'],
): { min: Vec3; max: Vec3 } | null {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (let v = 0; v < keep.length; v++) {
    if (keep[v] < 0) continue;
    if (frame === 'left' && positions[v * 3] < 0) continue;
    for (let k = 0; k < 3; k++) {
      const c = positions[v * 3 + k];
      if (c < min[k]) min[k] = c;
      if (c > max[k]) max[k] = c;
    }
  }
  return min[0] <= max[0] ? { min, max } : null;
}

export function fieldAt(
  keep: ArrayLike<number>,
  indices: ArrayLike<number>,
  face: number,
  bary: [number, number, number],
): number {
  return (
    bary[0] * keep[indices[face * 3]] +
    bary[1] * keep[indices[face * 3 + 1]] +
    bary[2] * keep[indices[face * 3 + 2]]
  );
}
