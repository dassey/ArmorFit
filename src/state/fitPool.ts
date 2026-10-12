import type { MeasurementProfile } from '../core/measurements/profile';
import type { FitWorkerApi } from '../workers/fit.worker';
import type { Remote } from '../workers/rpc';

export class FitPool {
  readonly workers: Remote<FitWorkerApi>[];
  private assigned = new Map<string, number>();
  private counts: number[];

  constructor(make: () => Remote<FitWorkerApi>, size: number) {
    this.workers = Array.from({ length: Math.max(1, size) }, make);
    this.counts = this.workers.map(() => 0);
  }

  get primary(): Remote<FitWorkerApi> {
    return this.workers[0];
  }

  async init(url: string) {
    const [meta] = await Promise.all([
      this.primary.init(url),
      ...this.workers.slice(1).map((w) => w.init(url).then(() => undefined)),
    ]);
    return meta;
  }

  async buildBody(profile: MeasurementProfile) {
    const [update] = await Promise.all([
      this.primary.buildBody(profile),
      ...this.workers.slice(1).map((w) => w.buildBody(profile).then(() => undefined)),
    ]);
    return update;
  }

  indexOf(id: string, affinity: string[] = []): number {
    const known = this.assigned.get(id);
    if (known !== undefined) return known;
    for (const other of affinity) {
      const w = this.assigned.get(other);
      if (w !== undefined) return this.assign(id, w);
    }
    let best = 0;
    for (let i = 1; i < this.counts.length; i++) if (this.counts[i] < this.counts[best]) best = i;
    return this.assign(id, best);
  }

  private assign(id: string, w: number): number {
    this.assigned.set(id, w);
    this.counts[w]++;
    return w;
  }

  release(id: string): void {
    const w = this.assigned.get(id);
    if (w === undefined) return;
    this.assigned.delete(id);
    this.counts[w]--;
  }
}
