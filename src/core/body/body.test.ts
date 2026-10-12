import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { v3 } from '../math/linalg';
import { estimateMeasurements } from '../measurements/estimate';
import { newProfile, setMeasurement, type MeasurementProfile } from '../measurements/profile';
import { MEASUREMENT_KEYS } from '../measurements/schema';
import { parseBodyAsset, type BodyAsset } from './asset';
import { MannequinBuilder } from './mannequin';
import { defaultParams } from './morph';
import { decodeRegion, REGIONS } from './regions';

let asset: BodyAsset;
let builder: MannequinBuilder;

beforeAll(() => {
  asset = parseBodyAsset(readFileSync('public/assets/body/hm08.armorfit.bin.gz'));
  builder = new MannequinBuilder(asset);
});

function profileFor(
  preset: 'masculine' | 'feminine' | 'neutral',
  known: Record<string, number>,
): MeasurementProfile {
  let p: MeasurementProfile = { ...newProfile(), preset, mode: 'detailed' };
  for (const [k, v] of Object.entries(known)) p = setMeasurement(p, k as never, v);
  return p;
}

describe('body asset', () => {
  it('parses the MakeHuman hm08 asset', () => {
    expect(asset.header.bodyVertexCount).toBe(13380);
    expect(asset.indices.length / 3).toBe(asset.header.triangleCount);
    expect(asset.header.credits).toMatch(/CC0/);
    expect(asset.targets.length).toBeGreaterThan(100);
  });

  it('labels every vertex with a valid region, all regions present on both sides', () => {
    const seen = new Set<string>();
    for (let i = 0; i < asset.regions.length; i++) {
      const { region, side } = decodeRegion(asset.regions[i]);
      expect(REGIONS).toContain(region);
      seen.add(`${region}:${side}`);
    }
    for (const r of REGIONS) {
      if (r === 'head' || r === 'neck') expect(seen.has(`${r}:0`)).toBe(true);
      else {
        expect(seen.has(`${r}:1`), `${r} left`).toBe(true);
        expect(seen.has(`${r}:2`), `${r} right`).toBe(true);
      }
    }
  });

  it('region labels are left/right symmetric (off the midline)', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < asset.regions.length; i++) {
      if (Math.abs(asset.base[i * 3]) < 0.5) continue;
      const { region, side } = decodeRegion(asset.regions[i]);
      const key = `${region}:${side}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const r of REGIONS) {
      const l = counts.get(`${r}:1`) ?? 0;
      const rr = counts.get(`${r}:2`) ?? 0;
      expect(Math.abs(l - rr)).toBeLessThanOrEqual(Math.max(3, 0.05 * Math.max(l, rr)));
    }
  });

  it('measures the default body plausibly', () => {
    const m = builder.solver.measureParams(defaultParams(asset));
    expect(m.height).toBeGreaterThan(1600);
    expect(m.height).toBeLessThan(1720);
    expect(m.chest).toBeGreaterThan(800);
    expect(m.headCirc).toBeGreaterThan(500);
  });
});

describe('measurement solver', () => {
  const cases: [string, 'masculine' | 'feminine', Record<string, number>][] = [
    ['average man', 'masculine', estimateMeasurements({}, 'masculine').values],
    ['average woman', 'feminine', estimateMeasurements({}, 'feminine').values],
    [
      'tall heavier man',
      'masculine',
      estimateMeasurements({ height: 1930, chest: 1180, waist: 1050, headCirc: 600 }, 'masculine').values,
    ],
    [
      'petite woman',
      'feminine',
      estimateMeasurements({ height: 1540, chest: 840, waist: 680, headCirc: 540 }, 'feminine').values,
    ],
  ];
  for (const [label, preset, values] of cases) {
    it(`fits ${label} within tolerance`, () => {
      const profile = profileFor(preset, values);
      const t0 = performance.now();
      const man = builder.build(profile);
      const ms = performance.now() - t0;
      for (const k of MEASUREMENT_KEYS) {
        const err = Math.abs(man.measured[k]! - values[k]);
        expect(err, `${k}: ${man.measured[k]} vs ${values[k]}`).toBeLessThan(Math.max(4, values[k] * 0.015));
      }
      expect(ms).toBeLessThan(2000);
    });
  }

  it('warm start makes small edits fast', () => {
    let p = profileFor('masculine', estimateMeasurements({}, 'masculine').values);
    builder.build(p);
    p = setMeasurement(p, 'chest', p.values.chest + 20);
    const t0 = performance.now();
    const man = builder.build(p);
    expect(performance.now() - t0).toBeLessThan(400);
    expect(Math.abs(man.measured.chest! - p.values.chest)).toBeLessThan(3);
  });
});

describe('posed mannequin', () => {
  it('stands on the floor at the requested height with straight arms', () => {
    const profile = profileFor('neutral', { height: 1750, chest: 980, waist: 850, headCirc: 570 });
    const man = builder.build(profile);
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 1; i < man.positions.length; i += 3) {
      minY = Math.min(minY, man.positions[i]);
      maxY = Math.max(maxY, man.positions[i]);
    }
    expect(minY).toBeCloseTo(0, 0);
    expect(Math.abs(maxY - 1750)).toBeLessThan(10);
    for (const s of ['L', 'R']) {
      const upper = v3.norm(v3.sub(man.joints[`elbow${s}`], man.joints[`shoulder${s}`]));
      const fore = v3.norm(v3.sub(man.joints[`wrist${s}`], man.joints[`elbow${s}`]));
      const bend = (Math.acos(v3.dot(upper, fore)) * 180) / Math.PI;
      expect(bend).toBeLessThan(10);
    }
    expect(man.joints.shoulderL[0]).toBeGreaterThan(0);
  });
});
