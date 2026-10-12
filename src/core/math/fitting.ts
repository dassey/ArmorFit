import { solveLinear, symmetricEigen3, v3, type Vec3 } from './linalg';

export interface PCAResult {
  mean: Vec3;
  values: Vec3;
  axes: [Vec3, Vec3, Vec3];
}

export function pca(points: ArrayLike<number>, weights?: ArrayLike<number>): PCAResult {
  const n = points.length / 3;
  let wsum = 0;
  const mean: Vec3 = [0, 0, 0];
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    wsum += w;
    mean[0] += w * points[i * 3];
    mean[1] += w * points[i * 3 + 1];
    mean[2] += w * points[i * 3 + 2];
  }
  mean[0] /= wsum;
  mean[1] /= wsum;
  mean[2] /= wsum;
  const c = new Float64Array(9);
  for (let i = 0; i < n; i++) {
    const w = weights ? weights[i] : 1;
    const x = points[i * 3] - mean[0];
    const y = points[i * 3 + 1] - mean[1];
    const z = points[i * 3 + 2] - mean[2];
    c[0] += w * x * x;
    c[1] += w * x * y;
    c[2] += w * x * z;
    c[4] += w * y * y;
    c[5] += w * y * z;
    c[8] += w * z * z;
  }
  c[3] = c[1];
  c[6] = c[2];
  c[7] = c[5];
  for (let i = 0; i < 9; i++) c[i] /= wsum;
  const { values, vectors } = symmetricEigen3(c);
  return { mean, values, axes: vectors };
}

export interface SphereFit {
  center: Vec3;
  radius: number;
  rms: number;
}

export function fitSphere(points: ArrayLike<number>): SphereFit | null {
  const n = points.length / 3;
  if (n < 4) return null;
  let mx = 0;
  let my = 0;
  let mz = 0;
  for (let i = 0; i < n; i++) {
    mx += points[i * 3];
    my += points[i * 3 + 1];
    mz += points[i * 3 + 2];
  }
  mx /= n;
  my /= n;
  mz /= n;
  const A = new Float64Array(16);
  const B = new Float64Array(4);
  for (let i = 0; i < n; i++) {
    const x = points[i * 3] - mx;
    const y = points[i * 3 + 1] - my;
    const z = points[i * 3 + 2] - mz;
    const row = [2 * x, 2 * y, 2 * z, 1];
    const rhs = x * x + y * y + z * z;
    for (let r = 0; r < 4; r++) {
      B[r] += row[r] * rhs;
      for (let c = 0; c < 4; c++) A[r * 4 + c] += row[r] * row[c];
    }
  }
  const sol = solveLinear(A, B, 4);
  if (!sol) return null;
  const [a, b, c, d] = sol;
  const r2 = d + a * a + b * b + c * c;
  if (!(r2 > 0)) return null;
  const radius = Math.sqrt(r2);
  const center: Vec3 = [a + mx, b + my, c + mz];
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const dd =
      Math.hypot(points[i * 3] - center[0], points[i * 3 + 1] - center[1], points[i * 3 + 2] - center[2]) -
      radius;
    ss += dd * dd;
  }
  return { center, radius, rms: Math.sqrt(ss / n) };
}

export interface CircleFit2D {
  cx: number;
  cy: number;
  radius: number;
  rms: number;
}

export function fitCircle2D(xy: ArrayLike<number>): CircleFit2D | null {
  const n = xy.length / 2;
  if (n < 3) return null;
  let mx = 0;
  let my = 0;
  for (let i = 0; i < n; i++) {
    mx += xy[i * 2];
    my += xy[i * 2 + 1];
  }
  mx /= n;
  my /= n;
  const A = new Float64Array(9);
  const B = new Float64Array(3);
  for (let i = 0; i < n; i++) {
    const x = xy[i * 2] - mx;
    const y = xy[i * 2 + 1] - my;
    const row = [2 * x, 2 * y, 1];
    const rhs = x * x + y * y;
    for (let r = 0; r < 3; r++) {
      B[r] += row[r] * rhs;
      for (let c = 0; c < 3; c++) A[r * 3 + c] += row[r] * row[c];
    }
  }
  const sol = solveLinear(A, B, 3);
  if (!sol) return null;
  const [a, b, c] = sol;
  const r2 = c + a * a + b * b;
  if (!(r2 > 0)) return null;
  const radius = Math.sqrt(r2);
  let ss = 0;
  for (let i = 0; i < n; i++) {
    const d = Math.hypot(xy[i * 2] - (a + mx), xy[i * 2 + 1] - (b + my)) - radius;
    ss += d * d;
  }
  return { cx: a + mx, cy: b + my, radius, rms: Math.sqrt(ss / n) };
}

export function fitCylinderAlong(
  points: ArrayLike<number>,
  axisGuess: Vec3,
): { point: Vec3; axis: Vec3; radius: number; rms: number } | null {
  const axis = v3.norm(axisGuess);
  const helper: Vec3 = Math.abs(axis[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const u = v3.norm(v3.cross(axis, helper));
  const w = v3.cross(axis, u);
  const n = points.length / 3;
  const xy = new Float64Array(n * 2);
  let along = 0;
  for (let i = 0; i < n; i++) {
    const p: Vec3 = [points[i * 3], points[i * 3 + 1], points[i * 3 + 2]];
    xy[i * 2] = v3.dot(p, u);
    xy[i * 2 + 1] = v3.dot(p, w);
    along += v3.dot(p, axis);
  }
  along /= n;
  const c = fitCircle2D(xy);
  if (!c) return null;
  const point = v3.add(v3.add(v3.scale(u, c.cx), v3.scale(w, c.cy)), v3.scale(axis, along));
  return { point, axis, radius: c.radius, rms: c.rms };
}
