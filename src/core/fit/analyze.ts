import type { Matrix4 } from 'three';
import { computeVertexNormals } from '../mesh/normals';
import { sampleSurface } from '../mesh/sample';
import type { MeshData } from '../mesh/types';
import type { MeasurementKey } from '../measurements/schema';
import type { BodyQuery } from './bodyQuery';
import {
  clearanceStats,
  measureClearance,
  normalMatrix,
  type ClearanceSettings,
  type ClearanceStats,
} from './clearance';
import { drivingMeasurements, regionTally, type RegionShare } from './regionTally';

export interface AnalysisPiece {
  positions: Float32Array;
  normals: Float32Array;
  indices: Uint32Array;
  samplePoints: Float32Array;
  sampleNormals: Float32Array;
  reps: Uint32Array;
  repOf: Uint32Array;
}

export interface FitReport {
  stats: ClearanceStats;
  tally: RegionShare[];
  driving: MeasurementKey[];
}

const HEATMAP_POINTS = 8000;

export function prepareAnalysisPiece(preview: MeshData, fileToW: Matrix4, samples = 3000): AnalysisPiece {
  const positions = new Float32Array(preview.positions.length);
  const e = fileToW.elements;
  for (let i = 0; i < positions.length; i += 3) {
    const x = preview.positions[i];
    const y = preview.positions[i + 1];
    const z = preview.positions[i + 2];
    positions[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    positions[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    positions[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  const mesh: MeshData = { positions, indices: preview.indices };
  const normals = computeVertexNormals(mesh);
  const s = sampleSurface(mesh, samples, 13);
  const { reps, repOf } = representatives(positions, normals, HEATMAP_POINTS);
  return {
    positions,
    normals,
    indices: preview.indices,
    samplePoints: s.points,
    sampleNormals: s.normals,
    reps,
    repOf,
  };
}

export function analyzePiece(
  piece: AnalysisPiece,
  wToWorld: Matrix4,
  body: BodyQuery,
  s: ClearanceSettings,
): FitReport {
  const samples = measureClearance(piece.samplePoints, piece.sampleNormals, wToWorld, body);
  const tally = regionTally(samples);
  return { stats: clearanceStats(samples, s), tally, driving: drivingMeasurements(tally) };
}

export function vertexClearance(
  piece: AnalysisPiece,
  wToWorld: Matrix4,
  body: BodyQuery,
  maxRange = 150,
  copyRadius = 12,
): Float32Array {
  const n = piece.positions.length / 3;
  const reps = piece.reps;
  const m = reps.length;
  const repValue = new Float32Array(m).fill(NaN);
  const e = wToWorld.elements;
  const nm = normalMatrix(wToWorld);
  const world = new Float32Array(m * 3);
  const facing = new Uint8Array(m);
  for (let r = 0; r < m; r++) {
    const i = reps[r];
    const x = piece.positions[i * 3];
    const y = piece.positions[i * 3 + 1];
    const z = piece.positions[i * 3 + 2];
    const px = e[0] * x + e[4] * y + e[8] * z + e[12];
    const py = e[1] * x + e[5] * y + e[9] * z + e[13];
    const pz = e[2] * x + e[6] * y + e[10] * z + e[14];
    world[r * 3] = px;
    world[r * 3 + 1] = py;
    world[r * 3 + 2] = pz;
    const res = body.distance([px, py, pz], maxRange);
    if (!res) continue;
    const nx = piece.normals[i * 3];
    const ny = piece.normals[i * 3 + 1];
    const nz = piece.normals[i * 3 + 2];
    const wx = nm[0] * nx + nm[3] * ny + nm[6] * nz;
    const wy = nm[1] * nx + nm[4] * ny + nm[7] * nz;
    const wz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
    const tx = res.point[0] - px;
    const ty = res.point[1] - py;
    const tz = res.point[2] - pz;
    const tl = Math.hypot(tx, ty, tz) || 1;
    const wl = Math.hypot(wx, wy, wz) || 1;
    if (res.distance < 0 || (wx * tx + wy * ty + wz * tz) / (tl * wl) > 0.15) {
      repValue[r] = res.distance;
      facing[r] = 1;
    }
  }
  const cell = copyRadius;
  const grid = new Map<number, number[]>();
  const key = (cx: number, cy: number, cz: number) => ((cx + 4096) * 8192 + (cy + 4096)) * 8192 + (cz + 4096);
  for (let r = 0; r < m; r++) {
    if (!facing[r]) continue;
    const k = key(
      Math.floor(world[r * 3] / cell),
      Math.floor(world[r * 3 + 1] / cell),
      Math.floor(world[r * 3 + 2] / cell),
    );
    const list = grid.get(k);
    if (list) list.push(r);
    else grid.set(k, [r]);
  }
  for (let r = 0; r < m; r++) {
    if (facing[r]) continue;
    const x = world[r * 3];
    const y = world[r * 3 + 1];
    const z = world[r * 3 + 2];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let best = -1;
    let bd = copyRadius * copyRadius;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(key(cx + dx, cy + dy, cz + dz));
          if (!list) continue;
          for (const j of list) {
            const d = (world[j * 3] - x) ** 2 + (world[j * 3 + 1] - y) ** 2 + (world[j * 3 + 2] - z) ** 2;
            if (d < bd) {
              bd = d;
              best = j;
            }
          }
        }
      }
    }
    if (best >= 0) repValue[r] = repValue[best];
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) out[i] = repValue[piece.repOf[i]];
  return out;
}

export function representatives(
  positions: Float32Array,
  normals: Float32Array,
  target: number,
): { reps: Uint32Array; repOf: Uint32Array } {
  const n = positions.length / 3;
  const repOf = new Uint32Array(n);
  if (n <= target) {
    for (let i = 0; i < n; i++) repOf[i] = i;
    return { reps: repOf.slice(), repOf };
  }
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], positions[i * 3 + k]);
      max[k] = Math.max(max[k], positions[i * 3 + k]);
    }
  const span = Math.max(max[0] - min[0], max[1] - min[1], max[2] - min[2], 1);
  let cell = span / Math.sqrt(target);
  for (let attempt = 0; attempt < 6; attempt++) {
    const map = new Map<number, number>();
    const reps: number[] = [];
    const dims = Math.ceil(span / cell) + 2;
    for (let i = 0; i < n; i++) {
      const ix = Math.floor((positions[i * 3] - min[0]) / cell);
      const iy = Math.floor((positions[i * 3 + 1] - min[1]) / cell);
      const iz = Math.floor((positions[i * 3 + 2] - min[2]) / cell);
      const nx = normals[i * 3];
      const ny = normals[i * 3 + 1];
      const nz = normals[i * 3 + 2];
      const ax = Math.abs(nx);
      const ay = Math.abs(ny);
      const az = Math.abs(nz);
      const bin = ax >= ay && ax >= az ? (nx > 0 ? 0 : 1) : ay >= az ? (ny > 0 ? 2 : 3) : nz > 0 ? 4 : 5;
      const k = ((ix * dims + iy) * dims + iz) * 6 + bin;
      let r = map.get(k);
      if (r === undefined) {
        r = reps.length;
        reps.push(i);
        map.set(k, r);
      }
      repOf[i] = r;
    }
    if (reps.length <= target * 1.3 || attempt === 5) return { reps: Uint32Array.from(reps), repOf };
    cell *= Math.sqrt(reps.length / target);
  }
  return {
    reps: Uint32Array.from({ length: n }, (_, i) => i),
    repOf: Uint32Array.from({ length: n }, (_, i) => i),
  };
}
