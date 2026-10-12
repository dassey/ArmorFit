import { pca } from '../math/fitting';
import { v3, type Vec3 } from '../math/linalg';
import type { MeasurementKey } from '../measurements/schema';
import type { BodyAssetHeader } from './asset';

export type VertexGetter = (v: number) => Vec3;

export type SparseGradient = number[];

const LOOP_FOR: Partial<Record<MeasurementKey, string>> = {
  chest: 'chest',
  waist: 'waist',
  hips: 'hips',
  neckCirc: 'neck',
  headCirc: 'headCirc',
  bicepCirc: 'bicep',
  forearmCirc: 'forearm',
  wristCirc: 'wrist',
  thighCirc: 'thigh',
  calfCirc: 'calf',
};

export function loopBasis(points: Vec3[]): [Vec3, Vec3] {
  const flat = new Float64Array(points.length * 3);
  points.forEach((p, i) => flat.set(p, i * 3));
  const normal = pca(flat).axes[2];
  const helper: Vec3 = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = v3.norm(v3.cross(normal, helper));
  return [u, v3.cross(normal, u)];
}

export function convexHull2D(pts: [number, number][]): number[] {
  const order = pts.map((_, i) => i).sort((a, b) => pts[a][0] - pts[b][0] || pts[a][1] - pts[b][1]);
  const cross = (o: number, a: number, b: number) =>
    (pts[a][0] - pts[o][0]) * (pts[b][1] - pts[o][1]) - (pts[a][1] - pts[o][1]) * (pts[b][0] - pts[o][0]);
  const lower: number[] = [];
  for (const i of order) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], i) <= 0) lower.pop();
    lower.push(i);
  }
  const upper: number[] = [];
  for (let k = order.length - 1; k >= 0; k--) {
    const i = order[k];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], i) <= 0) upper.pop();
    upper.push(i);
  }
  return lower.slice(0, -1).concat(upper.slice(0, -1));
}

export function tapePerimeter(points: Vec3[], basis?: [Vec3, Vec3]): number {
  const [u, w] = basis ?? loopBasis(points);
  const pts = points.map((p) => [v3.dot(p, u), v3.dot(p, w)] as [number, number]);
  const hull = convexHull2D(pts);
  let per = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = pts[hull[i]];
    const b = pts[hull[(i + 1) % hull.length]];
    per += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return per;
}

export class BodyMeasurer {
  private bases = new Map<string, [Vec3, Vec3]>();

  constructor(private readonly header: BodyAssetHeader) {}

  freezePlanes(get: VertexGetter): void {
    for (const name of Object.keys(this.header.loops))
      this.bases.set(name, loopBasis(this.loopPoints(name, get)));
  }

  private lm(name: string): number {
    const v = this.header.landmarks[name];
    if (typeof v !== 'number') throw new Error(`landmark ${name} missing`);
    return v;
  }

  requiredVertices(): number[] {
    const out = new Set<number>();
    for (const loop of Object.values(this.header.loops)) {
      for (const [a, b] of loop.edges) {
        out.add(a);
        out.add(b);
      }
    }
    for (const v of Object.values(this.header.landmarks)) {
      if (typeof v === 'number') out.add(v);
      else v.forEach((x) => out.add(x));
    }
    return [...out];
  }

  loopPoints(name: string, get: VertexGetter): Vec3[] {
    return this.header.loops[name].edges.map(([a, b, t]) => v3.lerp(get(a), get(b), t));
  }

  measure(get: VertexGetter): Partial<Record<MeasurementKey, number>> {
    return this.evaluate(get, false).values;
  }

  measureWithGradient(get: VertexGetter): {
    values: Partial<Record<MeasurementKey, number>>;
    gradients: Partial<Record<MeasurementKey, SparseGradient>>;
  } {
    return this.evaluate(get, true);
  }

  private evaluate(get: VertexGetter, withGrad: boolean) {
    const values: Partial<Record<MeasurementKey, number>> = {};
    const gradients: Partial<Record<MeasurementKey, SparseGradient>> = {};
    const P = (name: string) => get(this.lm(name));
    const g = (key: MeasurementKey): SparseGradient => (gradients[key] ??= []);
    const push = (key: MeasurementKey, v: number, d: Vec3, f = 1) => {
      if (withGrad) g(key).push(v, d[0] * f, d[1] * f, d[2] * f);
    };
    const dist = (key: MeasurementKey, a: string, b: string, f = 1) => {
      const pa = P(a);
      const pb = P(b);
      const d = v3.sub(pa, pb);
      const l = v3.len(d) || 1;
      push(key, this.lm(a), v3.scale(d, 1 / l), f);
      push(key, this.lm(b), v3.scale(d, -1 / l), f);
      return l * f;
    };
    const vdist = (key: MeasurementKey, a: string, b: string, f = 1) => {
      push(key, this.lm(a), [0, 1, 0], f);
      push(key, this.lm(b), [0, -1, 0], f);
      return (P(a)[1] - P(b)[1]) * f;
    };

    const soles = this.header.landmarks.soles as number[];
    let minY = Infinity;
    let minV = soles[0];
    for (const v of soles) {
      const y = get(v)[1];
      if (y < minY) {
        minY = y;
        minV = v;
      }
    }
    values.height = P('crown')[1] - minY;
    push('height', this.lm('crown'), [0, 1, 0]);
    push('height', minV, [0, -1, 0]);

    for (const [key, loopName] of Object.entries(LOOP_FOR) as [MeasurementKey, string][]) {
      const loop = this.header.loops[loopName].edges;
      const pts3 = loop.map(([a, b, t]) => v3.lerp(get(a), get(b), t));
      const [u, w] = this.bases.get(loopName) ?? loopBasis(pts3);
      const pts = pts3.map((p) => [v3.dot(p, u), v3.dot(p, w)] as [number, number]);
      const hull = convexHull2D(pts);
      let per = 0;
      const m = hull.length;
      for (let i = 0; i < m; i++) {
        const a = pts[hull[i]];
        const b = pts[hull[(i + 1) % m]];
        per += Math.hypot(a[0] - b[0], a[1] - b[1]);
      }
      values[key] = per;
      if (withGrad) {
        for (let i = 0; i < m; i++) {
          const prev = pts[hull[(i - 1 + m) % m]];
          const cur = pts[hull[i]];
          const next = pts[hull[(i + 1) % m]];
          const l1 = Math.hypot(cur[0] - prev[0], cur[1] - prev[1]) || 1;
          const l2 = Math.hypot(next[0] - cur[0], next[1] - cur[1]) || 1;
          const gu = (cur[0] - prev[0]) / l1 - (next[0] - cur[0]) / l2;
          const gw = (cur[1] - prev[1]) / l1 - (next[1] - cur[1]) / l2;
          const d3 = v3.add(v3.scale(u, gu), v3.scale(w, gw));
          const [va, vb, t] = loop[hull[i]];
          push(key, va, d3, 1 - t);
          push(key, vb, d3, t);
        }
      }
    }

    values.shoulderWidth = dist('shoulderWidth', 'acromionL', 'acromionR');
    values.upperArmLength =
      dist('upperArmLength', 'acromionL', 'radialeL', 0.5) +
      dist('upperArmLength', 'acromionR', 'radialeR', 0.5);
    values.forearmLength =
      dist('forearmLength', 'radialeL', 'stylionL', 0.5) + dist('forearmLength', 'radialeR', 'stylionR', 0.5);
    values.handLength =
      dist('handLength', 'stylionL', 'fingertipL', 0.5) + dist('handLength', 'stylionR', 'fingertipR', 0.5);
    values.handWidth =
      dist('handWidth', 'knuckleAL', 'knuckleBL', 0.5) + dist('handWidth', 'knuckleAR', 'knuckleBR', 0.5);
    values.footLength = dist('footLength', 'heelL', 'toeL', 0.5) + dist('footLength', 'heelR', 'toeR', 0.5);
    values.headLength = dist('headLength', 'glabella', 'opisthocranion');
    values.headWidth = dist('headWidth', 'euryonL', 'euryonR');
    values.torsoLength = vdist('torsoLength', 'suprasternale', 'omphalion');
    values.thighLength =
      vdist('thighLength', 'trochanterionL', 'femoralEpicondyleL', 0.5) +
      vdist('thighLength', 'trochanterionR', 'femoralEpicondyleR', 0.5);
    values.shinLength =
      vdist('shinLength', 'tibialeL', 'malleolusL', 0.5) + vdist('shinLength', 'tibialeR', 'malleolusR', 0.5);
    return { values, gradients };
  }
}
