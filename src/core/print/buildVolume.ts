import { Vector3 } from 'three';
import { ConvexHull } from 'three/examples/jsm/math/ConvexHull.js';
import { pca } from '../math/fitting';
import { v3, type Vec3 } from '../math/linalg';

export interface BuildVolumeCheck {
  fits: boolean;
  extents: Vec3;
  slack: number;
  axes: [Vec3, Vec3, Vec3];
  minimalSize: Vec3;
  fitsAsExported: boolean;
  exportedExtents: Vec3;
}

export function hullPoints(points: ArrayLike<number>, chunkSize = 200_000): Float64Array {
  const n = points.length / 3;
  if (n > chunkSize) {
    const parts: Float64Array[] = [];
    for (let start = 0; start < n; start += chunkSize) {
      const end = Math.min(n, start + chunkSize);
      const chunk = new Float64Array((end - start) * 3);
      for (let i = 0; i < chunk.length; i++) chunk[i] = points[start * 3 + i];
      parts.push(hullPoints(chunk, chunkSize));
    }
    const merged = new Float64Array(parts.reduce((sum, p) => sum + p.length, 0));
    let offset = 0;
    for (const p of parts) {
      merged.set(p, offset);
      offset += p.length;
    }
    return hullPoints(merged, merged.length < points.length ? chunkSize : Infinity);
  }
  const vs: Vector3[] = [];
  for (let i = 0; i < n; i++) vs.push(new Vector3(points[i * 3], points[i * 3 + 1], points[i * 3 + 2]));
  if (vs.length < 4) return Float64Array.from(points);
  const hull = new ConvexHull().setFromPoints(vs);
  const seen = new Set<Vector3>();
  for (const face of hull.faces) {
    let e = face.edge;
    do {
      seen.add(e.head().point);
      e = e.next;
    } while (e !== face.edge);
  }
  const out = new Float64Array(seen.size * 3);
  let i = 0;
  for (const p of seen) {
    out[i++] = p.x;
    out[i++] = p.y;
    out[i++] = p.z;
  }
  return out;
}

function extentsAlong(points: ArrayLike<number>, ax: Vec3, ay: Vec3, az: Vec3): Vec3 {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  let minZ = Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < points.length; i += 3) {
    const x = points[i];
    const y = points[i + 1];
    const z = points[i + 2];
    const px = x * ax[0] + y * ax[1] + z * ax[2];
    const py = x * ay[0] + y * ay[1] + z * ay[2];
    const pz = x * az[0] + y * az[1] + z * az[2];
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
    if (pz < minZ) minZ = pz;
    if (pz > maxZ) maxZ = pz;
  }
  return [maxX - minX, maxY - minY, maxZ - minZ];
}

function basisFromZ(z: Vec3): [Vec3, Vec3] {
  const helper: Vec3 = Math.abs(z[0]) < 0.9 ? [1, 0, 0] : [0, 1, 0];
  const x = v3.norm(v3.cross(helper, z));
  const y = v3.cross(z, x);
  return [x, y];
}

function spread(points: ArrayLike<number>, max: number): Float64Array {
  const n = points.length / 3;
  const m = Math.min(n, max);
  const out = new Float64Array(m * 3);
  for (let k = 0; k < m; k++) {
    const i = Math.floor((k * n) / m) * 3;
    out[k * 3] = points[i];
    out[k * 3 + 1] = points[i + 1];
    out[k * 3 + 2] = points[i + 2];
  }
  return out;
}

const SEARCH_POINTS = 3000;

type Axes = [Vec3, Vec3, Vec3];

export function checkBuildVolume(points: ArrayLike<number>, volume: Vec3, margin = 1): BuildVolumeCheck {
  return checkHull(hullPoints(points), volume, margin);
}

export function checkHull(
  hull: ArrayLike<number>,
  volume: Vec3,
  margin = 1,
  exact: ArrayLike<number> = hull,
): BuildVolumeCheck {
  const sample = spread(hull, SEARCH_POINTS);
  const ups: Vec3[] = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  ups.push(...pca(sample).axes);
  try {
    const vs: Vector3[] = [];
    for (let i = 0; i < sample.length; i += 3) vs.push(new Vector3(sample[i], sample[i + 1], sample[i + 2]));
    if (vs.length >= 4) {
      const h = new ConvexHull().setFromPoints(vs);
      const faces = [...h.faces].sort((a, b) => b.area - a.area).slice(0, 24);
      for (const f of faces) ups.push([f.normal.x, f.normal.y, f.normal.z]);
    }
  } catch {}

  const slackOf = (e: Vec3) => Math.min(volume[0] - e[0], volume[1] - e[1], volume[2] - e[2]) - margin;
  let minimalAxes: Axes = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  let minimalVolume = Infinity;
  const bestTurn = (up: Vec3): Axes => {
    const z = v3.norm(up);
    const [bx, by] = basisFromZ(z);
    let best: { slack: number; axes: Axes } | null = null;
    for (let deg = 0; deg < 90; deg++) {
      const a = (deg * Math.PI) / 180;
      const x = v3.add(v3.scale(bx, Math.cos(a)), v3.scale(by, Math.sin(a)));
      const y = v3.cross(z, x);
      const e = extentsAlong(sample, x, y, z);
      const vol = e[0] * e[1] * e[2];
      if (vol < minimalVolume) {
        minimalVolume = vol;
        minimalAxes = [x, y, z];
      }
      const straight = slackOf(e);
      const swapped = slackOf([e[1], e[0], e[2]]);
      if (!best || Math.max(straight, swapped) > best.slack) {
        best =
          straight >= swapped
            ? { slack: straight, axes: [x, y, z] }
            : { slack: swapped, axes: [y, x, v3.scale(z, -1)] };
      }
    }
    return best!.axes;
  };

  const measured = [bestTurn([0, 0, 1]), ...ups.map(bestTurn)].map((axes) => {
    const extents = extentsAlong(exact, axes[0], axes[1], axes[2]);
    return { axes, extents, slack: slackOf(extents) };
  });
  const asExported = measured[0];
  const best = measured.reduce((a, b) => (b.slack > a.slack ? b : a));
  return {
    fits: best.slack >= 0,
    extents: best.extents,
    slack: best.slack,
    axes: best.axes,
    minimalSize: extentsAlong(exact, ...minimalAxes).sort((p, q) => q - p) as Vec3,
    fitsAsExported: asExported.slack >= 0,
    exportedExtents: asExported.extents,
  };
}
