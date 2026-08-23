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
[Individual stars (v1.2)](#individual-stars-v12) below) and ~229 additional
star clusters/associations (see
[Additional star clusters (v1.2)](#additional-star-clusters-v12) below),
plus, since v1.3, ~122 individual nearby stars from the RECONS census (see
[Nearby stars & marker LOD (v1.3)](#nearby-stars--marker-lod-v13) below) -
**956 objects total**. Every record is either resolved live via
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
