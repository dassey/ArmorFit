import { effect } from '@preact/signals';
import { buildSkeleton } from '../core/body/skeleton';
import { BodyQuery } from '../core/fit/bodyQuery';
import type { MeasurementProfile } from '../core/measurements/profile';
import { Interaction } from '../engine/Interaction';
import type { Viewport } from '../engine/Viewport';
import type { FitWorkerApi } from '../workers/fit.worker';
import type { GeometryWorkerApi } from '../workers/geometry.worker';
import { wrap, type Remote } from '../workers/rpc';
import { AnalysisManager } from './analysis';
import { FitPool } from './fitPool';
import { PieceManager } from './pieceManager';
import { selectedId } from './pieces';
import { body, clearance, profile, view } from './store';

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
      const update = await this.fit.buildBody(p);
      this.lastBuilt = p;
      this.viewport?.updateBody(update.positions, update.normals);
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
      }
      body.measured.value = update.measured;
      body.status.value = 'ready';
      body.error.value = null;
    } catch (e) {
      body.status.value = 'error';
      body.error.value = e instanceof Error ? e.message : String(e);
    } finally {
      this.inFlight = false;
      if (this.pending) void this.pump();
    }
  }
}
