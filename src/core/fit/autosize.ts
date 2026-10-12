import { Matrix4 } from 'three';
import { leastSquares } from '../math/linalg';
import type { Vec3 } from '../math/linalg';
import type { AnalysisPiece } from './analyze';
import type { BodyQuery } from './bodyQuery';
import { clearanceStats, measureClearance, type ClearanceSettings, type ClearanceStats } from './clearance';

export interface AutoSizeOptions {
  mode: 'uniform' | 'axes' | 'offset';
  anisotropyWeight?: number;
  category?: 'shell' | 'tube' | 'cap';
  iterations?: number;
}

export interface AutoSizeResult {
  scale: [number, number, number];
  offset: number;
  before: ClearanceStats;
  after: ClearanceStats;
  iterations: number;
}

export function autoSize(
  piece: Pick<AnalysisPiece, 'samplePoints' | 'sampleNormals'>,
  placement: Matrix4,
  direction: Vec3 | null,
  startScale: [number, number, number],
  mirrored: boolean,
  body: BodyQuery,
  settings: ClearanceSettings,
  opts: AutoSizeOptions,
): AutoSizeResult {
  const R = new Matrix4().extractRotation(placement).elements;
  const axis = (k: number): Vec3 => [R[k * 4], R[k * 4 + 1], R[k * 4 + 2]];
  const axes = [axis(0), axis(1), axis(2)];
  const mx = mirrored ? -1 : 1;
  const uniform = opts.mode === 'uniform';
  const offsetOnly = opts.mode === 'offset';
  const scaleCols = offsetOnly ? 0 : uniform ? 1 : 3;
  const nParams = scaleCols + (direction ? 1 : 0);
  if (nParams === 0) {
    const st = clearanceStats(
      measureClearance(
        piece.samplePoints,
        piece.sampleNormals,
        placement
          .clone()
          .multiply(
            new Matrix4().makeScale(mirrored ? -startScale[0] : startScale[0], startScale[1], startScale[2]),
          ),
        body,
        200,
      ),
      settings,
    );
    return { scale: [...startScale], offset: 0, before: st, after: st, iterations: 0 };
  }
  const aniso = opts.anisotropyWeight ?? 6;

  let scale: [number, number, number] = [...startScale];
  let offset = 0;
  const matrixFor = (s: [number, number, number], off: number) => {
    const m = new Matrix4().makeScale(mx * s[0], s[1], s[2]);
    m.premultiply(placement);
    if (direction && off)
      m.premultiply(
        new Matrix4().makeTranslation(direction[0] * off, direction[1] * off, direction[2] * off),
      );
    return m;
  };
  const evaluate = (s: [number, number, number], off: number) =>
    measureClearance(piece.samplePoints, piece.sampleNormals, matrixFor(s, off), body, 200);

  const before = clearanceStats(evaluate(scale, 0), settings);
  const iterations = opts.iterations ?? 20;
  let it = 0;
  for (; it < iterations; it++) {
    const samples = evaluate(scale, offset);
    if (samples.length < 8) break;
    const rows: number[] = [];
    const rhs: number[] = [];
    const push = (row: number[], r: number, w: number) => {
      rows.push(...row.map((v) => v * w));
      rhs.push(r * w);
    };
    const sorted = samples.map((x) => x.clearance).sort((a, b) => a - b);
    const c40 = sorted[Math.floor(0.4 * (sorted.length - 1))];
    for (const smp of samples) {
      const n = smp.bodyNormal;
      const i = smp.index;
      const w: Vec3 = [
        mx * piece.samplePoints[i * 3],
        piece.samplePoints[i * 3 + 1],
        piece.samplePoints[i * 3 + 2],
      ];
      const dS = axes.map((a, k) => (n[0] * a[0] + n[1] * a[1] + n[2] * a[2]) * w[k]);
      const row: number[] = offsetOnly
        ? []
        : uniform
          ? [dS[0] * scale[0] + dS[1] * scale[1] + dS[2] * scale[2]]
          : dS;
      if (direction) row.push(n[0] * direction[0] + n[1] * direction[1] + n[2] * direction[2]);
      const c = smp.clearance;
      const contact = c <= c40 ? 1 : Math.exp(-(c - c40) / 20);
      const robust = contact / Math.sqrt(1 + ((c - settings.target) / 25) ** 2);
      push(row, settings.target - c, robust);
      if (c < settings.min) push(row, settings.target - c, 15);
    }
    const m = rhs.length;
    const reg: { row: number[]; r: number }[] = [];
    const wN = Math.sqrt(samples.length);
    if (scaleCols === 3) {
      const mean = (scale[0] + scale[1] + scale[2]) / 3;
      for (let k = 0; k < 3; k++) {
        const row = new Array(nParams).fill(0);
        for (let j = 0; j < 3; j++) row[j] = ((k === j ? 1 : 0) - 1 / 3) * aniso * wN;
        reg.push({ row, r: -(scale[k] - mean) * aniso * wN });
      }
    }
    for (let k = 0; k < scaleCols; k++) {
      const row = new Array(nParams).fill(0);
      row[k] = 0.5 * wN * 100;
      reg.push({ row, r: 0 });
    }
    if (opts.category === 'shell') {
      const beta = 40 * wN;
      for (let k = 0; k < scaleCols; k++) {
        const row = new Array(nParams).fill(0);
        row[k] = beta * (uniform ? scale[0] : 1);
        const cur = uniform ? scale[0] : scale[k];
        const start = uniform ? startScale[0] : startScale[k];
        reg.push({ row, r: -(cur - start) * beta * (uniform ? 1 : 1) });
      }
    }
    const J = new Float64Array((m + reg.length) * nParams);
    const r = new Float64Array(m + reg.length);
    J.set(rows);
    r.set(rhs);
    reg.forEach((g, j) => {
      J.set(g.row, (m + j) * nParams);
      r[m + j] = g.r;
    });
    const delta = leastSquares(J, r, m + reg.length, nParams, 1e-6);
    if (!delta) break;
    let maxStep = 0;
    if (offsetOnly) {
      maxStep = 0;
    } else if (uniform) {
      const f = 1 + delta[0];
      const fClamped = Math.min(1.15, Math.max(0.87, f));
      scale = [scale[0] * fClamped, scale[1] * fClamped, scale[2] * fClamped];
      maxStep = Math.abs(fClamped - 1);
    } else {
      for (let k = 0; k < 3; k++) {
        const step = Math.min(0.15, Math.max(-0.15, delta[k]));
        scale[k] = Math.min(3, Math.max(0.3, scale[k] + step));
        maxStep = Math.max(maxStep, Math.abs(step));
      }
    }
    if (direction) {
      const dOff = Math.min(40, Math.max(-40, delta[nParams - 1]));
      offset += dOff;
      maxStep = Math.max(maxStep, Math.abs(dOff) / 100);
    }
    if (maxStep < 1e-3) {
      it++;
      break;
    }
  }
  for (let k = 0; k < 12; k++) {
    const smp = evaluate(scale, offset);
    if (smp.length < 8) break;
    const c = smp.map((x) => x.clearance).sort((a, b) => a - b);
    const p2 = c[Math.floor(0.02 * (c.length - 1))];
    if (p2 >= settings.min - 0.25) break;
    const need = settings.min - p2;
    if (direction) offset += need;
    else if (!offsetOnly) {
      const f = 1 + Math.min(0.08, need / 60);
      scale = [scale[0] * f, scale[1] * f, scale[2] * f];
    } else break;
  }
  const after = clearanceStats(evaluate(scale, offset), settings);
  return { scale, offset, before, after, iterations: it };
}
