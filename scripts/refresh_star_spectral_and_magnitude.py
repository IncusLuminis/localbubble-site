"""One-time (but repeatable) bulk re-fetch: populate `spectral_type` /
`absolute_magnitude` for every existing `object_type: "star"` record in
`data/normalized/initial_catalog_records.json` (Story #170).

Why this exists: `SimbadResolver` now requests the `sp_type`/`V` VOTable
fields (see `data_sources/simbad.py`), but `CachingObjectResolver.resolve()`
reads the on-disk cache under `data/raw/simbad/<slug>.json` and skips the
network entirely unless `force_refresh=True` is passed explicitly. Every one
of the 707 star records already has a cache file from its original
resolution (Story #58/#88/#90/#104), so the new fields have zero effect on
them without a real, explicit re-fetch. `build-catalog` has no bulk
`--force-refresh` flag (only `acquire` does, one object at a time) - this
script is the "real, run-once, repeatable step" the issue calls for, reusing
the exact same `initial_catalog_records.json` -> id space and the exact same
`SimbadResolver` the rest of the pipeline already uses.

How the id -> upstream query is recovered: `AstronomicalObject.id` is always
`slugify(record_id)` where `record_id` is the SIMBAD `main_id` (see
`SimbadResolver._extract_record_id`/`_normalize`), and the on-disk cache
filename is `slugify(query).json` (the *query string originally passed to
`resolve()`*, not the main_id - these differ whenever the query used a
different form than SIMBAD's own canonical name, e.g. "10 CMa" -> main_id
"*  10 CMa"). So for every cache file under `data/raw/simbad/`, recomputing
`slugify(raw["main_id"] or query)` reproduces the catalog `id` that cache
file's resolution produced, letting this script build an id -> query
lookup and thereby find the right upstream query string for every existing
catalog record, without guessing or re-deriving it from the record's `name`/
`aliases` (which would not always round-trip to a query SIMBAD accepts -
see README's "Individual stars (v1.2)" Bayer-designation gotchas).

Only `visual.spectral_type` and `visual.absolute_magnitude` are merged back
into each matching record - every other field (position, distance, aliases,
group tags, notes, dual-provenance text) is left exactly as it was, since
those were curated/derived by earlier Stories and are not this Story's
concern; overwriting them wholesale would silently discard that curation
(e.g. `group.secondary: ["recons-nearest-100"]"`, RECONS/Galaxy-Map
provenance notes - `SimbadResolver._normalize` itself never sets any of
that, so a full-object overwrite would erase it).

Network reality: this makes one live SIMBAD query per star (707 total) -
real wall-clock time, and occasional transient failures/rate limiting are
expected. Each star is retried up to `--retries` times with exponential
backoff before being recorded as a failure; one star's failure does not
abort the batch. A summary (resolved / failed / no-usable-field counts) is
printed at the end and failures are written to
`--failures-output` (default `data/raw/simbad/refresh_failures.json`) for
inspection/re-run.

Usage:

    python scripts/refresh_star_spectral_and_magnitude.py
    python scripts/refresh_star_spectral_and_magnitude.py --dry-run
    python scripts/refresh_star_spectral_and_magnitude.py --only 10_cma 102_her
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from local_galactic_structures.data_sources import slugify  # noqa: E402
from local_galactic_structures.data_sources.simbad import SimbadResolver  # noqa: E402

RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"
CACHE_DIR = REPO_ROOT / "data" / "raw" / "simbad"
DEFAULT_FAILURES_OUTPUT = CACHE_DIR / "refresh_failures.json"


def build_id_to_query(cache_dir: Path) -> dict[str, str]:
    """Recover {catalog id -> original SIMBAD query string} from every
    cached response under `cache_dir` (see module docstring).

    `cache_dir` also holds non-cache-record `.json` artifacts written by
    prior scripts (e.g. `backfill_bubble_velocity_failures.json`, Story
    #286's own `--failures-output` default, checked in as an empty `[]`) -
    those are lists, not `{query, raw, ...}` cache-record dicts, and are
    skipped here rather than crashing this glob (discovered by Story #296
    while re-running this exact helper).
    """
    id_to_query: dict[str, str] = {}
    for path in sorted(cache_dir.glob("*.json")):
        data = json.loads(path.read_text())
        if not isinstance(data, dict):
            continue
        raw = data.get("raw", {})
        record_id = raw.get("main_id") or data.get("query")
        expected_id = slugify(str(record_id))
        # First-found wins when multiple queries collapsed onto the same
        # star (e.g. RECONS multi-star systems SIMBAD carries no
        # independent identifier for, README "Dedup within this batch") -
        # they all describe the same underlying SIMBAD object, so any one
        # of their queries re-resolves the same fresh data.
        id_to_query.setdefault(expected_id, data.get("query"))
    return id_to_query


def refresh_one(resolver: SimbadResolver, query: str, *, retries: int, backoff: float):
    """Re-resolve `query` with `force_refresh=True`, retrying transient
    failures with exponential backoff. Raises the last exception if every
    attempt fails."""
    last_exc: Exception | None = None
    for attempt in range(retries + 1):
        try:
            return resolver.resolve(query, force_refresh=True)
        except Exception as exc:  # noqa: BLE001 - reported to caller, not swallowed
            last_exc = exc
            if attempt < retries:
                time.sleep(backoff * (2**attempt))
    assert last_exc is not None
    raise last_exc


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", default=str(RECORDS_PATH))
    parser.add_argument("--cache-dir", default=str(CACHE_DIR))
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--backoff", type=float, default=2.0)
    parser.add_argument(
        "--only",
        nargs="*",
        default=None,
        help="Restrict the refresh to these catalog ids (for testing/re-runs).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be refreshed without querying SIMBAD or writing anything.",
    )
    parser.add_argument("--failures-output", default=str(DEFAULT_FAILURES_OUTPUT))
    args = parser.parse_args(argv)

    records_path = Path(args.records)
    cache_dir = Path(args.cache_dir)

    records = json.loads(records_path.read_text())
    star_records = [r for r in records if r.get("object_type") == "star"]
    print(f"{len(records)} total records, {len(star_records)} are stars.")

    id_to_query = build_id_to_query(cache_dir)
    targets = [r for r in star_records if r["id"] in id_to_query]
    if args.only:
        wanted = set(args.only)
        targets = [r for r in targets if r["id"] in wanted]
    unmatched = [r["id"] for r in star_records if r["id"] not in id_to_query]
    if unmatched:
        print(
            f"WARNING: {len(unmatched)} star record(s) have no matching "
            f"cache file, skipped: {unmatched}",
            file=sys.stderr,
        )

    print(f"Refreshing {len(targets)} star record(s) against live SIMBAD...")
    if args.dry_run:
        for r in targets[:10]:
            print(f"  would refresh {r['id']!r} via query {id_to_query[r['id']]!r}")
        if len(targets) > 10:
            print(f"  ... and {len(targets) - 10} more")
        return 0

    resolver = SimbadResolver(cache_dir=cache_dir)

    resolved = 0
    with_spectral_type = 0
    with_absolute_magnitude = 0
    failures: list[dict] = []

    by_id = {r["id"]: r for r in records}

    for i, record in enumerate(targets, start=1):
        record_id = record["id"]
        query = id_to_query[record_id]
        try:
            obj = refresh_one(
                resolver, query, retries=args.retries, backoff=args.backoff
            )
        except Exception as exc:  # noqa: BLE001 - continue past one bad star
            print(f"[{i}/{len(targets)}] FAILED {record_id!r} ({query!r}): {exc}")
            failures.append({"id": record_id, "query": query, "error": str(exc)})
            continue

        sp_type = obj.visual.spectral_type
        abs_mag = obj.visual.absolute_magnitude
        by_id[record_id]["visual"]["spectral_type"] = sp_type
        by_id[record_id]["visual"]["absolute_magnitude"] = abs_mag
        resolved += 1
        with_spectral_type += sp_type is not None
        with_absolute_magnitude += abs_mag is not None
        print(
            f"[{i}/{len(targets)}] OK {record_id!r}: "
            f"spectral_type={sp_type!r} absolute_magnitude={abs_mag!r}"
        )

    records_path.write_text(json.dumps(records, indent=2) + "\n")

    failures_output = Path(args.failures_output)
    failures_output.parent.mkdir(parents=True, exist_ok=True)
    failures_output.write_text(json.dumps(failures, indent=2) + "\n")

    print()
    print(f"Resolved: {resolved}/{len(targets)}")
    print(f"  with non-null spectral_type: {with_spectral_type}")
    print(f"  with non-null absolute_magnitude: {with_absolute_magnitude}")
    print(f"Failed: {len(failures)} (see {failures_output})")
    return 1 if failures and resolved == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
