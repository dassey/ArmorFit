import { readFileSync } from 'node:fs';
import { Matrix4, Vector3 } from 'three';
import { beforeAll, describe, expect, it } from 'vitest';
import { parseBodyAsset } from '../body/asset';
import { MannequinBuilder } from '../body/mannequin';
import { buildSkeleton, pointOnBone } from '../body/skeleton';
import { v3 } from '../math/linalg';
import { newProfile } from '../measurements/profile';
import type { MeshData } from '../mesh/types';
import { guessFromFileName } from '../pieces/classify';
import { detectKits, type KitInfo } from '../pieces/kit';
import { makeChestPlate, makeForearmTube, makeHelmet, makePauldron } from '../testmeshes/pieces';
import { BodyQuery } from './bodyQuery';
import { homeAnchor } from './homes';
import { kitPlacements, type KitBody } from './kitPlacement';
import { placementMatrix, uprightRotation } from './placement';
import { Quaternion } from 'three';

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

const at = (x: number, y: number, z: number) => new Matrix4().makeTranslation(x, y, z);

let body: KitBody;
let kit: KitInfo;

beforeAll(() => {
  const asset = parseBodyAsset(readFileSync('public/assets/body/hm08.armorfit.bin.gz'));
  const m = new MannequinBuilder(asset).build(newProfile());
  body = {
    query: new BodyQuery(m.positions, m.normals, asset.indices, asset.regions),
    bones: buildSkeleton(m.joints, m.landmarks),
    landmarks: m.landmarks,
    positions: m.positions,
    normals: m.normals,
    indices: asset.indices,
  };
  const s = 1.12;
  const tube = makeForearmTube();
  const tPose = new Matrix4().makeRotationZ(-Math.PI / 2);
  const set: [string, MeshData][] = [
    ['Helmet.stl', transform(makeHelmet(), at(0, 1640 * s, 0))],
    ['Chest Plate.stl', transform(makeChestPlate(), at(0, 1300 * s, 40))],
    [
      'Back Plate.stl',
      transform(makeChestPlate(), at(0, 1300 * s, -40).multiply(new Matrix4().makeRotationY(Math.PI))),
    ],
    ['Pauldron Left.stl', transform(makePauldron(), at(190 * s, 1450 * s, 0))],
    ['Forearm Left.stl', transform(tube, at(560 * s, 1360 * s, 0).multiply(tPose))],
    [
      'Thigh Left.stl',
      transform(tube, at(100 * s, 720 * s, 0).multiply(new Matrix4().makeScale(1.7, 1.4, 1.7))),
    ],
    [
      'Thigh Right.stl',
      transform(tube, at(-100 * s, 720 * s, 0).multiply(new Matrix4().makeScale(1.7, 1.4, 1.7))),
    ],
  ];
  kit = detectKits(
    set.map(([name, mesh], i) => {
      const g = guessFromFileName(name);
      return { id: `p${i}`, name, type: g.type, side: g.side, confidence: g.confidence, mesh };
    }),
  )[0];
});

function worldOf(id: string) {
  const spec = kitPlacements(kit, body).get(id)!;
  const m = kit.members.find((x) => x.id === id)!;
  return {
    spec,
    pos: new Vector3().setFromMatrixPosition(placementMatrix(spec, body, { contactNormal: m.outward })),
  };
}

describe('kitPlacements', () => {
  it('detects the synthetic set', () => {
    expect(kit.kind).toBe('body');
    expect(kit.members).toHaveLength(7);
  });

  it('attaches each piece to the matching bone', () => {
    const bones = Object.fromEntries(
      kit.members.map((m) => [m.id, kitPlacements(kit, body).get(m.id)!.bone]),
    );
    expect(bones).toEqual({
      p0: 'head',
      p1: 'spine',
      p2: 'spine',
      p3: 'upperArmL',
      p4: 'forearmL',
      p5: 'thighL',
      p6: 'thighR',
    });
  });

  it('scales the layout to the mannequin height', () => {
    const chest = worldOf('p1').pos;
    const home = homeAnchor('chest', null, 'shell', body)!.point;
    expect(Math.abs(chest.y - home[1])).toBeLessThan(120);
    expect(chest.z).toBeGreaterThan(body.bones.spine.from[2]);
    expect(worldOf('p2').pos.z).toBeLessThan(body.bones.spine.from[2]);
  });

  it('turns T-pose arm pieces onto the arm and keeps tubes on their limb', () => {
    const { spec, pos } = worldOf('p4');
    expect(spec.t).toBeGreaterThanOrEqual(0.15);
    expect(spec.t).toBeLessThanOrEqual(0.85);
    const b = body.bones.forearmL;
    const onAxis = pointOnBone(b, spec.t);
    expect(v3.dist([pos.x, pos.y, pos.z], onAxis)).toBeLessThan(40);
    for (const id of ['p5', 'p6']) {
      const w = worldOf(id);
      const axis = pointOnBone(body.bones[w.spec.bone as 'thighL'], w.spec.t);
      expect(v3.dist([w.pos.x, w.pos.y, w.pos.z], axis)).toBeLessThan(40);
    }
  });

  it('follows the body when the mannequin changes', () => {
    const spec = kitPlacements(kit, body).get('p4')!;
    const before = new Vector3().setFromMatrixPosition(
      placementMatrix(spec, body, { contactNormal: [0, 1, 0] }),
    );
    const moved = {
      ...body,
      bones: {
        ...body.bones,
        forearmL: {
          ...body.bones.forearmL,
          from: v3.add(body.bones.forearmL.from, [0, -50, 0]),
          to: v3.add(body.bones.forearmL.to, [0, -50, 0]),
        },
      },
    };
    const after = new Vector3().setFromMatrixPosition(
      placementMatrix(spec, moved, { contactNormal: [0, 1, 0] }),
    );
    expect(after.y - before.y).toBeCloseTo(-50, 3);
  });
});

describe('uprightRotation', () => {
  it('turns a back-facing plate about the vertical instead of tipping it over', () => {
    const q = uprightRotation([0, 0, 1], [0, 0, -1], new Quaternion());
    const up = new Vector3(0, 1, 0).applyQuaternion(q);
    expect(up.y).toBeCloseTo(1, 6);
    const n = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(n.z).toBeCloseTo(-1, 6);
  });

  it('still tilts toward a sloped surface', () => {
    const q = uprightRotation([0, 0, 1], v3.norm([0, 0.5, 1]), new Quaternion());
    const n = new Vector3(0, 0, 1).applyQuaternion(q);
    expect(n.y).toBeCloseTo(v3.norm([0, 0.5, 1])[1], 6);
  });
});
