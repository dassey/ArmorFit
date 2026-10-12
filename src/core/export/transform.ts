import { Matrix4 } from 'three';
import { flipWinding } from '../mesh/normals';
import { computeBounds, type MeshData } from '../mesh/types';

export type ExportOrientation = 'original' | 'wearing';

export interface ExportSpec {
  unitScale: number;
  orientation: number[];
  scale: [number, number, number];
  mirrored: boolean;
}

const Y_UP_TO_Z_UP = new Matrix4().set(1, 0, 0, 0, 0, 0, -1, 0, 0, 1, 0, 0, 0, 0, 0, 1);

export function exportMatrix(spec: ExportSpec, orientation: ExportOrientation): Matrix4 {
  const U = new Matrix4().makeScale(spec.unitScale, spec.unitScale, spec.unitScale);
  const O = new Matrix4().fromArray(spec.orientation);
  const SM = new Matrix4().makeScale(
    spec.mirrored ? -spec.scale[0] : spec.scale[0],
    spec.scale[1],
    spec.scale[2],
  );
  const inW = SM.multiply(O).multiply(U);
  if (orientation === 'wearing') return Y_UP_TO_Z_UP.clone().multiply(inW);
  return new Matrix4().copy(O).invert().multiply(inW);
}

export function transformPositions(p: ArrayLike<number>, m: Matrix4): Float32Array {
  const e = m.elements;
  const out = new Float32Array(p.length);
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i];
    const y = p[i + 1];
    const z = p[i + 2];
    out[i] = e[0] * x + e[4] * y + e[8] * z + e[12];
    out[i + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
    out[i + 2] = e[2] * x + e[6] * y + e[10] * z + e[14];
  }
  return out;
}

export function bakeForPrint(mesh: MeshData, m: Matrix4): MeshData {
  const out = transformPositions(mesh.positions, m);
  const indices = mesh.indices.slice();
  if (m.determinant() < 0) flipWinding(indices);
  const b = computeBounds(out);
  const cx = (b.min[0] + b.max[0]) / 2;
  const cy = (b.min[1] + b.max[1]) / 2;
  for (let i = 0; i < out.length; i += 3) {
    out[i] -= cx;
    out[i + 1] -= cy;
    out[i + 2] -= b.min[2];
  }
  return { positions: out, indices };
}

export function fileSafe(name: string): string {
  return (
    name
      .replace(/[^\w\s.-]+/g, '')
      .trim()
      .replace(/\s+/g, '_')
      .slice(0, 80) || 'piece'
  );
}
