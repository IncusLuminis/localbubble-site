"""Validates the v1.2 star-cluster/stellar-association population added by
Story #90 (spec `Idea-v1.2-individual-stars.md` §9 item 4), as distinct
from the v1.0 initial-catalog checks in test_initial_catalog.py and the
individual-star checks in test_individual_stars.py.

Unlike Story #88's `star` objects (a brand-new `object_type` with nothing
pre-existing to confuse it with), `star_cluster` (Hyades, Pleiades) and
`stellar_association` (7 OB associations) both already had entries from the
original v1.0 seed catalog (spec §9) before this Story ran. So the fixtures
below isolate Story #90's additions specifically by the Galaxy Map
candidate-provenance note every one of them carries (spec §5 dual
provenance) - the same marker test_individual_stars.py's dual-provenance
test checks for, used here as an identifying filter instead.
"""

import json
import re
from collections import Counter
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
UNRESOLVED_PATH = REPO_ROOT / "data" / "raw" / "galaxy_map" / "unresolved_clusters.json"

# `catalog_objects` fixture is shared via conftest.py.

#: A few well-known clusters from the resolved candidate list, spot-checked
#: by name (not exhaustive - Story #90 resolved 229 distinct clusters/
#: associations total). Compared after collapsing internal whitespace,
#: since SIMBAD's own main_id padding varies ("Cl Platais    8").
EXPECTED_CLUSTER_NAMES = [
    "ic 2391",
    "ic 2602",
    "platais 8",
    "collinder 135",
    "alessi 3",
]

#: Real max distance among resolved clusters is ~883 pc - comfortably
#: inside the poster's own stated 800pc scope plus a margin generous enough
#: to allow for a cluster centroid sitting just past that edge (unlike
#: individual stars, spec §9.4 doesn't hard-cap clusters at the poster's
#: labeled-star magnitude cutoff), while still catching an egregious
#: wrong-object cross-match. 950 pc keeps that margin tight rather than
#: reusing test_individual_stars.py's star-specific 2500 pc ceiling
#: unchanged, which wouldn't meaningfully constrain anything at this scale.
MAX_PLAUSIBLE_CLUSTER_DISTANCE_PC = 950


def _normalize_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text.strip().lower())


@pytest.fixture(scope="module")
def all_cluster_and_association_objects(catalog_objects):
    return [
        obj
        for obj in catalog_objects
        if obj.object_type in ("star_cluster", "stellar_association")
    ]


@pytest.fixture(scope="module")
def new_cluster_objects(all_cluster_and_association_objects):
    # Story #90's additions all carry the Galaxy Map candidate-provenance
    # note; the pre-existing 2 star_cluster (Hyades, Pleiades) and 7
    # stellar_association (OB associations) objects from the v1.0 seed
    # catalog do not.
    return [
        obj
        for obj in all_cluster_and_association_objects
        if obj.notes and "galaxy map" in obj.notes.lower()
    ]


def test_cluster_population_added_at_expected_scale(new_cluster_objects):
    # Story #90 resolved 229 distinct clusters/associations from Story #87's
    # 262 non-skip candidates (264 minus the 2 already_in_catalog entries).
    # Allow some slack rather than pin the exact count.
    assert len(new_cluster_objects) >= 215


def test_no_duplicate_cluster_records(all_cluster_and_association_objects):
    # Mirrors test_individual_stars.py::test_no_duplicate_star_records -
    # checks identity as SIMBAD itself reports it (obj.name), not just
    # catalog-id uniqueness, and covers the *whole* star_cluster/
    # stellar_association population (not just the new ones) so it also
    # regression-tests that Hyades/Pleiades were not silently re-added.
    name_counts = Counter(obj.name for obj in all_cluster_and_association_objects)
    duplicates = {name: count for name, count in name_counts.items() if count > 1}
    assert not duplicates, (
        f"Multiple catalog records resolve to the same real cluster/association: {duplicates}"
    )


def test_hyades_and_pleiades_not_reintroduced(all_cluster_and_association_objects):
    # Story #87 flagged Hyades and Pleiades (Messier 45) as
    # already_in_catalog=True; Story #90 was told to skip them rather than
    # re-resolve. Each should still appear exactly once (from the original
    # v1.0 seed catalog), which test_no_duplicate_cluster_records already
    # guarantees generically - this test just makes the specific intent
    # explicit and would fail clearly if the skip logic regressed.
    def matches(obj, *needles):
        blob = _normalize_ws(obj.name + " " + " ".join(obj.aliases))
        return any(needle in blob for needle in needles)

    hyades_matches = [
        obj.id for obj in all_cluster_and_association_objects
        if matches(obj, "hyades", "melotte 25")
    ]
    pleiades_matches = [
        obj.id for obj in all_cluster_and_association_objects
        if matches(obj, "pleiades", "melotte 22")
    ]
    assert len(hyades_matches) == 1, f"Expected exactly 1 Hyades record, found {hyades_matches}"
    assert len(pleiades_matches) == 1, (
        f"Expected exactly 1 Pleiades record, found {pleiades_matches}"
    )


def test_expected_well_known_clusters_present(new_cluster_objects):
    missing = []
    for expected in EXPECTED_CLUSTER_NAMES:
        if not any(
            expected in _normalize_ws(obj.name)
            or any(expected in _normalize_ws(alias) for alias in obj.aliases)
            for obj in new_cluster_objects
        ):
            missing.append(expected)
    assert not missing, f"Expected well-known clusters not found: {missing}"


def test_every_new_cluster_object_type_is_valid(new_cluster_objects):
    # Story #90 must resolve honestly into one of the two schema-valid
    # types, never force everything into star_cluster (spec: "Some poster
    # entries may actually be OB associations...don't force everything
    # into star_cluster").
    invalid = [
        obj.id for obj in new_cluster_objects
        if obj.object_type not in ("star_cluster", "stellar_association")
    ]
    assert not invalid, f"Unexpected object_type on: {invalid}"
    # At least one genuine association was found and honestly classified
    # as such (not force-fit into star_cluster) - e.g. the "Theia" moving
    # groups behind the poster's "BH 164"/"BH 23" labels.
    assert any(obj.object_type == "stellar_association" for obj in new_cluster_objects)


def test_every_new_cluster_has_dual_provenance(new_cluster_objects):
    # spec §5: source.reference must be the real SIMBAD/Gaia citation, and
    # notes must separately record that the *candidate* came from the
    # Galaxy Map poster - the two provenance trails must not be conflated.
    for obj in new_cluster_objects:
        assert obj.source.reference, f"{obj.id} is missing source.reference"
        assert obj.source.catalog in ("SIMBAD", "Gaia"), (
            f"{obj.id}'s source.catalog is {obj.source.catalog!r}, expected "
            "a real live-resolved source per spec §6"
        )
        assert obj.notes and "galaxy map" in obj.notes.lower(), (
            f"{obj.id} is missing the Galaxy Map candidate-provenance note "
            "in its notes field (spec §5 dual provenance)"
        )


def test_new_cluster_distances_are_physically_sane(new_cluster_objects):
    for obj in new_cluster_objects:
        assert obj.distance.value_pc > 0, f"{obj.id} has non-positive distance"
        assert obj.distance.value_pc < MAX_PLAUSIBLE_CLUSTER_DISTANCE_PC, (
            f"{obj.id} has an implausibly large distance for a poster-visible "
            f"cluster/association: {obj.distance.value_pc} pc"
        )


def test_unresolved_candidates_did_not_silently_enter_the_catalog(
    all_cluster_and_association_objects,
):
    assert UNRESOLVED_PATH.exists()
    unresolved_names = {
        entry["name"].strip().lower() for entry in json.loads(UNRESOLVED_PATH.read_text())
    }
    catalog_names = {obj.name.strip().lower() for obj in all_cluster_and_association_objects}
    # The raw poster label (e.g. an unresolved "ASCC N" designation) should
    # never appear verbatim as a resolved catalog object's name - it was
    # reported unresolved precisely because no confidently-classifiable
    # record was found for it.
    leaked = unresolved_names & catalog_names
    assert not leaked, f"Unresolved candidate(s) leaked into the catalog: {leaked}"
