import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { encodeRegion } from '../body/regions';
import { computeVertexNormals } from '../mesh/normals';
import { cylinder } from '../testmeshes/primitives';
import { makeShell } from '../testmeshes/shell';
import { prepareAnalysisPiece } from './analyze';
import { autoSize } from './autosize';
import { BodyQuery } from './bodyQuery';
import { DEFAULT_CLEARANCE } from './clearance';

function body() {
  const m = cylinder(50, 600, 128);
  const regions = new Uint8Array(m.positions.length / 3).fill(encodeRegion('forearm', 1));
  return new BodyQuery(m.positions, computeVertexNormals(m), m.indices, regions);
}

function tube(radius: number, length: number) {
  return makeShell({
    surface: (u, v) => [
      radius * Math.sin(u * 2 * Math.PI),
      (v - 0.5) * length,
      radius * Math.cos(u * 2 * Math.PI),
    ],
    uSegments: 96,
    vSegments: 24,
    uPeriodic: true,
    thickness: 3,
  });
}

describe('autoSize', () => {
  const b = body();

  it('shrinks a loose tube uniformly to the target gap', () => {
    const piece = prepareAnalysisPiece(tube(70, 200), new Matrix4(), 2000);
    const r = autoSize(piece, new Matrix4(), null, [1, 1, 1], false, b, DEFAULT_CLEARANCE, {
      mode: 'uniform',
    });
    expect(r.before.median).toBeGreaterThan(17);
    expect(r.scale[0]).toBeGreaterThan(0.82);
    expect(r.scale[0]).toBeLessThan(0.87);
    expect(r.scale[0]).toBeCloseTo(r.scale[1], 6);
    expect(Math.abs(r.after.median - 8)).toBeLessThan(1);
  });

  it('grows a tight tube that intersects the body', () => {
    const piece = prepareAnalysisPiece(tube(52, 200), new Matrix4(), 2000);
    const r = autoSize(piece, new Matrix4(), null, [1, 1, 1], false, b, DEFAULT_CLEARANCE, {
      mode: 'uniform',
    });
    expect(r.before.min).toBeLessThan(DEFAULT_CLEARANCE.min);
    expect(r.scale[0]).toBeGreaterThan(1.1);
    expect(r.after.min).toBeGreaterThan(DEFAULT_CLEARANCE.min - 0.5);
  });

  it('per-axis mode fits an elliptical opening and keeps the length near the mean', () => {
    const ell = makeShell({
      surface: (u, v) => [80 * Math.sin(u * 2 * Math.PI), (v - 0.5) * 200, 64 * Math.cos(u * 2 * Math.PI)],
      uSegments: 96,
      vSegments: 24,
      uPeriodic: true,
      thickness: 3,
    });
    const piece = prepareAnalysisPiece(ell, new Matrix4(), 2500);
    const r = autoSize(piece, new Matrix4(), null, [1, 1, 1], false, b, DEFAULT_CLEARANCE, { mode: 'axes' });
    expect(r.scale[0]).toBeLessThan(r.scale[2]);
    expect(r.after.std).toBeLessThan(r.before.std);
    expect(r.scale[0]).toBeCloseTo(0.74, 1);
    expect(r.scale[2]).toBeCloseTo(0.93, 1);
    expect(r.scale[1]).toBeGreaterThan(Math.min(r.scale[0], r.scale[2]));
    expect(r.scale[1]).toBeLessThanOrEqual(1.02);
  });

  it('moves a shell along its placement direction', () => {
    const patch = makeShell({
      surface: (u, v) => {
        const a = (u - 0.5) * 1.2;
        return [60 * Math.sin(a), (v - 0.5) * 120, 60 * Math.cos(a) - 60];
      },
      uSegments: 40,
      vSegments: 20,
      thickness: 3,
    });
    const piece = prepareAnalysisPiece(patch, new Matrix4(), 1500);
    const placement = new Matrix4().makeTranslation(0, 0, 90);
    const r = autoSize(piece, placement, [0, 0, 1], [1, 1, 1], false, b, DEFAULT_CLEARANCE, {
      mode: 'uniform',
    });
    expect(r.offset).toBeLessThan(-20);
    expect(Math.abs(r.after.median - DEFAULT_CLEARANCE.target)).toBeLessThan(3);
  });
});
