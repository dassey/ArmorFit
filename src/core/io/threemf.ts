import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import type { MeshData } from '../mesh/types';
import type { FileUnit } from '../units';
import type { ImportedPart, ImportResult } from './types';

type Mat43 = number[];

const IDENTITY: Mat43 = [1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0];

function parseTransform(s: string | undefined): Mat43 {
  if (!s) return IDENTITY;
  const v = s.trim().split(/\s+/).map(Number);
  return v.length === 12 && v.every(Number.isFinite) ? v : IDENTITY;
}

function mul(a: Mat43, b: Mat43): Mat43 {
  const r: Mat43 = new Array(12).fill(0);
  for (let i = 0; i < 3; i++) {
    for (let j = 0; j < 3; j++) {
      r[i * 3 + j] = a[i * 3] * b[j] + a[i * 3 + 1] * b[3 + j] + a[i * 3 + 2] * b[6 + j];
    }
  }
  for (let j = 0; j < 3; j++) r[9 + j] = a[9] * b[j] + a[10] * b[3 + j] + a[11] * b[6 + j] + b[9 + j];
  return r;
}

function det3(m: Mat43): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

interface XmlTag {
  name: string;
  attrs: Record<string, string>;
  close: boolean;
  selfClose: boolean;
}

const ATTR_RE = /([\w:.-]+)\s*=\s*("([^"]*)"|'([^']*)')/g;

function decodeEntities(s: string): string {
  if (s.indexOf('&') === -1) return s;
  return s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-fA-F]+);/g, (_, e: string) => {
    switch (e) {
      case 'lt':
        return '<';
      case 'gt':
        return '>';
      case 'amp':
        return '&';
      case 'quot':
        return '"';
      case 'apos':
        return "'";
      default:
        return String.fromCodePoint(e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10));
    }
  });
}

function* scanTags(xml: string): Generator<XmlTag> {
  const tagRe = /<(\/?)([\w:.-]+)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  while ((m = tagRe.exec(xml))) {
    const attrs: Record<string, string> = {};
    const raw = m[3];
    if (raw) {
      ATTR_RE.lastIndex = 0;
      let a: RegExpExecArray | null;
      while ((a = ATTR_RE.exec(raw))) attrs[a[1]] = decodeEntities(a[3] ?? a[4] ?? '');
    }
    yield { name: m[2], attrs, close: m[1] === '/', selfClose: m[4] === '/' };
  }
}

function localName(n: string): string {
  const i = n.indexOf(':');
  return i === -1 ? n : n.slice(i + 1);
}

interface ObjDef {
  id: string;
  name?: string;
  mesh?: { positions: number[]; indices: number[] };
  components: { objectId: string; path?: string; transform: Mat43 }[];
}

interface ModelFile {
  unit?: string;
  objects: Map<string, ObjDef>;
  build: { objectId: string; path?: string; transform: Mat43 }[];
}

function parseModelXml(xml: string): ModelFile {
  const objects = new Map<string, ObjDef>();
  const build: ModelFile['build'] = [];
  let unit: string | undefined;
  let cur: ObjDef | null = null;
  let inBuild = false;
  for (const t of scanTags(xml)) {
    const n = localName(t.name);
    if (t.close) {
      if (n === 'object') cur = null;
      else if (n === 'build') inBuild = false;
      continue;
    }
    switch (n) {
      case 'model':
        unit = t.attrs.unit;
        break;
      case 'object':
        cur = { id: t.attrs.id, name: t.attrs.name, components: [] };
        objects.set(cur.id, cur);
        if (t.selfClose) cur = null;
        break;
      case 'mesh':
        if (cur) cur.mesh = { positions: [], indices: [] };
        break;
      case 'vertex':
        if (cur?.mesh) cur.mesh.positions.push(+t.attrs.x, +t.attrs.y, +t.attrs.z);
        break;
      case 'triangle':
        if (cur?.mesh) cur.mesh.indices.push(+t.attrs.v1, +t.attrs.v2, +t.attrs.v3);
        break;
      case 'component':
        if (cur) {
          cur.components.push({
            objectId: t.attrs.objectid,
            path: t.attrs['p:path'] ?? t.attrs.path,
            transform: parseTransform(t.attrs.transform),
          });
        }
        break;
      case 'build':
        inBuild = !t.selfClose;
        break;
      case 'item':
        if (inBuild) {
          build.push({
            objectId: t.attrs.objectid,
            path: t.attrs['p:path'] ?? t.attrs.path,
            transform: parseTransform(t.attrs.transform),
          });
        }
        break;
    }
  }
  return { unit, objects, build };
}

const UNIT_MAP: Record<string, FileUnit | 'micron' | 'ft'> = {
  micron: 'micron',
  millimeter: 'mm',
  centimeter: 'cm',
  inch: 'in',
  foot: 'ft',
  meter: 'm',
};

const UNIT_MM: Record<string, number> = {
  micron: 0.001,
  millimeter: 1,
  centimeter: 10,
  inch: 25.4,
  foot: 304.8,
  meter: 1000,
};

const unitMm = (unit: string | undefined) => UNIT_MM[unit ?? 'millimeter'] ?? 1;

const scaleXf = (k: number): Mat43 => [k, 0, 0, 0, k, 0, 0, 0, k, 0, 0, 0];

function normPath(p: string): string {
  return p.replace(/^\//, '');
}

export function parse3mf(buf: ArrayBuffer, fallbackName = 'part'): ImportResult {
  const warnings: string[] = [];
  const files = unzipSync(new Uint8Array(buf));
  const fileNames = Object.keys(files);

  let rootPath = '3D/3dmodel.model';
  const rels = files['_rels/.rels'];
  if (rels) {
    for (const t of scanTags(strFromU8(rels))) {
      if (localName(t.name) === 'Relationship' && /3dmodel$/.test(t.attrs.Type ?? '')) {
        rootPath = normPath(t.attrs.Target);
      }
    }
  }
  if (!files[rootPath]) {
    const alt = fileNames.find((f) => f.toLowerCase().endsWith('.model'));
    if (!alt) return { parts: [], format: '3mf', warnings: ['No 3D model found inside the 3MF archive.'] };
    rootPath = alt;
  }

  const cache = new Map<string, ModelFile>();
  const load = (path: string): ModelFile | null => {
    const key = normPath(path);
    let m = cache.get(key);
    if (m) return m;
    const data = files[key];
    if (!data) return null;
    m = parseModelXml(strFromU8(data));
    cache.set(key, m);
    return m;
  };

  const root = load(rootPath)!;
  const parts: ImportedPart[] = [];

  const toUnitsOf = (childPath: string, parentPath: string): Mat43 =>
    childPath === parentPath
      ? IDENTITY
      : scaleXf(unitMm(load(childPath)?.unit) / unitMm(load(parentPath)?.unit));

  const emit = (
    filePath: string,
    objectId: string,
    xf: Mat43,
    pos: number[],
    idx: number[],
    depth: number,
  ): string | undefined => {
    if (depth > 16) return;
    const model = load(filePath);
    const obj = model?.objects.get(objectId);
    if (!obj) {
      warnings.push(`Missing object ${objectId} in ${filePath}.`);
      return;
    }
    if (obj.mesh) {
      const base = pos.length / 3;
      const P = obj.mesh.positions;
      for (let i = 0; i < P.length; i += 3) {
        const x = P[i];
        const y = P[i + 1];
        const z = P[i + 2];
        pos.push(
          x * xf[0] + y * xf[3] + z * xf[6] + xf[9],
          x * xf[1] + y * xf[4] + z * xf[7] + xf[10],
          x * xf[2] + y * xf[5] + z * xf[8] + xf[11],
        );
      }
      const flip = det3(xf) < 0;
      const I = obj.mesh.indices;
      for (let i = 0; i < I.length; i += 3) {
        if (flip) idx.push(base + I[i], base + I[i + 2], base + I[i + 1]);
        else idx.push(base + I[i], base + I[i + 1], base + I[i + 2]);
      }
    }
    for (const c of obj.components) {
      const childPath = c.path ? normPath(c.path) : filePath;
      emit(
        childPath,
        c.objectId,
        mul(toUnitsOf(childPath, filePath), mul(c.transform, xf)),
        pos,
        idx,
        depth + 1,
      );
    }
    return obj.name;
  };

  const items = root.build.length
    ? root.build
    : [...root.objects.keys()].map((id) => ({ objectId: id, path: undefined, transform: IDENTITY }));
  items.forEach((item, i) => {
    const pos: number[] = [];
    const idx: number[] = [];
    const itemPath = item.path ? normPath(item.path) : rootPath;
    const objName = emit(
      itemPath,
      item.objectId,
      mul(toUnitsOf(itemPath, rootPath), item.transform),
      pos,
      idx,
      0,
    );
    if (idx.length === 0) return;
    parts.push({
      name: objName || (items.length > 1 ? `${fallbackName}-${i + 1}` : fallbackName),
      mesh: { positions: new Float32Array(pos), indices: new Uint32Array(idx) },
    });
  });
  if (parts.length === 0) warnings.push('The 3MF file contained no printable meshes.');
  return {
    parts,
    format: '3mf',
    declaredUnit: UNIT_MAP[root.unit ?? 'millimeter'] ?? 'mm',
    warnings,
  };
}

export interface ThreeMfObject {
  name: string;
  mesh: MeshData;
  offset?: [number, number, number];
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function fmt(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(4).replace(/\.?0+$/, '');
}

export function write3mf(objects: ThreeMfObject[], title = 'ArmorFit export'): Uint8Array {
  const parts: string[] = [];
  parts.push(
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
      '<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">\n' +
      `  <metadata name="Title">${esc(title)}</metadata>\n` +
      '  <metadata name="Application">ArmorFit</metadata>\n' +
      '  <resources>\n',
  );
  objects.forEach((o, i) => {
    const { positions: p, indices: idx } = o.mesh;
    const lines: string[] = [];
    lines.push(
      `    <object id="${i + 1}" type="model" name="${esc(o.name)}">\n      <mesh>\n        <vertices>\n`,
    );
    for (let v = 0; v < p.length; v += 3) {
      lines.push(`          <vertex x="${fmt(p[v])}" y="${fmt(p[v + 1])}" z="${fmt(p[v + 2])}"/>\n`);
    }
    lines.push('        </vertices>\n        <triangles>\n');
    for (let f = 0; f < idx.length; f += 3) {
      lines.push(`          <triangle v1="${idx[f]}" v2="${idx[f + 1]}" v3="${idx[f + 2]}"/>\n`);
    }
    lines.push('        </triangles>\n      </mesh>\n    </object>\n');
    parts.push(lines.join(''));
  });
  parts.push('  </resources>\n  <build>\n');
  objects.forEach((o, i) => {
    const t = o.offset ?? [0, 0, 0];
    parts.push(
      `    <item objectid="${i + 1}" transform="1 0 0 0 1 0 0 0 1 ${fmt(t[0])} ${fmt(t[1])} ${fmt(t[2])}"/>\n`,
    );
  });
  parts.push('  </build>\n</model>\n');

  const contentTypes =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">\n' +
    '  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>\n' +
    '  <Default Extension="model" ContentType="application/vnd.ms-package.3dmanufacturing-3dmodel+xml"/>\n' +
    '</Types>\n';
  const rels =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n' +
    '  <Relationship Target="/3D/3dmodel.model" Id="rel0" Type="http://schemas.microsoft.com/3dmanufacturing/2013/01/3dmodel"/>\n' +
    '</Relationships>\n';
  const zip: Zippable = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rels),
    '3D/3dmodel.model': [strToU8(parts.join('')), { level: 6 }],
  };
  return zipSync(zip, { level: 6 });
}
