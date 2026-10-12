/// <reference lib="webworker" />
import { Matrix4 } from 'three';
import { parseBodyAsset } from '../core/body/asset';
import { MannequinBuilder, type Mannequin } from '../core/body/mannequin';
import {
  analyzePiece,
  prepareAnalysisPiece,
  vertexClearance,
  type AnalysisPiece,
  type FitReport,
} from '../core/fit/analyze';
import { autoSize, type AutoSizeOptions, type AutoSizeResult } from '../core/fit/autosize';
import { BodyQuery } from '../core/fit/bodyQuery';
import type { Vec3 } from '../core/math/linalg';
import type { ClearanceSettings } from '../core/fit/clearance';
import type { MeasurementProfile } from '../core/measurements/profile';
import { expose, transfer } from './rpc';

let builder: MannequinBuilder | null = null;
let query: BodyQuery | null = null;
let topology: { indices: Uint16Array; regions: Uint8Array } | null = null;
const analysisPieces = new Map<string, AnalysisPiece>();

export interface BodyMeta {
  vertexCount: number;
  triangleCount: number;
  credits: string;
}

export interface BodyUpdate {
  positions: Float32Array;
  normals: Float32Array;
  joints: Mannequin['joints'];
  landmarks: Mannequin['landmarks'];
  measured: Mannequin['measured'];
}

export interface AnalysisResult extends FitReport {
  vertexClearance?: Float32Array;
}

const api = {
  async init(assetUrl: string): Promise<BodyMeta & { indices: Uint16Array; regions: Uint8Array }> {
    const res = await fetch(assetUrl);
    if (!res.ok) throw new Error(`Could not load the mannequin (${res.status})`);
    const asset = parseBodyAsset(new Uint8Array(await res.arrayBuffer()));
    builder = new MannequinBuilder(asset);
    topology = { indices: asset.indices, regions: asset.regions };
    const indices = asset.indices.slice();
    const regions = asset.regions.slice();
    return transfer(
      {
        vertexCount: asset.header.bodyVertexCount,
        triangleCount: asset.header.triangleCount,
        credits: asset.header.credits,
        indices,
        regions,
      },
      [indices.buffer, regions.buffer],
    );
  },

  buildBody(profile: MeasurementProfile): BodyUpdate {
    if (!builder || !topology) throw new Error('Mannequin not loaded yet');
    const m = builder.build(profile);
    const qp = m.positions.slice();
    const qn = m.normals.slice();
    if (!query) query = new BodyQuery(qp, qn, topology.indices, topology.regions);
    else query.update(qp, qn);
    return transfer(
      {
        positions: m.positions,
        normals: m.normals,
        joints: m.joints,
        landmarks: m.landmarks,
        measured: m.measured,
      },
      [m.positions.buffer, m.normals.buffer],
    );
  },

  setPiece(id: string, positions: Float32Array, indices: Uint32Array, fileToW: number[]): void {
    analysisPieces.set(id, prepareAnalysisPiece({ positions, indices }, new Matrix4().fromArray(fileToW)));
  },

  removePiece(id: string): void {
    analysisPieces.delete(id);
  },

  autoSize(
    ids: string[],
    placement: number[],
    direction: Vec3 | null,
    scale: [number, number, number],
    mirrored: boolean,
    settings: ClearanceSettings,
    mode: AutoSizeOptions['mode'],
    category: AutoSizeOptions['category'],
    side: 'L' | 'R' | null = null,
  ): AutoSizeResult {
    const parts = ids.map((id) => analysisPieces.get(id)).filter(Boolean) as AnalysisPiece[];
    if (!parts.length || !query) throw new Error('Piece or body not ready');
    const total = parts.reduce((n, p) => n + p.samplePoints.length / 3, 0);
    const stride = Math.max(1, Math.ceil(total / 6000));
    const join = (key: 'samplePoints' | 'sampleNormals') => {
      if (parts.length === 1 && stride === 1) return parts[0][key];
      const out = new Float32Array(Math.ceil(total / stride) * 3 + 3 * parts.length);
      let o = 0;
      for (const p of parts) {
        const src = p[key];
        for (let i = 0; i < src.length / 3; i += stride) {
          out[o++] = src[i * 3];
          out[o++] = src[i * 3 + 1];
          out[o++] = src[i * 3 + 2];
        }
      }
      return out.subarray(0, o);
    };
    const shiftAxes: [boolean, boolean, boolean] | undefined =
      mode === 'offset'
        ? undefined
        : category === 'tube'
          ? [true, false, true]
          : category === 'cap'
            ? [true, true, true]
            : undefined;
    return autoSize(
      { samplePoints: join('samplePoints'), sampleNormals: join('sampleNormals') },
      new Matrix4().fromArray(placement),
      direction,
      scale,
      mirrored,
      query,
      settings,
      { mode, category, shiftAxes, excludeSide: side === 'L' ? 2 : side === 'R' ? 1 : undefined },
    );
  },

  analyze(id: string, wToWorld: number[], settings: ClearanceSettings, withHeatmap: boolean): AnalysisResult {
    const piece = analysisPieces.get(id);
    if (!piece || !query) throw new Error('Piece or body not ready');
    const m = new Matrix4().fromArray(wToWorld);
    const report: AnalysisResult = analyzePiece(piece, m, query, settings);
    if (withHeatmap) {
      report.vertexClearance = vertexClearance(piece, m, query);
      return transfer(report, [report.vertexClearance.buffer as ArrayBuffer]);
    }
    return report;
  },
};

export type FitWorkerApi = typeof api;
expose(api);
