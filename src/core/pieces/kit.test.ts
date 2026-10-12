import { Matrix4, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import type { MeshData } from '../mesh/types';
import { computeBounds } from '../mesh/types';
import { makeChestPlate, makeForearmTube, makeHelmet, makePauldron } from '../testmeshes/pieces';
import { guessFromFileName } from './classify';
import { detectKits, kitOrientation, type KitInput } from './kit';

const W_TO_FILE = new Matrix4().set(-1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

function transform(mesh: MeshData, m: Matrix4): MeshData {
  const positions = new Float32Array(mesh.positions.length);
  const v = new Vector3();
  for (let i = 0; i < positions.length; i += 3) {
    v.set(mesh.positions[i], mesh.positions[i + 1], mesh.positions[i + 2]).applyMatrix4(m);
    positions[i] = v.x;
    positions[i + 1] = v.y;
    positions[i + 2] = v.z;
  }
  return { positions, indices: mesh.indices };
}

function half(mesh: MeshData, keep: (z: number) => boolean): MeshData {
  const idx: number[] = [];
  for (let f = 0; f < mesh.indices.length; f += 3) {
    let z = 0;
    for (let k = 0; k < 3; k++) z += mesh.positions[mesh.indices[f + k] * 3 + 2];
    if (keep(z / 3)) idx.push(mesh.indices[f], mesh.indices[f + 1], mesh.indices[f + 2]);
  }
  return { positions: mesh.positions, indices: new Uint32Array(idx) };
}

const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);
const mirrorX = new Matrix4().makeScale(-1, 1, 1);

function wearingSet(): { name: string; mesh: MeshData }[] {
  const tube = makeForearmTube();
  const tPose = new Matrix4().makeRotationZ(-Math.PI / 2);
  const out: { name: string; mesh: MeshData }[] = [
    { name: 'Helmet.stl', mesh: transform(makeHelmet(), at(0, 1640, 0)) },
    { name: 'Chest Plate.stl', mesh: transform(makeChestPlate(), at(0, 1300, 40)) },
    {
      name: 'Back Plate.stl',
      mesh: transform(makeChestPlate(), at(0, 1300, -40).multiply(new Matrix4().makeRotationY(Math.PI))),
    },
    { name: 'Pauldron Left.stl', mesh: transform(makePauldron(), at(190, 1450, 0)) },
    { name: 'Pauldron Right.stl', mesh: transform(makePauldron(), at(-190, 1450, 0).multiply(mirrorX)) },
    {
      name: 'Forearm Left Top.stl',
      mesh: transform(
        half(tube, (z) => z >= 0),
        at(560, 1360, 0).multiply(tPose),
      ),
    },
    {
      name: 'Forearm Left Bottom.stl',
      mesh: transform(
        half(tube, (z) => z < 0),
        at(560, 1360, 0).multiply(tPose),
      ),
    },
    {
      name: 'Forearm Right.stl',
      mesh: transform(tube, at(-560, 1360, 0).multiply(mirrorX).multiply(tPose)),
    },
    {
      name: 'Thigh Left.stl',
      mesh: transform(tube, at(100, 720, 0).multiply(new Matrix4().makeScale(1.7, 1.4, 1.7))),
    },
    {
      name: 'Thigh Right.stl',
      mesh: transform(tube, at(-100, 720, 0).multiply(new Matrix4().makeScale(1.7, 1.4, 1.7))),
    },
    {
      name: 'Knee Left.stl',
      mesh: transform(
        makePauldron(),
        at(100, 480, 60)
          .multiply(new Matrix4().makeRotationY(-Math.PI / 2))
          .multiply(new Matrix4().makeScale(0.6, 0.6, 0.6)),
      ),
    },
    {
      name: 'Knee Right.stl',
      mesh: transform(
        makePauldron(),
        at(-100, 480, 60)
          .multiply(new Matrix4().makeRotationY(-Math.PI / 2))
          .multiply(new Matrix4().makeScale(0.6, 0.6, 0.6)),
      ),
    },
  ];
  return out;
}

function inputs(set: { name: string; mesh: MeshData }[], toFile = W_TO_FILE): KitInput[] {
  return set.map((p, i) => {
    const g = guessFromFileName(p.name);
    return {
      id: `p${i}`,
      name: p.name,
      type: g.type,
      side: g.side,
      confidence: g.confidence,
      mesh: transform(p.mesh, toFile),
    };
  });
}

function axisOf(rotation: number[], v: [number, number, number]): Vector3 {
  return new Vector3(...v).applyMatrix4(new Matrix4().fromArray(rotation));
}

describe('detectKits', () => {
  it('finds one assembled body set and recovers its frame from a Z-up file layout', () => {
    const kits = detectKits(inputs(wearingSet()));
    expect(kits).toHaveLength(1);
    const k = kits[0];
    expect(k.kind).toBe('body');
    expect(k.units.best.unit).toBe('mm');
    expect(k.members).toHaveLength(12);
    expect(axisOf(k.rotation, [-1, 0, 0]).x).toBeCloseTo(1, 3);
    expect(axisOf(k.rotation, [0, 0, 1]).y).toBeCloseTo(1, 3);
    expect(axisOf(k.rotation, [0, 1, 0]).z).toBeCloseTo(1, 3);
  });

  it('groups the halves of a clamshell bracer so they move together', () => {
    const k = detectKits(inputs(wearingSet()))[0];
    const top = k.members.find((m) => m.id === 'p5')!;
    const bottom = k.members.find((m) => m.id === 'p6')!;
    expect(top.group).not.toBeNull();
    expect(top.group).toBe(bottom.group);
    expect(top.origin).toEqual(bottom.origin);
  });

  it('works out which way chest, back and knee plates face', () => {
    const k = detectKits(inputs(wearingSet()))[0];
    const by = (id: string) => k.members.find((m) => m.id === id)!;
    expect(by('p1').outward[2]).toBeGreaterThan(0.7);
    expect(by('p2').outward[2]).toBeLessThan(-0.7);
    expect(by('p10').outward[2]).toBeGreaterThan(0.5);
  });

  it('builds orientations that put every member into the shared wearing frame', () => {
    const set = wearingSet();
    const ins = inputs(set);
    const k = detectKits(ins)[0];
    const base = {
      matrix: [],
      category: 'shell' as const,
      confidence: 1,
      reasons: [],
      contactPoint: [0, 0, 0] as [number, number, number],
      contactNormal: [0, 0, 1] as [number, number, number],
      center: [0, 0, 0] as [number, number, number],
      enclosure: 0,
      openings: [],
      radius: 0,
    };
    const chest = k.members.find((m) => m.id === 'p1')!;
    const o = kitOrientation(k, 'p1', base);
    const M = new Matrix4().fromArray(o.matrix);
    const w = transform(ins[1].mesh, M);
    const b = computeBounds(w.positions);
    const original = computeBounds(set[1].mesh.positions);
    for (let a = 0; a < 3; a++) {
      expect(b.max[a] - b.min[a]).toBeCloseTo(original.max[a] - original.min[a], 0);
      expect((b.max[a] + b.min[a]) / 2).toBeCloseTo(
        (original.max[a] + original.min[a]) / 2 - chest.origin[a],
        0,
      );
    }
  });

  it('ignores files laid out flat on a print bed', () => {
    const bedded = wearingSet().map((p) => {
      const file = transform(p.mesh, W_TO_FILE);
      const b = computeBounds(file.positions);
      return {
        name: p.name,
        mesh: transform(file, at(-(b.min[0] + b.max[0]) / 2, -(b.min[1] + b.max[1]) / 2, -b.min[2])),
      };
    });
    expect(detectKits(inputs(bedded, new Matrix4()))).toEqual([]);
  });

  it('splits a helmet drawn in its own frame off the body set', () => {
    const helmet = makeHelmet();
    const set = wearingSet().filter((p) => p.name !== 'Helmet.stl');
    set.push({
      name: 'Helmet Dome.stl',
      mesh: transform(
        half(helmet, (z) => z < 20),
        at(0, 300, 0),
      ),
    });
    set.push({
      name: 'Helmet Visor.stl',
      mesh: transform(
        half(helmet, (z) => z >= 20),
        at(0, 300, 0),
      ),
    });
    const kits = detectKits(inputs(set));
    expect(kits.map((k) => k.kind).sort()).toEqual(['body', 'part']);
    const part = kits.find((k) => k.kind === 'part')!;
    expect(part.type).toBe('helmet');
    expect(part.members).toHaveLength(2);
    expect(new Set(part.members.map((m) => m.group)).size).toBe(1);
    expect(kits.find((k) => k.kind === 'body')!.members).toHaveLength(11);
  });

  it('returns nothing for a single file', () => {
    expect(detectKits(inputs(wearingSet().slice(0, 1)))).toEqual([]);
  });
});
