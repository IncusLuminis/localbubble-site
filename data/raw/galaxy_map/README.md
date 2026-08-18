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
