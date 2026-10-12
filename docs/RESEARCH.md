# ArmorFit — methodology research

_Research snapshot: 2026-10-12. This document records why ArmorFit uses the
methods it does. The plan that follows from it is in [`PLAN.md`](../PLAN.md)._

The original brief asked two open questions:

1. **Is ray casting the best way to measure fit and detect which body regions a
   piece covers?**
2. **Would a small in-browser AI model help?**

Short answers: **ray casting is the right tool for some jobs but not for
clearance or region detection — closest-point distance queries are**, and
**deterministic geometry beats ML for every core step**; ML is at most an
optional, lazy-loaded helper later. Details and sources below.

---

## TL;DR — decisions

| Problem                           | Chosen method                                                                                                               | Why (one line)                                                                                                   |
| --------------------------------- | --------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| Mannequin                         | MakeHuman **hm08** base mesh + morph targets (CC0), fitted to measurements by least squares                                 | Artist-sculpted shoulders/chest/deltoids — exactly where armor sits — and legally redistributable                |
| Quick-mode measurement estimation | Linear regressions fitted on **ANSUR II** (US Army, 6,068 people, unlimited public release)                                 | Torso girths and limb lengths are well predicted from height + chest + waist; head size is not, so we ask for it |
| Clearance & heatmap               | **Closest-point (unsigned distance) queries against a BVH** of the mannequin, sign from the body's inside test              | Always returns an answer, measures the true gap, no grazing-angle error                                          |
| Region tally                      | Region label of the **closest body point** of each inner-surface sample, area-weighted                                      | Same query as clearance, attributes each patch to the body part it actually rests on                             |
| Picking / drag-to-surface         | **Ray cast** from the pointer (three-mesh-bvh `raycastFirst`)                                                               | This is what ray casting is for                                                                                  |
| Orientation of uploaded pieces    | Sphere/cylinder fit + **rays cast outward from the fitted centre** to find openings + PCA + file-name keywords              | Openings (neck, face, both ends of a bracer) are unambiguous geometric cues                                      |
| Placement on the body             | Anchor = **triangle + barycentric coordinates on the fixed-topology mannequin** + local frame                               | Pieces follow the body when measurements change                                                                  |
| Auto-sizing v1                    | Per-axis scale in the body-aligned frame, solved by **Gauss–Newton on closest-point clearances** (point-to-plane, like ICP) | Small (≤ 9 unknowns), fast, robust; uniform-scale lock available                                                 |
| Auto-sizing v2                    | Coarse **lattice FFD** solved as regularised linear least squares; features held rigid                                      | Smooth, keeps wall thickness at lattice scale, cheap solve                                                       |
| Oversize parts                    | Build-volume check over many orientations; v2 plane splits + pins with **manifold-3d** (WASM)                               | Robust booleans in the browser                                                                                   |
| In-browser AI                     | **Not used in v1.** Possible later: zero-shot piece classification of rendered thumbnails (lazy-loaded)                     | Geometry + file names already solve classification well; ML adds megabytes and opacity                           |

---

## 1. Is ray casting the right method?

The draft spec proposed casting rays from the armor's inner surface along its
inward normals, then using the hits both for clearance and for "which region
does this piece cover". There are four ways to answer "how far is this armor
point from the body":

| Method                                             | What it measures                                                               | Failure modes                                                                                                                                                                                                                                                     |
| -------------------------------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Ray along inward normal**                        | Gap _along the armor's normal_                                                 | Misses near piece edges and on flared rims (no hit → no data); overestimates the gap at grazing angles (gap / cos θ); can pass the near body part and hit a far one (a chest-plate edge ray hitting the arm); mesh normals on scanned or low-poly files are noisy |
| **Closest-point query (BVH)**                      | True minimum Euclidean gap — the thing that decides whether armor touches skin | Needs a sign for penetration (solved with the body's inside test / angle-weighted pseudonormals, Bærentzen & Aanæs 2005)                                                                                                                                          |
| **Precomputed signed distance field (3D texture)** | Same as closest point, sampled on a grid                                       | Resolution/memory trade-off; must rebuild when the body changes                                                                                                                                                                                                   |
| **BVH distance evaluated in a shader**             | Same as closest point, per vertex/fragment on the GPU                          | WebGL2 only; numbers stay on the GPU (fine for colouring, not for statistics)                                                                                                                                                                                     |

How bad is the normal-ray bias? For a forearm modelled as a 50 mm-radius
cylinder with a true 10 mm gap, a ray from a normal tilted 30° reads 12.0 mm,
45° reads 16.0 mm, 55° reads 25.2 mm, and beyond ~56° it misses the body
entirely. Flared rims on pauldrons and helmet brims are exactly where the tilt
is large. Rays are also not cheaper: in our benchmark (three-mesh-bvh 0.9.16,
Node 22) a `raycastFirst` costs 4.8–5.1 µs and a `closestPointToPoint` 5.6 µs
on a 30k-triangle body.

There is precedent for the closest-point definition: the Helmet Fit Index
defines **standoff distance** as the average minimal distance from liner to
head and **gap uniformity** as its standard deviation per region; CloudCompare's
cloud-to-mesh distance likewise uses the nearest triangle. ArmorFit reports
both numbers.

Conclusion:

- **Clearance & heatmap → closest point.** It is defined everywhere, cannot
  "miss", and reports the physically relevant number. three-mesh-bvh's
  `closestPointToPoint` costs ~47 µs per query on a 500k-triangle mesh
  (measured in Node), and the mannequin is only ~27k triangles, so thousands of
  samples per update are cheap in a Web Worker.
- **Penetration sign** comes from the closest face normal on the (watertight,
  consistently wound) mannequin, i.e. the pseudonormal test.
- **Region tally** uses the region label of the same closest point. A ray along
  the normal would credit a region the piece merely "points at"; the closest
  point credits the region it actually rests on.
- **Live heatmap while dragging** can later move to the GPU using
  three-mesh-bvh's GLSL `bvhClosestPointToPoint` (requires `WebGLRenderer`,
  which ArmorFit uses anyway).
- **Ray casting is still used** where it is the natural tool: pointer picking
  and drag-to-surface, finding openings during auto-orientation, wall-thickness
  probes (Shape Diameter Function, Shapira et al. 2008), and visibility checks.

## 2. Would a "micro web-browser AI" help?

Candidates we evaluated:

| Idea                                                                                                           | Feasibility in the browser                                                                                                          | Verdict                                                                                                                                                   |
| -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Zero-shot piece-type classification (render the mesh, run CLIP/SigLIP via Transformers.js or ONNX Runtime Web) | Works, but models are ~50–150 MB, slow on phones, and armor is stylised; accuracy unproven                                          | **Later, optional.** File names ("Pauldron_L.stl") plus geometric signatures (cap/tube/shell, size) already classify most files; we expose a plug-in seam |
| Point-cloud classifier (PointNet-style)                                                                        | Needs a labelled armor dataset that does not exist                                                                                  | No                                                                                                                                                        |
| Body measurements from photos (MediaPipe pose, SMPL regressors)                                                | Pose landmarks give joint positions only; phone measurement apps show ~1–3.4 cm waist errors; SMPL-family models are non-commercial | No — a tape measure is more accurate and private                                                                                                          |
| Neural cloth/garment draping (TailorNet, SNUG, HOOD)                                                           | Built for soft cloth on SMPL bodies; licences restrictive                                                                           | Not applicable to rigid armor                                                                                                                             |

Licence notes if we ever add the classifier: SigLIP is Apache-2.0 (usable);
MobileCLIP weights are research-only and OpenAI CLIP's card puts deployed use
out of scope — avoid both. Zero-shot accuracy on long-tail 3D categories is
~47–64 % in the literature (PointCLIP V2, OpenShape), so it could only ever
_suggest_ a type.

The core problems — fit, orientation, sizing — are geometric. Deterministic
algorithms are exact, explainable ("this pauldron is 6 mm too tight on the
deltoid"), run in milliseconds, need no training data and no downloads. We keep
the door open for an optional, lazy-loaded classifier.

## 3. Mannequin (body model)

| Option                                    | Licence                                                                       | Shoulder/chest realism                                                                          | Payload  | Notes                                                                             |
| ----------------------------------------- | ----------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- | -------- | --------------------------------------------------------------------------------- |
| **MakeHuman hm08** (base mesh + targets)  | **CC0** for mesh, targets, rig and weights (code is AGPL — we use none of it) | Good — artist sculpted, has pectoral/deltoid/lat targets                                        | ~2–6 MB  | 13,380 body vertices, all quads, fixed topology                                   |
| Procedural loft of super-ellipse sections | MIT (ours)                                                                    | Poor at the deltoid cap, armpit, trapezius slope — exactly where pauldrons and chest plates sit | < 0.1 MB | Exact circumferences by construction                                              |
| SMPL / SMPL-X / STAR / SUPR               | Non-commercial, no redistribution                                             | Good                                                                                            | —        | **Excluded**                                                                      |
| GHUM                                      | Gated academic licence                                                        | Good                                                                                            | —        | Excluded                                                                          |
| Anny (NAVER LABS, 2025)                   | Apache-2.0 code + MakeHuman CC0 data                                          | Good                                                                                            | —        | Same data as MakeHuman, PyTorch only; reference implementation                    |
| MHR (Meta Momentum Human Rig)             | Apache-2.0                                                                    | Good, scan-derived PCA                                                                          | 2–8 MB   | Strong v2 candidate; identity parameters do not map directly to tape measurements |

Key facts (verified on the files themselves):

- MakeHuman assets became CC0 in September 2020 (release 1.2.0). `base.obj`
  and every `.target` carry a CC0 header; `default.mhskel` and
  `default_weights.mhw` declare `"license": "CC0"`. The FAQ explicitly allows
  building "a character generator of your own, with no restriction on what
  license that character generator needs to have".
- `base.obj` (hm08): 19,158 vertices; the body is vertices 0–13,379
  (13,378 quads); the rest are helpers (joint cubes, eyes, teeth, tights…).
  Units are decimetres.
- `measure/` contains 20 measurement modifiers (bust, underbust, waist, hips,
  neck, upper arm, wrist, thigh, calf, knee, ankle circumferences; shoulder,
  arm, leg, nape-to-waist lengths). MakeHuman's own measuring code is AGPL and
  its tape loops have gaps, so **ArmorFit derives its own measurement loops**
  by slicing the base mesh at build time.
- Adult macro targets (gender × muscle × weight) give realistic overall shape
  changes; ethnicity is fixed to an equal mix.

**Decision:** MakeHuman hm08 (CC0) for v1. Region labels are precomputed once
from the CC0 skin weights (bone of maximum weight) refined by rules (front/back
split for chest vs. upper back, a plane under the armpit for deltoid vs. upper
arm, bands around elbow and knee, …). Topology never changes, so labels and
placement anchors stay valid for every body.

v2: user body-scan import (local only), then optionally MHR.

## 4. Estimating measurements (quick mode)

**ANSUR II** (US Army anthropometric survey, 2012; 4,082 men + 1,986 women; 93
measurements; cleared for unlimited public release — credited, treated as
public domain). Column mapping used by ArmorFit:

| ArmorFit field                    | ANSUR II column(s)                                         |
| --------------------------------- | ---------------------------------------------------------- |
| height                            | `stature`                                                  |
| chest                             | `chestcircumference`                                       |
| waist                             | `waistcircumference` (at the navel)                        |
| hips                              | `buttockcircumference`                                     |
| headCirc / headLength / headWidth | `headcircumference` / `headlength` / `headbreadth`         |
| neckCirc                          | `neckcircumference`                                        |
| shoulderWidth                     | `biacromialbreadth`                                        |
| torsoLength                       | `suprasternaleheight − waistheightomphalion`               |
| upperArmLength                    | `acromionradialelength`                                    |
| bicepCirc                         | `bicepscircumferenceflexed` (no relaxed value in ANSUR II) |
| forearmLength                     | `radialestylionlength`                                     |
| forearmCirc                       | `forearmcircumferenceflexed`                               |
| wristCirc                         | `wristcircumference`                                       |
| handLength / handWidth            | `handlength` / `handbreadth`                               |
| thighLength                       | `trochanterionheight − lateralfemoralepicondyleheight`     |
| thighCirc                         | `thighcircumference`                                       |
| shinLength                        | `tibialheight − lateralmalleolusheight`                    |
| calfCirc                          | `calfcircumference`                                        |
| footLength                        | `footlength`                                               |

In-sample regressions on stature + chest + waist (+ sex) explain most of the
variance for girths and breadths (e.g. neck R² 0.87, biacromial 0.77, wrist
0.78) and limb lengths (0.6–0.8). **Head size is barely predictable from the
body (R² 0.28)**, which is why quick mode asks for head circumference.
Fallback proportions (Drillis & Contini via Winter): upper arm 0.186 H,
forearm 0.146 H, hand 0.108 H, thigh 0.245 H, shank 0.246 H, foot 0.152 H.
Caveat: ANSUR II is a military population; every estimate can be overridden.

## 5. Placement and sizing

- **Placement**: pointer ray → hit triangle on the mannequin → piece is
  rotated so its concave side faces the surface normal (smoothed vertex
  normal), keeping its "up" closest to the body's up, then pushed out along the
  normal until its inner surface reaches the target clearance (1-D search over
  closest-point distances). The anchor (triangle id + barycentric coordinates +
  twist + offset) is stored instead of a world matrix, so pieces follow the body
  when measurements change — the same idea as MakeHuman's proxy fitting and
  Blender's Surface Deform.
- **Home anchors**: each known piece type has a home position defined on
  anatomical landmarks; within a threshold the drag snaps there with a ghost
  preview.
- **Refinement on release** is point-to-plane ICP with a clearance target and
  a one-sided penetration penalty (Low 2004). Clearance alone leaves a piece
  free to slide along a tube or dome (a bracer drifts along the forearm), so
  we add a weak pull toward the drop pose along those unconstrained
  directions (Gelfand et al. 2003, ICP stability).
- **Scale groups**: cosplayers' most common scaling advice is "apply exactly
  the same scale to all related parts" (helmet dome + visor, a gauntlet's
  sub-parts). Pieces can be linked so auto-size solves one shared scale.
- **Auto-sizing v1** solves for per-axis scale (sx, sy, sz) plus offset in the
  piece's body-aligned frame. Each clearance is linearised with the closest
  point's normal (point-to-plane, as in ICP), so every iteration is a tiny
  least-squares solve; a hinge penalty keeps samples above the minimum
  clearance, and a regulariser keeps the scale near-uniform unless the
  user allows otherwise.
- **Deformation v2**: lattice FFD (Sederberg & Parry 1986) — linear in the
  control points, so clearance-driven fitting is again a small regularised
  least-squares problem. Cage methods (mean-value, harmonic, Green
  coordinates) and non-rigid ICP (Amberg et al. 2007) were considered; FFD wins
  on simplicity and speed. Small features (magnet holes, strap slots) are
  detected as near-circular boundary/tunnel loops and kept rigid (local inverse
  scale), and wall thickness is checked with inward rays.

## 6. Auto-orientation for wearing

Learned "upright orientation" methods (Fu et al. 2008, Upright-Net 2022)
target objects resting on a base and need training data, so they do not
transfer to worn shells. We use deterministic cues:

1. Area-weighted surface samples → least-squares sphere fit (centre of
   curvature) and PCA.
2. Cast 400 rays (Fibonacci sphere) from the fitted centre. Directions that
   escape form **openings**; the blocked fraction is the **enclosure**.
3. Classify: two antipodal openings + high enclosure → **tube** (bracer,
   greave); one large opening → **cap** (helmet; boots/gloves open upward);
   otherwise **shell** (chest plate, pauldron).
4. Frame: caps — "down" is the deepest point of the main opening (robust when a
   face opening merges with the neck opening), "front" is the face opening;
   tubes — the axis through the openings, wider end up (elbow/knee end);
   shells — concave side toward the body, "up" from the file's own axes when
   they lie in the plate, else the long axis.
5. Ambiguities lower a confidence score; below 0.6 the piece gets a **check
   orientation** badge.

File-name keywords (pauldron, bracer, greave, L/R, left/right…) give the piece
type and side for free; they are combined with the geometric result. A useful
extra cue for tubes is the area-weighted normal covariance Σ a·nnᵀ: a
cylinder's normals lie on one great circle, so its smallest eigenvector is the
tube axis.

## 7. Printing

- Build volume: tested over many orientations (principal axes, file axes and
  the largest convex-hull faces as "up", each spun on the bed in 1° steps), so
  diagonal placements are found.
- **Bambu Lab H2C** (official): left nozzle **325 × 320 × 320 mm**, right
  (Vortek) nozzle **305 × 320 × 325 mm**, one part using both nozzles
  **300 × 320 × 320 mm** (store says 325 mm height, wiki 320 mm; we use the
  safer 320). Sources: <https://wiki.bambulab.com/en/h2/manual/max-printable-area>,
  <https://us.store.bambulab.com/products/h2c>.
- 3MF: core spec, millimetres, one object + build item per piece; Bambu
  Studio, OrcaSlicer and PrusaSlicer import such files as separate objects
  (verified in their importer sources; files written by our writer pass lib3mf
  strict validation). Slicers are Z-up, so exports are rotated from the Y-up
  scene. We also read Bambu-style 3MFs that reference sub-models via `p:path`.
- Splitting (v2): plane cuts and connector pins/dovetails with manifold-3d
  (Apache-2.0 WASM, ~200 KB gzipped; throws on non-manifold input, so meshes
  are welded first). Automatic cut placement in the spirit of Chopper (Luo et
  al. 2012).

## 8. Existing tools and what cosplayers need

| Tool                                      | What it does                                                                                          | Gaps                                                                       |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------- |
| Armorsmith Designer                       | $40, Windows only; measurement avatar, manual position/scale, visual clip checks, unfolds to Pepakura | No auto-fit, no quantitative clearance                                     |
| FormFitter (Galactic Armory, 2026)        | Web beta + $145 desktop; measurement avatar, cage deform, auto-split preview, printer check           | Closed source, "requires a mouse and a large screen", no clearance heatmap |
| Pepakura                                  | Set overall height, measure with a tape                                                               | Helmets often far too big or small                                         |
| Blender / Meshmixer                       | Lattice, Shrinkwrap, Surface Deform by hand                                                           | Expert tools; Meshmixer discontinued                                       |
| LuBan, PrusaSlicer cut, browser splitters | Splitting with connectors                                                                             | Splitting only                                                             |

Recurring complaints: designers' reference size is undocumented, builders
print 3–4 test helmets, non-uniform scaling breaks mating parts, registration
holes stop fitting after scaling, pieces exceed the bed, tools are paid and
Windows-only. Features that matter most: an accurate measured avatar, per-piece
scale suggestions with **linked scaling** for mating parts, **quantitative
clearance**, a **donning check** (can the head pass through the helmet's neck
opening — makers suggest ~20 mm over head size plus padding), **test-slice
export** (print a thin ring to check fit), left/right mirroring and splitting
with connectors (typically 2 mm holes + 1.75 mm filament pins at
~0.1–0.15 mm clearance per side, or 6×3 mm magnets).

ArmorFit's differentiators: free and open source, runs on phones, measured
clearance heatmap, automatic orientation and sizing, feature protection.

## 9. Tech stack (verified versions)

three 0.186 (`WebGLRenderer`), three-mesh-bvh 0.9.16, Vite 8 (Rolldown),
Vitest 5, TypeScript 6.0 (pinned: TS 7 ships no compiler API yet, which
typescript-eslint needs), Preact 11 + signals, fflate, meshoptimizer 1.3
(decimation), manifold-3d 3.5 (v2). three's `3MFLoader` uses `DOMParser`, which
does not exist in Web Workers, so ArmorFit ships its own small 3MF
reader/writer. GitHub Pages cannot send COOP/COEP headers, so no
SharedArrayBuffer: each worker builds its BVH single-threaded (~0.4 s at 500k
triangles).

## Sources

- MakeHuman licence change: <https://static.makehumancommunity.org/oldsite/faq/what_changed_regarding_the_license_in_2020.html>
- MakeHuman LICENSE: <https://github.com/makehumancommunity/makehuman/blob/master/LICENSE.md>
- MakeHuman FAQ (free use of assets): <https://static.makehumancommunity.org/makehuman/faq/are_makehuman_files_free.html>
- hm08 base mesh concepts: <https://static.makehumancommunity.org/about/concepts/basemesh.html>
- Anny: <https://github.com/naver/anny>, <https://arxiv.org/html/2511.03589v2>
- MHR: <https://github.com/facebookresearch/MHR>
- SMPL licence: <https://smpl.is.tue.mpg.de/modellicense.html>
- ANSUR II data and release memo: <https://www.openlab.psu.edu/ansur2/>, <https://tools.openlab.psu.edu/publicData/ANSURII-MFR.pdf>
- Winter, _Biomechanics and Motor Control of Human Movement_ (segment proportions): <https://courses.grainger.illinois.edu/me481/sp2021/Anthro-Winter.pdf>
- Bartol et al. 2022, body measurement regression on ANSUR: <https://pmc.ncbi.nlm.nih.gov/articles/PMC8914647>
- Bærentzen & Aanæs 2005, signed distance via angle-weighted pseudonormals (IEEE TVCG 11(3))
- Shapira, Shamir & Cohen-Or 2008, Shape Diameter Function (The Visual Computer 24)
- Sederberg & Parry 1986, Free-form deformation (SIGGRAPH)
- Low 2004, Linear least-squares optimization for point-to-plane ICP: <https://comp.nus.edu.sg/~lowkl/publications/lowk_point-to-plane_icp_techrep.pdf>
- Gelfand et al. 2003, Geometrically stable sampling for ICP: <https://www.cs.princeton.edu/~smr/papers/stabicp>
- Helmet Fit Index (standoff distance, gap uniformity): <https://www.scitepress.org/papers/2014/50841/pdf/index.html>
- Kraevoy et al. 2008, Non-homogeneous resizing of complex models: <https://www.cs.ubc.ca/~vlady/conres/conres.htm>
- FormFitter: <https://beta.formfitter.net/>; Armorsmith: <https://www.armoredgarage.com/>
- SigLIP licence: <https://huggingface.co/google/siglip-base-patch16-224>; MobileCLIP licence: <https://github.com/apple/ml-mobileclip>
- Amberg, Romdhani & Vetter 2007, Optimal step nonrigid ICP (CVPR)
- Luo et al. 2012, Chopper: partitioning models into 3D-printable parts (SIGGRAPH Asia)
- three-mesh-bvh: <https://github.com/gkjohnson/three-mesh-bvh>
- manifold-3d: <https://github.com/elalish/manifold>
- meshoptimizer: <https://github.com/zeux/meshoptimizer>
- 3MF core spec: <https://github.com/3MFConsortium/spec_core>
- Printer volumes: see `src/core/print/printers.ts` (one source URL per preset)
