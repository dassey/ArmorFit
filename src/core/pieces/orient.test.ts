import { Matrix4, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { mulberry32 } from '../math/rng';
import type { MeshData } from '../mesh/types';
import { makeChestPlate, makeForearmTube, makeHelmet, makePauldron } from '../testmeshes/pieces';
import { makeShell } from '../testmeshes/shell';
import { autoOrient } from './orient';

function rotated(mesh: MeshData, q: Quaternion): MeshData {
  const p = mesh.positions.slice();
  const v = new Vector3();
  for (let i = 0; i < p.length; i += 3) {
    v.set(p[i], p[i + 1], p[i + 2])
      .applyQuaternion(q)
      .add(new Vector3(37, -12, 5));
    p[i] = v.x;
    p[i + 1] = v.y;
    p[i + 2] = v.z;
  }
  return { positions: p, indices: mesh.indices };
}

function randomRotation(seed: number): Quaternion {
  const r = mulberry32(seed);
  const u1 = r();
  const u2 = r() * Math.PI * 2;
  const u3 = r() * Math.PI * 2;
  const a = Math.sqrt(1 - u1);
  const b = Math.sqrt(u1);
  return new Quaternion(a * Math.sin(u2), a * Math.cos(u2), b * Math.sin(u3), b * Math.cos(u3));
}

function recovered(dir: [number, number, number], q: Quaternion, m: number[]): Vector3 {
  const v = new Vector3(...dir).applyQuaternion(q);
  const M = new Matrix4().fromArray(m);
  return v.transformDirection(M);
}

describe('autoOrient', () => {
  const seeds = [1, 2, 3, 4, 5, 6];

  it('helmet: recovers up (neck opening down) and front (face opening)', () => {
    const helmet = makeHelmet();
    for (const s of seeds) {
      const q = randomRotation(s);
      const r = autoOrient(rotated(helmet, q));
      expect(r.category).toBe('cap');
      expect(recovered([0, 1, 0], q, r.matrix).y).toBeGreaterThan(0.9);
      expect(recovered([0, 0, 1], q, r.matrix).z).toBeGreaterThan(0.8);
      expect(r.confidence).toBeGreaterThan(0.6);
    }
  });

  it('forearm tube: recovers the limb axis with the wide (elbow) end up', () => {
    const tube = makeForearmTube();
    for (const s of seeds) {
      const q = randomRotation(s);
      const r = autoOrient(rotated(tube, q));
      expect(r.category).toBe('tube');
      expect(recovered([0, 1, 0], q, r.matrix).y).toBeGreaterThan(0.95);
    }
  });

  it('clamshell half typed as a bracer (no two open ends): long axis, wide end up, low confidence', () => {
    const half = makeShell({
      surface: (u, v) => {
        const a = (u - 0.5) * Math.PI;
        const r = 40 + 12 * v;
        return [r * Math.sin(a), (v - 0.5) * 220, r * Math.cos(a)];
      },
      uSegments: 48,
      vSegments: 32,
      thickness: 3,
    });
    for (const s of seeds) {
      const q = randomRotation(s);
      const r = autoOrient(rotated(half, q), { category: 'tube' });
      expect(r.category).toBe('tube');
      expect(recovered([0, 1, 0], q, r.matrix).y).toBeGreaterThan(0.95);
      expect(r.confidence).toBeLessThan(0.6);
    }
  });

  it('never throws, whatever the shape and piece-type hint, and returns a rotation', () => {
    const flatPlate = makeShell({
      surface: (u, v) => [(u - 0.5) * 200, (v - 0.5) * 150, 0],
      uSegments: 8,
      vSegments: 8,
      thickness: 3,
    });
    const meshes = [makeHelmet(), makeChestPlate(), makePauldron(), makeForearmTube(), flatPlate];
    const hints = [
      {},
      { category: 'shell' },
      { category: 'tube' },
      { category: 'cap' },
      { category: 'cap', openingDown: false },
    ] as const;
    for (const [i, mesh] of meshes.entries()) {
      const input = rotated(mesh, randomRotation(100 + i));
      for (const hint of hints) {
        const r = autoOrient(input, hint);
        const m = new Matrix4().fromArray(r.matrix);
        expect(m.determinant()).toBeCloseTo(1, 6);
        const x = new Vector3().setFromMatrixColumn(m, 0);
        const y = new Vector3().setFromMatrixColumn(m, 1);
        expect(x.length()).toBeCloseTo(1, 6);
        expect(x.dot(y)).toBeCloseTo(0, 6);
        expect(r.confidence).toBeGreaterThanOrEqual(0);
      }
    }
  });

  it('pauldron and chest plate: concave side faces the body', () => {
    const cases: [MeshData, [number, number, number]][] = [
      [makePauldron(), [Math.sin((25 * Math.PI) / 180), Math.cos((25 * Math.PI) / 180), 0]],
      [makeChestPlate(), [0, 0, 1]],
    ];
    for (const [mesh, outward] of cases) {
      for (const s of seeds) {
        const q = randomRotation(s);
        const r = autoOrient(rotated(mesh, q));
        expect(r.category).toBe('shell');
        const truth = new Vector3(...outward).applyQuaternion(q);
        const got = new Vector3(...r.contactNormal).applyMatrix4(
          new Matrix4().fromArray(r.matrix).invert().setPosition(0, 0, 0),
        );
        expect(truth.dot(got.normalize())).toBeGreaterThan(0.8);
      }
    }
  });

  it('keeps the file’s own up axis for a chest plate exported in wearing pose', () => {
    const r = autoOrient(makeChestPlate());
    expect(recovered([0, 1, 0], new Quaternion(), r.matrix).y).toBeGreaterThan(0.95);
    expect(recovered([0, 0, 1], new Quaternion(), r.matrix).z).toBeGreaterThan(0.95);
  });

  it('finds the inside of a flared plate that wraps the back of a leg', () => {
    const plate = makeShell({
      surface: (u, v) => {
        const a = (u - 0.5) * 2.2;
        const flare = 1 + 1.6 * (v - 0.75) ** 2 + (v > 0.8 ? (v - 0.8) * 3 : 0);
        const r = 55 * flare;
        return [r * Math.sin(a), (v - 0.5) * 320, -r * Math.cos(a)];
      },
      uSegments: 60,
      vSegments: 60,
      thickness: 3,
    });
    const r = autoOrient(plate, { category: 'shell', wrapsVertical: true });
    const M = new Matrix4().extractRotation(new Matrix4().fromArray(r.matrix));
    expect(new Vector3(0, 0, -1).applyMatrix4(M).z).toBeGreaterThan(0.95);
    expect(new Vector3(0, 1, 0).applyMatrix4(M).y).toBeGreaterThan(0.95);
    expect(r.contactNormal[2]).toBeGreaterThan(0.95);
  });
});
