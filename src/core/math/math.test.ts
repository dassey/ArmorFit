import { describe, expect, it } from 'vitest';
import { mulberry32 } from './rng';
import { fitCircle2D, fitCylinderAlong, fitSphere, pca } from './fitting';
import { leastSquares, solveLinear, symmetricEigen3 } from './linalg';

describe('linalg', () => {
  it('solves a linear system', () => {
    const x = solveLinear([2, 1, 0, 1, 3, 1, 0, 1, 4], [3, 5, 5], 3)!;
    expect(x[0]).toBeCloseTo(1, 10);
    expect(x[1]).toBeCloseTo(1, 10);
    expect(x[2]).toBeCloseTo(1, 10);
  });

  it('returns null for a singular system', () => {
    expect(solveLinear([1, 2, 2, 4], [1, 2], 2)).toBeNull();
  });

  it('least squares recovers a line fit', () => {
    const xs = [0, 1, 2, 3, 4];
    const J = xs.flatMap((x) => [x, 1]);
    const r = xs.map((x) => 2 * x + 1);
    const sol = leastSquares(J, r, xs.length, 2)!;
    expect(sol[0]).toBeCloseTo(2, 10);
    expect(sol[1]).toBeCloseTo(1, 10);
  });

  it('eigen-decomposes a symmetric matrix', () => {
    const { values, vectors } = symmetricEigen3([4, 1, 0, 1, 3, 0, 0, 0, 1]);
    expect(values[0]).toBeGreaterThanOrEqual(values[1]);
    expect(values[1]).toBeGreaterThanOrEqual(values[2]);
    expect(values[2]).toBeCloseTo(1, 10);
    const A = [
      [4, 1, 0],
      [1, 3, 0],
      [0, 0, 1],
    ];
    for (let k = 0; k < 3; k++) {
      const v = vectors[k];
      for (let i = 0; i < 3; i++) {
        const av = A[i][0] * v[0] + A[i][1] * v[1] + A[i][2] * v[2];
        expect(av).toBeCloseTo(values[k] * v[i], 8);
      }
    }
  });
});

describe('fitting', () => {
  it('PCA finds the long axis of an elongated cloud', () => {
    const rnd = mulberry32(3);
    const pts: number[] = [];
    for (let i = 0; i < 2000; i++) pts.push((rnd() - 0.5) * 2, (rnd() - 0.5) * 20, (rnd() - 0.5) * 5);
    const r = pca(pts);
    expect(Math.abs(r.axes[0][1])).toBeGreaterThan(0.99);
    expect(Math.abs(r.axes[1][2])).toBeGreaterThan(0.99);
  });

  it('fits a sphere to a partial cap', () => {
    const rnd = mulberry32(5);
    const pts: number[] = [];
    for (let i = 0; i < 500; i++) {
      const th = rnd() * Math.PI * 2;
      const ph = rnd() * 0.8;
      pts.push(
        10 + 50 * Math.sin(ph) * Math.cos(th),
        -4 + 50 * Math.cos(ph),
        7 + 50 * Math.sin(ph) * Math.sin(th),
      );
    }
    const s = fitSphere(pts)!;
    expect(s.radius).toBeCloseTo(50, 3);
    expect(s.center[0]).toBeCloseTo(10, 3);
    expect(s.center[1]).toBeCloseTo(-4, 3);
    expect(s.center[2]).toBeCloseTo(7, 3);
    expect(s.rms).toBeLessThan(1e-6);
  });

  it('fits circles and cylinders', () => {
    const xy: number[] = [];
    for (let i = 0; i < 40; i++) xy.push(3 + 7 * Math.cos(i * 0.3), -2 + 7 * Math.sin(i * 0.3));
    const c = fitCircle2D(xy)!;
    expect(c.radius).toBeCloseTo(7, 6);
    const pts: number[] = [];
    for (let i = 0; i < 200; i++) pts.push(20 * Math.cos(i), (i % 20) * 3, 20 * Math.sin(i));
    const cyl = fitCylinderAlong(pts, [0, 1, 0])!;
    expect(cyl.radius).toBeCloseTo(20, 4);
    expect(Math.hypot(cyl.point[0], cyl.point[2])).toBeLessThan(1e-4);
  });
});
