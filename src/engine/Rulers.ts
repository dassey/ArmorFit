import {
  CanvasTexture,
  Group,
  LinearFilter,
  SRGBColorSpace,
  Sprite,
  SpriteMaterial,
  Vector3,
  type Camera,
} from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import type { Vec3 } from '../core/math/linalg';

export interface RulerDraw {
  path: Vec3[];
  closed: boolean;
  ends: Vec3[];
  label: Vec3;
  text: string;
  strong: boolean;
}

const COLOR = 0xff9f1a;
const LABEL_PX = 22;
const DOT_PX = 9;

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

function texture(c: HTMLCanvasElement): CanvasTexture {
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.minFilter = LinearFilter;
  t.generateMipmaps = false;
  return t;
}

function spriteMaterial(map: CanvasTexture): SpriteMaterial {
  return new SpriteMaterial({
    map,
    sizeAttenuation: false,
    depthTest: false,
    depthWrite: false,
    transparent: true,
    toneMapped: false,
  });
}

export class RulerLayer {
  readonly group = new Group();
  private readonly solid = new LineMaterial({ color: COLOR, linewidth: 2.5, toneMapped: false });
  private readonly strong = new LineMaterial({ color: COLOR, linewidth: 4, toneMapped: false });
  private readonly xray = new LineMaterial({
    color: COLOR,
    linewidth: 1.5,
    transparent: true,
    opacity: 0.55,
    depthTest: false,
    depthWrite: false,
    dashed: true,
    dashSize: 7,
    gapSize: 5,
    toneMapped: false,
  });
  private readonly dot: SpriteMaterial;
  private readonly dpr = Math.min(window.devicePixelRatio || 1, 2);
  private pxScale = 0.001;
  private width = 1;
  private height = 1;
  private sprites: Sprite[] = [];
  private labelSprites: Sprite[] = [];
  private geometries: LineGeometry[] = [];
  private labels: SpriteMaterial[] = [];

  constructor() {
    this.group.name = 'rulers';
    const size = Math.round(DOT_PX * this.dpr * 2);
    const [c, ctx] = canvas(size, size);
    ctx.fillStyle = '#ff9f1a';
    ctx.strokeStyle = '#1b1e24';
    ctx.lineWidth = size * 0.14;
    ctx.beginPath();
    ctx.arc(size / 2, size / 2, size * 0.36, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    this.dot = spriteMaterial(texture(c));
  }

  setViewport(width: number, height: number, fovDeg: number): void {
    for (const m of [this.solid, this.strong, this.xray]) m.resolution.set(width, height);
    this.width = Math.max(1, width);
    this.height = Math.max(1, height);
    this.pxScale = (2 * Math.tan((fovDeg * Math.PI) / 360)) / this.height;
    for (const s of this.sprites) this.size(s);
  }

  set(items: RulerDraw[]): void {
    this.clear();
    for (const it of items) {
      const pts = it.closed ? [...it.path, it.path[0]] : it.path;
      const geom = new LineGeometry();
      geom.setPositions(pts.flat());
      this.geometries.push(geom);
      const line = new Line2(geom, it.strong ? this.strong : this.solid);
      line.computeLineDistances();
      line.renderOrder = 10;
      const ghost = new Line2(geom, this.xray);
      ghost.renderOrder = 11;
      this.group.add(line, ghost);
      for (const e of it.ends) this.add(this.dot, e, DOT_PX, DOT_PX, 0.5, 0.5);
      this.addLabel(it.text, it.label, it.strong);
    }
  }

  private addLabel(text: string, at: Vec3, strong: boolean): void {
    const font = `600 ${13 * this.dpr}px system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`;
    const [, probe] = canvas(1, 1);
    probe.font = font;
    const pad = 7 * this.dpr;
    const h = Math.round(LABEL_PX * this.dpr);
    const w = Math.ceil(probe.measureText(text).width + pad * 2);
    const [c, ctx] = canvas(w, h);
    ctx.font = font;
    ctx.fillStyle = strong ? 'rgba(48, 30, 4, 0.94)' : 'rgba(15, 17, 20, 0.86)';
    ctx.strokeStyle = '#ff9f1a';
    ctx.lineWidth = this.dpr;
    ctx.beginPath();
    ctx.roundRect(this.dpr / 2, this.dpr / 2, w - this.dpr, h - this.dpr, h / 2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#ffd08a';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, pad, h / 2 + this.dpr * 0.5);
    const mat = spriteMaterial(texture(c));
    this.labels.push(mat);
    const sprite = this.add(mat, at, w / this.dpr, h / this.dpr, -0.06, 0.5);
    sprite.renderOrder = 13;
    this.labelSprites.push(sprite);
  }

  layout(camera: Camera): void {
    if (!this.labelSprites.length) return;
    camera.updateMatrixWorld();
    const v = new Vector3();
    const boxes = this.labelSprites
      .map((s) => {
        v.copy(s.position).project(camera);
        const [w, h] = s.userData.px as [number, number];
        const x = (v.x * 0.5 + 0.5) * this.width + 0.06 * w;
        return { s, x, top: (0.5 - v.y * 0.5) * this.height - h / 2, w, h, behind: v.z > 1 };
      })
      .filter((b) => !b.behind)
      .sort((a, b) => a.top - b.top);
    const placed: { x0: number; x1: number; y0: number; y1: number }[] = [];
    for (const b of boxes) {
      let top = b.top;
      for (let moved = true; moved;) {
        moved = false;
        for (const p of placed) {
          if (b.x < p.x1 && b.x + b.w > p.x0 && top < p.y1 && top + b.h > p.y0) {
            top = p.y1 + 2;
            moved = true;
          }
        }
      }
      placed.push({ x0: b.x, x1: b.x + b.w, y0: top, y1: top + b.h });
      b.s.center.y = 0.5 + (top - b.top) / b.h;
    }
  }

  private add(mat: SpriteMaterial, at: Vec3, wPx: number, hPx: number, cx: number, cy: number): Sprite {
    const s = new Sprite(mat);
    s.position.set(at[0], at[1], at[2]);
    s.center.set(cx, cy);
    s.renderOrder = 12;
    s.userData.px = [wPx, hPx];
    this.size(s);
    this.sprites.push(s);
    this.group.add(s);
    return s;
  }

  private size(s: Sprite): void {
    const [w, h] = s.userData.px as [number, number];
    s.scale.set(w * this.pxScale, h * this.pxScale, 1);
  }

  private clear(): void {
    this.group.clear();
    for (const g of this.geometries) g.dispose();
    for (const m of this.labels) {
      m.map?.dispose();
      m.dispose();
    }
    this.geometries = [];
    this.labels = [];
    this.sprites = [];
    this.labelSprites = [];
  }

  dispose(): void {
    this.clear();
    for (const m of [this.solid, this.strong, this.xray]) m.dispose();
    this.dot.map?.dispose();
    this.dot.dispose();
  }
}
