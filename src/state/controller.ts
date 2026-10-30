import { effect, untracked } from '@preact/signals';
import { bodyPart, fieldAt, partBounds, partField, segmentWeights } from '../core/body/parts';
import { rulerGeometry, rulerLabel, type LoopEdges } from '../core/body/rulers';
import { buildSkeleton } from '../core/body/skeleton';
import { BodyQuery, type SurfaceFilter } from '../core/fit/bodyQuery';
import type { MeasurementProfile } from '../core/measurements/profile';
import type { MeasurementKey } from '../core/measurements/schema';
import { formatLength } from '../core/units';
import { Interaction } from '../engine/Interaction';
import type { RulerDraw } from '../engine/Rulers';
import type { Viewport } from '../engine/Viewport';
import type { BodyUpdate, FitWorkerApi } from '../workers/fit.worker';
import type { GeometryWorkerApi } from '../workers/geometry.worker';
import { wrap, type Remote } from '../workers/rpc';
import { AnalysisManager } from './analysis';
import { FitPool } from './fitPool';
import { PieceManager } from './pieceManager';
import { selectedId } from './pieces';
import { activeRuler, body, clearance, profile, shownRulers, view } from './store';

function workerCount(): number {
  const cores = navigator.hardwareConcurrency || 2;
  const memory = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 4;
  return Math.max(1, Math.min(memory >= 8 ? 8 : 4, cores - 2));
}

export class AppController {
  readonly fit: FitPool;
  readonly geo: Remote<GeometryWorkerApi>;
  viewport: Viewport | null = null;
  pieces: PieceManager | null = null;
  analysis: AnalysisManager | null = null;
  interaction: Interaction | null = null;
  private ready = false;
  private inFlight = false;
  private pending: MeasurementProfile | null = null;
  private lastBuilt: MeasurementProfile | null = null;
  private topology: { indices: Uint16Array; regions: Uint8Array } | null = null;
  private query: BodyQuery | null = null;
  private poolWorkers: Remote<GeometryWorkerApi>[] | null = null;
  private shape: BodyUpdate | null = null;
  private loops: Record<string, LoopEdges> = {};
  private weights: Float32Array | null = null;
  private keep: Float32Array | null = null;
  private refitTimer: ReturnType<typeof setTimeout> | undefined;

  constructor() {
    this.fit = new FitPool(
      () =>
        wrap<FitWorkerApi>(
          new Worker(new URL('../workers/fit.worker.ts', import.meta.url), { type: 'module' }),
        ),
      workerCount(),
    );
    this.geo = wrap<GeometryWorkerApi>(
      new Worker(new URL('../workers/geometry.worker.ts', import.meta.url), { type: 'module' }),
    );
  }

  importPool(): Remote<GeometryWorkerApi>[] {
    if (!this.poolWorkers) {
      const n = workerCount();
      this.poolWorkers = Array.from({ length: n }, () =>
        wrap<GeometryWorkerApi>(
          new Worker(new URL('../workers/geometry.worker.ts', import.meta.url), { type: 'module' }),
        ),
      );
    }
    return this.poolWorkers;
  }

  attachViewport(vp: Viewport): void {
    this.viewport = vp;
    const pm = new PieceManager(vp, this.geo, () => this.importPool());
    pm.clearanceSettings = () => clearance.value;
    this.pieces = pm;
    this.analysis = new AnalysisManager(this.fit, pm);
    this.interaction = new Interaction(vp, {
      pieces: () => pm.views(),
      selectedId: () => selectedId.value,
      select: (id) => pm.select(id),
      dragTo: (id, ray, done) => {
        pm.dragTo(id, ray, done);
      },
      twist: (id, d) => pm.twist(id, d),
    });
    effect(() => vp.setShowRegions(view.showRegions.value));
    effect(() => pm.setOpacity(view.armorOpacity.value));
    effect(() => pm.select(selectedId.value));
    effect(() => {
      void view.part.value;
      untracked(() => this.applyPart(true));
    });
    effect(() => {
      const keys = shownRulers.value;
      const strong = activeRuler.value;
      const p = profile.value;
      void body.version.value;
      untracked(() => vp.setRulers(this.rulers(keys, strong, p)));
    });
  }

  private visibleAt: SurfaceFilter = (face, bary) =>
    !this.keep || !this.topology || fieldAt(this.keep, this.topology.indices, face, bary) >= 0;

  private updateMask(): void {
    const part = view.part.peek();
    if (!this.shape || !this.weights || part === 'full') {
      this.keep = null;
      this.viewport?.setBodyMask(null);
      this.viewport?.setFrameBox(null);
      return;
    }
    this.keep = partField(part, this.weights, this.shape);
    this.viewport?.setBodyMask(this.keep);
    this.viewport?.setFrameBox(partBounds(this.keep, this.shape.positions, bodyPart(part).frame));
  }

  private refit(quiet: number): void {
    clearTimeout(this.refitTimer);
    this.analysis?.hold();
    this.refitTimer = setTimeout(() => {
      if (view.adjusting.peek()) return this.refit(quiet);
      this.pieces?.settleAll();
      this.analysis?.scheduleAll(0);
    }, quiet);
  }

  private applyPart(reframe: boolean): void {
    this.updateMask();
    this.pieces?.setSurfaceFilter(this.keep ? this.visibleAt : null);
    if (reframe && this.shape) this.viewport?.frameBody();
  }

  private rulers(keys: MeasurementKey[], strong: MeasurementKey | null, p: MeasurementProfile): RulerDraw[] {
    if (!this.shape || !this.topology) return [];
    const shape = {
      positions: this.shape.positions,
      regions: this.topology.regions,
      landmarks: this.shape.landmarks,
      loops: this.loops,
    };
    return keys.flatMap((k) => {
      const g = rulerGeometry(k, shape);
      return g
        ? [
            {
              ...g,
              text: `${rulerLabel(k)} ${formatLength(p.values[k], p.displayUnit)}`,
              strong: k === strong,
            },
          ]
        : [];
    });
  }

  beginTrayDrag(id: string, e: PointerEvent): void {
    this.interaction?.beginExternalDrag(id, e);
  }

  async start(): Promise<void> {
    try {
      const url = new URL('assets/body/hm08.armorfit.bin.gz', document.baseURI).href;
      const meta = await this.fit.init(url);
      body.credits.value = meta.credits;
      this.topology = { indices: meta.indices.slice(), regions: meta.regions.slice() };
      this.loops = meta.loops;
      this.weights = segmentWeights(this.topology.indices, this.topology.regions);
      this.viewport?.setBodyTopology(meta.indices, meta.regions);
      this.ready = true;
      effect(() => this.requestBody(profile.value));
    } catch (e) {
      body.status.value = 'error';
      body.error.value = e instanceof Error ? e.message : String(e);
    }
  }

  private requestBody(p: MeasurementProfile): void {
    if (!this.ready) return;
    const relevant = (x: MeasurementProfile | null) =>
      x && JSON.stringify([x.values, x.preset, x.mode, x.userSet.slice().sort()]);
    if (relevant(p) === relevant(this.lastBuilt)) return;
    this.pending = p;
    void this.pump();
  }

  private async pump(): Promise<void> {
    if (this.inFlight || !this.pending) return;
    const p = this.pending;
    this.pending = null;
    this.inFlight = true;
    body.status.value = 'solving';
    try {
      const started = performance.now();
      const update = await this.fit.buildBody(p);
      const quiet = Math.max(150, 2 * (performance.now() - started));
      this.lastBuilt = p;
      this.shape = update;
      this.updateMask();
      this.viewport?.updateBody(update.display, update.joints);
      if (this.topology) {
        if (!this.query) {
          this.query = new BodyQuery(
            update.positions,
            update.normals,
            this.topology.indices,
            this.topology.regions,
          );
        } else {
          this.query.update(update.positions, update.normals);
        }
        this.pieces?.setBody({
          query: this.query,
          bones: buildSkeleton(update.joints, update.landmarks),
          landmarks: update.landmarks,
          positions: update.positions,
          normals: update.normals,
          indices: this.topology.indices,
        });
        this.pieces?.setSurfaceFilter(this.keep ? this.visibleAt : null);
        this.refit(quiet);
      }
      body.measured.value = update.measured;
      body.status.value = 'ready';
      body.error.value = null;
      body.version.value++;
    } catch (e) {
      body.status.value = 'error';
      body.error.value = e instanceof Error ? e.message : String(e);
    } finally {
      this.inFlight = false;
      if (this.pending) void this.pump();
    }
  }
}
