# Standalone gap-fill additions (issue #207)

Occasionally a well-known, bright, nearby star turns out to be missing from
*every* existing curated batch - not because resolution failed, but because
it never became a candidate in the first place (a transcription gap in the
source list a batch was built from). This directory documents such
single-star additions, resolved via the same `SimbadResolver`/`acquire`
mechanism as every other star in the catalog, but checked in separately
from the Galaxy Map (`data/raw/galaxy_map/`) and RECONS
(`data/raw/recons/`) batches so their provenance is never confused with
either curated candidate list.

Each entry here is tagged `group.secondary: ["nearby-bright-star-gap-fill"]`
(not `recons-nearest-100` or any Galaxy Map tag), and its `notes` field
honestly documents *why* it's here - it was never on the original RECONS or
Galaxy Map candidate lists, it was simply missed during transcription -
rather than silently implying it belonged to one of those batches all
along.

## Fomalhaut (issue #207)

Fomalhaut (alpha PsA, SIMBAD main id `* alf PsA`) is one of the brightest
stars in the sky (apparent V ~1.16) and, at ~7.7 pc, well within RECONS's
"100 nearest star systems" distance range (`data/raw/recons/README.md`).
It was verified absent from *both* existing batches before this fix:

- **Galaxy Map poster batch** (Story #87/#88): that batch selects on
  absolute magnitude < -2.8 ("luminous giants"); Fomalhaut's absolute
  magnitude is ~+1.7, far too faint (i.e. too nearby/ordinary a star) to
  have ever been a poster candidate. Correctly excluded, not a gap.
- **RECONS nearest-100 batch** (Story #104): Fomalhaut is not present in
  `data/raw/recons/candidate_stars.json` (the 100-system/142-component
  transcribed candidate list) under any query form, and it is not one of
  that batch's 13 documented `unresolved_stars.json` entries either. This
  is a transcription gap from the original RECONS
  "astro.gsu.edu/RECONS/TOP100.posted.htm" page - not a `SimbadResolver`
  resolution failure - since the star was never turned into a candidate to
  begin with.

Resolved live via `SimbadResolver().resolve("Fomalhaut")` (see
`fomalhaut.json` in this directory for the raw resolved record); merged
into `data/normalized/initial_catalog_records.json` with
`group.secondary: ["nearby-bright-star-gap-fill"]` and a `notes` field
documenting this exact provenance story (spec `Idea-v1.2-individual-stars.md`
§5 dual provenance - `source.reference`/`source.catalog` remain the real
SIMBAD citation; the RECONS-gap-fill context lives only in `notes`, and
never claims RECONS candidate-list membership).

Spot-checked against public data: distance 7.70 pc (public figures commonly
cite ~25.13 ly = 7.70 pc), spectral type A4V (SIMBAD; commonly cited in the
literature as A3V/A4V), apparent V magnitude 1.16 (matches the commonly
cited value of ~1.16) - all consistent.

Not part of this Story: auditing the catalog for *other* possibly-missing
bright stars. Flagged as a candidate for a future, separate audit if the
project owner wants one; not pursued here.
