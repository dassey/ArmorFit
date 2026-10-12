import { computeBounds, type MeshData } from './types';

export interface WeldResult {
  mesh: MeshData;
  verticesBefore: number;
  verticesAfter: number;
  degenerateRemoved: number;
}

export function weldVertices(mesh: MeshData, tolerance?: number): WeldResult {
  const { positions, indices } = mesh;
  const nIn = positions.length / 3;
  const b = computeBounds(positions);
  const diag = Math.hypot(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]) || 1;
  const eps = tolerance ?? Math.max(diag * 1e-6, 1e-9);
  const eps2 = eps * eps;
  const inv = 1 / (8 * eps);
  const near = 1 / 8;

  let cap = 1;
  while (cap < nIn * 2) cap <<= 1;
  const mask = cap - 1;
  const table = new Int32Array(cap).fill(-1);
  const cellX = new Int32Array(nIn);
  const cellY = new Int32Array(nIn);
  const cellZ = new Int32Array(nIn);
  const remap = new Uint32Array(nIn);
  const outPos = new Float32Array(nIn * 3);
  let nOut = 0;
  const hash = (x: number, y: number, z: number) =>
    (Math.imul(x, 73856093) ^ Math.imul(y, 19349663) ^ Math.imul(z, 83492791)) & mask;

  const find = (x: number, y: number, z: number, px: number, py: number, pz: number): number => {
    for (let h = hash(x, y, z); table[h] !== -1; h = (h + 1) & mask) {
      const j = table[h];
      if (cellX[j] !== x || cellY[j] !== y || cellZ[j] !== z) continue;
      const dx = outPos[j * 3] - px;
      const dy = outPos[j * 3 + 1] - py;
      const dz = outPos[j * 3 + 2] - pz;
      if (dx * dx + dy * dy + dz * dz <= eps2) return j;
    }
    return -1;
  };

  for (let i = 0; i < nIn; i++) {
    const px = positions[i * 3];
    const py = positions[i * 3 + 1];
    const pz = positions[i * 3 + 2];
    const fx = (px - b.min[0]) * inv;
    const fy = (py - b.min[1]) * inv;
    const fz = (pz - b.min[2]) * inv;
    const x = Math.floor(fx);
    const y = Math.floor(fy);
    const z = Math.floor(fz);
    const sx = fx - x < near ? -1 : fx - x > 1 - near ? 1 : 0;
    const sy = fy - y < near ? -1 : fy - y > 1 - near ? 1 : 0;
    const sz = fz - z < near ? -1 : fz - z > 1 - near ? 1 : 0;
    let match = -1;
    for (let a = 0; a <= (sx ? 1 : 0) && match < 0; a++) {
      for (let c = 0; c <= (sy ? 1 : 0) && match < 0; c++) {
        for (let d = 0; d <= (sz ? 1 : 0) && match < 0; d++) {
          match = find(x + a * sx, y + c * sy, z + d * sz, px, py, pz);
        }
      }
    }
    if (match >= 0) {
      remap[i] = match;
      continue;
    }
    let h = hash(x, y, z);
    while (table[h] !== -1) h = (h + 1) & mask;
    table[h] = nOut;
    cellX[nOut] = x;
    cellY[nOut] = y;
    cellZ[nOut] = z;
    outPos[nOut * 3] = px;
    outPos[nOut * 3 + 1] = py;
    outPos[nOut * 3 + 2] = pz;
    remap[i] = nOut++;
  }

  const triIn = indices.length / 3;
  const outIdx = new Uint32Array(indices.length);
  let t = 0;
  let degenerate = 0;
  for (let f = 0; f < triIn; f++) {
    const a = remap[indices[f * 3]];
    const c = remap[indices[f * 3 + 1]];
    const d = remap[indices[f * 3 + 2]];
    if (a === c || c === d || a === d) {
      degenerate++;
      continue;
    }
    outIdx[t++] = a;
    outIdx[t++] = c;
    outIdx[t++] = d;
  }

  return {
    mesh: { positions: outPos.slice(0, nOut * 3), indices: outIdx.slice(0, t) },
    verticesBefore: nIn,
    verticesAfter: nOut,
    degenerateRemoved: degenerate,
  };
}

export function unweld(mesh: MeshData): MeshData {
  const { positions, indices } = mesh;
  const out = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i] * 3;
    out[i * 3] = positions[v];
    out[i * 3 + 1] = positions[v + 1];
    out[i * 3 + 2] = positions[v + 2];
  }
  const idx = new Uint32Array(indices.length);
  for (let i = 0; i < idx.length; i++) idx[i] = i;
  return { positions: out, indices: idx };
}

export function compactVertices(mesh: MeshData): MeshData {
  const { positions, indices, normals } = mesh;
  const nv = positions.length / 3;
  const remap = new Int32Array(nv).fill(-1);
  let n = 0;
  for (let i = 0; i < indices.length; i++) {
    const v = indices[i];
    if (remap[v] === -1) remap[v] = n++;
  }
  if (n === nv) return mesh;
  const pos = new Float32Array(n * 3);
  const nor = normals ? new Float32Array(n * 3) : undefined;
  for (let v = 0; v < nv; v++) {
    const r = remap[v];
    if (r === -1) continue;
    pos[r * 3] = positions[v * 3];
    pos[r * 3 + 1] = positions[v * 3 + 1];
    pos[r * 3 + 2] = positions[v * 3 + 2];
    if (nor && normals) {
      nor[r * 3] = normals[v * 3];
      nor[r * 3 + 1] = normals[v * 3 + 1];
      nor[r * 3 + 2] = normals[v * 3 + 2];
    }
  }
  const idx = new Uint32Array(indices.length);
  for (let i = 0; i < indices.length; i++) idx[i] = remap[indices[i]];
  return { positions: pos, indices: idx, normals: nor };
}
