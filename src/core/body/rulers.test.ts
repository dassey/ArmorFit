import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { newProfile } from '../measurements/profile';
import { MEASUREMENT_KEYS, measurementInfo } from '../measurements/schema';
import { parseBodyAsset, type BodyAsset } from './asset';
import { MannequinBuilder, type Mannequin } from './mannequin';
import { pathLength, rulerGeometry, rulerLabel, type BodyShape } from './rulers';

let asset: BodyAsset;
let body: Mannequin;
let shape: BodyShape;

beforeAll(() => {
  asset = parseBodyAsset(readFileSync('public/assets/body/hm08.armorfit.bin.gz'));
  body = new MannequinBuilder(asset).build(newProfile());
  shape = {
    positions: body.positions,
    regions: body.regions,
    landmarks: body.landmarks,
    loops: Object.fromEntries(Object.entries(asset.header.loops).map(([k, l]) => [k, l.edges])),
  };
});

describe('measurement rulers', () => {
  it('draw every measurement on the mannequin', () => {
    for (const k of MEASUREMENT_KEYS) {
      const g = rulerGeometry(k, shape);
      expect(g, k).not.toBeNull();
      expect(g!.path.length, k).toBeGreaterThanOrEqual(2);
      for (const p of [...g!.path, g!.label]) expect(p.every(Number.isFinite), k).toBe(true);
    }
  });

  it('wrap a tape around the body that is as long as the measured circumference', () => {
    for (const k of MEASUREMENT_KEYS.filter((k) => measurementInfo(k).kind === 'circumference')) {
      const g = rulerGeometry(k, shape)!;
      expect(g.closed, k).toBe(true);
      const err = Math.abs(pathLength(g.path, true) - body.measured[k]!) / body.measured[k]!;
      expect(err, k).toBeLessThan(0.02);
    }
  });

  it('span the measured length between the landmarks', () => {
    for (const k of MEASUREMENT_KEYS.filter((k) => measurementInfo(k).kind === 'length')) {
      const g = rulerGeometry(k, shape)!;
      expect(g.closed, k).toBe(false);
      expect(g.ends, k).toHaveLength(2);
      const [a, b] = g.ends;
      const span = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
      const err = Math.abs(span - body.measured[k]!) / body.measured[k]!;
      expect(err, k).toBeLessThan(k === 'upperArmLength' ? 0.08 : 0.015);
    }
  });

  it('use short labels', () => {
    expect(rulerLabel('bicepCirc')).toBe('Bicep');
    expect(rulerLabel('headCirc')).toBe('Head');
    expect(rulerLabel('forearmLength')).toBe('Forearm length');
    expect(rulerLabel('height')).toBe('Height');
  });
});
