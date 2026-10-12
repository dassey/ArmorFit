import { computed, signal } from '@preact/signals';
import type { TopologyReport } from '../core/mesh/topology';
import type { NameGuess } from '../core/pieces/classify';
import type { OrientationResult } from '../core/pieces/orient';
import type { PieceTypeId, Side } from '../core/pieces/types';
import type { UnitGuess } from '../core/pieces/units';
import type { ClearanceStats } from '../core/fit/clearance';
import type { RegionShare } from '../core/fit/regionTally';
import type { MeasurementKey } from '../core/measurements/schema';
import type { ProjectPiece } from '../core/export/project';

export interface FitSummary {
  stats: ClearanceStats;
  tally: RegionShare[];
  driving: MeasurementKey[];
}

export type Placement =
  | {
      kind: 'surface';
      face: number;
      bary: [number, number, number];
      twist: number;
      offset: number;
    }
  | {
      kind: 'bone';
      bone: string;
      t: number;
      twist: number;
      offset: number;
    };

export interface PieceState {
  id: string;
  name: string;
  fileName: string;
  fileHash: string;
  type: PieceTypeId | null;
  side: Side | null;
  guess: NameGuess;
  unitScale: number;
  unitConfirmed: boolean;
  units: UnitGuess;
  orientation: OrientationResult;
  orientationConfirmed: boolean;
  topology: TopologyReport;
  warnings: string[];
  fullTriangles: number;
  previewTriangles: number;
  thumbnail?: string;
  placement: Placement | null;
  scale: [number, number, number];
  mirrored: boolean;
  visible: boolean;
  scaleGroup: string | null;
  sourceId?: string;
  fit?: FitSummary;
  analyzing?: boolean;
}

export const pieces = signal<PieceState[]>([]);
export interface PendingPiece extends ProjectPiece {
  index: number;
}
export const pendingPieces = signal<PendingPiece[]>([]);
export const selectedId = signal<string | null>(null);
export const selectedPiece = computed(() => pieces.value.find((p) => p.id === selectedId.value) ?? null);
export const importBusy = signal(0);

export function updatePiece(
  id: string,
  patch: Partial<PieceState> | ((p: PieceState) => Partial<PieceState>),
) {
  pieces.value = pieces.value.map((p) =>
    p.id === id ? { ...p, ...(typeof patch === 'function' ? patch(p) : patch) } : p,
  );
}

export function needsAttention(p: PieceState): string[] {
  const out: string[] = [];
  if (!p.unitConfirmed && p.units.needsConfirmation) out.push('units');
  if (!p.orientationConfirmed && p.orientation.confidence < 0.6) out.push('orientation');
  if (!p.topology.watertight) out.push('mesh');
  return out;
}
