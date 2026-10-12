# ArmorFit

Free, open-source tool that fits 3D-printable cosplay armor to your body, right
in the browser. Enter a few measurements, drop in your armor files (STL, OBJ or
3MF), put the pieces on a mannequin built to your size, see where they are
tight or loose, let ArmorFit scale them, and export print-ready files.

- **100 % client-side.** Your files and measurements never leave your device:
  no server, no account, no upload. Measurements are saved in your browser only.
- **Works on desktop and phones** (touch: drag, two-finger twist, pinch zoom).
- **Handles real files:** pieces up to about 500k triangles, broken and
  non-manifold meshes, files in mm, cm, m or inches, and reduced-scale files.

## How to use it

1. **Body:** choose cm or inches and enter your height, chest, waist and head
   circumference. Quick mode estimates the other 18 measurements from the
   ANSUR II body survey. Detailed mode lets you enter all 22. Pick a body
   shape (neutral, masculine or feminine) and what you wear under the armor
   (nothing, a bodysuit or foam padding). The mannequin reshapes after each
   value you enter. You can export and import your measurements as JSON.
2. **Armor:** drop your armor files, or try the demo pieces. ArmorFit repairs
   the mesh (merges duplicate vertices, fixes flipped faces) and warns you if it
   is not watertight. It guesses the units and the piece type and turns the
   piece upright as worn. Anything it is unsure about gets a badge. Confirm the
   units, choose the piece type and side, then drag the piece onto the body or
   press **Put on body** to snap it to its usual place.
3. **Fit:** see how much of the gap is tight, good or loose, which body regions
   the piece covers (for example, "63 % Deltoid (L), 32 % Upper shoulder (L)")
   and which measurements drive its fit. A heatmap shows the gap on the piece:
   red is too tight or inside the body, green is on target, blue is loose.
   - **Auto-size** finds the scale that gives the target gap. It can keep the
     proportions or scale each axis separately.
   - **Adjust by hand:** drag the piece on the body to slide it, rotate it
     (second finger on touch, or Shift + mouse wheel), nudge it, change the
     offset, scale it, or make a mirrored copy for the other side.
4. **Print:** pick your printer. The Bambu Lab H2C is the default, and you can
   enter a custom build volume. Each piece shows whether it fits as exported,
   only on another side, or not at all.
   - **Export** each piece as an STL, all pieces as a ZIP of STLs, or all
     pieces as one 3MF. Files use the designer's original orientation or the
     orientation as worn.
   - **Sizing report:** a Markdown file with your measurements, scales and fit,
     so you can reprint a set consistently.
   - **Project file:** saves everything except the meshes. Open it later and
     drop the same files to carry on.

The default clearance (gap between the body and the inside of the armor) is
3 mm minimum, 8 mm target and 25 mm "loose", plus 2 mm for a bodysuit or 10 mm
for foam. You can change all of these in the Fit tab.

## How it works

The full research notes, with sources, are in [`docs/RESEARCH.md`](docs/RESEARCH.md).
The architecture and roadmap are in [`PLAN.md`](PLAN.md).

- **Mannequin:** the CC0 MakeHuman base mesh (hm08) is shaped by its CC0
  morph targets. A least-squares solver picks the target weights so that tape
  measures taken on the mesh match your measurements. Missing measurements are
  estimated from the public ANSUR II survey (6,000+ US Army personnel). Every
  mannequin vertex carries an anatomical region label.
- **Placing pieces:** ray casting is used where it fits: picking the point on
  the body under your finger or mouse, and finding the openings of a piece
  during auto-orientation.
- **Measuring fit:** clearance is measured with closest-point distance queries
  against a bounding-volume hierarchy (three-mesh-bvh), not ray casting. A ray
  only measures the gap along one direction and can miss the body or hit the
  wrong part of it. Closest-point distance gives the true gap and whether a
  point is inside the body, and it also yields the body region nearest to each
  point.
- **Auto-sizing:** Gauss–Newton least squares on point-to-plane distances,
  weighted towards the parts of the piece that actually touch the body.
- **No machine learning in v1.** Each problem here has an exact geometric
  solution that is faster and more predictable than a model. A small in-browser
  piece classifier is a possible later addition.
- **Workers:** heavy work runs in two Web Workers (geometry and fit). The 3D
  view keeps a decimated preview of each piece (at most 100k triangles), and
  exports always use the full-resolution mesh.

## Run it locally

Requires [Node.js](https://nodejs.org/) 22.12 or newer.

```bash
git clone https://github.com/dassey/ArmorFit.git
cd ArmorFit
npm ci
npm run dev
```

Then open the URL Vite prints (usually http://localhost:5173/).

| Command              | What it does                                                               |
| -------------------- | -------------------------------------------------------------------------- |
| `npm run dev`        | Development server with hot reload                                         |
| `npm run build`      | Production build into `dist/`                                              |
| `npm run preview`    | Serve the production build locally                                         |
| `npm test`           | Unit tests (Vitest)                                                        |
| `npm run test:watch` | Unit tests in watch mode                                                   |
| `npm run test:e2e`   | Browser smoke tests (Playwright): demo fit, imports, exports, phone layout |
| `npm run typecheck`  | TypeScript check                                                           |
| `npm run lint`       | ESLint                                                                     |
| `npm run format`     | Format everything with Prettier                                            |
| `npm run check`      | Typecheck, lint, tests and build (run before PRs)                          |

### Rebuilding the data files (optional)

The generated data is committed, so you only need these if you change the
scripts:

```bash
# Mannequin asset -> public/assets/body/hm08.armorfit.bin.gz
# (downloads MakeHuman's CC0 data at a pinned commit into .cache/, or pass --makehuman <dir>)
node scripts/build-body.mjs

# Measurement model -> src/core/measurements/ansur-model.json
# (downloads the ANSUR II CSVs, or pass --male <csv> --female <csv>)
node scripts/build-anthro.mjs
```

## Deploy

The build is a static site with relative paths (`base: './'`), so `dist/` works
from any folder on any static host.

### GitHub Pages (set up in this repo)

1. In the repository on GitHub, open **Settings → Pages**.
2. Under **Build and deployment → Source**, choose **GitHub Actions**.
3. Push to `main`, or run the **Deploy to GitHub Pages** workflow by hand from
   the Actions tab.

[`.github/workflows/deploy.yml`](.github/workflows/deploy.yml) runs the tests,
builds and publishes `dist/`. The site appears at
`https://<user>.github.io/<repo>/`, for example
https://dassey.github.io/ArmorFit/.

### Cloudflare Pages

Create a Pages project from the repository with:

- **Build command:** `npm run build`
- **Build output directory:** `dist`
- **Environment variable:** `NODE_VERSION` = `22` (or newer)

### Anything else

Run `npm run build` and upload the contents of `dist/`. No server-side code or
special headers are needed.

## Contributing

Bug reports, printer presets, piece types and code are all welcome.

1. Fork the repository and create a branch.
2. `npm ci`, then make your change.
3. Add or update tests. Geometry code needs unit tests.
4. Run `npm run check` and `npm run format`. For UI changes also run
   `npm run test:e2e` (the first time, install its browser with
   `npx playwright install chromium`).
5. Open a pull request describing what changed and how you tested it. CI runs
   the same checks.

Guidelines:

- **Layers:** `src/core/` is pure TypeScript (no DOM, no rendering) so it runs
  in workers and in Node tests. UI code lives in `src/ui/`, the three.js
  scene in `src/engine/`, app state in `src/state/` and worker entry points in
  `src/workers/`. The table in [`PLAN.md`](PLAN.md) shows what may import what.
- **Test meshes:** never commit armor files you did not make, because most
  armor designs are paid or licensed. Use the procedural meshes in
  `src/core/testmeshes/` (helmet, chest plate, pauldron with magnet holes,
  bracer), or add new ones there.
- **Printer presets** go in `src/core/print/printers.ts`. Include a link to the
  manufacturer's official spec page in `source`, and use the smaller figure
  when sources disagree.
- **Piece types** (label, regions, driving measurements, typical size,
  file-name keywords) live in `src/core/pieces/types.ts`.
- **Style:** Prettier (single quotes, 110 columns) and ESLint. All lengths are
  millimetres internally. The wearing frame is Y up, Z towards the wearer's
  front, X towards the wearer's left.

## Limitations

- The mannequin stands in MakeHuman's rest pose with straightened elbows. There
  is no posing or range-of-motion check yet.
- Scaling is uniform or per-axis. Bending a piece to the body (lattice
  deformation) and protecting features such as magnet holes are planned. Keep
  per-axis scales close to each other on parts with snug features.
- Oversized pieces are flagged but not split. Use your slicer's cut tool until
  automatic splitting with alignment pins lands.
- Fit is only as good as the measurements. Before a long print, cut a thin
  test ring from a snug piece in your slicer and try it on.

## Credits and licences

ArmorFit is released under the [MIT licence](LICENSE).

- Mannequin: [MakeHuman](https://github.com/makehumancommunity/makehuman) base
  mesh and morph targets, CC0 1.0. Only the CC0 data files are used, not the
  AGPL code.
- Body statistics:
  [ANSUR II](https://www.openlab.psu.edu/ansur2/) anthropometric survey (US
  Army, 2012), cleared for unlimited public release.
- Libraries: [three.js](https://threejs.org/),
  [three-mesh-bvh](https://github.com/gkjohnson/three-mesh-bvh),
  [meshoptimizer](https://github.com/zeux/meshoptimizer),
  [fflate](https://github.com/101arrowz/fflate),
  [Preact](https://preactjs.com/) and
  [Preact Signals](https://github.com/preactjs/signals), all MIT.
