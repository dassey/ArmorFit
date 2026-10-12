import { decodeRegion, encodeRegion, regionLabel, type RegionId } from '../body/regions';
import type { MeasurementKey } from '../measurements/schema';
import type { ClearanceSample } from './clearance';

export interface RegionShare {
  code: number;
  label: string;
  fraction: number;
}

export function regionTally(samples: ClearanceSample[], minShare = 0.03): RegionShare[] {
  const w = new Map<number, number>();
  let total = 0;
  for (const s of samples) {
    const weight = 1 / (1 + Math.max(0, s.clearance) / 30);
    w.set(s.region, (w.get(s.region) ?? 0) + weight);
    total += weight;
  }
  if (total === 0) return [];
  let left = 0;
  let right = 0;
  for (const [code, v] of w) {
    const side = code & 3;
    if (side === 1) left += v;
    else if (side === 2) right += v;
  }
  if (Math.min(left, right) > 0.15 * total) {
    const merged = new Map<number, number>();
    for (const [code, v] of w) {
      const c = encodeRegion(decodeRegion(code).region, 0) & ~3;
      merged.set(c, (merged.get(c) ?? 0) + v);
    }
    w.clear();
    for (const [c, v] of merged) w.set(c, v);
  }
  const shares = [...w.entries()]
    .map(([code, v]) => ({ code, label: regionLabel(code), fraction: v / total }))
    .sort((a, b) => b.fraction - a.fraction);
  const major = shares.filter((s) => s.fraction >= minShare);
  const rest = shares.filter((s) => s.fraction < minShare).reduce((a, s) => a + s.fraction, 0);
  if (rest > 0) major.push({ code: -1, label: 'Other', fraction: rest });
  return major;
}

const REGION_MEASUREMENTS: Record<RegionId, MeasurementKey[]> = {
  head: ['headCirc', 'headLength', 'headWidth'],
  neck: ['neckCirc'],
  upperChest: ['chest', 'shoulderWidth'],
  chest: ['chest'],
  abdomen: ['waist', 'torsoLength'],
  waist: ['waist'],
  upperBack: ['chest', 'shoulderWidth'],
  lowerBack: ['waist', 'torsoLength'],
  upperShoulder: ['shoulderWidth'],
  deltoid: ['shoulderWidth', 'bicepCirc'],
  upperArm: ['bicepCirc', 'upperArmLength'],
  elbow: ['bicepCirc', 'forearmCirc'],
  forearm: ['forearmCirc', 'forearmLength'],
  wrist: ['wristCirc'],
  hand: ['handLength', 'handWidth'],
  hip: ['hips'],
  thigh: ['thighCirc', 'thighLength'],
  knee: ['thighCirc', 'calfCirc'],
  shin: ['calfCirc', 'shinLength'],
  calf: ['calfCirc', 'shinLength'],
  foot: ['footLength'],
};

export function drivingMeasurements(tally: RegionShare[], minShare = 0.15): MeasurementKey[] {
  const out = new Set<MeasurementKey>();
  for (const s of tally) {
    if (s.code < 0 || s.fraction < minShare) continue;
    for (const k of REGION_MEASUREMENTS[decodeRegion(s.code).region]) out.add(k);
  }
  return [...out];
}
