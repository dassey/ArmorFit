import { knownKeys } from '../core/measurements/profile';
import {
  MEASUREMENTS,
  UNDERGARMENT_LABELS,
  type MeasurementGroup,
  type MeasurementInfo,
  type Undergarment,
} from '../core/measurements/schema';
import { fromMm, toMm } from '../core/units';
import { body, measurementActions as act, profile, toast } from '../state/store';
import { Button, download, HelpTip, NumberField, pickFiles, Segmented } from './controls';

const GROUP_ORDER: MeasurementGroup[] = ['Overall', 'Head & neck', 'Torso', 'Arms', 'Hands', 'Legs & feet'];

function Field({ info }: { info: MeasurementInfo }) {
  const p = profile.value;
  const unit = p.displayUnit;
  const decimals = unit === 'cm' ? 1 : 2;
  const value = p.values[info.key];
  const isUser = knownKeys(p).includes(info.key);
  const outOfRange = value < info.min || value > info.max;
  const measured = body.measured.value[info.key];
  const mismatch =
    measured !== undefined && isUser && Math.abs(measured - value) > Math.max(5, value * 0.02)
      ? measured
      : null;
  const id = `m-${info.key}`;
  return (
    <div class={`field ${isUser ? 'user' : 'estimated'}`}>
      <label for={id}>
        {info.label}
        <HelpTip text={info.howTo} />
      </label>
      <div class="field-input">
        <NumberField
          id={id}
          value={fromMm(value, unit)}
          decimals={decimals}
          step={unit === 'cm' ? 0.5 : 0.25}
          invalid={outOfRange}
          onCommit={(v) => act.set(info.key, toMm(v, unit))}
        />
        <span class="unit">{unit}</span>
        {isUser ? (
          <button
            type="button"
            class="chip reset"
            title="Forget this value and estimate it again"
            onClick={() => act.clear(info.key)}
          >
            yours ✕
          </button>
        ) : (
          <span class="chip muted" title="Estimated from body-survey data (ANSUR II)">
            est.
          </span>
        )}
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

export function MeasurementsPanel() {
  const p = profile.value;
  const quick = p.mode === 'quick';
  const groups = quick
    ? [{ g: 'Quick' as const, items: MEASUREMENTS.filter((m) => m.quick) }]
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
      <div class="row wrap gap">
        <Segmented
          label="Measurement mode"
          value={p.mode}
          onChange={(m) => act.setMode(m)}
          options={[
            { value: 'quick', label: 'Quick', title: '4 measurements, the rest estimated' },
            { value: 'detailed', label: 'Detailed', title: 'Every measurement' },
          ]}
        />
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
      {quick && (
        <p class="hint">
          Enter these four; everything else is estimated from the ANSUR II body survey. Switch to{' '}
          <button type="button" class="linklike" onClick={() => act.setMode('detailed')}>
            Detailed
          </button>{' '}
          to adjust any measurement.
        </p>
      )}
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
