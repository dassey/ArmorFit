import { computed, effect, signal } from '@preact/signals';
import { DUMMY_PRESETS, parseDummyStyle, type DummyStyle } from '../core/body/dummyStyle';
import { isBodyPartId, partMeasurements, type BodyPartId } from '../core/body/parts';
import {
  clearMeasurement,
  newProfile,
  parseProfile,
  recomputeProfile,
  serializeProfile,
  setMeasurement,
  setMeasurements,
  type MeasurementProfile,
} from '../core/measurements/profile';
import type {
  MeasurementKey,
  Measurements,
  ProportionPreset,
  Undergarment,
} from '../core/measurements/schema';
import type { DisplayUnit } from '../core/units';
import { DEFAULT_CLEARANCE, withAllowance, type ClearanceSettings } from '../core/fit/clearance';
import { MEASUREMENT_KEYS, UNDERGARMENT_ALLOWANCE_MM } from '../core/measurements/schema';

const PROFILE_KEY = 'armorfit:profile:v1';

function safeLoad(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function safeSave(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {}
}

function initialProfile(): MeasurementProfile {
  const saved = safeLoad(PROFILE_KEY);
  if (saved) {
    try {
      return parseProfile(saved);
    } catch {}
  }
  return newProfile();
}

export const profile = signal<MeasurementProfile>(initialProfile());

effect(() => safeSave(PROFILE_KEY, serializeProfile(profile.value)));

export type BodyStatus = 'loading' | 'solving' | 'ready' | 'error';

export const body = {
  status: signal<BodyStatus>('loading'),
  error: signal<string | null>(null),
  measured: signal<Partial<Measurements>>({}),
  credits: signal(''),
  version: signal(0),
};

export type Tab = 'body' | 'armor' | 'fit' | 'print';

const PART_KEY = 'armorfit:part:v1';
const RULERS_KEY = 'armorfit:rulers:v1';

function initialPart(): BodyPartId {
  const saved = safeLoad(PART_KEY);
  return isBodyPartId(saved) ? saved : 'full';
}

function initialRulers(): MeasurementKey[] {
  try {
    const saved = JSON.parse(safeLoad(RULERS_KEY) ?? '[]');
    if (Array.isArray(saved)) return MEASUREMENT_KEYS.filter((k) => saved.includes(k));
  } catch {}
  return [];
}

export const view = {
  tab: signal<Tab>('body'),
  part: signal<BodyPartId>(initialPart()),
  rulers: signal<MeasurementKey[]>(initialRulers()),
  hoverRuler: signal<MeasurementKey | null>(null),
  focusRuler: signal<MeasurementKey | null>(null),
  adjusting: signal(false),
  showRegions: signal(false),
  showHeatmap: signal(true),
  armorOpacity: signal(1),
  photoSizer: signal(false),
  toasts: signal<{ id: number; text: string; kind: 'info' | 'error' }[]>([]),
};

effect(() => safeSave(PART_KEY, view.part.value));

const DUMMY_KEY = 'armorfit:dummy:v1';
export const dummyStyle = signal<DummyStyle>(parseDummyStyle(safeLoad(DUMMY_KEY)));
effect(() => safeSave(DUMMY_KEY, JSON.stringify(dummyStyle.value)));

export const dummyActions = {
  preset(id: keyof typeof DUMMY_PRESETS) {
    const { label: _label, ...style } = DUMMY_PRESETS[id];
    dummyStyle.value = style;
  },
  change(patch: Partial<Omit<DummyStyle, 'preset'>>) {
    dummyStyle.value = { ...dummyStyle.value, ...patch, preset: 'custom' };
  },
};

const PHOTO_KEY = 'armorfit:photo-sized:v1';
/** When the measurements last came from photos (ISO date), or null. */
export const photoSized = signal<string | null>(safeLoad(PHOTO_KEY));
effect(() => {
  const v = photoSized.value;
  if (v) safeSave(PHOTO_KEY, v);
  else {
    try {
      localStorage.removeItem(PHOTO_KEY);
    } catch {}
  }
});
effect(() => safeSave(RULERS_KEY, JSON.stringify(view.rulers.value)));

export const visibleMeasurements = computed(() => partMeasurements(view.part.value, profile.value.mode));

export const activeRuler = computed(() => {
  const k = view.hoverRuler.value ?? view.focusRuler.value;
  return k && visibleMeasurements.value.includes(k) ? k : null;
});

export function toggleRuler(key: MeasurementKey): void {
  const list = view.rulers.value;
  view.rulers.value = list.includes(key) ? list.filter((k) => k !== key) : [...list, key];
}

export const shownRulers = computed(() => {
  const visible = visibleMeasurements.value;
  const keys = view.rulers.value.filter((k) => visible.includes(k));
  const active = activeRuler.value;
  return active && !keys.includes(active) ? [...keys, active] : keys;
});

const PRINT_KEY = 'armorfit:print:v1';
interface PrintSettings {
  printerId: string;
  custom: [number, number, number];
  orientation: 'original' | 'wearing';
}
function initialPrint(): PrintSettings {
  const def: PrintSettings = {
    printerId: 'bambu-h2c-left',
    custom: [250, 250, 250],
    orientation: 'original',
  };
  try {
    const saved = JSON.parse(safeLoad(PRINT_KEY) ?? 'null');
    if (saved && typeof saved.printerId === 'string') return { ...def, ...saved };
  } catch {}
  return def;
}
export const printSettings = signal<PrintSettings>(initialPrint());
effect(() => safeSave(PRINT_KEY, JSON.stringify(printSettings.value)));

export const clearanceBase = signal<ClearanceSettings>({ ...DEFAULT_CLEARANCE });

const undergarment = computed(() => profile.value.undergarment);

export const clearance = computed(() =>
  withAllowance(clearanceBase.value, UNDERGARMENT_ALLOWANCE_MM[undergarment.value]),
);

let toastId = 0;
export function toast(
  text: string,
  kind: 'info' | 'error' = 'info',
  ms = kind === 'error' ? 8000 : 4000,
): void {
  const id = ++toastId;
  view.toasts.value = [...view.toasts.value, { id, text, kind }];
  setTimeout(() => (view.toasts.value = view.toasts.value.filter((t) => t.id !== id)), ms);
}

export const measurementActions = {
  set(key: MeasurementKey, mm: number) {
    profile.value = setMeasurement(profile.value, key, mm);
  },
  setMany(values: Partial<Measurements>) {
    profile.value = setMeasurements(profile.value, values);
  },
  clear(key: MeasurementKey) {
    profile.value = clearMeasurement(profile.value, key);
  },
  setMode(mode: 'quick' | 'detailed') {
    profile.value = recomputeProfile({ ...profile.value, mode });
  },
  setPreset(preset: ProportionPreset) {
    profile.value = recomputeProfile({ ...profile.value, preset });
  },
  setUnit(displayUnit: DisplayUnit) {
    profile.value = { ...profile.value, displayUnit };
  },
  setUndergarment(undergarment: Undergarment) {
    profile.value = { ...profile.value, undergarment };
  },
  resetAll() {
    profile.value = { ...newProfile(), displayUnit: profile.value.displayUnit };
    photoSized.value = null;
  },
  importJson(text: string) {
    profile.value = parseProfile(text);
  },
  exportJson(): string {
    return serializeProfile(profile.value);
  },
};
