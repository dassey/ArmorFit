import {
  ACESFilmicToneMapping,
  Box3,
  Matrix4,
  WebGLRenderTarget,
  BufferAttribute,
  BufferGeometry,
  CircleGeometry,
  Color,
  RingGeometry,
  DirectionalLight,
  DoubleSide,
  FrontSide,
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
import { dummySeams, type DummyShape } from '../core/body/dummy';
import { parseDummyStyle, type DummyStyle } from '../core/body/dummyStyle';
import { REGIONS, regionColor } from '../core/body/regions';
import type { Vec3 } from '../core/math/linalg';
import { RulerLayer, type RulerDraw } from './Rulers';

const MAX_SEAMS = 16;

const DUMMY_UNIFORMS = {
  uTrim: { value: new Color() },
  uMarkerLight: { value: new Color() },
  uRim: { value: new Color() },
  uRimStrength: { value: 0.3 },
  uMarkers: { value: 1 },
  uSeams: { value: 1 },
  uVisor: { value: 0 },
  uLines: { value: 0 },
  uSeamCount: { value: 0 },
  uSeamAt: { value: Array.from({ length: MAX_SEAMS }, () => new Vector3()) },
  uSeamNormal: { value: Array.from({ length: MAX_SEAMS }, () => new Vector3()) },
  uSeamReach: { value: new Array<number>(MAX_SEAMS).fill(0) },
  uSeamRegions: { value: new Array<number>(MAX_SEAMS).fill(0) },
  uSeamSide: { value: new Array<number>(MAX_SEAMS).fill(0) },
};

// The mannequin is a dummy whose look is set by DummyStyle: body colour and gloss, joint seams, crash-test target
// markers (quarters in the trim colour), a dark glossy visor over the face, contour lines every 3 cm of height
// and a rim light. Hidden body parts (one-part views) are discarded; back faces show darker through the cut.
function dummyMaterial(): MeshStandardMaterial {
  const mat = new MeshStandardMaterial({ roughness: 0.4, metalness: 0.02, vertexColors: true });
  mat.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, DUMMY_UNIFORMS);
    shader.vertexShader = `attribute float keep;
      attribute float visor;
      attribute float region;
      attribute vec3 marker;
      varying float vKeep;
      varying float vVisor;
      flat varying float vRegion;
      varying vec3 vMarker;
      varying vec3 vWorld;
      ${shader.vertexShader}`
      .replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\nvKeep = keep;\nvVisor = visor;\nvRegion = region;\nvMarker = marker;',
      )
      .replace(
        '#include <project_vertex>',
        '#include <project_vertex>\nvWorld = (modelMatrix * vec4(transformed, 1.0)).xyz;',
      );
    shader.fragmentShader = `uniform vec3 uTrim;
      uniform vec3 uMarkerLight;
      uniform vec3 uRim;
      uniform float uRimStrength;
      uniform float uMarkers;
      uniform float uSeams;
      uniform float uVisor;
      uniform float uLines;
      uniform int uSeamCount;
      uniform vec3 uSeamAt[${MAX_SEAMS}];
      uniform vec3 uSeamNormal[${MAX_SEAMS}];
      uniform float uSeamReach[${MAX_SEAMS}];
      uniform int uSeamRegions[${MAX_SEAMS}];
      uniform int uSeamSide[${MAX_SEAMS}];
      varying float vKeep;
      varying float vVisor;
      flat varying float vRegion;
      varying vec3 vMarker;
      varying vec3 vWorld;
      ${shader.fragmentShader}`
      .replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\nif (vKeep < 0.0) discard;',
      )
      .replace(
        '#include <color_fragment>',
        `#include <color_fragment>
        float visorMix = smoothstep(0.35, 0.65, vVisor) * uVisor;
        float band = abs(fract(vWorld.y / 30.0 + 0.5) - 0.5) * 30.0;
        float line = (1.0 - smoothstep(0.0, fwidth(vWorld.y) * 1.3, band)) * (1.0 - visorMix) * uLines;
        diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb * 1.8 + 0.03, line * 0.3);
        if (uSeams > 0.5) {
          int code = int(vRegion + 0.5);
          int part = code >> 2;
          int side = code & 3;
          float sd = 1e4;
          for (int k = 0; k < ${MAX_SEAMS}; k++) {
            if (k >= uSeamCount) break;
            if ((uSeamRegions[k] & (1 << part)) == 0) continue;
            if (uSeamSide[k] != 0 && uSeamSide[k] != side) continue;
            vec3 d = vWorld - uSeamAt[k];
            if (length(d) > uSeamReach[k]) continue;
            sd = min(sd, abs(dot(d, uSeamNormal[k])));
          }
          float seamMix = 1.0 - smoothstep(2.5, 2.5 + length(fwidth(vWorld)) * 1.2, sd);
          diffuseColor.rgb = mix(diffuseColor.rgb, uTrim, seamMix);
        }
        if (uMarkers > 0.5 && vMarker.z > 0.5) {
          float r = length(vMarker.xy);
          float aa = max(fwidth(r), 0.001) * 1.2;
          float qa = smoothstep(-aa, aa, vMarker.x);
          float qb = smoothstep(-aa, aa, vMarker.y);
          float dark = max(qa * qb + (1.0 - qa) * (1.0 - qb), smoothstep(0.84 - aa, 0.84, r));
          vec3 target = mix(uMarkerLight, uTrim, dark);
          diffuseColor.rgb = mix(diffuseColor.rgb, target, 1.0 - smoothstep(1.0 - aa, 1.0, r));
        }
        diffuseColor.rgb = mix(diffuseColor.rgb, vec3(0.025, 0.028, 0.035), visorMix);
        if (!gl_FrontFacing) diffuseColor.rgb *= 0.45;`,
      )
      .replace(
        '#include <roughnessmap_fragment>',
        '#include <roughnessmap_fragment>\nroughnessFactor = mix(roughnessFactor, 0.28, visorMix);',
      )
      .replace(
        '#include <emissivemap_fragment>',
        `#include <emissivemap_fragment>
        float rim = 1.0 - clamp(dot(normal, normalize(vViewPosition)), 0.0, 1.0);
        totalEmissiveRadiance += uRim * pow(rim, 4.0) * uRimStrength * (1.0 - 0.6 * visorMix);`,
      );
  };
  return mat;
}

export class Viewport {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera = new PerspectiveCamera(32, 1, 10, 20000);
  readonly controls: OrbitControls;
  readonly world = new Group();
  private readonly rulers = new RulerLayer();
  private bodyMesh: Mesh<BufferGeometry, MeshStandardMaterial> | null = null;
  private style: DummyStyle = parseDummyStyle(null);
  private showRegions = false;
  private regionColors: Float32Array | null = null;
  private frameBox: Box3 | null = null;
  private needsRender = true;
  private raf = 0;
  private resizeObserver: ResizeObserver;
  private disposed = false;
  private framed = false;
  private autoFrame = true;

  constructor(readonly container: HTMLElement) {
    this.renderer = new WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = SRGBColorSpace;
    this.renderer.toneMapping = ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.05;
    this.renderer.domElement.style.touchAction = 'none';
    this.renderer.domElement.setAttribute('aria-label', '3D view of the mannequin and armor');
    container.appendChild(this.renderer.domElement);

    this.scene.background = this.makeBackdrop();
    this.scene.add(this.world);
    this.scene.add(new HemisphereLight(0xf2f4ff, 0x30302c, 1.6));
    const key = new DirectionalLight(0xffffff, 2.6);
    key.position.set(1500, 3000, 2500);
    this.scene.add(key);
    const rim = new DirectionalLight(0x9fb8ff, 1.4);
    rim.position.set(-2500, 1500, -2500);
    this.scene.add(rim);
    this.scene.add(this.makeFloor());
    this.scene.add(this.rulers.group);

    this.camera.position.set(900, 1300, 3600);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.target.set(0, 950, 0);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.12;
    this.controls.minDistance = 250;
    this.controls.maxDistance = 9000;
    this.controls.maxPolarAngle = Math.PI * 0.95;
    this.controls.addEventListener('change', () => this.requestRender());
    this.controls.addEventListener('start', () => (this.autoFrame = false));

    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);
    this.resize();
    this.loop();
  }

  private makeBackdrop(): CanvasTexture {
    const canvas = document.createElement('canvas');
    canvas.width = 64;
    canvas.height = 256;
    const ctx = canvas.getContext('2d')!;
    const g = ctx.createLinearGradient(0, 0, 0, 256);
    g.addColorStop(0, '#272c35');
    g.addColorStop(0.62, '#1c1f26');
    g.addColorStop(1, '#121418');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, 64, 256);
    const tex = new CanvasTexture(canvas);
    tex.colorSpace = SRGBColorSpace;
    return tex;
  }

  private makeFloor(): Group {
    const floor = new Group();
    floor.add(this.makeShadow());
    for (const [r, opacity] of [
      [520, 0.55],
      [560, 0.18],
    ] as const) {
      const ring = new Mesh(
        new RingGeometry(r - 4, r, 96),
        new MeshBasicMaterial({ color: 0xe0a43a, transparent: true, opacity, depthWrite: false }),
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = 1;
      floor.add(ring);
    }
    return floor;
  }

  private makeShadow(): Mesh {
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
      this.rulers.layout(this.camera);
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
    this.rulers.setViewport(w, h, this.camera.fov);
    this.requestRender();
  }

  setRulers(items: RulerDraw[]): void {
    this.rulers.set(items);
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
    geom.setAttribute('keep', new BufferAttribute(new Float32Array(n).fill(1), 1));
    geom.setAttribute('visor', new BufferAttribute(new Float32Array(n), 1));
    geom.setAttribute('region', new BufferAttribute(Float32Array.from(regions), 1));
    geom.setAttribute('marker', new BufferAttribute(new Float32Array(n * 3), 3));
    geom.setIndex(new BufferAttribute(indices, 1));
    this.bodyMesh = new Mesh(geom, dummyMaterial());
    this.applyStyle();
    this.bodyMesh.name = 'mannequin';
    this.world.add(this.bodyMesh);
    this.requestRender();
  }

  updateBody(shape: DummyShape, joints: Record<string, Vec3>): void {
    const seams = dummySeams(joints).slice(0, MAX_SEAMS);
    const u = DUMMY_UNIFORMS;
    u.uSeamCount.value = seams.length;
    seams.forEach((seam, k) => {
      u.uSeamAt.value[k].set(...seam.at);
      u.uSeamNormal.value[k].set(...seam.normal);
      u.uSeamReach.value[k] = seam.reach;
      u.uSeamRegions.value[k] = seam.regions.reduce((m, r) => m | (1 << REGIONS.indexOf(r)), 0);
      u.uSeamSide.value[k] = seam.side;
    });
    if (!this.bodyMesh) return;
    const g = this.bodyMesh.geometry;
    for (const [name, data] of [
      ['position', shape.positions],
      ['normal', shape.normals],
      ['visor', shape.visor],
      ['marker', shape.marker],
    ] as const) {
      (g.getAttribute(name) as BufferAttribute).copyArray(data).needsUpdate = true;
    }
    g.computeBoundingBox();
    g.computeBoundingSphere();
    if (!this.framed || (this.autoFrame && !this.inView())) {
      this.frameBody();
      this.framed = true;
    }
    this.requestRender();
  }

  private inView(): boolean {
    const box = this.frameBox ?? this.bodyMesh?.geometry.boundingBox;
    if (!box) return true;
    this.camera.updateMatrixWorld();
    const v = new Vector3();
    for (let i = 0; i < 8; i++) {
      v.set(i & 1 ? box.max.x : box.min.x, i & 2 ? box.max.y : box.min.y, i & 4 ? box.max.z : box.min.z);
      v.project(this.camera);
      if (Math.abs(v.x) > 0.98 || Math.abs(v.y) > 0.98) return false;
    }
    return true;
  }

  setShowRegions(show: boolean): void {
    if (!this.bodyMesh || !this.regionColors) return;
    const attr = this.bodyMesh.geometry.getAttribute('color') as BufferAttribute;
    if (show) attr.copyArray(this.regionColors);
    else (attr.array as Float32Array).fill(1);
    attr.needsUpdate = true;
    this.showRegions = show;
    this.applyStyle();
  }

  setDummyStyle(style: DummyStyle): void {
    this.style = style;
    this.applyStyle();
  }

  private applyStyle(): void {
    const s = this.style;
    const u = DUMMY_UNIFORMS;
    u.uTrim.value.set(s.trim);
    u.uMarkerLight.value.set(s.body).lerp(new Color(0xffffff), 0.12);
    u.uRim.value.set(s.visor ? 0xe0a43a : 0xffffff);
    u.uRimStrength.value = s.visor ? 0.4 : 0.18;
    u.uMarkers.value = s.markers ? 1 : 0;
    u.uSeams.value = s.seams ? 1 : 0;
    u.uVisor.value = s.visor ? 1 : 0;
    u.uLines.value = s.lines ? 1 : 0;
    if (this.bodyMesh) {
      this.bodyMesh.material.color.set(this.showRegions ? 0xffffff : s.body);
      this.bodyMesh.material.roughness = 0.85 - 0.7 * s.gloss;
    }
    this.requestRender();
  }

  setBodyMask(keep: Float32Array | null): void {
    if (!this.bodyMesh) return;
    const attr = this.bodyMesh.geometry.getAttribute('keep') as BufferAttribute;
    if (keep) attr.copyArray(keep);
    else (attr.array as Float32Array).fill(1);
    attr.needsUpdate = true;
    const mat = this.bodyMesh.material;
    const side = keep ? DoubleSide : FrontSide;
    if (mat.side !== side) {
      mat.side = side;
      mat.needsUpdate = true;
    }
    this.requestRender();
  }

  setFrameBox(box: { min: Vec3; max: Vec3 } | null): void {
    this.frameBox = box ? new Box3(new Vector3(...box.min), new Vector3(...box.max)) : null;
  }

  frameBody(): void {
    const box = this.frameBox ?? this.bodyMesh?.geometry.boundingBox;
    if (!box) return;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const tan = Math.tan(((this.camera.fov / 2) * Math.PI) / 180);
    const fit = Math.max(size.y / 2 / tan, Math.max(size.x, size.z) / 2 / (tan * this.camera.aspect));
    const dist = fit * 1.24 + (this.frameBox ? size.z / 2 : 0);
    this.controls.target.copy(center);
    this.camera.position.set(center.x + dist * 0.28, center.y + size.y * 0.08, center.z + dist);
    this.controls.update();
    this.autoFrame = true;
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
    this.rulers.dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
