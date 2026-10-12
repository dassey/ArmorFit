import type { ClearanceSettings } from './clearance';

export function clearanceColor(c: number, s: ClearanceSettings): [number, number, number] {
  const lerp = (a: number[], b: number[], t: number): [number, number, number] => {
    const k = Math.min(1, Math.max(0, t));
    return [a[0] + (b[0] - a[0]) * k, a[1] + (b[1] - a[1]) * k, a[2] + (b[2] - a[2]) * k];
  };
  const MAGENTA = [0.75, 0.1, 0.55];
  const RED = [0.86, 0.16, 0.14];
  const YELLOW = [0.95, 0.78, 0.2];
  const GREEN = [0.25, 0.75, 0.38];
  const CYAN = [0.25, 0.7, 0.85];
  const BLUE = [0.2, 0.35, 0.9];
  if (c < 0) return lerp(RED, MAGENTA, -c / 5);
  if (c < s.min) return lerp(RED, YELLOW, c / s.min);
  if (c < s.target) return lerp(YELLOW, GREEN, (c - s.min) / Math.max(1e-6, s.target - s.min));
  if (c <= s.max) return lerp(GREEN, CYAN, (c - s.target) / Math.max(1e-6, s.max - s.target) - 0.4);
  return lerp(CYAN, BLUE, (c - s.max) / Math.max(10, s.max));
}

export function legendStops(s: ClearanceSettings): { value: number; color: string; label: string }[] {
  const css = (c: number) => {
    const [r, g, b] = clearanceColor(c, s);
    return `rgb(${Math.round(r * 255)}, ${Math.round(g * 255)}, ${Math.round(b * 255)})`;
  };
  return [
    { value: -3, color: css(-3), label: 'inside' },
    { value: 0, color: css(0), label: '0' },
    { value: s.min, color: css(s.min), label: `${s.min}` },
    { value: s.target, color: css(s.target), label: `${s.target}` },
    { value: s.max, color: css(s.max), label: `${s.max}` },
    { value: s.max * 2, color: css(s.max * 2), label: `${s.max * 2}+` },
  ];
}
