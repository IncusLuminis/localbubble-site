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

The actual loading/saving logic lives in
`local_galactic_structures.initial_catalog` (spec §34: CLI, notebooks, and
tests should call the same underlying library code) - this script, and the
CLI's `galactic-structures build-catalog` subcommand (Story #63), both call
it rather than duplicating it.

Usage:
    python scripts/build_initial_catalog.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from local_galactic_structures.initial_catalog import (  # noqa: E402
    DEFAULT_CSV_PATH,
    DEFAULT_PARQUET_PATH,
    build_initial_catalog,
)


def main() -> None:
    objects = build_initial_catalog()
    print(f"Wrote {len(objects)} objects to {DEFAULT_PARQUET_PATH} and {DEFAULT_CSV_PATH}")


if __name__ == "__main__":
    main()
