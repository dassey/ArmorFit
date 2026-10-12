import { solveLinear } from '../math/linalg';
import model from './ansur-model.json';
import {
  MEASUREMENT_KEYS,
  measurementInfo,
  type MeasurementKey,
  type Measurements,
  type ProportionPreset,
} from './schema';

interface Component {
  mean: number[];
  cov: number[][];
}

const KEYS = model.keys as MeasurementKey[];
const IDX = new Map(KEYS.map((k, i) => [k, i]));
const MALE: Component = model.male;
const FEMALE: Component = model.female;

export interface Estimate {
  values: Measurements;
  sd: Record<MeasurementKey, number>;
  masculineWeight: number;
}

interface Conditional {
  mean: number[];
  variance: number[];
  logLik: number;
}

function conditional(c: Component, known: [number, number][]): Conditional {
  const d = KEYS.length;
  if (known.length === 0) {
    return { mean: c.mean.slice(), variance: c.cov.map((r, i) => r[i]), logLik: 0 };
  }
  const k = known.length;
  const kIdx = known.map(([i]) => i);
  const diff = known.map(([i, x]) => x - c.mean[i]);
  const Skk = new Float64Array(k * k);
  for (let a = 0; a < k; a++) for (let b = 0; b < k; b++) Skk[a * k + b] = c.cov[kIdx[a]][kIdx[b]];
  const alpha = solveLinear(Skk, diff, k) ?? new Float64Array(k);
  let logDet = 0;
  {
    const L = new Float64Array(k * k);
    for (let i = 0; i < k; i++) {
      for (let j = 0; j <= i; j++) {
        let s = Skk[i * k + j];
        for (let m = 0; m < j; m++) s -= L[i * k + m] * L[j * k + m];
        if (i === j) L[i * k + i] = Math.sqrt(Math.max(s, 1e-9));
        else L[i * k + j] = s / L[j * k + j];
      }
      logDet += 2 * Math.log(L[i * k + i]);
    }
  }
  let quad = 0;
  for (let a = 0; a < k; a++) quad += diff[a] * alpha[a];
  const logLik = -0.5 * (quad + logDet);

  const mean = c.mean.slice();
  const variance = new Array(d).fill(0);
  for (let u = 0; u < d; u++) {
    if (kIdx.includes(u)) {
      mean[u] = known.find(([i]) => i === u)![1];
      continue;
    }
    let m = c.mean[u];
    for (let a = 0; a < k; a++) m += c.cov[u][kIdx[a]] * alpha[a];
    mean[u] = m;
    const col = kIdx.map((i) => c.cov[i][u]);
    const beta = solveLinear(Skk, col, k) ?? new Float64Array(k);
    let v = c.cov[u][u];
    for (let a = 0; a < k; a++) v -= c.cov[u][kIdx[a]] * beta[a];
    variance[u] = Math.max(v, 0);
  }
  return { mean, variance, logLik };
}

export function estimateMeasurements(
  known: Partial<Measurements>,
  preset: ProportionPreset = 'neutral',
): Estimate {
  const pairs: [number, number][] = [];
  for (const key of MEASUREMENT_KEYS) {
    const v = known[key];
    if (v !== undefined && Number.isFinite(v) && v > 0) pairs.push([IDX.get(key)!, v]);
  }
  const m = conditional(MALE, pairs);
  const f = conditional(FEMALE, pairs);
  let wMale: number;
  if (preset === 'masculine') wMale = 1;
  else if (preset === 'feminine') wMale = 0;
  else {
    const a = m.logLik;
    const b = f.logLik;
    const mx = Math.max(a, b);
    wMale = Math.exp(a - mx) / (Math.exp(a - mx) + Math.exp(b - mx));
  }
  const values = {} as Measurements;
  const sd = {} as Record<MeasurementKey, number>;
  KEYS.forEach((key, i) => {
    const mean = wMale * m.mean[i] + (1 - wMale) * f.mean[i];
    const variance =
      wMale * m.variance[i] +
      (1 - wMale) * f.variance[i] +
      wMale * (1 - wMale) * (m.mean[i] - f.mean[i]) ** 2;
    const info = measurementInfo(key);
    values[key] = Math.min(Math.max(mean, info.min * 0.5), info.max * 1.5);
    sd[key] = pairs.some(([j]) => j === i) ? 0 : Math.sqrt(variance);
  });
  return { values, sd, masculineWeight: wMale };
}

export function defaultMeasurements(preset: ProportionPreset = 'neutral'): Measurements {
  if (preset === 'neutral') {
    const values = {} as Measurements;
    KEYS.forEach((k, i) => (values[k] = (MALE.mean[i] + FEMALE.mean[i]) / 2));
    return values;
  }
  return estimateMeasurements({}, preset).values;
}
