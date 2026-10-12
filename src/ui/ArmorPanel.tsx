import { useState } from 'preact/hooks';
import { PIECE_TYPES, pieceType, type PieceTypeId, type Side } from '../core/pieces/types';
import type { AppController } from '../state/controller';
import {
  importBusy,
  importProgress,
  needsAttention,
  pieces,
  selectedId,
  type PieceState,
} from '../state/pieces';
import { toast } from '../state/store';
import { view } from '../state/store';
import { Button, pickFiles } from './controls';

const ACCEPT = '.stl,.obj,.3mf';

function Badge({ kind, children }: { kind: 'warn' | 'info' | 'ok'; children: string }) {
  return <span class={`badge ${kind}`}>{children}</span>;
}

function TypeSelect({ piece, controller }: { piece: PieceState; controller: AppController }) {
  const value = piece.type ? `${piece.type}${piece.side ? `:${piece.side}` : ''}` : '';
  const options: { value: string; label: string }[] = [{ value: '', label: 'Unknown / other' }];
  for (const t of PIECE_TYPES) {
    if (t.sided) {
      options.push({ value: `${t.id}:L`, label: `${t.label} — left` });
      options.push({ value: `${t.id}:R`, label: `${t.label} — right` });
    } else options.push({ value: t.id, label: t.label });
  }
  return (
    <select
      aria-label="Piece type"
      value={value}
      onChange={(e) => {
        const v = (e.target as HTMLSelectElement).value;
        if (!v) controller.pieces!.setTypeSide(piece.id, null, null);
        else {
          const [type, side] = v.split(':');
          controller.pieces!.setTypeSide(piece.id, type as PieceTypeId, (side as Side) ?? null);
        }
      }}
    >
      {options.map((o) => (
        <option value={o.value}>{o.label}</option>
      ))}
    </select>
  );
}

function UnitsBox({ piece, controller }: { piece: PieceState; controller: AppController }) {
  const [choice, setChoice] = useState(piece.unitScale);
  return (
    <div class="subbox">
      <div class="subbox-title">Check units</div>
      <p class="hint">{piece.units.reason}</p>
      {piece.units.candidates.slice(0, 5).map((c) => (
        <label class="radio">
          <input
            type="radio"
            name={`units-${piece.id}`}
            checked={choice === c.scale}
            onChange={() => setChoice(c.scale)}
          />
          {c.label} — {Math.round(c.sizeMm)} mm across
        </label>
      ))}
      <Button variant="primary" onClick={() => controller.pieces!.setUnitScale(piece.id, choice)}>
        Use these units
      </Button>
    </div>
  );
}

function OrientationBox({ piece, controller }: { piece: PieceState; controller: AppController }) {
  const pm = controller.pieces!;
  const low = piece.orientation.confidence < 0.6 && !piece.orientationConfirmed;
  return (
    <div class="subbox">
      <div class="subbox-title">
        Orientation{' '}
        <span class="muted">
          ({piece.orientation.category}, {Math.round(piece.orientation.confidence * 100)}% sure)
        </span>
      </div>
      {low && <p class="hint">{piece.orientation.reasons.join(' ')}</p>}
      <p class="hint">The thumbnail shows the piece as worn (front view). Fix it if it looks wrong:</p>
      <div class="row wrap gap">
        <Button
          class="small"
          onClick={() => pm.rotateOrientation(piece.id, 'z', 90)}
          title="Rotate 90° in the view"
        >
          ⟳ 90°
        </Button>
        <Button
          class="small"
          onClick={() => pm.rotateOrientation(piece.id, 'y', 90)}
          title="Turn 90° around the vertical"
        >
          ↻ Turn
        </Button>
        <Button class="small" onClick={() => pm.rotateOrientation(piece.id, 'x', 90)} title="Tip forward 90°">
          ⤵ Tip
        </Button>
        <Button class="small" onClick={() => pm.rotateOrientation(piece.id, 'z', 180)} title="Upside down">
          ⇅ Flip
        </Button>
        {piece.orientation.category === 'shell' && (
          <Button class="small" onClick={() => pm.flipInsideOut(piece.id)} title="Other side faces the body">
            ◐ Inside/out
          </Button>
        )}
      </div>
    </div>
  );
}

function groupSize(piece: PieceState): number {
  return pieces.value.filter((p) => p.group === piece.group).length;
}

function PieceCard({ piece, controller }: { piece: PieceState; controller: AppController }) {
  const selected = selectedId.value === piece.id;
  const attention = needsAttention(piece);
  const pm = controller.pieces!;
  const typeLabel = piece.type ? pieceType(piece.type).label : 'Unknown type';
  return (
    <li class={`piece-card ${selected ? 'selected' : ''}`}>
      <div class="piece-head" onClick={() => (selectedId.value = piece.id)}>
        <div
          class="thumb"
          title="Drag onto the mannequin"
          onPointerDown={(e) => {
            if (e.button > 0) return;
            e.preventDefault();
            selectedId.value = piece.id;
            controller.beginTrayDrag(piece.id, e as unknown as PointerEvent);
          }}
        >
          {piece.thumbnail ? (
            <img src={piece.thumbnail} alt="" draggable={false} />
          ) : (
            <span class="spinner" />
          )}
          {!piece.placement && <span class="drag-hint">drag</span>}
        </div>
        <div class="piece-info">
          <div class="piece-name" title={piece.fileName}>
            {piece.name}
          </div>
          <div class="piece-sub">
            {typeLabel}
            {piece.side ? ` · ${piece.side === 'L' ? 'left' : 'right'}` : ''} ·{' '}
            {piece.fullTriangles.toLocaleString()} tris
          </div>
          <div class="badges">
            {piece.placement ? <Badge kind="ok">on body</Badge> : <Badge kind="info">in tray</Badge>}
            {attention.includes('units') && <Badge kind="warn">check units</Badge>}
            {attention.includes('orientation') && <Badge kind="warn">check orientation</Badge>}
            {attention.includes('mesh') && <Badge kind="warn">not watertight</Badge>}
            {piece.mirrored && <Badge kind="info">mirrored</Badge>}
            {piece.group && <Badge kind="info">{`set of ${groupSize(piece)}`}</Badge>}
          </div>
        </div>
      </div>
      {selected && (
        <div class="piece-details">
          <div class="row wrap gap">
            {piece.placement ? (
              <Button onClick={() => pm.unplace(piece.id)}>Take off</Button>
            ) : (
              <Button variant="primary" onClick={() => pm.placeHome(piece.id)}>
                Put on body
              </Button>
            )}
            {piece.placement && (
              <Button onClick={() => (view.tab.value = 'fit')} title="Adjust and check the fit">
                Fit…
              </Button>
            )}
            <Button variant="ghost" onClick={() => pm.remove(piece.id)} title="Remove from the project">
              Delete
            </Button>
            {piece.group && (
              <Button
                variant="ghost"
                onClick={() => pm.ungroup(piece.id)}
                title="Move and size this part on its own"
              >
                Separate from set
              </Button>
            )}
          </div>
          {piece.group && (
            <p class="hint">Part of a set of {groupSize(piece)} parts that move and size together.</p>
          )}
          <label class="field-row">
            <span>Type</span>
            <TypeSelect piece={piece} controller={controller} />
          </label>
          {attention.includes('units') && <UnitsBox piece={piece} controller={controller} />}
          <OrientationBox piece={piece} controller={controller} />
          {piece.warnings.map((w) => (
            <p class="hint warn-text">{w}</p>
          ))}
        </div>
      )}
    </li>
  );
}

export function ArmorPanel({ controller }: { controller: AppController }) {
  const list = pieces.value;
  const unplaced = list.filter((p) => !p.placement).length;
  const placed = list.length - unplaced;
  const [sizing, setSizing] = useState(false);
  const browse = async () => {
    const files = await pickFiles(ACCEPT, true);
    if (files.length) await controller.pieces?.importFiles(files);
  };
  return (
    <section class="panel-section" aria-labelledby="armor-title">
      <h2 id="armor-title">Armor pieces</h2>
      <div
        class="dropzone"
        onClick={browse}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            void browse();
          }
        }}
        role="button"
        tabIndex={0}
      >
        <strong>Drop STL, OBJ or 3MF files</strong>
        <span>or click to browse — files stay on your device</span>
      </div>
      <div class="row wrap gap">
        <Button onClick={() => controller.pieces?.loadDemos()}>Load demo armor</Button>
        {unplaced > 0 && (
          <Button
            variant="primary"
            onClick={() => {
              const n = controller.pieces?.placeAll() ?? 0;
              if (!n) toast('Set the piece types first, or drag pieces onto the mannequin.', 'error');
            }}
          >
            Put all on body
          </Button>
        )}
        {placed > 1 && (
          <Button
            disabled={sizing}
            onClick={async () => {
              setSizing(true);
              try {
                const n = await controller.analysis?.autoSizeAll();
                toast(`Auto-sized ${n ?? 0} pieces and sets.`);
              } finally {
                setSizing(false);
              }
            }}
            title="Auto-size every piece on the body (sets of parts are sized together)"
          >
            {sizing ? 'Sizing…' : 'Auto-size all'}
          </Button>
        )}
        {importBusy.value > 0 && (
          <span class="row gap muted" role="status">
            <span class="spinner" />{' '}
            {importProgress.value.total > 1
              ? `Processing ${importProgress.value.done} of ${importProgress.value.total} files…`
              : 'Processing…'}
          </span>
        )}
      </div>
      {list.length === 0 ? (
        <p class="hint">
          No pieces yet. Add your armor files (any designer, any unit), or load the demo set to try things
          out. Then drag a thumbnail onto the mannequin, or select it and press “Put on body”.
        </p>
      ) : (
        <ul class="piece-list">
          {list.map((p) => (
            <PieceCard key={p.id} piece={p} controller={controller} />
          ))}
        </ul>
      )}
    </section>
  );
}
