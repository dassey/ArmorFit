import type { BodyAsset, MacroParams } from './asset';

export interface BodyParams {
  macro: MacroParams;
  controls: Record<string, number>;
  scale: number;
}

export function defaultParams(asset: BodyAsset): BodyParams {
  return { macro: { ...asset.header.defaultMacro }, controls: {}, scale: 1 };
}

export function macroFactors(m: MacroParams): Record<string, number> {
  const tri = (v: number, lo: string, mid: string, hi: string) => {
    const a = Math.max(0, 1 - 2 * v);
    const c = Math.max(0, 2 * v - 1);
    return { [lo]: a, [mid]: 1 - a - c, [hi]: c };
  };
  return {
    female: 1 - m.gender,
    male: m.gender,
    ...tri(m.muscle, 'minmuscle', 'averagemuscle', 'maxmuscle'),
    ...tri(m.weight, 'minweight', 'averageweight', 'maxweight'),
    ...tri(m.cup, 'mincup', 'averagecup', 'maxcup'),
  };
}

export function targetWeights(asset: BodyAsset, p: BodyParams): Float64Array {
  const w = new Float64Array(asset.targets.length);
  const f = macroFactors(p.macro);
  asset.targets.forEach((t, i) => {
    if (t.factors) w[i] = t.factors.reduce((acc, k) => acc * (f[k] ?? 0), 1);
  });
  for (const c of asset.header.controls) {
    const x = p.controls[c.id] ?? 0;
    if (x === 0) continue;
    for (const name of x < 0 ? c.decr : c.incr) w[asset.targetByName.get(name)!] += Math.abs(x);
  }
  return w;
}

export function morph(asset: BodyAsset, p: BodyParams, out?: Float32Array): Float32Array {
  const pos = out ?? new Float32Array(asset.base.length);
  pos.set(asset.base);
  const w = targetWeights(asset, p);
  for (let t = 0; t < w.length; t++) {
    const wt = w[t];
    if (wt === 0) continue;
    const { indices, deltas } = asset.targets[t];
    for (let k = 0; k < indices.length; k++) {
      const v = indices[k] * 3;
      pos[v] += deltas[k * 3] * wt;
      pos[v + 1] += deltas[k * 3 + 1] * wt;
      pos[v + 2] += deltas[k * 3 + 2] * wt;
    }
  }
  if (p.scale !== 1) for (let i = 0; i < pos.length; i++) pos[i] *= p.scale;
  return pos;
}

export class SubsetMorpher {
  readonly vertices: Uint32Array;
  private readonly local: Map<number, number>;
  private readonly baseSub: Float64Array;
  private readonly tSub: { idx: Uint32Array; d: Float64Array }[];

  constructor(
    private readonly asset: BodyAsset,
    vertices: Iterable<number>,
  ) {
    this.vertices = Uint32Array.from(new Set(vertices));
    this.local = new Map(Array.from(this.vertices, (v, i) => [v, i]));
    this.baseSub = new Float64Array(this.vertices.length * 3);
    this.vertices.forEach((v, i) => {
      this.baseSub[i * 3] = asset.base[v * 3];
      this.baseSub[i * 3 + 1] = asset.base[v * 3 + 1];
      this.baseSub[i * 3 + 2] = asset.base[v * 3 + 2];
    });
    this.tSub = asset.targets.map((t) => {
      const idx: number[] = [];
      const d: number[] = [];
      for (let k = 0; k < t.indices.length; k++) {
        const li = this.local.get(t.indices[k]);
        if (li === undefined) continue;
        idx.push(li);
        d.push(t.deltas[k * 3], t.deltas[k * 3 + 1], t.deltas[k * 3 + 2]);
      }
      return { idx: Uint32Array.from(idx), d: Float64Array.from(d) };
    });
  }

  positions(p: BodyParams, out?: Float64Array): Float64Array {
    const pos = out ?? new Float64Array(this.baseSub.length);
    pos.set(this.baseSub);
    const w = targetWeights(this.asset, p);
    for (let t = 0; t < w.length; t++) {
      const wt = w[t];
      if (wt === 0) continue;
      const { idx, d } = this.tSub[t];
      for (let k = 0; k < idx.length; k++) {
        const v = idx[k] * 3;
        pos[v] += d[k * 3] * wt;
        pos[v + 1] += d[k * 3 + 1] * wt;
        pos[v + 2] += d[k * 3 + 2] * wt;
      }
    }
    if (p.scale !== 1) for (let i = 0; i < pos.length; i++) pos[i] *= p.scale;
    return pos;
  }

  private csr?: { start: Uint32Array; t: Uint16Array; d: Float64Array };

  slotTargets(): { start: Uint32Array; t: Uint16Array; d: Float64Array } {
    if (this.csr) return this.csr;
    const nSlots = this.vertices.length;
    const counts = new Uint32Array(nSlots + 1);
    for (const { idx } of this.tSub) for (const v of idx) counts[v + 1]++;
    for (let i = 0; i < nSlots; i++) counts[i + 1] += counts[i];
    const fill = counts.slice(0, nSlots);
    const total = counts[nSlots];
    const t = new Uint16Array(total);
    const d = new Float64Array(total * 3);
    this.tSub.forEach(({ idx, d: dd }, ti) => {
      for (let k = 0; k < idx.length; k++) {
        const pos = fill[idx[k]]++;
        t[pos] = ti;
        d[pos * 3] = dd[k * 3];
        d[pos * 3 + 1] = dd[k * 3 + 1];
        d[pos * 3 + 2] = dd[k * 3 + 2];
      }
    });
    this.csr = { start: counts, t, d };
    return this.csr;
  }

  addTarget(pos: Float64Array, t: number, factor: number): void {
    const { idx, d } = this.tSub[t];
    for (let k = 0; k < idx.length; k++) {
      const v = idx[k] * 3;
      pos[v] += d[k * 3] * factor;
      pos[v + 1] += d[k * 3 + 1] * factor;
      pos[v + 2] += d[k * 3 + 2] * factor;
    }
  }

  slot(v: number): number {
    const s = this.local.get(v);
    if (s === undefined) throw new Error(`vertex ${v} not in subset`);
    return s;
  }
}
