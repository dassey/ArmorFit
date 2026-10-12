import { describe, expect, it } from 'vitest';
import { parseStl, writeStl } from '../io/stl';
import { decimate } from '../mesh/decimate';
import { analyzeTopology } from '../mesh/topology';
import { makeHelmet, makePauldron } from '../testmeshes/pieces';
import { preparePiece } from './prepare';

describe('preparePiece', () => {
  it('welds an STL soup, keeps it watertight and recognises a left pauldron in mm', async () => {
    const stl = parseStl(writeStl(makePauldron()), 'Pauldron_L');
    const p = await preparePiece(stl.parts[0], 'Pauldron_L.stl');
    expect(p.topology.watertight).toBe(true);
    expect(p.repairs.verticesMerged).toBeGreaterThan(0);
    expect(p.guess.type).toBe('pauldron');
    expect(p.guess.side).toBe('L');
    expect(p.units.best.unit).toBe('mm');
    expect(p.orientation.category).toBe('shell');
    expect(p.warnings).toEqual([]);
  });

  it('flags a mesh with a hole', async () => {
    const m = makeHelmet();
    const holed = { positions: m.positions, indices: m.indices.slice(3) };
    const p = await preparePiece({ name: 'helmet', mesh: holed }, 'helmet.stl');
    expect(p.topology.watertight).toBe(false);
    expect(p.warnings[0]).toMatch(/not watertight/);
  });

  it('detects centimetre files', async () => {
    const m = makeHelmet();
    const cm = { positions: m.positions.map((v) => v / 10), indices: m.indices };
    const p = await preparePiece({ name: 'Helmet', mesh: cm }, 'Helmet.obj');
    expect(p.units.best.unit).toBe('cm');
  });
});

describe('decimate', () => {
  it('reduces triangle count and keeps the shape closed-ish', async () => {
    const m = makeHelmet({ segments: 160 });
    const before = m.indices.length / 3;
    const { mesh, error } = await decimate(m, 8000);
    expect(mesh.indices.length / 3).toBeLessThanOrEqual(8400);
    expect(mesh.indices.length / 3).toBeLessThan(before);
    expect(error).toBeLessThan(2);
    expect(analyzeTopology(mesh).boundaryEdges).toBe(0);
  });
});
