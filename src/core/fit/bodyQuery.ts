import { BufferAttribute, BufferGeometry, DoubleSide, Ray, Vector3 } from 'three';
import { MeshBVH } from 'three-mesh-bvh';
import type { Vec3 } from '../math/linalg';

export interface SurfaceHit {
  face: number;
  point: Vec3;
  bary: [number, number, number];
  normal: Vec3;
  distance: number;
}

export interface DistanceResult {
  distance: number;
  point: Vec3;
  face: number;
  normal: Vec3;
  region: number;
}

export class BodyQuery {
  readonly geometry: BufferGeometry;
  readonly bvh: MeshBVH;
  private positions: Float32Array;
  private normals: Float32Array;
  private readonly indices: Uint16Array | Uint32Array;
  private readonly regions: Uint8Array;
  private readonly ray = new Ray();
  private readonly tmp = new Vector3();
  private readonly target = { point: new Vector3(), distance: 0, faceIndex: 0 };

  constructor(
    positions: Float32Array,
    normals: Float32Array,
    indices: Uint16Array | Uint32Array,
    regions: Uint8Array,
  ) {
    this.positions = positions;
    this.normals = normals;
    this.indices = indices;
    this.regions = regions;
    this.geometry = new BufferGeometry();
    this.geometry.setAttribute('position', new BufferAttribute(positions, 3));
    this.geometry.setIndex(new BufferAttribute(indices, 1));
    this.bvh = new MeshBVH(this.geometry, { indirect: true, targetLeafSize: 8 });
  }

  update(positions: Float32Array, normals: Float32Array): void {
    this.positions = positions;
    this.normals = normals;
    const attr = this.geometry.getAttribute('position') as BufferAttribute;
    attr.array = positions;
    attr.needsUpdate = true;
    this.bvh.refit();
  }

  private bary(face: number, p: Vec3): [number, number, number] {
    const P = this.positions;
    const I = this.indices;
    const a = I[face * 3] * 3;
    const b = I[face * 3 + 1] * 3;
    const c = I[face * 3 + 2] * 3;
    const v0 = [P[b] - P[a], P[b + 1] - P[a + 1], P[b + 2] - P[a + 2]];
    const v1 = [P[c] - P[a], P[c + 1] - P[a + 1], P[c + 2] - P[a + 2]];
    const v2 = [p[0] - P[a], p[1] - P[a + 1], p[2] - P[a + 2]];
    const d00 = v0[0] * v0[0] + v0[1] * v0[1] + v0[2] * v0[2];
    const d01 = v0[0] * v1[0] + v0[1] * v1[1] + v0[2] * v1[2];
    const d11 = v1[0] * v1[0] + v1[1] * v1[1] + v1[2] * v1[2];
    const d20 = v2[0] * v0[0] + v2[1] * v0[1] + v2[2] * v0[2];
    const d21 = v2[0] * v1[0] + v2[1] * v1[1] + v2[2] * v1[2];
    const den = d00 * d11 - d01 * d01 || 1;
    const v = (d11 * d20 - d01 * d21) / den;
    const w = (d00 * d21 - d01 * d20) / den;
    return [1 - v - w, v, w];
  }

  private smoothNormal(face: number, bary: [number, number, number]): Vec3 {
    const N = this.normals;
    const I = this.indices;
    const n: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) {
      const v = I[face * 3 + k] * 3;
      n[0] += bary[k] * N[v];
      n[1] += bary[k] * N[v + 1];
      n[2] += bary[k] * N[v + 2];
    }
    const l = Math.hypot(n[0], n[1], n[2]) || 1;
    return [n[0] / l, n[1] / l, n[2] / l];
  }

  raycast(origin: Vec3, dir: Vec3, far = Infinity): SurfaceHit | null {
    this.ray.origin.set(origin[0], origin[1], origin[2]);
    this.ray.direction.set(dir[0], dir[1], dir[2]).normalize();
    const hit = this.bvh.raycastFirst(this.ray, DoubleSide, 0, far);
    if (!hit || hit.faceIndex == null) return null;
    const point: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
    const bary = this.bary(hit.faceIndex, point);
    return {
      face: hit.faceIndex,
      point,
      bary,
      normal: this.smoothNormal(hit.faceIndex, bary),
      distance: hit.distance,
    };
  }

  distance(p: Vec3, maxDistance = Infinity): DistanceResult | null {
    this.tmp.set(p[0], p[1], p[2]);
    const hit = this.bvh.closestPointToPoint(this.tmp, this.target, 0, maxDistance);
    if (!hit) return null;
    const point: Vec3 = [hit.point.x, hit.point.y, hit.point.z];
    const bary = this.bary(hit.faceIndex, point);
    const normal = this.smoothNormal(hit.faceIndex, bary);
    const d = [p[0] - point[0], p[1] - point[1], p[2] - point[2]];
    const sign = d[0] * normal[0] + d[1] * normal[1] + d[2] * normal[2] < 0 ? -1 : 1;
    let k = 0;
    if (bary[1] > bary[k]) k = 1;
    if (bary[2] > bary[k]) k = 2;
    const region = this.regions[this.indices[hit.faceIndex * 3 + k]];
    return { distance: sign * hit.distance, point, face: hit.faceIndex, normal, region };
  }
}
