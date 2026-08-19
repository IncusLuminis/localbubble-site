# RECONS nearest-100-systems candidate resolution (issue #104, spec `Idea-v1.3-visual-fidelity-and-navigation.md` §2.4)

Source: RECONS (Research Consortium On Nearby Stars) "The 100 Nearest Star
Systems" table, live-fetched from the project's own host
(`astro.gsu.edu/RECONS/TOP100.posted.htm`, `recons.org` points at the same
project), retrieved 2026-08-18. The page itself states the table is "as of
January 1, 2012" - a 2012-vintage system list, used here **only to identify
which star systems to look up**, exactly like the Galaxy Map poster was
used in Story #87/#88 (`../galaxy_map/README.md`). No RA/Dec/distance value
from this RECONS table is ever written into the catalog - every resolved
record's `distance`/`coordinates` comes from a live SIMBAD query, not from
this table's own (now 14-year-old) figures.

This is the disjoint, denser, closer-in follow-up batch spec
`Idea-v1.2-individual-stars.md` §4 explicitly deferred: the Galaxy Map
poster (Story #87/#88) is a "luminous star" (visually bright / abs mag
< -2.8) selection, biased toward distant giants, and essentially none of
the real nearest stars to the Sun (mostly faint red/white dwarfs) are
bright enough to appear on it. This batch's zero overlap with the existing
834-object catalog (see "Dedup against the existing catalog" below)
confirms that bias empirically.

## Method

100 ranked systems, 142 individual star-system components in total (many
systems are multiples - e.g. rank 1 is `alpha Centauri A/B` + `Proxima
Centauri`), transcribed from the live RECONS page. Explicit exoplanet rows
were excluded - they are not stars. Each component was resolved against
live SIMBAD via the same `SimbadResolver` (dual-provenance, honest-failure)
pipeline Story #88/#90 already used for the Galaxy Map batches - first the
RECONS-printed identifier (usually a Gliese/GJ number), then one or more
plausible fallback query forms (common name, Bayer designation, etc.),
first hit wins. The candidate list itself (rank, primary query, fallback
forms per component) is checked in as `candidate_stars.json`.

Every resolved record carries dual provenance (spec
`Idea-v1.2-individual-stars.md` §5): `source.reference`/`source.catalog` is
the real SIMBAD citation (parallax-derived distance, `coo_bibcode` where
SIMBAD provides one); `notes` separately records that the candidate was
selected from this RECONS table - the two provenance trails are never
conflated, and it is `notes`, not `source`, that ever mentions "RECONS".

## Results

- **122 resolved** stars (`resolved_stars.json`), all `object_type: "star"`,
  tagged `group.secondary: ["recons-nearest-100"]`.
- **13 genuinely unresolved** (`unresolved_stars.json`) - no fabricated
  guesses:
  - **8** components have no SIMBAD record at all under the RECONS-printed
    identifier or any plausible fallback form tried (`SCR 1845-6357 A/B`,
    `DENIS J1048-3956`, `DENIS J0255-4700`, `GJ 229 A`, `GJ 1005 A/B`,
    `GJ 644 D`) - several of these are brown-dwarf companions (`SCR
    1845-6357 B`, `GJ 229 B`'s stellar-primary counterpart `GJ 229 A`
    itself, etc.) or components too faint/close to their primary for
    SIMBAD to carry an independently cross-identified entry.
  - **5** components resolve to a real SIMBAD record but with no usable
    parallax on file (`GJ 280 B` = Procyon B, `GJ 234 B`, `GJ 783 B`, `GJ
    661 A`, `GJ 661 B`) - consistent with Story #88's same honest-failure
    behavior (`SimbadResolver` never fabricates a distance).
- **0 rejected for implausible distance** (`rejected_implausible_distance.json`
  is an empty list) - a generous 30 pc sanity ceiling (well above the real
  ~11 pc extent this batch actually resolved to) caught no wrong-star
  cross-matches.

## Dedup within this batch

For **6** of the 100 ranked systems, two or three separately-listed RECONS
components (e.g. `GJ 866 A`/`GJ 866 B`/`GJ 866 C`, the EZ Aquarii triple)
all resolved to the exact same SIMBAD record - same main identifier, same
position, same parallax. SIMBAD does not carry independent identifier
entries for those individual components, so treating each as its own
catalog object would fabricate distinct positions for something the
underlying data source itself does not distinguish. Each such group was
collapsed to a single catalog record (the first-resolved copy), with a note
appended documenting how many RECONS-listed components collapsed into it.
This is why the raw resolution pass's 129 successful queries become **122**
distinct catalog records:

| Collapsed SIMBAD record | RECONS components collapsed |
| --- | --- |
| `V* EZ Aqr` (rank 12) | `GJ 866 A`, `GJ 866 B`, `GJ 866 C` |
| `* eps Ind B` (rank 17) | `GJ 845 B`, `GJ 845 C` |
| `G 208-44` (rank 37) | `GJ 1245 A`, `GJ 1245 C` |
| `HD 131976` (rank 71) | `GJ 570 B`, `GJ 570 C` |
| `V* QY Aur` (rank 84) | `GJ 268 A`, `GJ 268 B` |
| `HD 152751` (rank 95) | `GJ 644 A`, `GJ 644 B` |

## Dedup against the existing catalog

Cross-checked all 122 resolved records' `id`, `name`, and every alias
against the existing 834-object catalog's own `id`/`name`/aliases: **zero
overlap** in either direction. Expected - the existing catalog is a
"luminous star" (bright/distant) selection (see "Source" above); genuinely
nearby stars are almost all far too faint to have made that cut.

## LOD note

This batch is dense within a small radius (max resolved distance ~11.3 pc,
vs. the existing catalog's near-Sun objects typically hundreds of pc out).
Per issue #104's acceptance criteria, the web viewer must not render these
markers at default/overview zoom (would reintroduce issue #89's clutter
problem) - see `web/src/scene/lod.ts` for the camera-distance-gated
visibility rule, keyed off the same `"recons-nearest-100"` group tag used
here.
