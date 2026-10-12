export const REGIONS = [
  'head',
  'neck',
  'upperChest',
  'chest',
  'abdomen',
  'waist',
  'upperBack',
  'lowerBack',
  'upperShoulder',
  'deltoid',
  'upperArm',
  'elbow',
  'forearm',
  'wrist',
  'hand',
  'hip',
  'thigh',
  'knee',
  'shin',
  'calf',
  'foot',
] as const;

export type RegionId = (typeof REGIONS)[number];
export type RegionSide = 0 | 1 | 2;

export const REGION_LABELS: Record<RegionId, string> = {
  head: 'Head',
  neck: 'Neck',
  upperChest: 'Upper chest',
  chest: 'Chest',
  abdomen: 'Abdomen',
  waist: 'Waist',
  upperBack: 'Upper back',
  lowerBack: 'Lower back',
  upperShoulder: 'Upper shoulder',
  deltoid: 'Deltoid',
  upperArm: 'Upper arm',
  elbow: 'Elbow',
  forearm: 'Forearm',
  wrist: 'Wrist',
  hand: 'Hand',
  hip: 'Hip',
  thigh: 'Thigh',
  knee: 'Knee',
  shin: 'Shin',
  calf: 'Calf',
  foot: 'Foot',
};

const MIDLINE: ReadonlySet<RegionId> = new Set(['head', 'neck']);

const INDEX = new Map(REGIONS.map((r, i) => [r, i]));

export function regionIndex(r: RegionId): number {
  return INDEX.get(r)!;
}

export function encodeRegion(r: RegionId, side: RegionSide): number {
  return (regionIndex(r) << 2) | (MIDLINE.has(r) ? 0 : side);
}

export function decodeRegion(code: number): { region: RegionId; side: RegionSide } {
  return { region: REGIONS[code >> 2], side: (code & 3) as RegionSide };
}

export function sideOfX(x: number): RegionSide {
  return x >= 0 ? 1 : 2;
}

export function regionLabel(code: number): string {
  const { region, side } = decodeRegion(code);
  const base = REGION_LABELS[region];
  return side === 1 ? `${base} (L)` : side === 2 ? `${base} (R)` : base;
}

export function regionColor(code: number): [number, number, number] {
  const { region, side } = decodeRegion(code);
  const i = regionIndex(region);
  const h = ((i * 137.508) % 360) / 360;
  const l = side === 2 ? 0.42 : side === 1 ? 0.62 : 0.52;
  return hslToRgb(h, 0.55, l);
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const k = (n: number) => (n + h * 12) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [f(0), f(8), f(4)];
}
