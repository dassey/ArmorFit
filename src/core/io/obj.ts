import type { ImportedPart, ImportResult } from './types';

export function parseObj(text: string, fallbackName = 'part'): ImportResult {
  const warnings: string[] = [];
  const verts: number[] = [];
  type Acc = { name: string; tris: number[] };
  const parts: Acc[] = [];
  let current: Acc | null = null;
  const ensure = () => {
    if (!current) {
      current = { name: fallbackName, tris: [] };
      parts.push(current);
    }
    return current;
  };

  let lineStart = 0;
  const len = text.length;
  let badFaces = 0;
  while (lineStart < len) {
    let lineEnd = text.indexOf('\n', lineStart);
    if (lineEnd === -1) lineEnd = len;
    const line = text.slice(lineStart, lineEnd).trim();
    lineStart = lineEnd + 1;
    if (line.length === 0 || line[0] === '#') continue;
    if (line.startsWith('v ')) {
      const t = line.split(/\s+/);
      verts.push(+t[1], +t[2], +t[3]);
    } else if (line.startsWith('f ')) {
      const t = line.split(/\s+/);
      const nv = verts.length / 3;
      const ids: number[] = [];
      for (let i = 1; i < t.length; i++) {
        const s = t[i];
        if (!s) continue;
        const slash = s.indexOf('/');
        let k = parseInt(slash === -1 ? s : s.slice(0, slash), 10);
        if (Number.isNaN(k)) continue;
        k = k < 0 ? nv + k : k - 1;
        ids.push(k);
      }
      if (ids.length < 3) {
        badFaces++;
        continue;
      }
      const acc = ensure();
      for (let i = 1; i + 1 < ids.length; i++) acc.tris.push(ids[0], ids[i], ids[i + 1]);
    } else if (line.startsWith('o ')) {
      current = { name: line.slice(2).trim() || fallbackName, tris: [] };
      parts.push(current);
    }
  }
  if (badFaces) warnings.push(`${badFaces} face(s) with fewer than 3 vertices were skipped.`);

  const positionsAll = new Float32Array(verts);
  const nVerts = positionsAll.length / 3;
  const out: ImportedPart[] = [];
  for (const p of parts) {
    if (p.tris.length === 0) continue;
    const remap = new Int32Array(nVerts).fill(-1);
    const pos: number[] = [];
    const idx = new Uint32Array(p.tris.length);
    let bad = false;
    for (let i = 0; i < p.tris.length; i++) {
      const v = p.tris[i];
      if (v < 0 || v >= nVerts) {
        bad = true;
        idx[i] = 0;
        continue;
      }
      if (remap[v] === -1) {
        remap[v] = pos.length / 3;
        pos.push(positionsAll[v * 3], positionsAll[v * 3 + 1], positionsAll[v * 3 + 2]);
      }
      idx[i] = remap[v];
    }
    if (bad) warnings.push(`Object "${p.name}" references missing vertices.`);
    out.push({ name: p.name, mesh: { positions: new Float32Array(pos), indices: idx } });
  }
  if (out.length === 0) warnings.push('No faces found in OBJ file.');
  return { parts: out, format: 'obj', warnings };
}
