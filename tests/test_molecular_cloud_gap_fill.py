"""Validates the Story #318 new-record `molecular_cloud` gap-fill (follow-on
to Epic #313): the catalog's original 8 `molecular_cloud` records (spec
`Idea.md` §9's own minimum seed list - Cepheus Flare, Chamaeleon, Lupus,
Ophiuchus/Rho Ophiuchi, Orion Molecular Cloud Complex, Perseus, Pipe
Nebula, Taurus) were never expanded beyond that seed list, despite the
spec's own ~800pc scope leaving clear room for more well-known, nearby
named regions.

Unlike Story #307/#314 (both BACKFILLS onto already-curated records), this
is a NEW-RECORD gap-fill (`data/raw/gap_fills/README.md` convention,
adapted here for molecular clouds) - 4 new records, each sourced via the
same two-step convention the original 8 already use: DISTANCE from the
real, live-queried VizieR table `J/A+A/633/A51/handbook` (Zucker et al.
2020, "A compendium of distances to molecular clouds in the Star Formation
Handbook"), POSITION from a separate SIMBAD identification-only
cross-match, and `size_pc` (where resolvable) via the same SIMBAD
`galdim_majaxis`-based DIAMETER convention `data_sources/simbad_size.py`
(Story #314) established for this object type.

2 of 4 new records (Coalsack Nebula, Serpens Molecular Cloud) have
`visual.size_pc: null` - an honest failure (SIMBAD has no `galdim_majaxis`
on file for either named object under any alias tried live), not a
regression: Story #314 hit the identical shape of honest failure for
M8/the Lagoon Nebula.

Two of the issue's own researched candidates were investigated and
deliberately NOT added, both individually honest-failure-documented in
each new record's own `notes` (see `corona-australis-molecular-cloud`/
`serpens-molecular-cloud` `source`/`notes` fields for the full
investigation writeup):

* **Musca Molecular Cloud** - no VizieR `J/A+A/633/A51/handbook` sightline
  resolves within a reasonable angular separation of SIMBAD's own "NAME
  Musca" identification position (nearest tabulated sightline, in the
  unrelated "Coalsack" group, is 6.0 deg away).
* **Aquila Rift** (as a record distinct from Serpens Molecular Cloud) -
  SIMBAD's own single-point identification for it sits >9 deg from every
  one of the table's own "Aquila_Rift"-named sightlines, and its SIMBAD
  `galdim_majaxis` (~25.5 deg) confirms it is an enormous extended
  superposition/extinction feature, a poor fit for this catalog's
  single-point/single-distance object model.
"""

from __future__ import annotations

TAG = "molecular-cloud-gap-fill"

#: (catalog id, (min_pc, max_pc) sanity window around this Story's own
#: live-resolved Zucker+2020 d50 value) - mirrors the generous-margin
#: convention `test_local_bubble_bright_star_gap_fill.py`'s own
#: `GAP_FILL_STARS` table uses, guarding against a gross regression while
#: tolerating a small drift on a future live re-resolution.
NEW_MOLECULAR_CLOUDS = [
    ("corona-australis-molecular-cloud", (130.0, 165.0)),
    ("coalsack-nebula", (165.0, 200.0)),
    ("california-molecular-cloud", (400.0, 500.0)),
    ("serpens-molecular-cloud", (380.0, 470.0)),
]

#: Original 8 seed-list molecular_cloud ids (spec Idea.md §9) - used to
#: confirm this Story's addition left them untouched.
ORIGINAL_EIGHT_IDS = {
    "cepheus-flare",
    "chamaeleon-molecular-cloud",
    "lupus-molecular-cloud",
    "ophiuchus-rho-ophiuchi-molecular-cloud",
    "orion-molecular-cloud-complex",
    "perseus-molecular-cloud",
    "pipe-nebula",
    "taurus-molecular-cloud",
}

#: This Story's own honest-failure investigation results: candidates the
#: issue itself raised, live-checked, and explicitly did NOT add as
#: standalone records. Regression guard against accidentally introducing a
#: forced/fabricated record for either later.
EXCLUDED_CANDIDATE_NAME_FRAGMENTS = ["musca", "aquila rift", "aql rift"]

#: Every other gap-fill batch tag already in the catalog - this Story's
#: own tag must stay disjoint from all of them (mirrors every other
#: gap-fill test module's own version of this check).
OTHER_GAP_FILL_TAGS = {
    "nearby-bright-star-gap-fill",
    "luminous-poster-gap-fill",
    "messier-nebula-gap-fill",
    "local-bubble-bright-named-gap-fill",
}


def _by_id(catalog_objects, object_id):
    matches = [obj for obj in catalog_objects if obj.id == object_id]
    assert len(matches) == 1, f"expected exactly one record with id {object_id!r}, got {len(matches)}"
    return matches[0]


def test_all_4_new_molecular_clouds_present_exactly_once(catalog_objects):
    ids = [obj.id for obj in catalog_objects]
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        assert ids.count(object_id) == 1, f"{object_id} should appear exactly once, found {ids.count(object_id)}"


def test_new_records_are_type_molecular_cloud(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.object_type == "molecular_cloud"


def test_new_records_tagged_with_correct_provenance_tag(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert TAG in obj.group.secondary, (
            f"{object_id} expected tag {TAG!r}, got {obj.group.secondary!r}"
        )


def test_new_record_distances_are_physically_sane(catalog_objects):
    for object_id, (min_pc, max_pc) in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert min_pc < obj.distance.value_pc < max_pc, (
            f"{object_id} distance {obj.distance.value_pc} pc outside expected "
            f"[{min_pc}, {max_pc}] pc"
        )


def test_new_record_distances_are_well_under_800pc(catalog_objects):
    # The spec's own stated molecular_cloud scope (Idea.md §9: "structures
    # within approximately 800 pc of the Sun") - this Story's own
    # acceptance criterion is "well under" that cap, not merely inside it.
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.distance.value_pc < 500.0, (
            f"{object_id} distance {obj.distance.value_pc} pc is not well under "
            "the spec's 800pc molecular_cloud scope"
        )


def test_new_record_distances_have_a_positive_error_pc(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.distance.error_pc is not None
        assert obj.distance.error_pc > 0.0


def test_new_records_cite_zucker_2020_vizier_source(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert "Zucker" in obj.source.reference
        assert "J/A+A/633/A51" in (obj.source.catalog or "")
        assert obj.source.url == "https://doi.org/10.1051/0004-6361/201936145"


def test_new_records_document_simbad_identification_only_position(catalog_objects):
    # Spec-required dual provenance (same convention the original 8
    # records already use): SIMBAD is cited for position identification,
    # distance is cited separately from the Zucker+2020 compendium.
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert "SIMBAD" in obj.source.reference
        assert "identification only" in obj.source.reference


def test_new_records_with_populated_size_pc_are_positive_diameters(catalog_objects):
    # Corona Australis and California both resolved a real SIMBAD
    # galdim_majaxis -> size_pc (DIAMETER convention, Story #314).
    for object_id in ("corona-australis-molecular-cloud", "california-molecular-cloud"):
        obj = _by_id(catalog_objects, object_id)
        assert obj.visual.size_pc is not None
        assert obj.visual.size_pc > 0.0


def test_new_records_with_honest_failure_size_pc_are_null_and_documented(catalog_objects):
    # Coalsack Nebula and Serpens Molecular Cloud: SIMBAD has no
    # galdim_majaxis on file under any alias tried - never fabricated.
    for object_id in ("coalsack-nebula", "serpens-molecular-cloud"):
        obj = _by_id(catalog_objects, object_id)
        assert obj.visual.size_pc is None
        notes_lower = (obj.notes or "").lower()
        assert "honest failure" in notes_lower


def test_new_records_notes_document_gap_fill_provenance(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        notes_lower = (obj.notes or "").lower()
        assert "gap-fill" in notes_lower or "gap fill" in notes_lower


def test_original_eight_molecular_clouds_are_unchanged(catalog_objects):
    by_id = {obj.id: obj for obj in catalog_objects}
    expected = {
        "cepheus-flare": (352.0, 90.0),
        "chamaeleon-molecular-cloud": (210.0, 29.321531433504738),
        "lupus-molecular-cloud": (151.0, 28.98991887562581),
        "ophiuchus-rho-ophiuchi-molecular-cloud": (139.0, 24.26007660272118),
        "orion-molecular-cloud-complex": (433.0, 52.90092962794813),
        "perseus-molecular-cloud": (276.0, 24.08554367752175),
        "pipe-nebula": (163.0, 11.37954672300303),
        "taurus-molecular-cloud": (147.0, 19.24225500323748),
    }
    for object_id, (distance_pc, size_pc) in expected.items():
        obj = by_id[object_id]
        assert obj.distance.value_pc == distance_pc
        assert obj.visual.size_pc == size_pc
        assert TAG not in obj.group.secondary


def test_catalog_now_has_exactly_12_molecular_cloud_records(catalog_objects):
    molecular_clouds = [obj for obj in catalog_objects if obj.object_type == "molecular_cloud"]
    ids = {obj.id for obj in molecular_clouds}
    assert len(molecular_clouds) == 12
    assert ids == ORIGINAL_EIGHT_IDS | {oid for oid, _ in NEW_MOLECULAR_CLOUDS}


def test_gap_fill_tag_does_not_leak_into_other_batches(catalog_objects):
    tagged = [obj for obj in catalog_objects if TAG in obj.group.secondary]
    assert len(tagged) == 4
    for obj in tagged:
        assert not OTHER_GAP_FILL_TAGS.intersection(obj.group.secondary), (
            f"{obj.id} carries {TAG!r} plus a conflicting batch tag {obj.group.secondary!r}"
        )
    for obj in catalog_objects:
        if OTHER_GAP_FILL_TAGS.intersection(obj.group.secondary):
            assert TAG not in obj.group.secondary


def test_excluded_candidates_were_not_added_as_separate_records(catalog_objects):
    # Musca and Aquila Rift were investigated (per this module's own
    # docstring) and deliberately excluded as honest failures - regression
    # guard against either accidentally shipping later as a fabricated/
    # forced match.
    for obj in catalog_objects:
        name_and_aliases = " ".join([obj.name, *obj.aliases]).lower()
        for fragment in EXCLUDED_CANDIDATE_NAME_FRAGMENTS:
            assert fragment not in name_and_aliases, (
                f"{obj.id} unexpectedly matches excluded-candidate fragment {fragment!r} "
                f"({obj.name!r} / {obj.aliases!r})"
            )


def test_no_new_molecular_cloud_record_has_a_zero_or_negative_distance(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.distance.value_pc > 0.0
