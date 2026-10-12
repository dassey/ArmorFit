import type { Bone, BoneId } from '../body/skeleton';
import { nearestBone, pointOnBone, projectToBone } from '../body/skeleton';
import { v3, type Vec3 } from '../math/linalg';
import type { PieceCategory, PieceTypeId, Side } from '../pieces/types';
import type { BodyQuery } from './bodyQuery';
import type { PlacementSpec } from './placement';

export interface HomeContext {
  query: BodyQuery;
  bones: Record<BoneId, Bone>;
  landmarks: Record<string, Vec3>;
}

export interface HomeAnchor {
  placement: PlacementSpec;
  point: Vec3;
}

type Target = { point: Vec3; from: Vec3 } | { bone: BoneId; t: number };

function shellTarget(type: PieceTypeId, side: Side, ctx: HomeContext): Target | null {
  const L = ctx.landmarks;
  const b = ctx.bones;
  const sx = side === 'L' ? 1 : -1;
  const s = side;
  const torsoTop = L.suprasternale;
  const navel = L.omphalion;
  const chestY = torsoTop[1] - 0.38 * (torsoTop[1] - navel[1]);
  const out = (p: Vec3, dir: Vec3, dist = 400): { point: Vec3; from: Vec3 } => ({
    point: p,
    from: v3.add(p, v3.scale(v3.norm(dir), dist)),
  });
  const lateral = (bone: Bone, t: number, dir: Vec3) => out(pointOnBone(bone, t), dir);
  switch (type) {
    case 'chest':
      return out([0, chestY, 0], [0, 0, 1], 800);
    case 'back':
      return out([0, chestY + 20, 0], [0, 0, -1], 800);
    case 'abdomen':
      return out([0, navel[1] + 70, 0], [0, 0, 1], 800);
    case 'belt':
      return out([0, navel[1] - 30, 0], [0, 0, 1], 800);
    case 'pauldron':
      return out(L[`acromion${s}`], [sx * 0.55, 1, 0]);
    case 'gorget':
      return out(pointOnBone(b.neck, 0.15), [0, 0.3, 1]);
    case 'helmet':
      return out(pointOnBone(b.head, 0.55), [0, 0.2, 1]);
    case 'bicep':
      return lateral(b[`upperArm${s}`], 0.5, [sx, 0.3, 0]);
    case 'elbow':
      return lateral(b[`upperArm${s}`], 0.02, [sx * 0.4, 0, -1]);
    case 'forearm':
      return lateral(b[`forearm${s}`], 0.5, [sx * 0.5, 0.5, 0.5]);
    case 'hand':
      return lateral(b[`hand${s}`], 0.5, [sx, 0, 0]);
    case 'tasset':
      return lateral(b[`thigh${s}`], 0.88, [sx * 0.8, 0, 0.6]);
    case 'thigh':
      return lateral(b[`thigh${s}`], 0.55, [sx * 0.3, 0, 1]);
    case 'knee':
      return lateral(b[`thigh${s}`], 0.02, [0, 0, 1]);
    case 'shin':
      return lateral(b[`shin${s}`], 0.55, [0, 0, 1]);
    case 'calf':
      return lateral(b[`shin${s}`], 0.6, [0, 0, -1]);
    case 'boot':
      return lateral(b[`foot${s}`], 0.6, [0, 1, 0.3]);
  }
  return null;
}

function boneTarget(type: PieceTypeId, side: Side, ctx: HomeContext): Target | null {
  const s = side;
  const navel = ctx.landmarks.omphalion;
  switch (type) {
    case 'helmet':
      return { bone: 'head', t: 0.4 };
    case 'gorget':
      return { bone: 'neck', t: 0.2 };
    case 'belt': {
      const sp = ctx.bones.spine;
      return { bone: 'spine', t: projectToBone(sp, [0, navel[1] - 30, 0]).t };
    }
    case 'chest':
    case 'back':
    case 'abdomen':
      return { bone: 'spine', t: 0.62 };
    case 'pauldron':
    case 'bicep':
      return { bone: `upperArm${s}`, t: 0.5 };
    case 'elbow':
      return { bone: `upperArm${s}`, t: 0.05 };
    case 'forearm':
      return { bone: `forearm${s}`, t: 0.5 };
    case 'hand':
      return { bone: `hand${s}`, t: 0.5 };
    case 'tasset':
    case 'thigh':
      return { bone: `thigh${s}`, t: 0.5 };
    case 'knee':
      return { bone: `thigh${s}`, t: 0.03 };
    case 'shin':
    case 'calf':
      return { bone: `shin${s}`, t: 0.5 };
    case 'boot':
      return { bone: `foot${s}`, t: 0.45 };
  }
  return null;
}

export function homeAnchor(
  type: PieceTypeId,
  side: Side | null,
  category: PieceCategory,
  ctx: HomeContext,
): HomeAnchor | null {
  const s = side ?? 'L';
  if (category === 'shell') {
    const t = shellTarget(type, s, ctx);
    if (!t || !('point' in t)) return null;
    const dir = v3.norm(v3.sub(t.point, t.from));
    const hit = ctx.query.raycast(t.from, dir);
    if (!hit) return null;
    return {
      placement: { kind: 'surface', face: hit.face, bary: hit.bary, twist: 0, offset: 0 },
      point: hit.point,
    };
  }
  const t = boneTarget(type, s, ctx);
  if (!t || !('bone' in t)) return null;
  return {
    placement: { kind: 'bone', bone: t.bone, t: t.t, twist: 0, offset: 0 },
    point: pointOnBone(ctx.bones[t.bone], t.t),
  };
}

export function boneAnchorAt(point: Vec3, ctx: HomeContext, only?: BoneId[]): HomeAnchor {
  const nb = nearestBone(ctx.bones, point, only);
  return {
    placement: { kind: 'bone', bone: nb.bone.id, t: nb.t, twist: 0, offset: 0 },
    point: pointOnBone(nb.bone, nb.t),
  };
}
