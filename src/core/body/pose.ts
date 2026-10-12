import { v3, type Vec3 } from '../math/linalg';
import type { BodyAsset } from './asset';

export function jointPositions(asset: BodyAsset, pos: ArrayLike<number>): Record<string, Vec3> {
  const out: Record<string, Vec3> = {};
  for (const [name, list] of Object.entries(asset.header.joints)) {
    const c: Vec3 = [0, 0, 0];
    for (const v of list) {
      c[0] += pos[v * 3];
      c[1] += pos[v * 3 + 1];
      c[2] += pos[v * 3 + 2];
    }
    out[name] = v3.scale(c, 1 / list.length);
  }
  return out;
}

export function applyFinish(asset: BodyAsset, pos: Float32Array): void {
  const f = asset.header.finish;
  if (!f) return;
  const n = f.vertices.length;
  const tmp = new Float32Array(n * 3);
  for (let it = 0; it < f.iterations; it++) {
    for (let k = 0; k < n; k++) {
      const nb = f.neighbors[k];
      let x = 0;
      let y = 0;
      let z = 0;
      for (const j of nb) {
        x += pos[j * 3];
        y += pos[j * 3 + 1];
        z += pos[j * 3 + 2];
      }
      const v = f.vertices[k];
      const w = f.weights[k] * 0.6;
      tmp[k * 3] = pos[v * 3] + w * (x / nb.length - pos[v * 3]);
      tmp[k * 3 + 1] = pos[v * 3 + 1] + w * (y / nb.length - pos[v * 3 + 1]);
      tmp[k * 3 + 2] = pos[v * 3 + 2] + w * (z / nb.length - pos[v * 3 + 2]);
    }
    for (let k = 0; k < n; k++) {
      const v = f.vertices[k];
      pos[v * 3] = tmp[k * 3];
      pos[v * 3 + 1] = tmp[k * 3 + 1];
      pos[v * 3 + 2] = tmp[k * 3 + 2];
    }
  }
}

function rotate(p: Vec3, k: Vec3, a: number): Vec3 {
  const c = Math.cos(a);
  const s = Math.sin(a);
  const kxp = v3.cross(k, p);
  const kdp = v3.dot(k, p);
  return [
    p[0] * c + kxp[0] * s + k[0] * kdp * (1 - c),
    p[1] * c + kxp[1] * s + k[1] * kdp * (1 - c),
    p[2] * c + kxp[2] * s + k[2] * kdp * (1 - c),
  ];
}

export interface PoseOptions {
  elbowFlexion?: number;
}

export function poseMannequin(
  asset: BodyAsset,
  rest: Float32Array,
  joints: Record<string, Vec3>,
  opts: PoseOptions = {},
): { positions: Float32Array; joints: Record<string, Vec3> } {
  const out = Float32Array.from(rest);
  const posedJoints = { ...joints };
  const keep = ((opts.elbowFlexion ?? 6) * Math.PI) / 180;
  for (const side of ['L', 'R'] as const) {
    const sh = joints[`shoulder${side}`];
    const el = joints[`elbow${side}`];
    const wr = joints[`wrist${side}`];
    const upper = v3.norm(v3.sub(el, sh));
    const fore = v3.norm(v3.sub(wr, el));
    const bendAxis = v3.norm(v3.cross(upper, fore));
    const bend = Math.acos(Math.min(1, Math.max(-1, v3.dot(upper, fore))));
    if (v3.len(bendAxis) === 0 || bend <= keep) continue;
    const angle = -(bend - keep);
    const w = asset.poseWeights[`forearm${side}`];
    const n = w.length;
    for (let i = 0; i < n; i++) {
      const wi = w[i];
      if (wi === 0) continue;
      const p: Vec3 = [rest[i * 3] - el[0], rest[i * 3 + 1] - el[1], rest[i * 3 + 2] - el[2]];
      const r = rotate(p, bendAxis, angle);
      out[i * 3] = rest[i * 3] + wi * (r[0] - p[0]);
      out[i * 3 + 1] = rest[i * 3 + 1] + wi * (r[1] - p[1]);
      out[i * 3 + 2] = rest[i * 3 + 2] + wi * (r[2] - p[2]);
    }
    for (const j of [`wrist${side}`]) {
      posedJoints[j] = v3.add(el, rotate(v3.sub(joints[j], el), bendAxis, angle));
    }
  }
  return { positions: out, joints: posedJoints };
}
