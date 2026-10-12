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
