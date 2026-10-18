import { BODY_PARTS, bodyPart } from '../core/body/parts';
import { knownKeys } from '../core/measurements/profile';
import {
  MEASUREMENTS,
  measurementInfo,
  UNDERGARMENT_LABELS,
  type MeasurementGroup,
  type MeasurementInfo,
  type Undergarment,
} from '../core/measurements/schema';
import { pieceType } from '../core/pieces/types';
import { fromMm, toMm } from '../core/units';
import {
  activeRuler,
  body,
  measurementActions as act,
  profile,
  toast,
  toggleRuler,
  view,
  visibleMeasurements,
} from '../state/store';
import { Button, download, HelpTip, NumberField, pickFiles, Segmented } from './controls';

const GROUP_ORDER: MeasurementGroup[] = ['Overall', 'Head & neck', 'Torso', 'Arms', 'Hands', 'Legs & feet'];

function RulerIcon() {
  return (
    <svg viewBox="0 0 20 20" width="16" height="16" aria-hidden="true">
      <rect
        x="1.5"
        y="6"
        width="17"
        height="8"
        rx="1.5"
        fill="none"
        stroke="currentColor"
        stroke-width="1.5"
      />
      <path d="M5.5 6v3M9 6v4.5M12.5 6v3M16 6v4.5" stroke="currentColor" stroke-width="1.3" />
    </svg>
  );
}

function holdWhileAdjusting(): void {
  view.adjusting.value = true;
  const done = () => {
    view.adjusting.value = false;
    for (const type of ['pointerup', 'pointercancel', 'blur']) window.removeEventListener(type, done);
  };
  for (const type of ['pointerup', 'pointercancel', 'blur']) window.addEventListener(type, done);
}

function Field({ info }: { info: MeasurementInfo }) {
  const p = profile.value;
  const key = info.key;
  const unit = p.displayUnit;
  const decimals = unit === 'cm' ? 1 : 2;
  const value = p.values[key];
  const isUser = knownKeys(p).includes(key);
  const outOfRange = value < info.min || value > info.max;
  const measured = body.measured.value[key];
  const mismatch =
    body.status.value === 'ready' &&
    measured !== undefined &&
    isUser &&
    Math.abs(measured - value) > Math.max(5, value * 0.02)
      ? measured
      : null;
  const pinned = view.rulers.value.includes(key);
  const id = `m-${key}`;
  return (
    <div
      class={`field ${isUser ? 'user' : 'estimated'} ${activeRuler.value === key ? 'active' : ''}`}
      onPointerEnter={() => (view.hoverRuler.value = key)}
      onPointerLeave={() => {
        if (view.hoverRuler.peek() === key) view.hoverRuler.value = null;
      }}
      onFocusIn={() => (view.focusRuler.value = key)}
      onFocusOut={() => {
        if (view.focusRuler.peek() === key) view.focusRuler.value = null;
      }}
    >
      <div class="field-head">
        <label for={id}>
          {info.label}
          <HelpTip text={info.howTo} />
        </label>
        {isUser ? (
          <button
            type="button"
            class="chip reset"
            title="Forget this value and estimate it again"
            onClick={() => act.clear(key)}
          >
            yours ✕
          </button>
        ) : (
          <span class="chip muted" title="Estimated from body-survey data (ANSUR II)">
            est.
          </span>
        )}
        <button
          type="button"
          class={`ruler-btn ${pinned ? 'on' : ''}`}
          aria-pressed={pinned}
          aria-label={`Ruler for ${info.label.toLowerCase()}`}
          title={pinned ? 'Hide this ruler on the mannequin' : 'Keep this ruler on the mannequin'}
          onClick={() => toggleRuler(key)}
        >
          <RulerIcon />
        </button>
      </div>
      <div class="field-input">
        <input
          type="range"
          class="measure-range"
          min={fromMm(info.min, unit)}
          max={fromMm(info.max, unit)}
          step={unit === 'cm' ? 0.1 : 0.05}
          value={fromMm(value, unit)}
          aria-label={`${info.label} slider`}
          onPointerDown={holdWhileAdjusting}
          onInput={(e) => act.set(key, toMm(parseFloat((e.target as HTMLInputElement).value), unit))}
        />
        <NumberField
          id={id}
          value={fromMm(value, unit)}
          decimals={decimals}
          step={unit === 'cm' ? 0.5 : 0.25}
          invalid={outOfRange}
          onCommit={(v) => act.set(key, toMm(v, unit))}
        />
        <span class="unit">{unit}</span>
      </div>
      {outOfRange && <div class="field-note warn">Unusual value — please double-check.</div>}
      {mismatch !== null && (
        <div class="field-note warn">
          Mannequin reaches {fromMm(mismatch, unit).toFixed(decimals)} {unit} (limit of the body model).
        </div>
      )}
    </div>
  );
}

function PartPicker() {
  const part = view.part.value;
  return (
    <div class="part-picker">
      <span class="inline-label" id="part-label">
        What are you fitting?
      </span>
      <div class="chips" role="radiogroup" aria-labelledby="part-label">
        {BODY_PARTS.map((b) => (
          <button
            type="button"
            role="radio"
            aria-checked={b.id === part}
            class={`chip pick ${b.id === part ? 'active' : ''}`}
            title={
              b.id === 'full'
                ? 'Every measurement and the whole mannequin'
                : b.pieces.map((t) => pieceType(t).label).join(', ')
            }
            onClick={() => (view.part.value = b.id)}
          >
            {b.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function RulerBar() {
  const visible = visibleMeasurements.value;
  const pinned = view.rulers.value;
  const all = visible.every((k) => pinned.includes(k));
  return (
    <div class="row wrap gap ruler-bar">
      <Button
        class="small"
        aria-pressed={all}
        onClick={() =>
          (view.rulers.value = all
            ? pinned.filter((k) => !visible.includes(k))
            : [...pinned, ...visible.filter((k) => !pinned.includes(k))])
        }
      >
        <RulerIcon /> {all ? 'Hide rulers' : 'Show all rulers'}
      </Button>
      <span class="hint">Hover over or drag a measurement to see it on the mannequin.</span>
    </div>
  );
}

export function MeasurementsPanel() {
  const p = profile.value;
  const part = view.part.value;
  const focused = part !== 'full';
  const quick = !focused && p.mode === 'quick';
  const groups = focused
    ? [{ g: bodyPart(part).label, items: visibleMeasurements.value.map(measurementInfo) }]
    : quick
      ? [{ g: 'Quick', items: visibleMeasurements.value.map(measurementInfo) }]
      : GROUP_ORDER.map((g) => ({ g, items: MEASUREMENTS.filter((m) => m.group === g) }));

  const onImport = async () => {
    const [file] = await pickFiles('.json,application/json');
    if (!file) return;
    try {
      act.importJson(await file.text());
      toast('Measurements loaded.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not read that file.', 'error');
    }
  };

  return (
    <section class="panel-section" aria-labelledby="measure-title">
      <h2 id="measure-title">Your measurements</h2>
      <PartPicker />
      <div class="row wrap gap">
        {!focused && (
          <Segmented
            label="Measurement mode"
            value={p.mode}
            onChange={(m) => act.setMode(m)}
            options={[
              { value: 'quick', label: 'Quick', title: '4 measurements, the rest estimated' },
              { value: 'detailed', label: 'Detailed', title: 'Every measurement' },
            ]}
          />
        )}
        <Segmented
          label="Units"
          value={p.displayUnit}
          onChange={(u) => act.setUnit(u)}
          options={[
            { value: 'cm', label: 'cm' },
            { value: 'in', label: 'in' },
          ]}
        />
      </div>
      <div class="row wrap gap">
        <label class="inline-label" id="preset-label">
          Body shape
        </label>
        <Segmented
          label="Body shape"
          size="sm"
          value={p.preset}
          onChange={(v) => act.setPreset(v)}
          options={[
            { value: 'neutral', label: 'Neutral', title: 'Inferred from your measurements' },
            { value: 'masculine', label: 'Masculine' },
            { value: 'feminine', label: 'Feminine' },
          ]}
        />
      </div>
      <div class="row wrap gap">
        <label class="inline-label" for="undergarment">
          Under the armor
        </label>
        <select
          id="undergarment"
          value={p.undergarment}
          onChange={(e) => act.setUndergarment((e.target as HTMLSelectElement).value as Undergarment)}
        >
          {Object.entries(UNDERGARMENT_LABELS).map(([k, label]) => (
            <option value={k}>{label}</option>
          ))}
        </select>
      </div>
      {focused && (
        <p class="hint">
          Only the measurements that size {bodyPart(part).noun} are shown; the rest of the body is estimated
          and hidden.{' '}
          <button type="button" class="linklike" onClick={() => (view.part.value = 'full')}>
            Show full body
          </button>
        </p>
      )}
      {quick && (
        <p class="hint">
          Enter these four; everything else is estimated from the ANSUR II body survey. Switch to{' '}
          <button type="button" class="linklike" onClick={() => act.setMode('detailed')}>
            Detailed
          </button>{' '}
          to adjust any measurement.
        </p>
      )}
      <RulerBar />
      {groups.map(({ g, items }) => (
        <fieldset class="group">
          {!quick && <legend>{g}</legend>}
          {items.map((info) => (
            <Field info={info} />
          ))}
        </fieldset>
      ))}
      <div class="row wrap gap actions">
        <Button onClick={onImport}>Import…</Button>
        <Button
          onClick={() => download('armorfit-measurements.json', act.exportJson(), 'application/json')}
          title="Save your measurements as a JSON file"
        >
          Export
        </Button>
        <Button
          variant="ghost"
          onClick={() => {
            if (confirm('Reset all measurements to the defaults?')) act.resetAll();
          }}
        >
          Reset
        </Button>
      </div>
    </section>
  );
}
