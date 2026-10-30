import { v3, type Vec3 } from '../math/linalg';
import { computeVertexNormals } from '../mesh/normals';
import { decodeRegion, type RegionId, type RegionSide } from './regions';

// How the mannequin is shown: a dummy rather than a person. The face is smoothed (and can wear a visor), small
// anatomy is shaded away, and the shader can paint joint seams and crash-test target markers. Display only:
// fit analysis, rulers and exports use the true surface.

export interface DummyShape {
  positions: Float32Array;
  normals: Float32Array;
  /** 0..1 per vertex: how much of the visor covers it. */
  visor: Float32Array;
  /** Per vertex: position on the nearest target marker in marker radii (u, v), and 1 if one is near. */
  marker: Float32Array;
}

/** A joint seam: where the plane through `at` with `normal` cuts these regions, within `reach` of `at`. */
export interface DummySeam {
  at: Vec3;
  normal: Vec3;
  reach: number;
  regions: RegionId[];
  side: RegionSide;
}

interface Marker {
  at: Vec3;
  dir: Vec3;
  radius: number;
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

/** Where a dummy's parts would join: neck, waist, shoulders, elbows, wrists, thighs, knees, ankles. */
export function dummySeams(j: Record<string, Vec3>): DummySeam[] {
  const dir = (a: Vec3, b: Vec3) => v3.norm(v3.sub(b, a));
  const out: DummySeam[] = [
    {
      at: j.neckBase,
      normal: dir(j.neckBase, j.headBase),
      reach: 130,
      regions: ['neck', 'upperChest', 'upperBack', 'upperShoulder'],
      side: 0,
    },
    { at: j.spine03, normal: [0, 1, 0], reach: 400, regions: ['abdomen', 'waist', 'lowerBack'], side: 0 },
  ];
  for (const s of ['L', 'R'] as const) {
    const side: RegionSide = s === 'L' ? 1 : 2;
    const [sh, el, wr] = [j[`shoulder${s}`], j[`elbow${s}`], j[`wrist${s}`]];
    const [hp, kn, an] = [j[`hip${s}`], j[`knee${s}`], j[`ankle${s}`]];
    out.push(
      { at: sh, normal: dir(sh, el), reach: 130, regions: ['deltoid', 'upperArm', 'upperShoulder'], side },
      { at: el, normal: dir(el, wr), reach: 90, regions: ['elbow', 'upperArm', 'forearm'], side },
      { at: wr, normal: dir(el, wr), reach: 70, regions: ['wrist', 'forearm', 'hand'], side },
      { at: v3.lerp(hp, kn, 0.2), normal: dir(hp, kn), reach: 160, regions: ['hip', 'thigh'], side },
      { at: kn, normal: dir(kn, an), reach: 110, regions: ['knee', 'thigh', 'shin', 'calf'], side },
      { at: an, normal: dir(kn, an), reach: 90, regions: ['shin', 'calf', 'foot'], side },
    );
  }
  return out;
}

export class DummyLook {
  private readonly adj: { start: Uint32Array; list: Uint32Array };
  private readonly detail: Uint32Array;
  private readonly head: Uint32Array;
  private readonly indices: Uint32Array;
  private readonly region: RegionId[];
  private readonly side: RegionSide[];

  constructor(indices: ArrayLike<number>, regions: Uint8Array) {
    const n = regions.length;
    this.indices = Uint32Array.from(indices);
    this.adj = adjacency(indices, n);
    this.region = Array.from(regions, (c) => decodeRegion(c).region);
    this.side = Array.from(regions, (c) => decodeRegion(c).side);
    const detail: number[] = [];
    for (let i = 0; i < n; i++) if (['head', 'chest', 'hip'].includes(this.region[i])) detail.push(i);
    this.detail = Uint32Array.from(detail);
    this.head = Uint32Array.from(detail.filter((i) => this.region[i] === 'head'));
  }

  shape(positions: Float32Array, joints: Record<string, Vec3>, landmarks: Record<string, Vec3>): DummyShape {
    const pos = Float32Array.from(positions);
    const visor = new Float32Array(pos.length / 3);
    plainFace(pos, this.head, this.adj, visor);
    const normals = softenNormals(
      computeVertexNormals({ positions: pos, indices: this.indices }),
      this.adj,
      this.detail,
    );
    visorNormals(pos, normals, this.head, visor);
    return {
      positions: pos,
      normals,
      visor,
      marker: this.markerField(pos, normals, this.markers(pos, joints, landmarks)),
    };
  }

  /** Crash-test target markers: sides of the head, shoulders, hips and the front of the knees. */
  private markers(pos: Float32Array, j: Record<string, Vec3>, lm: Record<string, Vec3>): Marker[] {
    const out: Marker[] = [];
    // The surface point straight out from a joint, among the vertices of the given regions and side.
    const outward = (origin: Vec3, dir: Vec3, regions: RegionId[], side: RegionSide): Vec3 => {
      let best = -Infinity;
      let at = origin;
      for (let i = 0; i < pos.length / 3; i++) {
        if (this.side[i] !== side || !regions.includes(this.region[i])) continue;
        const p: Vec3 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
        const d = v3.sub(p, origin);
        const l = v3.len(d);
        if (l > 250 || l === 0) continue;
        const score = v3.dot(d, dir) / l;
        if (score > best) {
          best = score;
          at = p;
        }
      }
      return at;
    };
    for (const s of ['L', 'R'] as const) {
      const side: RegionSide = s === 'L' ? 1 : 2;
      const x: Vec3 = [s === 'L' ? 1 : -1, 0, 0];
      out.push(
        { at: outward(v3.lerp(j[`eye${s}`], j.headTop, 0.5), x, ['head'], side), dir: x, radius: 26 },
        { at: outward(j[`shoulder${s}`], x, ['deltoid', 'upperArm'], side), dir: x, radius: 26 },
        { at: lm[`trochanterion${s}`], dir: x, radius: 32 },
        { at: outward(j[`knee${s}`], [0, 0, 1], ['knee'], side), dir: [0, 0, 1], radius: 28 },
      );
    }
    return out.filter((m) => m.at);
  }

  private markerField(pos: Float32Array, normals: Float32Array, markers: Marker[]): Float32Array {
    const out = new Float32Array(pos.length);
    const frames = markers.map((m) => {
      const up: Vec3 = Math.abs(m.dir[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      const t1 = v3.norm(v3.cross(up, m.dir));
      return { m, t1, t2: v3.cross(m.dir, t1) };
    });
    for (let i = 0; i < pos.length / 3; i++) {
      const p: Vec3 = [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
      const n: Vec3 = [normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]];
      let best = Infinity;
      for (const { m, t1, t2 } of frames) {
        const d = v3.sub(p, m.at);
        const l = v3.len(d);
        if (l > m.radius * 1.6 || l >= best || v3.dot(n, m.dir) < 0.2) continue;
        best = l;
        out[i * 3] = v3.dot(d, t1) / m.radius;
        out[i * 3 + 1] = v3.dot(d, t2) / m.radius;
        out[i * 3 + 2] = 1;
      }
    }
    return out;
  }
}
