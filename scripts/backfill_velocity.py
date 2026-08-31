"""One-time (but repeatable) bulk re-fetch: populate `velocity` for the
~127 star records within the RECONS-dense-batch sphere in
`data/normalized/initial_catalog_records.json` (Story #230).

Scope (Epic #229 / Story #230 acceptance criteria): velocity is fetched
for the stars within the current dense-batch sphere by REAL `distance_pc`,
not by the `recons-nearest-100` group tag alone - 122 records carry that
tag, but 5 further gap-fill stars (Fomalhaut, Arcturus, Vega, Pollux,
Denebola - added in #207-#213) are genuinely within the same real-distance
radius while deliberately left untagged (#211's provenance rule), so the
tag alone would miss them. The sphere radius itself is derived from the
data, not hard-coded: the maximum `distance.value_pc` among the currently
tagged `recons-nearest-100` records - the exact same derivation the
frontend's `lod.ts`'s `denseBatchCollectionRadiusPc` uses from the scene
side, kept in sync here on the Python side.

Why a live re-fetch is needed at all (same situation Story #170's
`refresh_star_spectral_and_magnitude.py` was in): `SimbadResolver` now
requests the `pmra`/`pmdec`/`rvz_radvel` VOTable fields (see
`data_sources/simbad.py`), but `CachingObjectResolver.resolve()` reads the
on-disk cache under `data/raw/simbad/<slug>.json` and skips the network
entirely unless `force_refresh=True` is passed explicitly - every in-sphere
star's cache file predates these fields, so they have zero effect without
an explicit re-fetch.

Id -> upstream query recovery reuses
`refresh_star_spectral_and_magnitude.build_id_to_query` unchanged (see that
module's docstring for the full explanation of why the cache filename does
not always match the catalog `id` directly).

Only the top-level `velocity` field is merged back into each in-scope
record - never any other field - same non-destructive convention every
prior gap-fill/field-addition script in this repo has established. A
record outside the sphere, or with `pmra`/`pmdec` absent even though it is
in-scope, is left with no `velocity` key at all (or has an existing one
removed) rather than a fabricated one - see `schema.Velocity`'s own
docstring for the two distinct "unresolvable" cases.

Usage:

    python scripts/backfill_velocity.py
    python scripts/backfill_velocity.py --dry-run
    python scripts/backfill_velocity.py --only proxima_centauri
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
# established, rather than duplicating it.
sys.path.insert(0, str(Path(__file__).resolve().parent))
from refresh_star_spectral_and_magnitude import build_id_to_query  # noqa: E402

RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"
CACHE_DIR = REPO_ROOT / "data" / "raw" / "simbad"
DEFAULT_FAILURES_OUTPUT = CACHE_DIR / "backfill_velocity_failures.json"

#: The frontend's own dense-batch provenance tag (`lod.ts`'s
#: `DENSE_BATCH_GROUP_TAG`) - used here only to derive the real-distance
#: sphere radius (see module docstring), never as the membership test
#: itself.
DENSE_BATCH_GROUP_TAG = "recons-nearest-100"


def dense_batch_sphere_radius_pc(records: list[dict]) -> float:
    """The RECONS-dense-batch sphere's real radius, pc: the farthest
    `distance.value_pc` among records tagged `DENSE_BATCH_GROUP_TAG` -
    mirrors `web/src/scene/lod.ts`'s `denseBatchCollectionRadiusPc` exactly
    (max real distance among tagged members), so the Python-side pipeline
    and the frontend's own LOD gating agree on where the sphere ends.
    """
    tagged_distances = [
        r["distance"]["value_pc"]
        for r in records
        if DENSE_BATCH_GROUP_TAG in (r.get("group", {}).get("secondary") or [])
    ]
    if not tagged_distances:
        raise ValueError(
            f"No records tagged {DENSE_BATCH_GROUP_TAG!r} found - cannot "
            "derive the dense-batch sphere radius."
        )
    return max(tagged_distances)


def in_sphere_star_records(records: list[dict]) -> tuple[list[dict], float]:
    """Every `object_type: "star"` record within the dense-batch sphere by
    REAL distance (not the group tag - see module docstring). Returns
    (in-scope records, the sphere radius used).
    """
    radius_pc = dense_batch_sphere_radius_pc(records)
    in_scope = [
        r
        for r in records
        if r.get("object_type") == "star" and r["distance"]["value_pc"] <= radius_pc
    ]
    return in_scope, radius_pc


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
    in_scope, radius_pc = in_sphere_star_records(records)
    print(
        f"{len(records)} total records; dense-batch sphere radius (real "
        f"distance) = {radius_pc!r} pc; {len(in_scope)} star record(s) "
        "in scope."
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
