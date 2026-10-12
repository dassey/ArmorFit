import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { encodeRegion } from '../body/regions';
import { computeVertexNormals } from '../mesh/normals';
import { sampleSurface } from '../mesh/sample';
import { analyzeTopology, signedVolume } from '../mesh/topology';
import { makeShell } from '../testmeshes/shell';
import { cylinder } from '../testmeshes/primitives';
import { BodyQuery } from './bodyQuery';
import { clearanceStats, measureClearance, DEFAULT_CLEARANCE, withAllowance } from './clearance';
import { clearanceColor } from './heatmap';
import { drivingMeasurements, regionTally } from './regionTally';
import { settleOffset } from './settle';

function cylinderBody(regionTop: number, regionBottom: number) {
  const m = cylinder(50, 400, 96);
  const normals = computeVertexNormals(m);
  const regions = new Uint8Array(m.positions.length / 3);
  for (let i = 0; i < regions.length; i++) regions[i] = m.positions[i * 3 + 1] > 0 ? regionTop : regionBottom;
  return new BodyQuery(m.positions, normals, m.indices, regions);
}

function tube(radius: number, length: number, thickness = 3) {
  return makeShell({
    surface: (u, v) => [
      radius * Math.sin(u * 2 * Math.PI),
      (v - 0.5) * length,
      radius * Math.cos(u * 2 * Math.PI),
    ],
    uSegments: 96,
    vSegments: 24,
    uPeriodic: true,
    thickness,
  });
}

const FOREARM = encodeRegion('forearm', 1);
const WRIST = encodeRegion('wrist', 1);

describe('BodyQuery', () => {
  const body = cylinderBody(FOREARM, WRIST);
  it('gives signed distances to the body', () => {
    expect(body.distance([70, 0, 0])!.distance).toBeCloseTo(20, 0);
    expect(body.distance([40, 0, 0])!.distance).toBeCloseTo(-10, 0);
    expect(body.distance([0, 100, 80])!.region).toBe(FOREARM);
    expect(body.distance([0, -100, 80])!.region).toBe(WRIST);
  });

  it('ray-casts with stable triangle ids and barycentric coordinates', () => {
    const hit = body.raycast([0, 10, 500], [0, 0, -1])!;
    expect(hit.point[2]).toBeCloseTo(50, 0);
    expect(hit.normal[2]).toBeGreaterThan(0.99);
    expect(hit.bary[0] + hit.bary[1] + hit.bary[2]).toBeCloseTo(1, 6);
  });
});

describe('clearance', () => {
  const body = cylinderBody(FOREARM, WRIST);

  it('measures the gap of a concentric tube (inner radius - body radius)', () => {
    const piece = tube(60, 200);
    expect(analyzeTopology(piece).watertight).toBe(true);
    expect(signedVolume(piece)).toBeGreaterThan(0);
    const s = sampleSurface(piece, 3000, 3);
    const samples = measureClearance(s.points, s.normals, new Matrix4(), body);
    expect(samples.length).toBeGreaterThan(1000);
    expect(samples.length).toBeLessThan(2000);
    const st = clearanceStats(samples, DEFAULT_CLEARANCE);
    expect(st.median).toBeGreaterThan(8);
    expect(st.median).toBeLessThan(9.2);
    expect(st.std).toBeLessThan(0.5);
    expect(st.intersecting).toBe(0);
    expect(st.good).toBeCloseTo(1, 5);
  });

  it('reports intersection when the piece is too small', () => {
    const piece = tube(45, 200);
    const s = sampleSurface(piece, 2000, 3);
    const st = clearanceStats(measureClearance(s.points, s.normals, new Matrix4(), body), DEFAULT_CLEARANCE);
    expect(st.min).toBeLessThan(0);
    expect(st.intersecting).toBeGreaterThan(0.4);
  });

  it('tallies regions from the closest body points', () => {
    const piece = tube(60, 200);
    const s = sampleSurface(piece, 3000, 3);
    const m = new Matrix4().makeTranslation(0, 50, 0);
    const tally = regionTally(measureClearance(s.points, s.normals, m, body));
    expect(tally[0].code).toBe(FOREARM);
    expect(tally[0].fraction).toBeGreaterThan(0.65);
    expect(tally[0].fraction).toBeLessThan(0.85);
    expect(tally[0].label).toBe('Forearm (L)');
    expect(drivingMeasurements(tally)).toEqual(expect.arrayContaining(['forearmCirc', 'wristCirc']));
  });

  it('settles a shell to the target clearance along its normal', () => {
    const patch = makeShell({
      surface: (u, v) => {
        const a = (u - 0.5) * 1.4;
        return [70 * Math.sin(a), (v - 0.5) * 120, 70 * Math.cos(a)];
      },
      uSegments: 40,
      vSegments: 20,
      thickness: 3,
    });
    const s = sampleSurface(patch, 2000, 9);
    const matrixFor = (offset: number) => new Matrix4().makeTranslation(0, 0, 30 + offset);
    const before = clearanceStats(
      measureClearance(s.points, s.normals, matrixFor(0), body),
      DEFAULT_CLEARANCE,
    );
    const off = settleOffset(
      s.points,
      s.normals,
      matrixFor(0),
      [0, 0, 1],
      [1, 1, 1],
      false,
      body,
      DEFAULT_CLEARANCE,
    );
    const after = clearanceStats(
      measureClearance(s.points, s.normals, matrixFor(off), body),
      DEFAULT_CLEARANCE,
    );
    expect(before.p5).toBeGreaterThan(40);
    expect(after.min).toBeGreaterThan(DEFAULT_CLEARANCE.min - 0.5);
    expect(Math.abs(after.median - DEFAULT_CLEARANCE.target)).toBeLessThan(4);
  });
});

describe('settings and colours', () => {
  it('adds the undergarment allowance to every threshold', () => {
    expect(withAllowance(DEFAULT_CLEARANCE, 10)).toEqual({ min: 13, target: 18, max: 35 });
  });

  it('colours tight red, target green and loose blue', () => {
    const s = DEFAULT_CLEARANCE;
    const red = clearanceColor(0.5, s);
    const green = clearanceColor(s.target, s);
    const blue = clearanceColor(s.max * 3, s);
    expect(red[0]).toBeGreaterThan(red[1]);
    expect(green[1]).toBeGreaterThan(green[0]);
    expect(blue[2]).toBeGreaterThan(blue[0]);
  });
});
