import { MeshoptSimplifier } from 'meshoptimizer/simplifier';
import type { MeshData } from './types';
import { compactVertices } from './weld';

export async function decimate(
  mesh: MeshData,
  maxTriangles: number,
): Promise<{ mesh: MeshData; error: number }> {
  const tris = mesh.indices.length / 3;
  if (tris <= maxTriangles) return { mesh, error: 0 };
  await MeshoptSimplifier.ready;
  const [idx, relError] = MeshoptSimplifier.simplify(
    mesh.indices,
    mesh.positions,
    3,
    maxTriangles * 3,
    0.01,
    [],
  );
  let out = idx;
  if (out.length / 3 > maxTriangles * 1.05) {
    [out] = MeshoptSimplifier.simplifySloppy(mesh.indices, mesh.positions, 3, null, maxTriangles * 3, 0.02);
  }
  const absError = relError * MeshoptSimplifier.getScale(mesh.positions, 3);
  return { mesh: compactVertices({ positions: mesh.positions, indices: out }), error: absError };
}
