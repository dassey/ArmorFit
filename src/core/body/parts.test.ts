import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { pca } from '../math/fitting';
import { newProfile, setMeasurement } from '../measurements/profile';
import { MEASUREMENT_KEYS, QUICK_KEYS } from '../measurements/schema';
import { PIECE_TYPES } from '../pieces/types';
import { parseBodyAsset } from './asset';
import { MannequinBuilder, type Mannequin } from './mannequin';
import {
  BODY_PARTS,
  fieldAt,
  isBodyPartId,
  partBounds,
  partField,
  partForPiece,
  partMeasurements,
  segmentWeights,
  SEGMENTS,
  type BodyPartId,
} from './parts';
import { decodeRegion, type RegionId } from './regions';

let builder: MannequinBuilder;
let body: Mannequin;
let weights: Float32Array;

beforeAll(() => {
  builder = new MannequinBuilder(parseBodyAsset(readFileSync('public/assets/body/hm08.armorfit.bin.gz')));
  body = builder.build(newProfile());
  weights = segmentWeights(body.indices, body.regions);
});

function share(m: Mannequin, keep: Float32Array, region: RegionId): number {
  let n = 0;
  let kept = 0;
  for (let v = 0; v < keep.length; v++) {
    if (decodeRegion(m.regions[v]).region !== region) continue;
    n++;
    if (keep[v] >= 0) kept++;
  }
  return kept / n;
}

describe('body parts', () => {
  it('give every piece type exactly one part that lists the measurements sizing it', () => {
    for (const t of PIECE_TYPES) {
      const owners = BODY_PARTS.filter((b) => b.pieces.includes(t.id));
      expect(owners, t.id).toHaveLength(1);
      expect(partForPiece(t.id)).toBe(owners[0].id);
      for (const k of t.measurements) expect(owners[0].measurements, `${t.id}: ${k}`).toContain(k);
    }
  });

  it('show every measurement except height in some part', () => {
    const shown = new Set(BODY_PARTS.filter((b) => b.id !== 'full').flatMap((b) => b.measurements));
    expect(MEASUREMENT_KEYS.filter((k) => !shown.has(k))).toEqual(['height']);
  });

  it('show the quick or detailed list for the full body and the whole part otherwise', () => {
    expect(partMeasurements('full', 'quick')).toEqual(QUICK_KEYS);
    expect(partMeasurements('full', 'detailed')).toEqual(MEASUREMENT_KEYS);
    expect(partMeasurements('head', 'quick')).toEqual(['headCirc', 'headLength', 'headWidth', 'neckCirc']);
  });

  it('recognise stored part ids', () => {
    expect(isBodyPartId('legs')).toBe(true);
    expect(isBodyPartId('tail')).toBe(false);
    expect(isBodyPartId(null)).toBe(false);
  });
});

describe('part mask', () => {
  it('blends body segments into weights that sum to one', () => {
    const S = SEGMENTS.length;
    let oneHot = 0;
    for (let v = 0; v < body.regions.length; v++) {
      let sum = 0;
      let max = 0;
      for (let s = 0; s < S; s++) {
        sum += weights[v * S + s];
        max = Math.max(max, weights[v * S + s]);
      }
      expect(sum).toBeCloseTo(1, 4);
      if (max > 0.999) oneHot++;
    }
    expect(oneHot / body.regions.length).toBeGreaterThan(0.7);
  });

  it('keeps the whole mannequin for the full body', () => {
    const keep = partField('full', weights, body);
    expect(keep.every((f) => f > 0)).toBe(true);
  });

  it('keeps the regions each part is for and drops the rest of the body', () => {
    const cases: [BodyPartId, RegionId[], RegionId[]][] = [
      ['head', ['head'], ['chest', 'upperArm', 'hand', 'thigh', 'foot']],
      [
        'torso',
        ['upperChest', 'chest', 'upperBack', 'abdomen', 'waist'],
        ['forearm', 'hand', 'thigh', 'foot'],
      ],
      ['shoulders', ['upperShoulder', 'deltoid', 'chest'], ['forearm', 'hand', 'thigh', 'foot']],
      ['arms', ['upperArm', 'elbow', 'forearm', 'wrist', 'hand'], ['head', 'chest', 'thigh', 'foot']],
      ['hands', ['wrist', 'hand'], ['upperArm', 'chest', 'head', 'foot']],
      ['waist', ['waist', 'hip'], ['head', 'chest', 'hand', 'foot']],
      ['legs', ['thigh', 'knee', 'shin', 'calf', 'foot'], ['head', 'chest', 'hand']],
      ['feet', ['foot', 'shin', 'calf'], ['head', 'chest', 'hand', 'thigh']],
    ];
    for (const [part, kept, dropped] of cases) {
      const keep = partField(part, weights, body);
      for (const r of kept) expect(share(body, keep, r), `${part} keeps ${r}`).toBeGreaterThan(0.9);
      for (const r of dropped) expect(share(body, keep, r), `${part} drops ${r}`).toBeLessThan(0.03);
    }
  });

  it('cuts along a plane, so the edge is straight rather than following the mesh', () => {
    const keep = partField('head', weights, body);
    const P = body.positions;
    const I = body.indices;
    const cut: number[] = [];
    for (let f = 0; f < I.length; f += 3) {
      for (let k = 0; k < 3; k++) {
        const a = I[f + k];
        const b = I[f + ((k + 1) % 3)];
        if (keep[a] < 0 === keep[b] < 0) continue;
        const t = keep[a] / (keep[a] - keep[b]);
        for (let c = 0; c < 3; c++) cut.push(P[a * 3 + c] + t * (P[b * 3 + c] - P[a * 3 + c]));
      }
    }
    expect(cut.length / 3).toBeGreaterThan(20);
    expect(Math.sqrt(pca(cut).values[2])).toBeLessThan(1);
  });

  it('frames only the left limb for arms and hands', () => {
    for (const part of ['arms', 'hands'] as const) {
      const box = partBounds(partField(part, weights, body), body.positions, 'left')!;
      expect(box.min[0], part).toBeGreaterThan(0);
    }
    const head = partBounds(partField('head', weights, body), body.positions, 'both')!;
    expect(head.max[1] - head.min[1]).toBeGreaterThan(200);
    expect(head.max[1] - head.min[1]).toBeLessThan(330);
  });

  it('interpolates the mask across a face', () => {
    const keep = partField('feet', weights, body);
    const face = 0;
    const bary: [number, number, number] = [0.2, 0.3, 0.5];
    const expected = 0.2 * keep[body.indices[0]] + 0.3 * keep[body.indices[1]] + 0.5 * keep[body.indices[2]];
    expect(fieldAt(keep, body.indices, face, bary)).toBeCloseTo(expected, 5);
  });

  it('follows the mannequin when the measurements change', () => {
    let p = setMeasurement(newProfile(), 'height', 1950);
    p = setMeasurement(p, 'headCirc', 610);
    const tall = builder.build(p);
    const keep = partField('head', weights, tall);
    expect(share(tall, keep, 'head')).toBeGreaterThan(0.9);
    expect(share(tall, keep, 'chest')).toBe(0);
  });
});
