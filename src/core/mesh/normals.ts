import type { MeshData } from './types';

export function computeVertexNormals(mesh: MeshData): Float32Array {
  const { positions: p, indices: idx } = mesh;
  const n = new Float32Array(p.length);
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f] * 3;
    const b = idx[f + 1] * 3;
    const c = idx[f + 2] * 3;
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    n[a] += nx;
    n[a + 1] += ny;
    n[a + 2] += nz;
    n[b] += nx;
    n[b + 1] += ny;
    n[b + 2] += nz;
    n[c] += nx;
    n[c + 1] += ny;
    n[c + 2] += nz;
  }
  for (let i = 0; i < n.length; i += 3) {
    const l = Math.hypot(n[i], n[i + 1], n[i + 2]);
    if (l > 0) {
      n[i] /= l;
      n[i + 1] /= l;
      n[i + 2] /= l;
    } else {
      n[i + 1] = 1;
    }
  }
  return n;
}

export function computeFaceNormals(mesh: MeshData): { normals: Float32Array; areas: Float32Array } {
  const { positions: p, indices: idx } = mesh;
  const nf = idx.length / 3;
  const normals = new Float32Array(nf * 3);
  const areas = new Float32Array(nf);
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
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz);
    areas[f] = l / 2;
    if (l > 0) {
      normals[f * 3] = nx / l;
      normals[f * 3 + 1] = ny / l;
      normals[f * 3 + 2] = nz / l;
    }
  }
  return { normals, areas };
}

export function flipWinding(indices: Uint32Array): void {
  for (let f = 0; f < indices.length; f += 3) {
    const t = indices[f + 1];
    indices[f + 1] = indices[f + 2];
    indices[f + 2] = t;
  }
}
