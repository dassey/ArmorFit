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
  opts: { declared?: FileUnit; expectedSizeMm?: number } = {},
): UnitGuess {
  const expected = opts.expectedSizeMm ?? 280;
  const sigma = opts.expectedSizeMm ? 0.35 : 0.75;
  const like = (mm: number) => {
    const z = Math.log(mm / expected) / sigma;
    return Math.exp(-0.5 * z * z);
  };

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
  if (mmSize < expected * 0.45) {
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
