import { computeVertexNormals } from '../mesh/normals';
import { decodeRegion } from './regions';

// How the mannequin is shown: a fitting dummy rather than a person. The face is smoothed and covered by a
// visor and small anatomy is shaded away. Display only: fit analysis, rulers and exports use the true surface.

export interface DummyShape {
  positions: Float32Array;
  normals: Float32Array;
  /** 0..1 per vertex: how much of the visor covers it. */
  visor: Float32Array;
}

/** Vertex neighbours of a triangle mesh, compressed rows. */
export function adjacency(indices: ArrayLike<number>, n: number): { start: Uint32Array; list: Uint32Array } {
  const sets: Set<number>[] = Array.from({ length: n }, () => new Set());
  for (let t = 0; t < indices.length; t += 3) {
    const a = indices[t];
    const b = indices[t + 1];
    const c = indices[t + 2];
    sets[a].add(b).add(c);
    sets[b].add(a).add(c);
    sets[c].add(a).add(b);
  }
  const start = new Uint32Array(n + 1);
  for (let i = 0; i < n; i++) start[i + 1] = start[i] + sets[i].size;
  const list = new Uint32Array(start[n]);
  sets.forEach((set, i) => list.set([...set], start[i]));
  return { start, list };
}

/**
 * Shading normals averaged over nearby vertices: the shape and outline stay exact, small anatomy stops
 * catching the light, so the mannequin reads as a dummy rather than a person. The face, chest and groin are
 * smoothed hardest (`extra` lists those vertices), which leaves a smooth, featureless head.
 */
function softenNormals(
  normals: Float32Array,
  adj: { start: Uint32Array; list: Uint32Array },
  extra: Uint32Array,
): Float32Array {
  const n = adj.start.length - 1;
  let src = Float32Array.from(normals);
  let dst = new Float32Array(normals.length);
  const smooth = (i: number) => {
    let x = src[i * 3];
    let y = src[i * 3 + 1];
    let z = src[i * 3 + 2];
    for (let k = adj.start[i]; k < adj.start[i + 1]; k++) {
      const j = adj.list[k] * 3;
      x += src[j];
      y += src[j + 1];
      z += src[j + 2];
    }
    const l = Math.hypot(x, y, z) || 1;
    dst[i * 3] = x / l;
    dst[i * 3 + 1] = y / l;
    dst[i * 3 + 2] = z / l;
  };
  for (let r = 0; r < 40; r++) {
    if (r < 6) for (let i = 0; i < n; i++) smooth(i);
    else {
      dst.set(src);
      for (const i of extra) smooth(i);
    }
    [src, dst] = [dst, src];
  }
  return src;
}

/**
 * Smooths the face (below the brow, front half of the head) into a plain mannequin face for display, and
 * marks it in `visor` (0..1) for the dark visor the suit wears over it. Fit analysis and rulers use the true
 * surface; the helmet's crown band above the brow is untouched.
 */
function plainFace(
  pos: Float32Array,
  head: Uint32Array,
  adj: { start: Uint32Array; list: Uint32Array },
  visor: Float32Array,
) {
  let y0 = Infinity;
  let y1 = -Infinity;
  let z0 = Infinity;
  let z1 = -Infinity;
  for (const i of head) {
    y0 = Math.min(y0, pos[i * 3 + 1]);
    y1 = Math.max(y1, pos[i * 3 + 1]);
    z0 = Math.min(z0, pos[i * 3 + 2]);
    z1 = Math.max(z1, pos[i * 3 + 2]);
  }
  const zc = (z0 + z1) / 2;
  const brow = y0 + 0.66 * (y1 - y0);
  const ramp = (v: number) => Math.min(1, Math.max(0, v));
  const face: number[] = [];
  const weight: number[] = [];
  for (const i of head) {
    const w = ramp((brow - pos[i * 3 + 1]) / 20) * ramp((pos[i * 3 + 2] - zc) / 15);
    if (w > 0) {
      face.push(i);
      weight.push(w);
    }
  }
  // Fill hollows (eye sockets, the mouth) forwards to their rims, then relax the filled vertices into a
  // membrane across each opening so no triangle is left folded over; then even out the whole face.
  visor.fill(0);
  face.forEach((i, k) => (visor[i] = weight[k]));
  const before = face.map((i) => pos[i * 3 + 2]);
  for (let it = 0; it < 80; it++) {
    face.forEach((i, k) => {
      let z = 0;
      for (let q = adj.start[i]; q < adj.start[i + 1]; q++) z += pos[adj.list[q] * 3 + 2];
      z /= adj.start[i + 1] - adj.start[i];
      if (z > pos[i * 3 + 2]) pos[i * 3 + 2] += weight[k] * (z - pos[i * 3 + 2]);
    });
  }
  const hollow = face.filter((i, k) => pos[i * 3 + 2] - before[k] > 1.5);
  const avg = new Float32Array(3);
  for (let it = 0; it < 120; it++) {
    for (const i of hollow) {
      avg.fill(0);
      const deg = adj.start[i + 1] - adj.start[i];
      for (let q = adj.start[i]; q < adj.start[i + 1]; q++) {
        const j = adj.list[q] * 3;
        avg[0] += pos[j] / deg;
        avg[1] += pos[j + 1] / deg;
        avg[2] += pos[j + 2] / deg;
      }
      pos.set(avg, i * 3);
    }
  }
  const next = new Float32Array(face.length * 3);
  for (let it = 0; it < 24; it++) {
    const f = it % 2 ? -0.53 : 0.5;
    face.forEach((i, k) => {
      let x = 0;
      let y = 0;
      let z = 0;
      const deg = adj.start[i + 1] - adj.start[i];
      for (let q = adj.start[i]; q < adj.start[i + 1]; q++) {
        const j = adj.list[q] * 3;
        x += pos[j];
        y += pos[j + 1];
        z += pos[j + 2];
      }
      const s = f * weight[k];
      next[k * 3] = pos[i * 3] + s * (x / deg - pos[i * 3]);
      next[k * 3 + 1] = pos[i * 3 + 1] + s * (y / deg - pos[i * 3 + 1]);
      next[k * 3 + 2] = pos[i * 3 + 2] + s * (z / deg - pos[i * 3 + 2]);
    });
    face.forEach((i, k) => pos.set(next.subarray(k * 3, k * 3 + 3), i * 3));
  }
}

/** Shades the visor as one smooth shell: normals of the ellipsoid that bounds the head. */
function visorNormals(pos: Float32Array, nrm: Float32Array, head: Uint32Array, visor: Float32Array): void {
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (const i of head) {
    for (let a = 0; a < 3; a++) {
      lo[a] = Math.min(lo[a], pos[i * 3 + a]);
      hi[a] = Math.max(hi[a], pos[i * 3 + a]);
    }
  }
  const c = lo.map((v, a) => (v + hi[a]) / 2);
  const r2 = lo.map((v, a) => ((hi[a] - v) / 2) ** 2 || 1);
  for (const i of head) {
    const w = visor[i];
    if (!w) continue;
    const e = [0, 1, 2].map((a) => (pos[i * 3 + a] - c[a]) / r2[a]);
    const le = Math.hypot(e[0], e[1], e[2]) || 1;
    const m = [0, 1, 2].map((a) => nrm[i * 3 + a] * (1 - w) + (e[a] / le) * w);
    const lm = Math.hypot(m[0], m[1], m[2]) || 1;
    for (let a = 0; a < 3; a++) nrm[i * 3 + a] = m[a] / lm;
  }
}

export class DummyLook {
  private readonly adj: { start: Uint32Array; list: Uint32Array };
  private readonly detail: Uint32Array;
  private readonly head: Uint32Array;
  private readonly indices: Uint32Array;

  constructor(indices: ArrayLike<number>, regions: Uint8Array) {
    const n = regions.length;
    this.indices = Uint32Array.from(indices);
    this.adj = adjacency(indices, n);
    const detail: number[] = [];
    for (let i = 0; i < n; i++) {
      if (['head', 'chest', 'hip'].includes(decodeRegion(regions[i]).region)) detail.push(i);
    }
    this.detail = Uint32Array.from(detail);
    this.head = Uint32Array.from(detail.filter((i) => decodeRegion(regions[i]).region === 'head'));
  }

  shape(positions: Float32Array): DummyShape {
    const pos = Float32Array.from(positions);
    const visor = new Float32Array(pos.length / 3);
    plainFace(pos, this.head, this.adj, visor);
    const normals = softenNormals(
      computeVertexNormals({ positions: pos, indices: this.indices }),
      this.adj,
      this.detail,
    );
    visorNormals(pos, normals, this.head, visor);
    return { positions: pos, normals, visor };
  }
}
