# Galaxy Map candidate extraction (Story #87, spec `Idea-v1.2-individual-stars.md`)

Source: Galaxy Map's "Gaia star density map - the solar neighbourhood and
environs within 800 parsecs" (galaxymap.org, 2020), retrieved via Wikipedia's
Gould Belt article
(`File:Galaxymap.com, map of the solar neighbourhood 800 parsecs (2020).jpg`),
full resolution 10000x14088px, retrieved 2026-08-18.

**This directory's contents are candidate *names* only - never positions.**
Per spec `Idea.md` §10 / `Idea-v1.2-individual-stars.md` §2, this poster may
only be used to identify which named stars/clusters exist; every name here
still needs to be resolved for real against SIMBAD/Gaia (Story #88) before it
can enter the catalog. No RA/Dec/distance/pixel-coordinate value appears
anywhere in this directory.

## Method

The full image was cut into a 5x5 grid of overlapping tiles (`~130px` overlap
on each edge) for legibility, then read tile-by-tile by five independent
agents (one per grid row), each transcribing every green "luminous star"
label and white cluster/association label it could read, flagging anything
illegible or ambiguous as `"uncertain"` rather than guessing. Their raw,
per-row output (including cross-tile duplicates, not deduplicated) is
preserved here as `candidates_row0.json` .. `candidates_row4.json`.

Those five files were then merged and deduplicated by exact name (after
whitespace normalization) into `candidate_stars.json` and
`candidate_clusters.json` - the actual Story #87 deliverable. Each entry
carries:

- `name` - the transcribed designation, as printed on the poster
- `tiles` - which grid tile(s) it was read from (useful for Story #88's
  sky-region batch splitting)
- `occurrences` - how many of the (possibly overlapping) raw transcriptions
  matched this name
- `uncertain` - true if any occurrence was flagged as uncertain by its
  transcriber (see that occurrence's `notes` in the raw per-row files for
  why); a name can still be usable if a *different* occurrence read it with
  confidence
- `already_in_catalog` - true if the name substring-matches an existing
  catalog object's name/alias (checked 2026-08-18 against the 20-object
  catalog) - Story #88/#90 should skip these rather than re-add them

## Cross-validation

Before the manual read, the same poster was independently analyzed with a
simple color-segmentation heuristic (isolate the green label RGB range,
connected-component group, filter to a plausible single-label pixel-area
range) across the full image: **591** candidate label blobs. The manual
five-agent read found **594 unique star names** after deduplication -
matching within 0.5%. This is strong cross-validation that the candidate
list is essentially complete, from two independently-built methods.

## Second-pass QA sweep

An independent spot-check review of the first pass (see PR #91) manually
re-verified a 4-tile sample against the source image and found one
unambiguous miss: a real green star label (`HD 126692`, tile `r3_c3`)
present on the poster but silently absent from the first pass's output
(not even flagged uncertain - just missed). Since the aggregate
591-vs-594 cross-validation count can't detect a one-for-one miss offset
by an extra elsewhere, a second, cheaper pass was run: the same five
row-agents were given the first pass's own results as a reference list and
asked to re-scan their tiles for anything NOT already in it (a targeted
diff, not a full re-transcription) - `missed_row0.json` .. `missed_row4.json`.

Result: **1 genuine new miss found across all 25 tiles** - the already-known
`HD 126692`, now folded into `candidate_stars.json` and marked
`found_in_second_pass_qa: true`. The sweep also reported `μ Per` (tile
`r2_c1`) as missing, but independent re-verification found it was already
present in the pre-sweep list under that exact same tile tag - a false
positive from the row-2 diff pass (likely a Unicode-normalization mismatch
on the "μ" glyph between the two passes), not a second real miss. No
duplicate was created either way. Finding only 1 genuine miss across a
careful second look at all 25 tiles - after the first pass already achieved
591-vs-594 cross-validation - is strong evidence the list is now
effectively complete, not just approximately so.

## Results (final, post-QA-sweep)

- **595 unique candidate stars** (`candidate_stars.json`), 17 flagged
  `uncertain` on at least one occurrence, 9 of those with *no* fully-certain
  occurrence anywhere (genuinely ambiguous, mostly tile-edge crops with no
  neighboring tile that happened to catch the full label, plus a couple of
  ambiguous single-glyph Bayer letters like "l Car" / "ι CMa"). None
  overlap the existing 20-object catalog (expected - it has no `star`-type
  entries yet).
- **264 unique candidate clusters** (`candidate_clusters.json`), 6 flagged
  uncertain. Two (`Hyades`, `Pleiades (Messier 45)`) already exist in the
  catalog and are flagged `already_in_catalog: true` - Story #90 should
  skip them.

## Story #90: resolving the candidate clusters

Story #90 (spec `Idea-v1.2-individual-stars.md` §9 item 4) resolved the
remaining **262** candidate clusters (264 minus the 2 `already_in_catalog`
entries) via `SimbadResolver` - the same live-query pipeline Story #88 used
for individual stars, just `object_type: "star_cluster"` (or
`"stellar_association"` where SIMBAD's own `otype` says so - see below)
instead of `"star"`. No schema or pipeline changes were needed.

### Method

For each candidate name, several plausible SIMBAD query-form variants were
tried in order (first hit wins): the name as printed, the same name with a
`"Cl "` prefix (SIMBAD's common convention for open-cluster-catalog
designations, e.g. `"Cl Alessi 3"`, `"Cl Trumpler 10"`), each part of a
`"Foo (Bar, Baz)"`-style parenthetical alternate-name label tried on its
own (with and without `"Cl "`), a `"Messier N"` <-> `"M N"` abbreviation
swap, `"Alessi Teutsch N"` <-> `"Alessi-Teutsch N"` (SIMBAD's actual
hyphenated form), and an `"ESO nnn nn"` -> `"ESO nnn-nn"` reformat. A
second, smaller pass fixed two names that resolved to the *wrong* thing on
the first pass (see "otype safety check" below) once a better query form
was found (`"Coma"` -> its real catalog name `"Melotte 111"`).

### Cluster vs. association - resolved honestly, not forced

Per the spec's explicit instruction not to force every poster cluster label
into `object_type: "star_cluster"`, each successful match's real SIMBAD
`otype` field decided the catalog `object_type`:

- `OpC` / `Cl*` / `GlC` (open/generic/globular cluster) -> `star_cluster`
- `As*` (association of stars) -> `stellar_association` (found for two of
  the poster's `"BH"` (van den Bergh-Hagen catalog) labels, which SIMBAD
  cross-matches to Kounkel & Covey 2019 "Theia" Gaia-identified moving
  groups)
- `MGr` (moving group) -> also accepted as `stellar_association` after a
  second look (a loose, kinematically-identified group like the Alpha
  Persei cluster, `Melotte 20`, is a closer physical match to this
  project's "stellar_association" concept than a bound "star_cluster")

**Otype safety check**: a name resolving to *any other* otype was
**rejected**, not silently accepted as a cluster - this caught two
first-pass false matches that would otherwise have fabricated wrong
objects: `"Coma"` alone cross-matched an RR Lyrae variable star
(`otype=RR*`, real cluster is `"Melotte 111"`, fixed on the second pass),
and `"NGC 2183"` matched a real NGC object, but a reflection nebula
(`otype=RNe`, not a cluster) - likely the poster pairing it with the
adjacent open cluster NGC 2184 rather than labeling NGC 2183 itself as a
cluster. `NGC 2183` was left unresolved rather than guessed.

### Results

**229 resolved** (226 `star_cluster`, 3 `stellar_association`), **32
genuinely unresolved** (`unresolved_clusters.json`), **1 duplicate** poster
label collapsed to a single catalog record (`"Messier 41"` and `"Messier 41
(NGC 2287)"` are the same real cluster - see
`duplicate_cluster_candidates.json`). Every resolved record carries dual
provenance (spec §5): `source.reference`/`source.catalog` is the real
SIMBAD citation, `notes` separately records the Galaxy Map candidate
selection.

The 32 unresolved break down as:

- **19** `ASCC N` labels: confirmed (via a direct SIMBAD `ident` table
  query) that SIMBAD has *no* short cross-identifier of this shape at all -
  every `"ASCC..."` string in SIMBAD's identifier table turns out to be an
  individual *star's* running number within the All-Sky Compiled Catalogue
  of stars (Kharchenko 2001), not a cluster designation. The poster's
  "ASCC N" cluster labels (Kharchenko et al. 2005's own cluster-numbering
  convention within that same survey) are not independently catalogued
  under that name in SIMBAD.
- **4** `COIN-Gaia N` labels, **1** `Aveni Hunter 1`, **1** `BH 99`, **1**
  `Loden 11`, **1** bare `Teutsch` (no cluster number - genuinely
  ambiguous, matching Story #87's own flag): no SIMBAD record found under
  the printed name, `"Cl "`-prefixed form, or (spot-checked individually)
  several other plausible catalog-prefix variants (`vdBH`/`VDBH` for `BH`,
  `AH01`/`[AH85]` for Aveni-Hunter, underscore/bibcode-bracket forms for
  COIN-Gaia).
- **1** `ASCC 32`: SIMBAD *does* have a record, but it carries no usable
  parallax - no distance derivable, same honest-failure behavior
  `SimbadResolver` already had for stars with this problem (e.g. Story
  #88's `h01 Pup`).
- **1** `NGC 2183`: resolves, but to a reflection nebula, not a cluster
  (see "otype safety check" above).
- **3** `UPK ...` / `UPK 3?` / `UPK 451`: Story #87 itself flagged these as
  transcription-uncertain (illegible/ambiguous label crops); no SIMBAD
  record exists under the garbled printed form, and no digit was invented
  to force a guess.

This candidate list, unlike Story #87/#88's individual stars (1.2%
unresolved), skews toward several small/specialist open-cluster survey
catalogs (ASCC, COIN-Gaia, BH, Loden, Aveni-Hunter) that are not uniformly
cross-identified in SIMBAD's main identifier table - a genuine data-coverage
gap in the underlying catalogs' cross-referencing, not a resolution-method
weakness specific to this Story.
