export type DisplayUnit = 'cm' | 'in';

export type FileUnit = 'mm' | 'cm' | 'm' | 'in';

export const MM_PER: Record<FileUnit | DisplayUnit, number> = {
  mm: 1,
  cm: 10,
  m: 1000,
  in: 25.4,
};

export function toMm(value: number, unit: FileUnit | DisplayUnit): number {
  return value * MM_PER[unit];
}

export function fromMm(mm: number, unit: FileUnit | DisplayUnit): number {
  return mm / MM_PER[unit];
}

export function formatLength(mm: number, unit: DisplayUnit, withUnit = true): string {
  const v = fromMm(mm, unit);
  const decimals = unit === 'cm' ? 1 : 2;
  const s = Number.isFinite(v) ? v.toFixed(decimals) : '—';
  return withUnit ? `${s} ${unit}` : s;
}

export function formatMm(mm: number, decimals = 1): string {
  return `${mm.toFixed(decimals)} mm`;
}
