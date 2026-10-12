#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'src/core/measurements/ansur-model.json');
const URLS = {
  male: 'https://tools.openlab.psu.edu/publicData/ANSUR_II_MALE_Public.csv',
  female: 'https://tools.openlab.psu.edu/publicData/ANSUR_II_FEMALE_Public.csv',
};

const MAP = {
  height: (r) => r.stature,
  chest: (r) => r.chestcircumference,
  waist: (r) => r.waistcircumference,
  hips: (r) => r.buttockcircumference,
  headCirc: (r) => r.headcircumference,
  headLength: (r) => r.headlength,
  headWidth: (r) => r.headbreadth,
  neckCirc: (r) => r.neckcircumference,
  shoulderWidth: (r) => r.biacromialbreadth,
  torsoLength: (r) => r.suprasternaleheight - r.waistheightomphalion,
  upperArmLength: (r) => r.acromionradialelength,
  bicepCirc: (r) => r.bicepscircumferenceflexed,
  forearmLength: (r) => r.radialestylionlength,
  forearmCirc: (r) => r.forearmcircumferenceflexed,
  wristCirc: (r) => r.wristcircumference,
  handLength: (r) => r.handlength,
  handWidth: (r) => r.handbreadth,
  thighLength: (r) => r.trochanterionheight - r.lateralfemoralepicondyleheight,
  thighCirc: (r) => r.thighcircumference,
  shinLength: (r) => r.tibialheight - r.lateralmalleolusheight,
  calfCirc: (r) => r.calfcircumference,
  footLength: (r) => r.footlength,
};
const KEYS = Object.keys(MAP);

function parseArgs() {
  const args = process.argv.slice(2);
  const out = {};
  for (let i = 0; i < args.length; i += 2) out[args[i].replace(/^--/, '')] = args[i + 1];
  return out;
}

function parseCsv(text) {
  const lines = text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .filter((l) => l.trim().length);
  const split = (line) => {
    const cells = [];
    let cur = '';
    let q = false;
    for (let i = 0; i < line.length; i++) {
      const c = line[i];
      if (c === '"') q = !q;
      else if (c === ',' && !q) {
        cells.push(cur);
        cur = '';
      } else cur += c;
    }
    cells.push(cur);
    return cells;
  };
  const header = split(lines[0]).map((h) => h.trim().toLowerCase());
  return lines.slice(1).map((l) => {
    const cells = split(l);
    const row = {};
    header.forEach((h, i) => (row[h] = Number(cells[i])));
    return row;
  });
}

async function load(path, url) {
  if (path) return readFile(path, 'latin1');
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Download failed: ${url} (${res.status})`);
  return new TextDecoder('latin1').decode(await res.arrayBuffer());
}

function stats(rows) {
  const X = rows.map((r) => KEYS.map((k) => MAP[k](r))).filter((v) => v.every(Number.isFinite));
  const n = X.length;
  const d = KEYS.length;
  const mean = new Array(d).fill(0);
  for (const x of X) for (let i = 0; i < d; i++) mean[i] += x[i] / n;
  const cov = Array.from({ length: d }, () => new Array(d).fill(0));
  for (const x of X) {
    for (let i = 0; i < d; i++) {
      const di = x[i] - mean[i];
      for (let j = i; j < d; j++) cov[i][j] += (di * (x[j] - mean[j])) / (n - 1);
    }
  }
  for (let i = 0; i < d; i++) for (let j = 0; j < i; j++) cov[i][j] = cov[j][i];
  const round = (v) => Math.round(v * 1000) / 1000;
  return { n, mean: mean.map(round), cov: cov.map((row) => row.map(round)) };
}

const args = parseArgs();
const male = parseCsv(await load(args.male, URLS.male));
const female = parseCsv(await load(args.female, URLS.female));
const model = {
  source:
    'ANSUR II (2012 US Army Anthropometric Survey), public release; https://www.openlab.psu.edu/ansur2/. Military population; values in mm.',
  generatedBy: 'scripts/build-anthro.mjs',
  keys: KEYS,
  male: stats(male),
  female: stats(female),
};
await writeFile(OUT, JSON.stringify(model) + '\n');
console.log(`Wrote ${OUT}: male n=${model.male.n}, female n=${model.female.n}, ${KEYS.length} variables`);
