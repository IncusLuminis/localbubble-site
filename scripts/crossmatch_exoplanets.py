"""One-time (but repeatable) bulk cross-match: populate `exoplanets` for
every existing `object_type: "star"` record in
`data/normalized/initial_catalog_records.json` (Story #171).

Unlike Story #170's `refresh_star_spectral_and_magnitude.py` (which makes
707 individual, live SIMBAD queries with `force_refresh=True`), this script
makes exactly ONE live network call - a bulk `pscomppars` pull via
`data_sources.nasa_exoplanet_archive.load_or_fetch_pscomppars_rows` - caches
it as a single JSON snapshot, and then cross-matches every star record's
existing `aliases` against that snapshot entirely in local Python (spec
Story #171 AC1: "no additional network round-trips per star").

Only the top-level `exoplanets` field is merged back into each matching
record - every other field (position, distance, aliases, group tags,
visual.*, notes) is left exactly as it was, same convention Story #170's
script established.

Usage:

    python scripts/crossmatch_exoplanets.py
    python scripts/crossmatch_exoplanets.py --dry-run
    python scripts/crossmatch_exoplanets.py --force-refresh
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from local_galactic_structures.data_sources.nasa_exoplanet_archive import (  # noqa: E402
    DEFAULT_CACHE_PATH,
    ExoplanetCrossMatcher,
    load_or_fetch_pscomppars_rows,
)

RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", default=str(RECORDS_PATH))
    parser.add_argument("--cache-path", default=str(DEFAULT_CACHE_PATH))
    parser.add_argument(
        "--force-refresh",
        action="store_true",
        help="Re-fetch the bulk pscomppars snapshot even if a cache already exists.",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be matched without writing anything back.",
    )
    args = parser.parse_args(argv)

    records_path = Path(args.records)
    records = json.loads(records_path.read_text())
    star_records = [r for r in records if r.get("object_type") == "star"]
    print(f"{len(records)} total records, {len(star_records)} are stars.")

    print("Fetching (or reusing cached) NASA Exoplanet Archive pscomppars bulk snapshot...")
    rows = load_or_fetch_pscomppars_rows(
        cache_path=Path(args.cache_path), force_refresh=args.force_refresh
    )
    print(f"pscomppars snapshot: {len(rows)} planet rows.")

    matcher = ExoplanetCrossMatcher(rows)

    matched: list[tuple[str, int]] = []
    for record in star_records:
        summary = matcher.match(record.get("aliases") or [])
        if summary is None:
            if not args.dry_run:
                record.pop("exoplanets", None)
            continue
        matched.append((record["id"], summary.count))
        if not args.dry_run:
            record["exoplanets"] = summary.model_dump(mode="json")

    print()
    print(f"Matched {len(matched)}/{len(star_records)} star records to confirmed exoplanets:")
    for record_id, count in matched:
        print(f"  {record_id}: {count} planet(s)")

    if args.dry_run:
        print("\n(dry run - nothing written)")
        return 0

    records_path.write_text(json.dumps(records, indent=2) + "\n")
    print(f"\nWrote {records_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
