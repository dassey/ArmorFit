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

function windingPass(mesh: MeshData, et: EdgeTable): { flips: number; inconsistent: number } {
  const { indices } = mesh;
  const p = mesh.positions;
  const nf = indices.length / 3;
  const edgeOf = new Int32Array(indices.length).fill(-1);
  for (let e = 0; e < et.nEdges; e++) {
    edgeOf[et.he0[e]] = e;
    if (et.he1[e] >= 0) edgeOf[et.he1[e]] = e;
  }
  for (let h = 0; h < indices.length; h++) {
    if (edgeOf[h] < 0) {
      edgeOf[h] = et.find(indices[h], halfEdgeTo(indices, h));
    }
  }
  const orient = new Uint8Array(nf);
  const visited = new Uint8Array(nf);
  const queue = new Int32Array(nf);
  let qt = 0;
  for (let seed = 0; seed < nf; seed++) {
    if (visited[seed]) continue;
    const start = qt;
    let qh = qt;
    queue[qt++] = seed;
    visited[seed] = 1;
    while (qh < qt) {
      const f = queue[qh++];
      for (let k = 0; k < 3; k++) {
        const h = f * 3 + k;
        const e = edgeOf[h];
        if (e < 0 || et.count[e] !== 2) continue;
        const other = et.he0[e] === h ? et.he1[e] : et.he0[e];
        const g = (other / 3) | 0;
        if (g === f || visited[g]) continue;
        const sameOrig = indices[other] === indices[h] ? 1 : 0;
        orient[g] = orient[f] ^ sameOrig;
        visited[g] = 1;
        queue[qt++] = g;
      }
    }
    let v = 0;
    for (let q = start; q < qt; q++) {
      const f = queue[q];
      const ia = indices[f * 3] * 3;
      const ib = indices[f * 3 + 1] * 3;
      const ic = indices[f * 3 + 2] * 3;
      const c =
        p[ia] * (p[ib + 1] * p[ic + 2] - p[ib + 2] * p[ic + 1]) -
        p[ia + 1] * (p[ib] * p[ic + 2] - p[ib + 2] * p[ic]) +
        p[ia + 2] * (p[ib] * p[ic + 1] - p[ib + 1] * p[ic]);
      v += orient[f] ? -c : c;
    }
    if (v < 0) for (let q = start; q < qt; q++) orient[queue[q]] ^= 1;
  }
  let inconsistent = 0;
  for (let e = 0; e < et.nEdges; e++) {
    if (et.count[e] !== 2) continue;
    const h0 = et.he0[e];
    const h1 = et.he1[e];
    const sameOrig = indices[h0] === indices[h1] ? 1 : 0;
    if ((sameOrig ^ orient[(h0 / 3) | 0] ^ orient[(h1 / 3) | 0]) === 1) inconsistent++;
  }
  let flips = 0;
  for (let f = 0; f < nf; f++) {
    if (!orient[f]) continue;
    const t = indices[f * 3 + 1];
    indices[f * 3 + 1] = indices[f * 3 + 2];
    indices[f * 3 + 2] = t;
    flips++;
  }
  return { flips, inconsistent };
}

export function fixWinding(mesh: MeshData): number {
  return windingPass(mesh, buildEdgeTable(mesh)).flips;
}

export function repairWinding(mesh: MeshData): { flipped: number; report: TopologyReport } {
  const et = buildEdgeTable(mesh);
  const { flips, inconsistent } = windingPass(mesh, et);
  let boundary = 0;
  let nonManifold = 0;
  for (let e = 0; e < et.nEdges; e++) {
    const c = et.count[e];
    if (c === 1) boundary++;
    else if (c > 2) nonManifold++;
  }
  const comps = triangleComponents(mesh);
  return {
    flipped: flips,
    report: {
      vertices: mesh.positions.length / 3,
      triangles: mesh.indices.length / 3,
      edges: et.nEdges,
      boundaryEdges: boundary,
      nonManifoldEdges: nonManifold,
      inconsistentEdges: inconsistent,
      components: comps.count,
      watertight: boundary === 0 && nonManifold === 0 && inconsistent === 0,
    },
  };
}
