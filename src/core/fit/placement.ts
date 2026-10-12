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
};
export type BonePlacement = { kind: 'bone'; bone: string; t: number; twist: number; offset: number };
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

export function placementMatrix(spec: PlacementSpec, body: BodyGeometry, piece: PieceFrameInfo): Matrix4 {
  const offset = spec.offset + (piece.autoOffset ?? 0);
  if (spec.kind === 'surface') {
    const { point, normal } = surfacePoint(body, spec.face, spec.bary);
    const cn = piece.mirrored
      ? [-piece.contactNormal[0], piece.contactNormal[1], piece.contactNormal[2]]
      : piece.contactNormal;
    _q.setFromUnitVectors(new Vector3(...v3.norm(cn as Vec3)), new Vector3(...normal));
    _q2.setFromAxisAngle(new Vector3(...normal), spec.twist);
    _q.premultiply(_q2);
    const pos = v3.add(point, v3.scale(normal, offset));
    return new Matrix4().compose(new Vector3(...pos), _q, new Vector3(1, 1, 1));
  }
  const b = body.bones[spec.bone as BoneId];
  if (!b) throw new Error(`Unknown bone ${spec.bone}`);
  const origin = v3.add(pointOnBone(b, spec.t), v3.scale(b.y, offset));
  const m = new Matrix4().makeBasis(new Vector3(...b.x), new Vector3(...b.y), new Vector3(...b.z));
  m.multiply(new Matrix4().makeRotationY(spec.twist));
  m.setPosition(new Vector3(...origin));
  return m;
}

export function scaleMirrorMatrix(scale: [number, number, number], mirrored: boolean): Matrix4 {
  return new Matrix4().makeScale(mirrored ? -scale[0] : scale[0], scale[1], scale[2]);
}
