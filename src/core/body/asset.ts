import { gunzipSync } from 'fflate';

export interface TargetRecord {
  name: string;
  factors?: string[];
  scale: number;
  count: number;
  indices: number;
  deltas: number;
}

export interface ControlRecord {
  id: string;
  label: string;
  decr: string[];
  incr: string[];
}

export interface SectionRecord {
  name: string;
  offset: number;
  length: number;
  type: string;
}

export interface LoopRecord {
  edges: [number, number, number][];
  defaultPerimeter: number;
}

export interface BodyAssetHeader {
  format: 'armorfit-body';
  version: number;
  units: 'mm';
  source: string;
  credits: string;
  bodyVertexCount: number;
  vertexCount: number;
  triangleCount: number;
  sections: Record<string, SectionRecord>;
  targets: TargetRecord[];
  controls: ControlRecord[];
  defaultMacro: MacroParams;
  joints: Record<string, number[]>;
  landmarks: Record<string, number | number[]>;
  loops: Record<string, LoopRecord>;
  regions: string[];
  finish?: { iterations: number; vertices: number[]; weights: number[]; neighbors: number[][] };
}

export interface MacroParams {
  gender: number;
  muscle: number;
  weight: number;
  cup: number;
}

export interface SparseTarget {
  name: string;
  factors?: string[];
  indices: Uint16Array;
  deltas: Float32Array;
}

export interface BodyAsset {
  header: BodyAssetHeader;
  base: Float32Array;
  indices: Uint16Array;
  regions: Uint8Array;
  poseWeights: Record<string, Float32Array>;
  targets: SparseTarget[];
  targetByName: Map<string, number>;
}

export function parseBodyAsset(data: Uint8Array | ArrayBuffer): BodyAsset {
  let bytes = data instanceof Uint8Array ? data : new Uint8Array(data);
  if (bytes[0] === 0x1f && bytes[1] === 0x8b) bytes = gunzipSync(bytes);
  const magic = new TextDecoder().decode(bytes.subarray(0, 8));
  if (magic !== 'AFBODY01') throw new Error('Not an ArmorFit body asset');
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const jsonLen = dv.getUint32(8, true);
  const header = JSON.parse(new TextDecoder().decode(bytes.subarray(12, 12 + jsonLen))) as BodyAssetHeader;
  const prefix = 12 + jsonLen;
  const binStart = prefix + ((4 - (prefix % 4)) % 4);
  const bin = bytes.slice(binStart).buffer;

  const view = <T>(rec: SectionRecord, Ctor: new (b: ArrayBuffer, o: number, l: number) => T) =>
    new Ctor(bin, rec.offset, rec.length);
  const base = view(header.sections.positions, Float32Array);
  const indices = view(header.sections.indices, Uint16Array);
  const regions = view(header.sections.regions, Uint8Array);
  const poseWeights: Record<string, Float32Array> = {};
  for (const [k, rec] of Object.entries(header.sections)) {
    if (!k.startsWith('pose_')) continue;
    const u8 = view(rec, Uint8Array);
    poseWeights[k.slice(5)] = Float32Array.from(u8, (x) => x / 255);
  }
  const targets: SparseTarget[] = header.targets.map((t) => {
    const idx = new Uint16Array(bin, t.indices, t.count);
    const raw = new Int16Array(bin, t.deltas, t.count * 3);
    const deltas = new Float32Array(t.count * 3);
    for (let i = 0; i < deltas.length; i++) deltas[i] = raw[i] * t.scale;
    return { name: t.name, factors: t.factors, indices: idx, deltas };
  });
  const targetByName = new Map(targets.map((t, i) => [t.name, i]));
  return { header, base, indices, regions, poseWeights, targets, targetByName };
}
