import { v3, type Vec3 } from '../math/linalg';

export type BoneId =
  | 'head'
  | 'neck'
  | 'spine'
  | 'upperArmL'
  | 'upperArmR'
  | 'forearmL'
  | 'forearmR'
  | 'handL'
  | 'handR'
  | 'thighL'
  | 'thighR'
  | 'shinL'
  | 'shinR'
  | 'footL'
  | 'footR';

export interface Bone {
  id: BoneId;
  from: Vec3;
  to: Vec3;
  length: number;
  x: Vec3;
  y: Vec3;
  z: Vec3;
}

const FRONT: Vec3 = [0, 0, 1];

function frame(up: Vec3, frontHint: Vec3 = FRONT): { x: Vec3; y: Vec3; z: Vec3 } {
  const y = v3.norm(up);
  let z = v3.sub(frontHint, v3.scale(y, v3.dot(frontHint, y)));
  if (v3.len(z) < 1e-6) z = v3.sub([0, -1, 0], v3.scale(y, v3.dot([0, -1, 0], y)));
  z = v3.norm(z);
  return { x: v3.cross(y, z), y, z };
}

function bone(id: BoneId, from: Vec3, to: Vec3, up?: Vec3, front?: Vec3): Bone {
  const f = frame(up ?? v3.sub(to, from), front);
  return { id, from, to, length: v3.dist(from, to), ...f };
}

export function buildSkeleton(
  joints: Record<string, Vec3>,
  landmarks: Record<string, Vec3>,
): Record<BoneId, Bone> {
  const j = joints;
  const out: Partial<Record<BoneId, Bone>> = {
    head: bone('head', j.headBase, j.headTop),
    neck: bone('neck', j.neckBase, j.headBase),
    spine: bone('spine', j.pelvis, j.neckBase),
  };
  for (const s of ['L', 'R'] as const) {
    out[`upperArm${s}`] = bone(`upperArm${s}`, j[`elbow${s}`], j[`shoulder${s}`]);
    out[`forearm${s}`] = bone(`forearm${s}`, j[`wrist${s}`], j[`elbow${s}`]);
    out[`hand${s}`] = bone(`hand${s}`, landmarks[`fingertip${s}`], j[`wrist${s}`]);
    out[`thigh${s}`] = bone(`thigh${s}`, j[`knee${s}`], j[`hip${s}`]);
    out[`shin${s}`] = bone(`shin${s}`, j[`ankle${s}`], j[`knee${s}`]);
    const heel = landmarks[`heel${s}`];
    const toe = landmarks[`toe${s}`];
    out[`foot${s}`] = bone(`foot${s}`, heel, toe, v3.sub(j[`knee${s}`], j[`ankle${s}`]), v3.sub(toe, heel));
  }
  return out as Record<BoneId, Bone>;
}

export function pointOnBone(b: Bone, t: number): Vec3 {
  return v3.lerp(b.from, b.to, t);
}

export function projectToBone(b: Bone, p: Vec3): { t: number; distance: number } {
  const d = v3.sub(b.to, b.from);
  const t = Math.min(1, Math.max(0, v3.dot(v3.sub(p, b.from), d) / (v3.dot(d, d) || 1)));
  return { t, distance: v3.dist(p, pointOnBone(b, t)) };
}

export function nearestBone(
  bones: Record<BoneId, Bone>,
  p: Vec3,
  only?: BoneId[],
): { bone: Bone; t: number; distance: number } {
  let best: { bone: Bone; t: number; distance: number } | null = null;
  for (const b of Object.values(bones)) {
    if (only && !only.includes(b.id)) continue;
    const r = projectToBone(b, p);
    if (!best || r.distance < best.distance) best = { bone: b, ...r };
  }
  return best!;
}
