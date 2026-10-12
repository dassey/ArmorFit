import type { ButtonHTMLAttributes, ComponentChildren } from 'preact';
import { useEffect, useRef, useState } from 'preact/hooks';

export function Segmented<T extends string>(props: {
  value: T;
  options: { value: T; label: string; title?: string }[];
  onChange: (v: T) => void;
  label?: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div class={`segmented ${props.size ?? 'md'}`} role="radiogroup" aria-label={props.label}>
      {props.options.map((o) => (
        <button
          type="button"
          role="radio"
          aria-checked={o.value === props.value}
          class={o.value === props.value ? 'active' : ''}
          title={o.title}
          onClick={() => props.onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function NumberField(props: {
  id: string;
  value: number;
  decimals: number;
  step: number;
  onCommit: (v: number) => void;
  invalid?: boolean;
  ariaLabel?: string;
}) {
  const fmt = (v: number) => (Number.isFinite(v) ? v.toFixed(props.decimals) : '');
  const [text, setText] = useState(fmt(props.value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(props.value));
  }, [props.value, props.decimals]);
  const commit = (raw: string) => {
    const v = parseFloat(raw.replace(',', '.'));
    if (Number.isFinite(v) && v > 0 && Math.abs(v - props.value) > 1e-9) props.onCommit(v);
    else setText(fmt(props.value));
  };
  return (
    <input
      id={props.id}
      class={`num ${props.invalid ? 'invalid' : ''}`}
      type="number"
      inputMode="decimal"
      step={props.step}
      value={text}
      aria-label={props.ariaLabel}
      onFocus={() => (focused.current = true)}
      onBlur={(e) => {
        focused.current = false;
        commit((e.target as HTMLInputElement).value);
      }}
      onInput={(e) => {
        const t = (e.target as HTMLInputElement).value;
        setText(t);
        if (
          (e as InputEvent).inputType === undefined ||
          (e as InputEvent).inputType === 'insertReplacementText'
        ) {
          commit(t);
        }
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
        if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
          const cur = parseFloat((e.target as HTMLInputElement).value) || props.value;
          const next = cur + (e.key === 'ArrowUp' ? props.step : -props.step);
          e.preventDefault();
          setText(fmt(next));
          props.onCommit(next);
        }
      }}
    />
  );
}

export function HelpTip(props: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span class="help">
      <button
        type="button"
        class="help-btn"
        aria-label="How to measure"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        ?
      </button>
      {open && (
        <span class="help-pop" role="tooltip" onClick={() => setOpen(false)}>
          {props.text}
        </span>
      )}
    </span>
  );
}

export function Button(
  props: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: 'primary' | 'ghost' | 'danger';
    children?: ComponentChildren;
  },
) {
  const { variant, class: cls, ...rest } = props;
  return <button type="button" class={`btn ${variant ?? ''} ${cls ?? ''}`} {...rest} />;
}

export function download(
  name: string,
  data: string | ArrayBuffer | ArrayBufferView,
  type = 'application/octet-stream',
): void {
  const url = URL.createObjectURL(new Blob([data as BlobPart], { type }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.multiple = multiple;
    input.onchange = () => resolve(Array.from(input.files ?? []));
    input.click();
  });
}
