# ArmorFit — implementation plan

Free, open-source, browser-only tool: upload 3D-printable armor (STL / OBJ /
3MF), fit it to a mannequin built from your measurements, check the fit, and
export print-ready files. Methodology and sources: [`docs/RESEARCH.md`](docs/RESEARCH.md).

## Constraints

- 100 % client-side; static hosting (GitHub Pages / Cloudflare Pages). No server,
  no accounts, files never leave the device.
- Heavy work (parsing, repair, BVH, analysis, sizing, export) runs in Web
  Workers; the UI thread only renders and handles input.
- Desktop and mobile (touch: one-finger drag, two-finger twist, pinch zoom).
- Pieces up to 500k triangles: BVH acceleration, decimated preview meshes,
  full resolution only for export.

## Methodology in one paragraph

The mannequin is the CC0 MakeHuman **hm08** mesh, morphed with CC0 targets
whose weights are solved (least squares) to match the user's measurements;
quick mode estimates missing measurements with **ANSUR II** regressions.
Every mannequin vertex carries an anatomical region label. Uploaded pieces are
welded, checked, unit-guessed and auto-oriented (sphere fit + opening rays +
PCA + file-name keywords). Dragging uses pointer **ray casts**; fit analysis
uses **closest-point distance queries** (BVH) for clearance, penetration and
region tally. Auto-sizing solves per-axis scale by Gauss–Newton on those
clearances. Export bakes transforms into STL / 3MF plus a sizing report.

## Architecture

```
┌──────────────────────────── main thread ────────────────────────────┐
│  ui/ (Preact components)  ◄──signals──►  state/ (store + actions)    │
│        │                                     │        ▲             │
│        ▼                                     ▼        │ results     │
│  engine/ (three.js: Viewport, MannequinView, PieceView, Drag, Gestures)
└───────────────┬──────────────────────────────┬──────────────────────┘
                │ typed RPC (workers/rpc.ts)   │
   ┌────────────▼─────────────┐   ┌────────────▼──────────────┐
   │ geometry.worker          │   │ fit.worker                 │
   │  parse STL/OBJ/3MF        │   │  body asset + morph/solve  │
   │  weld, repair, stats      │   │  body BVH                  │
   │  unit guess, orientation  │   │  clearance, region tally   │
   │  decimate preview         │   │  heatmap values            │
   │  export STL/3MF (full res)│   │  auto-size optimiser       │
   └────────────┬─────────────┘   └────────────┬──────────────┘
                └──────────── core/ (pure TS) ─┘
     math · mesh · io · body · measurements · pieces · fit · print · export
```

### Module boundaries

| Layer            | May import                                                                 | Must not import          | Tested by             |
| ---------------- | -------------------------------------------------------------------------- | ------------------------ | --------------------- |
| `src/core/**`    | `three` math/geometry classes, `three-mesh-bvh`, `fflate`, `meshoptimizer` | DOM, renderer, UI, state | Vitest (Node)         |
| `src/workers/**` | `core`                                                                     | DOM, UI, state           | Vitest via core + e2e |
| `src/engine/**`  | `three`, `core` (types + light math)                                       | UI components            | e2e / manual          |
| `src/state/**`   | `core`, `@preact/signals`                                                  | `engine`, components     | Vitest                |
| `src/ui/**`      | `state`, `engine` (via a small facade), `core` types                       | —                        | e2e / manual          |

Geometry buffers never live in reactive state: the store holds ids and
metadata; typed arrays live in a `GeometryStore` (main thread: preview meshes)
and in the workers (full-res meshes, BVHs).

### File structure

```
scripts/
  build-body.mjs          MakeHuman CC0 data → public/assets/body/hm08.armorfit.bin.gz
  build-anthro.mjs        ANSUR II CSVs → src/core/measurements/ansur-model.json
  lib/makehuman.mjs       pinned MakeHuman data source, OBJ / target parsers
public/assets/body/       generated mannequin asset (committed)
src/
  core/
    units.ts              mm ⇄ cm/in, formatting
    math/                 linalg (eigen, solve, least squares), fitting (PCA, sphere, circle, cylinder), rng
    mesh/                 MeshData, weld, compact, normals, topology (manifold checks, loops, winding), sampling, decimate
    geometry/             BVH helpers, ray distance, Fibonacci directions
    io/                   STL (read/write), OBJ (read), 3MF (read/write, p:path), dispatch
    measurements/         schema, ANSUR II estimation, profiles (persistence, JSON import/export)
    body/                 asset format, morph engine, tape loops & landmarks, solver, pose, skeleton, regions
    pieces/               piece types, file-name classifier, unit guess, auto-orientation, prepare pipeline
    fit/                  body query (BVH), clearance, region tally, placement & home anchors, settle, auto-size, heatmap
    print/                printer presets, build-volume check
    export/               transform baking, sizing report, project file
    testmeshes/           procedural helmet / chest plate / pauldron / forearm tube
  workers/                rpc.ts, geometry.worker.ts, fit.worker.ts
  engine/                 Viewport (scene, camera, lights), PieceView, Interaction (drag, twist, touch)
  state/                  store (signals), pieces, pieceManager (placement actions), analysis, controller, project
  ui/                     App, MeasurementsPanel, ArmorPanel, FitPanel, PrintPanel, controls
  main.tsx, styles.css, version.ts
docs/RESEARCH.md
```

## Data model

```ts
// all lengths in millimetres
MeasurementProfile  = { values: Record<MeasurementKey, number>,   // 22 fields (core/measurements/schema.ts)
                        userSet: key[], mode: 'quick'|'detailed',
                        preset: 'neutral'|'masculine'|'feminine',
                        displayUnit: 'cm'|'in', undergarment: 'none'|'bodysuit'|'foam' }
ClearanceSettings   = { min, target, max }                         // + undergarment allowance
PieceState = {
  id, name, fileName, fileHash,                // SHA-256 prefix of the source file
  type: PieceTypeId | null, side: 'L'|'R'|null,
  unitScale, unitConfirmed,                    // file units → mm
  orientation: { matrix, confidence, category: 'shell'|'tube'|'cap', … },  // mm file frame → wearing frame
  topology: { triangles, watertight, boundaryEdges, nonManifoldEdges, components, … },
  placement: null
    | { kind: 'surface', face, bary: [u, v, w], twist, offset }    // body-surface anchor
    | { kind: 'bone', bone, t, twist, offset },                    // limb / head anchor
  scale: [sx, sy, sz], mirrored, sourceId?,    // mirrored copies share their source's mesh
  fit?: { stats, tally, driving measurements }
}
ProjectFile (JSON, versioned) = measurements + settings + pieces without meshes
                                (re-attached by file hash, name as tie-break)
```

### Coordinate frames

`file units` →(unitScale)→ `file mm` →(orientation)→ **wearing frame** (Y up,
Z the wearer's front, X the wearer's left, origin at the contact point) →
(scale, mirror)→ →(placement: anchor frame on the body)→ **world** (mannequin
space, mm, feet at y = 0, facing +Z). Exports convert Y-up → Z-up for slicers.

## Data flow

1. **Measurements → mannequin.** Edit → `estimate()` fills non-user fields →
   (coalesced) `fit.worker.buildBody(profile)` solves morph weights, rebuilds
   positions/normals/BVH → main thread updates the mannequin buffer in place →
   placements are re-resolved from their anchors → fits recomputed.
2. **Upload.** Files → `geometry.worker.importFile(name, buffer)` → parse → weld → repair
   winding → topology report → unit guess → auto-orient →
   decimate preview → returns preview mesh + metadata; piece appears in the tray
   with badges (units to confirm, check orientation, non-manifold warning).
   The preview mesh is also sent to `fit.worker` for analysis.
3. **Drag & snap.** Pointer → ray cast mannequin (main-thread BVH, ~27k tris) →
   anchor frame → piece pose preview; near a home anchor → ghost + snap. Release
   → placement committed → `fit.worker.analyze(piece)`.
4. **Analysis.** Inner-surface samples → closest body point → clearance (signed),
   region code → tally, stats, per-vertex heatmap values → UI legend / colours.
5. **Auto-size.** `fit.worker.autoSize(piece, settings)` → scale/offset → state →
   re-analyse.
6. **Export.** `geometry.worker.exportStl / exportZip / export3mf(items)` bake the
   full-res meshes (unit scale, orientation, scale, mirror) → download; the sizing
   report and project JSON are built on the main thread from state.

## Phases

### Phase 1 (this PR)

- [x] Research and plan (`docs/RESEARCH.md`, this file)
- [x] Core geometry: weld, normals, topology checks, winding repair, sampling, PCA/sphere/cylinder fits
- [x] IO: STL read/write, OBJ read, 3MF read/write (incl. Bambu `p:path`)
- [x] Procedural test meshes: helmet, chest plate, pauldron with magnet holes, forearm tube
- [x] Printer presets (H2C from official specs) and build-volume check
- [x] Piece types, file-name classifier, unit guess, auto-orientation
- [x] Measurements: schema, ANSUR II estimation, cm/in, persistence, import/export
- [x] Mannequin: hm08 asset pipeline, morph + measurement solver, regions, skeleton/landmarks
- [x] App shell: viewport, measurement panel, live mannequin, parts tray, demo armor
- [x] Upload pipeline in worker with badges and confirm dialogs
- [x] Drag-and-snap with home anchors, ghost, rotate / nudge / offset / mirror, touch
- [x] Fit analysis: clearance, region tally, heatmap + legend, transparency
- [x] Auto-sizing (uniform or per-axis scale, offset settle)
- [x] Export: STL, ZIP, 3MF, sizing report, project file; oversize flags
- [x] README (setup, deploy, contributing), CI (typecheck, lint, format, tests, build), Pages deploy
- [x] Browser smoke tests in CI (Playwright: demo fit and auto-size, every export, STL import, phone layout)

### Phase 2

- Lattice FFD conformal fitting; feature protection (hole/slot detection, rigid regions); minimum wall thickness
- Linked scale groups for mating parts (the state already carries `scaleGroup`)
- Donning check (does the head/hand/foot pass through the opening?)
- Test-slice export (thin ring of a piece to print and try on)
- Auto-split oversized pieces (manifold-3d) with pins / dovetails
- GPU heatmap while dragging (BVH distance in shader)
- Range-of-motion check (pose the mannequin with the CC0 rig)

### Phase 3 (ideas)

- Body-scan import as mannequin (local only)
- Optional lazy-loaded ML piece classifier
- Shareable project links (state in URL hash)

## Testing

- Vitest unit tests for all geometry math: measurement estimation, solver
  convergence, region tally, clearance (analytic spheres/cylinders), scaling,
  orientation recovery under random rotations, IO round-trips, build volume.
- Procedural test meshes stand in for copyrighted armor files.
- Playwright smoke tests (`tests/e2e`) drive the production build in headless
  Chromium: demo armor placed, fitted and auto-sized, every export downloaded
  and parsed back, an STL import, measurement persistence and the phone layout.
- `npm run check` = typecheck + lint + tests + build; CI runs it and the
  smoke tests on every PR.

## Performance budget

| Operation                                     | Target   |
| --------------------------------------------- | -------- |
| Parse + weld + BVH, 500k tris (worker)        | < 1.5 s  |
| Preview decimation to ≤ 100k tris             | < 0.5 s  |
| Mannequin re-solve after a measurement change | < 50 ms  |
| Fit analysis (3k samples)                     | < 30 ms  |
| Auto-size                                     | < 500 ms |
| Frame time while dragging (mid-range phone)   | < 16 ms  |

## Open questions

1. **Licence** — MIT chosen as the default for maximum reuse; switch to
   AGPL/GPL if you prefer copyleft (no code dependency forces either).
2. **Mannequin pose** — MakeHuman's rest pose has arms down at ~45°. Do we
   need a T-pose or adjustable arm angle for pauldron/bicep fitting? (Phase 2
   range-of-motion work would add posing.)
3. **Default clearance** — 8 mm target (+ undergarment allowance), 3 mm minimum,
   25 mm "too loose". Reasonable for rigid prints; worth checking with makers.
4. **Exported orientation** — default keeps the designer's original file
   orientation (usually already print-oriented) with sizing applied; "wearing
   orientation" is an option.
5. **Bust** — feminine presets use MakeHuman's cup targets driven by the chest
   measurement; an explicit under-bust field may be needed for accurate chest
   plates.
6. **Scaled previews** — some designers ship reduced-scale files; the unit
   dialog offers ×2/×4/×5/×10. Is that enough?
