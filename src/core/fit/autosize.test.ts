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

  it('re-centres an off-centre tube instead of only growing it', () => {
    const piece = prepareAnalysisPiece(tube(62, 200), new Matrix4(), 2000);
    const placement = new Matrix4().makeTranslation(14, 0, 0);
    const r = autoSize(piece, placement, null, [1, 1, 1], false, b, DEFAULT_CLEARANCE, {
      mode: 'uniform',
      category: 'tube',
      shiftAxes: [true, false, true],
    });
    expect(r.before.intersecting).toBeGreaterThan(0);
    expect(r.after.intersecting).toBe(0);
    expect(r.shift[0]).toBeLessThan(-10);
    expect(Math.abs(r.shift[1])).toBe(0);
    expect(r.scale[0]).toBeLessThan(1.02);
  });

  it('ignores contact with the other side of the body', () => {
    const legL = cylinder(50, 600, 96);
    const legR = cylinder(50, 600, 96);
    const n = legL.positions.length;
    const positions = new Float32Array(n * 2);
    for (let i = 0; i < n; i += 3) {
      positions.set([legL.positions[i] + 52, legL.positions[i + 1], legL.positions[i + 2]], i);
      positions.set([legR.positions[i] - 52, legR.positions[i + 1], legR.positions[i + 2]], n + i);
    }
    const indices = new Uint32Array(legL.indices.length * 2);
    indices.set(legL.indices);
    for (let i = 0; i < legR.indices.length; i++) indices[legL.indices.length + i] = legR.indices[i] + n / 3;
    const regions = new Uint8Array((n / 3) * 2);
    regions.fill(encodeRegion('thigh', 1), 0, n / 3);
    regions.fill(encodeRegion('thigh', 2), n / 3);
    const legs = new BodyQuery(positions, computeVertexNormals({ positions, indices }), indices, regions);
    const piece = prepareAnalysisPiece(tube(64, 200), new Matrix4(), 2000);
    const placement = new Matrix4().makeTranslation(52, 0, 0);
    const opts = { mode: 'uniform' as const, category: 'tube' as const };
    const both = autoSize(piece, placement, null, [1, 1, 1], false, legs, DEFAULT_CLEARANCE, opts);
    const own = autoSize(piece, placement, null, [1, 1, 1], false, legs, DEFAULT_CLEARANCE, {
      ...opts,
      excludeSide: 2,
    });
    expect(own.scale[0]).toBeLessThan(1);
    expect(both.scale[0]).toBeGreaterThan(own.scale[0]);
  });

  it('never returns a worse fit than it started with', () => {
    const piece = prepareAnalysisPiece(tube(58, 200), new Matrix4(), 2000);
    const r = autoSize(piece, new Matrix4(), null, [1, 1, 1], false, b, DEFAULT_CLEARANCE, {
      mode: 'uniform',
    });
    const bad = (s: typeof r.after) => s.intersecting * 3 + s.tight + s.loose * 0.3;
    expect(bad(r.after)).toBeLessThanOrEqual(bad(r.before) + 0.01);
  });
});
