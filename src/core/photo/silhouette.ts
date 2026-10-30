import type { MeasurementKey, Measurements } from '../measurements/schema';

// Measures a body from a front and a side photo: a person mask (from a segmentation model) and a few pose
// landmarks per photo, in pixels. The stated height sets the scale of each photo; widths come from the front
// silhouette, depths from the side one, and circumferences from both. Constants are calibrated on the
// MakeHuman mannequin (see photo.test.ts), whose rest pose is the pose the photos ask for.

export interface PhotoMask {
  width: number;
  height: number;
  /** Person probability (0..1) or 0/1 per pixel, row-major. */
  data: ArrayLike<number>;
}

export const PHOTO_LANDMARKS = [
  'nose',
  'eyeL',
  'eyeR',
  'shoulderL',
  'shoulderR',
  'elbowL',
  'elbowR',
  'wristL',
  'wristR',
  'hipL',
  'hipR',
  'kneeL',
  'kneeR',
  'ankleL',
  'ankleR',
] as const;

export type PhotoLandmark = (typeof PHOTO_LANDMARKS)[number];

export interface PhotoPoint {
  x: number;
  y: number;
  visibility: number;
}

export interface PhotoView {
  mask: PhotoMask;
  landmarks: Partial<Record<PhotoLandmark, PhotoPoint>>;
}

/** A measurement drawn on a photo: a horizontal span at row y, in pixels. */
export interface PhotoGuide {
  key: MeasurementKey;
  y: number;
  x0: number;
  x1: number;
}

export interface PhotoIssue {
  view: 'front' | 'side';
  message: string;
}

export interface PhotoMeasurement {
  values: Partial<Measurements>;
  guides: { front: PhotoGuide[]; side: PhotoGuide[] };
  /** Person outline extent per photo, in pixels. */
  bounds: { front: [number, number]; side: [number, number] };
  issues: PhotoIssue[];
}

export class PhotoError extends Error {
  constructor(
    readonly view: 'front' | 'side',
    message: string,
  ) {
    super(message);
  }
}

// Height of each tape above the soles, as a fraction of standing height (MakeHuman mannequin, ANSUR-sized).
// Hip landmarks are too unsteady to place tapes from, the outline's top and bottom are not.
export const LEVELS = {
  chest: 0.741,
  waist: 0.601,
  hips: 0.483,
  thigh: 0.46,
  calf: 0.211,
};

// Tape length over ellipse perimeter (front width × side depth), and length over landmark distance, per
// measurement: mean of MediaPipe runs on rendered mannequins (six bodies, three camera set-ups).
export const CALIBRATION: Partial<Record<MeasurementKey, number>> = {
  chest: 1.135,
  waist: 1.026,
  hips: 1.056,
  headCirc: 1.069,
  thighCirc: 0.985,
  calfCirc: 1.058,
  headWidth: 1.014,
  headLength: 1.065,
  shoulderWidth: 0.88,
  upperArmLength: 1.156,
  forearmLength: 0.953,
  shinLength: 1.051,
};

export function ellipsePerimeter(width: number, depth: number): number {
  const a = width / 2;
  const b = depth / 2;
  const h = ((a - b) / (a + b)) ** 2;
  return Math.PI * (a + b) * (1 + (3 * h) / (10 + Math.sqrt(4 - 3 * h)));
}

class Silhouette {
  readonly w: number;
  readonly h: number;
  readonly on: Uint8Array;
  top = 0;
  bottom = 0;

  constructor(mask: PhotoMask, view: 'front' | 'side') {
    const { width: w, height: h, data } = mask;
    this.w = w;
    this.h = h;
    const raw = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) raw[i] = data[i] >= 0.5 ? 1 : 0;
    // Keep the largest connected region: drops background clutter and anyone else in the photo.
    const label = new Int32Array(w * h).fill(-1);
    const stack: number[] = [];
    let best = { id: -1, size: 0, top: 0, bottom: 0 };
    let id = 0;
    for (let s = 0; s < w * h; s++) {
      if (!raw[s] || label[s] >= 0) continue;
      label[s] = id;
      stack.push(s);
      let size = 0;
      let top = h;
      let bottom = -1;
      const visit = (j: number) => {
        if (raw[j] && label[j] < 0) {
          label[j] = id;
          stack.push(j);
        }
      };
      while (stack.length) {
        const i = stack.pop()!;
        size++;
        const x = i % w;
        const y = (i - x) / w;
        if (y < top) top = y;
        if (y > bottom) bottom = y;
        if (x > 0) visit(i - 1);
        if (x < w - 1) visit(i + 1);
        if (y > 0) visit(i - w);
        if (y < h - 1) visit(i + w);
      }
      if (size > best.size) best = { id, size, top, bottom };
      id++;
    }
    if (best.id < 0) throw new PhotoError(view, 'No person found in this photo.');
    this.on = new Uint8Array(w * h);
    for (let i = 0; i < w * h; i++) if (label[i] === best.id) this.on[i] = 1;
    this.top = best.top;
    this.bottom = best.bottom;
  }

  get span(): number {
    return this.bottom - this.top + 1;
  }

  /** Row at a fraction of the person's height above the soles. */
  rowAt(fraction: number): number {
    return this.bottom + 0.5 - fraction * this.span;
  }

  fractionAt(y: number): number {
    return (this.bottom + 0.5 - y) / this.span;
  }

  /** The run of person pixels on row y that contains x (or the nearest run within `slack` pixels). */
  runAt(y: number, x: number, slack = 3): [number, number] | null {
    const row = Math.round(y);
    if (row < 0 || row >= this.h) return null;
    const o = row * this.w;
    let cx = Math.round(x);
    if (cx < 0 || cx >= this.w) return null;
    if (!this.on[o + cx]) {
      let found = -1;
      for (let d = 1; d <= slack && found < 0; d++) {
        if (cx - d >= 0 && this.on[o + cx - d]) found = cx - d;
        else if (cx + d < this.w && this.on[o + cx + d]) found = cx + d;
      }
      if (found < 0) return null;
      cx = found;
    }
    let a = cx;
    let b = cx;
    while (a > 0 && this.on[o + a - 1]) a--;
    while (b < this.w - 1 && this.on[o + b + 1]) b++;
    return [a, b + 1];
  }

  /** All runs of person pixels on row y, left to right. */
  runs(y: number): [number, number][] {
    const row = Math.round(y);
    const out: [number, number][] = [];
    if (row < 0 || row >= this.h) return out;
    const o = row * this.w;
    let x = 0;
    while (x < this.w) {
      if (!this.on[o + x]) {
        x++;
        continue;
      }
      const a = x;
      while (x < this.w && this.on[o + x]) x++;
      out.push([a, x]);
    }
    return out;
  }

  /** The widest run on row y. */
  widestRun(y: number): [number, number] | null {
    let best: [number, number] | null = null;
    for (const r of this.runs(y)) if (!best || r[1] - r[0] > best[1] - best[0]) best = r;
    return best;
  }
}

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};

/** Median run over a few rows around y; returns the run on row y scaled to that median width. */
function steadyRun(
  rows: number,
  y: number,
  get: (y: number) => [number, number] | null,
): [number, number] | null {
  const runs: [number, number][] = [];
  for (let d = -rows; d <= rows; d++) {
    const r = get(y + d);
    if (r) runs.push(r);
  }
  if (runs.length < rows + 1) return null;
  const width = median(runs.map((r) => r[1] - r[0]));
  const center = median(runs.map((r) => (r[0] + r[1]) / 2));
  return [center - width / 2, center + width / 2];
}

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const dist = (a: PhotoPoint, b: PhotoPoint) => Math.hypot(a.x - b.x, a.y - b.y);

function need(view: PhotoView, which: 'front' | 'side', names: PhotoLandmark[]): Record<string, PhotoPoint> {
  const out: Record<string, PhotoPoint> = {};
  const missing: PhotoLandmark[] = [];
  for (const n of names) {
    const p = view.landmarks[n];
    if (p && Number.isFinite(p.x) && Number.isFinite(p.y)) out[n] = p;
    else missing.push(n);
  }
  if (missing.length) {
    throw new PhotoError(
      which,
      'Could not find your whole body. Stand so your head and feet are in the photo.',
    );
  }
  return out;
}

const mid = (a: PhotoPoint, b: PhotoPoint): PhotoPoint => ({
  x: (a.x + b.x) / 2,
  y: (a.y + b.y) / 2,
  visibility: Math.min(a.visibility, b.visibility),
});

export function measurePhotos(front: PhotoView, side: PhotoView, heightMm: number): PhotoMeasurement {
  const issues: PhotoIssue[] = [];
  const values: Partial<Measurements> = {};
  const guides: PhotoMeasurement['guides'] = { front: [], side: [] };
  const k = (key: MeasurementKey) => CALIBRATION[key] ?? 1;

  const L = need(front, 'front', [
    'eyeL',
    'eyeR',
    'shoulderL',
    'shoulderR',
    'elbowL',
    'elbowR',
    'wristL',
    'wristR',
    'hipL',
    'hipR',
    'kneeL',
    'kneeR',
    'ankleL',
    'ankleR',
  ]);
  const shoulders = mid(L.shoulderL, L.shoulderR);
  const hips = mid(L.hipL, L.hipR);
  const eyes = mid(L.eyeL, L.eyeR);
  const torso = mid(shoulders, hips);
  const F = new Silhouette(front.mask, 'front');
  if (F.top <= 1) issues.push({ view: 'front', message: 'The top of your head looks cut off.' });
  if (F.bottom >= F.h - 2) issues.push({ view: 'front', message: 'Your feet look cut off.' });
  if (F.span < 300) {
    issues.push({
      view: 'front',
      message: 'You are small in the photo: step closer or use a higher resolution.',
    });
  }
  const sf = heightMm / F.span;

  const S = new Silhouette(side.mask, 'side');
  if (S.top <= 1) issues.push({ view: 'side', message: 'The top of your head looks cut off.' });
  if (S.bottom >= S.h - 2) issues.push({ view: 'side', message: 'Your feet look cut off.' });
  const ss = heightMm / S.span;

  // A side view shows the shoulders nearly on top of each other.
  const sideShoulders =
    side.landmarks.shoulderL && side.landmarks.shoulderR
      ? dist(side.landmarks.shoulderL, side.landmarks.shoulderR) * ss
      : 0;
  const frontShoulders = dist(L.shoulderL, L.shoulderR) * sf;
  if (sideShoulders > 0.55 * frontShoulders) {
    throw new PhotoError(
      'side',
      'This does not look like a side view. Turn 90° so your shoulder faces the camera.',
    );
  }
  if (frontShoulders < 150) {
    throw new PhotoError('front', 'This does not look like a front view. Face the camera.');
  }

  const rows = Math.max(1, Math.round(6 / sf));
  const srows = Math.max(1, Math.round(6 / ss));
  const depthAt = (fraction: number) => steadyRun(srows, S.rowAt(fraction), (y) => S.widestRun(y));

  const ring = (
    key: MeasurementKey,
    y: number,
    frontRun: [number, number] | null,
    depthRun: [number, number] | null = depthAt(F.fractionAt(y)),
  ) => {
    if (!frontRun || !depthRun) return;
    const w = (frontRun[1] - frontRun[0]) * sf;
    const d = (depthRun[1] - depthRun[0]) * ss;
    values[key] = k(key) * ellipsePerimeter(w, d);
    guides.front.push({ key, y, x0: frontRun[0], x1: frontRun[1] });
    guides.side.push({ key, y: S.rowAt(F.fractionAt(y)), x0: depthRun[0], x1: depthRun[1] });
  };

  // Torso: the run around the body's midline. At the armpits the arms merge into that run, so the chest width
  // is taken on the first row below the chest tape where both arms show as runs of their own.
  const torsoRun = (y: number) => steadyRun(rows, y, (yy) => F.runAt(yy, torso.x));
  const armsApart = (y: number) => {
    const runs = F.runs(y);
    const i = runs.findIndex((r) => r[0] <= torso.x && r[1] >= torso.x);
    return i > 0 && i < runs.length - 1;
  };
  // Near the crotch the legs may part in the outline; the tape still goes around both.
  const pelvisSpan = (y: number): [number, number] | null => {
    const xs = [L.hipL.x, L.hipR.x, torso.x];
    const runs = F.runs(y).filter((r) => xs.some((x) => r[0] <= x && r[1] >= x));
    return runs.length ? [runs[0][0], runs[runs.length - 1][1]] : null;
  };
  let chest: { y: number; run: [number, number] } | null = null;
  for (let f = LEVELS.chest; f >= LEVELS.chest - 0.06 && !chest; f -= 0.002) {
    const y = F.rowAt(f);
    const run = armsApart(y) && armsApart(y - rows) && armsApart(y + rows) ? torsoRun(y) : null;
    if (run) chest = { y, run };
  }
  if (chest) {
    let depth: [number, number] | null = null;
    for (let f = LEVELS.chest - 0.03; f <= LEVELS.chest + 0.02; f += 0.003) {
      const r = depthAt(f);
      if (r && (!depth || r[1] - r[0] > depth[1] - depth[0])) depth = r;
    }
    ring('chest', chest.y, chest.run, depth);
  }
  // Waist at its level; hips at the fullest depth near theirs.
  for (const [key, lo, hi] of [
    ['waist', 0, 0],
    ['hips', -0.01, 0.01],
  ] as const) {
    let best: { f: number; depth: [number, number] } | null = null;
    for (let f = LEVELS[key] + lo; f <= LEVELS[key] + hi + 1e-9; f += 0.0025) {
      const r = depthAt(f);
      if (r && (!best || r[1] - r[0] > best.depth[1] - best.depth[0])) best = { f, depth: r };
    }
    if (!best) continue;
    const y = F.rowAt(best.f);
    if (key === 'waist' && !armsApart(y)) continue;
    ring(key, y, key === 'hips' ? steadyRun(rows, y, pelvisSpan) : torsoRun(y), best.depth);
  }
  if (!values.chest || !values.waist) {
    issues.push({
      view: 'front',
      message:
        'Your arms touch your sides in the front photo, so your chest or waist was skipped. Hold them out more.',
    });
  }

  // Head: widest above the eyes (front) and longest (side), over hair; the tape goes over hair too.
  {
    const yTop = F.top;
    let wide: { y: number; run: [number, number] } | null = null;
    for (let t = 0.05; t <= 0.85; t += 0.02) {
      const y = lerp(eyes.y, yTop, t);
      const run = F.runAt(y, eyes.x);
      if (run && (!wide || run[1] - run[0] > wide.run[1] - wide.run[0])) wide = { y, run };
    }
    let long: { y: number; run: [number, number] } | null = null;
    const fEyes = F.fractionAt(eyes.y);
    const fTop = F.fractionAt(yTop);
    for (let t = 0.05; t <= 0.85; t += 0.02) {
      const run = S.widestRun(S.rowAt(lerp(fEyes, fTop, t)));
      if (run && (!long || run[1] - run[0] > long.run[1] - long.run[0]))
        long = { y: lerp(fEyes, fTop, t), run };
    }
    if (wide && long) {
      const w = (wide.run[1] - wide.run[0]) * sf;
      const d = (long.run[1] - long.run[0]) * ss;
      values.headWidth = k('headWidth') * w;
      values.headLength = k('headLength') * d;
      values.headCirc = k('headCirc') * ellipsePerimeter(w, d);
      guides.front.push({ key: 'headCirc', y: wide.y, x0: wide.run[0], x1: wide.run[1] });
      guides.side.push({ key: 'headCirc', y: S.rowAt(long.y), x0: long.run[0], x1: long.run[1] });
    }
  }

  // Legs: each leg's own run, averaged over both legs. Thighs that touch are split at the body's midline.
  const legRing = (key: 'thighCirc' | 'calfCirc', upper: 'hip' | 'knee', lower: 'knee' | 'ankle') => {
    const widths: number[] = [];
    let y0 = 0;
    for (const s of ['L', 'R'] as const) {
      const o = s === 'L' ? 'R' : 'L';
      const a = L[`${upper}${s}`];
      const b = L[`${lower}${s}`];
      const y = F.rowAt(LEVELS[key === 'thighCirc' ? 'thigh' : 'calf']);
      const along = (yy: number) => lerp(a.x, b.x, (yy - a.y) / (b.y - a.y || 1));
      const across = (yy: number) =>
        (along(yy) + lerp(L[`${upper}${o}`].x, L[`${lower}${o}`].x, (yy - a.y) / (b.y - a.y || 1))) / 2;
      const run = steadyRun(rows, y, (yy) => {
        const r = F.runAt(yy, along(yy));
        if (!r) return null;
        const m = across(yy);
        if (r[0] < m && r[1] > m) return along(yy) < m ? [r[0], m] : [m, r[1]];
        return r;
      });
      if (!run) continue;
      widths.push(run[1] - run[0]);
      y0 = y;
      guides.front.push({ key, y, x0: run[0], x1: run[1] });
    }
    if (!widths.length) return;
    const depth = depthAt(F.fractionAt(y0));
    if (!depth) return;
    const w = median(widths) * sf;
    const d = (depth[1] - depth[0]) * ss;
    values[key] = k(key) * ellipsePerimeter(w, d);
    guides.side.push({ key, y: S.rowAt(F.fractionAt(y0)), x0: depth[0], x1: depth[1] });
  };
  legRing('thighCirc', 'hip', 'knee');
  legRing('calfCirc', 'knee', 'ankle');

  // Lengths from the front landmarks.
  const both = (f: (s: 'L' | 'R') => number) => (f('L') + f('R')) / 2;
  // Shoulder width: across the deltoids at shoulder-joint level, scaled to the bony tips.
  const across = steadyRun(rows, shoulders.y, (yy) => F.runAt(yy, shoulders.x));
  if (across) {
    values.shoulderWidth = k('shoulderWidth') * (across[1] - across[0]) * sf;
    guides.front.push({ key: 'shoulderWidth', y: shoulders.y, x0: across[0], x1: across[1] });
  }
  values.upperArmLength = k('upperArmLength') * both((s) => dist(L[`shoulder${s}`], L[`elbow${s}`])) * sf;
  values.forearmLength = k('forearmLength') * both((s) => dist(L[`elbow${s}`], L[`wrist${s}`])) * sf;
  values.shinLength = k('shinLength') * both((s) => Math.abs(L[`ankle${s}`].y - L[`knee${s}`].y)) * sf;
  values.height = heightMm;

  return {
    values,
    guides,
    bounds: { front: [F.top, F.bottom + 1], side: [S.top, S.bottom + 1] },
    issues,
  };
}
