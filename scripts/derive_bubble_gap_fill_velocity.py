"""One-time (but repeatable) bulk fetch: derive `velocity` for the 77
newly-acquired Local Bubble stars from Story #295 (Epic #294, Story #296).

Story #295 acquired 77 new named bright stars (V<4.0, 11-60pc, genuinely
`NAME `-prefixed, not previously in the catalog) but deliberately stripped
`velocity` from every one of them - a scope-separation fix from that
Story's own review (see PR #297's history). This script is that deferred
Story 2: derive and populate `velocity` for exactly that same 77-star
batch, reusing the SAME pipeline Story #230's `backfill_velocity.py` and
Story #286's `backfill_bubble_velocity.py` already built - same
`SimbadResolver`, same `pmra`/`pmdec`/`rvz_radvel` VOTable fields, same
`coordinates.galactic_velocity_kms` ICRS -> Galactic transform, same
`schema.Velocity` shape, same "never fabricate" conventions (see that
script's and `data_sources/simbad.py`'s own docstrings for the full
rationale). This script only narrows *scope*, it does not reimplement any
derivation logic.

Scope, one difference from `backfill_bubble_velocity.py`: membership here
is the exact `local-bubble-bright-named-gap-fill` provenance tag Story
#295 wrote to `group.secondary` on every star it acquired - not "within
radius X and missing velocity" (`backfill_bubble_velocity.py`'s own
filter, which would coincidentally also select the same 77 stars right
now since nothing else in the bubble is missing `velocity` at this point
in time, but the tag is the actually-correct, future-proof selector this
Story's own acceptance criteria call for: "re-derive the exact list of
newly-acquired stars from the CURRENT catalog - filter by the
`local-bubble-bright-named-gap-fill` provenance tag ... rather than
assuming '77' without checking"). Using the tag also means this script
would do the right, narrow thing even if some *other* future gap-fill
batch left a bubble star without `velocity` for an unrelated reason - such
a star must not be silently swept into this specific batch's PR.

Id -> upstream query recovery reuses
`refresh_star_spectral_and_magnitude.build_id_to_query` unchanged, same as
`backfill_bubble_velocity.py` does - every one of the 77 already has a
cache file under `data/raw/simbad/` from Story #295's own acquisition
(position/spectral-type/etc. resolution goes through the same
`SimbadResolver`, it just never persisted the `velocity` block onto the
catalog record), so no `--only`/manual list is needed to find them.

Only the top-level `velocity` field is merged back into each in-scope
record - never any other field - same non-destructive convention every
prior gap-fill/field-addition script in this repo has established.

Usage:

    python scripts/derive_bubble_gap_fill_velocity.py
    python scripts/derive_bubble_gap_fill_velocity.py --dry-run
    python scripts/derive_bubble_gap_fill_velocity.py --only eps_uma alf_and
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
DEFAULT_FAILURES_OUTPUT = CACHE_DIR / "derive_bubble_gap_fill_velocity_failures.json"

#: Story #295's exact provenance tag for this batch (`group.secondary`) -
#: the required selector per this Story's own acceptance criteria, not a
#: radius/"missing velocity" heuristic.
GAP_FILL_TAG = "local-bubble-bright-named-gap-fill"

#: Same implausibility threshold `data_sources/simbad.py`'s own
#: `_IMPLAUSIBLE_RV_KMS_THRESHOLD` uses internally for the `rvz_radvel`
#: cross-check - re-applied here as an independent, batch-level scan over
#: each derived star's *total* space velocity (this Story's own
#: acceptance criterion, mirroring #234/#286's precedent), since a bad
#: value could in principle still surface as an implausible total speed
#: even if no single `rvz_radvel` measurement individually tripped the
#: adapter's own internal guard.
IMPLAUSIBLE_SPEED_KMS_THRESHOLD = 500.0


def gap_fill_star_records(records: list[dict], *, tag: str = GAP_FILL_TAG) -> list[dict]:
    """Every record carrying `tag` in `group.secondary` - Story #295's
    exact newly-acquired batch, re-derived from the CURRENT catalog rather
    than trusted as "77" without checking."""
    return [
        r
        for r in records
        if tag in (r.get("group", {}) or {}).get("secondary") or []
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
    parser.add_argument("--retries", type=int, default=3)
    parser.add_argument("--backoff", type=float, default=2.0)
    parser.add_argument(
        "--only",
        nargs="*",
        default=None,
        help="Restrict the derivation to these catalog ids (for testing/re-runs).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be derived without querying SIMBAD or writing anything.",
    )
    parser.add_argument("--failures-output", default=str(DEFAULT_FAILURES_OUTPUT))
    args = parser.parse_args(argv)

    records_path = Path(args.records)
    cache_dir = Path(args.cache_dir)

    records = json.loads(records_path.read_text())
    in_scope = gap_fill_star_records(records)
    print(
        f"{len(records)} total records; {len(in_scope)} record(s) tagged "
        f"{GAP_FILL_TAG!r} (Story #295's newly-acquired batch) in scope."
    )

    already_has_velocity = [r["id"] for r in in_scope if r.get("velocity")]
    if already_has_velocity:
        print(
            f"NOTE: {len(already_has_velocity)} in-scope record(s) already "
            f"carry a velocity, will be re-derived anyway: {already_has_velocity}"
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

    print(f"Deriving velocity for {len(targets)} star record(s) against live SIMBAD...")
    if args.dry_run:
        for r in targets:
            print(f"  would derive {r['id']!r} via query {id_to_query[r['id']]!r}")
        return 0

    resolver = SimbadResolver(cache_dir=cache_dir)

    resolved = 0
    full_3d = 0
    tangential_only = 0
    unresolvable = 0
    failures: list[dict] = []
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
            speed = (velocity.vx_kms**2 + velocity.vy_kms**2 + velocity.vz_kms**2) ** 0.5
            if speed > IMPLAUSIBLE_SPEED_KMS_THRESHOLD:
                implausible.append({"id": record_id, "query": query, "speed_kms": speed})
            print(
                f"[{i}/{len(targets)}] OK {record_id!r}: "
                f"vx={velocity.vx_kms:.3f} vy={velocity.vy_kms:.3f} "
                f"vz={velocity.vz_kms:.3f} km/s (|v|={speed:.3f} km/s) "
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
