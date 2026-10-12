import { describe, expect, it } from 'vitest';
import { defaultMeasurements, estimateMeasurements } from './estimate';
import {
  clearMeasurement,
  type MeasurementProfile,
  newProfile,
  parseProfile,
  ProfileError,
  serializeProfile,
  setMeasurement,
} from './profile';
import { MEASUREMENTS, MEASUREMENT_KEYS, QUICK_KEYS } from './schema';
import { formatLength, fromMm, toMm } from '../units';

describe('units', () => {
  it('converts cm/in to mm and back', () => {
    expect(toMm(10, 'cm')).toBe(100);
    expect(toMm(1, 'in')).toBeCloseTo(25.4, 10);
    expect(fromMm(254, 'in')).toBeCloseTo(10, 10);
    expect(formatLength(1755, 'cm')).toBe('175.5 cm');
    expect(formatLength(254, 'in')).toBe('10.00 in');
  });
});

describe('estimateMeasurements', () => {
  const quick = { height: 1800, chest: 1000, waist: 850, headCirc: 580 };

  it('returns known values unchanged with zero uncertainty', () => {
    const e = estimateMeasurements(quick, 'masculine');
    for (const [k, v] of Object.entries(quick)) {
      expect(e.values[k as keyof typeof quick]).toBe(v);
      expect(e.sd[k as keyof typeof quick]).toBe(0);
    }
  });

  it('produces plausible values for an average-build man', () => {
    const e = estimateMeasurements(quick, 'masculine').values;
    expect(e.shoulderWidth).toBeGreaterThan(390);
    expect(e.shoulderWidth).toBeLessThan(440);
    expect(e.neckCirc).toBeGreaterThan(360);
    expect(e.neckCirc).toBeLessThan(420);
    expect(e.upperArmLength).toBeGreaterThan(325);
    expect(e.upperArmLength).toBeLessThan(370);
    expect(e.headLength).toBeGreaterThan(190);
    expect(e.headLength).toBeLessThan(212);
  });

  it('every estimate stays inside the plausible range', () => {
    for (const preset of ['neutral', 'masculine', 'feminine'] as const) {
      const e = estimateMeasurements({ height: 1650, chest: 900, waist: 760, headCirc: 550 }, preset).values;
      for (const m of MEASUREMENTS) {
        expect(e[m.key]).toBeGreaterThan(m.min);
        expect(e[m.key]).toBeLessThan(m.max);
      }
    }
  });

  it('limb lengths are well determined by height', () => {
    const e = estimateMeasurements({ height: 1750 }, 'masculine');
    expect(e.sd.forearmLength).toBeLessThan(15);
    expect(e.sd.upperArmLength).toBeLessThan(16);
    expect(e.sd.headCirc).toBeGreaterThan(12);
  });

  it('is monotonic in height for lengths', () => {
    const a = estimateMeasurements({ height: 1600 }, 'neutral').values;
    const b = estimateMeasurements({ height: 1900 }, 'neutral').values;
    for (const k of ['upperArmLength', 'forearmLength', 'thighLength', 'shinLength', 'footLength'] as const) {
      expect(b[k]).toBeGreaterThan(a[k]);
    }
  });

  it('neutral preset infers the more likely body pattern from the inputs', () => {
    const masc = estimateMeasurements({ height: 1830, chest: 1080, waist: 920, neckCirc: 410 }, 'neutral');
    const fem = estimateMeasurements(
      { height: 1620, chest: 900, waist: 740, hips: 1040, neckCirc: 320 },
      'neutral',
    );
    expect(masc.masculineWeight).toBeGreaterThan(0.9);
    expect(fem.masculineWeight).toBeLessThan(0.1);
  });

  it('feminine preset predicts narrower shoulders than masculine for the same inputs', () => {
    const f = estimateMeasurements({ height: 1700, chest: 950, waist: 800 }, 'feminine').values;
    const m = estimateMeasurements({ height: 1700, chest: 950, waist: 800 }, 'masculine').values;
    expect(f.shoulderWidth).toBeLessThan(m.shoulderWidth);
    expect(f.neckCirc).toBeLessThan(m.neckCirc);
  });

  it('default measurements are complete and finite', () => {
    const d = defaultMeasurements();
    for (const k of MEASUREMENT_KEYS) expect(Number.isFinite(d[k])).toBe(true);
  });
});

describe('measurement profile', () => {
  it('starts in quick mode with only quick fields as inputs', () => {
    const p = newProfile();
    expect(p.mode).toBe('quick');
    expect(QUICK_KEYS).toEqual(['height', 'chest', 'waist', 'headCirc']);
  });

  it('re-estimates dependent fields when a quick value changes', () => {
    let p = newProfile();
    const before = p.values.upperArmLength;
    p = setMeasurement(p, 'height', 1950);
    expect(p.values.height).toBe(1950);
    expect(p.values.upperArmLength).toBeGreaterThan(before);
    expect(p.userSet).toContain('height');
  });

  it('detailed-mode overrides are kept and cleared on request', () => {
    let p: MeasurementProfile = { ...newProfile(), mode: 'detailed' };
    p = setMeasurement(p, 'bicepCirc', 420);
    expect(p.values.bicepCirc).toBe(420);
    p = clearMeasurement(p, 'bicepCirc');
    expect(p.values.bicepCirc).not.toBe(420);
  });

  it('round-trips through JSON', () => {
    let p = setMeasurement(newProfile(), 'height', 1720);
    p = { ...p, displayUnit: 'in', undergarment: 'foam' };
    const back = parseProfile(serializeProfile(p));
    expect(back.values.height).toBe(1720);
    expect(back.displayUnit).toBe('in');
    expect(back.undergarment).toBe('foam');
    expect(back.userSet).toEqual(['height']);
  });

  it('rejects files that are not ArmorFit measurements', () => {
    expect(() => parseProfile('nope')).toThrow(ProfileError);
    expect(() => parseProfile('{"kind":"other"}')).toThrow(/not an ArmorFit/);
    expect(() => parseProfile('{"kind":"armorfit-measurements","version":99}')).toThrow(/newer/);
  });
});
