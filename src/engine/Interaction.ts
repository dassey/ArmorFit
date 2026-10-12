import { Raycaster, Vector2 } from 'three';
import type { Vec3 } from '../core/math/linalg';
import type { PieceView } from './PieceView';
import type { Viewport } from './Viewport';

export interface Ray3 {
  origin: Vec3;
  dir: Vec3;
}

export interface InteractionHandlers {
  pieces(): PieceView[];
  selectedId(): string | null;
  select(id: string | null): void;
  dragTo(id: string, ray: Ray3 | null, done: boolean): void;
  twist(id: string, delta: number): void;
}

export class Interaction {
  private readonly raycaster = new Raycaster();
  private readonly ndc = new Vector2();
  private pointers = new Map<number, { x: number; y: number }>();
  private dragId: string | null = null;
  private dragStart: { x: number; y: number } | null = null;
  private dragging = false;
  private twistAngle: number | null = null;

  constructor(
    private readonly vp: Viewport,
    private readonly h: InteractionHandlers,
  ) {
    const el = vp.container;
    el.addEventListener('pointerdown', this.onDown, { capture: true });
    window.addEventListener('pointermove', this.onMove);
    window.addEventListener('pointerup', this.onUp);
    window.addEventListener('pointercancel', this.onUp);
    el.addEventListener('wheel', this.onWheel, { passive: false, capture: true });
  }

  rayAt(clientX: number, clientY: number): Ray3 | null {
    const rect = this.vp.renderer.domElement.getBoundingClientRect();
    if (clientX < rect.left || clientX > rect.right || clientY < rect.top || clientY > rect.bottom)
      return null;
    this.ndc.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(this.ndc, this.vp.camera);
    const o = this.raycaster.ray.origin;
    const d = this.raycaster.ray.direction;
    return { origin: [o.x, o.y, o.z], dir: [d.x, d.y, d.z] };
  }

  private pickPiece(clientX: number, clientY: number): string | null {
    const ray = this.rayAt(clientX, clientY);
    if (!ray) return null;
    const views = this.h.pieces();
    for (const v of views) v.ensureBVH();
    this.raycaster.firstHitOnly = true;
    const hits = this.raycaster.intersectObjects(
      views.map((v) => v.mesh),
      false,
    );
    return hits.length ? (hits[0].object.userData.pieceId as string) : null;
  }

  private onDown = (e: PointerEvent) => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2 && this.dragId) {
      this.twistAngle = this.angle();
      this.vp.controls.enabled = false;
      return;
    }
    if (this.pointers.size > 1 || e.button > 0) return;
    const id = this.pickPiece(e.clientX, e.clientY);
    if (id) {
      this.vp.controls.enabled = false;
      this.dragId = id;
      this.dragStart = { x: e.clientX, y: e.clientY };
      this.dragging = false;
      if (this.h.selectedId() !== id) this.h.select(id);
    } else {
      this.dragStart = { x: e.clientX, y: e.clientY };
    }
  };

  private angle(): number {
    const [a, b] = [...this.pointers.values()];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }

  private onMove = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.twistAngle !== null && this.dragId && this.pointers.size === 2) {
      const a = this.angle();
      let d = a - this.twistAngle;
      if (d > Math.PI) d -= 2 * Math.PI;
      if (d < -Math.PI) d += 2 * Math.PI;
      this.twistAngle = a;
      this.h.twist(this.dragId, -d);
      return;
    }
    if (!this.dragId || !this.dragStart) return;
    if (!this.dragging && Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y) < 6) return;
    this.dragging = true;
    this.h.dragTo(this.dragId, this.rayAt(e.clientX, e.clientY), false);
  };

  private onUp = (e: PointerEvent) => {
    if (!this.pointers.has(e.pointerId)) return;
    this.pointers.delete(e.pointerId);
    if (this.twistAngle !== null) {
      if (this.pointers.size < 2) this.twistAngle = null;
      if (this.pointers.size === 0) this.finish(e);
      return;
    }
    if (this.pointers.size === 0) this.finish(e);
  };

  private finish(e: PointerEvent) {
    if (this.dragId && this.dragging) this.h.dragTo(this.dragId, this.rayAt(e.clientX, e.clientY), true);
    else if (!this.dragId && this.dragStart) {
      const moved = Math.hypot(e.clientX - this.dragStart.x, e.clientY - this.dragStart.y);
      if (moved < 6 && e.target === this.vp.renderer.domElement) this.h.select(null);
    }
    this.dragId = null;
    this.dragStart = null;
    this.dragging = false;
    this.vp.controls.enabled = true;
  }

  private onWheel = (e: WheelEvent) => {
    const id = this.h.selectedId();
    if (!e.shiftKey || !id) return;
    e.preventDefault();
    e.stopPropagation();
    this.h.twist(id, Math.sign(e.deltaY || e.deltaX) * (Math.PI / 36));
  };

  beginExternalDrag(id: string, e: PointerEvent): void {
    const move = (ev: PointerEvent) => this.h.dragTo(id, this.rayAt(ev.clientX, ev.clientY), false);
    const up = (ev: PointerEvent) => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      this.h.dragTo(id, ev.type === 'pointercancel' ? null : this.rayAt(ev.clientX, ev.clientY), true);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
    move(e);
  }

  dispose(): void {
    const el = this.vp.container;
    el.removeEventListener('pointerdown', this.onDown, { capture: true });
    window.removeEventListener('pointermove', this.onMove);
    window.removeEventListener('pointerup', this.onUp);
    window.removeEventListener('pointercancel', this.onUp);
    el.removeEventListener('wheel', this.onWheel, { capture: true });
  }
}
