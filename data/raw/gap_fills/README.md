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

## V* EZ Aqr's implausible ~6825 km/s velocity (issue #234)

Not a new star addition like the entries above - this is a data-quality
fix to an existing record, documented here per this issue's own request
to follow the same "investigation findings, honestly documented"
convention this file already established.

Story #230/PR #232 added stellar space-velocity data for the 127
in-sphere stars, including `V* EZ Aqr` (GJ 866, a 3.4 pc M5V triple
RECONS dwarf, catalog id `v_ez_aqr`). Its merged velocity derived to
`vx=2486.92, vy=2746.59, vz=-5731.56` km/s - a total space velocity of
~6825 km/s, an essentially unheard-of hypervelocity for a quiet nearby M
dwarf (published literature: RV ~ -59.9 km/s, proper motion ~(+2314,
+2295) mas/yr, a normal few-tens-of-km/s space velocity).

**Investigation.** Live-queried SIMBAD (2026-08-31) for every alias of
this star - `GJ 866`, `GJ 866 A`, `GJ 866 B`, `GJ 866 C`, `V* EZ Aqr`,
`EZ Aqr` - all resolve to the identical `main_id` and the identical
`rvz_radvel = 6824.7` km/s (bibcode `2021MNRAS.508.5148C`). This rules
out a component-resolution mismatch (this system's separate
`gj_866_{a,b,c}.json` cache files are a pre-existing RECONS artifact of
one star having three separately-catalogued RECONS components - see this
record's own `notes` field, issue #104's dedup note - not the cause of
this bug) and rules out a unit-parsing bug in this pipeline's own
`data_sources/simbad.py` (the raw upstream value itself is already
`6824.7`, not something this pipeline mis-scaled). SIMBAD's own
`mesVelocities` table (all individual RV/redshift measurements on file,
not just the one it surfaces as the default `rvz_radvel`) shows three
rows for this star:

| mespos | bibcode | value | nbmes |
| --- | --- | --- | --- |
| 1 (default) | 2021MNRAS.508.5148C | 6824.7 km/s | - |
| 2 | 1995A&AS..114..269D | -60.0 km/s | 4 |
| 3 | 1953GCRV..C......0W | -60.0 km/s (err 2.0) | 4 |

Two independent, older bibcodes agree at -60.0 km/s, matching the ~-59.9
km/s this issue itself cites from the literature; only the newest
bibcode (the one SIMBAD happens to surface as "the" default) disagrees by
two orders of magnitude - almost certainly a bad cross-match in that
specific upstream reference, not anything wrong with this star's actual
measured history.

**Fix.** `data_sources/simbad.py` now treats any `|rvz_radvel| > 500`
km/s as suspect (module docstring quirk 3, `_IMPLAUSIBLE_RV_KMS_THRESHOLD`)
and queries `mesVelocities` for a plausible alternative bibcode/
measurement - the same "corrected re-query over a real, traceable,
differently-sourced SIMBAD value" shape this module's existing
`mesDistance` fallback already uses for quirk 2. The original
`rvz_radvel`/`rvz_bibcode` raw fields are never overwritten (spec §13:
raw data is never modified in place) - the correction lives in new,
additive `rvz_radvel_corrected`/`rvz_bibcode_corrected`/
`rvz_correction_note` keys instead, which `_derive_velocity` prefers over
the flagged default. Re-running `scripts/backfill_velocity.py --only
v_ez_aqr` against live SIMBAD picked up the fix automatically: `v_ez_aqr`
now derives to `vx=-68.42, vy=-0.36, vz=41.10` km/s, a total space
velocity of ~79.8 km/s - plausible for a fast-proper-motion nearby M
dwarf (less than Barnard's Star's 142.3 km/s, well above the "quiet
nearby star" floor) - with `radial_velocity_known: true` and a `source`
citing both the corrected bibcode (`1995A&AS..114..269D`) and the full
investigation note.

If SIMBAD had genuinely had no plausible alternative measurement on file
for a future star hitting this same quirk, the fallback is honest
(`radial_velocity_known: false`, tangential-only from `pmra`/`pmdec`
alone) rather than propagating a bad value - this star simply didn't need
that path, since a plausible corrected value was available.

**Scan for other implausible velocities (this issue's own acceptance
criterion).** All 127 in-sphere star records were re-scanned for derived
total space velocity above 500 km/s after this fix. Zero flagged. The two
fastest after the fix are both genuine, well-documented high-velocity
stars, not data-quality issues: Kapteyn's Star (HD 33793, catalog id
`hd_33793`) at ~293.5 km/s - the textbook nearby halo/high-velocity star,
consistent with its well-known extreme space velocity - and Wolf 28 / Van
Maanen's Star (catalog id `wolf_28`) at ~270.0 km/s, an old white dwarf
consistent with an old-population peculiar velocity. Neither required any
change.

`galactic-structures build-catalog` + `galactic-structures export-scene
--no-radius-filter --output web/public/data/scene.json` regenerated the
checked-in catalog/scene artifacts, run from this worktree's own clean
`.venv` (pyarrow 25.0.1, matching the version the test suite runs against
- see this repo's `Regenerate catalog.parquet with current pyarrow`
commit for why that match matters). Full suite: 310 passed, 4 skipped (6
new tests added for this quirk's `_query_mes_velocities`/`_query_upstream`
wiring and the `_derive_velocity` corrected/fallback paths).

## 77 new named bright stars in the Local Bubble (Epic #294, Story #295)

By far the largest single gap-fill batch to date (previous largest: 34
stars, issue #213 above). Unlike every batch before it, this one was not
built from any hand-transcribed name list at all - the Epic's own
33-name illustrative list was explicitly flagged as possibly stale/
incomplete and deliberately *not* trusted. Instead, the full candidate
list was re-derived live, from scratch, via a SIMBAD TAP/ADQL query:

```sql
SELECT b.oid, b.main_id, b.ra, b.dec, b.plx_value, f.V, i.ids
FROM basic b JOIN allfluxes f ON f.oidref = b.oid JOIN ids i ON i.oidref = b.oid
WHERE f.V < 4.0 AND b.plx_value > 16.6667 AND b.plx_value < 90.9091
```

(`V < 4.0` apparent magnitude; parallax 16.6667-90.9091 mas corresponds to
exactly 11-60pc). This returned 240 raw rows. Filtering for a genuine
`NAME `-prefixed common-name alias (this project's own `hasProperName`
convention, `web/src/scene/labels.ts` - name or any alias literally
starting with `"NAME "`) narrowed this to 106 named candidates. Cross-
checking every one of those 106 against the full pre-Story catalog (every
existing record's `name` *and* every alias, not just a display name)
excluded 29 already present (including Arcturus, Capella, Achernar,
Aldebaran, Regulus, Castor, Gacrux, Elnath, Miaplacidus, Alnair, Dubhe,
Alkaid, Menkalinan, Peacock, Alphard, Diphda, Hamal, Rasalhague, Kochab,
Algol, Mizar A, Eltanin, Alphecca, Merak, Sabik, Alderamin,
Zubeneschamali, Unukalhai, and Zubenelgenubi - all from the issue #213
batch above) - leaving **exactly 77 new candidates**, matching Epic #294's
own research count exactly, and reproducing every one of its 33
illustrative example names (Alioth, Kaus Australis, ... Alnasl) plus
Mizar B, which the Epic separately flagged as a distinct find. See
`tests/test_local_bubble_bright_star_gap_fill.py`'s module docstring for
the full candidate-derivation methodology.

**Known-tricky candidates, individually verified:**

- **RECONS-boundary candidates** (Muphrid, Porrima, Deneb Algedi,
  Zavijava - all flagged by the Epic as sitting at/near the ~11.26pc
  RECONS sphere boundary): each resolved to its own unique SIMBAD record
  with its own `NAME `-prefixed alias, absent from the pre-Story catalog
  under any of its many cross-catalog identifiers (SIMBAD's `ids` field
  was checked in full, not just the display name) - genuinely distinct
  objects, not alias collisions. Zavijava resolves to 11.00pc, fractionally
  *inside* the nominal 11.26pc RECONS boundary; per this project's own
  established precedent (Fomalhaut, issue #207, at 7.7pc - also inside
  RECONS's own distance range but still missing due to a transcription
  gap, not a resolution failure), falling inside the sphere by distance
  does not make a star a duplicate - RECONS's "100 nearest systems" census
  is weighted toward faint dwarfs and has repeatedly been shown to miss
  bright/evolved stars regardless of exact distance. Verified absent from
  the catalog by every alias before acquiring; genuinely new.
- **Multi-component systems** (Algol, Castor, Mizar - flagged by the Epic
  as systems where one component is already cataloged): Algol and Castor
  produced **no new NAME-prefixed candidate at all** - SIMBAD resolves
  both plain names to the same already-cataloged component the issue #213
  batch added (`bet_per`/`alf_gem`), so the pre-acquisition cross-check
  correctly excluded them; neither is a distinct SIMBAD identifier the way
  Mizar B is. **Mizar B** (SIMBAD identifier `* zet02 UMa`, alias `NAME
  Mizar B`), by contrast, resolved to its own distinct `oid`/parallax/
  photometry from the already-cataloged Mizar A (`* zet01 UMa`, issue
  #213) - a genuinely separate real companion star, confirmed and
  acquired as flagged.

All 77 candidates were then acquired one at a time via the same
`SimbadResolver`/`acquire` mechanism as every other entry in this
directory (query = the plain common name, e.g. `"Alioth"`), each verified
twice before being written: (1) the resolved object actually carries a
`NAME <exact proper name>` alias (guards against an ambiguous/wrong
cross-match, the same Mizar-alias quirk documented above); (2) the
resolved distance is within 20% of the TAP-query-derived distance (guards
against a gross cross-match/unit error). **Result: 77 of 77 attempted
resolutions succeeded on the first attempt - 0 skipped, 0 fabricated.**
All 77 carry a distinct `group.secondary: ["local-bubble-bright-named-gap-fill"]`
tag - never claiming membership in the RECONS-nearest-100, Galaxy Map
poster, or either prior gap-fill batch's own candidate list. No velocity
was derived for any of these 77 (Story #296's job, which depends on this
Story merging first).

Spot-checked against public data (a representative spread, including all
four RECONS-boundary candidates and Mizar B):

| Star | Distance (resolved) | Public figure | Spectral type | Apparent V |
| --- | --- | --- | --- | --- |
| Alioth | 25.31 pc | ~81 ly = 24.8 pc | A1III-IVp (SIMBAD: A1III-IVp) | 1.77 (matches ~1.76) |
| Kaus Australis | 43.94 pc | ~143 ly = 43.9 pc | B9.5III | 1.81 (matches ~1.85) |
| Muphrid | 11.40 pc | ~37 ly = 11.3-11.4 pc | G0IV | 2.68 (matches) |
| Porrima | 12.02 pc | ~38.6 ly = 11.8-12.0 pc (binary; orbital literature range) | F0V | 2.74 (matches) |
| Deneb Algedi | 11.87 pc | ~39 ly = 11.9-12.0 pc | A7III(n) (kappa1 Cet-type) | 2.83 (matches) |
| Zavijava | 11.00 pc | ~35.7 ly = 10.9-11.0 pc | F9V | 3.60 (matches) |
| Mizar B | 24.83 pc | same system as Mizar A (~24.87 pc, this README's own #213 spot-check) | A1m (SIMBAD) | 3.88 (matches ~3.95 commonly cited) |

All seven consistent with commonly cited public figures - no fabricated
values, no cross-match errors. Mizar A and Mizar B resolving to
essentially identical distances (24.87 pc vs. 24.83 pc) is exactly what a
real gravitationally bound binary companion should show.

Catalog grew from 1002 to 1079 objects; `galactic-structures build-catalog`
+ `galactic-structures export-scene --no-radius-filter --output
web/public/data/scene.json` regenerated the checked-in catalog/scene
artifacts, run from this worktree's own clean `.venv` (pyarrow 25.0.1,
matching the version the test suite runs against - see this repo's
`Regenerate catalog.parquet with current pyarrow` commit for why that
match matters). New `tests/test_local_bubble_bright_star_gap_fill.py`
covers presence, correct/disjoint tagging, distance sanity, dual
provenance, the Mizar A/B disambiguation, the four RECONS-boundary
candidates, and the Algol/Castor non-duplication - 11 new tests, full
suite 321 passed, 4 skipped (a pre-existing `tests/
test_bright_star_gap_fills.py::_find` helper needed a one-id exclusion for
Mizar B, whose alias also contains the bare word "Mizar" that helper's
own word-boundary matching would otherwise ambiguously match against
issue #213's Mizar A).

Not part of this Story: velocity derivation for these 77 stars (Story
#296, which depends on this Story merging first), or any frontend change
(none needed - Epic #285's Story #287 already widened the animated-
population selection to `distance_pc <= bubbleOuterRadiusPc`, so these 77
stars automatically join the animated Vectors/motion-player population
once Story #296 adds their velocity).

**Update (Story #296):** velocity has since been derived for all 77 of
these stars (77/77 resolved, 100% full 3D vectors, no implausible
speeds) - see the main [`README.md`](../../../README.md)'s "Velocity for
the 77 newly-acquired Local Bubble stars (Story #296)" section for the
full writeup, spot-checks, and live-verification result. Confirmed live
in the web viewer with zero frontend code changes, exactly as this
Story's own note above anticipated.

## 4 more named molecular clouds beyond the original 8-record seed list (issue #318)

The catalog's 8 `molecular_cloud` records were, until this Story, exactly
spec `Idea.md` §9's own minimum seed list (Cepheus Flare, Chamaeleon,
Lupus, Ophiuchus/Rho Ophiuchi, Orion Molecular Cloud Complex, Perseus,
Pipe Nebula, Taurus) - never expanded, despite the spec's own stated scope
("structures within approximately 800 pc of the Sun") leaving clear room
for more. This is a NEW-RECORD gap-fill (unlike Story #307/#314, both
BACKFILLS onto already-curated records) following this directory's own
established convention, adapted for molecular clouds: each new record's
DISTANCE and POSITION are sourced via the same two-step convention the
original 8 already use (see e.g. `chamaeleon-molecular-cloud`'s own
`source.reference` in `initial_catalog_records.json`) - DISTANCE from
Zucker, C., Speagle, J. S., Schlafly, E. F., Green, G. M., Finkbeiner,
D. P., Goodman, A. A., & Alves, J. (2020), "A compendium of distances to
molecular clouds in the Star Formation Handbook", A&A, 633, A51
(arXiv:2001.00591), POSITION from a separate SIMBAD identification-only
cross-match - except that unlike the original 8 (hand-cited from the
paper's own Table A.1 at curation time), this Story live-queries the real,
machine-readable VizieR table (`J/A+A/633/A51/handbook`) directly via a
new adapter, `data_sources/zucker_molecular_clouds.py`, specifically to
avoid the trap this Story's own first research pass hit: extracting
distances from a scraped/AI-summarized version of the paper's prose got at
least one value visibly wrong. `visual.size_pc` uses the same SIMBAD
`galdim_majaxis`-based DIAMETER convention `data_sources/simbad_size.py`
(Story #314) already established for this object type - confirmed by two
independent Validator passes during that Story, and re-confirmed (not
reversed to a radius) here.

**Matching convention:** a candidate's distance-anchor sightline is the
VizieR table row with the smallest angular separation from that
candidate's own SIMBAD identification position, regardless of which
`Name` label that row happens to carry in the paper's own loose
sightline-grouping scheme - not a requirement that the row's group name
textually match the candidate's common name. This matters: it is exactly
why Aquila Rift (below) was excluded rather than mismatched onto a
distant same-named group, and exactly why the closest real match for it
turned out to carry the (different) label `"Serpens"`.

**4 candidates added**, all well under the 800pc cap:

| Record | Distance | Nearest sightline sep. | size_pc |
| --- | --- | --- | --- |
| Corona Australis Molecular Cloud | 147 pc | 0.386 deg | 25.66 pc (SIMBAD galdim) |
| Coalsack Nebula | 182 pc | 1.781 deg | null (honest failure) |
| California Molecular Cloud | 454 pc | 1.405 deg | 43.58 pc (SIMBAD galdim) |
| Serpens Molecular Cloud | 425 pc | 0.273 deg | null (honest failure) |

Corona Australis and Coalsack are the issue's own "strong candidate" list
(one of the nearest star-forming regions/Coronet Cluster; the famous
naked-eye dark nebula by the Southern Cross). California and Serpens are
the issue's own "weaker/optional" candidates, included because the real
Vizier distances confirm both well within 800pc and both are genuinely
notable (California: the cloud behind NGC 1499, illuminated by xi Persei;
Serpens Main: the actively star-forming core of the Serpens cloud).
Corona Australis is one of the paper's own three explicitly-named "~7%
systematic uncertainty" southern clouds (ReadMe); the other three use the
paper's general ~5% (all are <1.5kpc).

**2 honest-failure size_pc's**, same shape as Story #314's own M8/Lagoon
Nebula precedent: Coalsack Nebula and Serpens Molecular Cloud both
resolve cleanly on SIMBAD (multiple aliases tried live for each) but
neither carries a `galdim_majaxis` on file for the named object as a
whole - left `null`, not fabricated.

**2 candidates investigated, deliberately NOT added:**

- **Musca Molecular Cloud** - the issue's own third "strong candidate".
  SIMBAD identifies "NAME Musca" cleanly, but no VizieR
  `J/A+A/633/A51/handbook` sightline resolves within a reasonable angular
  separation of it - the nearest tabulated sightline overall (in the
  unrelated "Coalsack" group) is 6.0 deg away, and Musca has no
  `Name`-labeled sightline group of its own in the table at all (94 named
  groups, none of them "Musca"). Honest failure, not fabricated/
  approximated.
- **Aquila Rift**, as a record distinct from Serpens Molecular Cloud - the
  issue's own "Serpens/Aquila Rift complex" framing turned out, on the
  real Vizier data, to conflate two genuinely distinct sightline groups at
  different median distances (`Aquila_Rift`: 163-280pc across 5 rows;
  `Serpens`/`Serpens_Main`: ~425-556pc). Serpens Molecular Cloud (above)
  resolves cleanly as its own record. Aquila Rift was investigated
  separately but not added: SIMBAD's own single-point identification for
  it ("NAME Aql Rift") sits >9 deg from every one of the table's own
  `Aquila_Rift`-named rows (nearest same-named row: 9.586 deg) - its
  closest real match in the whole table (0.223 deg) actually carries the
  *different* label `"Serpens"` (d50=501pc) - and its own SIMBAD
  `galdim_majaxis` (1530 arcmin, ~25.5 deg on the sky) confirms it is an
  enormous extended superposition/extinction feature, not a single
  coherent 3D cloud - a poor fit for this catalog's single-point/
  single-distance object model. Excluded rather than force-fit.

**Explicitly out-of-scope candidates re-confirmed against the real
table** (issue's own list, default-to-exclude instruction honored
regardless of the exact live figure): North America Nebula (VizieR d50
731-878pc, mean ~809pc - at/over the 800pc boundary, confirms the issue's
own "borderline, skip" call); IC5146/Cocoon Nebula (730-792pc - still
excluded per the issue's explicit list even though this is measurably
closer than the issue's own ~950pc-1kpc prior estimate); Maddalena's
Cloud/Circinus/Norma/W3/W4/W5/Mon R2 (present in the table at kpc-scale
distances, or absent entirely, consistent with exclusion); NGC 6334 does
not appear in the table's 94 named groups at all.

All 4 new records carry `group.secondary: ["molecular-cloud-gap-fill"]` -
a distinct tag from every prior batch's own tag, per this directory's
established convention. `data_sources/zucker_molecular_clouds.py`
caches the full 326-row VizieR table once (`data/raw/zucker_molecular_clouds/`,
no per-fetch manifest entry, mirroring `cluster_radius.py`'s own bulk
whole-table precedent); the per-candidate SIMBAD `galdim_majaxis` size
queries go through the existing, already-manifested
`data_sources/simbad_size.py` unchanged. `scripts/
acquire_molecular_cloud_gap_fill.py` reproduces every distance/error/
nearest-sightline figure above from a clean checkout (independently
re-verified to reproduce this Story's own numbers exactly before this PR
was opened) - it does not mechanically regenerate the catalog records
themselves, since this Story's candidate selection involved real judgment
calls (which regions to add, which to honestly exclude) not meant to be
silently re-decided by blind automation on a future re-run.

`tests/test_molecular_cloud_gap_fill.py` (new-record well-formedness,
tagging, distance/size_pc sanity, dual provenance, original-8
non-regression, excluded-candidate regression guard) and `tests/
test_zucker_molecular_clouds.py` (the new adapter's pure nearest-
sightline/systematic-fraction/quadrature-error logic) cover this Story;
`tests/test_structure_size_backfill.py`'s own Story #314 regression guard
(`test_record_count_and_id_set_are_unchanged`) was updated from a strict
1079-record equality check to a "nothing pre-existing disappeared, count
only grows" check, since it was asserting an incidental invariant of its
own PR's diff rather than a permanent catalog-size ceiling - this Story's
4 new records are exactly the kind of legitimate future growth that
invariant was never meant to block. Catalog grew from 1079 to 1083
objects; `galactic-structures build-catalog` + `galactic-structures
export-scene --no-radius-filter --output web/public/data/scene.json`
regenerated the checked-in catalog/scene artifacts, run from this
worktree's own clean `.venv` (pyarrow 25.0.1, matching the version the
test suite runs against - standing lesson from PR #183). Full suite: 378
passed, 4 skipped.

Not part of this Story: any rendering/visual change (these 4 records
render through whatever `molecular_cloud` rendering is live on `master`
at merge time), or `star_forming_region` records (none of the candidates
considered read as a clear-cut case for that type over `molecular_cloud`,
per the issue's own judgment note - all 4 added keep the existing
seed-list precedent of classifying even actively star-forming clouds like
Ophiuchus/Orion as `molecular_cloud`).

## 9 more named molecular clouds, "strong tier" (issue #324)

Follow-on to issue #318 above. A more thorough mining of the same
already-cached Zucker et al. 2020 table found real, well-under-800pc
candidates that #318's earlier research pass either missed (North America
Nebula - explicitly requested by the human owner - and its optional twin
the Pelican Nebula, IC 5070) or WRONGLY excluded based on bad secondary
sources: #318's own README text above quotes IC5146/Cocoon Nebula at
"~950pc-1kpc" and separately excludes Circinus/Norma as "kpc-scale" -
both guessed from garbled web text at that Story's research stage, not
from the real cached table, which puts all three well under 800pc. This
Story live-re-verified every one of the issue's own quoted distance
ranges directly against the actual cached VizieR rows (not re-trusted
blindly) before acquiring anything, and confirmed every one matches
closely. `scripts/acquire_molecular_cloud_gap_fill.py` was extended (not
replaced) with this Story's own 9 candidates plus a new
`REDUNDANCY_CHECKS` block computing the two required real-position
comparisons below via `astropy.coordinates.SkyCoord`.

**9 candidates added**, all resolved cleanly via SIMBAD, all under 800pc:

| Record | Distance | Nearest sightline sep. | size_pc |
| --- | --- | --- | --- |
| North America Nebula | 784 pc | 0.273 deg | null (honest failure) |
| Pelican Nebula | 792 pc | 0.031 deg | null (honest failure) |
| IC 5146 (Cocoon Nebula) | 751 pc | 0.027 deg | 1.79 pc (SIMBAD galdim) |
| Circinus Molecular Cloud | 675 pc | 0.263 deg | null (honest failure) |
| Norma Molecular Cloud | 721 pc | 0.153 deg | null (honest failure) |
| Mon OB1 / NGC 2264 | 759 pc | 0.194 deg | 52.99 pc (SIMBAD galdim) |
| IC 2118 (Witch Head Nebula) | 273 pc | 0.697 deg | null (honest failure) |
| Lambda Orionis Ring (Orion_Lam) | 423 pc | 0.301 deg | null (honest failure) |
| Draco Cloud | 481 pc | 0.308 deg | null (honest failure) |

North America Nebula is the human owner's own explicit request. Pelican
Nebula is the issue's own optional twin (same physical complex as North
America Nebula, split by an intervening dust lane, not a distinct Zucker
table entry of its own) - included because it resolved essentially
exactly (0.031 deg) via SIMBAD's own `NAME Pelican Nebula` identifier, per
the issue's "add if it resolves cleanly, your call" instruction. IC 5146,
Circinus, and Norma are the three candidates #318 wrongly excluded, now
corrected. Mon OB1/NGC 2264, IC 2118, Lambda Orionis Ring, and Draco Cloud
are new strong candidates this Story's own table-mining pass surfaced.

**Two redundancy checks, both explicitly required by the issue, both
performed via real SIMBAD-resolved positions (not name matching):**

- **Orion_Lam (Lambda Orionis Ring) vs. the already-loaded Orion Molecular
  Cloud Complex record - PASSED, genuinely distinct.** SIMBAD's
  identification-only position for this candidate (`Sh 2-264` -> main_id
  `NAME lam Ori Molecular Ring`, ra=83.825, dec=9.933) sits **11.527 deg**
  from the existing `orion-molecular-cloud-complex` record's own stored
  position (ra=86.2152, dec=-1.3456) - far outside any plausible
  single-object measurement scatter (every genuine same-object match in
  this Story and #318 landed under ~1.8 deg). The Lambda Orionis ring
  sits north of the Orion Belt/Sword region (dec ~+6 to +14 deg); the
  existing Orion Complex record is anchored near M42 (dec ~-1 to -8 deg).
  Added as its own record.
- **Northern Coalsack vs. the already-loaded Coalsack Nebula record -
  PASSED, genuinely distinct... but excluded anyway, for a different,
  unanticipated reason.** SIMBAD's real `NAME Northern Coalsack` position
  (ra=305.25, dec=37.0) sits **133.890 deg** from Coalsack Nebula's own
  stored position (ra=189.1772, dec=-65.4279) - opposite general regions
  of the sky, obviously not a duplicate. However, acquiring this candidate
  surfaced a second, separate problem: SIMBAD's actual `NAME Northern
  Coalsack` record turns out to be an alias for the **Cygnus Rift**
  (`NAME Cyg Rift`/`NAME Cygnus Rift`, otype DNe, galactic l=74.75,
  b=0.00) - a completely different sky position from the Zucker table's
  own `Northern_Coalsack`-named sightline group (l=91.3-92.6, b=3.5-4.3),
  which sits **16.4 deg** away from that real SIMBAD identification (the
  table's own `SimbadName` column for those rows literally reads
  "Northern_Coalsack" too, but that is the paper's own group-label string
  echoed back, not an independent cross-match confirmation - the exact
  same false-cognate trap #318 documented for Aquila Rift above). A region
  search around the Zucker table's actual `Northern_Coalsack` coordinates
  (ra~314-317, dec~52-53) found only catalog-only dark-nebula designations
  (LDN 1018/1027, DOBASHI 3003/3008/3009/3016/3044, TGU H541 P11) - no
  popularly `NAME`-prefixed SIMBAD identifier exists there to anchor a
  corrected record to. And the real SIMBAD "Northern Coalsack"/Cygnus
  Rift object's own `galdim_majaxis` (1410 arcmin, ~23.5 deg on the sky)
  confirms it is itself an enormous extended dark-lane/superposition
  feature spanning much of Cygnus, not a single coherent cloud - the
  identical "poor fit for this catalog's single-point/single-distance
  object model" reasoning that excluded Aquila Rift in #318. **Excluded**
  as an honest failure, not force-matched/fabricated; the live query that
  led to this discovery (`NAME Northern Coalsack`'s own galdim) is still
  cached/manifested for anyone who wants to independently re-verify it.

**7 honest-failure `size_pc`'s** (North America Nebula, Pelican Nebula,
Circinus, Norma, IC 2118, Lambda Orionis Ring, Draco Cloud): each resolves
cleanly on SIMBAD but carries no `galdim_majaxis` on file under any alias
tried live (`data_sources/simbad_size.py`'s `resolve_angular_diameter`
returned `None` for every alternate identifier attempted for each - see
each record's own `notes` field) - the same honest-failure shape #318 hit
for Coalsack Nebula/Serpens Molecular Cloud and #314 hit for M8/the Lagoon
Nebula. Never fabricated/approximated.

All 9 new records carry the same `group.secondary: ["molecular-cloud-gap-fill"]`
tag #318's own 4 records use (a per-object-type batch tag, not a
per-Story one - `tests/test_molecular_cloud_gap_fill.py`'s own exact-count
checks were relaxed to growth-tolerant ones, mirroring
`tests/test_structure_size_backfill.py`'s own #314 precedent, and this
Story's new `tests/test_molecular_cloud_gap_fill_tier1.py` asserts the
up-to-date total of 13 tagged records). Catalog grew from 1083 to 1092
objects; `galactic-structures build-catalog` + `galactic-structures
export-scene --no-radius-filter --output web/public/data/scene.json`
regenerated the checked-in catalog/scene artifacts, run from this
worktree's own clean `.venv` (pyarrow 25.0.1, matching the version the
test suite runs against - standing lesson from PR #183). Full suite: 404
passed, 4 skipped (18 new tests in `test_molecular_cloud_gap_fill_tier1.py`,
covering presence/type/tagging/distance-sanity/size-sanity/provenance for
all 9 new records, both redundancy checks, the Northern Coalsack exclusion
regression guard, and non-regression of #318's own 4 records).

Not part of this Story: the "second tier" lesser-known Zucker regions
(Cam, Hercules, Pegasus, Polaris Flare, Ursa Major, Lacerta, Spider,
Aquila_Rift) - issue #325's own scope, to start only after this Story
merges (same files touched); any rendering/visual change; or bright
emission/reflection nebulae not found in the Zucker molecular-cloud table
(Iris Nebula, Veil Nebula, Horsehead/Flame) - a separate consideration per
the issue's own scope note.

## The "second tier" remaining Zucker regions (issue #325)

Follow-on to #324 (this Story's own out-of-scope note above). The same
already-cached Zucker table has 8 more real, well-under-800pc named
regions less mainstream-famous than #324's tier: Cam (Camelopardalis),
Hercules, Pegasus, Polaris (Flare), Ursa Major, Lacerta, Spider, and
Aquila_Rift - the human owner's own "add all of them, don't be stingy"
instruction's second half. The issue's own explicit mandate for this
Story: apply the same real-angular-size/offset-from-sightline-group
scrutiny #318 used to exclude Aquila Rift to **every** candidate here, not
just Aquila_Rift, since this tier's lower literature prominence makes the
same false-cognate/superposition trap more likely to recur.

That scrutiny paid off: **4 candidates added, 4 excluded** - a
meaningfully lower success rate than #324's 9/10, but the issue itself
anticipated and explicitly sanctioned exactly this ("a non-trivial
honest-failure rate here would not be surprising or a sign of a bug").

**Matching-quality bar established across #318/#324/#325:** every genuine
same-object match across all three Stories - accepted records and
redundancy checks alike - lands under **~1.8 deg** separation between a
candidate's SIMBAD identification position and the nearest individual row
of the matching Zucker `Name` group (the largest accepted separation
remains #318's Coalsack Nebula at 1.781 deg). This Story treats that
~1.8 deg line as the practical clean-match/false-cognate boundary,
corroborated below by a second, independent check (a `Simbad.query_region`
around each candidate's real Zucker-group centroid, looking for *any*
`NAME`-prefixed common name near the actual data - not just the one alias
first tried).

**4 candidates added** (all comfortably under 1.8 deg):

| Record | Distance | Nearest sightline sep. | size_pc |
| --- | --- | --- | --- |
| Hercules Cloud | 223 pc | 0.562 deg | 13.62 pc (SIMBAD galdim) |
| Pegasus Cloud | 257 pc | 1.718 deg | 53.83 pc (SIMBAD galdim) |
| Spider Cirrus | 369 pc | 0.058 deg | null (honest failure) |
| Ursa Major Cloud | 408 pc | 0.918 deg | null (honest failure) |

Hercules Cloud, Pegasus Cloud, and Spider Cirrus each resolved cleanly on
the first SIMBAD identifier tried (`NAME Hercules Cloud`, `NAME Pegasus
Cloud`, `NAME Spider Cirrus` respectively - all otype `MoC`/"Molecular
Cloud" or `Cld`/"Cloud", not a generic/ambiguous otype). Ursa Major Cloud
needed a corrected identifier - see below.

**4 candidates investigated, deliberately NOT added - all the same
false-cognate/superposition-feature problem #318 first hit for Aquila
Rift and #324 re-hit for Northern Coalsack:**

- **Aquila_Rift** - re-examined per this Story's own explicit mandate
  (not re-attempted blindly; the issue itself warned this candidate was
  already investigated once). Reproduces #318's exact prior finding, cited
  rather than re-derived: SIMBAD's own single-point identification (`NAME
  Aql Rift`) sits **9.586 deg** from the nearest `Aquila_Rift`-named
  sightline, and its own `galdim_majaxis` (1530 arcmin, **~25.5 deg** on
  the sky) confirms it is an enormous superposition/foreground-extinction
  feature, not a single coherent cloud. Same conclusion, same precedent
  cited, not a fresh acquisition attempt.
- **Cam** - SIMBAD's only resolvable identifier, `NAME Cam Cloud` (the
  same string the table's own `SimbadName` column echoes for every
  `Cam`-named row), sits **6.280 deg** from the nearest real `Cam`-named
  sightline. A `Simbad.query_region` (4 deg radius) around the real
  `Cam`-group centroid (ra=84.62, dec=65.91, averaged over its 5 rows)
  found only catalog-only PGCC/TGU/DOBASHI designations there - no
  popularly `NAME`-prefixed common name to anchor a corrected record to
  (the identical search #324 ran for Northern Coalsack, same empty
  result). A few plausible alternate identifiers were tried live (`MBM 3`,
  `LDN 1355`) and each resolved to an unrelated position, not a tighter
  match for this group.
- **Lacerta** - `NAME Lacerta Cloud` sits **6.744 deg** from the nearest
  real `Lacerta`-named sightline. Same empty-region-search result around
  the real centroid (ra=334.67, dec=43.88) - only `NAME BL Lac` (an
  unrelated blazar) within 4 deg, nothing cloud-like.
- **Polaris** - `NAME Polaris Cirrus Cloud` sits **4.440 deg** from the
  nearest real `Polaris`-named sightline. An alternate identifier, `NAME
  Polaris Flare` (also otype `MoC`, with a real `galdim_majaxis` of 360
  arcmin/6 deg), was tried too - **7.511 deg**, worse, not better. Same
  empty-region-search result around the real centroid (ra=92.45,
  dec=80.33) - only unrelated stars/galaxy-group designations within 4
  deg, no cloud-like `NAME`-prefixed object.

**1 candidate required an alias correction rather than exclusion: Ursa
Major.** The most obvious SIMBAD identifier, `NAME UMa Region` (otype
`reg` - a generic region label, not a specific cloud), sits **19.457
deg** from the nearest real `Ursa_Major`-named sightline - worse than the
Aquila Rift exclusion threshold, and would have been excluded under the
identical reasoning used for Cam/Lacerta/Polaris above. But unlike those
three, a *different* SIMBAD identifier for the same physical object
exists and resolves cleanly: `NAME UMa Cloud` (otype `MoC`, also
catalogued as `MBM 32` and known in the literature as "Ursa Major
Cirrus") sits only **0.918 deg** away - a clean match, well inside this
Story's established bar. Added under this corrected identifier, per
`data_sources/simbad_size.py`'s own established "caller tries alternates,
adapter itself never guesses" convention (already used live here, not
just in the abstract) - not under the misleading `NAME UMa Region` alias.

**2 honest-failure `size_pc`'s** (Spider Cirrus, Ursa Major Cloud): each
resolves cleanly on SIMBAD but carries no `galdim_majaxis` on file under
any alias tried live - the same honest-failure shape #318/#324 hit
repeatedly. Never fabricated/approximated.

All 4 new records carry the same `group.secondary:
["molecular-cloud-gap-fill"]` tag #318/#324's records use (a
per-object-type batch tag, not a per-Story one - this Story's new
`tests/test_molecular_cloud_gap_fill_tier2.py` asserts the up-to-date
total of 17 tagged records, and further relaxed #324's own
`tests/test_molecular_cloud_gap_fill_tier1.py` exact-count checks
(`==21`/`==13`) to growth-tolerant `>=` ones, mirroring the same
precedent #324 itself established for #318's checks). `scripts/
acquire_molecular_cloud_gap_fill.py` was extended (not replaced) with
this Story's own 4 candidates, its 3 exclusions (now carrying a 5th
tuple element - the Zucker `Name` group to check same-named rows
against, fixing a previously-unused `same_name` computation left over
from #318), and a new `FALSE_COGNATE_CHECKS` block reproducing the
side-by-side clean-match/false-cognate comparison for Cam/Lacerta/
Polaris/Ursa Major above.

Catalog grew from 1092 to 1096 objects; `galactic-structures build-catalog`
+ `galactic-structures export-scene --no-radius-filter --output
web/public/data/scene.json` regenerated the checked-in catalog/scene
artifacts, run from this worktree's own clean `.venv` (pyarrow 25.0.1,
matching the version the test suite runs against - standing lesson from
PR #183). Full suite: 423 passed, 4 skipped (19 new tests in
`test_molecular_cloud_gap_fill_tier2.py`, covering presence/type/tagging/
distance-sanity/size-sanity/provenance for all 4 new records, the
misleading-alias regression guard, the corrected-identifier check, the
4-candidate exclusion regression guard, and non-regression of #318's and
#324's own 13 records).

Not part of this Story: any rendering/visual change; or bright
emission/reflection nebulae not found in the Zucker molecular-cloud table
(Iris Nebula, Veil Nebula, Horsehead/Flame) - issue #326's own scope,
which depends on this Story merging first (same files touched).
