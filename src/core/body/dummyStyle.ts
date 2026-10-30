// The look of the mannequin. Presets are starting points; any change to a colour or switch makes it custom.

export type DummyPreset = 'crash' | 'suit' | 'showroom' | 'custom';

export interface DummyStyle {
  preset: DummyPreset;
  /** Body colour, #rrggbb. */
  body: string;
  /** Seams, marker quarters and trim, #rrggbb. */
  trim: string;
  markers: boolean;
  seams: boolean;
  visor: boolean;
  lines: boolean;
  /** 0 matte … 1 glossy. */
  gloss: number;
}

export const DUMMY_PRESETS: Record<Exclude<DummyPreset, 'custom'>, DummyStyle & { label: string }> = {
  crash: {
    label: 'Crash test',
    preset: 'crash',
    body: '#f2b705',
    trim: '#141414',
    markers: true,
    seams: true,
    visor: false,
    lines: false,
    gloss: 0.65,
  },
  suit: {
    label: 'Fitting suit',
    preset: 'suit',
    body: '#4b525e',
    trim: '#e0a43a',
    markers: false,
    seams: false,
    visor: true,
    lines: true,
    gloss: 0.35,
  },
  showroom: {
    label: 'Showroom',
    preset: 'showroom',
    body: '#ece8e1',
    trim: '#3a3d44',
    markers: false,
    seams: true,
    visor: false,
    lines: false,
    gloss: 0.8,
  },
};

const HEX = /^#[0-9a-f]{6}$/i;

export function parseDummyStyle(json: string | null): DummyStyle {
  const { label: _label, ...def } = DUMMY_PRESETS.crash;
  try {
    const d = JSON.parse(json ?? 'null');
    if (!d || typeof d !== 'object') return def;
    return {
      preset: ['crash', 'suit', 'showroom', 'custom'].includes(d.preset) ? d.preset : def.preset,
      body: HEX.test(d.body) ? d.body : def.body,
      trim: HEX.test(d.trim) ? d.trim : def.trim,
      markers: typeof d.markers === 'boolean' ? d.markers : def.markers,
      seams: typeof d.seams === 'boolean' ? d.seams : def.seams,
      visor: typeof d.visor === 'boolean' ? d.visor : def.visor,
      lines: typeof d.lines === 'boolean' ? d.lines : def.lines,
      gloss: typeof d.gloss === 'number' && d.gloss >= 0 && d.gloss <= 1 ? d.gloss : def.gloss,
    };
  } catch {
    return def;
  }
}
