import type { Matrix4 } from 'three';
import { v3, type Vec3 } from '../math/linalg';
import type { BodyQuery } from './bodyQuery';

export interface ClearanceSettings {
  min: number;
  target: number;
  max: number;
}

export const DEFAULT_CLEARANCE: ClearanceSettings = { min: 3, target: 8, max: 25 };

export function withAllowance(c: ClearanceSettings, allowance: number): ClearanceSettings {
  return { min: c.min + allowance, target: c.target + allowance, max: c.max + allowance };
}

export interface ClearanceSample {
  index: number;
  clearance: number;
  region: number;
  bodyPoint: Vec3;
  bodyNormal: Vec3;
  point: Vec3;
}

export interface ClearanceStats {
  count: number;
  min: number;
  p5: number;
  median: number;
  mean: number;
  std: number;
  max: number;
  intersecting: number;
  tight: number;
  good: number;
  loose: number;
}

const _p: Vec3 = [0, 0, 0];

function transformPoint(m: Matrix4, x: number, y: number, z: number, out: Vec3): Vec3 {
  const e = m.elements;
  const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15] || 1);
  out[0] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
  out[1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
  out[2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
  return out;
}

export function normalMatrix(m: Matrix4): number[] {
  const e = m.elements;
  const a = [e[0], e[1], e[2], e[4], e[5], e[6], e[8], e[9], e[10]];
  const det =
    a[0] * (a[4] * a[8] - a[5] * a[7]) -
    a[3] * (a[1] * a[8] - a[2] * a[7]) +
    a[6] * (a[1] * a[5] - a[2] * a[4]);
  const inv = 1 / (det || 1);
  return [
    (a[4] * a[8] - a[5] * a[7]) * inv,
    (a[5] * a[6] - a[3] * a[8]) * inv,
    (a[3] * a[7] - a[4] * a[6]) * inv,
    (a[2] * a[7] - a[1] * a[8]) * inv,
    (a[0] * a[8] - a[2] * a[6]) * inv,
    (a[1] * a[6] - a[0] * a[7]) * inv,
    (a[1] * a[5] - a[2] * a[4]) * inv,
    (a[2] * a[3] - a[0] * a[5]) * inv,
    (a[0] * a[4] - a[1] * a[3]) * inv,
  ];
}

export function measureClearance(
  points: Float32Array,
  normals: Float32Array,
  m: Matrix4,
  body: BodyQuery,
  maxRange = 120,
): ClearanceSample[] {
  const nm = normalMatrix(m);
  const out: ClearanceSample[] = [];
  const n = points.length / 3;
  for (let i = 0; i < n; i++) {
    const p = transformPoint(m, points[i * 3], points[i * 3 + 1], points[i * 3 + 2], _p);
    const res = body.distance(p, maxRange);
    if (!res) continue;
    const nx = normals[i * 3];
    const ny = normals[i * 3 + 1];
    const nz = normals[i * 3 + 2];
    const wn = v3.norm([
      nm[0] * nx + nm[3] * ny + nm[6] * nz,
      nm[1] * nx + nm[4] * ny + nm[7] * nz,
      nm[2] * nx + nm[5] * ny + nm[8] * nz,
    ]);
    const toBody = v3.sub(res.point, p);
    const facing = res.distance < 0 || v3.dot(wn, toBody) > 0.15 * v3.len(toBody);
    if (!facing) continue;
    out.push({
      index: i,
      clearance: res.distance,
      region: res.region,
      bodyPoint: res.point,
      bodyNormal: res.normal,
      point: [p[0], p[1], p[2]],
    });
  }
  return out;
}

export function clearanceStats(samples: ClearanceSample[], s: ClearanceSettings): ClearanceStats {
  const n = samples.length;
  if (n === 0) {
    return {
      count: 0,
      min: NaN,
      p5: NaN,
      median: NaN,
      mean: NaN,
      std: NaN,
      max: NaN,
      intersecting: 0,
      tight: 0,
      good: 0,
      loose: 0,
    };
  }
  const c = samples.map((x) => x.clearance).sort((a, b) => a - b);
  const q = (f: number) => c[Math.min(n - 1, Math.max(0, Math.round(f * (n - 1))))];
  const mean = c.reduce((a, b) => a + b, 0) / n;
  const std = Math.sqrt(c.reduce((a, b) => a + (b - mean) ** 2, 0) / n);
  let inter = 0;
  let tight = 0;
  let good = 0;
  let loose = 0;
  for (const v of c) {
    if (v < 0) inter++;
    else if (v < s.min) tight++;
    else if (v <= s.max) good++;
    else loose++;
  }
  return {
    count: n,
    min: c[0],
    p5: q(0.05),
    median: q(0.5),
    mean,
    std,
    max: c[n - 1],
    intersecting: inter / n,
    tight: tight / n,
    good: good / n,
    loose: loose / n,
  };
}
