"""Shared logic for (re)building the checked-in initial catalog (spec Idea.md
§9, Story #59).

Extracted from `scripts/build_initial_catalog.py` so both the standalone
script and the CLI's `build-catalog` subcommand (Story #63) call the exact
same code, per spec §34: "CLI, notebooks, and tests should call the same
underlying library code" rather than duplicating it. The script remains the
documented, spec-referenced rebuild entry point and now simply calls
`build_initial_catalog()` below.
"""

from __future__ import annotations

import json
from pathlib import Path

from .catalog import save_catalog
from .coordinates import derive_galactic_coordinates_batch
from .schema import AstronomicalObject

#: Repository root, computed from this file's location
#: (src/local_galactic_structures/initial_catalog.py -> repo root).
REPO_ROOT = Path(__file__).resolve().parents[2]

DEFAULT_RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"
DEFAULT_PARQUET_PATH = REPO_ROOT / "data" / "normalized" / "catalog.parquet"
DEFAULT_CSV_PATH = REPO_ROOT / "data" / "normalized" / "catalog.csv"


def load_initial_objects(
    records_path: str | Path = DEFAULT_RECORDS_PATH,
) -> list[AstronomicalObject]:
    """Load the checked-in, sourced initial-catalog records from
    `records_path` and re-derive Galactic l/b/XYZ deterministically from
    each record's ra/dec/distance (spec §6), rather than trusting whatever
    was last baked into the JSON, so the catalog stays correct even if the
    coordinate-derivation logic changes later.
    """
    records = json.loads(Path(records_path).read_text())
    objects = [AstronomicalObject.model_validate(r) for r in records]
    return derive_galactic_coordinates_batch(objects)


def build_initial_catalog(
    records_path: str | Path = DEFAULT_RECORDS_PATH,
    parquet_path: str | Path = DEFAULT_PARQUET_PATH,
    csv_path: str | Path | None = DEFAULT_CSV_PATH,
) -> list[AstronomicalObject]:
    """Load the initial catalog records and write them to `parquet_path`
    (and `csv_path`, if given) via `catalog.save_catalog`. Returns the
    loaded objects.
    """
    objects = load_initial_objects(records_path)
    save_catalog(objects, parquet_path, csv_path)
    return objects
