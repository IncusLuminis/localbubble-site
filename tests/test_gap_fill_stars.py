"""Validates standalone single-star "gap-fill" catalog additions (issue
#207) - distinct from the batch-sourced Galaxy Map (`test_individual_stars.py`)
and RECONS (`test_nearby_stars.py`) additions.

See `data/raw/gap_fills/README.md` for the full writeup of why this
mechanism exists.
"""

GAP_FILL_TAG = "nearby-bright-star-gap-fill"


def _find_fomalhaut(catalog_objects):
    return [
        obj
        for obj in catalog_objects
        if "fomalhaut" in obj.name.lower()
        or any("fomalhaut" in alias.lower() for alias in obj.aliases)
    ]


def test_fomalhaut_present_and_tagged_as_gap_fill(catalog_objects):
    matches = _find_fomalhaut(catalog_objects)
    assert len(matches) == 1, f"expected exactly one Fomalhaut record, found {len(matches)}"
    fomalhaut = matches[0]
    assert fomalhaut.object_type == "star"
    assert GAP_FILL_TAG in fomalhaut.group.secondary


def test_fomalhaut_distance_is_physically_sane(catalog_objects):
    fomalhaut = _find_fomalhaut(catalog_objects)[0]
    # Public figures commonly cite ~25.13 ly (~7.70 pc); allow a small
    # margin either side rather than pin SIMBAD's exact parallax-derived
    # figure, which can shift slightly on a future re-resolution.
    assert 7.0 < fomalhaut.distance.value_pc < 8.5


def test_fomalhaut_has_dual_provenance_and_does_not_claim_recons_membership(catalog_objects):
    fomalhaut = _find_fomalhaut(catalog_objects)[0]
    assert fomalhaut.source.catalog == "SIMBAD"
    assert fomalhaut.source.reference
    notes_lower = (fomalhaut.notes or "").lower()
    # Must document the gap-fill story...
    assert "gap-fill" in notes_lower or "gap fill" in notes_lower
    # ...but must NOT claim it was on the original RECONS candidate list -
    # it wasn't (that's the whole point of issue #207's fix #1).
    assert "recons-nearest-100" not in fomalhaut.group.secondary


def test_gap_fill_group_tag_does_not_leak_into_recons_batch(catalog_objects):
    # Regression guard: the gap-fill mechanism must stay disjoint from the
    # RECONS batch's own tag/tests (test_nearby_stars.py counts/asserts
    # against "recons-nearest-100" specifically).
    recons_tagged = [
        obj for obj in catalog_objects if "recons-nearest-100" in obj.group.secondary
    ]
    for obj in recons_tagged:
        assert GAP_FILL_TAG not in obj.group.secondary
