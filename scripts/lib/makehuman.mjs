import { existsSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

export const MAKEHUMAN_COMMIT = 'a8bc2d54ff0ac92e78ff71431b1023eda42bf482';
const RAW = `https://raw.githubusercontent.com/makehumancommunity/makehuman/${MAKEHUMAN_COMMIT}/makehuman/data/`;

export function makeFileSource({ dataDir, cacheDir }) {
  return async function read(rel) {
    if (dataDir) return readFile(join(dataDir, rel), 'utf8');
    const local = join(cacheDir, rel);
    if (existsSync(local)) return readFile(local, 'utf8');
    const res = await fetch(RAW + rel);
    if (!res.ok) throw new Error(`Download failed (${res.status}): ${RAW + rel}`);
    const text = await res.text();
    await mkdir(dirname(local), { recursive: true });
    await writeFile(local, text);
    return text;
  };
}

export function parseObj(text) {
  const vertices = [];
  const groups = new Map();
  let current = null;
  for (const line of text.split('\n')) {
    if (line.startsWith('v ')) {
      const t = line.split(/\s+/);
      vertices.push([+t[1], +t[2], +t[3]]);
    } else if (line.startsWith('g ')) {
      current = line.slice(2).trim();
      if (!groups.has(current)) groups.set(current, []);
    } else if (line.startsWith('f ') && current) {
      const face = line
        .split(/\s+/)
        .slice(1)
        .filter(Boolean)
        .map((tok) => parseInt(tok, 10) - 1);
      groups.get(current).push(face);
    }
  }
  return { vertices, groups };
}

export function parseTarget(text) {
  const out = new Map();
  for (const line of text.split('\n')) {
    if (!line || line[0] === '#') continue;
    const t = line.trim().split(/\s+/);
    if (t.length < 4) continue;
    out.set(+t[0], [+t[1], +t[2], +t[3]]);
  }
  return out;
}
