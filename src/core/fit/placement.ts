import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Vec3 } from '../math/linalg';
import { v3 } from '../math/linalg';
import type { Bone, BoneId } from '../body/skeleton';
import { pointOnBone } from '../body/skeleton';

export type SurfacePlacement = {
  kind: 'surface';
  face: number;
  bary: [number, number, number];
  twist: number;
  offset: number;
  shift?: Vec3;
};
export type BonePlacement = {
  kind: 'bone';
  bone: string;
  t: number;
  twist: number;
  offset: number;
  local?: number[];
  shift?: Vec3;
};

export function boneFrameMatrix(b: Bone, t: number, twist = 0): Matrix4 {
  const m = new Matrix4().makeBasis(new Vector3(...b.x), new Vector3(...b.y), new Vector3(...b.z));
  m.setPosition(new Vector3(...pointOnBone(b, t)));
  return m.multiply(new Matrix4().makeRotationY(twist));
}
export type PlacementSpec = SurfacePlacement | BonePlacement;

export interface BodyGeometry {
  positions: ArrayLike<number>;
  normals: ArrayLike<number>;
  indices: ArrayLike<number>;
  bones: Record<BoneId, Bone>;
}

export interface PieceFrameInfo {
  contactNormal: Vec3;
  autoOffset?: number;
  mirrored?: boolean;
}

export function surfacePoint(
  body: BodyGeometry,
  face: number,
  bary: [number, number, number],
): { point: Vec3; normal: Vec3 } {
  const p: Vec3 = [0, 0, 0];
  const n: Vec3 = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const v = body.indices[face * 3 + k];
    for (let c = 0; c < 3; c++) {
      p[c] += bary[k] * body.positions[v * 3 + c];
      n[c] += bary[k] * body.normals[v * 3 + c];
    }
  }
  return { point: p, normal: v3.norm(n) };
}

export function barycentric(body: BodyGeometry, face: number, p: Vec3): [number, number, number] {
  const P = (k: number): Vec3 => {
    const v = body.indices[face * 3 + k];
    return [body.positions[v * 3], body.positions[v * 3 + 1], body.positions[v * 3 + 2]];
  };
  const a = P(0);
  const v0 = v3.sub(P(1), a);
  const v1 = v3.sub(P(2), a);
  const v2 = v3.sub(p, a);
  const d00 = v3.dot(v0, v0);
  const d01 = v3.dot(v0, v1);
  const d11 = v3.dot(v1, v1);
  const d20 = v3.dot(v2, v0);
  const d21 = v3.dot(v2, v1);
  const den = d00 * d11 - d01 * d01 || 1;
  const v = (d11 * d20 - d01 * d21) / den;
  const w = (d00 * d21 - d01 * d20) / den;
  return [1 - v - w, v, w];
}

const _q = new Quaternion();
const _q2 = new Quaternion();
const _q3 = new Quaternion();

export function uprightRotation(from: Vec3, to: Vec3, out: Quaternion): Quaternion {
  const fh = Math.hypot(from[0], from[2]);
  const th = Math.hypot(to[0], to[2]);
  if (fh < 0.3 || th < 0.3) return out.setFromUnitVectors(new Vector3(...from), new Vector3(...to));
  const yaw = Math.atan2(to[0], to[2]) - Math.atan2(from[0], from[2]);
  _q3.setFromAxisAngle(new Vector3(0, 1, 0), yaw);
  const turned = new Vector3(...from).applyQuaternion(_q3);
  out.setFromUnitVectors(turned, new Vector3(...to));
  return out.multiply(_q3);
}

export function placementMatrix(spec: PlacementSpec, body: BodyGeometry, piece: PieceFrameInfo): Matrix4 {
  const offset = spec.offset + (piece.autoOffset ?? 0);
  if (spec.kind === 'surface') {
    const { point, normal } = surfacePoint(body, spec.face, spec.bary);
    const cn = piece.mirrored
      ? [-piece.contactNormal[0], piece.contactNormal[1], piece.contactNormal[2]]
      : piece.contactNormal;
    uprightRotation(v3.norm(cn as Vec3), normal, _q);
    _q2.setFromAxisAngle(new Vector3(...normal), spec.twist);
    _q.premultiply(_q2);
    const pos = v3.add(point, v3.scale(normal, offset));
    return withShift(new Matrix4().compose(new Vector3(...pos), _q, new Vector3(1, 1, 1)), spec.shift);
  }
  const b = body.bones[spec.bone as BoneId];
  if (!b) throw new Error(`Unknown bone ${spec.bone}`);
  if (spec.local) {
    const cn = v3.norm(
      piece.mirrored
        ? [-piece.contactNormal[0], piece.contactNormal[1], piece.contactNormal[2]]
        : piece.contactNormal,
    );
    const m = boneFrameMatrix(b, spec.t, spec.twist).multiply(new Matrix4().fromArray(spec.local));
    m.multiply(new Matrix4().makeTranslation(cn[0] * offset, cn[1] * offset, cn[2] * offset));
    return withShift(m, spec.shift);
  }
  const origin = v3.add(pointOnBone(b, spec.t), v3.scale(b.y, offset));
  const m = new Matrix4().makeBasis(new Vector3(...b.x), new Vector3(...b.y), new Vector3(...b.z));
  m.multiply(new Matrix4().makeRotationY(spec.twist));
  m.setPosition(new Vector3(...origin));
  return withShift(m, spec.shift);
}

function withShift(m: Matrix4, shift?: Vec3): Matrix4 {
  if (shift && (shift[0] || shift[1] || shift[2]))
    m.multiply(new Matrix4().makeTranslation(shift[0], shift[1], shift[2]));
  return m;
}

export function scaleMirrorMatrix(scale: [number, number, number], mirrored: boolean): Matrix4 {
  return new Matrix4().makeScale(mirrored ? -scale[0] : scale[0], scale[1], scale[2]);
}
