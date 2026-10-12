import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DoubleSide,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  type Intersection,
  type Raycaster,
} from 'three';
import { acceleratedRaycast, computeBoundsTree, MeshBVH } from 'three-mesh-bvh';
import type { MeshData } from '../core/mesh/types';

void computeBoundsTree;

const BASE_COLOR = new Color(0x9fb3c8);
const SELECTED_EMISSIVE = new Color(0x3a2a08);

export class PieceView {
  readonly mesh: Mesh<BufferGeometry, MeshStandardMaterial>;
  private readonly baseMat: MeshStandardMaterial;
  private readonly heatMat: MeshStandardMaterial;
  private ghost = false;
  private bvh: MeshBVH | null = null;

  constructor(
    readonly id: string,
    preview: MeshData,
  ) {
    const g = new BufferGeometry();
    g.setAttribute('position', new BufferAttribute(preview.positions, 3));
    if (preview.normals) g.setAttribute('normal', new BufferAttribute(preview.normals, 3));
    else g.computeVertexNormals();
    g.setAttribute('color', new BufferAttribute(new Float32Array(preview.positions.length).fill(1), 3));
    g.setIndex(new BufferAttribute(preview.indices, 1));
    g.computeBoundingSphere();
    this.baseMat = new MeshStandardMaterial({
      color: BASE_COLOR,
      metalness: 0.25,
      roughness: 0.48,
      side: DoubleSide,
    });
    this.heatMat = new MeshStandardMaterial({
      vertexColors: true,
      metalness: 0,
      roughness: 0.65,
      side: DoubleSide,
    });
    this.mesh = new Mesh(g, this.baseMat);
    this.mesh.name = `piece:${id}`;
    this.mesh.userData.pieceId = id;
    this.mesh.matrixAutoUpdate = false;
    this.mesh.raycast = function (this: Mesh, raycaster: Raycaster, intersects: Intersection[]) {
      acceleratedRaycast.call(this, raycaster, intersects);
    };
  }

  setMatrix(m: Matrix4): void {
    this.mesh.matrix.copy(m);
    this.mesh.matrixWorldNeedsUpdate = true;
  }

  ensureBVH(): void {
    if (this.bvh) return;
    this.bvh = new MeshBVH(this.mesh.geometry, { indirect: true });
    this.mesh.geometry.boundsTree = this.bvh;
  }

  setSelected(on: boolean): void {
    for (const m of [this.baseMat, this.heatMat]) m.emissive.copy(on ? SELECTED_EMISSIVE : new Color(0));
  }

  setGhost(on: boolean): void {
    this.ghost = on;
    this.applyOpacity(on ? 0.45 : 1);
    this.baseMat.color.set(on ? 0xe0a43a : BASE_COLOR);
  }

  setOpacity(opacity: number): void {
    if (!this.ghost) this.applyOpacity(opacity);
  }

  private applyOpacity(opacity: number) {
    for (const m of [this.baseMat, this.heatMat]) {
      m.transparent = opacity < 0.999;
      m.opacity = opacity;
      m.depthWrite = opacity >= 0.999;
      m.needsUpdate = true;
    }
  }

  setHeatmap(colors: Float32Array | null): void {
    if (colors) {
      const attr = this.mesh.geometry.getAttribute('color') as BufferAttribute;
      attr.copyArray(colors);
      attr.needsUpdate = true;
      this.mesh.material = this.heatMat;
    } else {
      this.mesh.material = this.baseMat;
    }
  }

  get geometry(): BufferGeometry {
    return this.mesh.geometry;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.baseMat.dispose();
    this.heatMat.dispose();
  }
}
