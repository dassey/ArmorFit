import { mulberry32 } from '../math/rng';
import type { MeshData } from './types';

export interface SurfaceSamples {
  points: Float32Array;
  normals: Float32Array;
  faces: Uint32Array;
  areaPerSample: number;
}

export function sampleSurface(mesh: MeshData, count: number, seed = 1): SurfaceSamples {
  const { positions: p, indices: idx } = mesh;
  const nf = idx.length / 3;
  const cdf = new Float64Array(nf);
  let total = 0;
  for (let f = 0; f < nf; f++) {
    const a = idx[f * 3] * 3;
    const b = idx[f * 3 + 1] * 3;
    const c = idx[f * 3 + 2] * 3;
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    total += Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) / 2;
    cdf[f] = total;
  }
  const rand = mulberry32(seed);
  const points = new Float32Array(count * 3);
  const normals = new Float32Array(count * 3);
  const faces = new Uint32Array(count);
  for (let s = 0; s < count; s++) {
    const target = ((s + rand()) / count) * total;
    let lo = 0;
    let hi = nf - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cdf[mid] < target) lo = mid + 1;
      else hi = mid;
    }
    const f = lo;
    const a = idx[f * 3] * 3;
    const b = idx[f * 3 + 1] * 3;
    const c = idx[f * 3 + 2] * 3;
    let u = rand();
    let v = rand();
    if (u + v > 1) {
      u = 1 - u;
      v = 1 - v;
    }
    const w = 1 - u - v;
    for (let k = 0; k < 3; k++) points[s * 3 + k] = w * p[a + k] + u * p[b + k] + v * p[c + k];
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    normals[s * 3] = nx;
    normals[s * 3 + 1] = ny;
    normals[s * 3 + 2] = nz;
    faces[s] = f;
  }
  return { points, normals, faces, areaPerSample: total / Math.max(count, 1) };
}
