import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseBodyAsset } from '../body/asset';
import { MannequinBuilder, type Mannequin } from '../body/mannequin';
import { estimateMeasurements } from '../measurements/estimate';
import { newProfile, setMeasurement, type MeasurementProfile } from '../measurements/profile';
import type { MeasurementKey, ProportionPreset } from '../measurements/schema';
import {
  CALIBRATION,
  ellipsePerimeter,
  measurePhotos,
  PhotoError,
  type PhotoLandmark,
  type PhotoMask,
  type PhotoView,
} from './silhouette';

let builder: MannequinBuilder;

beforeAll(() => {
  builder = new MannequinBuilder(parseBodyAsset(readFileSync('public/assets/body/hm08.armorfit.bin.gz')));
});

function profileFor(preset: ProportionPreset, known: Record<string, number>): MeasurementProfile {
  let p: MeasurementProfile = { ...newProfile(), preset, mode: 'detailed' };
  for (const [k, v] of Object.entries(known)) p = setMeasurement(p, k as MeasurementKey, v);
  return p;
}

const BODIES: [string, ProportionPreset, Record<string, number>][] = [
  ['average man', 'masculine', {}],
  ['average woman', 'feminine', {}],
  ['tall heavier man', 'masculine', { height: 1930, chest: 1180, waist: 1050, headCirc: 600 }],
  ['petite woman', 'feminine', { height: 1540, chest: 840, waist: 680, headCirc: 540 }],
  ['curvy woman', 'feminine', { height: 1650, chest: 1040, waist: 860, hips: 1120 }],
  ['slim teen', 'neutral', { height: 1580, chest: 800, waist: 660, headCirc: 545 }],
];

/** Orthographic silhouette of the mannequin: front view (x, y) or side view (z, y), `res` mm per pixel. */
function render(
  man: Mannequin,
  view: 'front' | 'side',
  res = 2,
): { mask: PhotoMask; px: (p: number[]) => number[] } {
  const P = man.positions;
  const ax = view === 'front' ? 0 : 2;
  let min = Infinity;
  let max = -Infinity;
  let top = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    min = Math.min(min, P[i + ax]);
    max = Math.max(max, P[i + ax]);
    top = Math.max(top, P[i + 1]);
  }
  const margin = 40;
  const width = Math.ceil((max - min) / res) + margin * 2;
  const height = Math.ceil(top / res) + margin * 2;
  const px = (p: number[]) => [(p[ax] - min) / res + margin, (top - p[1]) / res + margin];
  const data = new Uint8Array(width * height);
  const I = man.indices;
  for (let t = 0; t < I.length; t += 3) {
    const a = px([P[I[t] * 3], P[I[t] * 3 + 1], P[I[t] * 3 + 2]]);
    const b = px([P[I[t + 1] * 3], P[I[t + 1] * 3 + 1], P[I[t + 1] * 3 + 2]]);
    const c = px([P[I[t + 2] * 3], P[I[t + 2] * 3 + 1], P[I[t + 2] * 3 + 2]]);
    const area = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
    if (Math.abs(area) < 1e-9) continue;
    const x0 = Math.max(0, Math.floor(Math.min(a[0], b[0], c[0])));
    const x1 = Math.min(width - 1, Math.ceil(Math.max(a[0], b[0], c[0])));
    const y0 = Math.max(0, Math.floor(Math.min(a[1], b[1], c[1])));
    const y1 = Math.min(height - 1, Math.ceil(Math.max(a[1], b[1], c[1])));
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const qx = x + 0.5;
        const qy = y + 0.5;
        const w0 = ((b[0] - qx) * (c[1] - qy) - (b[1] - qy) * (c[0] - qx)) / area;
        const w1 = ((c[0] - qx) * (a[1] - qy) - (c[1] - qy) * (a[0] - qx)) / area;
        if (w0 >= 0 && w1 >= 0 && w0 + w1 <= 1) data[y * width + x] = 1;
      }
    }
  }
  return { mask: { width, height, data }, px };
}

const JOINT_FOR: Record<PhotoLandmark, string> = {
  nose: 'eyeL',
  eyeL: 'eyeL',
  eyeR: 'eyeR',
  shoulderL: 'shoulderL',
  shoulderR: 'shoulderR',
  elbowL: 'elbowL',
  elbowR: 'elbowR',
  wristL: 'wristL',
  wristR: 'wristR',
  hipL: 'hipL',
  hipR: 'hipR',
  kneeL: 'kneeL',
  kneeR: 'kneeR',
  ankleL: 'ankleL',
  ankleR: 'ankleR',
};

function photo(man: Mannequin, view: 'front' | 'side'): PhotoView {
  const { mask, px } = render(man, view);
  const landmarks: PhotoView['landmarks'] = {};
  for (const [name, joint] of Object.entries(JOINT_FOR) as [PhotoLandmark, string][]) {
    const [x, y] = px(man.joints[joint]);
    landmarks[name] = { x, y, visibility: 1 };
  }
  return { mask, landmarks };
}

const PHOTO_KEYS = Object.keys(CALIBRATION) as MeasurementKey[];

describe('photo measurement', () => {
  it('computes the ellipse perimeter', () => {
    expect(ellipsePerimeter(200, 200)).toBeCloseTo(Math.PI * 200, 6);
    expect(ellipsePerimeter(300, 0)).toBeCloseTo(600, 0);
  });

  // Clean silhouettes track every body consistently. The absolute scale (CALIBRATION) is set from the real
  // segmentation model, whose masks are softer, and checked end to end in tests/e2e/photo.spec.ts.
  it('measures mannequins from front and side silhouettes', () => {
    const ratios: Record<string, number[]> = {};
    for (const [label, preset, known] of BODIES) {
      const values = estimateMeasurements(known, preset).values;
      const man = builder.build(profileFor(preset, values));
      const res = measurePhotos(photo(man, 'front'), photo(man, 'side'), man.measured.height!);
      expect(res.issues, label).toEqual([]);
      expect(res.values.height).toBe(man.measured.height);
      for (const key of PHOTO_KEYS) {
        expect(res.values[key], `${label} ${key}`).toBeDefined();
        (ratios[key] ??= []).push(man.measured[key]! / res.values[key]!);
      }
    }
    for (const [key, r] of Object.entries(ratios)) {
      const mean = r.reduce((a, b) => a + b, 0) / r.length;
      const sd = Math.sqrt(r.reduce((a, b) => a + (b - mean) ** 2, 0) / r.length);
      expect(sd / mean, `${key} spread`).toBeLessThan(0.03);
      expect(Math.abs(mean - 1), `${key} scale`).toBeLessThan(0.12);
    }
  });

  it('rejects a second front photo as the side view', () => {
    const man = builder.build(profileFor('neutral', estimateMeasurements({}, 'neutral').values));
    const front = photo(man, 'front');
    expect(() => measurePhotos(front, front, man.measured.height!)).toThrow(PhotoError);
  });

  it('flags arms held against the body', () => {
    const man = builder.build(profileFor('neutral', estimateMeasurements({}, 'neutral').values));
    const front = photo(man, 'front');
    // Close every gap between the arms and the torso, from the shoulders to the hips.
    const { width } = front.mask;
    const data = front.mask.data as Uint8Array;
    const y0 = Math.round(front.landmarks.shoulderL!.y);
    const y1 = Math.round(front.landmarks.hipL!.y);
    for (let y = y0; y <= y1; y++) {
      const row = data.subarray(y * width, (y + 1) * width);
      const a = row.indexOf(1);
      const b = row.lastIndexOf(1);
      if (a >= 0) row.fill(1, a, b + 1);
    }
    const res = measurePhotos(front, photo(man, 'side'), man.measured.height!);
    expect(res.values.chest).toBeUndefined();
    expect(res.values.waist).toBeUndefined();
    expect(res.values.headCirc).toBeDefined();
    expect(res.issues.some((i) => /arms/.test(i.message))).toBe(true);
  });
});
