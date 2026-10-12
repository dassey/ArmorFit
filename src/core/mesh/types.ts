export interface MeshData {
  positions: Float32Array;
  indices: Uint32Array;
  normals?: Float32Array;
}

export function triangleCount(mesh: MeshData): number {
  return mesh.indices.length / 3;
}

export function vertexCount(mesh: MeshData): number {
  return mesh.positions.length / 3;
}

export function meshTransferables(mesh: MeshData): ArrayBuffer[] {
  const out: ArrayBuffer[] = [mesh.positions.buffer as ArrayBuffer, mesh.indices.buffer as ArrayBuffer];
  if (mesh.normals) out.push(mesh.normals.buffer as ArrayBuffer);
  return out;
}

export function cloneMesh(mesh: MeshData): MeshData {
  return {
    positions: mesh.positions.slice(),
    indices: mesh.indices.slice(),
    normals: mesh.normals?.slice(),
  };
}

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
}

export function computeBounds(positions: Float32Array): Bounds {
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < positions.length; i += 3) {
    for (let k = 0; k < 3; k++) {
      const v = positions[i + k];
      if (v < min[k]) min[k] = v;
      if (v > max[k]) max[k] = v;
    }
  }
  return { min, max };
}

export function boundsSize(b: Bounds): [number, number, number] {
  return [b.max[0] - b.min[0], b.max[1] - b.min[1], b.max[2] - b.min[2]];
}

export function boundsCenter(b: Bounds): [number, number, number] {
  return [(b.max[0] + b.min[0]) / 2, (b.max[1] + b.min[1]) / 2, (b.max[2] + b.min[2]) / 2];
}
