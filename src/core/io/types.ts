import type { MeshData } from '../mesh/types';
import type { FileUnit } from '../units';

export interface ImportedPart {
  name: string;
  mesh: MeshData;
}

export interface ImportResult {
  parts: ImportedPart[];
  declaredUnit?: FileUnit | 'micron' | 'ft';
  format: 'stl' | 'obj' | '3mf';
  warnings: string[];
}
