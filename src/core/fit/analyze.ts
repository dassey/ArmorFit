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
}

export interface FitReport {
  stats: ClearanceStats;
  tally: RegionShare[];
  driving: MeasurementKey[];
}

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
  return { positions, normals, indices: preview.indices, samplePoints: s.points, sampleNormals: s.normals };
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
  const out = new Float32Array(n).fill(NaN);
  const e = wToWorld.elements;
  const nm = normalMatrix(wToWorld);
  const world = new Float32Array(n * 3);
  const facing = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    const x = piece.positions[i * 3];
    const y = piece.positions[i * 3 + 1];
    const z = piece.positions[i * 3 + 2];
    const px = e[0] * x + e[4] * y + e[8] * z + e[12];
    const py = e[1] * x + e[5] * y + e[9] * z + e[13];
    const pz = e[2] * x + e[6] * y + e[10] * z + e[14];
    world[i * 3] = px;
    world[i * 3 + 1] = py;
    world[i * 3 + 2] = pz;
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
      out[i] = res.distance;
      facing[i] = 1;
    }
  }
  const cell = copyRadius;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number, z: number) =>
    `${Math.floor(x / cell)},${Math.floor(y / cell)},${Math.floor(z / cell)}`;
  for (let i = 0; i < n; i++) {
    if (!facing[i]) continue;
    const k = key(world[i * 3], world[i * 3 + 1], world[i * 3 + 2]);
    const list = grid.get(k);
    if (list) list.push(i);
    else grid.set(k, [i]);
  }
  for (let i = 0; i < n; i++) {
    if (facing[i]) continue;
    const x = world[i * 3];
    const y = world[i * 3 + 1];
    const z = world[i * 3 + 2];
    const cx = Math.floor(x / cell);
    const cy = Math.floor(y / cell);
    const cz = Math.floor(z / cell);
    let best = -1;
    let bd = copyRadius * copyRadius;
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        for (let dz = -1; dz <= 1; dz++) {
          const list = grid.get(`${cx + dx},${cy + dy},${cz + dz}`);
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
    if (best >= 0) out[i] = out[best];
  }
  return out;
}
