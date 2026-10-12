/// <reference lib="webworker" />
import { parseMeshFile } from '../core/io';
import type { MeshData } from '../core/mesh/types';
import { preparePiece, orientPiece, type PreparedPiece } from '../core/pieces/prepare';
import type { NameGuess } from '../core/pieces/classify';
import { makeChestPlate, makeForearmTube, makeHelmet, makePauldron } from '../core/testmeshes/pieces';
import type { FileUnit } from '../core/units';
import { zipSync } from 'fflate';
import { Matrix4 } from 'three';
import { bakeForPrint, fileSafe, transformPositions } from '../core/export/transform';
import { writeStl } from '../core/io/stl';
import { write3mf } from '../core/io/threemf';
import { checkHull, hullPoints, type BuildVolumeCheck } from '../core/print/buildVolume';
import type { Vec3 } from '../core/math/linalg';
import { expose, transfer } from './rpc';

export interface ExportItem {
  sourceId: string;
  name: string;
  matrix: number[];
}

const fullMeshes = new Map<string, MeshData>();
const previews = new Map<string, MeshData>();
const previewHulls = new Map<string, Float64Array>();
let nextId = 1;

export interface PieceImport {
  id: string;
  name: string;
  fileName: string;
  fileHash: string;
  preview: { positions: Float32Array; indices: Uint32Array; normals: Float32Array };
  prepared: Omit<PreparedPiece, 'full' | 'preview'>;
  fullTriangles: number;
}

async function sha256(buf: ArrayBuffer): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', buf);
  return Array.from(new Uint8Array(d), (b) => b.toString(16).padStart(2, '0'))
    .join('')
    .slice(0, 16);
}

function pack(p: PreparedPiece, fileName: string, fileHash: string): PieceImport {
  const id = `p${nextId++}`;
  fullMeshes.set(id, p.full);
  previews.set(id, { positions: p.preview.positions, indices: p.preview.indices });
  const { full, preview, ...rest } = p;
  return {
    id,
    name: p.name,
    fileName,
    fileHash,
    preview: {
      positions: preview.positions.slice(),
      indices: preview.indices.slice(),
      normals: preview.normals!,
    },
    prepared: rest,
    fullTriangles: full.indices.length / 3,
  };
}

function transferList(items: PieceImport[]): Transferable[] {
  return items.flatMap((i) => [
    i.preview.positions.buffer as ArrayBuffer,
    i.preview.indices.buffer as ArrayBuffer,
    i.preview.normals.buffer as ArrayBuffer,
  ]);
}

const DEMOS = {
  helmet: () => ({ name: 'Demo helmet', mesh: makeHelmet() }),
  chest: () => ({ name: 'Demo chest plate', mesh: makeChestPlate() }),
  pauldronL: () => ({ name: 'Demo pauldron L', mesh: makePauldron() }),
  forearmL: () => ({ name: 'Demo bracer L', mesh: makeForearmTube() }),
};
export type DemoKind = keyof typeof DEMOS;

const api = {
  async importFile(
    fileName: string,
    buffer: ArrayBuffer,
  ): Promise<{ pieces: PieceImport[]; warnings: string[] }> {
    const hash = await sha256(buffer);
    const parsed = parseMeshFile(fileName, buffer);
    const declared =
      parsed.declaredUnit && ['mm', 'cm', 'm', 'in'].includes(parsed.declaredUnit)
        ? (parsed.declaredUnit as FileUnit)
        : undefined;
    const pieces: PieceImport[] = [];
    for (const part of parsed.parts) {
      const prepared = await preparePiece(part, fileName, declared);
      pieces.push(pack(prepared, fileName, hash));
    }
    return transfer({ pieces, warnings: parsed.warnings }, transferList(pieces));
  },

  async importDemo(kind: DemoKind): Promise<PieceImport> {
    const part = DEMOS[kind]();
    const fileName = `${part.name.toLowerCase().replace(/\s+/g, '-')}.stl`;
    const prepared = await preparePiece(part, fileName, 'mm');
    const item = pack(prepared, fileName, `demo-${kind}`);
    return transfer(item, transferList([item]));
  },

  reorient(id: string, unitScale: number, guess: NameGuess) {
    const preview = previews.get(id);
    if (!preview) throw new Error('Unknown piece');
    return orientPiece(preview, unitScale, guess);
  },

  removePiece(id: string): void {
    fullMeshes.delete(id);
    previews.delete(id);
    previewHulls.delete(id);
  },

  checkFit(sourceId: string, matrix: number[], volume: Vec3): BuildVolumeCheck {
    const preview = previews.get(sourceId);
    const full = fullMeshes.get(sourceId);
    if (!preview || !full) throw new Error('Unknown piece');
    let hull = previewHulls.get(sourceId);
    if (!hull) previewHulls.set(sourceId, (hull = hullPoints(preview.positions)));
    const m = new Matrix4().fromArray(matrix);
    return checkHull(transformPositions(hull, m), volume, 1, transformPositions(full.positions, m));
  },

  exportStl(item: ExportItem): ArrayBuffer {
    const full = fullMeshes.get(item.sourceId);
    if (!full) throw new Error(`Mesh for "${item.name}" is not loaded`);
    const buf = writeStl(bakeForPrint(full, new Matrix4().fromArray(item.matrix)), `ArmorFit: ${item.name}`);
    return transfer(buf, [buf]);
  },

  exportZip(items: ExportItem[]): Uint8Array {
    const files: Record<string, Uint8Array> = {};
    const used = new Set<string>();
    for (const it of items) {
      const full = fullMeshes.get(it.sourceId);
      if (!full) continue;
      let name = `${fileSafe(it.name)}.stl`;
      for (let k = 2; used.has(name); k++) name = `${fileSafe(it.name)}_${k}.stl`;
      used.add(name);
      files[name] = new Uint8Array(writeStl(bakeForPrint(full, new Matrix4().fromArray(it.matrix)), it.name));
    }
    const zip = zipSync(files, { level: 6 });
    return transfer(zip, [zip.buffer as ArrayBuffer]);
  },

  export3mf(items: ExportItem[]): Uint8Array {
    let x = 0;
    const objects = [];
    for (const it of items) {
      const full = fullMeshes.get(it.sourceId);
      if (!full) continue;
      const mesh = bakeForPrint(full, new Matrix4().fromArray(it.matrix));
      let minX = Infinity;
      let maxX = -Infinity;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        minX = Math.min(minX, mesh.positions[i]);
        maxX = Math.max(maxX, mesh.positions[i]);
      }
      objects.push({ name: it.name, mesh, offset: [x - minX, 0, 0] as [number, number, number] });
      x += maxX - minX + 15;
    }
    const data = write3mf(objects, 'ArmorFit export');
    return transfer(data, [data.buffer as ArrayBuffer]);
  },
};

export type GeometryWorkerApi = typeof api;
expose(api);
