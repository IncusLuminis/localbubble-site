#!/usr/bin/env python3
"""Build the initial >=20-object catalog required by spec Idea.md §9 (Story #59).

Source records live in data/normalized/initial_catalog_records.json - each
one already carries a traceable source.reference (per spec §11) resolved via
either a live SIMBAD/Gaia/VizieR query (Story #58's data_sources/ adapters)
or a cited literature value (data_sources/literature.py) for objects too
diffuse/extended for a clean point-source resolution. That file is the
documented, checked-in source of truth this script rebuilds from - see spec
§14 (a clean checkout plus this script must be sufficient to rebuild the
derived catalog, without needing live network access).

Usage:
    python scripts/build_initial_catalog.py
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from local_galactic_structures.catalog import save_catalog  # noqa: E402
from local_galactic_structures.coordinates import (  # noqa: E402
    derive_galactic_coordinates_batch,
)
from local_galactic_structures.schema import AstronomicalObject  # noqa: E402

REPO_ROOT = Path(__file__).resolve().parent.parent
RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"


def load_initial_objects() -> list[AstronomicalObject]:
    records = json.loads(RECORDS_PATH.read_text())
    objects = [AstronomicalObject.model_validate(r) for r in records]
    # Re-derive Galactic l/b/XYZ deterministically from ra/dec/distance rather
    # than trusting whatever was last baked into the JSON, so the catalog
    # stays correct even if the schema's derivation logic changes later.
    return derive_galactic_coordinates_batch(objects)


def main() -> None:
    objects = load_initial_objects()
    parquet_path = REPO_ROOT / "data" / "normalized" / "catalog.parquet"
    csv_path = REPO_ROOT / "data" / "normalized" / "catalog.csv"
    save_catalog(objects, parquet_path, csv_path)
    print(f"Wrote {len(objects)} objects to {parquet_path} and {csv_path}")


if __name__ == "__main__":
    main()
