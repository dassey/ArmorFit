import { Matrix4, Vector3 } from 'three';
import type { Bone, BoneId } from '../core/body/skeleton';
import type { BodyQuery } from '../core/fit/bodyQuery';
import { boneAnchorAt, homeAnchor, type HomeContext } from '../core/fit/homes';
import {
  placementMatrix,
  scaleMirrorMatrix,
  surfacePoint,
  type BodyGeometry,
  type PlacementSpec,
} from '../core/fit/placement';
import { settleOffset } from '../core/fit/settle';
import { DEFAULT_CLEARANCE, type ClearanceSettings } from '../core/fit/clearance';
import { v3, type Vec3 } from '../core/math/linalg';
import { sampleSurface } from '../core/mesh/sample';
import type { MeshData } from '../core/mesh/types';
import type { OrientationResult } from '../core/pieces/orient';
import { pieceType, type PieceTypeId, type Side } from '../core/pieces/types';
import { PieceView } from '../engine/PieceView';
import type { Ray3 } from '../engine/Interaction';
import type { Viewport } from '../engine/Viewport';
import type { Remote } from '../workers/rpc';
import type { DemoKind, GeometryWorkerApi, PieceImport } from '../workers/geometry.worker';
import type { ProjectPiece } from '../core/export/project';
import {
  pieces,
  pendingPieces,
  selectedId,
  updatePiece,
  importBusy,
  type PieceState,
  type Placement,
} from './pieces';
import { toast } from './store';

export interface BodyContext extends BodyGeometry, HomeContext {
  query: BodyQuery;
  bones: Record<BoneId, Bone>;
  landmarks: Record<string, Vec3>;
}

interface PieceRuntime {
  preview: MeshData;
  view: PieceView;
  wPoints: Float32Array;
  wNormals: Float32Array;
  autoOffset: number;
  world: Matrix4;
  inScene: boolean;
}

const SNAP_DISTANCE = 90;
const DRAG_SAMPLES = 180;

export function orientationMatrix(p: Pick<PieceState, 'orientation' | 'unitScale'>): Matrix4 {
  return new Matrix4()
    .fromArray(p.orientation.matrix)
    .multiply(new Matrix4().makeScale(p.unitScale, p.unitScale, p.unitScale));
}

function sideBones(side: Side | null): (s: string) => BoneId[] {
  return (base) => (side ? [`${base}${side}` as BoneId] : [`${base}L` as BoneId, `${base}R` as BoneId]);
}

function allowedBones(type: PieceTypeId | null, side: Side | null): BoneId[] | undefined {
  const sb = sideBones(side);
  switch (type) {
    case 'helmet':
      return ['head'];
    case 'gorget':
      return ['neck'];
    case 'belt':
    case 'chest':
    case 'back':
    case 'abdomen':
      return ['spine'];
    case 'pauldron':
    case 'bicep':
    case 'elbow':
      return sb('upperArm');
    case 'forearm':
      return sb('forearm');
    case 'hand':
      return sb('hand');
    case 'thigh':
    case 'tasset':
    case 'knee':
      return sb('thigh');
    case 'shin':
    case 'calf':
      return sb('shin');
    case 'boot':
      return sb('foot');
  }
  return undefined;
}

export class PieceManager {
  private runtimes = new Map<string, PieceRuntime>();
  private body: BodyContext | null = null;
  onChanged: (id: string) => void = () => {};
  onGeometry: (id: string) => void = () => {};

  constructor(
    private readonly vp: Viewport,
    private readonly geo: Remote<GeometryWorkerApi>,
  ) {}

  get(id: string): PieceState | undefined {
    return pieces.value.find((p) => p.id === id);
  }

  views(): PieceView[] {
    return [...this.runtimes.values()].filter((r) => r.inScene).map((r) => r.view);
  }

  runtime(id: string): PieceRuntime | undefined {
    return this.runtimes.get(id);
  }

  async importFiles(files: File[]): Promise<void> {
    for (const file of files) {
      importBusy.value++;
      try {
        const buf = await file.arrayBuffer();
        const res = await this.geo.importFile(file.name, buf);
        for (const w of res.warnings) toast(`${file.name}: ${w}`, 'error', 6000);
        for (const imp of res.pieces) this.addImported(imp);
        if (res.pieces.length > 1)
          toast(`${file.name}: ${res.pieces.length} objects imported as separate pieces.`);
      } catch (e) {
        toast(`${file.name}: ${e instanceof Error ? e.message : String(e)}`, 'error', 7000);
      } finally {
        importBusy.value--;
      }
    }
  }

  async loadDemos(): Promise<void> {
    const kinds: DemoKind[] = ['helmet', 'chest', 'pauldronL', 'forearmL'];
    importBusy.value++;
    try {
      const imports = await Promise.all(kinds.map((k) => this.geo.importDemo(k)));
      for (const imp of imports) this.addImported(imp, { unitConfirmed: true, orientationConfirmed: true });
    } finally {
      importBusy.value--;
    }
  }

  private addImported(imp: PieceImport, extra: Partial<PieceState> = {}): void {
    const p = imp.prepared;
    const state: PieceState = {
      id: imp.id,
      name: imp.name,
      fileName: imp.fileName,
      fileHash: imp.fileHash,
      type: p.guess.type,
      side: p.guess.side ?? (p.guess.type && pieceType(p.guess.type).sided ? 'L' : null),
      guess: p.guess,
      unitScale: p.units.best.scale,
      unitConfirmed: !p.units.needsConfirmation,
      units: p.units,
      orientation: p.orientation,
      orientationConfirmed: p.orientation.confidence >= 0.6,
      topology: p.topology,
      warnings: p.warnings,
      fullTriangles: imp.fullTriangles,
      previewTriangles: imp.preview.indices.length / 3,
      placement: null,
      scale: [1, 1, 1],
      mirrored: false,
      visible: true,
      scaleGroup: null,
      ...extra,
    };
    const preview: MeshData = {
      positions: imp.preview.positions,
      indices: imp.preview.indices,
      normals: imp.preview.normals,
    };
    const view = new PieceView(imp.id, preview);
    const rt: PieceRuntime = {
      preview,
      view,
      wPoints: new Float32Array(),
      wNormals: new Float32Array(),
      autoOffset: 0,
      world: new Matrix4(),
      inScene: false,
    };
    this.runtimes.set(imp.id, rt);
    pieces.value = [...pieces.value, state];
    this.refreshSamples(imp.id);
    this.refreshThumbnail(imp.id);
    this.onGeometry(imp.id);
    this.reattach(imp.id);
  }

  private reattach(id: string): void {
    const p = this.get(id);
    if (!p) return;
    const pending = pendingPieces.value;
    const candidates = pending.filter((s) => s.sourceIndex === undefined && s.fileHash === p.fileHash);
    const saved = candidates.find((s) => s.name === p.name) ?? candidates[0];
    if (!saved) return;
    const copies = pending.filter((s) => s.sourceIndex === saved.index);
    pendingPieces.value = pending.filter((s) => s !== saved && !copies.includes(s));
    this.applySaved(id, saved);
    for (const c of copies) {
      const newId = this.mirrorCopy(id);
      if (newId) this.applySaved(newId, c);
    }
  }

  applySaved(id: string, saved: ProjectPiece): void {
    updatePiece(id, {
      name: saved.name,
      type: saved.type,
      side: saved.side,
      unitScale: saved.unitScale,
      unitConfirmed: true,
      orientation: saved.orientation,
      orientationConfirmed: true,
      scale: saved.scale,
      mirrored: saved.mirrored,
    });
    this.afterOrientationChange(id);
    if (saved.placement && this.body) this.applyPlacement(id, saved.placement as Placement);
    this.onChanged(id);
  }

  private refreshSamples(id: string): void {
    const p = this.get(id);
    const rt = this.runtimes.get(id);
    if (!p || !rt) return;
    const s = sampleSurface(rt.preview, 600, 7);
    const m = orientationMatrix(p);
    const rot = new Matrix4().extractRotation(m);
    const v = new Vector3();
    for (let i = 0; i < s.points.length; i += 3) {
      v.set(s.points[i], s.points[i + 1], s.points[i + 2]).applyMatrix4(m);
      s.points[i] = v.x;
      s.points[i + 1] = v.y;
      s.points[i + 2] = v.z;
      v.set(s.normals[i], s.normals[i + 1], s.normals[i + 2])
        .applyMatrix4(rot)
        .normalize();
      s.normals[i] = v.x;
      s.normals[i + 1] = v.y;
      s.normals[i + 2] = v.z;
    }
    rt.wPoints = s.points;
    rt.wNormals = s.normals;
  }

  refreshThumbnail(id: string): void {
    const p = this.get(id);
    const rt = this.runtimes.get(id);
    if (!p || !rt) return;
    const cn = p.orientation.contactNormal;
    let dir: Vec3 =
      p.orientation.category === 'shell'
        ? v3.norm([cn[0] * 0.85 + 0.3, cn[1] * 0.85 + 0.25, cn[2] * 0.85 + 0.3])
        : v3.norm([0.45, 0.3, 1]);
    if (!Number.isFinite(dir[0])) dir = [0, 0, 1];
    const m = scaleMirrorMatrix([1, 1, 1], p.mirrored).multiply(orientationMatrix(p));
    const thumbnail = this.vp.renderThumbnail(rt.view.geometry, m, dir);
    updatePiece(id, { thumbnail });
  }

  setBody(body: BodyContext): void {
    this.body = body;
    for (const p of pieces.value) {
      if (p.placement) this.applyPlacement(p.id, p.placement, { settle: true });
    }
  }

  private frameInfo(p: PieceState, autoOffset: number) {
    return { contactNormal: p.orientation.contactNormal, autoOffset, mirrored: p.mirrored };
  }

  private worldFor(p: PieceState, spec: PlacementSpec, autoOffset: number): Matrix4 {
    const P = placementMatrix(spec, this.body!, this.frameInfo(p, autoOffset));
    return P.multiply(scaleMirrorMatrix(p.scale, p.mirrored));
  }

  offsetDirection(p: PieceState, spec: PlacementSpec): Vec3 | null {
    if (!this.body) return null;
    if (spec.kind === 'surface') return surfacePoint(this.body, spec.face, spec.bary).normal;
    if (p.orientation.category === 'tube') return null;
    return this.body.bones[spec.bone as BoneId].y;
  }

  private settle(p: PieceState, spec: PlacementSpec, _start: number, samples?: number): number {
    if (!this.body) return 0;
    const rt = this.runtimes.get(p.id)!;
    const dir = this.offsetDirection(p, spec);
    if (!dir) return 0;
    let pts = rt.wPoints;
    let nrm = rt.wNormals;
    if (samples && pts.length / 3 > samples) {
      pts = pts.subarray(0, samples * 3);
      nrm = nrm.subarray(0, samples * 3);
    }
    const P = placementMatrix(spec, this.body, this.frameInfo(p, 0));
    return settleOffset(
      pts,
      nrm,
      P,
      dir,
      p.scale,
      p.mirrored,
      this.body.query,
      this.clearanceSettings(),
      samples ? 4 : 8,
    );
  }

  clearanceSettings: () => ClearanceSettings = () => DEFAULT_CLEARANCE;

  autoSizeInputs(id: string): {
    placement: Matrix4;
    direction: Vec3 | null;
    scale: [number, number, number];
    mirrored: boolean;
  } | null {
    const p = this.get(id);
    const rt = this.runtimes.get(id);
    if (!p?.placement || !rt || !this.body) return null;
    return {
      placement: placementMatrix(p.placement, this.body, this.frameInfo(p, rt.autoOffset)),
      direction: this.offsetDirection(p, p.placement),
      scale: p.scale,
      mirrored: p.mirrored,
    };
  }

  applyPlacement(id: string, spec: Placement, opts: { settle?: boolean; dragSamples?: boolean } = {}): void {
    const p = this.get(id);
    const rt = this.runtimes.get(id);
    if (!p || !rt || !this.body) return;
    if (opts.settle !== false) {
      rt.autoOffset = this.settle(p, spec, rt.autoOffset, opts.dragSamples ? DRAG_SAMPLES : undefined);
    }
    rt.world = this.worldFor(p, spec, rt.autoOffset);
    rt.view.setMatrix(rt.world.clone().multiply(orientationMatrix(p)));
    if (!rt.inScene) {
      this.vp.addObject(rt.view.mesh);
      rt.inScene = true;
    }
    this.vp.requestRender();
    if (p.placement !== spec) updatePiece(id, { placement: spec });
  }

  homeFor(p: PieceState): { placement: Placement; point: Vec3 } | null {
    if (!this.body || !p.type) return null;
    const h = homeAnchor(p.type, p.side, p.orientation.category, this.body);
    return h ? { placement: h.placement, point: h.point } : null;
  }

  placeHome(id: string): boolean {
    const p = this.get(id);
    if (!p || !this.body) return false;
    const home = this.homeFor(p);
    if (!home) {
      toast('Set the piece type first, or drag it onto the mannequin.', 'error');
      return false;
    }
    this.getRt(id).autoOffset = 0;
    this.applyPlacement(id, home.placement);
    this.onChanged(id);
    return true;
  }

  private getRt(id: string): PieceRuntime {
    return this.runtimes.get(id)!;
  }

  placementForRay(p: PieceState, ray: Ray3): { spec: Placement; snapped: boolean } | null {
    if (!this.body) return null;
    const hit = this.body.query.raycast(ray.origin, ray.dir);
    if (!hit) return null;
    const home = this.homeFor(p);
    if (home && v3.dist(home.point, hit.point) < SNAP_DISTANCE)
      return { spec: home.placement, snapped: true };
    const prev = p.placement;
    if (p.orientation.category === 'shell') {
      return {
        spec: {
          kind: 'surface',
          face: hit.face,
          bary: hit.bary,
          twist: prev?.twist ?? 0,
          offset: prev?.offset ?? 0,
        },
        snapped: false,
      };
    }
    const a = boneAnchorAt(hit.point, this.body, allowedBones(p.type, p.side));
    const t = Math.min(0.95, Math.max(0.05, (a.placement as { t: number }).t));
    return {
      spec: {
        ...(a.placement as Extract<Placement, { kind: 'bone' }>),
        t,
        twist: prev?.twist ?? 0,
        offset: 0,
      },
      snapped: false,
    };
  }

  dragTo(id: string, ray: Ray3 | null, done: boolean): boolean {
    const p = this.get(id);
    const rt = this.runtimes.get(id);
    if (!p || !rt) return false;
    const res = ray ? this.placementForRay(p, ray) : null;
    if (!res) {
      if (done) {
        if (!p.placement) this.hide(id);
        else this.applyPlacement(id, p.placement);
        rt.view.setGhost(false);
      } else if (!p.placement && rt.inScene) {
        this.hide(id);
      }
      return false;
    }
    rt.view.setGhost(!done);
    this.applyPlacement(id, res.spec, { dragSamples: !done });
    if (done) {
      selectedId.value = id;
      this.onChanged(id);
    }
    return res.snapped;
  }

  private hide(id: string): void {
    const rt = this.runtimes.get(id);
    if (rt?.inScene) {
      this.vp.removeObject(rt.view.mesh);
      rt.inScene = false;
    }
  }

  unplace(id: string): void {
    this.hide(id);
    updatePiece(id, { placement: null });
    this.onChanged(id);
  }

  remove(id: string): void {
    this.hide(id);
    this.runtimes.get(id)?.view.dispose();
    this.runtimes.delete(id);
    pieces.value = pieces.value.filter((p) => p.id !== id);
    if (selectedId.value === id) selectedId.value = null;
    if (!pieces.value.some((p) => p.sourceId === id)) void this.geo.removePiece(id);
    this.onChanged(id);
  }

  updatePlacement(id: string, patch: Partial<Placement>, settle = true): void {
    const p = this.get(id);
    if (!p?.placement) return;
    const spec = { ...p.placement, ...patch } as Placement;
    this.applyPlacement(id, spec, { settle });
    this.onChanged(id);
  }

  twist(id: string, delta: number): void {
    const p = this.get(id);
    if (!p?.placement) return;
    let t = p.placement.twist + delta;
    t = Math.atan2(Math.sin(t), Math.cos(t));
    this.updatePlacement(id, { twist: t }, false);
  }

  nudge(id: string, right: number, up: number): void {
    const p = this.get(id);
    if (!p?.placement || !this.body) return;
    const sp = p.placement;
    if (sp.kind === 'bone') {
      const b = this.body.bones[sp.bone as BoneId];
      this.updatePlacement(id, {
        t: Math.min(1, Math.max(0, sp.t + up / (b.length || 1))),
        twist: sp.twist + right / 100,
      });
      return;
    }
    const { point, normal } = surfacePoint(this.body, sp.face, sp.bary);
    let upDir: Vec3 = v3.sub([0, 1, 0], v3.scale(normal, normal[1]));
    if (v3.len(upDir) < 0.2) upDir = v3.sub([0, 0, 1], v3.scale(normal, normal[2]));
    upDir = v3.norm(upDir);
    const rightDir = v3.cross(upDir, normal);
    const target = v3.add(point, v3.add(v3.scale(rightDir, right), v3.scale(upDir, up)));
    const hit = this.body.query.raycast(v3.add(target, v3.scale(normal, 80)), v3.scale(normal, -1));
    if (!hit) return;
    this.updatePlacement(id, { face: hit.face, bary: hit.bary } as Partial<Placement>);
  }

  setScale(id: string, scale: [number, number, number]): void {
    updatePiece(id, { scale });
    const p = this.get(id);
    if (p?.placement) this.applyPlacement(id, p.placement);
    this.onChanged(id);
  }

  mirrorCopy(id: string): string | null {
    const p = this.get(id);
    const rt = this.runtimes.get(id);
    if (!p || !rt) return null;
    const newId = `${id}m${Math.random().toString(36).slice(2, 6)}`;
    const side: Side | null = p.side === 'L' ? 'R' : p.side === 'R' ? 'L' : null;
    const copy: PieceState = {
      ...p,
      id: newId,
      name: p.name.replace(
        /\b(L|R|left|right|Left|Right)\b/,
        (w) => ({ L: 'R', R: 'L', left: 'right', right: 'left', Left: 'Right', Right: 'Left' })[w] ?? w,
      ),
      side,
      mirrored: !p.mirrored,
      placement: null,
      sourceId: p.sourceId ?? id,
    } as PieceState;
    if (copy.name === p.name) copy.name = `${p.name} (mirrored)`;
    const view = new PieceView(newId, rt.preview);
    this.runtimes.set(newId, { ...rt, view, inScene: false, world: new Matrix4() });
    pieces.value = [...pieces.value, copy];
    this.refreshThumbnail(newId);
    this.onGeometry(newId);
    if (p.placement && this.body) {
      const spec = this.mirrorPlacement(p.placement);
      if (spec) this.applyPlacement(newId, spec);
    } else if (this.body) {
      this.placeHome(newId);
    }
    this.onChanged(newId);
    return newId;
  }

  private mirrorPlacement(sp: Placement): Placement | null {
    if (!this.body) return null;
    if (sp.kind === 'bone') {
      const bone = sp.bone.endsWith('L')
        ? `${sp.bone.slice(0, -1)}R`
        : sp.bone.endsWith('R')
          ? `${sp.bone.slice(0, -1)}L`
          : sp.bone;
      return { ...sp, bone, twist: -sp.twist };
    }
    const { point, normal } = surfacePoint(this.body, sp.face, sp.bary);
    const mp: Vec3 = [-point[0], point[1], point[2]];
    const mn: Vec3 = [-normal[0], normal[1], normal[2]];
    const hit = this.body.query.raycast(v3.add(mp, v3.scale(mn, 60)), v3.scale(mn, -1));
    if (!hit) return null;
    return { ...sp, face: hit.face, bary: hit.bary, twist: -sp.twist };
  }

  setTypeSide(id: string, type: PieceTypeId | null, side: Side | null): void {
    updatePiece(id, { type, side });
    void this.reorient(id);
  }

  setUnitScale(id: string, scale: number): void {
    updatePiece(id, { unitScale: scale, unitConfirmed: true });
    void this.reorient(id);
  }

  async reorient(id: string): Promise<void> {
    const p = this.get(id);
    if (!p) return;
    const orientation: OrientationResult = await this.geo.reorient(p.sourceId ?? id, p.unitScale, {
      type: p.type,
      side: p.side,
      confidence: 1,
    });
    updatePiece(id, { orientation, orientationConfirmed: orientation.confidence >= 0.6 });
    this.afterOrientationChange(id);
  }

  rotateOrientation(id: string, axis: 'x' | 'y' | 'z', degrees: number): void {
    const p = this.get(id);
    if (!p) return;
    const R = new Matrix4();
    const a = (degrees * Math.PI) / 180;
    if (axis === 'x') R.makeRotationX(a);
    else if (axis === 'y') R.makeRotationY(a);
    else R.makeRotationZ(a);
    const m = R.clone().multiply(new Matrix4().fromArray(p.orientation.matrix));
    const rot = (v: Vec3): Vec3 => {
      const x = new Vector3(...v).applyMatrix4(R);
      return [x.x, x.y, x.z];
    };
    updatePiece(id, {
      orientation: {
        ...p.orientation,
        matrix: m.elements.slice(),
        contactNormal: rot(p.orientation.contactNormal),
        contactPoint: rot(p.orientation.contactPoint),
        center: rot(p.orientation.center),
      },
      orientationConfirmed: true,
    });
    this.afterOrientationChange(id);
  }

  flipInsideOut(id: string): void {
    const p = this.get(id);
    if (!p) return;
    const cn = p.orientation.contactNormal;
    updatePiece(id, {
      orientation: { ...p.orientation, contactNormal: [-cn[0], -cn[1], -cn[2]] },
      orientationConfirmed: true,
    });
    this.afterOrientationChange(id);
  }

  private afterOrientationChange(id: string): void {
    this.refreshSamples(id);
    this.refreshThumbnail(id);
    this.onGeometry(id);
    const p = this.get(id);
    if (p?.placement) this.applyPlacement(id, p.placement);
    this.onChanged(id);
  }

  setOpacity(opacity: number): void {
    for (const rt of this.runtimes.values()) rt.view.setOpacity(opacity);
    this.vp.requestRender();
  }

  select(id: string | null): void {
    for (const [pid, rt] of this.runtimes) rt.view.setSelected(pid === id);
    selectedId.value = id;
    this.vp.requestRender();
  }

  analysisInputs(id: string): { world: Matrix4; orientation: Matrix4; preview: MeshData } | null {
    const p = this.get(id);
    const rt = this.runtimes.get(id);
    if (!p?.placement || !rt) return null;
    return { world: rt.world.clone(), orientation: orientationMatrix(p), preview: rt.preview };
  }

  setHeatmap(id: string, colors: Float32Array | null): void {
    this.runtimes.get(id)?.view.setHeatmap(colors);
    this.vp.requestRender();
  }
}
