import type { Matrix4 } from 'three';
import type { Vec3 } from '../math/linalg';
import { autoSize } from './autosize';
import type { BodyQuery } from './bodyQuery';
import type { ClearanceSettings } from './clearance';

export function settleOffset(
  points: Float32Array,
  normals: Float32Array,
  placement: Matrix4,
  direction: Vec3,
  scale: [number, number, number],
  mirrored: boolean,
  body: BodyQuery,
  settings: ClearanceSettings,
  iterations = 8,
): number {
  const r = autoSize(
    { samplePoints: points, sampleNormals: normals },
    placement,
    direction,
    scale,
    mirrored,
    body,
    settings,
    {
      mode: 'offset',
      iterations,
      category: 'shell',
    },
  );
  return r.offset;
}
