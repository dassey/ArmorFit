import { useEffect, useRef } from 'preact/hooks';
import { Viewport } from '../engine/Viewport';
import type { AppController } from '../state/controller';
import { body, view, type Tab } from '../state/store';
import { ArmorPanel } from './ArmorPanel';
import { FitPanel, HeatmapLegend } from './FitPanel';
import { MeasurementsPanel } from './MeasurementsPanel';
import { PrintPanel } from './PrintPanel';

const TABS: { id: Tab; label: string }[] = [
  { id: 'body', label: 'Body' },
  { id: 'armor', label: 'Armor' },
  { id: 'fit', label: 'Fit' },
  { id: 'print', label: 'Print' },
];

function StatusBadge() {
  const s = body.status.value;
  if (s === 'ready') return null;
  const text = s === 'loading' ? 'Loading mannequin…' : s === 'solving' ? 'Fitting mannequin…' : 'Error';
  return (
    <div class={`status-badge ${s}`} role="status" aria-live="polite">
      {s !== 'error' && <span class="spinner" aria-hidden="true" />}
      {s === 'error' ? `Mannequin error: ${body.error.value}` : text}
    </div>
  );
}

function ViewportOverlay({ viewport }: { viewport: () => Viewport | null }) {
  return (
    <div class="vp-overlay">
      <StatusBadge />
      <HeatmapLegend />
      <div class="vp-tools">
        <label class="toggle">
          <input
            type="checkbox"
            checked={view.showRegions.value}
            onChange={(e) => (view.showRegions.value = (e.target as HTMLInputElement).checked)}
          />
          Regions
        </label>
        <button
          type="button"
          class="btn small"
          onClick={() => viewport()?.frameBody()}
          title="Reset the camera"
        >
          ⟲ View
        </button>
      </div>
    </div>
  );
}

function Toasts() {
  return (
    <div class="toasts" aria-live="polite">
      {view.toasts.value.map((t) => (
        <div key={t.id} class={`toast ${t.kind}`}>
          {t.text}
        </div>
      ))}
    </div>
  );
}

export function App({ controller }: { controller: AppController }) {
  const vpRef = useRef<HTMLDivElement>(null);
  const viewportRef = useRef<Viewport | null>(null);

  useEffect(() => {
    const vp = new Viewport(vpRef.current!);
    viewportRef.current = vp;
    controller.attachViewport(vp);
    void controller.start();
    const over = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes('Files')) {
        e.preventDefault();
        document.body.classList.add('dropping');
      }
    };
    const leave = (e: DragEvent) => {
      if (!e.relatedTarget) document.body.classList.remove('dropping');
    };
    const drop = (e: DragEvent) => {
      document.body.classList.remove('dropping');
      const files = Array.from(e.dataTransfer?.files ?? []);
      if (!files.length) return;
      e.preventDefault();
      view.tab.value = 'armor';
      void controller.pieces?.importFiles(files);
    };
    window.addEventListener('dragover', over);
    window.addEventListener('dragleave', leave);
    window.addEventListener('drop', drop);
    return () => {
      window.removeEventListener('dragover', over);
      window.removeEventListener('dragleave', leave);
      window.removeEventListener('drop', drop);
      vp.dispose();
    };
  }, []);

  const tab = view.tab.value;
  return (
    <div class="app">
      <header class="topbar">
        <div class="brand">
          <img src="./favicon.svg" alt="" width="26" height="26" />
          <span>ArmorFit</span>
        </div>
        <span class="tagline">Fit 3D-printable armor to your body</span>
        <a class="gh" href="https://github.com/dassey/ArmorFit" target="_blank" rel="noreferrer">
          Source
        </a>
      </header>
      <main class="workspace">
        <div class="viewport" ref={vpRef}>
          <ViewportOverlay viewport={() => viewportRef.current} />
        </div>
        <aside class="sidebar">
          <nav class="tabs" role="tablist" aria-label="Panels">
            {TABS.map((t) => (
              <button
                type="button"
                role="tab"
                aria-selected={tab === t.id}
                class={tab === t.id ? 'active' : ''}
                onClick={() => (view.tab.value = t.id)}
              >
                {t.label}
              </button>
            ))}
          </nav>
          <div class="tab-body" role="tabpanel">
            {tab === 'body' && <MeasurementsPanel />}
            {tab === 'armor' && <ArmorPanel controller={controller} />}
            {tab === 'fit' && <FitPanel controller={controller} />}
            {tab === 'print' && <PrintPanel controller={controller} />}
          </div>
          <footer class="credits">
            Mannequin: MakeHuman (CC0). Body statistics: ANSUR II (US Army, public release).
          </footer>
        </aside>
      </main>
      <Toasts />
    </div>
  );
}
