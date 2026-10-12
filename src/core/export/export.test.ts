import { Matrix4 } from 'three';
import { describe, expect, it } from 'vitest';
import { newProfile } from '../measurements/profile';
import { analyzeTopology, signedVolume } from '../mesh/topology';
import { computeBounds } from '../mesh/types';
import { autoOrient } from '../pieces/orient';
import { findPrinter } from '../print/printers';
import { makePauldron } from '../testmeshes/pieces';
import { cube } from '../testmeshes/primitives';
import { parseProject, ProjectError, serializeProject } from './project';
import { sizingReportMarkdown } from './report';
import { bakeForPrint, exportMatrix, fileSafe } from './transform';

const IDENTITY = new Matrix4().elements.slice();

describe('export transform', () => {
  it('keeps the original orientation and applies uniform scale', () => {
    const m = exportMatrix(
      { unitScale: 10, orientation: IDENTITY, scale: [1.1, 1.1, 1.1], mirrored: false },
      'original',
    );
    const baked = bakeForPrint(cube(10), m);
    const b = computeBounds(baked.positions);
    expect(b.max[0] - b.min[0]).toBeCloseTo(110, 4);
    expect(b.min[2]).toBeCloseTo(0, 6);
    expect(signedVolume(baked)).toBeCloseTo(110 ** 3, -1);
  });

  it('mirrors with correct (outward) winding', () => {
    const m = exportMatrix(
      { unitScale: 1, orientation: IDENTITY, scale: [1, 1, 1], mirrored: true },
      'original',
    );
    const baked = bakeForPrint(makePauldron(), m);
    expect(signedVolume(baked)).toBeGreaterThan(0);
    expect(analyzeTopology(baked).watertight).toBe(true);
  });

  it('wearing orientation turns the wearing up (+Y) into the slicer up (+Z)', () => {
    const box = cube(1);
    const p = box.positions;
    for (let i = 0; i < p.length; i += 3) {
      p[i] *= 10;
      p[i + 1] *= 40;
      p[i + 2] *= 10;
    }
    const m = exportMatrix(
      { unitScale: 1, orientation: IDENTITY, scale: [1, 1, 1], mirrored: false },
      'wearing',
    );
    const b = computeBounds(bakeForPrint(box, m).positions);
    expect(b.max[2] - b.min[2]).toBeCloseTo(40, 4);
  });

  it('per-axis scale is applied along the wearing axes, then mapped back to the file', () => {
    const piece = makePauldron();
    const r = autoOrient(piece);
    const original = exportMatrix(
      { unitScale: 1, orientation: r.matrix, scale: [1, 1, 1], mirrored: false },
      'wearing',
    );
    const scaled = exportMatrix(
      { unitScale: 1, orientation: r.matrix, scale: [1, 1.2, 1], mirrored: false },
      'wearing',
    );
    const h0 = computeBounds(bakeForPrint(piece, original).positions);
    const h1 = computeBounds(bakeForPrint(piece, scaled).positions);
    expect((h1.max[2] - h1.min[2]) / (h0.max[2] - h0.min[2])).toBeCloseTo(1.2, 3);
  });

  it('makes safe file names', () => {
    expect(fileSafe('Pauldron L (mirrored)/v2')).toBe('Pauldron_L_mirroredv2');
  });
});

describe('sizing report', () => {
  it('lists measurements, clearance and pieces', () => {
    const md = sizingReportMarkdown({
      appVersion: '0.1.0',
      date: new Date('2026-10-12T00:00:00Z'),
      profile: newProfile(),
      clearance: { min: 3, target: 8, max: 25 },
      printer: findPrinter('bambu-h2c-left')!,
      orientation: 'original',
      pieces: [
        {
          name: 'Pauldron L',
          fileName: 'Pauldron_L.stl',
          fileHash: 'abc123',
          type: 'Pauldron (shoulder)',
          side: 'L',
          unitScale: 1,
          scale: [0.95, 0.95, 0.95],
          mirrored: false,
          placed: true,
          printCheck: {
            fits: true,
            fitsAsExported: true,
            extents: [200, 180, 120],
            exportedExtents: [200, 180, 120],
            slack: 100,
            axes: [
              [1, 0, 0],
              [0, 1, 0],
              [0, 0, 1],
            ],
            minimalSize: [200, 180, 120],
          },
        },
      ],
    });
    expect(md).toContain('# ArmorFit sizing report');
    expect(md).toContain('| Height |');
    expect(md).toContain('Pauldron_L.stl');
    expect(md).toContain('95.0 % / 95.0 % / 95.0 %');
    expect(md).toContain('H2C');
    expect(md).toContain('200 × 180 × 120 mm ✓');
  });
});

describe('project file', () => {
  const base = {
    app: 'ArmorFit 0.1.0',
    savedAt: '2026-10-12T00:00:00Z',
    bodyAsset: 'x',
    measurements: {},
    clearance: { min: 3, target: 8, max: 25 },
    printer: { id: 'bambu-h2c-left' },
    exportOrientation: 'original' as const,
    pieces: [
      {
        name: 'Helmet',
        fileName: 'helmet.stl',
        fileHash: 'deadbeef',
        type: 'helmet' as const,
        side: null,
        unitScale: 1,
        orientation: autoOrient(makePauldron()),
        placement: { kind: 'bone' as const, bone: 'head', t: 0.4, twist: 0, offset: 0 },
        scale: [1, 1, 1] as [number, number, number],
        mirrored: false,
      },
    ],
  };

  it('round-trips', () => {
    const back = parseProject(serializeProject(base));
    expect(back.kind).toBe('armorfit-project');
    expect(back.pieces[0].placement).toEqual(base.pieces[0].placement);
  });

  it('rejects other files and broken entries', () => {
    expect(() => parseProject('{}')).toThrow(ProjectError);
    const broken = JSON.parse(serializeProject(base));
    broken.pieces[0].scale = ['x'];
    expect(() => parseProject(JSON.stringify(broken))).toThrow(/invalid sizes/);
  });
});
