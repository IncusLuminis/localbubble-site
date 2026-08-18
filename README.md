# Local Galactic Structures

Scientifically grounded 3D model and data pipeline for the Solar neighborhood
(Gould Belt, Radcliffe Wave, Local Bubble, and nearby stellar/interstellar
structures). Full project spec: [`spec/Idea.md`](spec/Idea.md).

## Status

Scientific pipeline (Phases 1-4, spec §48): object schema, catalog storage,
RA/Dec/distance -> Galactic XYZ coordinate transforms, a live SIMBAD/Gaia/
VizieR + literature data-acquisition layer, and the initial >=20-object
catalog (spec §9) are built. The three scientific model layers - Gould Belt,
Radcliffe Wave, Local Bubble (spec §16-18) - are built as well. The
renderer-independent scene export and `galactic-structures` CLI (spec §21,
§34-35) tie the pipeline together end to end. A Three.js web visualizer
(spec §22, Phase 5-6) renders the Sun, Galactic Plane, catalog objects, and
the three model layers from that scene export, with a full interaction layer
(layer toggles, labels, inspector, radius filter, camera presets, PNG export
— spec §23-25, §28-29, §39) — see [Web visualizer](#web-visualizer) below.

v1.2 (`spec/Idea-v1.2-individual-stars.md`) extends the catalog with ~585
individual named stars identified from a reference poster (candidate names
only - never positions, spec §10) and resolved for real against SIMBAD/Gaia,
alongside the original 20 structural objects - see
[Individual stars (v1.2)](#individual-stars-v12) below. Scaling the web
viewer for this larger catalog (`InstancedMesh`, label density) is tracked
separately - see the `local-galactic-structures` GitHub Project board.

## Setup

```bash
cd local-galactic-structures
python3.12 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
```

## Rebuild the initial catalog

```bash
python scripts/build_initial_catalog.py
```

Writes `data/normalized/catalog.parquet` and `data/normalized/catalog.csv`
from the checked-in, sourced records in
`data/normalized/initial_catalog_records.json` - spec §9's >=20-object seed
list (molecular clouds, star clusters, OB associations, the Vela SNR, and
the Local Bubble) plus, since v1.2, ~585 individual named stars (see
[Individual stars (v1.2)](#individual-stars-v12) below) - 605 objects total.
Every record is either resolved live via SIMBAD/Gaia/VizieR, or built from a
cited literature distance; see each record's `source.reference`. No live
network access is required to rebuild from this checked-in file (spec §14);
re-resolving from scratch is a separate concern handled by
`src/local_galactic_structures/data_sources/`.

## Rebuild the scientific model layers

`models/gould_belt.yaml`, `models/radcliffe_wave.csv`, and
`models/local_bubble.yaml` are checked-in, literature-sourced configs loaded
by `gould_belt.py`/`radcliffe_wave.py`/`local_bubble.py` respectively -
nothing to rebuild; see each module's docstring for its source.

## CLI

Installing the package (`pip install -e .`) registers a `galactic-structures`
console script covering the pipeline stages from spec §35. Every subcommand
calls the same library functions the tests/notebook use (spec §34) - nothing
is reimplemented in the CLI layer.

```bash
galactic-structures acquire "NGC 1976" --source simbad   # resolve+cache one object (spec §12)
galactic-structures build-catalog                        # rebuild the initial catalog (spec §9)
galactic-structures build-coordinates                    # re-derive Galactic l/b/XYZ (spec §6)
galactic-structures build-models                          # validate the model-layer configs (spec §16-18)
galactic-structures export-scene --radius 800 --output data/derived/scene.json
galactic-structures build                                 # the above four stages, end to end
```

`export-scene` composes the normalized catalog and the three model layers
(Gould Belt, Radcliffe Wave, Local Bubble) into a single renderer-independent
`scene.json` (spec §21, §45) - the artifact the future Three.js web
visualizer will consume. `--radius <pc>` filters `objects` to those within
that heliocentric distance of the Sun (spec §28); pass `--no-radius-filter`
to include every object regardless of distance. The default output path is
`data/derived/scene.json` (spec §13); `--output` overrides it. Model layers
are never radius-filtered - they represent whole physical structures, not
point objects - and are included whenever `enabled` (or unconditionally, for
`GouldBeltModel`, which has no `enabled` field).

The same composition logic is available directly from Python via
`local_galactic_structures.scene.build_scene()` /
`export_scene()` / `load_scene()` (spec §34).

## Tests

```bash
pytest
```

A handful of data-acquisition tests are gated behind live network access to
SIMBAD/Gaia/VizieR and skipped by default; run
`LGS_RUN_NETWORK_TESTS=1 pytest` to include them.

## Notebook

```bash
pip install -e ".[notebook]"
jupyter lab notebooks/local_neighborhood.ipynb
```

`notebooks/local_neighborhood.ipynb` (spec §33) inspects the catalog, verifies
the coordinate transform, and plots the initial object set in 3D against the
Gould Belt / Radcliffe Wave / Local Bubble model layers using Plotly. It's a
validation/research tool, not the primary deliverable.

## Layout

- `src/local_galactic_structures/schema.py` — normalized `AstronomicalObject`
  Pydantic schema (spec §7).
- `src/local_galactic_structures/coordinates.py` — RA/Dec/distance -> Galactic
  l/b and heliocentric Galactic Cartesian XYZ, via `astropy.coordinates` only
  (spec §6).
- `src/local_galactic_structures/catalog.py` — flatten/unflatten
  `AstronomicalObject` records to/from `data/normalized/catalog.parquet`
  (+ CSV for inspection).
- `src/local_galactic_structures/data_sources/` — the `ObjectResolver`
  interface plus SIMBAD/Gaia/VizieR/literature adapters, with local caching
  and provenance tracking (spec §11-12, §14).
- `src/local_galactic_structures/{gould_belt,radcliffe_wave,local_bubble}.py`
  — the three scientific model layers (spec §16-18), each config-driven from
  a file under `models/`.
- `src/local_galactic_structures/initial_catalog.py` — shared
  load/build logic for the checked-in initial catalog (spec §9), called by
  both `scripts/build_initial_catalog.py` and the CLI's `build-catalog`.
- `src/local_galactic_structures/scene.py` — composes the catalog + model
  layers into the renderer-independent scene export (spec §21, §45).
- `src/local_galactic_structures/cli.py` — the `galactic-structures` console
  script (spec §34-35).
- `data/{raw,normalized,derived}/` — strict raw -> normalized -> derived data
  separation (spec §13). `raw/` is never modified in place. `derived/` holds
  `scene.json` output by `export-scene`.
- `notebooks/local_neighborhood.ipynb` — scientific validation notebook
  (spec §33).
- `web/` — the Three.js MVP web visualizer (spec §22, §31, §36; Story #64).
  See [Web visualizer](#web-visualizer) below.

## Web visualizer

`web/` is a standalone TypeScript + Three.js + Vite project (spec §31) with
its own `package.json`/`node_modules`, independent of the Python pipeline's
toolchain. It loads the scene export as a static JSON asset at runtime and
never queries an astronomical service or backend (spec §22): "The
application should work locally without requiring a backend once the scene
dataset has been built."

Regenerate the scene data it reads from (whenever the catalog or models
change):

```bash
galactic-structures export-scene --radius 800 --output web/public/data/scene.json
```

Then run the web app:

```bash
cd web
npm install
npm run dev      # http://localhost:5173, hot-reloading dev server
npm run build    # type-checks (tsc --noEmit) then produces web/dist/
npm test         # vitest: scene-loading/coordinate-mapping unit tests
```

This first iteration (Story #64) renders the base 3D scene only — WebGL
renderer, dark restrained background (spec §30), orbit/pan/zoom camera
controls, the Sun at the origin, a semi-transparent Galactic Plane reference
grid at Z = 0 (spec §26), coordinate axes (spec §27), and every catalog
object from `scene.json` at its real `position_pc` (spec §6, §45). Layer
toggles, labels, an object inspector, radius filtering UI, camera presets,
and PNG export are a later Story's scope (spec §23-25, §28-29, §39), not
built here.

`web/src/scene/sceneData.ts` maps each object's `position_pc` onto a
`THREE.Vector3` component-for-component, with no rescaling or axis
reordering (spec §3, §45: the renderer must not alter scientific data) —
covered by `web/test/sceneData.test.ts`. The Galactic frame is Z-up
(+Z → North Galactic Pole, spec §6), so instead of transforming any
position, the camera's own `up` vector is set to +Z (`web/src/scene/
camera.ts`) so the Galactic Plane reads as the scene's "floor".

(Note: the paragraph above describes Story #64's original scope. Story #65
subsequently added the full interaction layer this section doesn't mention
yet - layer toggles, labels, an inspector, radius filtering, camera presets,
and PNG export are all built; see the individual `web/src/scene/*.ts` and
`web/src/ui/*.ts` modules. This section is due a rewrite to reflect that -
not done here since it's outside this Story's scope.)

## Individual stars (v1.2)

`spec/Idea-v1.2-individual-stars.md` extends the catalog with individual
named stars, sourced by candidate name from Galaxy Map's "Gaia star density
map" poster (galaxymap.org) and resolved for real against SIMBAD/Gaia -
never inferred from the poster itself (spec §10).

- **Extraction** (Story #87): the poster was cut into a 25-tile grid and
  read by independent agents, cross-validated against an automated
  color-segmentation detector, then a second-pass sweep for silent misses.
  Result: 595 unique candidate star names (+264 candidate clusters for a
  possible future Story). Full methodology and raw transcripts:
  `data/raw/galaxy_map/README.md`.
- **Resolution** (Story #88): all 595 candidates resolved via
  `SimbadResolver` - **585 distinct real stars** resolved, 7 genuinely
  unresolved (tile-edge transcription fragments with no recoverable full
  name, one unfamiliar designation not in SIMBAD, and one real star with no
  parallax on file) - see `data/raw/galaxy_map/unresolved_stars.json`. Each
  resolved star carries dual provenance (spec §5): `source.reference` is the
  real SIMBAD citation, and `notes` separately records that the *candidate*
  itself came from the Galaxy Map poster.

  Two resolution gotchas worth knowing if you extend this further:

  1. SIMBAD's `query_object()` does not accept the poster's Unicode Bayer
     notation directly (e.g. `"β¹ Sco"`, `"γ² Vel"`) - it expects Latin
     transliterations (`"bet01 Sco"`, `"gam02 Vel"`), and Flamsteed-style
     lowercase-letter designations (`"o And"` for omicron Andromedae, `"f01
     Cyg"`) need the Greek name spelled out (`"omi And"`) or a Flamsteed
     number substituted (`"41 Cyg"`).
  2. **A real cache-collision bug was found and fixed in shared Story #58
     infrastructure during this Story's Validator review**:
     `data_sources.slugify()` stripped non-ASCII characters entirely rather
     than encoding them, so every `"<Greek letter>[superscript digit]
     <constellation>"`-shaped query with no other ASCII content (which
     describes most Bayer-designation stars, since the raw poster label is
     tried before any Latin-transliterated fallback) collapsed to the
     *same* cache key - e.g. both `"ω Ori"` and `"χ² Ori"` slugified to
     just `"ori"`. Whichever star got cached under that key first silently
     "resolved" every other Greek-lettered star in the same constellation
     to itself. This produced real stars duplicated 2-4x under distinct
     catalog ids (`iot-cma`, `iot-cma-2`, `iot-cma-3`, `iot-cma-4`, etc.) -
     caught by `tests/test_individual_stars.py::test_no_duplicate_star_records`,
     which checks resolved SIMBAD identity, not just catalog-id uniqueness
     (the latter was already satisfied and did not catch this). Fixed by
     encoding non-ASCII characters by Unicode codepoint instead of
     stripping them (`data_sources/__init__.py`), then re-resolving the
     entire candidate list from a wiped cache to guarantee no residual
     corruption survived. See `tests/test_data_sources.py::TestSlugify::
     test_slugify_does_not_collide_on_non_ascii_bayer_designations` for the
     regression test.

Radius filtering, layer toggles, and the web viewer's rendering all already
support arbitrary catalog sizes (spec §28, §44) - no pipeline or web code
changed for this Story. Scaling the web viewer's *rendering performance*
for ~600 objects (`InstancedMesh`, label density) is tracked as a separate,
required Story (#89) rather than assumed to already work at this scale.
