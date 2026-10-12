import type { ClearanceSettings, ClearanceStats } from '../fit/clearance';
import type { MeasurementProfile } from '../measurements/profile';
import { knownKeys } from '../measurements/profile';
import { MEASUREMENTS, UNDERGARMENT_LABELS } from '../measurements/schema';
import type { BuildVolumeCheck } from '../print/buildVolume';
import type { PrinterProfile } from '../print/printers';
import { formatLength } from '../units';

export interface ReportPiece {
  name: string;
  fileName: string;
  fileHash: string;
  type: string;
  side: string | null;
  unitScale: number;
  scale: [number, number, number];
  mirrored: boolean;
  placed: boolean;
  stats?: ClearanceStats;
  covers?: string;
  printCheck?: BuildVolumeCheck;
}

export interface ReportInput {
  appVersion: string;
  date: Date;
  profile: MeasurementProfile;
  clearance: ClearanceSettings;
  printer: PrinterProfile;
  orientation: 'original' | 'wearing';
  pieces: ReportPiece[];
}

const pct = (x: number) => `${(x * 100).toFixed(1)} %`;
const mm = (v: number[]) => `${v.map((x) => Math.round(x)).join(' × ')} mm`;

function printerCell(c?: BuildVolumeCheck): string {
  if (!c) return '—';
  if (c.fitsAsExported) return `${mm(c.exportedExtents)} ✓`;
  if (c.fits) return `fits on another side: ${mm(c.extents)}`;
  return `✗ too big (at least ${mm(c.minimalSize)})`;
}

export function sizingReportMarkdown(r: ReportInput): string {
  const u = r.profile.displayUnit;
  const known = new Set(knownKeys(r.profile));
  const lines: string[] = [];
  lines.push('# ArmorFit sizing report', '');
  lines.push(`Generated ${r.date.toISOString()} with ArmorFit ${r.appVersion}.`, '');
  lines.push('## Body', '');
  lines.push(
    `Body shape: ${r.profile.preset}. Under the armor: ${UNDERGARMENT_LABELS[r.profile.undergarment]}. Mode: ${r.profile.mode}.`,
    '',
  );
  lines.push('| Measurement | Value | Source |', '| --- | ---: | --- |');
  for (const m of MEASUREMENTS) {
    const v = r.profile.values[m.key];
    lines.push(
      `| ${m.label} | ${formatLength(v, u)} (${Math.round(v)} mm) | ${known.has(m.key) ? 'measured' : 'estimated (ANSUR II)'} |`,
    );
  }
  lines.push('', '## Clearance', '');
  lines.push(
    `Minimum ${r.clearance.min} mm · target ${r.clearance.target} mm · loose above ${r.clearance.max} mm (undergarment allowance included).`,
    '',
  );
  lines.push('## Pieces', '');
  lines.push(
    '| Piece | Source file | SHA-256 (first 16) | Type | Units → mm | Scale X / Y / Z (wearing frame) | Mirrored | Fit | Printer |',
    '| --- | --- | --- | --- | ---: | --- | --- | --- | --- |',
  );
  for (const p of r.pieces) {
    const fit = !p.placed
      ? 'not placed'
      : p.stats && p.stats.count
        ? `closest ${p.stats.min.toFixed(1)} mm, typical ${p.stats.median.toFixed(1)} mm${p.covers ? ` — ${p.covers}` : ''}`
        : '—';
    lines.push(
      `| ${p.name} | ${p.fileName} | \`${p.fileHash}\` | ${p.type}${p.side ? ` (${p.side})` : ''} | ×${p.unitScale} | ${p.scale.map(pct).join(' / ')} | ${p.mirrored ? 'yes' : 'no'} | ${fit} | ${printerCell(p.printCheck)} |`,
    );
  }
  lines.push('', '## Reprinting', '');
  lines.push(
    `Printer: ${r.printer.brand} ${r.printer.model} (${r.printer.volume.join(' × ')} mm). Files exported in ${r.orientation === 'original' ? "the designer's original orientation" : 'wearing orientation (Z up)'}.`,
    '',
    'Per-axis scales are applied along the body-aligned axes of each piece, which are generally not the axes of the source file — re-export from ArmorFit (load the project file and re-attach the source files) rather than re-typing the percentages into a slicer. Uniform scales can be typed into any slicer directly.',
    '',
  );
  return lines.join('\n');
}
