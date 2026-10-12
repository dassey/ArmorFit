import { effect } from '@preact/signals';
import { clearanceColor } from '../core/fit/heatmap';
import type { Remote } from '../workers/rpc';
import type { FitWorkerApi } from '../workers/fit.worker';
import { orientationMatrix, type PieceManager } from './pieceManager';
import { pieces, updatePiece } from './pieces';
import { clearance, view } from './store';

const NEUTRAL: [number, number, number] = [0.62, 0.7, 0.78];

export class AnalysisManager {
  private timers = new Map<string, ReturnType<typeof setTimeout>>();
  private versions = new Map<string, number>();
  private clearanceCache = new Map<string, Float32Array>();
  private registered = new Set<string>();

  constructor(
    private readonly fit: Remote<FitWorkerApi>,
    private readonly pm: PieceManager,
  ) {
    pm.onGeometry = (id) => void this.register(id);
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

  private async register(id: string): Promise<void> {
    const p = this.pm.get(id);
    const rt = this.pm.runtime(id);
    if (!p || !rt) return;
    await this.fit.setPiece(
      id,
      rt.preview.positions.slice(),
      rt.preview.indices.slice(),
      orientationMatrix(p).elements.slice(),
    );
    this.registered.add(id);
    if (p.placement) this.schedule(id);
  }

  schedule(id: string, delay = 120): void {
    clearTimeout(this.timers.get(id));
    const p = this.pm.get(id);
    if (!p) {
      this.clearanceCache.delete(id);
      void this.fit.removePiece(id);
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
    if (!this.registered.has(id)) await this.register(id);
    const inputs = this.pm.analysisInputs(id);
    if (!inputs) return;
    const version = (this.versions.get(id) ?? 0) + 1;
    this.versions.set(id, version);
    try {
      const res = await this.fit.analyze(
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
    for (const m of inp.ids) if (!this.registered.has(m)) await this.register(m);
    const res = await this.fit.autoSize(
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
    let n = 0;
    for (const p of pieces.peek()) {
      if (!p.placement || seen.has(p.id)) continue;
      for (const m of this.pm.members(p.id)) seen.add(m);
      try {
        if (await this.autoSize(p.id, 'uniform')) n++;
      } catch {
        continue;
      }
    }
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
