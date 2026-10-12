import { effect } from '@preact/signals';
import { clearanceColor } from '../core/fit/heatmap';
import type { FitPool } from './fitPool';
import { orientationMatrix, type PieceManager } from './pieceManager';
import { pieces, updatePiece } from './pieces';
import { clearance, view } from './store';

const NEUTRAL: [number, number, number] = [0.62, 0.7, 0.78];

export class AnalysisManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private versions = new Map<string, number>();
  private clearanceCache = new Map<string, Float32Array>();
  private registered = new Map<string, Set<number>>();

  constructor(
    private readonly pool: FitPool,
    private readonly pm: PieceManager,
  ) {
    pm.onGeometry = (id) => void this.refresh(id);
    pm.onChanged = (id) => this.schedule(id);
    effect(() => {
      void clearance.value;
      void view.showHeatmap.value;
      for (const p of pieces.peek()) {
        this.recolor(p.id);
        if (p.placement) this.schedule(p.id, 250);
      }
    });
  }

  private workerFor(id: string): number {
    return this.pool.indexOf(id, this.pm.members(id));
  }

  private async refresh(id: string): Promise<void> {
    const stale = this.registered.get(id);
    this.registered.delete(id);
    if (stale) for (const w of stale) void this.pool.workers[w].removePiece(id);
    await this.ensure(id, this.workerFor(id));
    if (this.pm.get(id)?.placement) this.schedule(id);
  }

  private async ensure(id: string, w: number): Promise<void> {
    if (this.registered.get(id)?.has(w)) return;
    const p = this.pm.get(id);
    const rt = this.pm.runtime(id);
    if (!p || !rt) return;
    await this.pool.workers[w].setPiece(
      id,
      rt.preview.positions.slice(),
      rt.preview.indices.slice(),
      orientationMatrix(p).elements.slice(),
    );
    if (!this.registered.has(id)) this.registered.set(id, new Set());
    this.registered.get(id)!.add(w);
  }

  schedule(id: string, delay = 120): void {
    clearTimeout(this.timers.get(id));
    const p = this.pm.get(id);
    if (!p) {
      this.clearanceCache.delete(id);
      for (const w of this.registered.get(id) ?? []) void this.pool.workers[w].removePiece(id);
      this.registered.delete(id);
      this.pool.release(id);
      return;
    }
    if (!p.placement) {
      this.clearanceCache.delete(id);
      this.pm.setHeatmap(id, null);
      updatePiece(id, { fit: undefined, analyzing: false });
      return;
    }
    updatePiece(id, { analyzing: true });
    this.timers.set(
      id,
      setTimeout(() => void this.run(id), delay),
    );
  }

  private async run(id: string): Promise<void> {
    const w = this.workerFor(id);
    await this.ensure(id, w);
    const inputs = this.pm.analysisInputs(id);
    if (!inputs) return;
    const version = (this.versions.get(id) ?? 0) + 1;
    this.versions.set(id, version);
    try {
      const res = await this.pool.workers[w].analyze(
        id,
        inputs.world.elements.slice(),
        clearance.value,
        view.showHeatmap.value,
      );
      if (this.versions.get(id) !== version) return;
      updatePiece(id, {
        fit: { stats: res.stats, tally: res.tally, driving: res.driving },
        analyzing: false,
      });
      if (res.vertexClearance) this.clearanceCache.set(id, res.vertexClearance);
      this.recolor(id);
    } catch {
      updatePiece(id, { analyzing: false });
    }
  }

  async autoSize(
    id: string,
    mode: 'uniform' | 'axes',
  ): Promise<{ before: number; after: number; scale: number[]; moved: number } | null> {
    const inp = this.pm.autoSizeInputs(id);
    if (!inp) return null;
    const w = this.pool.indexOf(inp.ids[0], inp.ids);
    await Promise.all(inp.ids.map((m) => this.ensure(m, w)));
    const res = await this.pool.workers[w].autoSize(
      inp.ids,
      inp.placement.elements.slice(),
      inp.direction,
      inp.scale,
      inp.mirrored,
      clearance.value,
      mode,
      this.pm.get(id)!.orientation.category,
      this.pm.get(id)!.side,
    );
    this.pm.setScaleAndShift(id, res.scale, res.shift);
    return {
      before: res.before.median,
      after: res.after.median,
      scale: res.scale,
      moved: Math.hypot(res.shift[0], res.shift[1], res.shift[2]),
    };
  }

  async autoSizeAll(): Promise<number> {
    const seen = new Set<string>();
    const lanes = new Map<number, string[]>();
    for (const p of pieces.peek()) {
      if (!p.placement || seen.has(p.id)) continue;
      const members = this.pm.members(p.id);
      for (const m of members) seen.add(m);
      const w = this.pool.indexOf(p.id, members);
      if (!lanes.has(w)) lanes.set(w, []);
      lanes.get(w)!.push(p.id);
    }
    let n = 0;
    await Promise.all(
      [...lanes.values()].map(async (ids) => {
        for (const id of ids) {
          try {
            if (await this.autoSize(id, 'uniform')) n++;
          } catch {
            continue;
          }
        }
      }),
    );
    return n;
  }

  recolor(id: string): void {
    const values = this.clearanceCache.get(id);
    if (!view.showHeatmap.value || !values) {
      this.pm.setHeatmap(id, null);
      return;
    }
    const s = clearance.value;
    const colors = new Float32Array(values.length * 3);
    for (let i = 0; i < values.length; i++) {
      const v = values[i];
      colors.set(Number.isNaN(v) ? NEUTRAL : clearanceColor(v, s), i * 3);
    }
    this.pm.setHeatmap(id, colors);
  }
}
