import { legendStops } from '../core/fit/heatmap';
import { measurementInfo } from '../core/measurements/schema';
import { pieceType } from '../core/pieces/types';
import type { AppController } from '../state/controller';
import { pieces, selectedPiece, selectedId, type PieceState } from '../state/pieces';
import { clearance, clearanceBase, toast, view } from '../state/store';
import { useState } from 'preact/hooks';
import { Button, Segmented } from './controls';

const DEG = 180 / Math.PI;

function Slider(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit: string;
  onInput: (v: number) => void;
  format?: (v: number) => string;
}) {
  const id = `s-${props.label.replace(/\W+/g, '-')}`;
  return (
    <label class="slider-row" for={id}>
      <span>{props.label}</span>
      <input
        id={id}
        type="range"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onInput={(e) => props.onInput(parseFloat((e.target as HTMLInputElement).value))}
      />
      <span class="slider-val">
        {props.format ? props.format(props.value) : props.value.toFixed(0)}
        {props.unit}
      </span>
    </label>
  );
}

function PlacementControls({ piece, controller }: { piece: PieceState; controller: AppController }) {
  const pm = controller.pieces!;
  const sp = piece.placement!;
  const step = 10;
  const uniform = piece.scale[0] === piece.scale[1] && piece.scale[1] === piece.scale[2];
  return (
    <>
      <div class="subbox">
        <div class="subbox-title">Position</div>
        <div class="nudge">
          <span />
          <Button class="small" onClick={() => pm.nudge(piece.id, 0, step)} aria-label="Move up">
            ▲
          </Button>
          <span />
          <Button class="small" onClick={() => pm.nudge(piece.id, -step, 0)} aria-label="Move left">
            ◀
          </Button>
          <span class="muted center">{step} mm</span>
          <Button class="small" onClick={() => pm.nudge(piece.id, step, 0)} aria-label="Move right">
            ▶
          </Button>
          <span />
          <Button class="small" onClick={() => pm.nudge(piece.id, 0, -step)} aria-label="Move down">
            ▼
          </Button>
          <span />
        </div>
        <Slider
          label="Rotate"
          value={sp.twist * DEG}
          min={-180}
          max={180}
          step={1}
          unit="°"
          onInput={(v) => pm.updatePlacement(piece.id, { twist: v / DEG }, false)}
        />
        <Slider
          label={sp.kind === 'bone' ? 'Slide' : 'Offset out'}
          value={sp.offset}
          min={-30}
          max={60}
          step={0.5}
          unit=" mm"
          format={(v) => v.toFixed(1)}
          onInput={(v) => pm.updatePlacement(piece.id, { offset: v }, false)}
        />
        <p class="hint">
          Drag the piece on the body to slide it; on touch screens use a second finger to rotate. Shift +
          mouse wheel also rotates.
        </p>
      </div>
      <AutoSizeBox piece={piece} controller={controller} />
      <div class="subbox">
        <div class="subbox-title">Scale</div>
        <Slider
          label="Overall"
          value={Math.round(((piece.scale[0] + piece.scale[1] + piece.scale[2]) / 3) * 1000) / 10}
          min={50}
          max={200}
          step={0.5}
          unit=" %"
          format={(v) => v.toFixed(1)}
          onInput={(v) => {
            const avg = (piece.scale[0] + piece.scale[1] + piece.scale[2]) / 3;
            const f = v / 100 / avg;
            pm.setScale(piece.id, [piece.scale[0] * f, piece.scale[1] * f, piece.scale[2] * f]);
          }}
        />
        {(['Width (X)', 'Height (Y)', 'Depth (Z)'] as const).map((label, axis) => (
          <Slider
            label={label}
            value={Math.round(piece.scale[axis] * 1000) / 10}
            min={50}
            max={200}
            step={0.5}
            unit=" %"
            format={(v) => v.toFixed(1)}
            onInput={(v) => {
              const s: [number, number, number] = [...piece.scale];
              s[axis] = v / 100;
              pm.setScale(piece.id, s);
            }}
          />
        ))}
        {!uniform && (
          <Button
            class="small"
            onClick={() => {
              const avg = (piece.scale[0] + piece.scale[1] + piece.scale[2]) / 3;
              pm.setScale(piece.id, [avg, avg, avg]);
            }}
          >
            Make uniform
          </Button>
        )}
      </div>
      <div class="row wrap gap">
        {piece.type && pieceType(piece.type).sided && (
          <Button onClick={() => pm.mirrorCopy(piece.id)}>
            Mirror to {piece.side === 'R' ? 'left' : 'right'} side
          </Button>
        )}
        <Button variant="ghost" onClick={() => pm.unplace(piece.id)}>
          Take off
        </Button>
      </div>
    </>
  );
}

function AutoSizeBox({ piece, controller }: { piece: PieceState; controller: AppController }) {
  const [mode, setMode] = useState<'uniform' | 'axes'>('uniform');
  const [busy, setBusy] = useState(false);
  const run = async () => {
    setBusy(true);
    try {
      const r = await controller.analysis!.autoSize(piece.id, mode);
      if (r) {
        const s = r.scale.map((x) => `${(x * 100).toFixed(1)}%`).join(' × ');
        toast(
          `Scaled to ${mode === 'uniform' ? `${(r.scale[0] * 100).toFixed(1)}%` : s}${r.moved >= 1 ? ` and moved ${Math.round(r.moved)} mm` : ''}. Typical gap ${r.before.toFixed(1)} → ${r.after.toFixed(1)} mm.`,
        );
      }
    } catch (e) {
      toast(e instanceof Error ? e.message : String(e), 'error');
    } finally {
      setBusy(false);
    }
  };
  return (
    <div class="subbox">
      <div class="subbox-title">Auto-size</div>
      <p class="hint">
        Scales the piece so its inside sits about {clearance.value.target} mm from your body, without touching
        it.
      </p>
      <div class="row wrap gap">
        <Segmented
          size="sm"
          label="Auto-size mode"
          value={mode}
          onChange={setMode}
          options={[
            { value: 'uniform', label: 'Keep proportions', title: 'One scale factor for the whole piece' },
            {
              value: 'axes',
              label: 'Per axis',
              title: 'Width, height and depth separately (gently regularised)',
            },
          ]}
        />
        <Button variant="primary" onClick={run} disabled={busy}>
          {busy ? 'Sizing…' : 'Auto-size'}
        </Button>
      </div>
    </div>
  );
}

function pct(x: number): string {
  return `${Math.round(x * 100)}%`;
}

function FitResults({ piece }: { piece: PieceState }) {
  const fit = piece.fit;
  if (!fit) {
    return (
      <div class="subbox">
        <div class="subbox-title">Fit</div>
        <p class="hint">{piece.analyzing ? 'Analysing…' : 'No analysis yet.'}</p>
      </div>
    );
  }
  const s = fit.stats;
  const c = clearance.value;
  if (s.count === 0) {
    return (
      <div class="subbox">
        <div class="subbox-title">Fit</div>
        <p class="hint">
          No part of this piece faces the body within 12 cm. Move it closer or check its orientation.
        </p>
      </div>
    );
  }
  const verdict =
    s.intersecting > 0.05
      ? { text: 'Intersects the body', cls: 'bad' }
      : s.intersecting > 0 || s.tight > 0.1
        ? { text: 'Too tight in places', cls: 'warn' }
        : s.loose > 0.5
          ? { text: 'Loose', cls: 'info' }
          : { text: 'Good fit', cls: 'good' };
  return (
    <div class="subbox">
      <div class="subbox-title">Fit {piece.analyzing && <span class="spinner inline" />}</div>
      <div class={`verdict ${verdict.cls}`}>{verdict.text}</div>
      <div class="stats-grid">
        <span>Closest</span>
        <strong>{s.min.toFixed(1)} mm</strong>
        <span>Typical gap</span>
        <strong>{s.median.toFixed(1)} mm</strong>
        <span>Uniformity</span>
        <strong>± {s.std.toFixed(1)} mm</strong>
        <span>Target</span>
        <strong>
          {c.min}–{c.max} mm (ideal {c.target})
        </strong>
      </div>
      <div class="bands" aria-label="Share of the inner surface in each fit band">
        {s.intersecting > 0 && <span class="b-inter" style={{ width: pct(s.intersecting) }} />}
        {s.tight > 0 && <span class="b-tight" style={{ width: pct(s.tight) }} />}
        {s.good > 0 && <span class="b-good" style={{ width: pct(s.good) }} />}
        {s.loose > 0 && <span class="b-loose" style={{ width: pct(s.loose) }} />}
      </div>
      <div class="bands-legend">
        <span>
          <i class="b-inter" /> inside {pct(s.intersecting)}
        </span>
        <span>
          <i class="b-tight" /> tight {pct(s.tight)}
        </span>
        <span>
          <i class="b-good" /> good {pct(s.good)}
        </span>
        <span>
          <i class="b-loose" /> loose {pct(s.loose)}
        </span>
      </div>
      <div class="subbox-title">Covers</div>
      <ul class="tally">
        {fit.tally.map((r) => (
          <li>
            <span class="tally-bar" style={{ width: pct(r.fraction) }} />
            <span class="tally-label">
              {pct(r.fraction)} {r.label}
            </span>
          </li>
        ))}
      </ul>
      {fit.driving.length > 0 && (
        <p class="hint">
          Sized by: {fit.driving.map((k) => measurementInfo(k).label.toLowerCase()).join(', ')}.
        </p>
      )}
    </div>
  );
}

export function HeatmapLegend() {
  const placed = pieces.value.some((p) => p.placement);
  if (!view.showHeatmap.value || !placed) return null;
  const stops = legendStops(clearance.value);
  const gradient = `linear-gradient(to right, ${stops.map((s) => s.color).join(', ')})`;
  return (
    <div class="legend" aria-label="Clearance colour legend">
      <div class="legend-title">Gap to body (mm)</div>
      <div class="legend-bar" style={{ background: gradient }} />
      <div class="legend-labels">
        {stops.map((s) => (
          <span>{s.label}</span>
        ))}
      </div>
    </div>
  );
}

function Settings() {
  const c = clearanceBase.value;
  const eff = clearance.value;
  const set = (patch: Partial<typeof c>) => (clearanceBase.value = { ...c, ...patch });
  return (
    <div class="subbox">
      <div class="subbox-title">Clearance targets</div>
      <Slider
        label="Minimum"
        value={c.min}
        min={0}
        max={15}
        step={0.5}
        unit=" mm"
        onInput={(v) => set({ min: v })}
      />
      <Slider
        label="Target"
        value={c.target}
        min={Math.max(c.min, 1)}
        max={30}
        step={0.5}
        unit=" mm"
        onInput={(v) => set({ target: v })}
      />
      <Slider
        label="Too loose"
        value={c.max}
        min={c.target + 2}
        max={60}
        step={1}
        unit=" mm"
        onInput={(v) => set({ max: v })}
      />
      {eff.target !== c.target && (
        <p class="hint">
          Including the undergarment allowance: minimum {eff.min} mm, target {eff.target} mm, loose above{' '}
          {eff.max} mm.
        </p>
      )}
      <label class="toggle">
        <input
          type="checkbox"
          checked={view.showHeatmap.value}
          onChange={(e) => (view.showHeatmap.value = (e.target as HTMLInputElement).checked)}
        />
        Clearance heatmap
      </label>
      <Slider
        label="Armor opacity"
        value={Math.round(view.armorOpacity.value * 100)}
        min={15}
        max={100}
        step={1}
        unit=" %"
        onInput={(v) => (view.armorOpacity.value = v / 100)}
      />
    </div>
  );
}

export function FitPanel({ controller }: { controller: AppController }) {
  const piece = selectedPiece.value;
  const placed = pieces.value.filter((p) => p.placement);
  return (
    <section class="panel-section" aria-labelledby="fit-title">
      <h2 id="fit-title">Fit</h2>
      {placed.length === 0 && (
        <p class="hint">
          Nothing on the body yet. Add pieces in the{' '}
          <button type="button" class="linklike" onClick={() => (view.tab.value = 'armor')}>
            Armor
          </button>{' '}
          tab and drag them onto the mannequin.
        </p>
      )}
      {placed.length > 0 && (
        <div class="row wrap gap">
          {placed.map((p) => (
            <button
              type="button"
              class={`chip pick ${p.id === selectedId.value ? 'active' : ''}`}
              onClick={() => (selectedId.value = p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
      {piece?.placement ? (
        <>
          <FitResults piece={piece} />
          <PlacementControls piece={piece} controller={controller} />
        </>
      ) : (
        placed.length > 0 && <p class="hint">Select a piece (tap it on the body) to adjust it.</p>
      )}
      <Settings />
    </section>
  );
}
