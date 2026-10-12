import { sizingReportMarkdown } from '../core/export/report';
import {
  MEASUREMENT_KEYS,
  type MeasurementKey,
  type ProportionPreset,
  type Undergarment,
} from '../core/measurements/schema';
import { customPrinter, findPrinter, PRINTERS } from '../core/print/printers';
import { PIECE_TYPES, type PieceTypeId, type Side } from '../core/pieces/types';
import { toMm } from '../core/units';
import { APP_VERSION } from '../version';
import type { AppController } from './controller';
import { importBusy, pieces, selectedId, type PieceState } from './pieces';
import { buildProjectJson } from './project';
import {
  body,
  clearance,
  clearanceBase,
  measurementActions,
  printSettings,
  profile,
  view,
  type Tab,
} from './store';

type Json = Record<string, unknown>;

export interface ToolDefinition {
  name: string;
  title: string;
  description: string;
  inputSchema: Json;
  annotations?: { readOnlyHint?: boolean; consequentialHint?: boolean };
  execute: (input: Json) => Promise<unknown>;
}

interface ModelContextLike {
  registerTool(tool: unknown, options?: { signal?: AbortSignal }): unknown;
}

const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function settled(timeoutMs = 60_000): Promise<boolean> {
  const end = Date.now() + timeoutMs;
  await wait(150);
  while (Date.now() < end) {
    const busy =
      importBusy.value > 0 ||
      body.status.value === 'solving' ||
      body.status.value === 'loading' ||
      pieces.value.some((p) => p.analyzing);
    if (!busy) return true;
    await wait(100);
  }
  return false;
}

function verdict(p: PieceState): string {
  const s = p.fit?.stats;
  if (!p.placement) return 'not on body';
  if (!s) return 'analysing';
  if (s.intersecting > 0.05) return 'intersects the body';
  if (s.intersecting > 0 || s.tight > 0.1) return 'too tight in places';
  if (s.loose > 0.5) return 'loose';
  return 'good fit';
}

const round = (x: number, d = 1) => Math.round(x * 10 ** d) / 10 ** d;

function summary(p: PieceState): Json {
  return {
    id: p.id,
    name: p.name,
    type: p.type,
    side: p.side,
    onBody: !!p.placement,
    verdict: verdict(p),
    scalePercent: p.scale.map((s) => round(s * 100)),
    medianGapMm: p.fit ? round(p.fit.stats.median) : null,
    group: p.group,
    triangles: p.fullTriangles,
    needsCheck: [
      ...(!p.unitConfirmed && p.units.needsConfirmation ? ['units'] : []),
      ...(!p.orientationConfirmed && p.orientation.confidence < 0.6 ? ['orientation'] : []),
      ...(!p.topology.watertight ? ['not watertight'] : []),
    ],
  };
}

function detail(p: PieceState): Json {
  const s = p.fit?.stats;
  return {
    ...summary(p),
    fileName: p.fileName,
    unitScale: p.unitScale,
    orientation: { category: p.orientation.category, confidence: round(p.orientation.confidence, 2) },
    fit: s
      ? {
          minGapMm: round(s.min),
          medianGapMm: round(s.median),
          intersectingPercent: round(s.intersecting * 100),
          tightPercent: round(s.tight * 100),
          goodPercent: round(s.good * 100),
          loosePercent: round(s.loose * 100),
          covers: p
            .fit!.tally.slice(0, 4)
            .map((t) => ({ region: t.label, percent: round(t.fraction * 100) })),
          drivenBy: p.fit!.driving,
        }
      : null,
    warnings: p.warnings,
  };
}

function find(id: unknown): PieceState {
  const p = pieces.value.find((x) => x.id === id || x.name === id);
  if (!p) throw new Error(`No piece with id or name "${String(id)}". Call armorfit_get_status for the list.`);
  return p;
}

function idsFrom(input: Json): PieceState[] | null {
  const ids = input.ids;
  if (!Array.isArray(ids) || !ids.length) return null;
  return ids.map(find);
}

function text(data: unknown) {
  return {
    content: [{ type: 'text', text: typeof data === 'string' ? data : JSON.stringify(data, null, 1) }],
  };
}

const idsSchema = {
  type: 'array',
  items: { type: 'string' },
  description: 'Piece ids (or exact names) from armorfit_get_status. Omit to act on every piece.',
};

const TYPE_IDS = PIECE_TYPES.map((t) => t.id);

function status(): Json {
  const p = profile.value;
  return {
    app: `ArmorFit ${APP_VERSION}`,
    body: body.status.value,
    displayUnit: p.displayUnit,
    preset: p.preset,
    undergarment: p.undergarment,
    measurementsMm: Object.fromEntries(MEASUREMENT_KEYS.map((k) => [k, round(p.values[k])])),
    enteredByUser: p.userSet,
    clearanceMm: clearance.value,
    tab: view.tab.value,
    selected: selectedId.value,
    pieces: pieces.value.map(summary),
  };
}

export function buildTools(controller: AppController): ToolDefinition[] {
  const pm = () => {
    if (!controller.pieces || !controller.analysis) throw new Error('ArmorFit is still starting.');
    return { pm: controller.pieces, an: controller.analysis };
  };
  return [
    {
      name: 'armorfit_get_status',
      title: 'Get ArmorFit status',
      description:
        'Body measurements (mm), clearance targets, and every armor piece with its id, type, side, whether it is on the body, its scale and a fit verdict. Call this first.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        await settled(10_000);
        return text(status());
      },
    },
    {
      name: 'armorfit_get_piece',
      title: 'Get piece fit details',
      description:
        'Detailed fit of one piece: gap statistics in mm, share of the inner surface that is intersecting / tight / good / loose, body regions covered and the measurements that drive its size.',
      inputSchema: {
        type: 'object',
        properties: { id: { type: 'string', description: 'Piece id or exact name.' } },
        required: ['id'],
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        await settled(20_000);
        return text(detail(find(input.id)));
      },
    },
    {
      name: 'armorfit_set_measurements',
      title: 'Set body measurements',
      description: `Set one or more body measurements; the mannequin is rebuilt to match. Keys: ${MEASUREMENT_KEYS.join(', ')}. Unentered measurements are estimated from height, chest, waist and head circumference.`,
      inputSchema: {
        type: 'object',
        properties: {
          values: {
            type: 'object',
            description: 'Map of measurement key to value, e.g. {"height": 178, "chest": 102}.',
            additionalProperties: { type: 'number' },
          },
          unit: { type: 'string', enum: ['mm', 'cm', 'in'], description: 'Unit of the values (default cm).' },
          preset: { type: 'string', enum: ['neutral', 'masculine', 'feminine'] },
          undergarment: { type: 'string', enum: ['none', 'bodysuit', 'foam'] },
        },
      },
      execute: async (input) => {
        const unit = (input.unit as 'mm' | 'cm' | 'in') ?? 'cm';
        const values = (input.values ?? {}) as Record<string, number>;
        for (const [k, v] of Object.entries(values)) {
          if (!MEASUREMENT_KEYS.includes(k as MeasurementKey)) throw new Error(`Unknown measurement "${k}".`);
          if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0)
            throw new Error(`Invalid value for ${k}.`);
          measurementActions.set(k as MeasurementKey, unit === 'mm' ? v : toMm(v, unit));
        }
        if (input.preset) measurementActions.setPreset(input.preset as ProportionPreset);
        if (input.undergarment) measurementActions.setUndergarment(input.undergarment as Undergarment);
        await settled();
        return text(status());
      },
    },
    {
      name: 'armorfit_load_demo_armor',
      title: 'Load demo armor',
      description: 'Add the four procedural demo pieces (helmet, chest plate, left pauldron, left bracer).',
      inputSchema: { type: 'object', properties: {} },
      execute: async () => {
        await pm().pm.loadDemos();
        await settled();
        return text(status());
      },
    },
    {
      name: 'armorfit_put_on_body',
      title: 'Put pieces on the body',
      description:
        'Place pieces at their usual spot on the mannequin. Files recognised as one assembled set are placed together in their designed layout. Omit ids to place every piece that is not on the body yet.',
      inputSchema: { type: 'object', properties: { ids: idsSchema } },
      execute: async (input) => {
        const { pm: m } = pm();
        const list = idsFrom(input);
        if (!list) m.placeAll();
        else for (const p of list) if (!p.placement) m.placeHome(p.id);
        await settled();
        return text(status());
      },
    },
    {
      name: 'armorfit_take_off',
      title: 'Take pieces off the body',
      description: 'Move pieces back to the tray (they stay in the project).',
      inputSchema: { type: 'object', properties: { ids: idsSchema }, required: ['ids'] },
      execute: async (input) => {
        const { pm: m } = pm();
        for (const p of idsFrom(input) ?? []) m.unplace(p.id);
        await settled();
        return text(status());
      },
    },
    {
      name: 'armorfit_auto_size',
      title: 'Auto-size pieces',
      description:
        'Scale (and for bracers, greaves and helmets also re-centre) pieces so their inside sits at the target gap from the body. Parts of one set are sized together. Omit ids to size every piece on the body.',
      inputSchema: {
        type: 'object',
        properties: {
          ids: idsSchema,
          mode: {
            type: 'string',
            enum: ['uniform', 'axes'],
            description:
              'uniform keeps proportions (default); axes scales width, height and depth separately.',
          },
        },
      },
      execute: async (input) => {
        const { an } = pm();
        await settled();
        const list = idsFrom(input);
        const mode = input.mode === 'axes' ? 'axes' : 'uniform';
        if (!list) await an.autoSizeAll();
        else for (const p of list) await an.autoSize(p.id, mode);
        await settled();
        return text(status());
      },
    },
    {
      name: 'armorfit_set_piece',
      title: 'Change a piece',
      description:
        'Change the piece type and side, the scale (percent; one number keeps proportions, three are width/height/depth), or the file units (unitScale = millimetres per file unit, e.g. 10 for cm, 25.4 for inches).',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          type: { type: 'string', enum: TYPE_IDS },
          side: { type: 'string', enum: ['L', 'R'] },
          scalePercent: {
            oneOf: [
              { type: 'number' },
              { type: 'array', items: { type: 'number' }, minItems: 3, maxItems: 3 },
            ],
          },
          unitScale: { type: 'number' },
        },
        required: ['id'],
      },
      execute: async (input) => {
        const { pm: m } = pm();
        const p = find(input.id);
        if (input.type || input.side)
          m.setTypeSide(p.id, (input.type as PieceTypeId) ?? p.type, (input.side as Side) ?? p.side);
        if (typeof input.unitScale === 'number' && input.unitScale > 0) m.setUnitScale(p.id, input.unitScale);
        const sc = input.scalePercent;
        if (typeof sc === 'number') m.setScale(p.id, [sc / 100, sc / 100, sc / 100]);
        else if (Array.isArray(sc) && sc.length === 3)
          m.setScale(p.id, sc.map((x) => x / 100) as [number, number, number]);
        await settled();
        return text(detail(find(p.id)));
      },
    },
    {
      name: 'armorfit_move_piece',
      title: 'Move a piece on the body',
      description:
        'Nudge a placed piece: up/right slide it over the body (mm), rotateDegrees turns it about the body surface or limb, offsetMm moves it away from (+) or toward (-) the body.',
      inputSchema: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          upMm: { type: 'number' },
          rightMm: { type: 'number' },
          rotateDegrees: { type: 'number' },
          offsetMm: { type: 'number' },
        },
        required: ['id'],
      },
      execute: async (input) => {
        const { pm: m } = pm();
        const p = find(input.id);
        if (!p.placement) throw new Error('Put the piece on the body first.');
        const up = Number(input.upMm ?? 0);
        const right = Number(input.rightMm ?? 0);
        if (up || right) m.nudge(p.id, right, up);
        if (input.rotateDegrees) m.twist(p.id, (Number(input.rotateDegrees) * Math.PI) / 180);
        if (input.offsetMm) {
          const cur = find(p.id).placement!;
          m.updatePlacement(p.id, { offset: cur.offset + Number(input.offsetMm) });
        }
        await settled();
        return text(detail(find(p.id)));
      },
    },
    {
      name: 'armorfit_remove_pieces',
      title: 'Remove pieces',
      description:
        'Delete pieces from the project (for example unused alternate versions). The original files are not touched.',
      inputSchema: { type: 'object', properties: { ids: idsSchema }, required: ['ids'] },
      annotations: { consequentialHint: true },
      execute: async (input) => {
        const { pm: m } = pm();
        for (const p of idsFrom(input) ?? []) m.remove(p.id);
        return text(status());
      },
    },
    {
      name: 'armorfit_set_clearance',
      title: 'Set clearance targets',
      description:
        'Gap between body and armor in mm: below min is tight, target is ideal, above max is loose. Defaults 3 / 8 / 25.',
      inputSchema: {
        type: 'object',
        properties: { min: { type: 'number' }, target: { type: 'number' }, max: { type: 'number' } },
      },
      execute: async (input) => {
        const c = { ...clearanceBase.value };
        for (const k of ['min', 'target', 'max'] as const)
          if (typeof input[k] === 'number') c[k] = input[k] as number;
        if (!(c.min < c.target && c.target < c.max)) throw new Error('Need min < target < max.');
        clearanceBase.value = c;
        await settled();
        return text(status());
      },
    },
    {
      name: 'armorfit_show',
      title: 'Show a tab or piece',
      description:
        'Switch the visible tab and optionally select a piece so the user sees what you are talking about.',
      inputSchema: {
        type: 'object',
        properties: {
          tab: { type: 'string', enum: ['body', 'armor', 'fit', 'print'] },
          id: { type: 'string' },
        },
      },
      annotations: { readOnlyHint: true },
      execute: async (input) => {
        if (input.id) selectedId.value = find(input.id).id;
        if (input.tab) view.tab.value = input.tab as Tab;
        return text({ tab: view.tab.value, selected: selectedId.value });
      },
    },
    {
      name: 'armorfit_sizing_report',
      title: 'Sizing report',
      description:
        'Markdown report of the measurements, clearance, printer and every piece with its scale and fit.',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => {
        await settled();
        const s = printSettings.value;
        const printer =
          s.printerId === 'custom' ? customPrinter(s.custom) : (findPrinter(s.printerId) ?? PRINTERS[0]);
        return text(
          sizingReportMarkdown({
            appVersion: APP_VERSION,
            date: new Date(),
            profile: profile.value,
            clearance: clearance.value,
            printer,
            orientation: s.orientation,
            pieces: pieces.value.map((p) => ({
              name: p.name,
              fileName: p.fileName,
              fileHash: p.fileHash,
              type: p.type ? (PIECE_TYPES.find((t) => t.id === p.type)?.label ?? p.type) : 'unknown',
              side: p.side,
              unitScale: p.unitScale,
              scale: p.scale,
              mirrored: p.mirrored,
              placed: !!p.placement,
              stats: p.fit?.stats,
              covers: p.fit?.tally
                .slice(0, 2)
                .map((t) => `${Math.round(t.fraction * 100)}% ${t.label}`)
                .join(', '),
            })),
          }),
        );
      },
    },
    {
      name: 'armorfit_project_json',
      title: 'Project file',
      description:
        'The project as JSON (measurements, settings, each piece’s units, orientation, placement and scale; no meshes).',
      inputSchema: { type: 'object', properties: {} },
      annotations: { readOnlyHint: true },
      execute: async () => text(buildProjectJson()),
    },
  ];
}

export function modelContext(): ModelContextLike | null {
  const d = document as unknown as { modelContext?: ModelContextLike };
  const n = navigator as unknown as { modelContext?: ModelContextLike };
  const mc = d.modelContext ?? n.modelContext;
  return mc && typeof mc.registerTool === 'function' ? mc : null;
}

export function registerWebMcp(controller: AppController): AbortController | null {
  const mc = modelContext();
  if (!mc) return null;
  const abort = new AbortController();
  for (const tool of buildTools(controller)) {
    try {
      const r = mc.registerTool(
        {
          name: tool.name,
          title: tool.title,
          description: tool.description,
          inputSchema: tool.inputSchema,
          annotations: tool.annotations,
          execute: (input: Json) => tool.execute(input ?? {}),
        },
        { signal: abort.signal },
      );
      if (r && typeof (r as Promise<unknown>).catch === 'function')
        (r as Promise<unknown>).catch(() => undefined);
    } catch {
      continue;
    }
  }
  return abort;
}
