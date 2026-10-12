import { parse3mf } from './threemf';
import { parseObj } from './obj';
import { parseStl } from './stl';
import type { ImportResult } from './types';

export type { ImportResult, ImportedPart } from './types';

export function detectFormat(fileName: string): 'stl' | 'obj' | '3mf' | null {
  const ext = fileName.toLowerCase().split('.').pop();
  if (ext === 'stl' || ext === 'obj' || ext === '3mf') return ext;
  return null;
}

export function baseName(fileName: string): string {
  return fileName.replace(/\.[^.]+$/, '');
}

export function parseMeshFile(fileName: string, buf: ArrayBuffer): ImportResult {
  const fmt = detectFormat(fileName);
  const name = baseName(fileName);
  switch (fmt) {
    case 'stl':
      return parseStl(buf, name);
    case 'obj':
      return parseObj(new TextDecoder().decode(buf), name);
    case '3mf':
      return parse3mf(buf, name);
    default:
      throw new Error(`Unsupported file type: ${fileName}. Use STL, OBJ or 3MF.`);
  }
}
