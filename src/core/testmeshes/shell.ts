import { v3, type Vec3 } from '../math/linalg';
import { compactVertices, weldVertices } from '../mesh/weld';
import { flipWinding } from '../mesh/normals';
import type { MeshData } from '../mesh/types';

export interface ShellSpec {
  surface: (u: number, v: number) => Vec3;
  normal?: (u: number, v: number) => Vec3;
  uSegments: number;
  vSegments: number;
  uPeriodic?: boolean;
  thickness: number;
  keep?: (u: number, v: number) => boolean;
  holes?: { u: number; v: number; radius: number }[];
}

function finiteNormal(spec: ShellSpec, u: number, v: number): Vec3 {
  const h = 1e-4;
  const su = v3.sub(spec.surface(Math.min(u + h, 1), v), spec.surface(Math.max(u - h, 0), v));
  const sv = v3.sub(spec.surface(u, Math.min(v + h, 1)), spec.surface(u, Math.max(v - h, 0)));
  return v3.norm(v3.cross(su, sv));
}

export function makeShell(spec: ShellSpec): MeshData {
  const nu = spec.uSegments;
  const nv = spec.vSegments;
  const periodic = !!spec.uPeriodic;
  const cols = periodic ? nu : nu + 1;
  const rows = nv + 1;
  const nGrid = cols * rows;
  const vid = (i: number, j: number) => j * cols + (periodic ? ((i % nu) + nu) % nu : i);

  const holes = (spec.holes ?? []).map((h) => {
    const d = 1e-4;
    const su = v3.len(v3.sub(spec.surface(h.u + d, h.v), spec.surface(h.u - d, h.v))) / (2 * d);
    const sv = v3.len(v3.sub(spec.surface(h.u, h.v + d), spec.surface(h.u, h.v - d))) / (2 * d);
    return { ...h, ru: h.radius / su, rv: h.radius / sv };
  });
  const inHole = (u: number, v: number) =>
    holes.findIndex((h) => ((u - h.u) / h.ru) ** 2 + ((v - h.v) / h.rv) ** 2 < 1);

  const kept = new Uint8Array(nu * nv);
  const holeOfCell = new Int16Array(nu * nv).fill(-1);
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const uc = (i + 0.5) / nu;
      const vc = (j + 0.5) / nv;
      const h = inHole(uc, vc);
      holeOfCell[j * nu + i] = h;
      kept[j * nu + i] = h === -1 && (spec.keep ? spec.keep(uc, vc) : true) ? 1 : 0;
    }
  }
  const isKept = (i: number, j: number) => {
    if (j < 0 || j >= nv) return false;
    if (periodic) i = ((i % nu) + nu) % nu;
    else if (i < 0 || i >= nu) return false;
    return kept[j * nu + i] === 1;
  };

  const U = new Float64Array(nGrid);
  const V = new Float64Array(nGrid);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      U[vid(i, j)] = i / nu;
      V[vid(i, j)] = j / nv;
    }
  }
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      const h = holeOfCell[j * nu + i];
      if (h === -1) continue;
      const hole = holes[h];
      for (const [ci, cj] of [
        [i, j],
        [i + 1, j],
        [i + 1, j + 1],
        [i, j + 1],
      ]) {
        const touchesKept =
          isKept(ci - 1, cj - 1) || isKept(ci, cj - 1) || isKept(ci - 1, cj) || isKept(ci, cj);
        if (!touchesKept) continue;
        const k = vid(ci, cj);
        const du = (ci / nu - hole.u) / hole.ru;
        const dv = (cj / nv - hole.v) / hole.rv;
        const l = Math.hypot(du, dv) || 1;
        U[k] = hole.u + (du / l) * hole.ru;
        V[k] = hole.v + (dv / l) * hole.rv;
      }
    }
  }

  const positions = new Float32Array(nGrid * 2 * 3);
  const t2 = spec.thickness / 2;
  let orientationSign = 0;
  for (let k = 0; k < nGrid; k++) {
    const u = U[k];
    const v = V[k];
    const s = spec.surface(u, v);
    let n = spec.normal ? v3.norm(spec.normal(u, v)) : finiteNormal(spec, u, v);
    if (v3.len(n) === 0) n = [0, 1, 0];
    positions.set(v3.add(s, v3.scale(n, t2)), k * 3);
    positions.set(v3.sub(s, v3.scale(n, t2)), (k + nGrid) * 3);
    if (orientationSign === 0 && spec.normal) {
      const fn = finiteNormal(spec, Math.min(Math.max(u, 0.01), 0.99), Math.min(Math.max(v, 0.01), 0.99));
      const d = v3.dot(fn, n);
      if (Math.abs(d) > 0.5) orientationSign = Math.sign(d);
    }
  }

  const tris: number[] = [];
  const rim = (p: number, q: number) => {
    const pi = p + nGrid;
    const qi = q + nGrid;
    tris.push(p, pi, qi, p, qi, q);
  };
  for (let j = 0; j < nv; j++) {
    for (let i = 0; i < nu; i++) {
      if (!kept[j * nu + i]) continue;
      const a = vid(i, j);
      const b = vid(i + 1, j);
      const c = vid(i + 1, j + 1);
      const d = vid(i, j + 1);
      tris.push(a, b, c, a, c, d);
      tris.push(a + nGrid, c + nGrid, b + nGrid, a + nGrid, d + nGrid, c + nGrid);
      if (!isKept(i, j - 1)) rim(a, b);
      if (!isKept(i + 1, j)) rim(b, c);
      if (!isKept(i, j + 1)) rim(c, d);
      if (!isKept(i - 1, j)) rim(d, a);
    }
  }
  const indices = new Uint32Array(tris);
  if (orientationSign < 0) flipWinding(indices);
  return compactVertices(weldVertices({ positions, indices }, 1e-4).mesh);
}
