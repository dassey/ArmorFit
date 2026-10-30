import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  measurePhotos,
  PhotoError,
  type PhotoGuide,
  type PhotoMeasurement,
  type PhotoView,
} from '../core/photo/silhouette';
import { knownKeys } from '../core/measurements/profile';
import { measurementInfo, type MeasurementKey } from '../core/measurements/schema';
import { fromMm, toMm } from '../core/units';
import { detectPose, loadPoseDetector, photoCanvas } from '../engine/PoseDetector';
import { measurementActions as act, photoSized, profile, toast, view } from '../state/store';
import { Button, NumberField } from './controls';

type Which = 'front' | 'side';

interface Slot {
  status: 'empty' | 'busy' | 'ready' | 'error';
  canvas?: HTMLCanvasElement;
  view?: PhotoView;
  error?: string;
}

const RESULT_ORDER: MeasurementKey[] = [
  'height',
  'chest',
  'waist',
  'hips',
  'shoulderWidth',
  'headCirc',
  'headWidth',
  'headLength',
  'upperArmLength',
  'forearmLength',
  'thighCirc',
  'calfCirc',
  'shinLength',
];

const SHORT: Partial<Record<MeasurementKey, string>> = {
  chest: 'Chest',
  waist: 'Waist',
  hips: 'Hips',
  shoulderWidth: 'Shoulders',
  headCirc: 'Head',
  thighCirc: 'Thigh',
  calfCirc: 'Calf',
};

const SLOT_TEXT: Record<Which, { title: string; pose: string }> = {
  front: { title: 'Front photo', pose: 'Face the camera, feet apart, arms out like an A.' },
  side: { title: 'Side photo', pose: 'Turn a quarter turn to your left or right. Same pose.' },
};

export function PoseFigure({ which }: { which: Which }) {
  return (
    <svg class="pose-figure" viewBox="0 0 60 100" aria-hidden="true">
      <circle cx="30" cy="10" r="7" />
      {which === 'front' ? (
        <path d="M30 19v33M30 25 15 47M30 25l15 22M30 52l-8 40M30 52l8 40" />
      ) : (
        <path d="M30 19v33M30 25l3 24M30 52v40h7M37 10h2" />
      )}
    </svg>
  );
}

function drawPhoto(
  target: HTMLCanvasElement,
  slot: Slot,
  guides: PhotoGuide[],
  values: PhotoMeasurement['values'] | null,
  bounds: [number, number] | null,
  heightMm: number,
): void {
  const src = slot.canvas!;
  target.width = src.width;
  target.height = src.height;
  const g = target.getContext('2d')!;
  g.drawImage(src, 0, 0);
  const s = Math.max(src.width, src.height) / 640;
  const mask = slot.view?.mask;
  if (mask && mask.width === src.width && mask.height === src.height) {
    // Dim everything but the person and trace their outline.
    const img = g.getImageData(0, 0, src.width, src.height);
    const d = img.data;
    const w = mask.width;
    const on = (i: number) => mask.data[i] >= 0.5;
    for (let i = 0, n = w * mask.height; i < n; i++) {
      if (!on(i)) {
        d[i * 4] *= 0.45;
        d[i * 4 + 1] *= 0.45;
        d[i * 4 + 2] *= 0.45;
      } else if (!on(i - 1) || !on(i + 1) || !on(i - w) || !on(i + w)) {
        d[i * 4] = 255;
        d[i * 4 + 1] = 211;
        d[i * 4 + 2] = 138;
      }
    }
    g.putImageData(img, 0, 0);
  }
  const unit = profile.value.displayUnit;
  const fmt = (mm: number) => `${fromMm(mm, unit).toFixed(unit === 'cm' ? 0 : 1)} ${unit}`;
  g.lineCap = 'round';
  g.font = `600 ${Math.round(12 * s)}px system-ui, sans-serif`;
  g.textBaseline = 'middle';
  const placed: [number, number, number, number][] = [];
  const label = (text: string, x: number, y: number) => {
    const w = g.measureText(text).width + 10 * s;
    const h = 18 * s;
    const lx = Math.min(Math.max(2, x), src.width - w - 2);
    const hits = (yy: number) =>
      placed.some(([a, b, c, d]) => lx < c && lx + w > a && yy - h / 2 < d && yy + h / 2 > b);
    while (hits(y)) y += h / 4;
    placed.push([lx, y - h / 2 - s, lx + w, y + h / 2 + s]);
    g.fillStyle = 'rgba(15, 17, 20, 0.82)';
    g.beginPath();
    g.roundRect(lx, y - h / 2, w, h, 5 * s);
    g.fill();
    g.fillStyle = '#ffd38a';
    g.fillText(text, lx + 5 * s, y);
  };
  if (bounds) {
    const x = 14 * s;
    g.strokeStyle = 'rgba(255, 255, 255, 0.85)';
    g.lineWidth = 2 * s;
    g.beginPath();
    g.moveTo(x, bounds[0]);
    g.lineTo(x, bounds[1]);
    g.moveTo(x - 6 * s, bounds[0]);
    g.lineTo(x + 6 * s, bounds[0]);
    g.moveTo(x - 6 * s, bounds[1]);
    g.lineTo(x + 6 * s, bounds[1]);
    g.stroke();
    label(fmt(heightMm), x + 6 * s, (bounds[0] + bounds[1]) / 2);
  }
  const labelled = new Set<MeasurementKey>();
  for (const gd of guides) {
    g.strokeStyle = '#e0a43a';
    g.lineWidth = 3 * s;
    g.beginPath();
    g.moveTo(gd.x0, gd.y);
    g.lineTo(gd.x1, gd.y);
    g.stroke();
    g.fillStyle = '#e0a43a';
    for (const x of [gd.x0, gd.x1]) {
      g.beginPath();
      g.arc(x, gd.y, 4 * s, 0, Math.PI * 2);
      g.fill();
    }
    const v = values?.[gd.key];
    if (v !== undefined && SHORT[gd.key] && !labelled.has(gd.key)) {
      labelled.add(gd.key);
      label(`${SHORT[gd.key]} ${fmt(v)}`, gd.x1 + 8 * s, gd.y);
    }
  }
}

function CameraCapture(props: {
  which: Which;
  onCapture: (c: HTMLCanvasElement) => void;
  onClose: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [count, setCount] = useState<number | null>(null);
  useEffect(() => {
    let stream: MediaStream | null = null;
    let stopped = false;
    navigator.mediaDevices
      .getUserMedia({
        video: { facingMode: 'user', width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false,
      })
      .then((s) => {
        if (stopped) return s.getTracks().forEach((t) => t.stop());
        stream = s;
        if (videoRef.current) videoRef.current.srcObject = s;
      })
      .catch(() => setError('The camera is not available. Allow camera access, or choose a photo instead.'));
    return () => {
      stopped = true;
      stream?.getTracks().forEach((t) => t.stop());
    };
  }, []);
  useEffect(() => {
    if (count === null) return;
    beep(count === 0 ? 1320 : 880, count === 0 ? 0.25 : 0.08);
    if (count === 0) {
      const v = videoRef.current;
      if (v && v.videoWidth) void photoCanvas(v).then(props.onCapture);
      return;
    }
    const t = setTimeout(() => setCount(count - 1), 1000);
    return () => clearTimeout(t);
  }, [count]);
  return (
    <div class="ps-camera">
      {error ? (
        <p class="field-note warn">{error}</p>
      ) : (
        <div class="ps-video">
          <video ref={videoRef} autoplay playsInline muted />
          <PoseFigure which={props.which} />
          {count !== null && count > 0 && <div class="ps-count">{count}</div>}
        </div>
      )}
      <p class="hint">
        Prop the device up at waist height, start the timer, then step back until your whole body is in view.
      </p>
      <div class="row gap wrap">
        {!error && (
          <Button variant="primary" disabled={count !== null} onClick={() => setCount(10)}>
            Start 10 s timer
          </Button>
        )}
        <Button variant="ghost" onClick={props.onClose}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

let audio: AudioContext | null = null;
function beep(freq: number, seconds: number): void {
  try {
    audio ??= new AudioContext();
    const o = audio.createOscillator();
    const gain = audio.createGain();
    gain.gain.value = 0.08;
    o.frequency.value = freq;
    o.connect(gain).connect(audio.destination);
    o.start();
    o.stop(audio.currentTime + seconds);
  } catch {}
}

function PhotoSlot(props: {
  which: Which;
  slot: Slot;
  guides: PhotoGuide[];
  values: PhotoMeasurement['values'] | null;
  bounds: [number, number] | null;
  heightMm: number;
  onImage: (source: Blob | HTMLCanvasElement) => void;
  onClear: () => void;
}) {
  const { which, slot } = props;
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [camera, setCamera] = useState(false);
  const [over, setOver] = useState(false);
  useEffect(() => {
    if (canvasRef.current && slot.canvas) {
      drawPhoto(canvasRef.current, slot, props.guides, props.values, props.bounds, props.heightMm);
    }
  }, [slot, props.guides, props.values, props.bounds, props.heightMm, profile.value.displayUnit]);
  const text = SLOT_TEXT[which];
  const pick = () => inputRef.current?.click();
  const canCamera = typeof navigator !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  return (
    <div
      class={`ps-slot ${slot.status} ${over ? 'over' : ''}`}
      onDragOver={(e) => {
        if (e.dataTransfer?.types.includes('Files')) {
          e.preventDefault();
          e.stopPropagation();
          setOver(true);
        }
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        const file = e.dataTransfer?.files[0];
        setOver(false);
        if (!file) return;
        e.preventDefault();
        e.stopPropagation();
        props.onImage(file);
      }}
    >
      <div class="ps-slot-head">
        <strong>{text.title}</strong>
        {slot.status === 'ready' && <span class="chip ok">✓ found you</span>}
        {(slot.status === 'ready' || slot.status === 'error') && (
          <button type="button" class="linklike" onClick={props.onClear}>
            Retake
          </button>
        )}
      </div>
      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        hidden
        aria-label={text.title}
        onChange={(e) => {
          const input = e.target as HTMLInputElement;
          const file = input.files?.[0];
          input.value = '';
          if (file) props.onImage(file);
        }}
      />
      {camera ? (
        <CameraCapture
          which={which}
          onClose={() => setCamera(false)}
          onCapture={(c) => {
            setCamera(false);
            props.onImage(c);
          }}
        />
      ) : slot.canvas ? (
        <div class="ps-photo">
          <canvas ref={canvasRef} role="img" aria-label={`${text.title} with measurements`} />
          {slot.status === 'busy' && (
            <div class="ps-busy">
              <span class="spinner" aria-hidden="true" /> Finding you…
            </div>
          )}
        </div>
      ) : (
        <button type="button" class="ps-empty" onClick={pick} disabled={slot.status === 'busy'}>
          <PoseFigure which={which} />
          <span>{text.pose}</span>
          <span class="ps-cta">{slot.status === 'busy' ? 'Reading photo…' : 'Take or choose a photo'}</span>
        </button>
      )}
      {slot.status === 'error' && <p class="field-note warn">{slot.error}</p>}
      {!camera && slot.status !== 'ready' && canCamera && (
        <button type="button" class="linklike small" onClick={() => setCamera(true)}>
          No one to help? Use this device’s camera with a 10 s timer
        </button>
      )}
    </div>
  );
}

export function PhotoSizer() {
  const open = view.photoSizer.value;
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      class="ps-dialog"
      aria-labelledby="ps-title"
      onClose={() => (view.photoSizer.value = false)}
      onCancel={() => (view.photoSizer.value = false)}
    >
      {open && <PhotoSizerBody />}
    </dialog>
  );
}

function PhotoSizerBody() {
  const p = profile.value;
  const unit = p.displayUnit;
  const [heightMm, setHeightMm] = useState<number | null>(
    knownKeys(p).includes('height') ? p.values.height : null,
  );
  const [model, setModel] = useState<'loading' | 'ready' | 'error'>('loading');
  const [slots, setSlots] = useState<Record<Which, Slot>>({
    front: { status: 'empty' },
    side: { status: 'empty' },
  });
  const [skip, setSkip] = useState<Set<MeasurementKey>>(new Set());
  const [tips, setTips] = useState(false);

  const load = () => {
    setModel('loading');
    loadPoseDetector().then(
      () => setModel('ready'),
      () => setModel('error'),
    );
  };
  useEffect(load, []);

  const analyze = async (which: Which, source: Blob | HTMLCanvasElement) => {
    setSlots((s) => ({ ...s, [which]: { status: 'busy' } }));
    try {
      const canvas = await photoCanvas(source);
      setSlots((s) => ({ ...s, [which]: { status: 'busy', canvas } }));
      const found = await detectPose(canvas);
      setSlots((s) => ({
        ...s,
        [which]: found
          ? { status: 'ready', canvas, view: found }
          : {
              status: 'error',
              canvas,
              error: 'No one found in this photo. Make sure your whole body is in it.',
            },
      }));
    } catch (e) {
      setModel((m) => (m === 'loading' ? 'error' : m));
      setSlots((s) => ({
        ...s,
        [which]: {
          status: 'error',
          error: e instanceof Error && /image/i.test(e.message) ? e.message : 'Could not read this photo.',
        },
      }));
    }
  };

  const outcome = useMemo((): { result?: PhotoMeasurement; error?: PhotoError } => {
    const f = slots.front.view;
    const s = slots.side.view;
    if (!f || !s || !heightMm) return {};
    try {
      return { result: measurePhotos(f, s, heightMm) };
    } catch (e) {
      return {
        error: e instanceof PhotoError ? e : new PhotoError('front', 'Could not measure these photos.'),
      };
    }
  }, [slots.front.view, slots.side.view, heightMm]);
  const result = outcome.result ?? null;

  const keys = result ? RESULT_ORDER.filter((k) => result.values[k] !== undefined) : [];
  const chosen = keys.filter((k) => !skip.has(k));
  const decimals = unit === 'cm' ? 1 : 2;

  const apply = () => {
    if (!result) return;
    const values: Partial<Record<MeasurementKey, number>> = {};
    for (const k of chosen) values[k] = result.values[k];
    act.setMany(values);
    photoSized.value = new Date().toISOString().slice(0, 10);
    view.part.value = 'full';
    view.photoSizer.value = false;
    toast(`Your mannequin now uses ${chosen.length} measurements from your photos.`);
  };

  const slotFor = (which: Which): Slot => {
    const slot = slots[which];
    const err = outcome.error?.view === which ? outcome.error.message : undefined;
    return err && slot.status === 'ready' ? { ...slot, status: 'error', error: err } : slot;
  };

  return (
    <div class="ps-body">
      <header class="ps-head">
        <div>
          <h2 id="ps-title">Measure me with photos</h2>
          <p class="hint">
            Two photos and your height are all it takes. They are read on this device and never uploaded.
          </p>
        </div>
        <button
          type="button"
          class="ps-close"
          aria-label="Close"
          onClick={() => (view.photoSizer.value = false)}
        >
          ✕
        </button>
      </header>

      <div class="row wrap gap ps-height">
        <label class="inline-label" for="ps-height">
          Height (barefoot)
        </label>
        <NumberField
          id="ps-height"
          value={heightMm ? fromMm(heightMm, unit) : NaN}
          decimals={decimals}
          step={unit === 'cm' ? 0.5 : 0.25}
          invalid={!heightMm}
          onCommit={(v) => setHeightMm(toMm(v, unit))}
        />
        <span class="unit">{unit}</span>
        {!heightMm && <span class="hint">Needed to turn pixels into {unit}.</span>}
        <span class={`ps-model ${model}`} role="status">
          {model === 'loading' && (
            <>
              <span class="spinner" aria-hidden="true" /> Getting the body finder ready (first time ≈ 25 MB)…
            </>
          )}
          {model === 'ready' && '● Body finder ready'}
          {model === 'error' && (
            <>
              Could not load the body finder.{' '}
              <button type="button" class="linklike" onClick={load}>
                Try again
              </button>
            </>
          )}
        </span>
      </div>

      <div class="ps-slots">
        {(['front', 'side'] as const).map((which) => (
          <PhotoSlot
            which={which}
            slot={slotFor(which)}
            guides={result?.guides[which] ?? []}
            values={result?.values ?? null}
            bounds={result?.bounds[which] ?? null}
            heightMm={heightMm ?? 0}
            onImage={(src) => void analyze(which, src)}
            onClear={() => setSlots((s) => ({ ...s, [which]: { status: 'empty' } }))}
          />
        ))}
      </div>

      <details class="ps-tips" open={tips} onToggle={(e) => setTips((e.target as HTMLDetailsElement).open)}>
        <summary>How to take photos that measure well</summary>
        <ul>
          <li>Wear something snug (leggings, a fitted top or the bodysuit you wear under the armor).</li>
          <li>Tie long hair up flat, take off shoes, and stand on a plain floor in front of a plain wall.</li>
          <li>Hold the camera at waist height, 2–3 m away, so you fill most of the photo, head to toe.</li>
          <li>For kids: a grown-up takes the photos while they stand like a star, then turn sideways.</li>
        </ul>
      </details>

      {result && (
        <section class="ps-results" aria-labelledby="ps-results-title">
          <h3 id="ps-results-title">Your measurements</h3>
          {result.issues.map((i) => (
            <p class="field-note warn">{i.message}</p>
          ))}
          <table>
            <thead>
              <tr>
                <th scope="col">Use</th>
                <th scope="col">Measurement</th>
                <th scope="col">From photos</th>
                <th scope="col">Now</th>
              </tr>
            </thead>
            <tbody>
              {keys.map((k) => {
                const v = result.values[k]!;
                const info = measurementInfo(k);
                const out = v < info.min || v > info.max;
                return (
                  <tr class={skip.has(k) ? 'off' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Use ${info.label.toLowerCase()}`}
                        checked={!skip.has(k)}
                        onChange={() => {
                          const next = new Set(skip);
                          if (next.has(k)) next.delete(k);
                          else next.add(k);
                          setSkip(next);
                        }}
                      />
                    </td>
                    <td>{info.label}</td>
                    <td class={`num-cell ${out ? 'warn' : ''}`} data-key={k}>
                      {fromMm(v, unit).toFixed(decimals)} {unit}
                    </td>
                    <td class="num-cell muted">
                      {fromMm(p.values[k], unit).toFixed(decimals)}
                      {knownKeys(p).includes(k) ? '' : ' est.'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p class="hint">
            Photo sizes are usually within 2–4 cm. Before printing a snug piece (helmet, bracers), check its
            key measurement with a tape.
          </p>
        </section>
      )}

      <footer class="ps-foot">
        <Button variant="ghost" onClick={() => (view.photoSizer.value = false)}>
          Cancel
        </Button>
        <Button variant="primary" disabled={!result || !chosen.length} onClick={apply}>
          {result ? `Use ${chosen.length} measurements` : 'Add both photos'}
        </Button>
      </footer>
    </div>
  );
}

/** The call to action shown on the Body tab. */
export function PhotoSizerCard() {
  const done = photoSized.value;
  if (done) {
    return (
      <div class="ps-card done">
        <span>📷 Sized from your photos on {done}.</span>
        <button type="button" class="linklike" onClick={() => (view.photoSizer.value = true)}>
          Redo
        </button>
      </div>
    );
  }
  return (
    <div class="ps-card">
      <div class="ps-card-figs" aria-hidden="true">
        <PoseFigure which="front" />
        <PoseFigure which="side" />
      </div>
      <div>
        <strong>No tape measure? Use two photos.</strong>
        <p class="hint">
          A front and a side photo give your chest, waist, hips, head, shoulders, arms and legs in about a
          minute. Photos stay on this device.
        </p>
        <Button variant="primary" onClick={() => (view.photoSizer.value = true)}>
          📷 Measure me with photos
        </Button>
      </div>
    </div>
  );
}
