import { describe, expect, it } from 'vitest';
import { makeForearmTube, makeHelmet, makePauldron, makeChestPlate } from '../testmeshes/pieces';
import { cube } from '../testmeshes/primitives';
import { computeVertexNormals } from './normals';
import { sampleSurface } from './sample';
import { analyzeTopology, boundaryLoops, fixWinding, signedVolume, surfaceArea } from './topology';
import type { MeshData } from './types';
import { compactVertices, unweld, weldVertices } from './weld';

function euler(m: MeshData): number {
  const t = analyzeTopology(m);
  return t.vertices - t.edges + t.triangles;
}

describe('weldVertices', () => {
  it('re-indexes an STL-style triangle soup', () => {
    const soup = unweld(cube());
    expect(soup.positions.length / 3).toBe(36);
    const { mesh, verticesAfter, degenerateRemoved } = weldVertices(soup);
    expect(verticesAfter).toBe(8);
    expect(degenerateRemoved).toBe(0);
    expect(analyzeTopology(mesh).watertight).toBe(true);
  });

  it('drops triangles that collapse', () => {
    const m: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 1e-9, 0, 0, 0, 1, 0]),
      indices: new Uint32Array([0, 1, 2, 0, 1, 3]),
    };
    const r = weldVertices(m, 1e-6);
    expect(r.degenerateRemoved).toBe(1);
    expect(r.mesh.indices.length).toBe(3);
  });

  it('merges by distance, not by grid cell', () => {
    const tol = 0.01;
    const weldWith = (a: number[], copy: number[]) =>
      weldVertices(
        {
          positions: new Float32Array([...a, 0, 0, 0, 1, 0, 0, ...copy, 0, 1, 0, 0, 0, 1]),
          indices: new Uint32Array([0, 1, 2, 3, 4, 5]),
        },
        tol,
      ).verticesAfter;
    expect(weldWith([0.0449, 1, 1], [0.0451, 1, 1])).toBe(5);
    expect(weldWith([0.0351, 0.0351, 0.0351], [0.0449, 0.0449, 0.0449])).toBe(6);
    expect(weldWith([0.0799, 1, 1], [0.0801, 1, 1])).toBe(5);
  });

  it('compactVertices removes unreferenced vertices', () => {
    const m = cube();
    const extra = new Float32Array(m.positions.length + 3);
    extra.set(m.positions);
    const c = compactVertices({ positions: extra, indices: m.indices });
    expect(c.positions.length).toBe(24);
  });
});

describe('topology', () => {
  it('cube is watertight with volume s^3 and area 6 s^2', () => {
    const m = cube(10);
    expect(analyzeTopology(m).watertight).toBe(true);
    expect(signedVolume(m)).toBeCloseTo(1000, 6);
    expect(surfaceArea(m)).toBeCloseTo(600, 6);
    expect(euler(m)).toBe(2);
  });

  it('detects a missing face as boundary edges and a boundary loop', () => {
    const m = cube();
    const open: MeshData = { positions: m.positions, indices: m.indices.slice(0, 30) };
    const t = analyzeTopology(open);
    expect(t.boundaryEdges).toBe(4);
    expect(t.watertight).toBe(false);
    expect(boundaryLoops(open)).toHaveLength(1);
    expect(boundaryLoops(open)[0]).toHaveLength(4);
  });

  it('detects non-manifold edges', () => {
    const m: MeshData = {
      positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1]),
      indices: new Uint32Array([0, 1, 2, 1, 0, 3, 0, 1, 4]),
    };
    expect(analyzeTopology(m).nonManifoldEdges).toBe(1);
  });

  it('fixWinding repairs flipped and inside-out triangles', () => {
    const m = cube();
    const idx = m.indices;
    for (const f of [0, 5]) {
      const t = idx[f * 3 + 1];
      idx[f * 3 + 1] = idx[f * 3 + 2];
      idx[f * 3 + 2] = t;
    }
    expect(analyzeTopology(m).inconsistentEdges).toBeGreaterThan(0);
    fixWinding(m);
    expect(analyzeTopology(m).watertight).toBe(true);
    expect(signedVolume(m)).toBeGreaterThan(0);
  });
});

describe('procedural test pieces', () => {
  const cases: [string, () => MeshData, number][] = [
    ['helmet', () => makeHelmet(), 2],
    ['chest plate', () => makeChestPlate(), 2],
    ['pauldron (2 magnet holes)', () => makePauldron(), -2],
    ['forearm tube', () => makeForearmTube(), 0],
  ];
  for (const [name, make, chi] of cases) {
    it(`${name} is a watertight, outward-facing solid`, () => {
      const m = make();
      const t = analyzeTopology(m);
      expect(t.watertight).toBe(true);
      expect(t.components).toBe(1);
      expect(signedVolume(m)).toBeGreaterThan(0);
      expect(euler(m)).toBe(chi);
    });
  }

  it('pauldron without magnet holes is a plain thick disk', () => {
    const m = makePauldron({ magnetHoles: false });
    expect(analyzeTopology(m).watertight).toBe(true);
    expect(euler(m)).toBe(2);
  });
});

describe('sampleSurface', () => {
  it('is deterministic and covers the area', () => {
    const m = cube(10);
    const a = sampleSurface(m, 600, 7);
    const b = sampleSurface(m, 600, 7);
    expect(Array.from(a.points)).toEqual(Array.from(b.points));
    expect(a.areaPerSample).toBeCloseTo(1, 6);
    let top = 0;
    for (let i = 0; i < 600; i++) if (a.normals[i * 3 + 2] > 0.9) top++;
    expect(top).toBeGreaterThan(70);
    expect(top).toBeLessThan(130);
  });
});

describe('computeVertexNormals', () => {
  it('points outward on a closed solid', () => {
    const m = makeHelmet({ faceOpening: false });
    const n = computeVertexNormals(m);
    let top = 0;
    for (let i = 1; i < m.positions.length / 3; i++)
      if (m.positions[i * 3 + 1] > m.positions[top * 3 + 1]) top = i;
    expect(n[top * 3 + 1]).toBeGreaterThan(0.95);
  });
});
