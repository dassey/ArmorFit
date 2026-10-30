import { useEffect, useRef, useState } from 'preact/hooks';
import { DUMMY_PRESETS } from '../core/body/dummyStyle';
import { dummyActions, dummyStyle } from '../state/store';

const PRESET_IDS = Object.keys(DUMMY_PRESETS) as (keyof typeof DUMMY_PRESETS)[];

function Swatch({ body, trim }: { body: string; trim: string }) {
  return (
    <svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">
      <circle cx="10" cy="10" r="9" fill={body} stroke={trim} stroke-width="1.5" />
      <path d={`M10 10V2a8 8 0 0 1 8 8zM10 10v8a8 8 0 0 1-8-8z`} fill={trim} />
    </svg>
  );
}

/** "Make your own dummy": presets, colours and details of the mannequin's look. */
export function DummyPanel() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const s = dummyStyle.value;
  useEffect(() => {
    if (!open) return;
    const away = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('pointerdown', away);
    window.addEventListener('keydown', esc);
    return () => {
      window.removeEventListener('pointerdown', away);
      window.removeEventListener('keydown', esc);
    };
  }, [open]);
  const toggle = (key: 'markers' | 'seams' | 'visor' | 'lines', label: string) => (
    <label class="toggle">
      <input
        type="checkbox"
        checked={s[key]}
        onChange={(e) => dummyActions.change({ [key]: (e.target as HTMLInputElement).checked })}
      />
      {label}
    </label>
  );
  return (
    <div class="dummy" ref={ref}>
      <button
        type="button"
        class="btn small"
        aria-expanded={open}
        aria-controls="dummy-pop"
        title="Change how the mannequin looks"
        onClick={() => setOpen(!open)}
      >
        <Swatch body={s.body} trim={s.trim} /> Dummy
      </button>
      {open && (
        <div id="dummy-pop" class="dummy-pop" role="dialog" aria-label="Make your own dummy">
          <strong>Make your own dummy</strong>
          <div class="dummy-presets" role="radiogroup" aria-label="Dummy style">
            {PRESET_IDS.map((id) => (
              <button
                type="button"
                role="radio"
                aria-checked={s.preset === id}
                class={`dummy-preset ${s.preset === id ? 'active' : ''}`}
                onClick={() => dummyActions.preset(id)}
              >
                <Swatch body={DUMMY_PRESETS[id].body} trim={DUMMY_PRESETS[id].trim} />
                {DUMMY_PRESETS[id].label}
              </button>
            ))}
          </div>
          <div class="dummy-colors">
            <label>
              <input
                type="color"
                value={s.body}
                onInput={(e) => dummyActions.change({ body: (e.target as HTMLInputElement).value })}
              />
              Body
            </label>
            <label>
              <input
                type="color"
                value={s.trim}
                onInput={(e) => dummyActions.change({ trim: (e.target as HTMLInputElement).value })}
              />
              Details
            </label>
            {s.preset === 'custom' && <span class="chip muted">custom</span>}
          </div>
          <div class="dummy-toggles">
            {toggle('markers', 'Target markers')}
            {toggle('seams', 'Joint seams')}
            {toggle('visor', 'Face visor')}
            {toggle('lines', 'Contour lines')}
          </div>
          <label class="dummy-gloss">
            Matte
            <input
              type="range"
              min="0"
              max="1"
              step="0.05"
              value={s.gloss}
              aria-label="Gloss"
              onInput={(e) =>
                dummyActions.change({ gloss: parseFloat((e.target as HTMLInputElement).value) })
              }
            />
            Glossy
          </label>
          <p class="hint">Only changes the look. Sizes and fit always use your true body shape.</p>
        </div>
      )}
    </div>
  );
}
