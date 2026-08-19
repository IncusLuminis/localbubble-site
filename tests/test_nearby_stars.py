"""Validates the RECONS "100 nearest stellar systems" batch added to the
catalog (issue #104, spec `Idea-v1.3-visual-fidelity-and-navigation.md`
§2.4), as distinct from the Galaxy Map poster-sourced individual stars
checked by `test_individual_stars.py`.

This batch is a magnitude/parallax-limited census of the real nearest
stars to the Sun (mostly faint red/white dwarfs), explicitly disjoint from
the poster's "luminous star" (bright/distant) selection - see
`data/raw/recons/README.md` for the full method writeup.
"""

import json
from collections import Counter
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
RECONS_DIR = REPO_ROOT / "data" / "raw" / "recons"
UNRESOLVED_PATH = RECONS_DIR / "unresolved_stars.json"
CANDIDATE_STARS_PATH = RECONS_DIR / "candidate_stars.json"

RECONS_BATCH_TAG = "recons-nearest-100"

#: Real max distance among this batch's resolved stars is ~11.3 pc (see
#: data/raw/recons/README.md); a generous margin above that (matching the
#: same sanity-ceiling pattern `resolve_recons.py` itself applied at
#: resolution time) catches an egregious wrong-star cross-match without
#: being so loose it stops constraining anything.
MAX_PLAUSIBLE_NEARBY_STAR_DISTANCE_PC = 30.0

#: A few well-known nearby stars from this batch, spot-checked by name/alias
#: (not exhaustive - 122 distinct stars were resolved in total).
EXPECTED_NEARBY_STAR_FRAGMENTS = [
    "proxima",
    "barnard's star",
    "wolf 359",
    "sirius",
    "tau cet",
]


@pytest.fixture(scope="module")
def nearby_star_objects(catalog_objects):
    return [obj for obj in catalog_objects if RECONS_BATCH_TAG in obj.group.secondary]


def test_recons_batch_present_at_expected_scale(nearby_star_objects):
    # 142 RECONS-listed system components were attempted; 13 were honestly
    # unresolved and 6 systems' components collapsed into a single SIMBAD
    # record each (see data/raw/recons/README.md), leaving 122 distinct
    # catalog records. Allow some slack rather than pin the exact count,
    # since a future re-run of the resolution pipeline could shift it
    # slightly (e.g. a fixed fallback query form resolving a currently-
    # unresolved candidate).
    assert len(nearby_star_objects) >= 110


def test_every_nearby_star_is_object_type_star(nearby_star_objects):
    assert nearby_star_objects, "expected at least one RECONS-tagged object"
    for obj in nearby_star_objects:
        assert obj.object_type == "star", f"{obj.id} has unexpected object_type {obj.object_type!r}"


def test_no_duplicate_nearby_star_records(nearby_star_objects):
    # Regression test for issue #104's own dedup pass: several RECONS-listed
    # multi-star-system components (e.g. "GJ 866 A/B/C") all resolve to the
    # exact same SIMBAD record, since SIMBAD does not carry independent
    # identifier entries for those individual components. Catalog `id`
    # uniqueness alone (already enforced by save_catalog) does not catch two
    # different ids honestly representing the same real star - this checks
    # identity as SIMBAD itself reports it (`obj.name`).
    name_counts = Counter(obj.name for obj in nearby_star_objects)
    duplicates = {name: count for name, count in name_counts.items() if count > 1}
    assert not duplicates, (
        f"Multiple catalog records resolve to the same real star: {duplicates}"
    )


def test_nearby_star_ids_do_not_collide_with_rest_of_catalog(catalog_objects, nearby_star_objects):
    nearby_ids = {obj.id for obj in nearby_star_objects}
    other_ids = {obj.id for obj in catalog_objects if RECONS_BATCH_TAG not in obj.group.secondary}
    assert not (nearby_ids & other_ids)


def test_nearby_star_names_and_aliases_do_not_overlap_rest_of_catalog(
    catalog_objects, nearby_star_objects
):
    # spec §104 acceptance criteria: dedupe against the existing catalog.
    # The RECONS census and the Galaxy Map poster selection are expected to
    # be genuinely disjoint (nearby red/white dwarfs vs. bright/distant
    # giants) - this is an empirical check of that expectation, not an
    # assumption baked into the merge step.
    rest = [obj for obj in catalog_objects if RECONS_BATCH_TAG not in obj.group.secondary]
    rest_names = {obj.name for obj in rest}
    rest_aliases: set[str] = set()
    for obj in rest:
        rest_aliases.update(obj.aliases)

    overlapping = []
    for obj in nearby_star_objects:
        names_to_check = {obj.name} | set(obj.aliases)
        if names_to_check & rest_names or names_to_check & rest_aliases:
            overlapping.append(obj.id)
    assert not overlapping, f"RECONS batch overlaps existing catalog: {overlapping}"


def _normalize_whitespace(text: str) -> str:
    # SIMBAD main_ids sometimes carry fixed-width internal padding (e.g.
    # "Wolf  359" with a double space) - collapse runs of whitespace so a
    # substring check isn't tripped up by that formatting quirk.
    return " ".join(text.split())


def test_expected_well_known_nearby_stars_present(nearby_star_objects):
    missing = []
    for expected in EXPECTED_NEARBY_STAR_FRAGMENTS:
        if not any(
            expected in _normalize_whitespace(obj.name.lower())
            or any(expected in _normalize_whitespace(alias.lower()) for alias in obj.aliases)
            for obj in nearby_star_objects
        ):
            missing.append(expected)
    assert not missing, f"Expected well-known nearby stars not found: {missing}"


def test_every_nearby_star_has_dual_provenance(nearby_star_objects):
    # spec `Idea-v1.2-individual-stars.md` §5: source.reference must be the
    # real SIMBAD citation, and notes must separately record that the
    # *candidate* came from the RECONS table - the two provenance trails
    # must not be conflated (and must NOT cite the Galaxy Map poster, per
    # issue #104's acceptance criteria - this data doesn't come from it).
    for obj in nearby_star_objects:
        assert obj.source.reference, f"{obj.id} is missing source.reference"
        assert obj.source.catalog == "SIMBAD", (
            f"{obj.id}'s source.catalog is {obj.source.catalog!r}, expected SIMBAD"
        )
        assert obj.notes and "recons" in obj.notes.lower(), (
            f"{obj.id} is missing the RECONS candidate-provenance note in "
            "its notes field (spec §5 dual provenance)"
        )
        assert "galaxy map" not in obj.notes.lower(), (
            f"{obj.id}'s notes wrongly cite the Galaxy Map poster - this "
            "batch's candidate provenance is RECONS, not the poster "
            "(issue #104 acceptance criteria)"
        )


def test_nearby_star_distances_are_physically_sane(nearby_star_objects):
    for obj in nearby_star_objects:
        assert obj.distance.value_pc > 0, f"{obj.id} has non-positive distance"
        assert obj.distance.value_pc < MAX_PLAUSIBLE_NEARBY_STAR_DISTANCE_PC, (
            f"{obj.id} has an implausibly large distance for a nearest-star "
            f"census entry: {obj.distance.value_pc} pc"
        )


def test_unresolved_candidates_did_not_silently_enter_the_catalog(nearby_star_objects):
    assert UNRESOLVED_PATH.exists()
    unresolved_queries = {
        entry["query"].strip().lower() for entry in json.loads(UNRESOLVED_PATH.read_text())
    }
    catalog_names = {obj.name.strip().lower() for obj in nearby_star_objects}
    catalog_aliases: set[str] = set()
    for obj in nearby_star_objects:
        catalog_aliases.update(a.strip().lower() for a in obj.aliases)
    # A query string reported unresolved should never itself appear verbatim
    # as a resolved catalog object's name/alias - it was reported unresolved
    # precisely because no usable record was found for it.
    leaked = unresolved_queries & (catalog_names | catalog_aliases)
    assert not leaked, f"Unresolved candidate(s) leaked into the catalog: {leaked}"


def test_candidate_list_and_unresolved_list_are_checked_in():
    # The candidate list itself (rank/query/fallback forms) is checked in
    # for reproducibility/provenance, mirroring the Galaxy Map batch's own
    # candidate_stars.json (data/raw/galaxy_map/).
    assert CANDIDATE_STARS_PATH.exists()
    candidates = json.loads(CANDIDATE_STARS_PATH.read_text())
    assert len(candidates) == 100  # 100 ranked systems
    total_components = sum(len(system["components"]) for system in candidates)
    assert total_components == 142
