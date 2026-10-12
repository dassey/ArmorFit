import {
  ACESFilmicToneMapping,
  Box3,
  Matrix4,
  WebGLRenderTarget,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
  CanvasTexture,
} from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { regionColor } from '../core/body/regions';

export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 10, 20000);
  readonly controls: OrbitControls;
  readonly world = new Group();
  private bodyMesh: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  private regionColors: Float32Array | null = null;
  private needsRender = true;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private framed = false;

  constructor(readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-label', '3D view of the mannequin and armor');
    container.appendChild(this.renderer.domElement);

    this.scene.background = new Color(0x1b1e24);
    this.scene.add(this.world);
    this.scene.add(new HemisphereLight(0xf2f4ff, 0x30302c, 1.4));
    const key = new DirectionalLight(0xffffff, 2.2);
    key.position.set(1500, 3000, 2500);
    this.scene.add(key);
    const rim = new DirectionalLight(0x9fb8ff, 0.9);
    rim.position.set(-2500, 1500, -2500);
    this.scene.add(rim);
    this.scene.add(this.makeFloor());

    this.camera.position.set(900, 1300, 3600);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 950, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 250;
    this.controls.maxDistance = 9000;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.addEventListener('change', () => this.requestRender());

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  private makeFloor(): Mesh {
    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    g.addColorStop(0, 'rgba(0,0,0,0.55)');
    g.addColorStop(0.45, 'rgba(0,0,0,0.25)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    const disc = new Mesh(
      new CircleGeometry(700, 48),
      new MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }),
    );
    disc.rotation.x = -Math.PI / 2;
    disc.position.y = 0.5;
    return disc;
  }

  requestRender(): void {
    this.needsRender = true;
  }

  private loop = () => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const moving = this.controls.update();
    if (moving || this.needsRender) {
      this.needsRender = false;
      this.renderer.render(this.scene, this.camera);
    }
  };

  private resize(): void {
    const w = Math.max(1, this.container.clientWidth);
    const h = Math.max(1, this.container.clientHeight);
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.requestRender();
  }

  setBodyTopology(indices: Uint16Array, regions: Uint8Array): void {
    const geom = new BufferGeometry();
    const n = regions.length;
    geom.setAttribute('position', new BufferAttribute(new Float32Array(n * 3), 3));
    geom.setAttribute('normal', new BufferAttribute(new Float32Array(n * 3), 3));
    this.regionColors = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) this.regionColors.set(regionColor(regions[i]), i * 3);
    geom.setAttribute('color', new BufferAttribute(new Float32Array(n * 3).fill(1), 3));
    geom.setIndex(new BufferAttribute(indices, 1));
    const mat = new MeshStandardMaterial({
      color: 0xcfc6ba,
      roughness: 0.68,
      metalness: 0,
      vertexColors: true,
    });
    this.bodyMesh = new Mesh(geom, mat);
    this.bodyMesh.name = 'mannequin';
    this.world.add(this.bodyMesh);
    this.requestRender();
  }

  updateBody(positions: Float32Array, normals: Float32Array): void {
    if (!this.bodyMesh) return;
    const g = this.bodyMesh.geometry;
    (g.getAttribute('position') as BufferAttribute).copyArray(positions).needsUpdate = true;
    (g.getAttribute('normal') as BufferAttribute).copyArray(normals).needsUpdate = true;
    g.computeBoundingBox();
    g.computeBoundingSphere();
    if (!this.framed) {
      this.frameBody();
      this.framed = true;
    }
    this.requestRender();
  }

  setShowRegions(show: boolean): void {
    if (!this.bodyMesh || !this.regionColors) return;
    const attr = this.bodyMesh.geometry.getAttribute('color') as BufferAttribute;
    if (show) attr.copyArray(this.regionColors);
    else (attr.array as Float32Array).fill(1);
    attr.needsUpdate = true;
    this.bodyMesh.material.color.set(show ? 0xffffff : 0xcfc6ba);
    this.requestRender();
  }

  frameBody(): void {
    const box = this.bodyMesh?.geometry.boundingBox;
    if (!box) return;
    const center = box.getCenter(new Vector3());
    const height = box.max.y - box.min.y;
    const dist = (height * 0.62) / Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    this.controls.target.copy(center);
    this.camera.position.set(center.x + dist * 0.28, center.y + height * 0.08, center.z + dist);
    this.controls.update();
    this.requestRender();
  }

  get bodyObject(): Mesh | null {
    return this.bodyMesh;
  }

  addObject(obj: Mesh): void {
    this.world.add(obj);
    this.requestRender();
  }

  removeObject(obj: Mesh): void {
    this.world.remove(obj);
    this.requestRender();
  }

  renderThumbnail(
    geometry: BufferGeometry,
    matrix: Matrix4,
    viewDir: [number, number, number],
    size = 112,
  ): string {
    const scene = new Scene();
    scene.add(new HemisphereLight(0xffffff, 0x404040, 2.2));
    const key = new DirectionalLight(0xffffff, 1.6);
    key.position.set(viewDir[0] * 1000 + 300, viewDir[1] * 1000 + 600, viewDir[2] * 1000 + 300);
    scene.add(key);
    const mesh = new Mesh(
      geometry,
      new MeshStandardMaterial({ color: 0x9fb3c8, metalness: 0.2, roughness: 0.5 }),
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(matrix);
    mesh.updateMatrixWorld(true);
    scene.add(mesh);
    const box = new Box3().setFromObject(mesh);
    const center = box.getCenter(new Vector3());
    const radius = box.getSize(new Vector3()).length() / 2 || 1;
    const cam = new PerspectiveCamera(30, 1, radius * 0.1, radius * 10);
    const dist = radius / Math.sin((15 * Math.PI) / 180);
    cam.position.set(
      center.x + viewDir[0] * dist,
      center.y + viewDir[1] * dist,
      center.z + viewDir[2] * dist,
    );
    cam.lookAt(center);
    const rt = new WebGLRenderTarget(size, size, { samples: 4 });
    const prevTarget = this.renderer.getRenderTarget();
    const prevTone = this.renderer.toneMapping;
    this.renderer.toneMapping = 0;
    this.renderer.setRenderTarget(rt);
    this.renderer.setClearColor(0x23272f, 1);
    this.renderer.clear();
    this.renderer.render(scene, cam);
    const px = new Uint8Array(size * size * 4);
    this.renderer.readRenderTargetPixels(rt, 0, 0, size, size, px);
    this.renderer.setRenderTarget(prevTarget);
    this.renderer.toneMapping = prevTone;
    this.renderer.setClearColor(0x000000, 0);
    rt.dispose();
    (mesh.material as MeshStandardMaterial).dispose();
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(size, size);
    const toSrgb = (c: number) => {
      const v = c / 255;
      return 255 * (v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055);
    };
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const s = ((size - 1 - y) * size + x) * 4;
        const d = (y * size + x) * 4;
        img.data[d] = toSrgb(px[s]);
        img.data[d + 1] = toSrgb(px[s + 1]);
        img.data[d + 2] = toSrgb(px[s + 2]);
        img.data[d + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);
    this.requestRender();
    return canvas.toDataURL('image/png');
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.resizeObserver.disconnect();
    this.controls.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
