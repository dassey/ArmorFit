import { v3, type Vec3 } from '../math/linalg';
import { computeVertexNormals } from '../mesh/normals';
import type { MeasurementProfile } from '../measurements/profile';
import { knownKeys } from '../measurements/profile';
import { MEASUREMENT_KEYS, type MeasurementKey, type Measurements } from '../measurements/schema';
import type { BodyAsset } from './asset';
import { morph, type BodyParams } from './morph';
import { applyFinish, jointPositions, poseMannequin } from './pose';
import { BodySolver, type SolveTarget } from './solve';

export interface Mannequin {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint16Array;
  regions: Uint8Array;
  joints: Record<string, Vec3>;
  landmarks: Record<string, Vec3>;
  measured: Partial<Measurements>;
  params: BodyParams;
}

const GENDER = { neutral: 0.5, masculine: 1, feminine: 0 } as const;

export function solveTargets(profile: MeasurementProfile): Partial<Record<MeasurementKey, SolveTarget>> {
  const known = new Set(knownKeys(profile));
  const out: Partial<Record<MeasurementKey, SolveTarget>> = {};
  for (const k of MEASUREMENT_KEYS) {
    const value = profile.values[k];
    out[k] = known.has(k)
      ? { value, tolerance: Math.max(1.5, value * 0.003) }
      : { value, tolerance: Math.max(4, value * 0.012) };
  }
  return out;
}

export class MannequinBuilder {
  readonly solver: BodySolver;
  private last?: BodyParams;

  constructor(readonly asset: BodyAsset) {
    this.solver = new BodySolver(asset);
  }

  build(profile: MeasurementProfile): Mannequin {
    const gender = GENDER[profile.preset];
    const initial = this.last && this.last.macro.gender === gender ? this.last : undefined;
    const res = this.solver.solve(solveTargets(profile), { gender, initial });
    this.last = res.params;
    return this.fromParams(res.params, res.measured);
  }

  fromParams(params: BodyParams, measured: Partial<Measurements> = {}): Mannequin {
    const asset = this.asset;
    const rest = morph(asset, params);
    applyFinish(asset, rest);
    const restJoints = jointPositions(asset, rest);
    const posed = poseMannequin(asset, rest, restJoints);
    const nBody = asset.header.bodyVertexCount;
    let minY = Infinity;
    for (const v of asset.header.landmarks.soles as number[])
      minY = Math.min(minY, posed.positions[v * 3 + 1]);
    const positions = new Float32Array(nBody * 3);
    for (let i = 0; i < nBody * 3; i += 3) {
      positions[i] = posed.positions[i];
      positions[i + 1] = posed.positions[i + 1] - minY;
      positions[i + 2] = posed.positions[i + 2];
    }
    const shift: Vec3 = [0, -minY, 0];
    const joints = Object.fromEntries(Object.entries(posed.joints).map(([k, p]) => [k, v3.add(p, shift)]));
    const landmarks: Record<string, Vec3> = {};
    for (const [k, v] of Object.entries(asset.header.landmarks)) {
      if (typeof v === 'number')
        landmarks[k] = [positions[v * 3], positions[v * 3 + 1], positions[v * 3 + 2]];
    }
    const indices = asset.indices;
    const normals = computeVertexNormals({ positions, indices: Uint32Array.from(indices) });
    return { positions, normals, indices, regions: asset.regions, joints, landmarks, measured, params };
  }
}
