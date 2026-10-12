import { describe, expect, it } from 'vitest';
import { cube } from '../testmeshes/primitives';
import { analyzeTopology, signedVolume } from '../mesh/topology';
import { weldVertices } from '../mesh/weld';
import { makePauldron } from '../testmeshes/pieces';
import { parseMeshFile } from './index';
import { parseObj } from './obj';
import { parseStl, writeStl } from './stl';
import { parse3mf, write3mf } from './threemf';
import { strToU8, zipSync } from 'fflate';

describe('STL', () => {
  it('round-trips binary STL', () => {
    const m = makePauldron();
    const buf = writeStl(m);
    expect(buf.byteLength).toBe(84 + 50 * (m.indices.length / 3));
    const r = parseStl(buf, 'p');
    const welded = weldVertices(r.parts[0].mesh).mesh;
    expect(analyzeTopology(welded).watertight).toBe(true);
    expect(signedVolume(welded)).toBeCloseTo(signedVolume(m), 0);
  });

  it('parses ASCII STL', () => {
    const txt = `solid t
facet normal 0 0 1
 outer loop
  vertex 0 0 0
  vertex 1 0 0
  vertex 0 1 0
 endloop
endfacet
endsolid t`;
    const r = parseStl(new TextEncoder().encode(txt).buffer as ArrayBuffer);
    expect(r.parts[0].mesh.indices.length).toBe(3);
    expect(Array.from(r.parts[0].mesh.positions)).toEqual([0, 0, 0, 1, 0, 0, 0, 1, 0]);
  });
});

describe('OBJ', () => {
  it('parses quads, negative indices and objects', () => {
    const txt = `# test
o first
v 0 0 0
v 1 0 0
v 1 1 0
v 0 1 0
f 1/1/1 2/2/2 3/3/3 4/4/4
o second
v 0 0 1
v 1 0 1
v 0 1 1
f -3 -2 -1
`;
    const r = parseObj(txt);
    expect(r.parts.map((p) => p.name)).toEqual(['first', 'second']);
    expect(r.parts[0].mesh.indices.length).toBe(6);
    expect(r.parts[1].mesh.indices.length).toBe(3);
    expect(r.parts[1].mesh.positions.length).toBe(9);
  });
});

describe('3MF', () => {
  it('round-trips objects with offsets', () => {
    const data = write3mf([
      { name: 'cube A', mesh: cube(10) },
      { name: 'cube <B>', mesh: cube(5), offset: [20, 0, 0] },
    ]);
    const r = parse3mf(data.buffer as ArrayBuffer);
    expect(r.declaredUnit).toBe('mm');
    expect(r.parts).toHaveLength(2);
    expect(r.parts[1].name).toBe('cube <B>');
    expect(signedVolume(r.parts[0].mesh)).toBeCloseTo(1000, 3);
    const xs = Array.from(r.parts[1].mesh.positions).filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(20, 4);
  });

  it('reads units and production-extension component paths (Bambu style)', () => {
    const c = cube(1);
    const verts = Array.from(
      { length: 8 },
      (_, i) =>
        `<vertex x="${c.positions[i * 3]}" y="${c.positions[i * 3 + 1]}" z="${c.positions[i * 3 + 2]}"/>`,
    ).join('');
    const tris = Array.from(
      { length: 12 },
      (_, i) =>
        `<triangle v1="${c.indices[i * 3]}" v2="${c.indices[i * 3 + 1]}" v3="${c.indices[i * 3 + 2]}"/>`,
    ).join('');
    const sub = `<?xml version="1.0"?><model unit="millimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02"><resources><object id="1" type="model"><mesh><vertices>${verts}</vertices><triangles>${tris}</triangles></mesh></object></resources><build/></model>`;
    const root = `<?xml version="1.0"?><model unit="centimeter" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02" xmlns:p="http://schemas.microsoft.com/3dmanufacturing/production/2015/06"><resources><object id="2" name="Helmet_L" type="model"><components><component p:path="/3D/Objects/object_1.model" objectid="1" transform="2 0 0 0 2 0 0 0 2 0 0 0"/></components></object></resources><build><item objectid="2" transform="1 0 0 0 1 0 0 0 1 5 0 0"/></build></model>`;
    const rels = `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/></Relationships>`;
    const zip = zipSync({
      '_rels/.rels': strToU8(rels),
      '3D/3dmodel.model': strToU8(root),
      '3D/Objects/object_1.model': strToU8(sub),
    });
    const r = parse3mf(zip.buffer as ArrayBuffer);
    expect(r.declaredUnit).toBe('cm');
    expect(r.parts).toHaveLength(1);
    expect(r.parts[0].name).toBe('Helmet_L');
    expect(signedVolume(r.parts[0].mesh)).toBeCloseTo(0.2 ** 3, 6);
    const xs = Array.from(r.parts[0].mesh.positions).filter((_, i) => i % 3 === 0);
    expect(Math.min(...xs)).toBeCloseTo(5, 6);
    expect(Math.max(...xs)).toBeCloseTo(5.2, 6);
  });
});

describe('parseMeshFile', () => {
  it('dispatches on extension and rejects unknown types', () => {
    const buf = writeStl(cube());
    expect(parseMeshFile('Pauldron_L.STL', buf).parts[0].name).toBe('Pauldron_L');
    expect(() => parseMeshFile('x.blend', buf)).toThrow(/Unsupported/);
  });
});
