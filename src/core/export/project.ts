import type { ClearanceSettings } from '../fit/clearance';
import type { OrientationResult } from '../pieces/orient';
import type { PieceTypeId, Side } from '../pieces/types';

export type ProjectPlacement =
  | {
      kind: 'surface';
      face: number;
      bary: [number, number, number];
      twist: number;
      offset: number;
      shift?: [number, number, number];
    }
  | {
      kind: 'bone';
      bone: string;
      t: number;
      twist: number;
      offset: number;
      local?: number[];
      shift?: [number, number, number];
    };

export interface ProjectPiece {
  name: string;
  fileName: string;
  fileHash: string;
  type: PieceTypeId | null;
  side: Side | null;
  unitScale: number;
  orientation: OrientationResult;
  placement: ProjectPlacement | null;
  scale: [number, number, number];
  mirrored: boolean;
  group?: string | null;
  sourceIndex?: number;
}

export interface ProjectFile {
  kind: 'armorfit-project';
  version: 1;
  app: string;
  savedAt: string;
  bodyAsset: string;
  measurements: unknown;
  clearance: ClearanceSettings;
  printer: { id: string; custom?: [number, number, number] };
  exportOrientation: 'original' | 'wearing';
  pieces: ProjectPiece[];
}

export class ProjectError extends Error {}

export function serializeProject(p: Omit<ProjectFile, 'kind' | 'version'>): string {
  const file: ProjectFile = { kind: 'armorfit-project', version: 1, ...p };
  return JSON.stringify(file, null, 1);
}

function isNum(x: unknown): x is number {
  return typeof x === 'number' && Number.isFinite(x);
}

export function parseProject(json: string): ProjectFile {
  let d: any;
  try {
    d = JSON.parse(json);
  } catch {
    throw new ProjectError('This file is not valid JSON.');
  }
  if (!d || d.kind !== 'armorfit-project') throw new ProjectError('This is not an ArmorFit project file.');
  if (d.version !== 1) throw new ProjectError('This project was saved by a newer version of ArmorFit.');
  if (!Array.isArray(d.pieces)) throw new ProjectError('The project has no piece list.');
  for (const p of d.pieces) {
    if (typeof p.fileHash !== 'string' || typeof p.name !== 'string')
      throw new ProjectError('A piece entry is invalid.');
    if (!isNum(p.unitScale) || !Array.isArray(p.scale) || !p.scale.every(isNum)) {
      throw new ProjectError(`Piece "${p.name}" has invalid sizes.`);
    }
    if (!p.orientation || !Array.isArray(p.orientation.matrix) || p.orientation.matrix.length !== 16) {
      throw new ProjectError(`Piece "${p.name}" has an invalid orientation.`);
    }
  }
  return d as ProjectFile;
}
