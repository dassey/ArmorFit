import type { MeshData } from '../mesh/types';
import type { ImportResult } from './types';

function isBinaryStl(buf: ArrayBuffer): boolean {
  if (buf.byteLength < 84) return false;
  const n = new DataView(buf).getUint32(80, true);
  if (84 + n * 50 === buf.byteLength) return true;
  const head = new TextDecoder().decode(new Uint8Array(buf, 0, Math.min(1024, buf.byteLength)));
  return !(/^\s*solid/.test(head) && /facet/.test(head));
}

function parseBinary(buf: ArrayBuffer): MeshData {
  const dv = new DataView(buf);
  const n = Math.min(dv.getUint32(80, true), Math.floor((buf.byteLength - 84) / 50));
  const positions = new Float32Array(n * 9);
  for (let i = 0; i < n; i++) {
    const o = 84 + i * 50 + 12;
    for (let k = 0; k < 9; k++) positions[i * 9 + k] = dv.getFloat32(o + k * 4, true);
  }
  const indices = new Uint32Array(n * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}

function parseAscii(text: string): MeshData {
  const re = /vertex\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)\s+([-+0-9.eE]+)/g;
  const out: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) out.push(+m[1], +m[2], +m[3]);
  const nTri = Math.floor(out.length / 9);
  const positions = new Float32Array(out.slice(0, nTri * 9));
  const indices = new Uint32Array(nTri * 3);
  for (let i = 0; i < indices.length; i++) indices[i] = i;
  return { positions, indices };
}

export function parseStl(buf: ArrayBuffer, name = 'part'): ImportResult {
  const warnings: string[] = [];
  const mesh = isBinaryStl(buf) ? parseBinary(buf) : parseAscii(new TextDecoder().decode(buf));
  if (mesh.indices.length === 0) warnings.push('No triangles found in STL file.');
  return { parts: [{ name, mesh }], format: 'stl', warnings };
}

export function writeStl(mesh: MeshData, header = 'ArmorFit export'): ArrayBuffer {
  const { positions: p, indices: idx } = mesh;
  const n = idx.length / 3;
  const buf = new ArrayBuffer(84 + n * 50);
  const dv = new DataView(buf);
  const enc = new TextEncoder().encode(header.slice(0, 79));
  new Uint8Array(buf, 0, 80).set(enc);
  dv.setUint32(80, n, true);
  let o = 84;
  for (let f = 0; f < n; f++) {
    const a = idx[f * 3] * 3;
    const b = idx[f * 3 + 1] * 3;
    const c = idx[f * 3 + 2] * 3;
    const e1x = p[b] - p[a];
    const e1y = p[b + 1] - p[a + 1];
    const e1z = p[b + 2] - p[a + 2];
    const e2x = p[c] - p[a];
    const e2y = p[c + 1] - p[a + 1];
    const e2z = p[c + 2] - p[a + 2];
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const l = Math.hypot(nx, ny, nz) || 1;
    nx /= l;
    ny /= l;
    nz /= l;
    dv.setFloat32(o, nx, true);
    dv.setFloat32(o + 4, ny, true);
    dv.setFloat32(o + 8, nz, true);
    o += 12;
    for (const v of [a, b, c]) {
      dv.setFloat32(o, p[v], true);
      dv.setFloat32(o + 4, p[v + 1], true);
      dv.setFloat32(o + 8, p[v + 2], true);
      o += 12;
    }
    dv.setUint16(o, 0, true);
    o += 2;
  }
  return buf;
}
