import type { ImportedPart } from '../io/types';
import { decimate } from '../mesh/decimate';
import { computeVertexNormals } from '../mesh/normals';
import { repairWinding, type TopologyReport } from '../mesh/topology';
import { boundsSize, computeBounds, type MeshData } from '../mesh/types';
import { weldVertices } from '../mesh/weld';
import type { FileUnit } from '../units';
import { guessFromFileName, isDetailPart, type NameGuess } from './classify';
import { autoOrient, type OrientationResult } from './orient';
import { pieceType } from './types';
import { guessUnits, type UnitGuess } from './units';

export const PREVIEW_TRIANGLES = 100_000;

const WRAPS_VERTICAL = new Set(['chest', 'back', 'abdomen', 'tasset', 'thigh', 'knee', 'shin', 'calf']);

export interface PreparedPiece {
  name: string;
  full: MeshData;
  preview: MeshData;
  topology: TopologyReport;
  repairs: { verticesMerged: number; degenerateRemoved: number; trianglesFlipped: number };
  decimationError: number;
  units: UnitGuess;
  guess: NameGuess;
  orientation: OrientationResult;
  warnings: string[];
}

export function scaledPositions(positions: Float32Array, s: number): Float32Array {
  if (s === 1) return positions;
  const out = new Float32Array(positions.length);
  for (let i = 0; i < out.length; i++) out[i] = positions[i] * s;
  return out;
}

export function orientPiece(preview: MeshData, unitScale: number, guess: NameGuess): OrientationResult {
  const info = guess.type ? pieceType(guess.type) : null;
  return autoOrient(
    { positions: scaledPositions(preview.positions, unitScale), indices: preview.indices },
    {
      category: info?.category,
      openingDown: info ? info.id !== 'boot' && info.id !== 'hand' : undefined,
      wrapsVertical: info ? WRAPS_VERTICAL.has(info.id) : undefined,
    },
  );
}

export async function preparePiece(
  part: ImportedPart,
  fileName: string,
  declaredUnit?: FileUnit,
  previewTriangles = PREVIEW_TRIANGLES,
): Promise<PreparedPiece> {
  const warnings: string[] = [];
  const welded = weldVertices(part.mesh);
  const full = welded.mesh;
  const { flipped, report: topology } = repairWinding(full);
  if (topology.triangles === 0) throw new Error(`"${part.name}" contains no triangles.`);
  if (!topology.watertight) {
    const parts: string[] = [];
    if (topology.boundaryEdges) parts.push(`${topology.boundaryEdges} open edges`);
    if (topology.nonManifoldEdges) parts.push(`${topology.nonManifoldEdges} non-manifold edges`);
    if (topology.inconsistentEdges) parts.push(`${topology.inconsistentEdges} flipped faces`);
    warnings.push(
      `Mesh is not watertight (${parts.join(', ')}). Fitting works, but your slicer may need to repair it before printing.`,
    );
  }
  if (topology.components > 1) {
    warnings.push(`Contains ${topology.components} separate shells; they are treated as one piece.`);
  }

  const fromPart = guessFromFileName(part.name);
  const fromFile = guessFromFileName(fileName);
  const guess: NameGuess = {
    type: fromPart.type ?? fromFile.type,
    side: fromPart.side ?? fromFile.side,
    confidence: Math.max(fromPart.confidence, fromFile.confidence),
    matchedWord: fromPart.matchedWord ?? fromFile.matchedWord,
  };

  const size = boundsSize(computeBounds(full.positions));
  const maxDim = Math.max(size[0], size[1], size[2]);
  const units = guessUnits(maxDim, {
    declared: declaredUnit,
    expectedSizeMm: guess.type ? pieceType(guess.type).typicalSize : undefined,
    detail: isDetailPart(part.name) || isDetailPart(fileName),
  });

  const dec = await decimate(full, previewTriangles);
  const preview: MeshData = { positions: dec.mesh.positions, indices: dec.mesh.indices };
  preview.normals = computeVertexNormals(preview);

  const orientation = orientPiece(preview, units.best.scale, guess);
  return {
    name: part.name,
    full,
    preview,
    topology,
    repairs: {
      verticesMerged: welded.verticesBefore - welded.verticesAfter,
      degenerateRemoved: welded.degenerateRemoved,
      trianglesFlipped: flipped,
    },
    decimationError: dec.error,
    units,
    guess,
    orientation,
    warnings,
  };
}
