import type { MeshData } from '../mesh/types';

export function cube(s = 10): MeshData {
  const p = [0, 0, 0, s, 0, 0, s, s, 0, 0, s, 0, 0, 0, s, s, 0, s, s, s, s, 0, s, s];
  const f = [
    0, 2, 1, 0, 3, 2, 4, 5, 6, 4, 6, 7, 0, 1, 5, 0, 5, 4, 2, 3, 7, 2, 7, 6, 1, 2, 6, 1, 6, 5, 0, 4, 7, 0, 7,
    3,
  ];
  return { positions: new Float32Array(p), indices: new Uint32Array(f) };
}

export function uvSphere(radius = 1, widthSegments = 32, heightSegments = 16): MeshData {
  const pos: number[] = [];
  const idx: number[] = [];
  for (let j = 0; j <= heightSegments; j++) {
    const ph = (j / heightSegments) * Math.PI;
    for (let i = 0; i <= widthSegments; i++) {
      const th = (i / widthSegments) * Math.PI * 2;
      pos.push(
        radius * Math.sin(ph) * Math.cos(th),
        radius * Math.cos(ph),
        radius * Math.sin(ph) * Math.sin(th),
      );
    }
  }
  const row = widthSegments + 1;
  for (let j = 0; j < heightSegments; j++) {
    for (let i = 0; i < widthSegments; i++) {
      const a = j * row + i;
      const b = a + 1;
      const c = a + row + 1;
      const d = a + row;
      if (j !== 0) idx.push(a, b, d);
      if (j !== heightSegments - 1) idx.push(b, c, d);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

export function cylinder(radius = 50, height = 400, segments = 64): MeshData {
  const pos: number[] = [];
  const idx: number[] = [];
  const h = height / 2;
  for (let i = 0; i < segments; i++) {
    const a = (i / segments) * Math.PI * 2;
    pos.push(radius * Math.sin(a), -h, radius * Math.cos(a), radius * Math.sin(a), h, radius * Math.cos(a));
  }
  const bottom = pos.length / 3;
  pos.push(0, -h, 0);
  const top = bottom + 1;
  pos.push(0, h, 0);
  for (let i = 0; i < segments; i++) {
    const j = (i + 1) % segments;
    const b0 = i * 2;
    const t0 = i * 2 + 1;
    const b1 = j * 2;
    const t1 = j * 2 + 1;
    idx.push(b0, b1, t1, b0, t1, t0);
    idx.push(bottom, b1, b0);
    idx.push(top, t0, t1);
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}
