# Local Bubble

Scientifically grounded 3D model and data pipeline for the Solar neighborhood
(Gould Belt, Radcliffe Wave, Local Bubble, and nearby stellar/interstellar
structures). Live at [localbubble.space](https://localbubble.space). Full
project spec: [`spec/Idea.md`](spec/Idea.md).

This repository was extracted (with full commit history) from the
`local-galactic-structures/` subdirectory of the private
`IncusLuminis/visualization-studio-tools` monorepo as part of the 1.0
release - see [`MIGRATION.md`](MIGRATION.md) for that history and a summary
of the work since.

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
individual named stars and ~229 additional star clusters/associations
identified from a reference poster (candidate names only - never positions,
spec §10) and resolved for real against SIMBAD/Gaia, alongside the original
20 structural objects - see [Individual stars (v1.2)](#individual-stars-v12)
and [Additional star clusters (v1.2)](#additional-star-clusters-v12) below.
Scaling the web viewer for the larger catalog (`InstancedMesh`, label
density) has already shipped (Story #89).

v1.3 (`spec/Idea-v1.3-visual-fidelity-and-navigation.md`) adds a second,
disjoint batch: ~122 individual stars from RECONS's "100 nearest stellar
systems" census, resolved the same way but gated behind camera-distance
(LOD) marker visibility in the web viewer so this dense, close-in batch
doesn't clutter the default/overview zoom - see
[Nearby stars & marker LOD (v1.3)](#nearby-stars--marker-lod-v13) below.

## Setup

```bash
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
[Individual stars (v1.2)](#individual-stars-v12) below) and ~229 additional
star clusters/associations (see
[Additional star clusters (v1.2)](#additional-star-clusters-v12) below),
plus, since v1.3, ~122 individual nearby stars from the RECONS census (see
[Nearby stars & marker LOD (v1.3)](#nearby-stars--marker-lod-v13) below),
plus 35 standalone gap-fill additions - Fomalhaut (issue #207) and 34 more
naked-eye-bright stars including Arcturus, Vega, and Alnilam (issue #213,
see `data/raw/gap_fills/README.md`) -
**992 objects total**. Every record is either resolved live via
SIMBAD/Gaia/VizieR, or built from a cited literature distance; see each
record's `source.reference`. No live network access is required to rebuild
from this checked-in file (spec §14); re-resolving from scratch is a
separate concern handled by `src/local_galactic_structures/data_sources/`.

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

## Additional star clusters (v1.2)

`spec/Idea-v1.2-individual-stars.md` §9 item 4 (Story #90) rounds out the
catalog with the poster's remaining star-cluster/OB-association labels not
already covered by the original 20-object seed catalog - reusing exactly
the same resolution pipeline as [individual stars](#individual-stars-v12)
(Story #88), just `object_type: "star_cluster"` (or `"stellar_association"`
where SIMBAD's own classification says so - see below) instead of `"star"`.

- **Extraction** (Story #87, same poster/methodology as the star candidate
  list): 264 unique candidate cluster names, 2 already present in the
  catalog (`Hyades`, `Pleiades`) and skipped. Full methodology:
  `data/raw/galaxy_map/README.md`.
- **Resolution** (Story #90): of the remaining 262 candidates, **229
  resolved** (226 `star_cluster`, 3 `stellar_association`), **32 genuinely
  unresolved** (`data/raw/galaxy_map/unresolved_clusters.json`), and 1
  duplicate poster label collapsed into a single real object. Each resolved
  cluster/association's real SIMBAD `otype` decided its `object_type`
  honestly - `OpC`/`Cl*`/`GlC` -> `star_cluster`, `As*`/`MGr` ->
  `stellar_association` - rather than forcing every poster label into
  `star_cluster`; a name that resolved to something else entirely (an RR
  Lyrae variable, a reflection nebula) was rejected as a likely wrong
  cross-match and left unresolved instead of fabricated. Dual provenance
  (spec §5) again applies: `source.reference` is the real SIMBAD citation,
  `notes` separately records the Galaxy Map candidate selection.

  The unresolved third mostly reflects small/specialist open-cluster survey
  catalogs (`ASCC`, `COIN-Gaia`, `BH`, `Loden`, `Aveni Hunter`) that aren't
  uniformly cross-identified in SIMBAD's main identifier table - a
  genuine upstream data-coverage gap, not a resolution-method weakness. See
  `data/raw/galaxy_map/README.md`'s "Story #90" section for the full
  breakdown and the otype-based safety check that caught the two near-miss
  false matches.

Catalog stood at **834 objects** (20 original + 585 individual stars +
229 clusters/associations) after v1.2. No web viewer changes were needed
for this batch - the `InstancedMesh` per-`object_type` bucketing and color
mapping added by Story #89 already cover `star_cluster`/`stellar_association`
generically.

## Nearby stars & marker LOD (v1.3)

Issue #104 (spec `Idea-v1.3-visual-fidelity-and-navigation.md` §2.4) adds
the follow-up v1.2 §4 explicitly deferred: v1.2's poster-sourced stars are
a "luminous star" (bright/distant) selection, not a complete close-in
census - most real nearby stars (mostly faint red/white dwarfs) never
appeared on that poster at all.

- **Source**: RECONS (Research Consortium On Nearby Stars) "The 100
  Nearest Star Systems" table (`astro.gsu.edu/RECONS/TOP100.posted.htm`),
  100 ranked systems / 142 individual components, live-fetched 2026-08-18.
  Full methodology, results breakdown, and dedup notes:
  `data/raw/recons/README.md`.
- **Resolution**: same `SimbadResolver` dual-provenance pipeline as
  Story #88/#90, just against this different candidate source. **122
  resolved** distinct stars, **13 genuinely unresolved**
  (`data/raw/recons/unresolved_stars.json` - no fabricated guesses), **0**
  rejected for an implausible distance.
- **Dedup**: zero overlap with the existing 834-object catalog (by id,
  name, and every alias in both directions) - expected, since this census
  and the poster's bright-star selection are essentially disjoint
  populations. Within the batch itself, 6 RECONS-listed multi-star systems
  had two or three components that all resolved to the exact same SIMBAD
  record (SIMBAD carries no independent identifier for those individual
  components); each such group was collapsed to one catalog record rather
  than fabricating distinct positions for something the source data
  doesn't distinguish - see `data/raw/recons/README.md`'s dedup table.
- **Provenance**: `source.reference`/`source.catalog` is the real SIMBAD
  citation; `notes` separately cites RECONS as the candidate-selection
  source - never the Galaxy Map poster, since this data doesn't come from
  it (issue #104's own acceptance criteria; covered by
  `tests/test_nearby_stars.py::test_every_nearby_star_has_dual_provenance`).

Catalog now stands at **956 objects** (834 + 122 nearby stars).

### Marker LOD (camera-distance-gated visibility)

This batch is dense within a small radius (max resolved distance ~11.3 pc)
- rendering it unconditionally would reintroduce issue #89's clutter
problem right around the Sun, at the default/overview zoom. Rather than a
new schema field, gating reuses the existing `group.secondary` provenance
tag every resolved record already carries (`"recons-nearest-100"`):

- `web/src/scene/lod.ts` derives the batch's own "collection radius" (the
  farthest distance among tagged objects actually present in the loaded
  scene, rather than a hard-coded constant - spec §28's "must not
  hard-code a permanent limit" principle applied to the LOD threshold too)
  and exposes `passesDenseBatchLod(obj, cameraDistanceFromOriginPc,
  collectionRadiusPc)`: any non-member object always passes; a
  dense-batch member passes only once the camera itself (not the object)
  is within the collection radius of the Sun.
- `web/src/scene/objects.ts`'s `isCatalogObjectVisible` composes this with
  the pre-existing category-toggle/radius-filter rules (all three must
  pass), and a new `updateDenseBatchLod` cheaply re-applies just the LOD
  check every animation frame - touching only the dense batch's own
  instances (not the full ~956-object catalog) so it stays cheap enough to
  run continuously as the camera moves, unlike the full
  `updateCatalogVisibility` pass (still only run on an actual filter
  change).
- `main.ts` wires this in: the collection radius is computed once when the
  scene loads, `applyDenseBatchLod()` runs every frame in the render loop
  alongside the existing per-frame label-visibility update, and "Fit all"/
  the Inspector's selected-object visibility check both respect the same
  LOD rule so nothing disagrees about what's actually on screen.

Covered by `web/test/lod.test.ts` (the predicate/radius-derivation logic in
isolation) and the "dense-batch LOD" tests added to `web/test/objects.test.ts`
(how `objects.ts` composes it with category/radius filtering).

## Spectral type & absolute magnitude (Story #170)

`SimbadResolver` now additionally requests the `sp_type` (MK spectral type,
e.g. `"G2V"`) and `V` (apparent V-band magnitude) VOTable fields, stored on
`schema.py`'s `Visual.spectral_type` (raw SIMBAD string, un-normalized - a
later frontend Story owns bucketing it into a fixed taxonomy) and
`Visual.absolute_magnitude` (derived via the standard distance modulus,
`M = m - 5*log10(d_pc) + 5`, from SIMBAD's V magnitude and the record's own
`distance_pc` - `data_sources.simbad.absolute_magnitude_from_distance_modulus`).
Either is `None` when SIMBAD has no usable value on file - never fabricated.
(Note: the votable field name for apparent V magnitude is `V`, not the older
`flux(V)` syntax - `flux(V)` is rejected by the installed astroquery 0.4.11;
verified empirically via `Simbad.list_votable_fields()` and a live query.)

Because `CachingObjectResolver.resolve()` reads the on-disk cache under
`data/raw/simbad/` and skips the network unless `force_refresh=True`, adding
these fields had no effect on the 707 already-cached star records until they
were explicitly re-fetched. That one-time (repeatable) re-fetch was done via
`scripts/refresh_star_spectral_and_magnitude.py`, which recovers each
record's original SIMBAD query string from its cache file (cache filename is
`slugify(query)`, while the catalog `id` is `slugify(main_id)` - the script
reconstructs the mapping from the cache files themselves rather than
guessing a query from the record's `name`/aliases), re-resolves it with
`force_refresh=True` (retrying transient failures with backoff, continuing
past any single star's failure), and merges only the two new `visual.*`
fields back into `data/normalized/initial_catalog_records.json` - every
other field (position, distance, aliases, group tags, dual-provenance
notes) is left untouched. Result of the full run against live SIMBAD:
**707/707 stars re-fetched with zero failures**; **703/707 (99.4%)** got a
non-null `spectral_type` and **680/707 (96.2%)** a non-null
`absolute_magnitude` - the remainder reflects genuine upstream gaps (e.g.
`Wolf 424 A`/`Wolf 424 B`'s individual SIMBAD entries carry no `sp_type`
even though the system as a whole is a well-known M dwarf binary), not a
resolution-method weakness. Re-run it (`python
scripts/refresh_star_spectral_and_magnitude.py`) any time the SIMBAD
adapter's fields change again.

`scene.py`'s `_object_to_scene_entry` exports both fields; the checked-in
`web/public/data/scene.json` was regenerated after the re-fetch via
`galactic-structures export-scene --no-radius-filter --output
web/public/data/scene.json` (matching the pre-existing file's own
no-radius-filter convention - it already included all 956 objects, 64 of
them beyond the CLI's 800 pc default).

## Exoplanet cross-match (Story #171)

Adds confirmed-exoplanet data from a third, separate service - the NASA
Exoplanet Archive (IPAC/Caltech), not SIMBAD or Gaia - via
`data_sources/nasa_exoplanet_archive.py`. Architecturally different from
`SimbadResolver`/`GaiaResolver`: those adapters query and cache one named
object at a time; this module instead makes exactly ONE live
`astroquery.ipac.nexsci.nasa_exoplanet_archive.NasaExoplanetArchive
.query_criteria` pull of the whole `pscomppars` table ("Planetary Systems
Composite Parameters" - the curated, one-row-per-planet table, not the raw
multi-row-per-planet `ps` table), caches that single bulk snapshot at
`data/raw/nasa_exoplanet_archive/pscomppars_bulk.json` (reusing the same
`CacheRecord`/`write_cache`/`update_manifest` provenance helpers every
other adapter uses, just keyed by one fixed dataset name instead of one
cache file per star), and cross-matches every catalog star's existing
`aliases` against it entirely in local Python afterward - no further
network round-trips.

Cross-matching tries each catalog star's `aliases` against the archive's
`hd_name`/`hip_name`/`tic_id`/`gaia_dr3_id`/`gaia_dr2_id` columns, in that
priority order (`ExoplanetCrossMatcher`/`find_matching_hostname`), and
attaches planets by the archive's own component-qualified `hostname` (e.g.
`"eps Ind A"`), never by a substring match on the bare system name - this
is what keeps multi-star systems correct (e.g. `alf Cen A`/`alf Cen B`,
`omi02 Eri`/`omi02 Eri B`/`omi02 Eri C` for 40 Eridani A/B/C each have
their own distinct HD/HIP/TIC/Gaia identifiers in the archive, so an
identifier match can only ever land on the correct component). One
column-naming correction found during development: the archive has no
single `gaia_id` column (requesting it raises `ORA-00904: 'GAIA_ID':
invalid identifier`) - it splits Gaia cross-match into `gaia_dr2_id` and
`gaia_dr3_id`, both of which are indexed since a star's SIMBAD-derived
aliases can carry either release's designator.

New `schema.py` models: `PlanetSummary` (name required; orbital period,
minimum mass, radius, discovery method/year/facility all optional - `None`
rather than fabricated when the archive has no usable value, e.g.
`radius_earth` for a non-transiting RV-only detection) and
`ExoplanetSummary` (count, planets, source reference/url).
`AstronomicalObject.exoplanets: ExoplanetSummary | None` is `None` for the
common case of no confirmed exoplanet on file. `catalog.py`'s
`to_record`/`from_record` round-trip it through parquet/CSV as a single
`exoplanets_json` JSON-string column (unlike the plain-scalar `visual_*`
columns, `exoplanets` nests a variable-length list of sub-objects that is
absent for the overwhelming majority of rows, which JSON-string storage
sidesteps more robustly than an Arrow nested-struct column would).
`scene.py` exports it as its own top-level `"exoplanets"` scene key (same
flattening convention Story #170 established for `spectral_type`/
`absolute_magnitude`).

The one-time (repeatable) cross-match run - `scripts/crossmatch_exoplanets.py`
- merges only the top-level `exoplanets` field into
`data/normalized/initial_catalog_records.json` for every `object_type:
"star"` record, leaving everything else untouched. Result against the live
archive: **35 of the 707 star records** matched a confirmed exoplanet host
- **34 of those 35 carry the `recons-nearest-100` group tag** (the ~122-star
RECONS nearest-neighbors subset the research for this Story identified as
where real coverage concentrates: Proxima Centauri (2 planets), Barnard's
Star (4), GJ 876 (4), tau Ceti (3), epsilon Eridani, epsilon Indi, 82
Eridani (4), Teegarden's Star (3), YZ Ceti (3), Wolf 1061 (3), GJ 1061 (3),
and more), confirming the cross-match is not over- or under-matching. The
one exception - HD 81817, a K giant at ~305 pc in the 585-star "distant
giants" subset with two literature-confirmed RV planets (HD 81817 b/c,
discovered 2020/2022) - is a genuine host, not a false positive (its HD/
HIP/TIC/Gaia identifiers all agree exactly between the catalog record and
the archive), consistent with the research's "near-zero, not necessarily
exactly zero" expectation for that subset.
`galactic-structures build-catalog` + `galactic-structures export-scene
--no-radius-filter --output web/public/data/scene.json` regenerated the
checked-in catalog/scene artifacts (same recipe as Story #170).

## Stellar space-velocity data (Story #230)

Idea #3 of Epic #229 (velocity vectors). Adds each nearby star's real 3D
space velocity - heliocentric Galactic Cartesian `vx`/`vy`/`vz` km/s, the
same axis convention `cartesian.{x,y,z}_pc` already uses for position - so
a later Story (#231, frontend) can draw a directional arrow starting at
each star's own position.

`SimbadResolver` now additionally requests the `pmra`/`pmdec` (proper
motion, mas/yr - `pmra` is already SIMBAD's own cos(dec)-corrected
convention) and `rvz_radvel` (radial velocity, km/s) VOTable fields, plus
`pm_bibcode`/`rvz_bibcode` for provenance. `coordinates.galactic_velocity_kms`
derives the Cartesian vector via the identical astropy ICRS -> Galactic
transform already applied to position (`SkyCoord(..., pm_ra_cosdec=...,
pm_dec=..., radial_velocity=...).galactic.velocity`). New `schema.py`
model: `Velocity` (`vx_kms`/`vy_kms`/`vz_kms`, `radial_velocity_known`,
its own `source`), exposed as a top-level `AstronomicalObject.velocity:
Velocity | None` field - NOT nested under `visual`, mirroring
`exoplanets`' own precedent (physical/kinematic data, not a rendering
style).

Two distinct "never fabricate" cases (spec §11), both in
`data_sources.simbad._derive_velocity`:

* `pmra`/`pmdec` themselves absent - the whole velocity is unresolvable,
  `velocity: None` entirely (never a fabricated zero vector).
* `pmra`/`pmdec` present but `rvz_radvel` absent - astropy silently
  defaults radial velocity to 0 km/s rather than erroring, so the result is
  a *tangential-only* vector; `radial_velocity_known: False` flags this so
  it is never presented as a complete 3D space velocity.

Pipeline scope (Epic #229): velocity is fetched only for stars within the
current RECONS-dense-batch sphere, by REAL `distance_pc` - not the
`recons-nearest-100` group tag, which 5 genuinely-in-range gap-fill stars
(Fomalhaut, Arcturus, Vega, Pollux, Denebola; #211's deliberate provenance
exclusion) are missing from. `scripts/backfill_velocity.py` derives the
sphere's radius from the data itself - the max `distance.value_pc` among
currently `recons-nearest-100`-tagged records, mirroring the frontend's own
`lod.ts` `denseBatchCollectionRadiusPc` derivation exactly - rather than a
hard-coded constant, then re-fetches (`force_refresh=True`, since every
in-scope star's SIMBAD cache predates these fields) each in-scope star and
merges only the top-level `velocity` field back into
`data/normalized/initial_catalog_records.json`, leaving everything else
untouched (same non-destructive convention as Story #170/#171's own
scripts).

Result against live SIMBAD: **127/127 in-scope stars resolved, 0
failures** - **118 (92.9%) got a full 3D vector** (`radial_velocity_known:
true`), **9 (7.1%) came back tangential-only** (`radial_velocity_known:
false` - SIMBAD had `pmra`/`pmdec` but no `rvz_radvel`), and **0 were
entirely unresolvable** (every one of the 127 had `pmra`/`pmdec` on file).

Sanity gate (spot-checked against literature during development, not just
against the issue's own quoted number): Barnard's Star derives to a total
space velocity of **142.3 km/s** (literature: ~142 km/s); Proxima Centauri
derives to **~31.5 km/s** (literature, Kervella et al. 2017, for the whole
alpha Centauri system relative to the Sun: ~32.4 km/s); 61 Cygni A - one of
the best-known "flying stars" - derives to **~109.5 km/s**, consistent with
its historical reputation for unusually high proper motion.

`scene.py` exports `velocity` verbatim as its own top-level scene key
(same flattening convention as `spectral_type`/`absolute_magnitude`/
`exoplanets`), `null` when absent (never null-padded). `catalog.py` rounds
it through parquet/CSV as a `velocity_json` JSON-string column, same
convention `exoplanets_json` established (a nested optional object that is
`None` for the overwhelming majority of rows).
`galactic-structures build-catalog` + `galactic-structures export-scene
--no-radius-filter --output web/public/data/scene.json` regenerated the
checked-in catalog/scene artifacts from a clean venv matching the
test-runtime pyarrow version (standing lesson from PR #183).

Frontend rendering (vector arrows, sphere-gated toggle) is explicitly out
of scope for this Story - Story #231's job. `web/src/scene/sceneTypes.ts`
is intentionally untouched; the extra `velocity` key in `scene.json` is
additive and does not affect the existing (untyped-at-runtime) frontend
pipeline or its own test suite (495/495 passing, `tsc --noEmit` clean).

## Local Bubble velocity backfill (Story #286)

Epic #285's Story 1 (of 2). Widens Story #230's velocity backfill from the
RECONS-dense-batch sphere (~11.26pc) to the full Local Bubble (~60pc,
`bubbleOuterRadiusPc`): 29 already-cataloged, named (`"NAME "`-alias)
stars within the bubble had no `velocity` yet - every one of them added by
earlier gap-fill Stories, none part of Story #230's original 127.

Target list re-derived live (not trusted from the Epic's own research
summary): every `object_type: "star"` record with `distance.value_pc <=`
the Local Bubble's outer radius and no `velocity` key/value. The radius
itself is re-derived from `models/local_bubble.yaml` -
`(semi_axes_pc.a_pc + semi_axes_pc.b_pc) / 2` - the exact same mean-of-
the-two-shorter-axes formula the frontend's `objects.ts`'s
`bubbleOuterRadiusPcFrom` applies to the same YAML's `scene.json`-exported
form, never hard-coded to 60. It currently evaluates to 60.0pc (matching
both the frontend's own derivation and the `local-bubble-centroid` catalog
record's independently-set `visual.size_pc: 60.0`), yielding exactly 29
target stars - confirming the Epic's own estimate, not just trusting it.

New script `scripts/backfill_bubble_velocity.py` reuses Story #230's exact
pipeline (`SimbadResolver`, `coordinates.galactic_velocity_kms`,
`schema.Velocity`) unchanged - it only narrows scope to this specific
29-star list (`in_bubble_velocity_missing_star_records`), rather than
re-running the same unconditional refresh `backfill_velocity.py` already
did for the 127 RECONS-sphere stars (which already have `velocity` from
that Story and are correctly left untouched here).

Result against live SIMBAD: **29/29 resolved, 0 failures, 29/29 (100%)
got a full 3D vector** (`radial_velocity_known: true`) - every target star
had both `pmra`/`pmdec` and `rvz_radvel` on file, so there were no
tangential-only or entirely-unresolvable cases this round.

Implausible-velocity scan (issue #234's `|speed| > 500` km/s pitfall):
the highest derived total space velocity among the 29 is Aldebaran's
**57.7 km/s** - nowhere near the threshold, so `_query_mes_velocities`'s
`mesVelocities` fallback (already generically wired into
`data_sources/simbad.py`, not per-star) was correctly never triggered for
any of these 29 (verified: none of their 29 refreshed cache files under
`data/raw/simbad/` gained an `rvz_radvel_corrected` key; the one file that
has one, `gj_866_a.json`, predates this Story and is issue #234's own
unrelated RECONS-sphere fix).

Sanity gate (spot-checked against literature, same practice #230/#234
used):

- **Capella** derives to a total space velocity of **39.7 km/s**;
  independent published figure (constellation-guide.com, citing its own
  kinematic sourcing): "travelling through the Milky Way at a speed of
  39.7 km/s relative to the Sun" - matches to three significant figures.
- **Aldebaran** derives to **57.7 km/s**. Its SIMBAD-sourced astrometry
  used here (`pmra=63.45`, `pmdec=-188.94` mas/yr, `plx=48.94` mas) agrees
  with Wikipedia's independently-cited values for the same star; combining
  its tangential velocity (`4.74057 * mu_arcsec/yr * d_pc`, ~19.3 km/s)
  with its radial velocity (~54.4 km/s) via `sqrt(vt^2 + vr^2)` - a
  simple, independent cross-check of the total speed's magnitude, not a
  re-run of the pipeline itself - reproduces **57.7 km/s**.
- **Achernar** derives to **21.0 km/s**, cross-checked the same
  independent tangential+radial way as Aldebaran above (`pmra=87.0`,
  `pmdec=-38.24` mas/yr, `plx=23.39` mas, `rv=8.47` km/s -> ~21.0 km/s).
  Its SIMBAD `rvz_radvel` (8.47 km/s) differs from one commonly-quoted
  literature figure (+16 km/s); both are physically unremarkable (nowhere
  near the >500 km/s implausibility threshold) and Achernar is a known
  rapidly-rotating Be star with a circumstellar disk, where radial-velocity
  measurements from different epochs/methods commonly disagree by this
  much due to variable emission-line contamination - not the kind of
  two-orders-of-magnitude cross-match artifact issue #234 found, so no
  correction was warranted or applied.

`catalog.parquet`/`catalog.csv` rebuilt and `scene.json` re-exported the
same way as Story #230 (`galactic-structures build-catalog` +
`galactic-structures export-scene --no-radius-filter --output
web/public/data/scene.json`), from a clean venv matching the test-runtime
pyarrow version (standing lesson from PR #183). `pytest` (310 passed, 4
skipped) and the frontend's own suite (617/617 passing, `tsc --noEmit`
clean) both green - `web/src/scene/sceneTypes.ts` is untouched, same as
Story #230.

Frontend widening (animated-population selection + sphere-gating from the
RECONS sphere to the full Local Bubble) is explicitly out of scope for
this Story - Story #287's job.

## Velocity for the 77 newly-acquired Local Bubble stars (Story #296)

Epic #294's Story 2 (of 2). Story #295 (merged) acquired 77 new named
bright stars (V<4.0, 11-60pc, genuinely `NAME `-prefixed) into the catalog
but deliberately stripped `velocity` from every one of them - a
scope-separation fix from that Story's own review (PR #297). This Story
derives and populates `velocity` for that exact batch.

Target list re-derived from the CURRENT catalog by the `group.secondary`
provenance tag Story #295 wrote (`local-bubble-bright-named-gap-fill`),
per this Story's own acceptance criteria - not trusted as "77" without
checking. Confirmed: **exactly 77** records carry the tag, none had
`velocity` yet. (As a cross-check, the radius+missing-velocity filter
`backfill_bubble_velocity.py` already uses independently agrees: 77
records in the full ~60pc Local Bubble currently lack `velocity`, the
same 77.)

New script `scripts/derive_bubble_gap_fill_velocity.py` reuses Story
#230/#286's exact pipeline (`SimbadResolver`, `coordinates.
galactic_velocity_kms`, `schema.Velocity`) unchanged, scoped by the
provenance tag rather than radius - see the script's own docstring for
why the tag is the correct, future-proof selector here. Every one of the
77 already had a cache file under `data/raw/simbad/` from Story #295's
own acquisition (position/spectral-type resolution goes through the same
`SimbadResolver`), so no manual id list was needed.

**Bug found and fixed along the way**: `refresh_star_spectral_and_
magnitude.build_id_to_query` (reused unchanged by every velocity script
since Story #286) crashed on `data/raw/simbad/
backfill_bubble_velocity_failures.json`, a non-cache-record `[]` artifact
checked in by Story #286's own `--failures-output` default - the helper's
`cache_dir.glob("*.json")` loop assumed every file was a `{query, raw,
...}` cache-record dict. Fixed with a one-line `isinstance(data, dict)`
guard before the crash could block this Story (or any future one reusing
the same helper).

Result against live SIMBAD: **77/77 resolved, 0 failures, 77/77 (100%)
got a full 3D vector** (`radial_velocity_known: true`) - matching the
Epic's own bulk pre-acquisition SIMBAD check (100% pmra/pmdec/rvz_radvel
coverage, no drop-off across magnitude bands). Zero tangential-only,
zero unresolvable.

Implausible-velocity scan (issue #234/#286's `|speed| > 500 km/s`
pitfall): the fastest of the 77 is Delta Virginis (`del_vir`) at
**130.1 km/s** - a real, unremarkable disk-star speed, nowhere near the
threshold. No star triggered `_query_mes_velocities`'s `mesVelocities`
fallback. This scan is now also a permanent `pytest` regression guard
(`test_gap_fill_stars_carry_velocity`, `tests/
test_local_bubble_bright_star_gap_fill.py`), not just a one-time
PR-documented check.

Sanity gate (spot-checked against literature, same practice #230/#286
used):

- **Alpheratz** (`alf_and`) derives `rvz_radvel=-10.1` km/s (SIMBAD) ->
  total space velocity **31.8 km/s**. Independent literature figure: an
  RV of **-10.6 ± 0.3 km/s** - matches to within 0.5 km/s, well inside
  typical measurement precision.
- **Menkent** (`tet_cen`) derives to **62.8 km/s** total
  (`vt≈62.8` km/s tangential, `rv=1.3` km/s radial - almost entirely
  transverse motion). Independent literature: described as moving "across
  our line of sight at **65 km/s**, twice the normal value" with radial
  velocity "+1.3 km/s" - both the magnitude (62.8 vs ~65 km/s) and the
  radial velocity (exact match) agree, and the "twice normal, high proper
  motion" characterization independently confirms this star's real speed
  is genuinely unusual (not a data-quality artifact).
- **Alioth** (`eps_uma`) derives `rvz_radvel=-12.7` km/s (SIMBAD) -> total
  space velocity **18.5 km/s**. One independent literature source cites
  RV **-9.3 km/s** - same sign, same order of magnitude, but a ~3 km/s
  disagreement; consistent with #286's own established precedent
  (Achernar) that RV measurements from different epochs/methods commonly
  disagree by a few km/s for bright, well-studied stars without that
  disagreement being a data-quality issue - well short of the >500 km/s
  implausibility threshold either way.

`catalog.parquet`/`catalog.csv` rebuilt and `scene.json` re-exported the
same way as Story #230/#286 (`galactic-structures build-catalog` +
`galactic-structures export-scene --no-radius-filter --output
web/public/data/scene.json`), from a clean venv matching the test-runtime
pyarrow version (25.0.1, standing lesson from PR #183). `pytest` (322
passed, 4 skipped) and the frontend's own suite (622/622 passing, `tsc
--noEmit` clean) both green.

**Live browser verification** (no frontend code change): started a fresh
dev server on a dedicated port/tab, clicked "Fit to Local Bubble" (auto-
activates Vectors + Time Controls via Story #290's persistent override),
searched for and selected Menkent - one of the 77 newly-velocity'd stars
- and confirmed its `62.8 km/s` vector label rendering exactly as
derived. Pressing play on the motion player visibly moved Menkent away
from the Sun with a motion trail after +57,054 simulated years. Worked
automatically via Epic #285's existing `starsWithVelocityInLocalBubble`
population selection, exactly as expected - zero frontend code changes
were needed.

## Open-space velocity backfill (Story #307)

Epic #306's first Story: backfill `velocity` for the ~587 EXISTING star
records beyond the full Local Bubble (~60pc, up to ~1840pc) that had
`velocity: null` since they were originally acquired - unlike Epic #294's
Local Bubble gap-fill (Story #295/#296), these are not new records, this
Story only merges a `velocity` block into records that already had real
position/distance/notes/group/aliases.

Scope re-derived live from the current catalog (not trusted as "587"
without checking): every `object_type: "star"` record with real
`distance.value_pc` strictly greater than the Local Bubble's outer radius
(`bubble_outer_radius_pc`, the same live `(a_pc + b_pc) / 2` derivation
`backfill_bubble_velocity.py` already uses - currently 60.0pc) and no
`velocity` on file. Confirmed: **exactly 587** records matched, all 587
with `velocity` absent.

New script `scripts/backfill_open_space_velocity.py` reuses Story
#230/#286/#296's exact pipeline (`SimbadResolver`, `coordinates.
galactic_velocity_kms`, `schema.Velocity`, including the
`_IMPLAUSIBLE_RV_KMS_THRESHOLD`/`mesVelocities` implausible-RV fallback)
unchanged - it only widens scope to the complementary (`>` radius) side of
`backfill_bubble_velocity.py`'s own boundary test, importing that script's
`bubble_outer_radius_pc` helper directly rather than re-deriving the
boundary a third way. Every one of the 587 already had a cache file under
`data/raw/simbad/` from its original catalog acquisition, so no manual id
list was needed. A small `--sleep` (0.3s) delay between live queries was
added as a politeness measure this being real, ~587-query wall-clock
acquisition, on top of the existing `--retries`/`--backoff` transient-
failure handling.

Result against live SIMBAD: **587/587 resolved, 0 query failures, 0
honest-failures** (no star had `pmra`/`pmdec` entirely absent) - matching
the Epic's own pre-acquisition 161-star stratified sample (100% full PM+RV
coverage). Breakdown: **574/587 (97.8%) full 3D vectors**
(`radial_velocity_known: true`), **13/587 (2.2%) tangential-only**
(proper motion resolved, no `rvz_radvel` on file). Zero unresolvable.
Implausible-speed scan (`|v| > 500` km/s): **none** - re-checked as a
permanent `pytest` regression guard
(`test_no_open_space_star_has_an_implausible_derived_speed`,
`tests/test_open_space_velocity_backfill.py`).

**tau Sco anomaly, confirmed and corrected exactly as the Epic
predicted**: its default SIMBAD `rvz_radvel` cross-match is **-650.47
km/s** (bibcode `2023A&A...676A.129H`), which `_query_upstream`'s existing
`_IMPLAUSIBLE_RV_KMS_THRESHOLD` guard flagged and routed through
`_query_mes_velocities`, which found a plausible independent measurement
(**1.2 km/s**, bibcode `1928PLicO..16....1C`) - deriving a sane total
space velocity of **17.2 km/s** instead of a nonsensical ~650 km/s one.
No other star among the 587 tripped the implausible-RV guard.

Honest-failure handling (this Story's own acceptance criterion): a star
resolving against SIMBAD with no `pmra`/`pmdec` on file at all would get
no `velocity` block, recorded with a clear explanation in
`data/raw/simbad/backfill_open_space_velocity_unresolved.json` (checked in
as `[]` - none occurred) - a separate checked-in artifact rather than text
appended to the star's own `notes` field, since this Story's acceptance
criteria explicitly forbid touching `notes` (or position/distance/group/
aliases) on these already-curated records. A tangential-only star (proper
motion resolved, radial velocity not) is NOT a failure - it is
`_derive_velocity`'s own established partial-resolution case and still
gets a real (if 2D) velocity block, same as every prior Story's stars.

**Byte-identical regression guard** (mirroring Story #295/#296's own "no
accidental field changes" tests and PR #183's clean-venv/pyarrow lesson):
`tests/test_open_space_velocity_backfill.py` compares an 18-star sample
(spanning the full ~70-1840pc distance range, including Betelgeuse, Alpha
Crucis, and tau Sco) against a frozen pre-backfill snapshot
(`tests/fixtures/pre_open_space_velocity_backfill_sample.json`, captured
from this Story's own branch point) - `name`/`aliases`/`coordinates`/
`distance`/`cartesian`/`group`/`notes` all byte-identical, only `velocity`
added. Independently re-verified across **all 1079** catalog records (not
just the 18-star test sample) by diffing every non-`velocity` field
between the pre- and post-backfill `initial_catalog_records.json`: **zero**
records had any other field change.

Spot checks (Story #307's own required hand-verification, re-asserted as
permanent regression guards):

- **Betelgeuse** (`alf_ori`, ~152.7pc): derives to a total space velocity
  of **30.7 km/s** (`radial_velocity_known: true`) - a physically sane
  peculiar velocity for a well-studied nearby red supergiant.
- **Alpha Crucis** (`alf_cru`, ~98.7pc): derives to **21.7 km/s**
  (`radial_velocity_known: true`) - likewise unremarkable.
- **tau Sco** (`tau_sco`, ~145.3pc): derives to **17.2 km/s** via the
  `mesVelocities` correction above, not the implausible ~650 km/s default.

`catalog.parquet`/`catalog.csv` rebuilt and `scene.json` re-exported the
same way as every prior velocity Story (`galactic-structures build-catalog`
+ `galactic-structures export-scene --no-radius-filter --output
web/public/data/scene.json`), from a clean venv matching the test-runtime
pyarrow version (25.0.1, standing lesson from PR #183). `pytest` (333
passed, 4 skipped) green.

Frontend (`web/`) was not touched or re-verified in the browser for this
Story - `sceneTypes.ts`'s `velocity` field is already exercised by the
204 RECONS/Local-Bubble stars carrying it since Story #230/#286/#296, this
Story only adds more data of the identical shape, and the UI gate that
would let a user actually reach these open-space stars with Vectors/Time
Controls enabled is Story #308's job (not yet done) - there is nothing new
to browser-verify here yet.

## `size_pc` backfill for clusters, associations & diffuse structures (Story #314)

Epic #313's first Story ("give star clusters and diffuse structures real
visual size"): backfill `visual.size_pc` for the ~254 EXISTING
`star_cluster`/`stellar_association`/`molecular_cloud`/`hii_region`/
`planetary_nebula`/`supernova_remnant` records that had `size_pc: null`
since they were originally acquired - same non-destructive backfill shape
as Story #307's own velocity backfill: only `visual.size_pc` is merged
into each in-scope record, every other field (position/distance/notes/
group/aliases) stays byte-identical.

Scope re-derived live from the catalog (not trusted blindly): every record
of the six target `object_type`s with `visual.size_pc` null/absent -
**exactly 254** matched (228 `star_cluster` + 10 `stellar_association` +
8 `molecular_cloud` + 5 `hii_region` + 4 `planetary_nebula` + 2
`supernova_remnant` = 257 total, minus the 4 already populated at Epic
research time - Pleiades, Cepheus Flare, the Local Bubble centroid
(out of this Story's scope - `bubble` type), and the Vela SNR).

**Radius-vs-diameter convention** (this Story's own required judgment
call, made by reading `markerRadiusPc` in `web/src/scene/objects.ts` -
convention-agnostic, just a shared divisor/clamp - together with the
`notes` already on the 4 pre-existing populated records, which explicitly
say which convention each one used): `star_cluster`/`stellar_association`
records use **RADIUS** (the Pleiades record's own notes: "the tidal
radius..., not a diameter"); `molecular_cloud`/`hii_region`/
`planetary_nebula`/`supernova_remnant` records use **DIAMETER** (Vela
SNR's own notes: "an approximate physical diameter"; Cepheus Flare's own
notes: "spans ~90x60 pc..., uses the larger axis" - a full span, not a
half-span). Each record-type family was backfilled in its own existing
precedent's convention rather than unifying to one convention catalog-
wide, since a unified convention now would have required silently
reinterpreting the 4 already-populated records, out of this Story's scope.

**Sources** (see `scripts/backfill_structure_size.py`'s own module
docstring, and the new `data_sources/cluster_radius.py`/`data_sources/
simbad_size.py` adapters, for the full paper-lineage rationale):

- `star_cluster`/`stellar_association`: this catalog's own cluster/
  association records already trace to the Cantat-Gaudin/Tarricq
  Gaia-membership open-cluster lineage via their own `source.reference`
  `coo_bibcode`s (e.g. `2021A&A...647A..19T`). Cascade: **(1)** Tarricq et
  al. 2022 ("Structural parameters of 389 local open clusters", VizieR
  `J/A+A/659/A59`) tidal radius `Rt` (pc, already in parsecs), **(2)** the
  same table's core radius `Rc` when `Rt` is unavailable, **(3)**
  Cantat-Gaudin et al. 2020 ("Gaia DR2 open clusters in the Milky Way II",
  VizieR `J/A+A/633/A99`, the larger 1481-cluster parent catalog) `r50`
  (degrees, converted to pc via the record's own `distance_pc`), **(4)**
  SIMBAD `galdim_majaxis` (arcmin) -> diameter via `distance_pc`, halved
  to a radius - reserved for large OB associations/loose "Theia" moving
  groups not compact enough for a membership-catalog radius.
- `molecular_cloud`/`hii_region`/`planetary_nebula`/`supernova_remnant`:
  SIMBAD `galdim_majaxis` (arcmin) -> physical diameter via `distance_pc`
  directly (no halving) - the new `data_sources/simbad_size.py` adapter,
  a narrowly-scoped sibling to `simbad.py` (which was built for
  kinematics, not angular size).

**Result: 239/254 (94.1%) resolved, 15/254 (5.9%) honest failures.**
Breakdown by method: `tarricq2022_Rt` 79, `cantat_gaudin_2020_r50` 116,
`simbad_galdim_halved` 27 (clusters/associations, 222 total); plus
`simbad_galdim_diameter` 17 (diffuse structures). The 15 honest failures
are concentrated in large-scale OB associations/moving groups with no
well-defined structural radius in either source - Cepheus OB2/3/4, Orion
OB1, Perseus OB2, Vela OB2, Scorpius-Centaurus, the Hyades, the two
Kounkel & Covey 2019 "Theia" groups (`[KC2019] Theia 75`/`80`) - plus 3
individual clusters absent from both bulk catalogs and with no SIMBAD
`galdim_majaxis` (`ubc_159`, `ngc_1980`, `ngc_1981`), and M8 the Lagoon
Nebula (resolves on SIMBAD under every alias tried - `NGC 6523`, `Lagoon
Nebula`, `Sh 2-25`, `NAME Lagoon Nebula`, `GRS G006.00 -01.20`, `LBN 25` -
but none carries `galdim_majaxis`). Per-record source/method/failure-
reason is checked in at `data/raw/cluster_radius/
backfill_structure_size_results.json` (mirrors Story #307's own
`--unresolved-output` convention: this provenance cannot live in `notes`,
since this Story's acceptance criteria forbid touching it).

**Byte-identical regression guard, full record set** (an explicit
escalation over Story #307's own 18-record sample, since this Story's
acceptance criteria call for full-set verification):
`tests/test_structure_size_backfill.py`'s
`test_full_record_set_is_byte_identical_except_visual_size_pc` diffs
every field except `visual.size_pc` across **all 1079** catalog records
against a full pre-backfill snapshot (`tests/fixtures/
pre_size_pc_backfill_full_snapshot.json`) - zero non-`size_pc` field
changes found.

Spot checks (re-asserted as permanent regression guards):

- **M42/the Orion Nebula** (`m42_orion`): SIMBAD `galdim_majaxis=66`
  arcmin at `distance_pc=433` -> **8.31 pc** diameter - well within the
  nebula's commonly cited several-pc visible extent; position/notes/
  aliases confirmed untouched.
- **Pleiades**/**Vela SNR**/**Cepheus Flare** (already-populated
  precedent records): confirmed unchanged (`11.6`/`40.0`/`90.0` pc
  respectively) - this Story never touches an already-populated record.

`catalog.parquet`/`catalog.csv` rebuilt and `scene.json` re-exported the
same way as every prior Story (`galactic-structures build-catalog` +
`galactic-structures export-scene --no-radius-filter --output
web/public/data/scene.json`), from a clean venv matching the test-runtime
pyarrow version (25.0.1, standing lesson from PR #183). `pytest` (361
passed, 4 skipped) green.

Frontend (`web/`) was not touched for this Story - `size_pc` is already
wired into `markerRadiusPc`, so clusters/associations with a newly
backfilled value will nudge their existing point-marker radius on the
next page load, but no rendering-code change was made; the diffuse-
structure extended-volume rendering this data enables is Story #315's job
(not yet started, depends on this Story merging first).
