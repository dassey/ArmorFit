import type { MeshData } from './types';

export interface TopologyReport {
  vertices: number;
  triangles: number;
  edges: number;
  boundaryEdges: number;
  nonManifoldEdges: number;
  inconsistentEdges: number;
  components: number;
  watertight: boolean;
}

interface EdgeTable {
  find(a: number, b: number): number;
  count: Uint8Array;
  he0: Int32Array;
  he1: Int32Array;
  nEdges: number;
}

function buildEdgeTable(mesh: MeshData): EdgeTable {
  const { indices } = mesh;
  const nHalf = indices.length;
  let cap = 1;
  while (cap < nHalf * 2) cap <<= 1;
  const mask = cap - 1;
  const keyA = new Int32Array(cap).fill(-1);
  const keyB = new Int32Array(cap);
  const slotEdge = new Int32Array(cap);
  const count = new Uint8Array(nHalf);
  const he0 = new Int32Array(nHalf).fill(-1);
  const he1 = new Int32Array(nHalf).fill(-1);
  let nEdges = 0;
  const hash = (a: number, b: number) => (Math.imul(a, 73856093) ^ Math.imul(b, 19349663)) & mask;
  for (let h = 0; h < nHalf; h++) {
    const f = (h / 3) | 0;
    const k = h - f * 3;
    const u = indices[h];
    const w = indices[f * 3 + ((k + 1) % 3)];
    const a = u < w ? u : w;
    const b = u < w ? w : u;
    let s = hash(a, b);
    for (;;) {
      if (keyA[s] === -1) {
        keyA[s] = a;
        keyB[s] = b;
        const e = nEdges++;
        slotEdge[s] = e;
        he0[e] = h;
        count[e] = 1;
        break;
      }
      if (keyA[s] === a && keyB[s] === b) {
        const e = slotEdge[s];
        if (he1[e] === -1) he1[e] = h;
        if (count[e] < 255) count[e]++;
        break;
      }
      s = (s + 1) & mask;
    }
  }
  const find = (u: number, w: number) => {
    const a = u < w ? u : w;
    const b = u < w ? w : u;
    let s = hash(a, b);
    for (;;) {
      if (keyA[s] === -1) return -1;
      if (keyA[s] === a && keyB[s] === b) return slotEdge[s];
      s = (s + 1) & mask;
    }
  };
  return { find, count, he0, he1, nEdges };
}

function halfEdgeFrom(indices: Uint32Array, h: number): number {
  return indices[h];
}

function halfEdgeTo(indices: Uint32Array, h: number): number {
  const f = (h / 3) | 0;
  const k = h - f * 3;
  return indices[f * 3 + ((k + 1) % 3)];
}

class UnionFind {
  parent: Int32Array;
  constructor(n: number) {
    this.parent = new Int32Array(n);
    for (let i = 0; i < n; i++) this.parent[i] = i;
  }
  find(x: number): number {
    const p = this.parent;
    while (p[x] !== x) {
      p[x] = p[p[x]];
      x = p[x];
    }
    return x;
  }
  union(a: number, b: number): void {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent[ra] = rb;
  }
}

export function triangleComponents(mesh: MeshData): { labels: Uint32Array; count: number } {
  const { indices } = mesh;
  const nv = mesh.positions.length / 3;
  const uf = new UnionFind(nv);
  for (let f = 0; f < indices.length; f += 3) {
    uf.union(indices[f], indices[f + 1]);
    uf.union(indices[f], indices[f + 2]);
  }
  const rootToLabel = new Map<number, number>();
  const labels = new Uint32Array(indices.length / 3);
  for (let f = 0; f < labels.length; f++) {
    const r = uf.find(indices[f * 3]);
    let l = rootToLabel.get(r);
    if (l === undefined) {
      l = rootToLabel.size;
      rootToLabel.set(r, l);
    }
    labels[f] = l;
  }
  return { labels, count: rootToLabel.size };
}

export function analyzeTopology(mesh: MeshData): TopologyReport {
  const { indices } = mesh;
  const et = buildEdgeTable(mesh);
  let boundary = 0;
  let nonManifold = 0;
  let inconsistent = 0;
  for (let e = 0; e < et.nEdges; e++) {
    const c = et.count[e];
    if (c === 1) boundary++;
    else if (c > 2) nonManifold++;
    else {
      const h0 = et.he0[e];
      const h1 = et.he1[e];
      if (halfEdgeFrom(indices, h0) === halfEdgeFrom(indices, h1)) inconsistent++;
    }
  }
  const comps = triangleComponents(mesh);
  return {
    vertices: mesh.positions.length / 3,
    triangles: indices.length / 3,
    edges: et.nEdges,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    inconsistentEdges: inconsistent,
    components: comps.count,
    watertight: boundary === 0 && nonManifold === 0 && inconsistent === 0,
  };
}

export function boundaryLoops(mesh: MeshData): number[][] {
  const { indices } = mesh;
  const et = buildEdgeTable(mesh);
  const next = new Map<number, number[]>();
  for (let e = 0; e < et.nEdges; e++) {
    if (et.count[e] !== 1) continue;
    const h = et.he0[e];
    const from = halfEdgeTo(indices, h);
    const to = halfEdgeFrom(indices, h);
    const list = next.get(from);
    if (list) list.push(to);
    else next.set(from, [to]);
  }
  const loops: number[][] = [];
  for (const start of next.keys()) {
    let outs = next.get(start);
    while (outs && outs.length > 0) {
      const loop = [start];
      let cur = outs.pop()!;
      let guard = 0;
      while (cur !== start && guard++ < 1e7) {
        loop.push(cur);
        const o = next.get(cur);
        if (!o || o.length === 0) break;
        cur = o.pop()!;
      }
      if (loop.length >= 3) loops.push(loop);
      outs = next.get(start);
    }
  }
  return loops;
}

export function signedVolume(mesh: MeshData): number {
  const { positions: p, indices: idx } = mesh;
  let v = 0;
  for (let f = 0; f < idx.length; f += 3) {
    const a = idx[f] * 3;
    const b = idx[f + 1] * 3;
    const c = idx[f + 2] * 3;
    v +=
      p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
      p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
      p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
  }
  return v / 6;
}

export function surfaceArea(mesh: MeshData): number {
  const { positions: p, indices: idx } = mesh;
  let s = 0;
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
    s += Math.hypot(e1y * e2z - e1z * e2y, e1z * e2x - e1x * e2z, e1x * e2y - e1y * e2x) / 2;
  }
  return s;
}

export function fixWinding(mesh: MeshData): number {
  const { indices } = mesh;
  const nf = indices.length / 3;
  const et = buildEdgeTable(mesh);
  const visited = new Uint8Array(nf);
  const flipped = new Uint8Array(nf);
  let flips = 0;
  const queue = new Int32Array(nf);

  const flip = (f: number) => {
    const t = indices[f * 3 + 1];
    indices[f * 3 + 1] = indices[f * 3 + 2];
    indices[f * 3 + 2] = t;
    flipped[f] ^= 1;
  };

  const compFaces: number[][] = [];
  for (let seed = 0; seed < nf; seed++) {
    if (visited[seed]) continue;
    const faces: number[] = [];
    let qh = 0;
    let qt = 0;
    queue[qt++] = seed;
    visited[seed] = 1;
    while (qh < qt) {
      const f = queue[qh++];
      faces.push(f);
      for (let k = 0; k < 3; k++) {
        const a = indices[f * 3 + k];
        const b = indices[f * 3 + ((k + 1) % 3)];
        const e = et.find(a, b);
        if (e < 0 || et.count[e] !== 2) continue;
        const h0 = et.he0[e];
        const h1 = et.he1[e];
        const other = ((h0 / 3) | 0) === f ? (h1 / 3) | 0 : (h0 / 3) | 0;
        if (other === f || visited[other]) continue;
        let sameDir = false;
        for (let j = 0; j < 3; j++) {
          const oa = indices[other * 3 + j];
          const ob = indices[other * 3 + ((j + 1) % 3)];
          if (oa === a && ob === b) sameDir = true;
        }
        if (sameDir) {
          flip(other);
          flips++;
        }
        visited[other] = 1;
        queue[qt++] = other;
      }
    }
    compFaces.push(faces);
  }

  for (const faces of compFaces) {
    let v = 0;
    const p = mesh.positions;
    for (const f of faces) {
      const a = indices[f * 3] * 3;
      const b = indices[f * 3 + 1] * 3;
      const c = indices[f * 3 + 2] * 3;
      v +=
        p[a] * (p[b + 1] * p[c + 2] - p[b + 2] * p[c + 1]) -
        p[a + 1] * (p[b] * p[c + 2] - p[b + 2] * p[c]) +
        p[a + 2] * (p[b] * p[c + 1] - p[b + 1] * p[c]);
    }
    if (v < 0) {
      for (const f of faces) flip(f);
      flips += faces.length;
    }
  }
  return flips;
}
