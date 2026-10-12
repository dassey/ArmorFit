import { solveLinear } from '../math/linalg';
import type { MeasurementKey } from '../measurements/schema';
import type { BodyAsset, MacroParams } from './asset';
import { BodyMeasurer } from './measure';
import { macroFactors, SubsetMorpher, type BodyParams } from './morph';

export interface SolveTarget {
  value: number;
  tolerance: number;
}

export interface SolveOptions {
  gender: number;
  maxIterations?: number;
  initial?: BodyParams;
}

export interface SolveResult {
  params: BodyParams;
  measured: Partial<Record<MeasurementKey, number>>;
  errors: Partial<Record<MeasurementKey, number>>;
  iterations: number;
  cost: number;
}

interface Unknown {
  kind: 'scale' | 'macro' | 'incr' | 'decr';
  key: string;
  targets?: number[];
  lo: number;
  hi: number;
  prior: number;
  sigma: number;
}

const FIXED_CONTROLS = new Set(['m-knee-circ', 'm-ankle-circ']);

function controlSigma(id: string): number {
  if (id.startsWith('m-')) return 0.75;
  if (/-(width|depth)$/.test(id) && !id.startsWith('head') && !id.startsWith('torso')) return 0.6;
  if (id.startsWith('head-')) return 0.8;
  if (/^(hand-scale|finger-length|finger-spread|foot-scale)$/.test(id)) return 0.8;
  return 0.45;
}

function factorDerivatives(m: MacroParams, param: 'muscle' | 'weight' | 'cup'): Record<string, number> {
  const v = m[param];
  const names: Record<string, [string, string, string]> = {
    muscle: ['minmuscle', 'averagemuscle', 'maxmuscle'],
    weight: ['minweight', 'averageweight', 'maxweight'],
    cup: ['mincup', 'averagecup', 'maxcup'],
  };
  const [lo, mid, hi] = names[param];
  const dlo = v < 0.5 ? -2 : 0;
  const dhi = v >= 0.5 ? 2 : 0;
  return { [lo]: dlo, [mid]: -(dlo + dhi), [hi]: dhi };
}

export class BodySolver {
  readonly measurer: BodyMeasurer;
  readonly morpher: SubsetMorpher;
  private readonly unknowns: Unknown[];

  constructor(private readonly asset: BodyAsset) {
    this.measurer = new BodyMeasurer(asset.header);
    this.morpher = new SubsetMorpher(asset, this.measurer.requiredVertices());
    const u: Unknown[] = [
      { kind: 'scale', key: 'scale', lo: 0.55, hi: 1.6, prior: 1, sigma: 10 },
      { kind: 'macro', key: 'muscle', lo: 0, hi: 1, prior: 0.5, sigma: 0.6 },
      { kind: 'macro', key: 'weight', lo: 0, hi: 1, prior: 0.5, sigma: 0.6 },
      { kind: 'macro', key: 'cup', lo: 0, hi: 1, prior: 0.5, sigma: 0.5 },
    ];
    for (const c of asset.header.controls) {
      if (FIXED_CONTROLS.has(c.id)) continue;
      const sigma = controlSigma(c.id);
      const ids = (names: string[]) => names.map((nm) => asset.targetByName.get(nm)!);
      u.push({ kind: 'incr', key: c.id, lo: 0, hi: 2, prior: 0, sigma, targets: ids(c.incr) });
      u.push({ kind: 'decr', key: c.id, lo: 0, hi: 2, prior: 0, sigma, targets: ids(c.decr) });
    }
    this.unknowns = u;
    const pos0 = this.morpher.positions({ macro: { ...asset.header.defaultMacro }, controls: {}, scale: 1 });
    this.measurer.freezePlanes((v) => {
      const s = this.morpher.slot(v) * 3;
      return [pos0[s], pos0[s + 1], pos0[s + 2]];
    });
  }

  private toParams(x: Float64Array, gender: number): BodyParams {
    const p: BodyParams = { macro: { gender, muscle: 0.5, weight: 0.5, cup: 0.5 }, controls: {}, scale: 1 };
    this.unknowns.forEach((u, i) => {
      if (u.kind === 'scale') p.scale = x[i];
      else if (u.kind === 'macro') (p.macro as unknown as Record<string, number>)[u.key] = x[i];
      else if (u.kind === 'incr') p.controls[u.key] = (p.controls[u.key] ?? 0) + x[i];
      else p.controls[u.key] = (p.controls[u.key] ?? 0) - x[i];
    });
    return p;
  }

  private fromParams(p: BodyParams): Float64Array {
    return Float64Array.from(this.unknowns, (u) => {
      if (u.kind === 'scale') return p.scale;
      if (u.kind === 'macro') return (p.macro as unknown as Record<string, number>)[u.key];
      const c = p.controls[u.key] ?? 0;
      return u.kind === 'incr' ? Math.max(c, 0) : Math.max(-c, 0);
    });
  }

  private getter(pos: Float64Array) {
    return (v: number): [number, number, number] => {
      const s = this.morpher.slot(v) * 3;
      return [pos[s], pos[s + 1], pos[s + 2]];
    };
  }

  measureParams(p: BodyParams): Partial<Record<MeasurementKey, number>> {
    return this.measurer.measure(this.getter(this.morpher.positions(p)));
  }

  solve(targets: Partial<Record<MeasurementKey, SolveTarget>>, opts: SolveOptions): SolveResult {
    const keys = (Object.keys(targets) as MeasurementKey[]).filter((k) => Number.isFinite(targets[k]!.value));
    const n = this.unknowns.length;
    const m = keys.length;
    const nT = this.asset.targets.length;
    const csr = this.morpher.slotTargets();

    let x = opts.initial ? this.fromParams(opts.initial) : Float64Array.from(this.unknowns, (u) => u.prior);
    for (let j = 1; j <= 3; j++) if (x[j] === 0.5) x[j] = 0.5005;
    if (!opts.initial && targets.height) {
      const h0 = this.measureParams(this.toParams(x, opts.gender)).height!;
      x[0] = targets.height.value / h0;
    }
    const clamp = (xv: Float64Array) => {
      this.unknowns.forEach((u, j) => (xv[j] = Math.min(u.hi, Math.max(u.lo, xv[j]))));
      return xv;
    };
    const residualsOf = (xv: Float64Array, measured: Partial<Record<MeasurementKey, number>>) => {
      const r = new Float64Array(m + n);
      keys.forEach((k, i) => (r[i] = (measured[k]! - targets[k]!.value) / targets[k]!.tolerance));
      this.unknowns.forEach((u, j) => (r[m + j] = (xv[j] - u.prior) / u.sigma));
      return r;
    };
    const costOf = (r: Float64Array) => r.reduce((s, v) => s + v * v, 0);

    let evalRes = this.measurer.measureWithGradient(
      this.getter(this.morpher.positions(this.toParams(x, opts.gender))),
    );
    let r = residualsOf(x, evalRes.values);
    let cost = costOf(r);
    let lambda = 1e-3;
    const maxIt = opts.maxIterations ?? 40;
    let it = 0;
    let converged = false;
    const E = new Float64Array(m * nT);
    for (; it < maxIt && !converged; it++) {
      const p = this.toParams(x, opts.gender);
      const s = p.scale;
      E.fill(0);
      keys.forEach((k, ki) => {
        const g = evalRes.gradients[k] ?? [];
        for (let e = 0; e < g.length; e += 4) {
          const slot = this.morpher.slot(g[e]);
          for (let q = csr.start[slot]; q < csr.start[slot + 1]; q++) {
            E[ki * nT + csr.t[q]] +=
              s * (g[e + 1] * csr.d[q * 3] + g[e + 2] * csr.d[q * 3 + 1] + g[e + 3] * csr.d[q * 3 + 2]);
          }
        }
      });
      const J = new Float64Array(m * n);
      const f = macroFactors(p.macro);
      for (let j = 0; j < n; j++) {
        const u = this.unknowns[j];
        for (let ki = 0; ki < m; ki++) {
          let d = 0;
          if (u.kind === 'scale') d = evalRes.values[keys[ki]]! / s;
          else if (u.kind === 'incr' || u.kind === 'decr') for (const t of u.targets!) d += E[ki * nT + t];
          else {
            const df = factorDerivatives(p.macro, u.key as 'muscle' | 'weight' | 'cup');
            this.asset.targets.forEach((t, ti) => {
              if (!t.factors) return;
              let dw = 0;
              for (let a = 0; a < t.factors.length; a++) {
                const da = df[t.factors[a]];
                if (!da) continue;
                let prod = da;
                for (let b = 0; b < t.factors.length; b++) if (b !== a) prod *= f[t.factors[b]] ?? 0;
                dw += prod;
              }
              if (dw) d += dw * E[ki * nT + ti];
            });
          }
          J[ki * n + j] = d / targets[keys[ki]]!.tolerance;
        }
      }
      const A = new Float64Array(n * n);
      const g = new Float64Array(n);
      for (let i = 0; i < m; i++) {
        const ri = r[i];
        for (let a = 0; a < n; a++) {
          const ja = J[i * n + a];
          if (ja === 0) continue;
          g[a] += ja * ri;
          for (let b = a; b < n; b++) A[a * n + b] += ja * J[i * n + b];
        }
      }
      for (let a = 0; a < n; a++) {
        const w = 1 / this.unknowns[a].sigma;
        A[a * n + a] += w * w;
        g[a] += w * r[m + a];
        for (let b = 0; b < a; b++) A[a * n + b] = A[b * n + a];
      }

      const frozen = new Uint8Array(n);
      this.unknowns.forEach((u, j) => {
        if ((x[j] <= u.lo + 1e-9 && g[j] > 0) || (x[j] >= u.hi - 1e-9 && g[j] < 0)) frozen[j] = 1;
      });
      let improved = false;
      for (let tries = 0; tries < 12; tries++) {
        const M = Float64Array.from(A);
        const rhs = g.map((v) => -v);
        for (let a = 0; a < n; a++) M[a * n + a] += lambda * A[a * n + a];
        for (let a = 0; a < n; a++) {
          if (!frozen[a]) continue;
          for (let b = 0; b < n; b++) {
            M[a * n + b] = 0;
            M[b * n + a] = 0;
          }
          M[a * n + a] = 1;
          rhs[a] = 0;
        }
        const delta = solveLinear(M, rhs, n);
        if (!delta) {
          lambda *= 10;
          continue;
        }
        const xn = clamp(Float64Array.from(x, (v, j) => v + delta[j]));
        const pn = this.morpher.positions(this.toParams(xn, opts.gender));
        const en = this.measurer.measureWithGradient(this.getter(pn));
        const rn = residualsOf(xn, en.values);
        const cn = costOf(rn);
        if (cn < cost) {
          const rel = (cost - cn) / Math.max(cost, 1e-12);
          x = xn;
          evalRes = en;
          r = rn;
          cost = cn;
          lambda = Math.max(lambda / 4, 1e-9);
          improved = true;
          if (rel < 1e-4) converged = true;
          break;
        }
        lambda *= 4;
      }
      if (!improved) break;
    }

    const params = this.toParams(x, opts.gender);
    const errors: Partial<Record<MeasurementKey, number>> = {};
    for (const k of keys) errors[k] = evalRes.values[k]! - targets[k]!.value;
    return { params, measured: evalRes.values, errors, iterations: it, cost };
  }
}
