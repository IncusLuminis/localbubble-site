"""Validates the v1.2 individual-star population added to the catalog
(Story #88, spec `Idea-v1.2-individual-stars.md`), as distinct from the
v1.0 initial-catalog checks in test_initial_catalog.py.
"""

import json
from collections import Counter
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
UNRESOLVED_PATH = REPO_ROOT / "data" / "raw" / "galaxy_map" / "unresolved_stars.json"

# `catalog_objects` fixture is shared via conftest.py.

#: A few well-known stars from the resolved batches, spot-checked by name
#: (not exhaustive - Story #88 resolved 585 distinct stars total).
EXPECTED_STAR_NAMES = [
    "canopus",
    "polaris",
    "rigel",
    "spica",
    "antares",
    "acrux",
]

#: Real max distance among resolved stars is ~1840 pc (55 Cyg) - a wide
#: margin above that catches an egregious wrong-star cross-match without
#: being so loose (the original 5000 pc ceiling, flagged during Story #88's
#: Validator review as not actually constraining anything) that a match
#: several times too distant would still silently pass.
MAX_PLAUSIBLE_STAR_DISTANCE_PC = 2500


@pytest.fixture(scope="module")
def star_objects(catalog_objects):
    return [obj for obj in catalog_objects if obj.object_type == "star"]


def test_star_population_added_at_expected_scale(star_objects):
    # Story #88 resolved 585 distinct stars from Story #87's 595 candidates
    # (after de-duplicating by real SIMBAD identity, not just by catalog
    # id - see test_no_duplicate_star_records). Allow some slack rather
    # than pin the exact count, since a future re-run of the extraction/
    # resolution pipeline could shift it slightly.
    assert len(star_objects) >= 575


def test_no_duplicate_star_records(star_objects):
    # Regression test for the bug found in Story #88's Validator review:
    # a cache-key collision in the shared `slugify()` helper (non-ASCII
    # Bayer-letter characters were stripped rather than encoded) caused
    # multiple *different* real stars to be silently resolved to whichever
    # star happened to be cached first under the same collapsed key,
    # producing several real stars each duplicated 2-4x under distinct
    # catalog ids (e.g. "iot-cma", "iot-cma-2", "iot-cma-3", "iot-cma-4"
    # all actually representing one real star). `id` uniqueness alone
    # (already enforced by save_catalog) does not catch this - two
    # different ids can each honestly represent the same real star. This
    # checks identity as SIMBAD/Gaia itself reports it (`obj.name`, the
    # resolved main_id), which is the actual "is this the same star"
    # signal.
    name_counts = Counter(obj.name for obj in star_objects)
    duplicates = {name: count for name, count in name_counts.items() if count > 1}
    assert not duplicates, (
        f"Multiple catalog records resolve to the same real star: {duplicates}"
    )


def test_expected_well_known_stars_present(star_objects):
    # SIMBAD's main_id (used as `name`) is usually the Bayer/Flamsteed
    # designation (e.g. "* alf CMa"), not the common name - common names
    # like "Canopus" show up among a *specific* object's `aliases`, not
    # just somewhere in the catalog. Checked per-object (not via a single
    # catalog-wide haystack) so this can't pass because an unrelated
    # object's alias happens to contain the substring.
    missing = []
    for expected in EXPECTED_STAR_NAMES:
        if not any(
            expected in obj.name.lower()
            or any(expected in alias.lower() for alias in obj.aliases)
            for obj in star_objects
        ):
            missing.append(expected)
    assert not missing, f"Expected well-known stars not found: {missing}"


def test_every_star_has_dual_provenance(star_objects):
    # spec §5: source.reference must be the real SIMBAD/Gaia citation, and
    # notes must separately record that the *candidate* came from the
    # Galaxy Map poster - the two provenance trails must not be conflated.
    for obj in star_objects:
        assert obj.source.reference, f"{obj.id} is missing source.reference"
        assert obj.source.catalog in ("SIMBAD", "Gaia"), (
            f"{obj.id}'s source.catalog is {obj.source.catalog!r}, expected "
            "a real live-resolved source per spec §6"
        )
        assert obj.notes and "galaxy map" in obj.notes.lower(), (
            f"{obj.id} is missing the Galaxy Map candidate-provenance note "
            "in its notes field (spec §5 dual provenance)"
        )


def test_star_distances_are_physically_sane(star_objects):
    for obj in star_objects:
        assert obj.distance.value_pc > 0, f"{obj.id} has non-positive distance"
        assert obj.distance.value_pc < MAX_PLAUSIBLE_STAR_DISTANCE_PC, (
            f"{obj.id} has an implausibly large distance for a poster-visible "
            f"luminous star: {obj.distance.value_pc} pc"
        )


def test_unresolved_candidates_did_not_silently_enter_the_catalog(star_objects):
    assert UNRESOLVED_PATH.exists()
    unresolved_names = {
        entry["name"].strip().lower() for entry in json.loads(UNRESOLVED_PATH.read_text())
    }
    catalog_names = {obj.name.strip().lower() for obj in star_objects}
    # The raw poster label (e.g. "Unurgunite") should never appear verbatim
    # as a resolved catalog object's name - it was reported unresolved
    # precisely because no real record was found for it.
    leaked = unresolved_names & catalog_names
    assert not leaked, f"Unresolved candidate(s) leaked into the catalog: {leaked}"
