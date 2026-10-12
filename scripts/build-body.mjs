#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { MAKEHUMAN_COMMIT, makeFileSource, parseObj, parseTarget } from './lib/makehuman.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'public/assets/body/hm08.armorfit.bin.gz');
const DM_TO_MM = 100;
const BODY_N = 13380;

const argv = process.argv.slice(2);
const arg = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
};
const read = makeFileSource({ dataDir: arg('makehuman'), cacheDir: join(ROOT, '.cache/makehuman') });

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const scale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => scale(a, 1 / (len(a) || 1));
const lerp = (a, b, t) => add(a, scale(sub(b, a), t));

const obj = parseObj(await read('3dobjs/base.obj'));
const bodyQuads = obj.groups.get('body');
for (const q of bodyQuads)
  for (const v of q) if (v >= BODY_N) throw new Error('body face uses helper vertex');

const skel = JSON.parse(await read('rigs/default.mhskel'));
const J = (name) => {
  const list = skel.joints[name];
  if (!list) throw new Error(`missing joint ${name}`);
  return list;
};
const JOINT_DEFS = {
  pelvis: J('spine05____head'),
  spine04: J('spine04____head'),
  spine03: J('spine03____head'),
  spine02: J('spine02____head'),
  spine01: J('spine01____head'),
  neckBase: J('neck01____head'),
  neck02: J('neck02____head'),
  headBase: J('head____head'),
  headTop: J('head____tail'),
  eyeL: J('eye.L____head'),
  eyeR: J('eye.R____head'),
};
for (const s of ['L', 'R']) {
  Object.assign(JOINT_DEFS, {
    [`clavicle${s}`]: J(`clavicle.${s}____head`),
    [`shoulder${s}`]: J(`upperarm01.${s}____head`),
    [`elbow${s}`]: J(`lowerarm01.${s}____head`),
    [`wrist${s}`]: J(`wrist.${s}____head`),
    [`hip${s}`]: J(`upperleg01.${s}____head`),
    [`knee${s}`]: J(`lowerleg01.${s}____head`),
    [`ankle${s}`]: J(`foot.${s}____head`),
    [`toe${s}`]: J(`foot.${s}____tail`),
  });
}
const helperSet = new Set();
for (const list of Object.values(JOINT_DEFS)) for (const v of list) if (v >= BODY_N) helperSet.add(v);
const helpers = [...helperSet].sort((a, b) => a - b);
const remap = new Map();
for (let i = 0; i < BODY_N; i++) remap.set(i, i);
helpers.forEach((v, k) => remap.set(v, BODY_N + k));
const N = BODY_N + helpers.length;
const keptOriginal = [...Array(BODY_N).keys(), ...helpers];

const basePos = new Float64Array(N * 3);
keptOriginal.forEach((orig, i) => {
  const v = obj.vertices[orig];
  basePos[i * 3] = v[0] * DM_TO_MM;
  basePos[i * 3 + 1] = v[1] * DM_TO_MM;
  basePos[i * 3 + 2] = v[2] * DM_TO_MM;
});
const joints = Object.fromEntries(
  Object.entries(JOINT_DEFS).map(([k, list]) => [k, list.map((v) => remap.get(v))]),
);

const tris = [];
for (const q of bodyQuads) {
  if (q.length === 3) {
    tris.push(q[0], q[1], q[2]);
    continue;
  }
  const P = (i) => [basePos[q[i] * 3], basePos[q[i] * 3 + 1], basePos[q[i] * 3 + 2]];
  if (len(sub(P(0), P(2))) <= len(sub(P(1), P(3)))) tris.push(q[0], q[1], q[2], q[0], q[2], q[3]);
  else tris.push(q[0], q[1], q[3], q[1], q[2], q[3]);
}

async function loadTarget(rel) {
  const t = parseTarget(await read(`targets/${rel}.target`));
  const out = new Map();
  for (const [v, d] of t) {
    const r = remap.get(v);
    if (r !== undefined) out.set(r, scale(d, DM_TO_MM));
  }
  return out;
}
function averageTargets(list) {
  const acc = new Map();
  for (const t of list) {
    for (const [v, d] of t) acc.set(v, add(acc.get(v) ?? [0, 0, 0], scale(d, 1 / list.length)));
  }
  return acc;
}

const targets = [];
const addTarget = (name, data, extra = {}) => {
  targets.push({ name, data, ...extra });
  return name;
};

for (const g of ['female', 'male']) {
  const list = [];
  for (const e of ['african', 'asian', 'caucasian'])
    list.push(await loadTarget(`macrodetails/${e}-${g}-young`));
  addTarget(`ethnic-${g}`, averageTargets(list), { factors: [g] });
}
for (const g of ['female', 'male']) {
  for (const m of ['minmuscle', 'averagemuscle', 'maxmuscle']) {
    for (const w of ['minweight', 'averageweight', 'maxweight']) {
      if (m === 'averagemuscle' && w === 'averageweight') continue;
      addTarget(`universal-${g}-${m}-${w}`, await loadTarget(`macrodetails/universal-${g}-young-${m}-${w}`), {
        factors: [g, m, w],
      });
    }
  }
}
for (const cup of ['mincup', 'maxcup']) {
  addTarget(
    `breast-${cup}`,
    await loadTarget(`breast/female-young-averagemuscle-averageweight-${cup}-averagefirmness`),
    { factors: ['female', cup] },
  );
}

const controls = [];
async function pairControl(id, decrPaths, incrPaths, label) {
  const decr = [];
  const incr = [];
  for (const p of decrPaths) decr.push(addTarget(`${p}`, await loadTarget(p)));
  for (const p of incrPaths) incr.push(addTarget(`${p}`, await loadTarget(p)));
  controls.push({ id, label, decr, incr });
}
const MEASURE = [
  'neck-circ',
  'neck-height',
  'upperarm-circ',
  'upperarm-length',
  'lowerarm-length',
  'wrist-circ',
  'frontchest-dist',
  'bust-circ',
  'underbust-circ',
  'waist-circ',
  'napetowaist-dist',
  'waisttohip-dist',
  'shoulder-dist',
  'hips-circ',
  'upperleg-height',
  'thigh-circ',
  'lowerleg-height',
  'calf-circ',
  'knee-circ',
  'ankle-circ',
];
for (const m of MEASURE) {
  await pairControl(`m-${m}`, [`measure/measure-${m}-decr`], [`measure/measure-${m}-incr`], `measure ${m}`);
}
const LOCAL = [
  ['head-depth', ['head/head-scale-depth-decr'], ['head/head-scale-depth-incr']],
  ['head-width', ['head/head-scale-horiz-decr'], ['head/head-scale-horiz-incr']],
  ['head-height', ['head/head-scale-vert-decr'], ['head/head-scale-vert-incr']],
  ['torso-depth', ['torso/torso-scale-depth-decr'], ['torso/torso-scale-depth-incr']],
  ['torso-vshape', ['torso/torso-vshape-decr'], ['torso/torso-vshape-incr']],
  ['pectoral', ['torso/torso-muscle-pectoral-decr'], ['torso/torso-muscle-pectoral-incr']],
  ['dorsi', ['torso/torso-muscle-dorsi-decr'], ['torso/torso-muscle-dorsi-incr']],
  ['belly', ['stomach/stomach-pregnant-decr'], ['stomach/stomach-pregnant-incr']],
  ['buttocks', ['buttocks/buttocks-volume-decr'], ['buttocks/buttocks-volume-incr']],
  ['hip-width', ['hip/hip-scale-horiz-decr'], ['hip/hip-scale-horiz-incr']],
];
const SYM = [
  ['hand-scale', 'hand-scale'],
  ['finger-length', 'hand-fingers-length'],
  ['finger-spread', 'hand-fingers-distance'],
  ['foot-scale', 'foot-scale'],
  ['forearm-muscle', 'lowerarm-muscle'],
  ['forearm-fat', 'lowerarm-fat'],
  ['deltoid', 'upperarm-shoulder-muscle'],
  ['bicep-muscle', 'upperarm-muscle'],
  ['thigh-muscle', 'upperleg-muscle'],
  ['calf-muscle', 'lowerleg-muscle'],
  ['upperarm-width', 'upperarm-scale-horiz'],
  ['upperarm-depth', 'upperarm-scale-depth'],
  ['forearm-width', 'lowerarm-scale-horiz'],
  ['forearm-depth', 'lowerarm-scale-depth'],
  ['thigh-width', 'upperleg-scale-horiz'],
  ['thigh-depth', 'upperleg-scale-depth'],
  ['calf-width', 'lowerleg-scale-horiz'],
  ['calf-depth', 'lowerleg-scale-depth'],
];
for (const [id, d, i] of LOCAL) await pairControl(id, d, i, id);
for (const [id, base] of SYM) {
  await pairControl(
    id,
    [`armslegs/l-${base}-decr`, `armslegs/r-${base}-decr`],
    [`armslegs/l-${base}-incr`, `armslegs/r-${base}-incr`],
    id,
  );
}
const targetIndex = new Map(targets.map((t, i) => [t.name, i]));

function macroFactors({ gender, muscle, weight, cup }) {
  const tri = (v, lo, mid, hi) => {
    const a = Math.max(0, 1 - 2 * v);
    const c = Math.max(0, 2 * v - 1);
    return { [lo]: a, [mid]: 1 - a - c, [hi]: c };
  };
  return {
    female: 1 - gender,
    male: gender,
    ...tri(muscle, 'minmuscle', 'averagemuscle', 'maxmuscle'),
    ...tri(weight, 'minweight', 'averageweight', 'maxweight'),
    ...tri(cup, 'mincup', 'averagecup', 'maxcup'),
  };
}
function morph(macro, controlValues = {}) {
  const pos = Float64Array.from(basePos);
  const f = macroFactors(macro);
  const apply = (t, w) => {
    if (!w) return;
    for (const [v, d] of t.data) {
      pos[v * 3] += d[0] * w;
      pos[v * 3 + 1] += d[1] * w;
      pos[v * 3 + 2] += d[2] * w;
    }
  };
  for (const t of targets)
    if (t.factors)
      apply(
        t,
        t.factors.reduce((p, k) => p * (f[k] ?? 0), 1),
      );
  for (const c of controls) {
    const x = controlValues[c.id] ?? 0;
    for (const n of x < 0 ? c.decr : c.incr) apply(targets[targetIndex.get(n)], Math.abs(x));
  }
  return pos;
}
const DEFAULT_MACRO = { gender: 0.5, muscle: 0.5, weight: 0.5, cup: 0.5 };
const P0 = morph(DEFAULT_MACRO);
const vtx = (pos, i) => [pos[i * 3], pos[i * 3 + 1], pos[i * 3 + 2]];
const jointPos = (pos, name) => {
  const c = [0, 0, 0];
  for (const v of joints[name]) {
    c[0] += pos[v * 3];
    c[1] += pos[v * 3 + 1];
    c[2] += pos[v * 3 + 2];
  }
  return scale(c, 1 / joints[name].length);
};
const JP = Object.fromEntries(Object.keys(joints).map((k) => [k, jointPos(P0, k)]));

const normals0 = new Float64Array(BODY_N * 3);
for (let f = 0; f < tris.length; f += 3) {
  const a = vtx(P0, tris[f]);
  const n = cross(sub(vtx(P0, tris[f + 1]), a), sub(vtx(P0, tris[f + 2]), a));
  for (let k = 0; k < 3; k++) for (let c = 0; c < 3; c++) normals0[tris[f + k] * 3 + c] += n[c];
}
for (let i = 0; i < BODY_N; i++) {
  const n = norm(vtx(normals0, i));
  normals0.set(n, i * 3);
}

const weights = JSON.parse(await read('rigs/default_weights.mhw')).weights;
const boneOf = new Array(BODY_N).fill('none');
const boneW = new Float64Array(BODY_N);
for (const [bone, list] of Object.entries(weights)) {
  for (const [v, w] of list) {
    if (v < BODY_N && w > boneW[v]) {
      boneW[v] = w;
      boneOf[v] = bone;
    }
  }
}
const groupWeight = (prefixes, side) => {
  const out = new Float64Array(BODY_N);
  for (const [bone, list] of Object.entries(weights)) {
    if (!bone.endsWith(`.${side}`)) continue;
    if (!prefixes.some((p) => bone.startsWith(p))) continue;
    for (const [v, w] of list) if (v < BODY_N) out[v] += w;
  }
  return out;
};
const FOREARM_BONES = ['lowerarm', 'wrist', 'finger', 'metacarpal'];
const ARM_BONES = ['shoulder01', 'upperarm', ...FOREARM_BONES];
const poseWeights = {
  forearmL: groupWeight(FOREARM_BONES, 'L'),
  forearmR: groupWeight(FOREARM_BONES, 'R'),
  armL: groupWeight(ARM_BONES, 'L'),
  armR: groupWeight(ARM_BONES, 'R'),
};

const H0min = Math.min(...Array.from({ length: BODY_N }, (_, i) => P0[i * 3 + 1]));
const H0max = Math.max(...Array.from({ length: BODY_N }, (_, i) => P0[i * 3 + 1]));
const H0 = H0max - H0min;
const yAt = (frac) => H0min + frac * H0;

function slice(pos, point, normal) {
  const d = new Float64Array(BODY_N);
  for (let i = 0; i < BODY_N; i++) d[i] = dot(sub(vtx(pos, i), point), normal);
  const edgeKey = (a, b) => (a < b ? a * BODY_N + b : b * BODY_N + a);
  const crossing = new Map();
  const adj = new Map();
  const getCrossing = (a, b) => {
    const k = edgeKey(a, b);
    if (!crossing.has(k)) {
      const t = d[a] / (d[a] - d[b]);
      crossing.set(k, { a, b, t, p: lerp(vtx(pos, a), vtx(pos, b), t) });
    }
    return k;
  };
  for (let f = 0; f < tris.length; f += 3) {
    const ks = [];
    for (let e = 0; e < 3; e++) {
      const a = tris[f + e];
      const b = tris[f + ((e + 1) % 3)];
      if (d[a] < 0 !== d[b] < 0) ks.push(getCrossing(a, b));
    }
    if (ks.length === 2) {
      for (const [x, y] of [
        [ks[0], ks[1]],
        [ks[1], ks[0]],
      ]) {
        if (!adj.has(x)) adj.set(x, []);
        adj.get(x).push(y);
      }
    }
  }
  const seen = new Set();
  const loops = [];
  for (const start of adj.keys()) {
    if (seen.has(start)) continue;
    const loop = [];
    let prev = null;
    let cur = start;
    while (cur !== undefined && !seen.has(cur)) {
      seen.add(cur);
      loop.push(crossing.get(cur));
      const next = adj.get(cur).find((k) => k !== prev && !seen.has(k));
      prev = cur;
      cur = next;
    }
    const firstKey = [...crossing.entries()].find(([, v]) => v === loop[0])?.[0];
    const lastKey = [...crossing.entries()].find(([, v]) => v === loop[loop.length - 1])?.[0];
    const closed = adj.get(lastKey)?.includes(firstKey);
    if (loop.length > 4 && closed) loops.push(loop);
  }
  return loops;
}

function hullPerimeter(points, normal) {
  const helper = Math.abs(normal[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
  const u = norm(cross(normal, helper));
  const w = cross(normal, u);
  const pts = points.map((p) => [dot(p, u), dot(p, w)]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const crossZ = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lower = [];
  for (const p of pts) {
    while (lower.length >= 2 && crossZ(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper = [];
  for (let i = pts.length - 1; i >= 0; i--) {
    const p = pts[i];
    while (upper.length >= 2 && crossZ(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  const hull = lower.slice(0, -1).concat(upper.slice(0, -1));
  let per = 0;
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i];
    const b = hull[(i + 1) % hull.length];
    per += Math.hypot(a[0] - b[0], a[1] - b[1]);
  }
  return per;
}

function pickLoop(loops, center, normal) {
  let best = null;
  let bestScore = Infinity;
  for (const loop of loops) {
    const c = scale(
      loop.reduce((s, x) => add(s, x.p), [0, 0, 0]),
      1 / loop.length,
    );
    const off = sub(c, center);
    const inPlane = len(sub(off, scale(normal, dot(off, normal))));
    if (inPlane < bestScore) {
      bestScore = inPlane;
      best = loop;
    }
  }
  return best;
}

function searchLoop({ from, to, t0, t1, mode, normalOverride, steps = 40, filter }) {
  const axis = norm(sub(to, from));
  const normal = normalOverride ?? axis;
  let best = null;
  for (let s = 0; s <= steps; s++) {
    const t = t0 + ((t1 - t0) * s) / steps;
    const point = lerp(from, to, t);
    let loops = slice(P0, point, normal);
    if (filter) loops = loops.filter(filter);
    const loop = pickLoop(loops, point, normal);
    if (!loop) continue;
    const per = hullPerimeter(
      loop.map((x) => x.p),
      normal,
    );
    if (!best || (mode === 'max' ? per > best.per : per < best.per)) best = { per, loop, t, point, normal };
  }
  return best;
}

const UP = [0, 1, 0];
const torsoZ = (JP.spine02[2] + JP.spine03[2]) / 2;
const centerAt = (y) => [0, y, torsoZ];
const isArmV = (v) => /^(shoulder01|upperarm|lowerarm|wrist|finger|metacarpal)/.test(boneOf[v]);
const usesArm = (loop) => loop.some((x) => isArmV(x.a) || isArmV(x.b));
const torsoLoop = (loop) =>
  !usesArm(loop) &&
  loop.some((x) => Math.abs(x.p[0]) < 25 && x.p[2] > torsoZ) &&
  loop.some((x) => Math.abs(x.p[0]) < 25 && x.p[2] < torsoZ);
const leftOnly = (loop) => loop.every((x) => x.p[0] > 10);
const armLoop = (loop) => leftOnly(loop) && loop.every((x) => isArmV(x.a) || isArmV(x.b));
const legLoop = (loop) => leftOnly(loop) && !usesArm(loop);
const loopDefs = {};
loopDefs.chest = searchLoop({
  from: centerAt(yAt(0.66)),
  to: centerAt(yAt(0.75)),
  t0: 0,
  t1: 1,
  mode: 'max',
  normalOverride: UP,
  filter: torsoLoop,
});
loopDefs.waist = searchLoop({
  from: centerAt(yAt(0.6)),
  to: centerAt(yAt(0.6)),
  t0: 0,
  t1: 0,
  steps: 1,
  mode: 'min',
  normalOverride: UP,
  filter: torsoLoop,
});
loopDefs.hips = searchLoop({
  from: centerAt(yAt(0.49)),
  to: centerAt(yAt(0.56)),
  t0: 0,
  t1: 1,
  mode: 'max',
  normalOverride: UP,
  filter: torsoLoop,
});
loopDefs.neck = searchLoop({ from: JP.neckBase, to: JP.headBase, t0: 0.1, t1: 0.5, mode: 'min' });
const eyeY = (JP.eyeL[1] + JP.eyeR[1]) / 2;
loopDefs.headCirc = searchLoop({
  from: [0, eyeY + 10, JP.headBase[2]],
  to: [0, eyeY + 60, JP.headBase[2]],
  t0: 0,
  t1: 1,
  mode: 'max',
  normalOverride: UP,
});
loopDefs.bicep = searchLoop({
  from: JP.shoulderL,
  to: JP.elbowL,
  t0: 0.4,
  t1: 0.72,
  mode: 'max',
  filter: armLoop,
});
loopDefs.forearm = searchLoop({
  from: JP.elbowL,
  to: JP.wristL,
  t0: 0.12,
  t1: 0.4,
  mode: 'max',
  filter: armLoop,
});
loopDefs.wrist = searchLoop({
  from: JP.elbowL,
  to: JP.wristL,
  t0: 0.82,
  t1: 0.97,
  mode: 'min',
  filter: armLoop,
});
loopDefs.thigh = searchLoop({
  from: JP.hipL,
  to: JP.kneeL,
  t0: 0.18,
  t1: 0.42,
  mode: 'max',
  filter: legLoop,
});
loopDefs.calf = searchLoop({
  from: JP.kneeL,
  to: JP.ankleL,
  t0: 0.15,
  t1: 0.5,
  mode: 'max',
  filter: legLoop,
});
for (const [k, v] of Object.entries(loopDefs)) if (!v) throw new Error(`no loop found for ${k}`);

const range = (n) => Array.from({ length: n }, (_, i) => i);
const bodyIdx = range(BODY_N);
const argBest = (cands, score) => {
  let best = -1;
  let bs = -Infinity;
  for (const i of cands) {
    const s = score(vtx(P0, i));
    if (s > bs) {
      bs = s;
      best = i;
    }
  }
  return best;
};
const isArm = (i) => /^(shoulder01|upperarm|lowerarm|wrist|finger|metacarpal)/.test(boneOf[i]);
const isHand = (i) => /^(wrist|finger|metacarpal)/.test(boneOf[i]);
const isFoot = (i) => /^(foot|toe)/.test(boneOf[i]);
const isHead = (i) =>
  /^(head|jaw|eye|oculi|levator|oris|orbicularis|risorius|temporalis|tongue|special|mandible)/.test(
    boneOf[i],
  );
const landmarks = {};
landmarks.crown = argBest(bodyIdx, (p) => p[1]);
landmarks.soles = bodyIdx.filter((i) => P0[i * 3 + 1] < H0min + 15);
for (const s of ['L', 'R']) {
  const sx = s === 'L' ? 1 : -1;
  const sh = JP[`shoulder${s}`];
  landmarks[`acromion${s}`] = argBest(
    bodyIdx.filter((i) => {
      const p = vtx(P0, i);
      return sx * p[0] > 0 && len(sub(p, sh)) < 140 && Math.abs(p[2] - sh[2]) < 35;
    }),
    (p) => p[1] - sh[1] + 0.55 * sx * (p[0] - sh[0]),
  );
  const el = JP[`elbow${s}`];
  const uArm = norm(sub(JP[`elbow${s}`], sh));
  const lat = norm(sub(scale([sx, 0, 0], 1), scale(uArm, dot([sx, 0, 0], uArm))));
  landmarks[`radiale${s}`] = argBest(
    bodyIdx.filter((i) => isArm(i) && Math.abs(dot(sub(vtx(P0, i), el), uArm)) < 12),
    (p) => dot(sub(p, el), lat),
  );
  const wr = JP[`wrist${s}`];
  const fArm = norm(sub(wr, el));
  landmarks[`stylion${s}`] = argBest(
    bodyIdx.filter((i) => isArm(i) && Math.abs(dot(sub(vtx(P0, i), wr), fArm) + 15) < 8),
    (p) => dot(sub(p, wr), [0, 0, 1]) + 0.3 * dot(sub(p, wr), [0, 1, 0]),
  );
  landmarks[`fingertip${s}`] = argBest(
    bodyIdx.filter((i) => isHand(i) && sx * P0[i * 3] > 0),
    (p) => len(sub(p, wr)),
  );
  const tip = vtx(P0, landmarks[`fingertip${s}`]);
  const hDir = norm(sub(tip, wr));
  const handPts = bodyIdx.filter((i) => isHand(i) && sx * P0[i * 3] > 0 && !boneOf[i].startsWith('finger1'));
  let across = norm(cross(hDir, cross([0, 1, 0], hDir)));
  if (len(across) < 0.5) across = [0, 0, 1];
  const handLen = len(sub(tip, wr));
  const band = handPts.filter((i) => {
    const t = dot(sub(vtx(P0, i), wr), hDir) / handLen;
    return t > 0.3 && t < 0.42;
  });
  let bestAxis = null;
  let bestSpread = -1;
  for (let a = 0; a < 180; a += 3) {
    const r = (a * Math.PI) / 180;
    const helper = Math.abs(hDir[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0];
    const e1 = norm(cross(hDir, helper));
    const e2 = cross(hDir, e1);
    const ax = add(scale(e1, Math.cos(r)), scale(e2, Math.sin(r)));
    const proj = band.map((i) => dot(vtx(P0, i), ax));
    const spread = Math.max(...proj) - Math.min(...proj);
    if (spread > bestSpread) {
      bestSpread = spread;
      bestAxis = ax;
    }
  }
  landmarks[`knuckleA${s}`] = argBest(band, (p) => dot(p, bestAxis));
  landmarks[`knuckleB${s}`] = argBest(band, (p) => -dot(p, bestAxis));
  void across;
  const hp = JP[`hip${s}`];
  landmarks[`trochanterion${s}`] = argBest(
    bodyIdx.filter((i) => !isArm(i) && Math.abs(P0[i * 3 + 1] - hp[1]) < 12),
    (p) => sx * p[0],
  );
  const kn = JP[`knee${s}`];
  landmarks[`femoralEpicondyle${s}`] = argBest(
    bodyIdx.filter((i) => !isArm(i) && Math.abs(P0[i * 3 + 1] - kn[1]) < 12 && sx * P0[i * 3] > 0),
    (p) => sx * p[0],
  );
  landmarks[`tibiale${s}`] = argBest(
    bodyIdx.filter((i) => !isArm(i) && Math.abs(P0[i * 3 + 1] - (kn[1] - 15)) < 10 && sx * P0[i * 3] > 0),
    (p) => -sx * p[0],
  );
  const an = JP[`ankle${s}`];
  landmarks[`malleolus${s}`] = argBest(
    bodyIdx.filter((i) => Math.abs(P0[i * 3 + 1] - an[1]) < 10 && sx * P0[i * 3] > 0),
    (p) => sx * p[0],
  );
  const footPts = bodyIdx.filter((i) => isFoot(i) || (sx * P0[i * 3] > 0 && P0[i * 3 + 1] < an[1]));
  landmarks[`heel${s}`] = argBest(
    footPts.filter((i) => sx * P0[i * 3] > 0),
    (p) => -p[2],
  );
  landmarks[`toe${s}`] = argBest(
    footPts.filter((i) => sx * P0[i * 3] > 0),
    (p) => p[2],
  );
  landmarks[`euryon${s}`] = argBest(
    bodyIdx.filter((i) => isHead(i) && P0[i * 3 + 1] > eyeY + 20 && P0[i * 3 + 1] < eyeY + 70),
    (p) => sx * p[0],
  );
}
const clavY = (JP.clavicleL[1] + JP.clavicleR[1]) / 2;
landmarks.suprasternale = argBest(
  bodyIdx.filter((i) => Math.abs(P0[i * 3]) < 8 && Math.abs(P0[i * 3 + 1] - clavY) < 10),
  (p) => p[2],
);
const waistY = loopDefs.waist.point[1];
landmarks.omphalion = argBest(
  bodyIdx.filter((i) => Math.abs(P0[i * 3]) < 10 && Math.abs(P0[i * 3 + 1] - waistY) < 10),
  (p) => p[2],
);
landmarks.glabella = argBest(
  bodyIdx.filter(
    (i) => isHead(i) && Math.abs(P0[i * 3]) < 8 && P0[i * 3 + 1] > eyeY && P0[i * 3 + 1] < eyeY + 45,
  ),
  (p) => p[2],
);
landmarks.opisthocranion = argBest(
  bodyIdx.filter((i) => isHead(i) && Math.abs(P0[i * 3]) < 15 && P0[i * 3 + 1] > JP.headBase[1] + 30),
  (p) => -p[2],
);

const REGIONS = [
  'head',
  'neck',
  'upperChest',
  'chest',
  'abdomen',
  'waist',
  'upperBack',
  'lowerBack',
  'upperShoulder',
  'deltoid',
  'upperArm',
  'elbow',
  'forearm',
  'wrist',
  'hand',
  'hip',
  'thigh',
  'knee',
  'shin',
  'calf',
  'foot',
];
const MIDLINE = new Set(['head', 'neck']);
const code = (r, x) => (REGIONS.indexOf(r) << 2) | (MIDLINE.has(r) ? 0 : x >= 0 ? 1 : 2);
const chestY = loopDefs.chest.point[1];
const armpitY = Math.min(JP.shoulderL[1] - 0.06 * H0, chestY + 0.05 * H0);
const underBustY = chestY - 0.045 * H0;
const hipsY = loopDefs.hips.point[1];
const crotchY = yAt(0.47);
const neckBaseY = JP.neckBase[1];
const scapulaLowY = chestY - 0.03 * H0;
const regions = new Uint8Array(BODY_N);
const param = (p, a, b) => dot(sub(p, a), sub(b, a)) / dot(sub(b, a), sub(b, a));
for (let i = 0; i < BODY_N; i++) {
  const p = vtx(P0, i);
  const n = vtx(normals0, i);
  const bone = boneOf[i];
  const side = p[0] >= 0 ? 'L' : 'R';
  let r;
  if (isHead(i)) r = 'head';
  else if (/^neck/.test(bone)) r = p[1] < neckBaseY + 8 && n[1] > 0.55 ? 'upperShoulder' : 'neck';
  else if (isHand(i)) r = 'hand';
  else if (/^(lowerarm)/.test(bone)) {
    const t = param(p, JP[`elbow${side}`], JP[`wrist${side}`]);
    r = t < 0.12 ? 'elbow' : t > 0.82 ? 'wrist' : 'forearm';
  } else if (/^(upperarm|shoulder01)/.test(bone)) {
    const t = param(p, JP[`shoulder${side}`], JP[`elbow${side}`]);
    r = t > 0.88 ? 'elbow' : t < 0.3 ? 'deltoid' : 'upperArm';
    if (t < 0.12 && n[1] > 0.5 && Math.abs(p[0]) < Math.abs(JP[`shoulder${side}`][0])) r = 'upperShoulder';
  } else if (/^(lowerleg)/.test(bone)) {
    const t = param(p, JP[`knee${side}`], JP[`ankle${side}`]);
    if (t < 0.1) r = 'knee';
    else {
      const axisPt = lerp(JP[`knee${side}`], JP[`ankle${side}`], t);
      r = p[2] - axisPt[2] >= 0 ? 'shin' : 'calf';
    }
  } else if (/^(upperleg)/.test(bone)) {
    const t = param(p, JP[`hip${side}`], JP[`knee${side}`]);
    r = t > 0.9 ? 'knee' : p[1] > crotchY + 10 ? 'hip' : 'thigh';
  } else if (/^(foot|toe)/.test(bone)) r = 'foot';
  else {
    const center = [0, p[1], (JP.spine02[2] + JP.spine03[2]) / 2];
    const front = p[2] >= center[2] - 10;
    if (p[1] > armpitY && n[1] > 0.6 && Math.abs(p[0]) > 45) r = 'upperShoulder';
    else if (p[1] < hipsY + 0.02 * H0 || p[1] < crotchY) r = 'hip';
    else if (Math.abs(p[1] - waistY) < 0.022 * H0) r = front ? 'waist' : 'lowerBack';
    else if (front) {
      if (p[1] > armpitY) r = 'upperChest';
      else if (p[1] > underBustY) r = 'chest';
      else r = p[1] > waistY ? 'abdomen' : 'hip';
    } else {
      r = p[1] > scapulaLowY ? 'upperBack' : p[1] > waistY ? 'lowerBack' : 'hip';
    }
  }
  regions[i] = code(r, p[0]);
}

const neighbors = Array.from({ length: BODY_N }, () => new Set());
for (const q of bodyQuads) {
  for (let k = 0; k < q.length; k++) {
    const a = q[k];
    const b = q[(k + 1) % q.length];
    neighbors[a].add(b);
    neighbors[b].add(a);
  }
}
const crotchTip = argBest(
  bodyIdx.filter((i) => Math.abs(P0[i * 3]) < 15 && P0[i * 3 + 1] > yAt(0.43) && P0[i * 3 + 1] < yAt(0.52)),
  (p) => p[2],
);
const finishCenters = [
  { v: remap.get(8451), radius: 26 },
  { v: remap.get(1779), radius: 26 },
  { v: crotchTip, radius: 75 },
];
const finishWeight = new Map();
for (const { v: c, radius } of finishCenters) {
  const pc = vtx(P0, c);
  for (let i = 0; i < BODY_N; i++) {
    const d = len(sub(vtx(P0, i), pc));
    if (d >= radius) continue;
    const t = 1 - d / radius;
    const w = t * t * (3 - 2 * t);
    finishWeight.set(i, Math.max(finishWeight.get(i) ?? 0, w));
  }
}
const finish = {
  iterations: 30,
  vertices: [...finishWeight.keys()],
  weights: [...finishWeight.values()].map((w) => Math.round(w * 1000) / 1000),
  neighbors: [...finishWeight.keys()].map((i) => [...neighbors[i]]),
};

const loopsOut = {};
for (const [name, def] of Object.entries(loopDefs)) {
  loopsOut[name] = {
    edges: def.loop.map((x) => [x.a, x.b, Math.round(x.t * 1e5) / 1e5]),
    defaultPerimeter: Math.round(def.per * 10) / 10,
  };
}
const sections = [];
let offset = 0;
const pushSection = (name, typed) => {
  const pad = (4 - (offset % 4)) % 4;
  if (pad) {
    sections.push(new Uint8Array(pad));
    offset += pad;
  }
  const bytes = new Uint8Array(typed.buffer, typed.byteOffset, typed.byteLength);
  const rec = { name, offset, length: typed.length, type: typed.constructor.name };
  sections.push(bytes);
  offset += bytes.byteLength;
  return rec;
};
const sec = {};
sec.positions = pushSection('positions', Float32Array.from(basePos));
sec.indices = pushSection('indices', Uint16Array.from(tris));
sec.regions = pushSection('regions', regions);
for (const [k, w] of Object.entries(poseWeights)) {
  sec[`pose_${k}`] = pushSection(
    `pose_${k}`,
    Uint8Array.from(w, (x) => Math.round(Math.min(1, x) * 255)),
  );
}
const targetsOut = targets.map((t) => {
  const entries = [...t.data.entries()].filter(([, d]) => d[0] || d[1] || d[2]);
  let maxAbs = 0;
  for (const [, d] of entries) maxAbs = Math.max(maxAbs, Math.abs(d[0]), Math.abs(d[1]), Math.abs(d[2]));
  const q = maxAbs / 32767 || 1;
  const idx = Uint16Array.from(entries.map(([v]) => v));
  const del = new Int16Array(entries.length * 3);
  entries.forEach(([, d], i) => {
    del[i * 3] = Math.round(d[0] / q);
    del[i * 3 + 1] = Math.round(d[1] / q);
    del[i * 3 + 2] = Math.round(d[2] / q);
  });
  return {
    name: t.name,
    factors: t.factors,
    scale: q,
    count: entries.length,
    indices: pushSection(`t:${t.name}:idx`, idx).offset,
    deltas: pushSection(`t:${t.name}:del`, del).offset,
  };
});

const header = {
  format: 'armorfit-body',
  version: 1,
  units: 'mm',
  frame: 'Y up, facing +Z, wearer left +X',
  source: `MakeHuman hm08 (CC0), commit ${MAKEHUMAN_COMMIT}`,
  credits:
    'Base mesh, targets, rig and weights: MakeHuman community (CC0). https://www.makehumancommunity.org',
  bodyVertexCount: BODY_N,
  vertexCount: N,
  triangleCount: tris.length / 3,
  sections: sec,
  targets: targetsOut,
  controls,
  defaultMacro: DEFAULT_MACRO,
  joints,
  landmarks,
  loops: loopsOut,
  regions: REGIONS,
  finish,
};
const json = new TextEncoder().encode(JSON.stringify(header));
const magic = new TextEncoder().encode('AFBODY01');
const headLen = new Uint8Array(new Uint32Array([json.byteLength]).buffer);
const prefixLen = magic.byteLength + 4 + json.byteLength;
const prefixPad = (4 - (prefixLen % 4)) % 4;
const parts = [magic, headLen, json, new Uint8Array(prefixPad), ...sections];
const total = parts.reduce((s, p) => s + p.byteLength, 0);
const buf = new Uint8Array(total);
let o = 0;
for (const p of parts) {
  buf.set(p, o);
  o += p.byteLength;
}
await mkdir(dirname(OUT), { recursive: true });
const gz = gzipSync(buf, { level: 9 });
await writeFile(OUT, gz);

const measured = {};
for (const [name, def] of Object.entries(loopDefs)) measured[name] = Math.round(def.per);
const L = (a, b) => Math.round(len(sub(vtx(P0, landmarks[a]), vtx(P0, landmarks[b]))));
console.log(
  `Wrote ${OUT}: ${(total / 1e6).toFixed(2)} MB raw, ${(gz.byteLength / 1e6).toFixed(2)} MB gzipped`,
);
console.log(
  `vertices ${N} (body ${BODY_N}), triangles ${tris.length / 3}, targets ${targets.length}, controls ${controls.length}`,
);
console.log('default body (mm):', {
  height: Math.round(H0),
  ...measured,
  shoulderWidth: L('acromionL', 'acromionR'),
  upperArm: L('acromionL', 'radialeL'),
  forearm: L('radialeL', 'stylionL'),
  hand: L('fingertipL', 'stylionL'),
  handWidth: L('knuckleAL', 'knuckleBL'),
  foot: L('heelL', 'toeL'),
  headLength: L('glabella', 'opisthocranion'),
  headWidth: L('euryonL', 'euryonR'),
  torso: Math.round(P0[landmarks.suprasternale * 3 + 1] - P0[landmarks.omphalion * 3 + 1]),
  thighLen: Math.round(P0[landmarks.trochanterionL * 3 + 1] - P0[landmarks.femoralEpicondyleL * 3 + 1]),
  shinLen: Math.round(P0[landmarks.tibialeL * 3 + 1] - P0[landmarks.malleolusL * 3 + 1]),
});

const debugPath = arg('debug');
if (debugPath) {
  const regionCounts = {};
  for (let i = 0; i < BODY_N; i++) {
    const nm = REGIONS[regions[i] >> 2] + ['', '.L', '.R'][regions[i] & 3];
    regionCounts[nm] = (regionCounts[nm] ?? 0) + 1;
  }
  await writeFile(
    debugPath,
    JSON.stringify({
      positions: Array.from(P0.slice(0, BODY_N * 3), (x) => Math.round(x * 10) / 10),
      indices: tris,
      regions: Array.from(regions),
      loops: Object.fromEntries(Object.entries(loopDefs).map(([k, d]) => [k, d.loop.map((x) => x.p)])),
      landmarks: Object.fromEntries(
        Object.entries(landmarks)
          .filter(([, v]) => typeof v === 'number')
          .map(([k, v]) => [k, vtx(P0, v)]),
      ),
      joints: JP,
      regionCounts,
    }),
  );
  console.log('debug written', debugPath, regionCounts);
}
