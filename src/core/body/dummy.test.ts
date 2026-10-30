import { readFileSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { newProfile } from '../measurements/profile';
import { parseBodyAsset, type BodyAsset } from './asset';
import { DummyLook } from './dummy';
import { MannequinBuilder, type Mannequin } from './mannequin';
import { decodeRegion } from './regions';

let asset: BodyAsset;
let man: Mannequin;
let look: DummyLook;

beforeAll(() => {
  asset = parseBodyAsset(readFileSync('public/assets/body/hm08.armorfit.bin.gz'));
  man = new MannequinBuilder(asset).build({ ...newProfile(), preset: 'masculine' });
  look = new DummyLook(asset.indices, asset.regions);
});

describe('fitting dummy display', () => {
  it('changes only the face, fills the eye sockets and covers the face with the visor', () => {
    const t0 = performance.now();
    const shape = look.shape(man.positions, man.joints, man.landmarks);
    const ms = performance.now() - t0;
    const P = man.positions;
    const eye = man.joints.eyeL;
    let socketBefore = Infinity;
    let socketAfter = Infinity;
    for (let i = 0; i < asset.regions.length; i++) {
      const moved = Math.hypot(
        shape.positions[i * 3] - P[i * 3],
        shape.positions[i * 3 + 1] - P[i * 3 + 1],
        shape.positions[i * 3 + 2] - P[i * 3 + 2],
      );
      const head = decodeRegion(asset.regions[i]).region === 'head';
      if (!head) {
        expect(moved).toBe(0);
        expect(shape.visor[i]).toBe(0);
      }
      if (shape.visor[i] > 0) expect(P[i * 3 + 1]).toBeLessThan(man.joints.headTop[1]);
      const n = Math.hypot(shape.normals[i * 3], shape.normals[i * 3 + 1], shape.normals[i * 3 + 2]);
      expect(n).toBeCloseTo(1, 4);
      if (Math.hypot(P[i * 3] - eye[0], P[i * 3 + 1] - eye[1]) < 12 && P[i * 3 + 2] > eye[2] - 40) {
        socketBefore = Math.min(socketBefore, P[i * 3 + 2]);
        socketAfter = Math.min(socketAfter, shape.positions[i * 3 + 2]);
        expect(shape.visor[i]).toBeGreaterThan(0.5);
      }
    }
    expect(socketAfter - socketBefore).toBeGreaterThan(10);
    expect(ms).toBeLessThan(400);
  });
});
