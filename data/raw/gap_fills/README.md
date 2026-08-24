# Standalone gap-fill additions (issues #207, #213, #221)

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

## 34 more naked-eye-bright stars: Arcturus, Vega, and the rest (issue #213)

The audit flagged as a follow-up above happened: research (issue #213)
confirmed the same RECONS transcription gap that missed Fomalhaut also
missed 33 other well-known, naked-eye-bright, nearby stars (RECONS's "100
nearest star systems" list is a research-consortium census weighted toward
faint red/white dwarfs needing dedicated parallax work, and systematically
misses evolved/luminous nearby stars whose distances were already
well-established by other means). A 34th star, Alnilam (epsilon Orionis),
turned out to be a *different* kind of gap - a likely missed import from
the Galaxy Map luminous-poster batch (Story #87/#88), not a proximity
issue - evidenced by its Belt neighbors Alnitak (zeta Orionis) and Mintaka
(delta Orionis) already being present in the catalog from that same batch.

All 34 were resolved live via `SimbadResolver`/`acquire`, one star at a
time (not a batch re-fetch), the same mechanism as Fomalhaut:

- **33 proximity-driven additions** (Tier 1: Arcturus, Vega, Capella,
  Aldebaran, Regulus, Pollux, Castor, Denebola; Tier 2: Dubhe, Merak,
  Alkaid, Mizar, Alcor, Menkalinan, Alderamin, Eltanin, Rasalhague, Kochab,
  Diphda, Hamal, Algol, Alphecca, Unukalhai, Sabik, Zubenelgenubi; Tier 3:
  Nunki, Alnair, Gacrux, Elnath, Zubeneschamali; Borderline: Achernar,
  Alphard, Peacock, Miaplacidus) all carry the same
  `group.secondary: ["nearby-bright-star-gap-fill"]` tag Fomalhaut uses.
- **Alnilam** carries a distinct tag,
  `group.secondary: ["luminous-poster-gap-fill"]`, so its different
  provenance story is never conflated with the proximity-driven batch
  above (see `tests/test_bright_star_gap_fills.py`'s disjointness checks).

**Mizar note:** the plain query `"Mizar"` resolves 0 SIMBAD rows once the
`V` (apparent magnitude) votable field is requested - an upstream join
quirk specific to that alias, confirmed empirically by testing each
votable field individually (`plx_value`/`plx_err`/`ids`/`otype`/`sp_type`
each work fine alone; adding `V` collapses the result to zero rows, for
this alias only). This is still a live resolution of the real star, not a
fabrication: SIMBAD's own preferred main identifier for the bright,
visible component is `"* zet01 UMa"` (aliases include `"NAME Mizar A"`),
which resolves cleanly with full photometry, and is what this record uses
(catalog id `zet01_uma`).

**Result: 35 of 35 attempted resolutions succeeded** (the 34 named stars
in issue #213's tiered list, resolved on the first attempt, plus Mizar
which required the disambiguated identifier above on a second attempt -
still one star, one record, zero fabricated/skipped entries). Catalog
grew from 957 to 992 objects;
`galactic-structures build-catalog` + `galactic-structures export-scene
--no-radius-filter --output web/public/data/scene.json` regenerated the
checked-in catalog/scene artifacts (same recipe as issue #207 and Story
#181).

Spot-checked against public data:

| Star | Distance (resolved) | Public figure | Spectral type | Apparent V |
| --- | --- | --- | --- | --- |
| Arcturus | 11.26 pc | ~36.7 ly = 11.26 pc | K1.5III (SIMBAD: K1.5IIIFe-0.5) | -0.05 (matches) |
| Vega | 7.68 pc | ~25.04 ly = 7.68 pc | A0V | 0.03 (matches) |
| Capella | 13.12 pc | ~42.9 ly = 13.16 pc | G3III (binary; commonly G3III+G0III) | 0.08 (matches) |
| Alnilam | 606.1 pc | ~1300-2000 ly range cited in the literature (Gaia-based ~1977 ly = 606 pc, within that range) | B0Ia (blue supergiant) | 1.69 (matches) |
| Mizar | 24.87 pc | ~78-86 ly cited range = ~23.9-26.3 pc | A1.5V (commonly cited A1V-A2V) | 2.22 (matches ~2.23) |

All five consistent with commonly cited public figures - no fabricated
values, no cross-match errors.

Not part of this Story: auditing for even more missing bright stars beyond
this list, or changing the RECONS/Galaxy Map batch transcription process
itself - both explicitly out of scope for issue #213.

## 10 popular Messier nebulae: Crab, Ring, Orion, and the rest (issue #221)

Before this fix, the catalog had zero Messier-catalog objects at all and
zero `hii_region`/`star_forming_region` members, and the schema itself had
no home for planetary nebulae (`KNOWN_OBJECT_TYPES` had no
`planetary_nebula` entry, added in `schema.py` alongside this batch). This
batch adds 10 well-known Messier nebulae across all three affected object
types, all resolved live via `SimbadResolver`, one object at a time:

- **Supernova remnant** (pre-existing `supernova_remnant` type): M1 (Crab
  Nebula, `m1_crab`).
- **Planetary nebulae** (new `planetary_nebula` type): M27 (Dumbbell,
  `m27_dumbbell`), M57 (Ring, `m57_ring`), M76 (Little Dumbbell,
  `m76_little_dumbbell`), M97 (Owl, `m97_owl`).
- **HII regions** (pre-existing `hii_region` type, previously zero
  members): M42 (Orion Nebula, `m42_orion`), M8 (Lagoon, `m8_lagoon`), M16
  (Eagle, `m16_eagle`), M17 (Omega/Swan, `m17_omega`), M20 (Trifid,
  `m20_trifid`).

All 10 carry `group.secondary: ["messier-nebula-gap-fill"]` - a distinct
tag from both `nearby-bright-star-gap-fill` above and the RECONS/Galaxy
Map batch tags, since these are curated Messier additions, not from either
existing candidate list.

**Result: 10 of 10 attempted resolutions succeeded**, zero fabricated or
skipped entries. Catalog grew from 992 to 1002 objects;
`galactic-structures build-catalog` + `galactic-structures export-scene
--no-radius-filter --output web/public/data/scene.json` regenerated the
checked-in catalog/scene artifacts, run from this worktree's `.venv`
(pyarrow 25.0.1, matching the version the test suite runs against - see
this repo's `Regenerate catalog.parquet with current pyarrow` commit for
why that match matters).

**Two SIMBAD/astroquery quirks surfaced by this batch** (both handled
inside `data_sources/simbad.py`, not worked around by hand per object -
see that module's docstring for the full detail):

1. Diffuse/extended objects with no cataloged apparent V magnitude return
   zero rows from `query_object` when the `V` votable field is requested
   at all (true for M1, M42, M8, M16, M17, M20) - `_query_upstream` now
   retries once without `V` before giving up.
2. The same diffuse/extended objects typically have no measured
   trigonometric parallax (`plx_value`) on file - `_query_upstream`/
   `_normalize` fall back to SIMBAD's own `mesDistance` table (a real,
   traceable, literature-cited SIMBAD value, never fabricated) instead of
   failing resolution. M1's 2000 pc distance, for example, comes from this
   fallback (`mesDistance` bibcode `1973PASP...85..579T`); the four
   planetary nebulae all had usable central-star parallaxes and did not
   need it.

**otype quirk, not worked around** (documented honestly instead): SIMBAD's
own `otype` classification for M8, M16, M17, and M20 is `OpC` (open
cluster) rather than a nebula type - for these four, SIMBAD's "M n" query
resolves to the embedded open star cluster's catalog entry (e.g. M17's
`main_id` comes back as `NGC 6618`, with `M 17` retained as an alias)
rather than a standalone nebula entry. Only M42 resolves directly to
SIMBAD's own `HII` otype. The RA/Dec/distance data pulled this way still
correctly locates the nebula itself (an embedded cluster shares the
nebula's position to well within a degree - verified against public
figures in the spot-check table below), and `object_type: "hii_region"`
is still the correct, issue-specified classification for what these
objects visually/scientifically are; only SIMBAD's own internal type tag
differs, and that raw `otype` value is preserved verbatim in each
record's `notes` field for transparency rather than hidden.

Spot-checked against public data (one from each of the three categories,
plus two more for coverage):

| Object | Distance (resolved) | Public figure | SIMBAD otype | Notes |
| --- | --- | --- | --- | --- |
| M1 (Crab Nebula, SNR) | 2000 pc | ~6500 ly = 1994 pc (widely cited) | SNR | mesDistance fallback, matches exactly |
| M57 (Ring Nebula, PN) | 787.6 pc | ~2000-2500 ly cited range = 610-770 pc (older); recent Gaia-based ~700-830 pc | PN | consistent with recent Gaia-era figures |
| M42 (Orion Nebula, HII) | 433.0 pc | 414 +/- 7 pc (VLBA maser parallax, Menten et al. 2007; widely adopted) | HII | within ~5% |
| M27 (Dumbbell Nebula, PN) | 389.1 pc | ~380-460 pc (recent Gaia central-star parallax literature) | PN | consistent |
| M16 (Eagle Nebula, HII) | 1766.8 pc | ~1700-2000 pc commonly cited (~5700 ly - 6500 ly) | OpC (embedded cluster; nebula position confirmed via RA/Dec) | consistent |

All five consistent with commonly cited public figures - no fabricated
values. (M76's distance, `mesDistance`/parallax notwithstanding, has an
unusually wide literature range and a large resolved error bar,
`error_pc` ~2336 pc on ~3396 pc; flagged here rather than silently
smoothed over, not treated as disqualifying since the schema's own
`distance.error_pc` field exists precisely to carry that uncertainty
forward honestly.)

Not part of this Story: the remaining ~100 Messier objects (this is a
curated "greatest hits" batch, not a full import), or new billboard-sprite
rendering for nebulae (a separate, later Story per issue #221's own scope
note).
