import { Matrix4 } from 'three';
import { fitCircle2D, fitCylinderAlong, pca } from '../math/fitting';
import { v3, type Vec3 } from '../math/linalg';
import { computeBounds, type Bounds, type MeshData } from '../mesh/types';
import { isDetailPart, tokenize } from './classify';
import { autoOrient, type OrientationResult } from './orient';
import { pieceType, type PieceCategory, type PieceTypeId, type Side } from './types';
import { guessSetUnits, type UnitGuess } from './units';

export interface KitInput {
  id: string;
  name: string;
  type: PieceTypeId | null;
  side: Side | null;
  confidence: number;
  mesh: MeshData;
}

export interface KitMember {
  id: string;
  type: PieceTypeId | null;
  side: Side | null;
  center: Vec3;
  origin: Vec3;
  outward: Vec3;
  axis: Vec3 | null;
  group: string | null;
  category: PieceCategory;
}

export interface KitGroup {
  id: string;
  type: PieceTypeId | null;
  side: Side | null;
  members: string[];
  center: Vec3;
  points: Float32Array;
}

export interface KitInfo {
  id: string;
  kind: 'body' | 'part';
  type: PieceTypeId | null;
  name: string;
  unitScale: number;
  units: UnitGuess;
  rotation: number[];
  confidence: number;
  reasons: string[];
  members: KitMember[];
  groups: KitGroup[];
  armAxes: Partial<Record<Side, { point: Vec3; dir: Vec3 }>>;
  midline: Vec3;
}

export const NOMINAL_HEIGHT: Partial<Record<PieceTypeId, number>> = {
  helmet: 0.93,
  gorget: 0.84,
  pauldron: 0.81,
  chest: 0.73,
  back: 0.73,
  abdomen: 0.63,
  belt: 0.57,
  tasset: 0.5,
  thigh: 0.4,
  knee: 0.285,
  shin: 0.17,
  calf: 0.17,
  boot: 0.03,
};

const ARM_TYPES = new Set<PieceTypeId>(['bicep', 'elbow', 'forearm', 'hand']);
const WRAP_TYPES = new Set<PieceTypeId>(['chest', 'back', 'abdomen', 'tasset', 'knee', 'shin', 'calf']);

function curvatureAxis(pts: Float32Array): { point: Vec3; radius: number } | null {
  if (pts.length < 30) return null;
  const b = computeBounds(pts);
  const size = Math.max(b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]);
  const cyl = fitCylinderAlong(pts, [0, 1, 0]);
  if (!cyl || cyl.radius < 25 || cyl.radius > Math.max(400, size * 1.5) || cyl.rms / cyl.radius > 0.3)
    return null;
  return { point: cyl.point, radius: cyl.radius };
}
const LEG_TYPES = new Set<PieceTypeId>(['tasset', 'thigh', 'knee', 'shin', 'calf', 'boot']);
const FRONT_WORDS = new Set(['front', 'face', 'visor', 'chest', 'fore']);
const BACK_WORDS = new Set(['back', 'rear']);
const SAMPLES = 400;

interface Prepared {
  input: KitInput;
  filePoints: Float32Array;
  bounds: Bounds;
  maxDim: number;
}

function samplePoints(mesh: MeshData, count: number): Float32Array {
  const nv = mesh.positions.length / 3;
  const out = new Float32Array(Math.min(count, nv) * 3);
  const step = nv / (out.length / 3);
  for (let i = 0; i < out.length / 3; i++) {
    const v = Math.floor(i * step) * 3;
    out[i * 3] = mesh.positions[v];
    out[i * 3 + 1] = mesh.positions[v + 1];
    out[i * 3 + 2] = mesh.positions[v + 2];
  }
  return out;
}

function prepare(input: KitInput): Prepared {
  const bounds = computeBounds(input.mesh.positions);
  const maxDim = Math.max(
    bounds.max[0] - bounds.min[0],
    bounds.max[1] - bounds.min[1],
    bounds.max[2] - bounds.min[2],
  );
  return { input, filePoints: samplePoints(input.mesh, SAMPLES), bounds, maxDim };
}

const AXES: Vec3[] = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function snapAxis(v: Vec3, maxAngleDeg = 20): Vec3 {
  const n = v3.norm(v);
  let best = AXES[0];
  let bestDot = -2;
  for (const a of AXES) {
    const d = v3.dot(a, n);
    if (d > bestDot) {
      bestDot = d;
      best = a;
    }
  }
  return bestDot > Math.cos((maxAngleDeg * Math.PI) / 180) ? [...best] : n;
}

function boundsCenterMm(b: Bounds, u: number): Vec3 {
  return [((b.min[0] + b.max[0]) / 2) * u, ((b.min[1] + b.max[1]) / 2) * u, ((b.min[2] + b.max[2]) / 2) * u];
}

function boundsGap(a: Bounds, b: Bounds): number {
  let g = 0;
  for (let k = 0; k < 3; k++) g = Math.max(g, a.min[k] - b.max[k], b.min[k] - a.max[k]);
  return g;
}

function unionBounds(items: Prepared[]): Bounds {
  const min: Vec3 = [Infinity, Infinity, Infinity];
  const max: Vec3 = [-Infinity, -Infinity, -Infinity];
  for (const p of items)
    for (let k = 0; k < 3; k++) {
      min[k] = Math.min(min[k], p.bounds.min[k]);
      max[k] = Math.max(max[k], p.bounds.max[k]);
    }
  return { min, max };
}

function components(items: Prepared[], u: number, maxGapMm: number): Prepared[][] {
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  for (let i = 0; i < items.length; i++)
    for (let j = i + 1; j < items.length; j++)
      if (boundsGap(items[i].bounds, items[j].bounds) * u <= maxGapMm) parent[find(i)] = find(j);
  const out = new Map<number, Prepared[]>();
  items.forEach((it, i) => {
    const r = find(i);
    if (!out.has(r)) out.set(r, []);
    out.get(r)!.push(it);
  });
  return [...out.values()];
}

function mean(vs: Vec3[]): Vec3 {
  if (!vs.length) return [0, 0, 0];
  return v3.scale(
    vs.reduce((a, b) => v3.add(a, b), [0, 0, 0] as Vec3),
    1 / vs.length,
  );
}

function correlation(xs: number[], ys: number[]): number {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
    syy += (ys[i] - my) ** 2;
  }
  return sxx > 0 && syy > 0 ? sxy / Math.sqrt(sxx * syy) : 0;
}

function linearFit(xs: number[], ys: number[]): { slope: number; intercept: number } {
  const n = xs.length;
  const mx = xs.reduce((a, b) => a + b, 0) / n;
  const my = ys.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  for (let i = 0; i < n; i++) {
    sxy += (xs[i] - mx) * (ys[i] - my);
    sxx += (xs[i] - mx) ** 2;
  }
  const slope = sxx > 0 ? sxy / sxx : 0;
  return { slope, intercept: my - slope * mx };
}

function rotationRows(left: Vec3, up: Vec3, front: Vec3): Matrix4 {
  return new Matrix4().set(
    left[0],
    left[1],
    left[2],
    0,
    up[0],
    up[1],
    up[2],
    0,
    front[0],
    front[1],
    front[2],
    0,
    0,
    0,
    0,
    1,
  );
}

function typicalOf(p: Prepared): number | undefined {
  if (!p.input.type || isDetailPart(p.input.name)) return undefined;
  return pieceType(p.input.type).typicalSize;
}

function nameCue(name: string): 'front' | 'back' | null {
  const t = tokenize(name);
  if (t.some((w) => FRONT_WORDS.has(w))) return 'front';
  if (t.some((w) => BACK_WORDS.has(w))) return 'back';
  return null;
}

function categoryOf(type: PieceTypeId | null, fallback: PieceCategory): PieceCategory {
  return type ? pieceType(type).category : fallback;
}

let kitCounter = 0;

function wPointsOf(p: Prepared, R: Matrix4, u: number): Float32Array {
  const e = R.elements;
  const out = new Float32Array(p.filePoints.length);
  for (let i = 0; i < out.length; i += 3) {
    const x = p.filePoints[i] * u;
    const y = p.filePoints[i + 1] * u;
    const z = p.filePoints[i + 2] * u;
    out[i] = e[0] * x + e[4] * y + e[8] * z;
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z;
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z;
  }
  return out;
}

export function tubeAxis(pts: Float32Array): { point: Vec3; dir: Vec3; radius: number } {
  const pc = pca(pts);
  const n = pts.length / 3;
  const stride = Math.max(1, Math.floor(n / 1500));
  const score = (d: Vec3) => {
    const helper: Vec3 = Math.abs(d[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
    const a = v3.norm(v3.cross(d, helper));
    const b = v3.cross(d, a);
    const xy: number[] = [];
    for (let i = 0; i < n; i += stride) {
      const p: Vec3 = [pts[i * 3] - pc.mean[0], pts[i * 3 + 1] - pc.mean[1], pts[i * 3 + 2] - pc.mean[2]];
      xy.push(v3.dot(p, a), v3.dot(p, b));
    }
    const c = fitCircle2D(xy);
    if (!c || c.radius <= 0) return { rel: Infinity, c: null, a, b };
    return { rel: c.rms / c.radius, c, a, b };
  };
  let best = { dir: pc.axes[0], ...score(pc.axes[0]) };
  const N = 300;
  for (let i = 0; i < N; i++) {
    const z = 1 - (i + 0.5) / N;
    const r = Math.sqrt(1 - z * z);
    const phi = i * Math.PI * (3 - Math.sqrt(5));
    const d: Vec3 = [r * Math.cos(phi), r * Math.sin(phi), z];
    const sc = score(d);
    if (sc.rel < best.rel) best = { dir: d, ...sc };
  }
  for (let step = 0.08; step > 0.005; step /= 2) {
    let improved = true;
    while (improved) {
      improved = false;
      for (const t of [best.a, best.b]) {
        for (const sgn of [1, -1]) {
          const d = v3.norm(v3.add(best.dir, v3.scale(t, sgn * step)));
          const sc = score(d);
          if (sc.rel < best.rel - 1e-9) {
            best = { dir: d, ...sc };
            improved = true;
          }
        }
      }
    }
  }
  const c = best.c;
  const point: Vec3 = c ? v3.add(pc.mean, v3.add(v3.scale(best.a, c.cx), v3.scale(best.b, c.cy))) : pc.mean;
  return { point, dir: best.dir, radius: c?.radius ?? 0 };
}

function centerOfPoints(pts: Float32Array): Vec3 {
  const b = computeBounds(pts);
  return [(b.min[0] + b.max[0]) / 2, (b.min[1] + b.max[1]) / 2, (b.min[2] + b.max[2]) / 2];
}

function concat(arrays: Float32Array[]): Float32Array {
  const out = new Float32Array(arrays.reduce((s, a) => s + a.length, 0));
  let o = 0;
  for (const a of arrays) {
    out.set(a, o);
    o += a.length;
  }
  return out;
}

function insideBounds(c: Vec3, pts: Float32Array, margin: number): boolean {
  const b = computeBounds(pts);
  for (let k = 0; k < 3; k++) if (c[k] < b.min[k] - margin || c[k] > b.max[k] + margin) return false;
  return true;
}

function onBed(p: Prepared, u: number): boolean {
  return Math.abs(p.bounds.min[2] * u) < 0.5 || Math.abs(p.bounds.min[1] * u) < 0.5;
}

function mergeMeshes(items: Prepared[], u: number): MeshData {
  const nv = items.reduce((s, p) => s + p.input.mesh.positions.length, 0);
  const ni = items.reduce((s, p) => s + p.input.mesh.indices.length, 0);
  const positions = new Float32Array(nv);
  const indices = new Uint32Array(ni);
  let vo = 0;
  let io = 0;
  for (const p of items) {
    const m = p.input.mesh;
    for (let i = 0; i < m.positions.length; i++) positions[vo + i] = m.positions[i] * u;
    for (let i = 0; i < m.indices.length; i++) indices[io + i] = m.indices[i] + vo / 3;
    vo += m.positions.length;
    io += m.indices.length;
  }
  return { positions, indices };
}

function buildKit(
  items: Prepared[],
  kind: 'body' | 'part',
  R: Matrix4,
  units: UnitGuess,
  confidence: number,
  reasons: string[],
  partCategory?: PieceCategory,
  partType?: PieceTypeId,
): KitInfo {
  const u = units.best.scale;
  const id = `kit${++kitCounter}${Math.random().toString(36).slice(2, 6)}`;
  const pts = new Map(items.map((p) => [p.input.id, wPointsOf(p, R, u)]));
  const centers = new Map(items.map((p) => [p.input.id, centerOfPoints(pts.get(p.input.id)!)]));
  const groups: KitGroup[] = [];
  const groupOf = new Map<string, string>();

  if (kind === 'part') {
    const all = concat(items.map((p) => pts.get(p.input.id)!));
    const g: KitGroup = {
      id: `${id}g1`,
      type: partType ?? null,
      side: null,
      members: items.map((p) => p.input.id),
      center: centerOfPoints(all),
      points: all,
    };
    groups.push(g);
    for (const m of g.members) groupOf.set(m, g.id);
  } else {
    const keyed = new Map<string, Prepared[]>();
    for (const p of items) {
      const t = p.input.type;
      if (!t || isDetailPart(p.input.name)) continue;
      const cat = pieceType(t).category;
      if (cat === 'shell') continue;
      const key = `${t}:${p.input.side ?? ''}`;
      if (!keyed.has(key)) keyed.set(key, []);
      keyed.get(key)!.push(p);
    }
    let n = 0;
    for (const list of keyed.values()) {
      const gpts = concat(list.map((p) => pts.get(p.input.id)!));
      const members = list.map((p) => p.input.id);
      for (const p of items) {
        if (members.includes(p.input.id)) continue;
        const isLoose = !p.input.type || isDetailPart(p.input.name);
        if (isLoose && !groupOf.has(p.input.id) && insideBounds(centers.get(p.input.id)!, gpts, 5)) {
          members.push(p.input.id);
        }
      }
      if (members.length < 2) continue;
      const all = concat(members.map((m) => pts.get(m)!));
      const g: KitGroup = {
        id: `${id}g${++n}`,
        type: list[0].input.type,
        side: list[0].input.side,
        members,
        center: centerOfPoints(all),
        points: all,
      };
      groups.push(g);
      for (const m of members) groupOf.set(m, g.id);
    }
  }

  const sided = items.filter((p) => p.input.side);
  const midX =
    sided.length >= 2
      ? (mean(sided.filter((p) => p.input.side === 'L').map((p) => centers.get(p.input.id)!))[0] +
          mean(sided.filter((p) => p.input.side === 'R').map((p) => centers.get(p.input.id)!))[0]) /
        2
      : mean([...centers.values()])[0];
  const torso = items.filter(
    (p) => p.input.type && !ARM_TYPES.has(p.input.type) && !LEG_TYPES.has(p.input.type),
  );
  const fronts = torso.filter((p) => ['chest', 'abdomen', 'belt'].includes(p.input.type!));
  const backs = torso.filter((p) => p.input.type === 'back');
  const midZ =
    fronts.length && backs.length
      ? (mean(fronts.map((p) => centers.get(p.input.id)!))[2] +
          mean(backs.map((p) => centers.get(p.input.id)!))[2]) /
        2
      : mean((torso.length ? torso : items).map((p) => centers.get(p.input.id)!))[2];
  const midline: Vec3 = [midX, 0, midZ];

  const armAxes: KitInfo['armAxes'] = {};
  for (const s of ['L', 'R'] as Side[]) {
    const arm = items.filter((p) => p.input.side === s && p.input.type && ARM_TYPES.has(p.input.type));
    if (!arm.length) continue;
    const armIds = new Set(arm.map((p) => p.input.id));
    for (const g of groups) if (g.members.some((m) => armIds.has(m))) g.members.forEach((m) => armIds.add(m));
    const all = concat(arm.map((p) => pts.get(p.input.id)!));
    const axis = tubeAxis(all);
    let dir = axis.dir;
    const lateral = axis.point[0] - midX;
    if (Math.sign(dir[0]) !== Math.sign(lateral) && Math.abs(lateral) > 1) dir = v3.scale(dir, -1);
    armAxes[s] = { point: axis.point, dir };
  }

  const legCenter = (side: Side): Vec3 | null => {
    const legs = items.filter((p) => p.input.side === side && p.input.type && LEG_TYPES.has(p.input.type));
    return legs.length ? mean(legs.map((p) => centers.get(p.input.id)!)) : null;
  };

  const members: KitMember[] = items.map((p) => {
    const c = centers.get(p.input.id)!;
    const gid = groupOf.get(p.input.id) ?? null;
    const g = gid ? groups.find((x) => x.id === gid)! : null;
    const origin = g ? g.center : c;
    let axisPoint: Vec3 = [midX, c[1], midZ];
    const t = p.input.type;
    if (t && LEG_TYPES.has(t) && p.input.side) {
      const lc = legCenter(p.input.side);
      if (lc) axisPoint = [lc[0], c[1], lc[2]];
    }
    const arm = p.input.side ? armAxes[p.input.side] : undefined;
    if (t && ARM_TYPES.has(t) && arm) {
      const rel = v3.sub(c, arm.point);
      axisPoint = v3.add(arm.point, v3.scale(arm.dir, v3.dot(rel, arm.dir)));
    }
    const own = !gid && t && WRAP_TYPES.has(t) ? curvatureAxis(pts.get(p.input.id)!) : null;
    if (own) axisPoint = [own.point[0], c[1], own.point[2]];
    let outward = v3.sub(c, axisPoint);
    if (!(t && ARM_TYPES.has(t))) outward[1] = 0;
    if (v3.len(outward) < 1e-3) outward = [0, 0, 1];
    outward = v3.norm(outward);
    const fallback = partCategory ?? 'shell';
    const detail = isDetailPart(p.input.name);
    return {
      id: p.input.id,
      type: kind === 'part' ? (partType ?? p.input.type) : p.input.type,
      side: kind === 'part' ? null : p.input.side,
      center: c,
      origin,
      outward,
      axis: own ? axisPoint : null,
      group: gid,
      category:
        g && kind === 'part'
          ? fallback
          : detail && !g
            ? 'shell'
            : categoryOf(g ? g.type : p.input.type, fallback),
    };
  });

  const name =
    kind === 'part' && partType ? `${pieceType(partType).label} set` : `Armor set (${items.length} files)`;
  return {
    id,
    kind,
    type: kind === 'part' ? (partType ?? null) : null,
    name,
    unitScale: u,
    units,
    rotation: R.elements.slice(),
    confidence,
    reasons,
    members,
    groups,
    armAxes,
    midline,
  };
}

function bodyFrame(
  items: Prepared[],
  u: number,
): { R: Matrix4; confidence: number; reasons: string[]; outliers: Prepared[] } | null {
  const centers = new Map(items.map((p) => [p, boundsCenterMm(p.bounds, u)]));
  const L = items.filter((p) => p.input.side === 'L').map((p) => centers.get(p)!);
  const Rs = items.filter((p) => p.input.side === 'R').map((p) => centers.get(p)!);
  let left: Vec3 | null = null;
  const pairs: Vec3[] = [];
  for (const t of new Set(items.map((p) => p.input.type))) {
    if (!t) continue;
    const l = items.filter((p) => p.input.type === t && p.input.side === 'L').map((p) => centers.get(p)!);
    const r = items.filter((p) => p.input.type === t && p.input.side === 'R').map((p) => centers.get(p)!);
    if (l.length && r.length) pairs.push(v3.sub(mean(l), mean(r)));
  }
  const d = pairs.length ? mean(pairs) : L.length && Rs.length ? v3.sub(mean(L), mean(Rs)) : null;
  if (d && v3.len(d) > 40) left = snapAxis(d);
  const typedAll = items.filter(
    (p) => p.input.type && NOMINAL_HEIGHT[p.input.type] !== undefined && !isDetailPart(p.input.name),
  );
  if (typedAll.length < 3) return null;
  const heightOf = (p: Prepared) => NOMINAL_HEIGHT[p.input.type!]!;
  if (new Set(typedAll.map(heightOf)).size < 2) return null;
  const tryAxis = (up: Vec3) => {
    let typed = typedAll;
    const outliers: Prepared[] = [];
    for (;;) {
      const fit = linearFit(
        typed.map(heightOf),
        typed.map((p) => v3.dot(centers.get(p)!, up)),
      );
      if (fit.slope <= 0) return null;
      let worst = -1;
      let worstResid = 0.2;
      typed.forEach((p, i) => {
        const resid =
          Math.abs(v3.dot(centers.get(p)!, up) - (fit.slope * heightOf(p) + fit.intercept)) / fit.slope;
        if (resid > worstResid) {
          worstResid = resid;
          worst = i;
        }
      });
      if (worst < 0) {
        if (new Set(typed.map(heightOf)).size < 2) return null;
        const corr = correlation(
          typed.map((p) => v3.dot(centers.get(p)!, up)),
          typed.map(heightOf),
        );
        return { up, outliers, stature: fit.slope, corr, kept: typed.length };
      }
      outliers.push(typed[worst]);
      typed = typed.filter((_, i) => i !== worst);
      if (typed.length < 3 || typed.length < typedAll.length * 0.5) return null;
    }
  };
  let best: NonNullable<ReturnType<typeof tryAxis>> | null = null;
  for (const axis of AXES.filter((x) => !left || Math.abs(v3.dot(x, left)) < 0.5)) {
    const r = tryAxis(axis);
    if (!r || r.corr < 0.8 || r.stature < 700 || r.stature > 3000) continue;
    if (!best || r.kept > best.kept || (r.kept === best.kept && r.corr > best.corr)) best = r;
  }
  if (!best) return null;
  const { up, outliers, stature } = best;
  const reasons = [`Pieces are laid out like a body about ${Math.round(stature / 10) * 10} mm tall.`];
  let confidence = 0.9;
  if (!left) {
    const frontC = items.filter(
      (p) =>
        nameCue(p.input.name) === 'front' ||
        ['chest', 'abdomen', 'belt', 'knee', 'shin'].includes(p.input.type ?? ''),
    );
    const backC = items.filter(
      (p) => nameCue(p.input.name) === 'back' || ['back', 'calf'].includes(p.input.type ?? ''),
    );
    if (frontC.length && backC.length) {
      const f = v3.sub(mean(frontC.map((p) => centers.get(p)!)), mean(backC.map((p) => centers.get(p)!)));
      const front = snapAxis(v3.sub(f, v3.scale(up, v3.dot(f, up))));
      left = v3.cross(up, front);
      reasons.push('Front and back taken from the piece names.');
    } else {
      left = Math.abs(up[0]) < 0.5 ? [1, 0, 0] : [0, 1, 0];
      confidence -= 0.3;
      reasons.push('No left/right pieces, so which side is the front is a guess.');
    }
  } else reasons.push('Left and right taken from the piece names.');
  left = v3.norm(v3.sub(left, v3.scale(up, v3.dot(left, up))));
  const front = v3.cross(left, up);
  return { R: rotationRows(left, up, front), confidence, reasons, outliers };
}

function partFrame(
  items: Prepared[],
  u: number,
  type: PieceTypeId | null,
): { R: Matrix4; confidence: number; reasons: string[]; category: PieceCategory } {
  const info = type ? pieceType(type) : null;
  const merged = mergeMeshes(items, u);
  const o: OrientationResult = autoOrient(merged, {
    category: info?.category,
    openingDown: info ? info.id !== 'boot' && info.id !== 'hand' : undefined,
  });
  const M = new Matrix4().fromArray(o.matrix);
  const R = new Matrix4().extractRotation(M);
  const e = R.elements;
  const up: Vec3 = [e[1], e[5], e[9]];
  let front: Vec3 = [e[2], e[6], e[10]];
  const reasons = [
    `Oriented as one ${info ? info.label.toLowerCase() : 'piece'} made of ${items.length} parts.`,
  ];
  const centers = items.map((p) => boundsCenterMm(p.bounds, u));
  const fc = items
    .map((p, i) => (nameCue(p.input.name) === 'front' ? centers[i] : null))
    .filter(Boolean) as Vec3[];
  const bc = items
    .map((p, i) => (nameCue(p.input.name) === 'back' ? centers[i] : null))
    .filter(Boolean) as Vec3[];
  if (fc.length && bc.length) {
    const f = v3.sub(mean(fc), mean(bc));
    const fh = v3.sub(f, v3.scale(up, v3.dot(f, up)));
    if (v3.len(fh) > 10) {
      front = v3.norm(fh);
      reasons.push('Front and back taken from the part names.');
    }
  }
  const upS = snapAxis(up);
  const frontS = snapAxis(v3.norm(v3.sub(front, v3.scale(upS, v3.dot(front, upS)))));
  const leftS = v3.norm(v3.cross(upS, frontS));
  const named = reasons.length > 1;
  return {
    R: rotationRows(leftS, upS, v3.cross(leftS, upS)),
    confidence: named ? Math.max(o.confidence, 0.75) : o.confidence,
    reasons,
    category: o.category,
  };
}

export function detectKits(inputs: KitInput[]): KitInfo[] {
  if (inputs.length < 2) return [];
  const items = inputs.map(prepare);
  const units = guessSetUnits(items.map((p) => ({ maxDimension: p.maxDim, typicalMm: typicalOf(p) })));
  const u = units.best.scale;
  if (items.filter((p) => onBed(p, u)).length >= items.length * 0.6) return [];
  return detectIn(items, units);
}

function detectIn(items: Prepared[], units: UnitGuess): KitInfo[] {
  const u = units.best.scale;
  const body = bodyFrame(items, u);
  if (body) {
    const out = new Set(body.outliers);
    if (out.size) {
      const ob = unionBounds([...out]);
      const outTypes = new Set([...out].map((p) => p.input.type));
      for (const p of items) {
        if (out.has(p)) continue;
        const loose = !p.input.type || isDetailPart(p.input.name);
        const c = boundsCenterMm(p.bounds, 1);
        const inside = [0, 1, 2].every((k) => c[k] >= ob.min[k] - 10 / u && c[k] <= ob.max[k] + 10 / u);
        if (loose && inside && (!p.input.type || outTypes.has(p.input.type))) out.add(p);
      }
    }
    const rest = items.filter((p) => !out.has(p));
    const kits = [buildKit(rest, 'body', body.R, units, body.confidence, body.reasons)];
    for (const comp of components([...out], u, 30)) if (comp.length >= 2) kits.push(...detectIn(comp, units));
    return kits;
  }
  const comps = components(items, u, 30);
  const kits: KitInfo[] = [];
  for (const comp of comps) {
    if (comp.length < 2) continue;
    const ub = unionBounds(comp);
    const extent = Math.max(ub.max[0] - ub.min[0], ub.max[1] - ub.min[1], ub.max[2] - ub.min[2]) * u;
    if (extent > 700) continue;
    const typed = comp.filter((p) => p.input.type);
    if (!typed.length) continue;
    typed.sort((a, b) => b.input.confidence - a.input.confidence || b.maxDim - a.maxDim);
    const type = typed[0].input.type!;
    const f = partFrame(comp, u, type);
    kits.push(buildKit(comp, 'part', f.R, units, f.confidence, f.reasons, f.category, type));
  }
  return kits;
}

export function kitOrientation(kit: KitInfo, memberId: string, base: OrientationResult): OrientationResult {
  const m = kit.members.find((x) => x.id === memberId)!;
  const R = new Matrix4().fromArray(kit.rotation);
  const M = new Matrix4().makeTranslation(-m.origin[0], -m.origin[1], -m.origin[2]).multiply(R);
  const rel = v3.sub(m.center, m.origin);
  return {
    ...base,
    matrix: M.elements.slice(),
    category: m.category,
    confidence: kit.confidence,
    reasons: kit.reasons,
    contactPoint: rel,
    contactNormal: m.category === 'shell' ? m.outward : [0, 1, 0],
    center: rel,
  };
}
