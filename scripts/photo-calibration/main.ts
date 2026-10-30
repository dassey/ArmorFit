// Photographs rendered mannequins and measures them with the app's photo pipeline (MediaPipe + silhouettes).
// Driven by scripts/calibrate-photo.mjs, which passes options on `window.CALIBRATE` and reads `window.RESULT`.
import {
  BufferAttribute,
  BufferGeometry,
  Color,
  DirectionalLight,
  HemisphereLight,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  Scene,
  SRGBColorSpace,
  WebGLRenderer,
} from 'three';
import { parseBodyAsset } from '../../src/core/body/asset';
import { MannequinBuilder, type Mannequin } from '../../src/core/body/mannequin';
import { estimateMeasurements } from '../../src/core/measurements/estimate';
import { newProfile, setMeasurements } from '../../src/core/measurements/profile';
import type { MeasurementKey, ProportionPreset } from '../../src/core/measurements/schema';
import { CALIBRATION, measurePhotos } from '../../src/core/photo/silhouette';
import { detectPose, photoCanvas } from '../../src/engine/PoseDetector';

interface Options {
  holdout?: boolean;
  /** Camera distance and height in metres, skin and wall colours. */
  distance?: number;
  cameraHeight?: number;
  skin?: string;
  wall?: string;
  /** Return JPEG photos of the first body with its true measurements. */
  photos?: boolean;
}

type Body = [string, ProportionPreset, Record<string, number>];

const CALIBRATION_SET: Body[] = [
  ['average man', 'masculine', {}],
  ['average woman', 'feminine', {}],
  ['tall heavier man', 'masculine', { height: 1930, chest: 1180, waist: 1050, headCirc: 600 }],
  ['petite woman', 'feminine', { height: 1540, chest: 840, waist: 680, headCirc: 540 }],
  ['curvy woman', 'feminine', { height: 1650, chest: 1040, waist: 860, hips: 1120 }],
  ['slim teen', 'neutral', { height: 1580, chest: 800, waist: 660, headCirc: 545 }],
];

const HOLDOUT_SET: Body[] = [
  ['holdout neutral', 'neutral', { height: 1700, chest: 950, waist: 820, headCirc: 565 }],
  ['holdout broad man', 'masculine', { height: 1820, chest: 1120, waist: 900, hips: 1040 }],
  ['holdout small woman', 'feminine', { height: 1600, chest: 880, waist: 720, hips: 960, headCirc: 550 }],
  ['holdout heavy woman', 'feminine', { height: 1680, chest: 1150, waist: 1020, hips: 1200 }],
];

const W = 720;
const H = 1280;

async function run(o: Options) {
  const renderer = new WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(W, H);
  renderer.outputColorSpace = SRGBColorSpace;
  document.body.appendChild(renderer.domElement);
  const scene = new Scene();
  scene.background = new Color(o.wall ?? '#d9d4cb');
  scene.add(new HemisphereLight(0xffffff, 0x8a7d70, 1.6));
  const sun = new DirectionalLight(0xffffff, 1.8);
  sun.position.set(1, 2, 3);
  scene.add(sun);
  const camera = new PerspectiveCamera(62, W / H, 0.1, 50);

  const shoot = (man: Mannequin, view: 'front' | 'side') => {
    const y = o.cameraHeight ?? (man.measured.height! / 1000) * 0.55;
    const d = o.distance ?? 2.1;
    camera.position.set(view === 'front' ? 0 : d, y, view === 'front' ? d : 0);
    camera.lookAt(0, y, 0);
    renderer.render(scene, camera);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    c.getContext('2d')!.drawImage(renderer.domElement, 0, 0);
    return c;
  };

  const res = await fetch('./assets/body/hm08.armorfit.bin.gz');
  const builder = new MannequinBuilder(parseBodyAsset(new Uint8Array(await res.arrayBuffer())));
  const ratios: Record<string, number[]> = {};
  const errors: Record<string, number[]> = {};
  const bodies: Record<string, unknown>[] = [];
  for (const [label, preset, known] of o.holdout ? HOLDOUT_SET : CALIBRATION_SET) {
    const values = estimateMeasurements(known, preset).values;
    const man = builder.build(setMeasurements({ ...newProfile(), preset }, values));
    const g = new BufferGeometry();
    g.setAttribute(
      'position',
      new BufferAttribute(
        man.positions.map((v) => v / 1000),
        3,
      ),
    );
    g.setAttribute('normal', new BufferAttribute(man.normals, 3));
    g.setIndex(new BufferAttribute(man.indices, 1));
    const mesh = new Mesh(g, new MeshStandardMaterial({ color: o.skin ?? '#c49a7c', roughness: 0.7 }));
    scene.add(mesh);
    const front = shoot(man, 'front');
    const side = shoot(man, 'side');
    scene.remove(mesh);
    if (o.photos) {
      return {
        front: front.toDataURL('image/jpeg', 0.82),
        side: side.toDataURL('image/jpeg', 0.82),
        truth: man.measured,
      };
    }
    const fv = await detectPose(await photoCanvas(front));
    const sv = await detectPose(await photoCanvas(side));
    if (!fv || !sv) {
      bodies.push({ label, error: 'no pose found' });
      continue;
    }
    const m = measurePhotos(fv, sv, man.measured.height!);
    const row: Record<string, unknown> = { label, issues: m.issues.map((i) => i.message) };
    for (const [k, v] of Object.entries(m.values) as [MeasurementKey, number][]) {
      if (k === 'height') continue;
      const truth = man.measured[k]!;
      row[k] = `${v.toFixed(0)}/${truth.toFixed(0)}`;
      (ratios[k] ??= []).push(truth / (v / (CALIBRATION[k] ?? 1)));
      (errors[k] ??= []).push(Math.abs(v - truth) / truth);
    }
    bodies.push(row);
  }
  const mean = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const summary = Object.fromEntries(
    Object.entries(ratios).map(([k, r]) => {
      const m = mean(r);
      const sd = Math.sqrt(mean(r.map((x) => (x - m) ** 2)));
      const e = errors[k];
      return [
        k,
        `raw ratio ${m.toFixed(4)} ± ${sd.toFixed(4)} · error mean ${(mean(e) * 100).toFixed(1)}% max ${(Math.max(...e) * 100).toFixed(1)}%`,
      ];
    }),
  );
  return { bodies, summary };
}

const w = window as unknown as { CALIBRATE?: Options; RESULT?: unknown };
run(w.CALIBRATE ?? {}).then(
  (r) => (w.RESULT = r),
  (e) => (w.RESULT = { error: String(e?.stack ?? e) }),
);
