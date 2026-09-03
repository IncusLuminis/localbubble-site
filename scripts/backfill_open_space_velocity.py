"""One-time (but repeatable) bulk fetch: populate `velocity` for the ~587
star records in `data/normalized/initial_catalog_records.json` that sit
beyond the Local Bubble (Story #307, Epic #306) - the "open space" stars
`web/src/scene/lod.ts`/`objects.ts` already treat as a distinct LOD/scale
zone (Story #300's flat open-space ceiling), but which have never had
velocity acquired at all, unlike the ~127 RECONS-sphere stars (Story #230)
and the full Local Bubble (Story #286/#296).

This is the SAME pipeline those three Stories already built - same
`SimbadResolver`, same `pmra`/`pmdec`/`rvz_radvel` VOTable fields (including
its `_IMPLAUSIBLE_RV_KMS_THRESHOLD`/`mesVelocities` implausible-RV fallback,
e.g. tau Sco's -650 km/s default cross-match), same
`coordinates.galactic_velocity_kms` ICRS -> Galactic transform, same
`schema.Velocity` shape, same "never fabricate" conventions (see that
module's own docstring for the full rationale). This script only widens
*scope* to the complementary side of the boundary `backfill_bubble_velocity.py`
already uses, it does not reimplement any derivation logic.

Data-shape note (Epic #306's own "important" callout, unlike Epic #294's
Local Bubble gap-fill): every one of these ~587 stars is an EXISTING
curated catalog record, not a missing one - this is a velocity BACKFILL
onto records that already have real position/distance/notes/group/aliases,
never a new-record gap-fill. Only the top-level `velocity` field is merged
back into each in-scope record - every other field is left byte-identical,
same non-destructive convention every prior gap-fill/field-addition script
in this repo has established (see `test_backfill_open_space_velocity.py`'s
own byte-identical regression guard for this exact failure mode).

Scope: `object_type == "star"`, REAL `distance.value_pc` STRICTLY GREATER
THAN the Local Bubble's outer radius (mirrors `backfill_bubble_velocity.py`'s
own `bubble_outer_radius_pc` - re-derived live from `models/local_bubble.yaml`
via `local_bubble.load_local_bubble_model`, not hard-coded to 60, even though
it currently evaluates to 60.0pc), AND currently carrying no `velocity` key
at all (or a `null` one) - the complementary half of
`backfill_bubble_velocity.py`'s own `<= radius_pc` membership test, reusing
its exact `bubble_outer_radius_pc` helper so the two scripts can never
disagree about where the boundary sits.

Id -> upstream query recovery reuses
`refresh_star_spectral_and_magnitude.build_id_to_query` unchanged, same as
every prior bulk-refresh script in this repo - every one of the 587 in-scope
stars already has a cache file under `data/raw/simbad/` from its original
catalog resolution (Story #58/#88/#90/#104/#170), so no `--only`/manual list
is needed to find them.

Honest-failure handling (Story #307 acceptance criteria): a star that
resolves against SIMBAD but has no `pmra`/`pmdec` on file at all gets
`velocity` left absent/`null` - exactly `_derive_velocity`'s own established
"whole vector unresolvable" case - and is recorded, with a clear explanation,
in `--unresolved-output` (default
`data/raw/simbad/backfill_open_space_velocity_unresolved.json`). This is
kept as a SEPARATE checked-in artifact rather than written into the star's
own `notes` field, because this Story's own acceptance criteria explicitly
forbid touching `notes` (or position/distance/group/aliases) on these
existing records - the failures/unresolved-output file (the same pattern
`--failures-output` already established for query-level exceptions) *is*
the "clear note", auditable without mutating curated catalog text. A star
whose `pmra`/`pmdec` resolve but `rvz_radvel` does not still gets a real,
tangential-only `velocity` block (`radial_velocity_known=False`) - the
established resolver behavior, not a failure at all - counted separately
below.

Network reality: 587 individual live SIMBAD queries. `--sleep` (default 0.3s)
adds a small, polite delay between requests on top of `--retries`/`--backoff`
exponential-backoff retry of transient failures - real wall-clock time is
expected; one star's failure does not abort the batch.

Usage:

    python scripts/backfill_open_space_velocity.py
    python scripts/backfill_open_space_velocity.py --dry-run
    python scripts/backfill_open_space_velocity.py --only alf_ori alf_cru
"""

from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from local_galactic_structures.data_sources.simbad import SimbadResolver  # noqa: E402

# Reuse the exact same id -> cached-query recovery Story #170's script
# established, and the exact same Local-Bubble-outer-radius derivation
# Story #286's script established, rather than duplicating either.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from backfill_bubble_velocity import bubble_outer_radius_pc  # noqa: E402
from refresh_star_spectral_and_magnitude import build_id_to_query  # noqa: E402

RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"
CACHE_DIR = REPO_ROOT / "data" / "raw" / "simbad"
DEFAULT_LOCAL_BUBBLE_PATH = REPO_ROOT / "models" / "local_bubble.yaml"
DEFAULT_FAILURES_OUTPUT = CACHE_DIR / "backfill_open_space_velocity_failures.json"
DEFAULT_UNRESOLVED_OUTPUT = CACHE_DIR / "backfill_open_space_velocity_unresolved.json"

#: Same implausibility threshold `data_sources/simbad.py`'s own
#: `_IMPLAUSIBLE_RV_KMS_THRESHOLD` uses internally for the `rvz_radvel`
#: cross-check - re-applied here as an independent, batch-level scan over
#: each derived star's *total* space velocity (same convention Story #296's
#: `derive_bubble_gap_fill_velocity.py` established), since a bad value
#: could in principle still surface as an implausible total speed even if no
#: single `rvz_radvel` measurement individually tripped the adapter's own
#: internal guard.
IMPLAUSIBLE_SPEED_KMS_THRESHOLD = 500.0


def open_space_velocity_missing_star_records(
    records: list[dict], *, radius_pc: float
) -> list[dict]:
    """Every `object_type: "star"` record STRICTLY BEYOND the full Local
    Bubble by REAL `distance.value_pc` that does not yet carry a `velocity`
    block (null or absent) - the complementary half of
    `backfill_bubble_velocity.in_bubble_velocity_missing_star_records`'s own
    `<= radius_pc` test."""
    return [
        r
        for r in records
        if r.get("object_type") == "star"
        and r["distance"]["value_pc"] > radius_pc
        and not r.get("velocity")
    ]


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
    parser.add_argument("--local-bubble", default=str(DEFAULT_LOCAL_BUBBLE_PATH))
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--backoff", type=float, default=2.0)
    parser.add_argument(
        "--sleep",
        type=float,
        default=0.3,
        help="Polite delay (seconds) between successive live SIMBAD queries.",
    )
    parser.add_argument(
        "--only",
        nargs="*",
        default=None,
        help="Restrict the backfill to these catalog ids (for testing/re-runs).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be backfilled without querying SIMBAD or writing anything.",
    )
    parser.add_argument("--failures-output", default=str(DEFAULT_FAILURES_OUTPUT))
    parser.add_argument("--unresolved-output", default=str(DEFAULT_UNRESOLVED_OUTPUT))
    args = parser.parse_args(argv)

    records_path = Path(args.records)
    cache_dir = Path(args.cache_dir)

    radius_pc = bubble_outer_radius_pc(Path(args.local_bubble))

    records = json.loads(records_path.read_text())
    in_scope = open_space_velocity_missing_star_records(records, radius_pc=radius_pc)
    print(
        f"{len(records)} total records; Local Bubble outer radius (from "
        f"{args.local_bubble}) = {radius_pc!r} pc; {len(in_scope)} "
        "open-space (beyond the bubble) velocity-missing star record(s) in scope."
    )

    id_to_query = build_id_to_query(cache_dir)
    targets = [r for r in in_scope if r["id"] in id_to_query]
    if args.only:
        wanted = set(args.only)
        targets = [r for r in targets if r["id"] in wanted]
    unmatched = [r["id"] for r in in_scope if r["id"] not in id_to_query]
    if unmatched:
        print(
            f"WARNING: {len(unmatched)} in-scope star record(s) have no "
            f"matching cache file, skipped: {unmatched}",
            file=sys.stderr,
        )

    print(f"Backfilling {len(targets)} star record(s) against live SIMBAD...")
    if args.dry_run:
        for r in targets:
            print(f"  would backfill {r['id']!r} via query {id_to_query[r['id']]!r}")
        return 0

    resolver = SimbadResolver(cache_dir=cache_dir)

    resolved = 0
    full_3d = 0
    tangential_only = 0
    unresolvable = 0
    failures: list[dict] = []
    unresolved: list[dict] = []
    implausible: list[dict] = []

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
            if i < len(targets):
                time.sleep(args.sleep)
            continue

        resolved += 1
        velocity = obj.velocity
        if velocity is None:
            by_id[record_id].pop("velocity", None)
            unresolvable += 1
            reason = (
                "SIMBAD resolved this star but has no pmra/pmdec (proper "
                "motion) on file at all - the whole velocity vector is "
                "unresolvable per data_sources/simbad.py's own "
                "_derive_velocity 'never fabricate' convention; no "
                "velocity block was added."
            )
            unresolved.append({"id": record_id, "query": query, "reason": reason})
            print(f"[{i}/{len(targets)}] OK {record_id!r}: velocity=None (no pmra/pmdec on file)")
        else:
            by_id[record_id]["velocity"] = velocity.model_dump(mode="json")
            if velocity.radial_velocity_known:
                full_3d += 1
            else:
                tangential_only += 1
            speed = (velocity.vx_kms**2 + velocity.vy_kms**2 + velocity.vz_kms**2) ** 0.5
            if speed > IMPLAUSIBLE_SPEED_KMS_THRESHOLD:
                implausible.append({"id": record_id, "query": query, "speed_kms": speed})
            print(
                f"[{i}/{len(targets)}] OK {record_id!r}: "
                f"vx={velocity.vx_kms:.3f} vy={velocity.vy_kms:.3f} "
                f"vz={velocity.vz_kms:.3f} km/s (|v|={speed:.3f} km/s) "
                f"radial_velocity_known={velocity.radial_velocity_known}"
            )

        if i < len(targets):
            time.sleep(args.sleep)

    records_path.write_text(json.dumps(records, indent=2) + "\n")

    failures_output = Path(args.failures_output)
    failures_output.parent.mkdir(parents=True, exist_ok=True)
    failures_output.write_text(json.dumps(failures, indent=2) + "\n")

    unresolved_output = Path(args.unresolved_output)
    unresolved_output.parent.mkdir(parents=True, exist_ok=True)
    unresolved_output.write_text(json.dumps(unresolved, indent=2) + "\n")

    print()
    print(f"Resolved: {resolved}/{len(targets)}")
    print(f"  full 3D vector (radial_velocity_known=True): {full_3d}")
    print(f"  tangential-only (radial_velocity_known=False): {tangential_only}")
    print(f"  unresolvable (velocity=None, no pmra/pmdec on file): {unresolvable}")
    print(f"Failed (query error): {len(failures)} (see {failures_output})")
    print(f"Unresolved (honest-failure notes): {len(unresolved)} (see {unresolved_output})")
    if implausible:
        print(
            f"IMPLAUSIBLE SPEED (> {IMPLAUSIBLE_SPEED_KMS_THRESHOLD} km/s), "
            f"needs the mesVelocities fallback investigated: {implausible}"
        )
    else:
        print(
            f"Implausible-speed scan (> {IMPLAUSIBLE_SPEED_KMS_THRESHOLD} km/s): "
            "none found."
        )
    return 1 if failures and resolved == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
