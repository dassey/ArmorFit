import type { DisplayUnit } from '../units';
import { estimateMeasurements } from './estimate';
import {
  MEASUREMENT_KEYS,
  QUICK_KEYS,
  type MeasurementKey,
  type Measurements,
  type ProportionPreset,
  type Undergarment,
} from './schema';

export interface MeasurementProfile {
  values: Measurements;
  userSet: MeasurementKey[];
  mode: 'quick' | 'detailed';
  preset: ProportionPreset;
  displayUnit: DisplayUnit;
  undergarment: Undergarment;
}

const KIND = 'armorfit-measurements';
const VERSION = 1;

export function knownKeys(p: Pick<MeasurementProfile, 'userSet' | 'mode'>): MeasurementKey[] {
  return p.mode === 'quick' ? p.userSet.filter((k) => QUICK_KEYS.includes(k)) : p.userSet;
}

export function recomputeProfile(p: MeasurementProfile): MeasurementProfile {
  const known: Partial<Measurements> = {};
  for (const k of knownKeys(p)) known[k] = p.values[k];
  const est = estimateMeasurements(known, p.preset);
  const values = { ...est.values };
  for (const k of knownKeys(p)) values[k] = p.values[k];
  return { ...p, values };
}

export function newProfile(): MeasurementProfile {
  return recomputeProfile({
    values: estimateMeasurements({}, 'neutral').values,
    userSet: [],
    mode: 'quick',
    preset: 'neutral',
    displayUnit: 'cm',
    undergarment: 'none',
  });
}

export function setMeasurement(p: MeasurementProfile, key: MeasurementKey, mm: number): MeasurementProfile {
  const userSet = p.userSet.includes(key) ? p.userSet : [...p.userSet, key];
  return recomputeProfile({ ...p, userSet, values: { ...p.values, [key]: mm } });
}

export function clearMeasurement(p: MeasurementProfile, key: MeasurementKey): MeasurementProfile {
  return recomputeProfile({ ...p, userSet: p.userSet.filter((k) => k !== key) });
}

export function serializeProfile(p: MeasurementProfile): string {
  return JSON.stringify(
    {
      kind: KIND,
      version: VERSION,
      units: 'mm',
      mode: p.mode,
      preset: p.preset,
      displayUnit: p.displayUnit,
      undergarment: p.undergarment,
      userSet: p.userSet,
      values: Object.fromEntries(MEASUREMENT_KEYS.map((k) => [k, Math.round(p.values[k] * 10) / 10])),
    },
    null,
    2,
  );
}

export class ProfileError extends Error {}

export function parseProfile(json: string): MeasurementProfile {
  let data: any;
  try {
    data = JSON.parse(json);
  } catch {
    throw new ProfileError('This file is not valid JSON.');
  }
  if (!data || typeof data !== 'object') throw new ProfileError('Unexpected file contents.');
  if (data.kind === 'armorfit-project' && data.measurements) data = data.measurements;
  if (data.kind !== KIND) throw new ProfileError('This is not an ArmorFit measurements file.');
  if (typeof data.version !== 'number' || data.version > VERSION) {
    throw new ProfileError('This file was made by a newer version of ArmorFit.');
  }
  const base = newProfile();
  const values = { ...base.values };
  const userSet: MeasurementKey[] = [];
  for (const k of MEASUREMENT_KEYS) {
    const v = data.values?.[k];
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) values[k] = v;
  }
  if (Array.isArray(data.userSet)) {
    for (const k of data.userSet) if ((MEASUREMENT_KEYS as string[]).includes(k)) userSet.push(k);
  }
  return recomputeProfile({
    values,
    userSet,
    mode: data.mode === 'detailed' ? 'detailed' : 'quick',
    preset: ['neutral', 'masculine', 'feminine'].includes(data.preset) ? data.preset : 'neutral',
    displayUnit: data.displayUnit === 'in' ? 'in' : 'cm',
    undergarment: ['none', 'bodysuit', 'foam'].includes(data.undergarment) ? data.undergarment : 'none',
  });
}
