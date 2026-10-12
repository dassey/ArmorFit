import { describe, expect, it } from 'vitest';
import { cube } from '../testmeshes/primitives';
import { mulberry32 } from '../math/rng';
import { checkBuildVolume, checkHull, hullPoints } from './buildVolume';
import { DEFAULT_PRINTER_ID, findPrinter, PRINTERS } from './printers';

function box(sx: number, sy: number, sz: number, rotDegZ = 0) {
  const m = cube(1);
  const p = m.positions;
  const c = Math.cos((rotDegZ * Math.PI) / 180);
  const s = Math.sin((rotDegZ * Math.PI) / 180);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] * sx;
    const y = p[i + 1] * sy;
    p[i] = x * c - y * s;
    p[i + 1] = x * s + y * c;
    p[i + 2] *= sz;
  }
  return m.positions;
}

describe('printer presets', () => {
  it('has unique ids and sane volumes', () => {
    const ids = new Set(PRINTERS.map((p) => p.id));
    expect(ids.size).toBe(PRINTERS.length);
    for (const p of PRINTERS) for (const d of p.volume) expect(d).toBeGreaterThan(100);
  });

  it('defaults to the Bambu Lab H2C (left nozzle) with the official volume', () => {
    const p = findPrinter(DEFAULT_PRINTER_ID)!;
    expect(p.brand).toBe('Bambu Lab');
    expect(p.volume).toEqual([325, 320, 320]);
  });
});

describe('checkBuildVolume', () => {
  it('fits a small box', () => {
    const r = checkBuildVolume(box(100, 50, 20), [256, 256, 256]);
    expect(r.fits).toBe(true);
    expect(r.minimalSize[0]).toBeCloseTo(100, 3);
  });

  it('finds a rotated orientation for a long part (stand it up)', () => {
    const r = checkBuildVolume(box(300, 40, 20, 33), [200, 200, 320]);
    expect(r.fits).toBe(true);
    expect(r.extents[2]).toBeGreaterThan(200);
    expect(r.fitsAsExported).toBe(false);
  });

  it('finds the diagonal placement on the bed', () => {
    const r = checkBuildVolume(box(340, 20, 20), [256, 256, 100]);
    expect(r.fits).toBe(true);
    expect(r.fitsAsExported).toBe(true);
    expect(r.exportedExtents[2]).toBeCloseTo(20, 3);
  });

  it('hull of big clouds is exact (chunked), so no protrusion is skipped', () => {
    const rnd = mulberry32(7);
    const n = 20_000;
    const pts = new Float64Array(n * 3);
    for (let i = 0; i < pts.length; i++) pts[i] = (rnd() - 0.5) * 100;
    pts[3 * 4321] = 400;
    const key = (h: Float64Array) =>
      Array.from({ length: h.length / 3 }, (_, i) => `${h[i * 3]},${h[i * 3 + 1]},${h[i * 3 + 2]}`).sort();
    const whole = hullPoints(pts);
    expect(key(hullPoints(pts, 3000))).toEqual(key(whole));
    expect(key(whole)).toContain(key(Float64Array.from(pts.subarray(3 * 4321, 3 * 4321 + 3)))[0]);
    expect(checkBuildVolume(pts, [256, 256, 256]).fits).toBe(false);
  });

  it('measures the chosen orientations on the exact points, not the search hull', () => {
    const plain = box(100, 50, 20);
    const full = Float64Array.from([...plain, 0, 0, 300]);
    expect(checkHull(plain, [256, 256, 256]).fits).toBe(true);
    const r = checkHull(plain, [256, 256, 256], 1, full);
    expect(r.fits).toBe(false);
    expect(Math.max(...r.minimalSize)).toBeGreaterThan(256);
  });

  it('flags parts that are too big in every orientation', () => {
    const r = checkBuildVolume(box(400, 300, 300), [256, 256, 256]);
    expect(r.fits).toBe(false);
    expect(r.slack).toBeLessThan(0);
  });
});
