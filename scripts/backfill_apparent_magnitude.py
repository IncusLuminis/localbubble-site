"""One-time (but repeatable), cache-only backfill: populate the new
`visual.apparent_magnitude` field for every existing `object_type: "star"`
record in `data/normalized/initial_catalog_records.json` (Story #189).

Unlike `refresh_star_spectral_and_magnitude.py` (Story #170), this script
makes **no live SIMBAD queries**. Story #170's re-fetch already requested
and cached the `V` VOTable field for all 707 star records under
`data/raw/simbad/*.json`; `data_sources.simbad.SimbadResolver._normalize`
now also persists that already-cached value into
`AstronomicalObject.visual.apparent_magnitude` (Story #189). This script
simply re-resolves every star from the on-disk cache
(`resolver.resolve(query, force_refresh=False)` - reads
`data/raw/simbad/<slug>.json`, never touches the network) and merges the
resulting `apparent_magnitude` back into the records file, using the exact
same id -> cached-query recovery mechanism `refresh_star_spectral_and_magnitude.py`
established (see that script's module docstring for the full explanation of
why the cache filename doesn't just match `id` directly).

Only `visual.apparent_magnitude` is merged back into each matching record -
every other field is left exactly as it was (same non-destructive
convention as the Story #170 script).

Usage:

    python scripts/backfill_apparent_magnitude.py
    python scripts/backfill_apparent_magnitude.py --dry-run
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from local_galactic_structures.data_sources.simbad import SimbadResolver  # noqa: E402

# Reuse the exact same id -> cached-query recovery this script's sibling
# established, rather than duplicating it.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from refresh_star_spectral_and_magnitude import build_id_to_query  # noqa: E402

RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"
CACHE_DIR = REPO_ROOT / "data" / "raw" / "simbad"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", default=str(RECORDS_PATH))
    parser.add_argument("--cache-dir", default=str(CACHE_DIR))
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be backfilled without writing anything.",
    )
    args = parser.parse_args(argv)

    records_path = Path(args.records)
    cache_dir = Path(args.cache_dir)

    records = json.loads(records_path.read_text())
    star_records = [r for r in records if r.get("object_type") == "star"]
    print(f"{len(records)} total records, {len(star_records)} are stars.")

    id_to_query = build_id_to_query(cache_dir)
    targets = [r for r in star_records if r["id"] in id_to_query]
    unmatched = [r["id"] for r in star_records if r["id"] not in id_to_query]
    if unmatched:
        print(
            f"WARNING: {len(unmatched)} star record(s) have no matching "
            f"cache file, skipped: {unmatched}",
            file=sys.stderr,
        )

    print(f"Backfilling {len(targets)} star record(s) from the on-disk cache only...")

    resolver = SimbadResolver(cache_dir=cache_dir)

    resolved = 0
    with_apparent_magnitude = 0
    failures: list[dict] = []

    by_id = {r["id"]: r for r in records}

    for i, record in enumerate(targets, start=1):
        record_id = record["id"]
        query = id_to_query[record_id]
        try:
            obj = resolver.resolve(query, force_refresh=False)
        except Exception as exc:  # noqa: BLE001 - continue past one bad star
            print(f"[{i}/{len(targets)}] FAILED {record_id!r} ({query!r}): {exc}")
            failures.append({"id": record_id, "query": query, "error": str(exc)})
            continue

        app_mag = obj.visual.apparent_magnitude
        if args.dry_run:
            print(
                f"[{i}/{len(targets)}] (dry-run) {record_id!r}: "
                f"apparent_magnitude={app_mag!r}"
            )
            continue
        by_id[record_id]["visual"]["apparent_magnitude"] = app_mag
        resolved += 1
        with_apparent_magnitude += app_mag is not None
        print(f"[{i}/{len(targets)}] OK {record_id!r}: apparent_magnitude={app_mag!r}")

    if not args.dry_run:
        records_path.write_text(json.dumps(records, indent=2) + "\n")

    print()
    print(f"Resolved: {resolved}/{len(targets)}")
    print(f"  with non-null apparent_magnitude: {with_apparent_magnitude}")
    print(f"Failed: {len(failures)}")
    return 1 if failures and resolved == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
