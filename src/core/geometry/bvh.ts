import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Vec3 } from '../math/linalg';
import type { MeshData } from '../mesh/types';

export function meshToGeometry(mesh: MeshData, copyIndex = true): BufferGeometry {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(mesh.positions, 3));
  if (mesh.normals) g.setAttribute('normal', new BufferAttribute(mesh.normals, 3));
  g.setIndex(new BufferAttribute(copyIndex ? mesh.indices.slice() : mesh.indices, 1));
  return g;
}

export function buildBVH(mesh: MeshData): { bvh: MeshBVH; geometry: BufferGeometry } {
  const geometry = meshToGeometry(mesh);
  const bvh = new MeshBVH(geometry, { targetLeafSize: 10 });
  return { bvh, geometry };
}

const _ray = new Ray();

export function rayDistance(bvh: MeshBVH, origin: Vec3, dir: Vec3, far = Infinity): number {
  _ray.origin.set(origin[0], origin[1], origin[2]);
  _ray.direction.set(dir[0], dir[1], dir[2]);
  const hit = bvh.raycastFirst(_ray, DoubleSide, 0, far);
  return hit ? hit.distance : Infinity;
}

export function fibonacciDirections(n: number): Float64Array {
  const out = new Float64Array(n * 3);
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - ((i + 0.5) / n) * 2;
    const r = Math.sqrt(1 - y * y);
    const th = golden * i;
    out[i * 3] = Math.cos(th) * r;
    out[i * 3 + 1] = y;
    out[i * 3 + 2] = Math.sin(th) * r;
  }
  return out;
}

export const _v = new Vector3();
