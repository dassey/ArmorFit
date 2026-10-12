import { effect, signal } from '@preact/signals';
import {
  clearMeasurement,
  newProfile,
  parseProfile,
  recomputeProfile,
  serializeProfile,
  setMeasurement,
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
import { UNDERGARMENT_ALLOWANCE_MM } from '../core/measurements/schema';
import { computed } from '@preact/signals';

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
};

export type Tab = 'body' | 'armor' | 'fit' | 'print';

export const view = {
  tab: signal<Tab>('body'),
  showRegions: signal(false),
  showHeatmap: signal(true),
  armorOpacity: signal(1),
  toasts: signal<{ id: number; text: string; kind: 'info' | 'error' }[]>([]),
};

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

export const clearance = computed(() =>
  withAllowance(clearanceBase.value, UNDERGARMENT_ALLOWANCE_MM[profile.value.undergarment]),
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
  },
  importJson(text: string) {
    profile.value = parseProfile(text);
  },
  exportJson(): string {
    return serializeProfile(profile.value);
  },
};
