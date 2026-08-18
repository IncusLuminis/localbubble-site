"""Shared fixtures for tests against the built catalog (spec §9, v1.2).

Extracted here (Story #88 code-review) since test_initial_catalog.py and
test_individual_stars.py both need the same "load the real catalog file"
fixture and had been duplicating it.
"""

from pathlib import Path

import pytest

from local_galactic_structures.catalog import load_catalog

REPO_ROOT = Path(__file__).resolve().parent.parent
CATALOG_PATH = REPO_ROOT / "data" / "normalized" / "catalog.parquet"


@pytest.fixture(scope="session")
def catalog_objects():
    assert CATALOG_PATH.exists(), (
        "data/normalized/catalog.parquet is missing - run "
        "scripts/build_initial_catalog.py"
    )
    return load_catalog(CATALOG_PATH)
