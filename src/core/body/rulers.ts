import { v3, type Vec3 } from '../math/linalg';
import { measurementInfo, type MeasurementKey } from '../measurements/schema';
import { convexHull2D, loopBasis, LOOP_FOR } from './measure';
import { segmentOf } from './parts';

export type LoopEdges = [number, number, number][];

export interface BodyShape {
  positions: ArrayLike<number>;
  regions: ArrayLike<number>;
  landmarks: Record<string, Vec3>;
  loops: Record<string, LoopEdges>;
}

export interface RulerGeometry {
  path: Vec3[];
  closed: boolean;
  ends: Vec3[];
  label: Vec3;
}

export function rulerLabel(key: MeasurementKey): string {
  return measurementInfo(key)
    .label.replace(/\s*\(.*\)$/, '')
    .replace(/ circumference$/, '');
}

function vertex(P: ArrayLike<number>, i: number): Vec3 {
  return [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]];
}

export function tapePath(edges: LoopEdges, positions: ArrayLike<number>): Vec3[] {
  const pts = edges.map(([a, b, t]) => v3.lerp(vertex(positions, a), vertex(positions, b), t));
  const [u, w] = loopBasis(pts);
  return convexHull2D(pts.map((p) => [v3.dot(p, u), v3.dot(p, w)])).map((i) => pts[i]);
}

export function pathLength(path: Vec3[], closed: boolean): number {
  let len = 0;
  for (let i = 1; i < path.length; i++) len += v3.dist(path[i - 1], path[i]);
  return closed && path.length > 2 ? len + v3.dist(path[path.length - 1], path[0]) : len;
}

function loop(edges: LoopEdges, positions: ArrayLike<number>): RulerGeometry {
  const path = tapePath(edges, positions);
  const center = v3.scale(
    path.reduce((s, p) => v3.add(s, p), [0, 0, 0] as Vec3),
    1 / path.length,
  );
  let front = path[0];
  for (const p of path) if (p[2] + 0.35 * p[0] > front[2] + 0.35 * front[0]) front = p;
  const out = v3.norm(v3.sub(front, center));
  return { path, closed: true, ends: [], label: v3.add(front, v3.scale(out, 25)) };
}

function line(a: Vec3, b: Vec3): RulerGeometry {
  return { path: [a, b], closed: false, ends: [a, b], label: v3.add(v3.lerp(a, b, 0.5), [0, 0, 20]) };
}

function bracket(top: Vec3, bottom: Vec3, x: number, z: number): RulerGeometry {
  const a: Vec3 = [x, top[1], z];
  const b: Vec3 = [x, bottom[1], z];
  return { path: [top, a, b, bottom], closed: false, ends: [a, b], label: v3.lerp(a, b, 0.5) };
}

function extent(
  shape: BodyShape,
  axis: number,
  y0: number,
  y1: number,
  keep: (v: number, p: Vec3) => boolean,
): number {
  const P = shape.positions;
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  let best = -Infinity;
  for (let v = 0; v < shape.regions.length; v++) {
    const y = P[v * 3 + 1];
    if (y < lo || y > hi) continue;
    const p = vertex(P, v);
    if (keep(v, p) && p[axis] > best) best = p[axis];
  }
  return best;
}

export function rulerGeometry(key: MeasurementKey, shape: BodyShape): RulerGeometry | null {
  const loopName = LOOP_FOR[key];
  if (loopName) {
    const edges = shape.loops[loopName];
    return edges?.length ? loop(edges, shape.positions) : null;
  }
  const L = shape.landmarks;
  const seg = (v: number) => segmentOf(shape.regions[v]);
  switch (key) {
    case 'height': {
      const crown = L.crown;
      const x = L.acromionR[0] - 90;
      const z = Math.max(L.toeL[2], L.toeR[2]) + 40;
      return {
        path: [crown, [x, crown[1], z], [x, 0, z]],
        closed: false,
        ends: [
          [x, crown[1], z],
          [x, 0, z],
        ],
        label: [x, crown[1] * 0.5, z],
      };
    }
    case 'shoulderWidth':
      return line(L.acromionL, L.acromionR);
    case 'upperArmLength':
      return line(L.acromionL, L.radialeL);
    case 'forearmLength':
      return line(L.radialeL, L.stylionL);
    case 'handLength':
      return line(L.stylionL, L.fingertipL);
    case 'handWidth':
      return line(L.knuckleAL, L.knuckleBL);
    case 'footLength':
      return line(L.heelL, L.toeL);
    case 'headLength':
      return line(L.glabella, L.opisthocranion);
    case 'headWidth':
      return line(L.euryonL, L.euryonR);
    case 'torsoLength': {
      const top = L.suprasternale;
      const bottom = L.omphalion;
      const front = extent(shape, 2, bottom[1], top[1], (v, p) => seg(v) === 0 && Math.abs(p[0]) < 90);
      return bracket(top, bottom, top[0], front + 25);
    }
    case 'thighLength': {
      const top = L.trochanterionL;
      const bottom = L.femoralEpicondyleL;
      return bracket(top, bottom, Math.max(top[0], bottom[0]) + 30, (top[2] + bottom[2]) / 2);
    }
    case 'shinLength': {
      const top = L.tibialeL;
      const bottom = L.malleolusL;
      const front = extent(shape, 2, bottom[1], top[1], (v) => seg(v) === 3);
      return bracket(top, bottom, (top[0] + bottom[0]) / 2, front + 25);
    }
  }
  return null;
}
