import { signal, useSignalEffect } from '@preact/signals';
import { exportMatrix } from '../core/export/transform';
import { sizingReportMarkdown } from '../core/export/report';
import { pieceType } from '../core/pieces/types';
import type { BuildVolumeCheck } from '../core/print/buildVolume';
import { customPrinter, findPrinter, PRINTERS, type PrinterProfile } from '../core/print/printers';
import type { AppController } from '../state/controller';
import { pendingPieces, pieces, type PieceState } from '../state/pieces';
import { buildProjectJson, loadProjectJson } from '../state/project';
import { clearance, printSettings, profile, toast, view } from '../state/store';
import { APP_VERSION } from '../version';
import type { ExportItem } from '../workers/geometry.worker';
import { Button, download, pickFiles, Segmented } from './controls';

const checks = signal<Record<string, BuildVolumeCheck>>({});
const busy = signal<string | null>(null);

const mm = (v: number[]) => `${v.map((x) => Math.round(x)).join(' × ')} mm`;

function currentPrinter(): PrinterProfile {
  const s = printSettings.value;
  return s.printerId === 'custom' ? customPrinter(s.custom) : (findPrinter(s.printerId) ?? PRINTERS[0]);
}

function exportItem(p: PieceState): ExportItem {
  const m = exportMatrix(
    { unitScale: p.unitScale, orientation: p.orientation.matrix, scale: p.scale, mirrored: p.mirrored },
    printSettings.value.orientation,
  );
  return { sourceId: p.sourceId ?? p.id, name: p.name, matrix: m.elements.slice() };
}

async function run<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  busy.value = label;
  try {
    return await fn();
  } catch (e) {
    toast(e instanceof Error ? e.message : String(e), 'error');
    return undefined;
  } finally {
    busy.value = null;
  }
}

function PrinterPicker() {
  const s = printSettings.value;
  const brands = [...new Set(PRINTERS.map((p) => p.brand))];
  const printer = currentPrinter();
  return (
    <div class="subbox">
      <div class="subbox-title">Printer</div>
      <select
        aria-label="Printer"
        value={s.printerId}
        onChange={(e) => (printSettings.value = { ...s, printerId: (e.target as HTMLSelectElement).value })}
      >
        {brands.map((b) => (
          <optgroup label={b}>
            {PRINTERS.filter((p) => p.brand === b).map((p) => (
              <option value={p.id}>
                {p.model} — {p.volume.join(' × ')} mm
              </option>
            ))}
          </optgroup>
        ))}
        <option value="custom">Custom…</option>
      </select>
      {s.printerId === 'custom' && (
        <div class="row gap">
          {(['X', 'Y', 'Z'] as const).map((axis, i) => (
            <label class="dim">
              {axis}
              <input
                type="number"
                min={50}
                max={2000}
                value={s.custom[i]}
                onChange={(e) => {
                  const v = parseFloat((e.target as HTMLInputElement).value);
                  if (!(v > 0)) return;
                  const custom: [number, number, number] = [...s.custom];
                  custom[i] = v;
                  printSettings.value = { ...s, custom };
                }}
              />
            </label>
          ))}
        </div>
      )}
      {printer.note && <p class="hint">{printer.note}</p>}
      {printer.source && (
        <p class="hint">
          Spec:{' '}
          <a href={printer.source} target="_blank" rel="noreferrer">
            {new URL(printer.source).hostname}
          </a>
        </p>
      )}
      <label class="field-row">
        <span>Export as</span>
        <Segmented
          size="sm"
          label="Export orientation"
          value={s.orientation}
          onChange={(o) => (printSettings.value = { ...s, orientation: o })}
          options={[
            {
              value: 'original',
              label: 'Designer’s layout',
              title: 'Keep the original file orientation (usually print-ready)',
            },
            { value: 'wearing', label: 'As worn', title: 'Upright as worn, Z up' },
          ]}
        />
      </label>
    </div>
  );
}

function PieceRow({ piece, controller }: { piece: PieceState; controller: AppController }) {
  const c = checks.value[piece.id];
  const scalePct = piece.scale.every((x) => Math.abs(x - piece.scale[0]) < 1e-6)
    ? `${(piece.scale[0] * 100).toFixed(1)}%`
    : piece.scale.map((x) => `${(x * 100).toFixed(0)}%`).join('·');
  return (
    <li class="print-row">
      <div class="print-name">
        <strong>{piece.name}</strong>
        <span class="muted">
          {piece.type ? pieceType(piece.type).label : 'unknown'} · scale {scalePct}
          {piece.mirrored ? ' · mirrored' : ''}
        </span>
        {!c ? (
          <span class="muted">checking size…</span>
        ) : c.fitsAsExported ? (
          <span class="fit-ok">✓ fits the printer: {mm(c.exportedExtents)}</span>
        ) : c.fits ? (
          <span class="fit-warn">
            ⚠ fits only on another side ({mm(c.extents)}) — turn it over in your slicer
          </span>
        ) : (
          <span class="fit-bad">
            ✗ too big for the printer (smallest box {mm(c.minimalSize)}) — split it in your slicer
          </span>
        )}
      </div>
      <Button
        class="small"
        disabled={!!busy.value}
        onClick={() =>
          run('stl', async () => {
            const buf = await controller.geo.exportStl(exportItem(piece));
            download(`${piece.name.replace(/[^\w.-]+/g, '_')}.stl`, buf, 'model/stl');
          })
        }
      >
        STL
      </Button>
    </li>
  );
}

export function PrintPanel({ controller }: { controller: AppController }) {
  const list = pieces.value;
  useSignalEffect(() => {
    const vol = currentPrinter().volume;
    const items = pieces.value.map((p) => ({ id: p.id, item: exportItem(p) }));
    void printSettings.value;
    let cancelled = false;
    const t = setTimeout(async () => {
      const out: Record<string, BuildVolumeCheck> = {};
      for (const { id, item } of items) {
        try {
          out[id] = await controller.geo.checkFit(item.sourceId, item.matrix, vol);
        } catch {}
        if (cancelled) return;
      }
      checks.value = out;
    }, 200);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  });

  const items = () => list.map(exportItem);
  const report = () => {
    const printer = currentPrinter();
    return sizingReportMarkdown({
      appVersion: APP_VERSION,
      date: new Date(),
      profile: profile.value,
      clearance: clearance.value,
      printer,
      orientation: printSettings.value.orientation,
      pieces: list.map((p) => {
        const c = checks.value[p.id];
        return {
          name: p.name,
          fileName: p.fileName,
          fileHash: p.fileHash,
          type: p.type ? pieceType(p.type).label : 'unknown',
          side: p.side,
          unitScale: p.unitScale,
          scale: p.scale,
          mirrored: p.mirrored,
          placed: !!p.placement,
          stats: p.fit?.stats,
          covers: p.fit?.tally
            .slice(0, 2)
            .map((t) => `${Math.round(t.fraction * 100)}% ${t.label}`)
            .join(', '),
          printCheck: c,
        };
      }),
    });
  };

  return (
    <section class="panel-section" aria-labelledby="print-title">
      <h2 id="print-title">Print</h2>
      <PrinterPicker />
      {pendingPieces.value.length > 0 && (
        <div class="subbox warn-box">
          <div class="subbox-title">Re-attach files</div>
          <p class="hint">
            The loaded project needs its source files. Drop these (any order) to restore their fit:{' '}
            {[...new Set(pendingPieces.value.map((p) => p.fileName))].join(', ')}.
          </p>
        </div>
      )}
      {list.length === 0 ? (
        <p class="hint">
          No pieces yet — add some in the{' '}
          <button type="button" class="linklike" onClick={() => (view.tab.value = 'armor')}>
            Armor
          </button>{' '}
          tab.
        </p>
      ) : (
        <ul class="print-list">
          {list.map((p) => (
            <PieceRow key={p.id} piece={p} controller={controller} />
          ))}
        </ul>
      )}
      <div class="row wrap gap">
        <Button
          variant="primary"
          disabled={!list.length || !!busy.value}
          onClick={() =>
            run('zip', async () =>
              download('armorfit-stl.zip', await controller.geo.exportZip(items()), 'application/zip'),
            )
          }
        >
          {busy.value === 'zip' ? 'Exporting…' : 'All as STL (zip)'}
        </Button>
        <Button
          disabled={!list.length || !!busy.value}
          onClick={() =>
            run('3mf', async () =>
              download('armorfit.3mf', await controller.geo.export3mf(items()), 'model/3mf'),
            )
          }
        >
          {busy.value === '3mf' ? 'Exporting…' : 'All as 3MF'}
        </Button>
        <Button
          disabled={!list.length}
          onClick={() => download('armorfit-sizing-report.md', report(), 'text/markdown')}
        >
          Sizing report
        </Button>
      </div>
      <div class="subbox">
        <div class="subbox-title">Project</div>
        <p class="hint">
          Saves measurements, settings and every piece’s units, orientation, position and scale — not the
          meshes. Open it later and drop the same files to pick up where you left off.
        </p>
        <div class="row wrap gap">
          <Button onClick={() => download('armorfit-project.json', buildProjectJson(), 'application/json')}>
            Save project
          </Button>
          <Button
            onClick={async () => {
              const [f] = await pickFiles('.json,application/json');
              if (!f) return;
              try {
                const r = loadProjectJson(await f.text());
                if (r.warning) toast(r.warning, 'error', 7000);
                toast(`Project loaded. Drop the ${r.waiting} piece file(s) to re-attach them.`);
                view.tab.value = 'print';
              } catch (e) {
                toast(e instanceof Error ? e.message : String(e), 'error');
              }
            }}
          >
            Open project…
          </Button>
        </div>
      </div>
      <p class="hint">
        Oversized pieces: split them with your slicer’s cut tool for now (automatic splitting with alignment
        pins is planned).
      </p>
    </section>
  );
}
