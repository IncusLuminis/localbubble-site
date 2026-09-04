"""Validates the Story #326 new-record gap-fill: 2 bright, well-known
nebulae NOT in the Zucker et al. 2020 molecular-cloud compendium Stories
#318/#324/#325 mined - Iris Nebula (NGC 7023, added as `molecular_cloud`)
and Veil Nebula/Cygnus Loop (added as `supernova_remnant`, the catalog's
second after Vela SNR) - plus the mandatory, documented redundancy check
that excluded Horsehead Nebula and Flame Nebula as near-duplicates of the
already-loaded Orion Molecular Cloud Complex record.

Unlike #318/#324/#325, none of this Story's candidates are Zucker-table
molecular clouds - see `data/raw/gap_fills/README.md`'s Story #326
section and `scripts/acquire_nebula_gap_fill.py` for the full live-query
narrative (SIMBAD otype classification for Iris Nebula, the literature
distance for Veil Nebula matching Vela SNR's own convention, and the
real-position/physical-offset redundancy check for Horsehead/Flame).
"""

from __future__ import annotations

NON_ZUCKER_TAG = "non-zucker-nebula-gap-fill"

#: Every other gap-fill batch tag already in the catalog - this Story's
#: own additions must stay disjoint from all of them.
OTHER_GAP_FILL_TAGS = {
    "nearby-bright-star-gap-fill",
    "luminous-poster-gap-fill",
    "messier-nebula-gap-fill",
    "local-bubble-bright-named-gap-fill",
    "molecular-cloud-gap-fill",
}

#: Fragments of the two excluded candidates' own common names - regression
#: guard against either accidentally shipping later as a forced/
#: near-duplicate record without this Story's own documented redundancy
#: check being redone.
EXCLUDED_CANDIDATE_NAME_FRAGMENTS = ["horsehead nebula", "flame nebula"]


def _by_id(catalog_objects, object_id):
    matches = [obj for obj in catalog_objects if obj.id == object_id]
    assert len(matches) == 1, f"expected exactly one record with id {object_id!r}, got {len(matches)}"
    return matches[0]


# --- Iris Nebula (molecular_cloud) -----------------------------------------


def test_iris_nebula_present_exactly_once(catalog_objects):
    ids = [obj.id for obj in catalog_objects]
    assert ids.count("iris-nebula") == 1


def test_iris_nebula_is_molecular_cloud_not_hii_region(catalog_objects):
    # The issue's own explicit classification judgment call: a reflection
    # nebula (SIMBAD otype RNe via the co-located "Ced 187" entry) is a
    # poor fit for hii_region (ionized emission, like the 5 already-loaded
    # Messier nebulae) - classified as molecular_cloud instead, extending
    # this catalog's existing dark-nebula precedent (Pipe Nebula, Coalsack
    # Nebula).
    obj = _by_id(catalog_objects, "iris-nebula")
    assert obj.object_type == "molecular_cloud"
    assert obj.object_type != "hii_region"


def test_iris_nebula_distance_is_physically_sane(catalog_objects):
    obj = _by_id(catalog_objects, "iris-nebula")
    assert 300.0 < obj.distance.value_pc < 400.0
    assert obj.distance.error_pc is not None
    assert obj.distance.error_pc > 0.0


def test_iris_nebula_distance_well_under_800pc_cap(catalog_objects):
    obj = _by_id(catalog_objects, "iris-nebula")
    assert obj.distance.value_pc < 800.0


def test_iris_nebula_size_pc_is_honest_failure(catalog_objects):
    # No galdim_majaxis on file under any of 5 aliases tried live - never
    # fabricated.
    obj = _by_id(catalog_objects, "iris-nebula")
    assert obj.visual.size_pc is None


def test_iris_nebula_tagged_with_non_zucker_tag(catalog_objects):
    obj = _by_id(catalog_objects, "iris-nebula")
    assert NON_ZUCKER_TAG in obj.group.secondary


def test_iris_nebula_notes_document_classification_reasoning(catalog_objects):
    obj = _by_id(catalog_objects, "iris-nebula")
    notes_lower = (obj.notes or "").lower()
    assert "reflection nebula" in notes_lower
    assert "rne" in notes_lower or "ced 187" in notes_lower


def test_iris_nebula_source_cites_simbad(catalog_objects):
    obj = _by_id(catalog_objects, "iris-nebula")
    assert obj.source.catalog == "SIMBAD"
    assert "NGC" in obj.source.reference


def test_iris_nebula_has_ngc_7023_alias(catalog_objects):
    obj = _by_id(catalog_objects, "iris-nebula")
    assert "NGC 7023" in obj.aliases


# --- Veil Nebula / Cygnus Loop (supernova_remnant) --------------------------


def test_veil_nebula_present_exactly_once(catalog_objects):
    ids = [obj.id for obj in catalog_objects]
    assert ids.count("veil-nebula-cygnus-loop") == 1


def test_veil_nebula_is_supernova_remnant(catalog_objects):
    obj = _by_id(catalog_objects, "veil-nebula-cygnus-loop")
    assert obj.object_type == "supernova_remnant"


def test_veil_nebula_distance_is_physically_sane(catalog_objects):
    # Fesen et al. 2021 (MNRAS 507, 244): 725 +/- 15 pc, Gaia EDR3-based.
    obj = _by_id(catalog_objects, "veil-nebula-cygnus-loop")
    assert 700.0 < obj.distance.value_pc < 750.0
    assert obj.distance.error_pc == 15.0


def test_veil_nebula_distance_well_under_800pc_cap(catalog_objects):
    obj = _by_id(catalog_objects, "veil-nebula-cygnus-loop")
    assert obj.distance.value_pc < 800.0


def test_veil_nebula_size_pc_is_a_positive_diameter(catalog_objects):
    # SIMBAD galdim_majaxis=230.0 arcmin for "NAME Cyg Loop" at 725pc.
    obj = _by_id(catalog_objects, "veil-nebula-cygnus-loop")
    assert obj.visual.size_pc is not None
    assert 40.0 < obj.visual.size_pc < 60.0


def test_veil_nebula_tagged_with_non_zucker_tag(catalog_objects):
    obj = _by_id(catalog_objects, "veil-nebula-cygnus-loop")
    assert NON_ZUCKER_TAG in obj.group.secondary


def test_veil_nebula_source_cites_fesen_2021_not_simbad_mesdistance(catalog_objects):
    # SIMBAD has no parallax/mesDistance for this object - distance is a
    # literature value, matching Vela SNR's own convention (source cites
    # a specific paper directly, not SIMBAD as the distance catalog).
    obj = _by_id(catalog_objects, "veil-nebula-cygnus-loop")
    assert "Fesen" in obj.source.reference
    assert "2021" in obj.source.reference
    assert obj.source.catalog != "SIMBAD"


def test_veil_nebula_is_the_third_supernova_remnant_record(catalog_objects):
    # The issue itself framed this as "the SECOND supernova_remnant record
    # (currently only Vela SNR exists)" - that turned out to be factually
    # imprecise: M1/the Crab Nebula (id m1_crab, Messier-nebula-gap-fill
    # batch, issue #221) is already object_type supernova_remnant too, so
    # this is actually the THIRD, not the second - caught during this
    # Story's own acquisition rather than trusted blindly, and corrected
    # in this record's own notes.
    snrs = [obj for obj in catalog_objects if obj.object_type == "supernova_remnant"]
    ids = {obj.id for obj in snrs}
    assert len(snrs) == 3
    assert ids == {"vela-supernova-remnant", "m1_crab", "veil-nebula-cygnus-loop"}


def test_veil_nebula_has_cygnus_loop_alias(catalog_objects):
    obj = _by_id(catalog_objects, "veil-nebula-cygnus-loop")
    aliases_lower = [a.lower() for a in obj.aliases]
    assert "cygnus loop" in aliases_lower


# --- Redundancy check: Horsehead / Flame excluded ---------------------------


def test_horsehead_and_flame_were_not_added_as_separate_records(catalog_objects):
    # Both resolve cleanly on live SIMBAD (DNe / HII respectively) but both
    # sit inside the already-loaded Orion Molecular Cloud Complex record's
    # own rendered radius (1.475 deg / ~11.15 pc and 0.970 deg / ~7.33 pc
    # offsets, vs. that record's own 26.45pc radius) and neither carries an
    # independent SIMBAD distance of its own - excluded as redundant, per
    # the issue's own mandatory (and documented) redundancy check.
    for obj in catalog_objects:
        name_and_aliases = " ".join([obj.name, *obj.aliases]).lower()
        for fragment in EXCLUDED_CANDIDATE_NAME_FRAGMENTS:
            assert fragment not in name_and_aliases, (
                f"{obj.id} unexpectedly matches excluded-candidate fragment "
                f"{fragment!r} ({obj.name!r} / {obj.aliases!r})"
            )


def test_orion_molecular_cloud_complex_record_is_unchanged(catalog_objects):
    # The redundancy check compares Horsehead/Flame against this record's
    # own stored position/distance/size - regression guard that Story #326
    # never touched it.
    obj = _by_id(catalog_objects, "orion-molecular-cloud-complex")
    assert obj.distance.value_pc == 433.0
    assert obj.coordinates.ra_deg == 86.2152
    assert obj.coordinates.dec_deg == -1.3456


# --- Batch-level checks ------------------------------------------------------


def test_non_zucker_nebula_tag_covers_exactly_2_records(catalog_objects):
    tagged = [obj for obj in catalog_objects if NON_ZUCKER_TAG in obj.group.secondary]
    tagged_ids = {obj.id for obj in tagged}
    assert len(tagged) == 2
    assert tagged_ids == {"iris-nebula", "veil-nebula-cygnus-loop"}


def test_non_zucker_nebula_tag_does_not_leak_into_other_batches(catalog_objects):
    tagged = [obj for obj in catalog_objects if NON_ZUCKER_TAG in obj.group.secondary]
    for obj in tagged:
        assert not OTHER_GAP_FILL_TAGS.intersection(obj.group.secondary), (
            f"{obj.id} carries {NON_ZUCKER_TAG!r} plus a conflicting batch tag "
            f"{obj.group.secondary!r}"
        )


def test_catalog_has_at_least_1098_objects(catalog_objects):
    # 1096 (after Story #325) + this Story's 2 new records.
    assert len(catalog_objects) >= 1098


def test_neither_new_record_has_a_zero_or_negative_distance(catalog_objects):
    for object_id in ("iris-nebula", "veil-nebula-cygnus-loop"):
        obj = _by_id(catalog_objects, object_id)
        assert obj.distance.value_pc > 0.0
