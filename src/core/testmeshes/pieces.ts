import type { Vec3 } from '../math/linalg';
import type { MeshData } from '../mesh/types';
import { makeShell } from './shell';

const DEG = Math.PI / 180;

export interface HelmetOptions {
  rx?: number;
  ry?: number;
  rz?: number;
  thickness?: number;
  faceOpening?: boolean;
  segments?: number;
}

export function makeHelmet(opts: HelmetOptions = {}): MeshData {
  const rx = opts.rx ?? 92;
  const ry = opts.ry ?? 118;
  const rz = opts.rz ?? 112;
  const thickness = opts.thickness ?? 3;
  const seg = opts.segments ?? 96;
  const phiMax = 118 * DEG;
  const surface = (u: number, v: number): Vec3 => {
    const th = u * 2 * Math.PI;
    const ph = v * phiMax;
    return [rx * Math.sin(ph) * Math.sin(th), ry * Math.cos(ph), rz * Math.sin(ph) * Math.cos(th)];
  };
  const normal = (u: number, v: number): Vec3 => {
    const [x, y, z] = surface(u, v);
    return [x / (rx * rx), y / (ry * ry), z / (rz * rz)];
  };
  return makeShell({
    surface,
    normal,
    uSegments: seg,
    vSegments: Math.round(seg * 0.45),
    uPeriodic: true,
    thickness,
    keep: (u, v) => {
      if (opts.faceOpening === false) return true;
      const th = u * 360;
      const ph = v * (phiMax / DEG);
      const front = th < 48 || th > 312;
      return !(front && ph > 62);
    },
  });
}

export interface ChestPlateOptions {
  width?: number;
  height?: number;
  depth?: number;
  thickness?: number;
  segments?: number;
}

export function makeChestPlate(opts: ChestPlateOptions = {}): MeshData {
  const halfAngle = 78 * DEG;
  const height = opts.height ?? 330;
  const rx = (opts.width ?? 330) / 2 / Math.sin(halfAngle);
  const rz = opts.depth ?? 130;
  const thickness = opts.thickness ?? 3;
  const seg = opts.segments ?? 80;
  const surface = (u: number, v: number): Vec3 => {
    const th = (u * 2 - 1) * halfAngle;
    const y = (v - 0.5) * height;
    const t = v;
    const barrel = 0.9 + 0.13 * Math.sin(Math.PI * Math.min(1, t * 1.25));
    const pec = 1 + 0.06 * Math.exp(-(((t - 0.68) / 0.16) ** 2)) * Math.cos(th) ** 2;
    return [rx * barrel * Math.sin(th), y, rz * barrel * pec * Math.cos(th)];
  };
  return makeShell({
    surface,
    uSegments: seg,
    vSegments: seg,
    thickness,
    keep: (u, v) => {
      const x = u * 2 - 1;
      if (v > 0.82 && Math.abs(x) < 0.42 * Math.sqrt(Math.max(0, (v - 0.82) / 0.18))) return false;
      if (v > 0.58 && Math.abs(x) > 0.86 - 0.5 * (v - 0.58)) return false;
      return true;
    },
  });
}

export interface PauldronOptions {
  radius?: number;
  thickness?: number;
  magnetHoles?: boolean;
  segments?: number;
}

export function makePauldron(opts: PauldronOptions = {}): MeshData {
  const r = opts.radius ?? 105;
  const thickness = opts.thickness ?? 3;
  const seg = opts.segments ?? 128;
  const tilt = 25 * DEG;
  const axis: Vec3 = [Math.sin(tilt), Math.cos(tilt), 0];
  const ref: Vec3 = [0, 0, 1];
  const side: Vec3 = [
    axis[1] * ref[2] - axis[2] * ref[1],
    axis[2] * ref[0] - axis[0] * ref[2],
    axis[0] * ref[1] - axis[1] * ref[0],
  ];
  const capAngle = 68 * DEG;
  const surface = (u: number, v: number): Vec3 => {
    const th = u * 2 * Math.PI;
    const ph = v * capAngle;
    const ct = Math.cos(th);
    const st = Math.sin(th);
    const sp = Math.sin(ph);
    const cp = Math.cos(ph);
    const out: Vec3 = [0, 0, 0];
    for (let k = 0; k < 3; k++) out[k] = r * (cp * axis[k] + sp * (ct * ref[k] + st * side[k]));
    return out;
  };
  const normal = (u: number, v: number) => surface(u, v);
  return makeShell({
    surface,
    normal,
    uSegments: seg,
    vSegments: Math.round(seg * 0.5),
    uPeriodic: true,
    thickness,
    holes:
      opts.magnetHoles === false
        ? []
        : [
            { u: 0.25, v: 0.62, radius: 5 },
            { u: 0.75, v: 0.62, radius: 5 },
          ],
  });
}

export interface ForearmOptions {
  length?: number;
  elbowRadius?: number;
  wristRadius?: number;
  thickness?: number;
  segments?: number;
}

export function makeForearmTube(opts: ForearmOptions = {}): MeshData {
  const length = opts.length ?? 220;
  const re = opts.elbowRadius ?? 52;
  const rw = opts.wristRadius ?? 38;
  const thickness = opts.thickness ?? 3;
  const seg = opts.segments ?? 64;
  const surface = (u: number, v: number): Vec3 => {
    const th = u * 2 * Math.PI;
    const y = (v - 0.5) * length;
    const r = rw + (re - rw) * v;
    return [r * 1.08 * Math.sin(th), y, r * 0.92 * Math.cos(th)];
  };
  return makeShell({
    surface,
    uSegments: seg,
    vSegments: Math.round(seg * 0.75),
    uPeriodic: true,
    thickness,
  });
}

export const DEMO_PIECES = {
  helmet: makeHelmet,
  chest: makeChestPlate,
  pauldronL: makePauldron,
  forearmL: makeForearmTube,
} as const;
