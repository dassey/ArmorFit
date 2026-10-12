import { Matrix4, Quaternion, Vector3 } from 'three';
import type { Bone, BoneId } from '../body/skeleton';
import { nearestBone, pointOnBone } from '../body/skeleton';
import { v3, type Vec3 } from '../math/linalg';
import { tubeAxis, type KitInfo, type KitMember } from '../pieces/kit';
import { pieceType, type PieceTypeId, type Side } from '../pieces/types';
import { homeAnchor, type HomeContext } from './homes';
import { boneFrameMatrix, surfacePoint, type BodyGeometry, type BonePlacement } from './placement';

const ARM = new Set<PieceTypeId>(['bicep', 'elbow', 'forearm', 'hand']);
const LEG = new Set<PieceTypeId>(['tasset', 'thigh', 'knee', 'shin', 'calf', 'boot']);

export function boneForType(type: PieceTypeId | null, side: Side | null): BoneId | null {
  const s = side ?? 'L';
  switch (type) {
    case 'helmet':
      return 'head';
    case 'gorget':
      return 'neck';
    case 'chest':
    case 'back':
    case 'abdomen':
    case 'belt':
      return 'spine';
    case 'pauldron':
    case 'bicep':
    case 'elbow':
      return `upperArm${s}`;
    case 'forearm':
      return `forearm${s}`;
    case 'hand':
      return `hand${s}`;
    case 'tasset':
    case 'thigh':
    case 'knee':
      return `thigh${s}`;
    case 'shin':
    case 'calf':
      return `shin${s}`;
    case 'boot':
      return `foot${s}`;
  }
  return null;
}

function boneT(b: Bone, p: Vec3): number {
  const d = v3.sub(b.to, b.from);
  return v3.dot(v3.sub(p, b.from), d) / (v3.dot(d, d) || 1);
}

function pointAtHeight(bones: Bone[], y: number): Vec3 {
  for (const b of bones) {
    const lo = Math.min(b.from[1], b.to[1]);
    const hi = Math.max(b.from[1], b.to[1]);
    if (y >= lo && y <= hi && hi - lo > 1) return pointOnBone(b, (y - b.from[1]) / (b.to[1] - b.from[1]));
  }
  let best = bones[0];
  let bestD = Infinity;
  let bestT = 0;
  for (const b of bones) {
    for (const t of [0, 1]) {
      const d = Math.abs(pointOnBone(b, t)[1] - y);
      if (d < bestD) {
        bestD = d;
        best = b;
        bestT = t;
      }
    }
  }
  const p = pointOnBone(best, bestT);
  return [p[0], y, p[2]];
}

function monotoneMap(pairs: [number, number][], slope: number): (x: number) => number {
  const sorted = [...pairs].sort((a, b) => a[0] - b[0]);
  const keep: [number, number][] = [];
  for (const p of sorted)
    if (!keep.length || (p[1] > keep[keep.length - 1][1] && p[0] > keep[keep.length - 1][0] + 1))
      keep.push(p);
  return (x: number) => {
    if (keep.length === 0) return x * slope;
    if (x <= keep[0][0]) return keep[0][1] + (x - keep[0][0]) * slope;
    const last = keep[keep.length - 1];
    if (x >= last[0]) return last[1] + (x - last[0]) * slope;
    for (let i = 1; i < keep.length; i++) {
      if (x <= keep[i][0]) {
        const [x0, y0] = keep[i - 1];
        const [x1, y1] = keep[i];
        return y0 + ((x - x0) / (x1 - x0)) * (y1 - y0);
      }
    }
    return x * slope;
  };
}

export interface KitBody extends HomeContext, BodyGeometry {}

function memberType(kit: KitInfo, m: KitMember): PieceTypeId | null {
  const g = m.group ? kit.groups.find((x) => x.id === m.group) : null;
  return g?.type ?? m.type;
}

function memberSide(kit: KitInfo, m: KitMember): Side | null {
  const g = m.group ? kit.groups.find((x) => x.id === m.group) : null;
  return g ? g.side : m.side;
}

function toPlacement(world: Matrix4, bone: Bone): BonePlacement {
  const pos = new Vector3().setFromMatrixPosition(world);
  const t = boneT(bone, [pos.x, pos.y, pos.z]);
  const B = boneFrameMatrix(bone, t, 0);
  const local = B.invert().multiply(world);
  local.elements[13] = 0;
  return { kind: 'bone', bone: bone.id, t, twist: 0, offset: 0, local: local.elements.slice() };
}

function partKitPlacements(kit: KitInfo, body: KitBody): Map<string, BonePlacement> {
  const out = new Map<string, BonePlacement>();
  const type = kit.type;
  if (!type) return out;
  const info = pieceType(type);
  const home = homeAnchor(type, null, info.category, body);
  if (!home) return out;
  let world: Matrix4;
  if (home.placement.kind === 'bone') {
    world = boneFrameMatrix(body.bones[home.placement.bone as BoneId], home.placement.t, 0);
  } else {
    const { point, normal } = surfacePoint(body, home.placement.face, home.placement.bary);
    const g = kit.groups[0];
    const depth = g ? Math.max(...kit.members.map((m) => v3.dot(v3.sub(m.center, g.center), [0, 0, 1]))) : 0;
    world = new Matrix4().makeTranslation(...v3.add(point, v3.scale(normal, -depth)));
  }
  const bone = body.bones[boneForType(type, null) ?? nearestBone(body.bones, home.point).bone.id];
  const spec =
    home.placement.kind === 'bone' && info.category !== 'shell'
      ? ({ ...home.placement, twist: 0, offset: 0 } as BonePlacement)
      : toPlacement(world, bone);
  for (const m of kit.members) out.set(m.id, spec);
  return out;
}

export function kitPlacements(kit: KitInfo, body: KitBody): Map<string, BonePlacement> {
  if (kit.kind === 'part') return partKitPlacements(kit, body);
  const out = new Map<string, BonePlacement>();
  const bones = body.bones;

  const pairs: [number, number][] = [];
  const byType = new Map<PieceTypeId, { k: number[]; m: number[] }>();
  for (const m of kit.members) {
    const t = m.type;
    if (!t || ARM.has(t)) continue;
    const home = homeAnchor(t, m.side, pieceType(t).category, body);
    if (!home) continue;
    if (!byType.has(t)) byType.set(t, { k: [], m: [] });
    byType.get(t)!.k.push(m.center[1]);
    byType.get(t)!.m.push(home.point[1]);
  }
  for (const v of byType.values()) {
    const avg = (a: number[]) => a.reduce((s, x) => s + x, 0) / a.length;
    pairs.push([avg(v.k), avg(v.m)]);
  }
  let slope = 1;
  if (pairs.length >= 2) {
    const mx = pairs.reduce((s, p) => s + p[0], 0) / pairs.length;
    const my = pairs.reduce((s, p) => s + p[1], 0) / pairs.length;
    let sxy = 0;
    let sxx = 0;
    for (const [x, y] of pairs) {
      sxy += (x - mx) * (y - my);
      sxx += (x - mx) ** 2;
    }
    if (sxx > 0 && sxy > 0) slope = sxy / sxx;
  }
  const mapY = monotoneMap(pairs, slope);

  const legAxis: Partial<Record<Side, { point: Vec3; dir: Vec3 } | null>> = {};
  for (const s of ['L', 'R'] as Side[]) {
    const tubes = kit.groups.filter((g) => g.side === s && g.type && LEG.has(g.type));
    if (tubes.length) {
      const pts = tubes.map((g) => g.points);
      const all = new Float32Array(pts.reduce((n, a) => n + a.length, 0));
      let o = 0;
      for (const a of pts) {
        all.set(a, o);
        o += a.length;
      }
      const ax = tubeAxis(all);
      legAxis[s] = Math.abs(ax.dir[1]) > 0.7 ? { point: ax.point, dir: ax.dir } : null;
    }
    if (!legAxis[s]) {
      const legs = kit.members.filter((m) => m.side === s && m.type && LEG.has(m.type));
      if (legs.length) {
        const c = v3.scale(
          legs.reduce((a, m) => v3.add(a, m.center), [0, 0, 0] as Vec3),
          1 / legs.length,
        );
        legAxis[s] = { point: c, dir: [0, 1, 0] };
      }
    }
  }
  const axisAt = (ax: { point: Vec3; dir: Vec3 }, y: number): Vec3 => {
    const s = (y - ax.point[1]) / (ax.dir[1] || 1);
    return v3.add(ax.point, v3.scale(ax.dir, s));
  };
  const spineChain = [bones.spine, bones.neck, bones.head];

  const mapNonArm = (p: Vec3, type: PieceTypeId | null, side: Side | null, own?: Vec3 | null): Vec3 => {
    const y = mapY(p[1]);
    let kref: Vec3 = [kit.midline[0], p[1], kit.midline[2]];
    let mref: Vec3 = pointAtHeight(spineChain, y);
    const leg = type && LEG.has(type) && side;
    if (leg) {
      mref = pointAtHeight([bones[`thigh${side}`], bones[`shin${side}`]], y);
      if (legAxis[side]) kref = axisAt(legAxis[side]!, p[1]);
    }
    if (own) kref = own;
    return [mref[0] + slope * (p[0] - kref[0]), y, mref[2] + slope * (p[2] - kref[2])];
  };

  const armFrames: Partial<Record<Side, { rot: Quaternion; pivotK: Vec3; pivotM: Vec3 }>> = {};
  for (const s of ['L', 'R'] as Side[]) {
    const ax = kit.armAxes[s];
    if (!ax) continue;
    const shoulder = bones[`upperArm${s}`].to;
    const wrist = bones[`forearm${s}`].from;
    const dm = v3.norm(v3.sub(wrist, shoulder));
    const lateral = Math.abs(shoulder[0]) / slope;
    const sign = s === 'L' ? 1 : -1;
    const target = kit.midline[0] + sign * lateral;
    const k = Math.abs(ax.dir[0]) > 0.2 ? (target - ax.point[0]) / ax.dir[0] : 0;
    const pivotK = v3.add(ax.point, v3.scale(ax.dir, k));
    const rot = new Quaternion().setFromUnitVectors(new Vector3(...ax.dir), new Vector3(...dm));
    armFrames[s] = { rot, pivotK, pivotM: shoulder };
  }

  const mapArm = (p: Vec3, side: Side, weight: number): { pos: Vec3; rot: Quaternion } => {
    const f = armFrames[side]!;
    const rot = new Quaternion().slerp(f.rot, weight);
    if (weight < 1) {
      const rel = new Vector3(...v3.sub(mapNonArm(p, null, null), f.pivotM)).applyQuaternion(rot);
      return { pos: v3.add(f.pivotM, [rel.x, rel.y, rel.z]), rot };
    }
    const rel = new Vector3(...v3.scale(v3.sub(p, f.pivotK), slope)).applyQuaternion(rot);
    return { pos: v3.add(f.pivotM, [rel.x, rel.y, rel.z]), rot };
  };

  const done = new Map<string, BonePlacement>();
  for (const m of kit.members) {
    const key = m.group ?? m.id;
    if (done.has(key)) {
      out.set(m.id, done.get(key)!);
      continue;
    }
    const type = memberType(kit, m);
    const side = memberSide(kit, m);
    let pos: Vec3;
    let rot = new Quaternion();
    if (type && side && (ARM.has(type) || type === 'pauldron') && armFrames[side]) {
      const r = mapArm(m.origin, side, type === 'pauldron' ? 0.5 : 1);
      pos = r.pos;
      rot = r.rot;
    } else {
      pos = mapNonArm(m.origin, type, side, m.axis);
    }
    const boneId = boneForType(type, side) ?? nearestBone(bones, pos).bone.id;
    const bone = bones[boneId];
    const cat = type ? pieceType(type).category : m.category;
    if (cat !== 'shell' && boneId !== 'spine' && boneId !== 'head' && boneId !== 'neck') {
      const t = boneT(bone, pos);
      const tc = Math.min(0.85, Math.max(0.15, t));
      pos = v3.add(pos, v3.sub(pointOnBone(bone, tc), pointOnBone(bone, t)));
    }
    const world = new Matrix4().compose(new Vector3(...pos), rot, new Vector3(1, 1, 1));
    const spec = toPlacement(world, bone);
    done.set(key, spec);
    out.set(m.id, spec);
  }
  return out;
}
