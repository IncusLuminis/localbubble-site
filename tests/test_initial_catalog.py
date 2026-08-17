"""Validates the initial >=20-object catalog required by spec Idea.md §9
(Story #59), as distinct from schema/storage-mechanism tests in
test_catalog.py.
"""

from pathlib import Path

import numpy as np
import pytest

from local_galactic_structures.catalog import load_catalog

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = REPO_ROOT / "data" / "normalized" / "catalog.parquet"

# Substrings expected to appear somewhere in the catalog's object names/ids,
# covering every entry in spec §9's seed list. Matched loosely (case-
# insensitive substring) since exact naming/type judgment calls are the
# resolving Story's job, not this test's.
EXPECTED_NAME_FRAGMENTS = [
    "sun",
    "orion molecular cloud",
    "taurus molecular cloud",
    "perseus molecular cloud",
    "ophiuchus",
    "lupus",
    "chamaeleon",
    "cepheus flare",
    "pipe nebula",
    "pleiades",
    "hyades",
    "scorpius-centaurus",
    "orion ob1",
    "perseus ob2",
    "cepheus ob2",
    "cepheus ob3",
    "cepheus ob4",
    "vela-ob2",  # spec §9's "Vela region"
    "vela-supernova-remnant",  # spec §9's "Vela SNR" - checked separately
    # from "Vela region" so this test actually proves both distinct spec
    # §9 Vela entries are present, not just that any one Vela-named
    # object exists
    "local bubble",
]


@pytest.fixture(scope="module")
def catalog_objects():
    assert CATALOG_PATH.exists(), (
        "data/normalized/catalog.parquet is missing - run "
        "scripts/build_initial_catalog.py"
    )
    return load_catalog(CATALOG_PATH)


def test_catalog_has_at_least_20_objects(catalog_objects):
    assert len(catalog_objects) >= 20


def test_spec_seed_list_is_represented(catalog_objects):
    haystack = " | ".join(
        f"{obj.id} {obj.name}".lower() for obj in catalog_objects
    )
    missing = [
        fragment for fragment in EXPECTED_NAME_FRAGMENTS if fragment not in haystack
    ]
    assert not missing, f"Seed-list objects not found in catalog: {missing}"


def test_every_object_has_traceable_source(catalog_objects):
    for obj in catalog_objects:
        assert obj.source.reference, f"{obj.id} is missing source.reference"
        # A traceable reference is a real citation, not a placeholder.
        assert len(obj.source.reference) > 10, (
            f"{obj.id}'s source.reference looks too short to be a real citation: "
            f"{obj.source.reference!r}"
        )


def test_distance_error_preserved_where_available(catalog_objects):
    with_error = [obj for obj in catalog_objects if obj.distance.error_pc is not None]
    # Not every source states an uncertainty (e.g. the Sun, by convention),
    # but the majority of a real, sourced catalog should carry one.
    assert len(with_error) >= 15, (
        f"Expected most of the >=20 objects to carry distance_error_pc "
        f"(spec §20); only {len(with_error)} did"
    )


def test_derived_distance_matches_stated_distance(catalog_objects):
    for obj in catalog_objects:
        reconstructed = np.sqrt(
            obj.cartesian.x_pc**2 + obj.cartesian.y_pc**2 + obj.cartesian.z_pc**2
        )
        assert reconstructed == pytest.approx(obj.distance.value_pc, abs=1e-3), (
            f"{obj.id}: derived XYZ does not reproduce the stated distance "
            f"({reconstructed} vs {obj.distance.value_pc})"
        )


def test_sun_is_still_the_origin(catalog_objects):
    sun = next(obj for obj in catalog_objects if obj.id == "sun")
    assert sun.cartesian.x_pc == 0.0
    assert sun.cartesian.y_pc == 0.0
    assert sun.cartesian.z_pc == 0.0


def test_object_ids_are_unique(catalog_objects):
    ids = [obj.id for obj in catalog_objects]
    assert len(ids) == len(set(ids))
