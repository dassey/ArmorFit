import { MM_PER, type FileUnit } from '../units';

export interface UnitCandidate {
  scale: number;
  label: string;
  unit: FileUnit | 'scaled';
  probability: number;
  sizeMm: number;
}

export interface UnitGuess {
  best: UnitCandidate;
  candidates: UnitCandidate[];
  needsConfirmation: boolean;
  reason: string;
}

const PRIOR: Record<FileUnit, number> = { mm: 0.82, in: 0.07, cm: 0.07, m: 0.04 };

export function guessUnits(
  maxDimension: number,
  opts: { declared?: FileUnit; expectedSizeMm?: number; detail?: boolean } = {},
): UnitGuess {
  const typed = !!opts.expectedSizeMm && !opts.detail;
  const expected = typed ? opts.expectedSizeMm! : 200;
  const like = (mm: number) => sizeLikelihood(mm, typed ? expected : undefined);

  if (opts.declared) {
    const s = MM_PER[opts.declared];
    const c: UnitCandidate = {
      scale: s,
      label: `${opts.declared} (declared by the file)`,
      unit: opts.declared,
      probability: 1,
      sizeMm: maxDimension * s,
    };
    const plausible = like(c.sizeMm) > 0.05;
    return {
      best: c,
      candidates: [c],
      needsConfirmation: !plausible,
      reason: plausible
        ? 'The file declares its unit.'
        : `The file declares ${opts.declared}, but the piece would be ${Math.round(c.sizeMm)} mm across, which is unusual.`,
    };
  }

  const cands: UnitCandidate[] = (Object.keys(PRIOR) as FileUnit[]).map((u) => {
    const mm = maxDimension * MM_PER[u];
    return { scale: MM_PER[u], label: u, unit: u, probability: PRIOR[u] * like(mm), sizeMm: mm };
  });
  const mmSize = maxDimension;
  if (typed && mmSize < expected * 0.45) {
    for (const f of [2, 4, 5, 10]) {
      const mm = mmSize * f;
      cands.push({
        scale: f,
        label: `mm, shipped at ${Math.round(100 / f)} % scale (×${f})`,
        unit: 'scaled',
        probability: 0.02 * like(mm),
        sizeMm: mm,
      });
    }
  }
  const total = cands.reduce((s, c) => s + c.probability, 0) || 1;
  for (const c of cands) c.probability /= total;
  cands.sort((a, b) => b.probability - a.probability);
  const best = cands[0];
  const needsConfirmation = best.unit !== 'mm' || best.probability < 0.8;
  const reason =
    best.unit === 'mm' && !needsConfirmation
      ? `${Math.round(best.sizeMm)} mm across looks like a normal armor piece in millimetres.`
      : `At ${Math.round(maxDimension * 100) / 100} file units across, the most plausible reading is ${best.label} (${Math.round(best.sizeMm)} mm). Please confirm.`;
  return { best, candidates: cands, needsConfirmation, reason };
}

function lognormal(mm: number, center: number, sigma: number): number {
  const z = Math.log(Math.max(mm, 1e-9) / center) / sigma;
  return Math.exp(-0.5 * z * z);
}

export function sizeLikelihood(mm: number, typicalMm?: number): number {
  const broad = lognormal(mm, 200, 1);
  return typicalMm ? 0.3 * broad + 0.7 * lognormal(mm, typicalMm, 0.5) : broad;
}

export function guessSetUnits(pieces: { maxDimension: number; typicalMm?: number }[]): UnitGuess {
  const units = Object.keys(PRIOR) as FileUnit[];
  const logp = units.map((u) => {
    let l = Math.log(PRIOR[u]);
    for (const p of pieces) l += Math.log(sizeLikelihood(p.maxDimension * MM_PER[u], p.typicalMm) + 1e-12);
    return l;
  });
  const top = Math.max(...logp);
  const w = logp.map((l) => Math.exp(l - top));
  const total = w.reduce((a, b) => a + b, 0);
  const biggest = Math.max(...pieces.map((p) => p.maxDimension));
  const cands: UnitCandidate[] = units
    .map((u, i) => ({
      scale: MM_PER[u],
      label: u,
      unit: u,
      probability: w[i] / total,
      sizeMm: biggest * MM_PER[u],
    }))
    .sort((a, b) => b.probability - a.probability);
  const best = cands[0];
  const needsConfirmation = best.unit !== 'mm' || best.probability < 0.8;
  return {
    best,
    candidates: cands,
    needsConfirmation,
    reason: needsConfirmation
      ? `These ${pieces.length} files look like one set in ${best.label}. Please confirm.`
      : `These ${pieces.length} files look like one set in millimetres.`,
  };
}
