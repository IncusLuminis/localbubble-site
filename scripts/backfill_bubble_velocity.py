"""One-time (but repeatable) bulk re-fetch: populate `velocity` for the
named stars within the full Local Bubble (~60pc, `bubbleOuterRadiusPc`)
that are already in the catalog but still lack it (Story #286, Epic #285).

This is the SAME pipeline Story #230's `backfill_velocity.py` already
built for the 127 RECONS-dense-batch-sphere stars - same `SimbadResolver`,
same `pmra`/`pmdec`/`rvz_radvel` VOTable fields, same
`coordinates.galactic_velocity_kms` ICRS -> Galactic transform, same
`schema.Velocity` shape, same "never fabricate" conventions (see that
script's and `data_sources/simbad.py`'s own docstrings for the full
rationale) - this script only widens the *scope* (radius + "already has a
velocity" filter), it does not reimplement any of the derivation logic.

Two differences from `backfill_velocity.py`, both scope-only:

1. Radius: the full Local Bubble outer radius, not the RECONS-dense-batch
   sphere radius. Derived from `models/local_bubble.yaml` via
   `local_bubble.load_local_bubble_model` - the exact same source-of-truth
   file the frontend's `objects.ts`'s `bubbleOuterRadiusPcFrom` reads from
   `scene.json`'s `structures.local_bubble` (itself exported from this same
   YAML by `scene.py`) - as `(semi_axes_pc.a_pc + semi_axes_pc.b_pc) / 2`,
   averaging the bubble's two shorter, roughly-equal axes exactly as the
   frontend does (the elongated `c_pc` axis is deliberately excluded, same
   as `bubbleOuterRadiusPcFrom`'s own docstring explains). NOT hard-coded
   to 60 - it happens to currently evaluate to 60.0pc because that is what
   `models/local_bubble.yaml`'s `semi_axes_pc.a_pc`/`b_pc` currently hold,
   but this script re-derives it from that file every run.
2. Membership: only stars that are (a) `object_type == "star"`, (b) within
   that radius by REAL `distance.value_pc`, AND (c) currently have no
   `velocity` key at all (or a `null` one) are in scope. Story #230's 127
   RECONS-sphere stars already carry a real `velocity` from that Story and
   are deliberately left untouched here - re-fetching them would just
   repeat that Story's own already-completed, already-spot-checked work
   for no benefit. (`backfill_velocity.py` re-fetches unconditionally
   instead, since at the time it ran none of its in-scope stars had a
   `velocity` yet - this script is a later, narrower top-up, not a repeat
   of that unconditional refresh.)

Id -> upstream query recovery reuses
`refresh_star_spectral_and_magnitude.build_id_to_query` unchanged, same as
`backfill_velocity.py` does - see that module's docstring for the full
explanation of why the cache filename does not always match the catalog
`id` directly.

Only the top-level `velocity` field is merged back into each in-scope
record - never any other field - same non-destructive convention every
prior gap-fill/field-addition script in this repo has established. A star
with `pmra`/`pmdec` absent even though it is in-scope is left with no
`velocity` key at all rather than a fabricated one - see
`schema.Velocity`'s own docstring for the two distinct "unresolvable"
cases.

Usage:

    python scripts/backfill_bubble_velocity.py
    python scripts/backfill_bubble_velocity.py --dry-run
    python scripts/backfill_bubble_velocity.py --only alf_aur alf_tau
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
from local_galactic_structures.local_bubble import load_local_bubble_model  # noqa: E402

# Reuse the exact same id -> cached-query recovery Story #170's script
# established, rather than duplicating it.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from refresh_star_spectral_and_magnitude import build_id_to_query  # noqa: E402

RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"
CACHE_DIR = REPO_ROOT / "data" / "raw" / "simbad"
DEFAULT_LOCAL_BUBBLE_PATH = REPO_ROOT / "models" / "local_bubble.yaml"
DEFAULT_FAILURES_OUTPUT = CACHE_DIR / "backfill_bubble_velocity_failures.json"


def bubble_outer_radius_pc(local_bubble_path: Path) -> float:
    """The full Local Bubble's outer radius, pc - mirrors the frontend's
    `web/src/scene/objects.ts`'s `bubbleOuterRadiusPcFrom` exactly:
    `(semi_axes_pc.a_pc + semi_axes_pc.b_pc) / 2`, the mean of the two
    shorter (roughly equal) ellipsoid axes, read live from
    `models/local_bubble.yaml` rather than hard-coded.
    """
    model = load_local_bubble_model(local_bubble_path)
    return (model.semi_axes_pc.a_pc + model.semi_axes_pc.b_pc) / 2.0


def in_bubble_velocity_missing_star_records(
    records: list[dict], *, radius_pc: float
) -> list[dict]:
    """Every `object_type: "star"` record within the full Local Bubble by
    REAL distance that does not yet carry a `velocity` block (null or
    absent). Story #230's 127 RECONS-sphere stars are excluded here purely
    because they already have `velocity`, not by any radius/tag
    distinction - a star that separately gained a `velocity` some other
    way would also be correctly skipped.
    """
    return [
        r
        for r in records
        if r.get("object_type") == "star"
        and r["distance"]["value_pc"] <= radius_pc
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

    radius_pc = bubble_outer_radius_pc(Path(args.local_bubble))

    records = json.loads(records_path.read_text())
    in_scope = in_bubble_velocity_missing_star_records(records, radius_pc=radius_pc)
    print(
        f"{len(records)} total records; Local Bubble outer radius (from "
        f"{args.local_bubble}) = {radius_pc!r} pc; {len(in_scope)} "
        "velocity-missing star record(s) in scope."
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

    print(f"Refreshing {len(targets)} star record(s) against live SIMBAD...")
    if args.dry_run:
        for r in targets:
            print(f"  would refresh {r['id']!r} via query {id_to_query[r['id']]!r}")
        return 0

    resolver = SimbadResolver(cache_dir=cache_dir)

    resolved = 0
    full_3d = 0
    tangential_only = 0
    unresolvable = 0
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

        resolved += 1
        velocity = obj.velocity
        if velocity is None:
            by_id[record_id].pop("velocity", None)
            unresolvable += 1
            print(f"[{i}/{len(targets)}] OK {record_id!r}: velocity=None (no pmra/pmdec on file)")
        else:
            by_id[record_id]["velocity"] = velocity.model_dump(mode="json")
            if velocity.radial_velocity_known:
                full_3d += 1
            else:
                tangential_only += 1
            print(
                f"[{i}/{len(targets)}] OK {record_id!r}: "
                f"vx={velocity.vx_kms:.3f} vy={velocity.vy_kms:.3f} "
                f"vz={velocity.vz_kms:.3f} km/s "
                f"radial_velocity_known={velocity.radial_velocity_known}"
            )

    records_path.write_text(json.dumps(records, indent=2) + "\n")

    failures_output = Path(args.failures_output)
    failures_output.parent.mkdir(parents=True, exist_ok=True)
    failures_output.write_text(json.dumps(failures, indent=2) + "\n")

    print()
    print(f"Resolved: {resolved}/{len(targets)}")
    print(f"  full 3D vector (radial_velocity_known=True): {full_3d}")
    print(f"  tangential-only (radial_velocity_known=False): {tangential_only}")
    print(f"  unresolvable (velocity=None, no pmra/pmdec on file): {unresolvable}")
    print(f"Failed: {len(failures)} (see {failures_output})")
    return 1 if failures and resolved == 0 else 0


if __name__ == "__main__":
    sys.exit(main())
