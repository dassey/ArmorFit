export type Vec3 = [number, number, number];

export const v3 = {
  add: (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]],
  sub: (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]],
  scale: (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s],
  dot: (a: Vec3, b: Vec3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2],
  cross: (a: Vec3, b: Vec3): Vec3 => [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ],
  len: (a: Vec3): number => Math.hypot(a[0], a[1], a[2]),
  norm: (a: Vec3): Vec3 => {
    const l = Math.hypot(a[0], a[1], a[2]);
    return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
  },
  lerp: (a: Vec3, b: Vec3, t: number): Vec3 => [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ],
  dist: (a: Vec3, b: Vec3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]),
};

export function symmetricEigen3(m: ArrayLike<number>): { values: Vec3; vectors: [Vec3, Vec3, Vec3] } {
  const a = [
    [m[0], m[1], m[2]],
    [m[3], m[4], m[5]],
    [m[6], m[7], m[8]],
  ];
  const v = [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ];
  for (let sweep = 0; sweep < 50; sweep++) {
    const off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-14 * (Math.abs(a[0][0]) + Math.abs(a[1][1]) + Math.abs(a[2][2]) + 1e-300)) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        if (Math.abs(a[p][q]) < 1e-300) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * a[p][q]);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
        for (let k = 0; k < 3; k++) {
          const vkp = v[k][p];
          const vkq = v[k][q];
          v[k][p] = c * vkp - s * vkq;
          v[k][q] = s * vkp + c * vkq;
        }
      }
    }
  }
  const order = [0, 1, 2].sort((i, j) => a[j][j] - a[i][i]);
  const values = order.map((i) => a[i][i]) as Vec3;
  const vectors = order.map((i) => v3.norm([v[0][i], v[1][i], v[2][i]])) as [Vec3, Vec3, Vec3];
  return { values, vectors };
}

export function solveLinear(A: ArrayLike<number>, b: ArrayLike<number>, n: number): Float64Array | null {
  const M = new Float64Array(n * (n + 1));
  for (let r = 0; r < n; r++) {
    for (let c = 0; c < n; c++) M[r * (n + 1) + c] = A[r * n + c];
    M[r * (n + 1) + n] = b[r];
  }
  const w = n + 1;
  for (let col = 0; col < n; col++) {
    let piv = col;
    let best = Math.abs(M[col * w + col]);
    for (let r = col + 1; r < n; r++) {
      const val = Math.abs(M[r * w + col]);
      if (val > best) {
        best = val;
        piv = r;
      }
    }
    if (best < 1e-14) return null;
    if (piv !== col) {
      for (let c = 0; c < w; c++) {
        const t = M[col * w + c];
        M[col * w + c] = M[piv * w + c];
        M[piv * w + c] = t;
      }
    }
    const d = M[col * w + col];
    for (let r = 0; r < n; r++) {
      if (r === col) continue;
      const f = M[r * w + col] / d;
      if (f === 0) continue;
      for (let c = col; c < w; c++) M[r * w + c] -= f * M[col * w + c];
    }
  }
  const x = new Float64Array(n);
  for (let r = 0; r < n; r++) x[r] = M[r * w + n] / M[r * w + r];
  return x;
}

export function leastSquares(
  J: ArrayLike<number>,
  r: ArrayLike<number>,
  m: number,
  n: number,
  lambda = 0,
): Float64Array | null {
  const JtJ = new Float64Array(n * n);
  const Jtr = new Float64Array(n);
  for (let i = 0; i < m; i++) {
    const ri = r[i];
    for (let a = 0; a < n; a++) {
      const ja = J[i * n + a];
      if (ja === 0) continue;
      Jtr[a] += ja * ri;
      for (let b = a; b < n; b++) JtJ[a * n + b] += ja * J[i * n + b];
    }
  }
  for (let a = 0; a < n; a++) {
    for (let b = 0; b < a; b++) JtJ[a * n + b] = JtJ[b * n + a];
    JtJ[a * n + a] += lambda;
  }
  return solveLinear(JtJ, Jtr, n);
}
