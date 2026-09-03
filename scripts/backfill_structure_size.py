"""One-time (but repeatable) bulk backfill: populate `visual.size_pc` for
the ~254 EXISTING `star_cluster`/`stellar_association`/`molecular_cloud`/
`hii_region`/`planetary_nebula`/`supernova_remnant` records in
`data/normalized/initial_catalog_records.json` that currently carry none
(Story #314, Epic #313 - "give star clusters and diffuse structures real
visual size").

Convention (Story #314's own acceptance criterion): determined by reading
`markerRadiusPc` in `web/src/scene/objects.ts` (the formula itself is
convention-agnostic - it just divides `size_pc` by a shared constant and
clamps per type-tier) together with the `notes` already on this catalog's
4 pre-existing populated `size_pc` records, which ARE explicit about which
convention each one used:

* `star_cluster`/`stellar_association` -> **RADIUS**. The one already-
  populated cluster record (`pleiades-open-cluster`, `size_pc: 11.6`)
  states in its own notes: "visual.size_pc is the tidal radius (11.6 pc)
  reported in the same paper, **not a diameter**."
* `molecular_cloud`/`hii_region`/`planetary_nebula`/`supernova_remnant`
  -> **DIAMETER**. The two pre-existing populated diffuse-structure
  records state: `vela-supernova-remnant` (`size_pc: 40.0`) "is an
  approximate physical **diameter** derived from the remnant's commonly
  quoted ~8 deg angular diameter"; `cepheus-flare` (`size_pc: 90.0`, out
  of this Story's scope - already populated) "spans ~90x60 pc in the
  plane of the sky ... visual.size_pc uses the larger axis" - a full span,
  not a half-span/radius.

This Story therefore backfills each record-type family in the convention
its own existing precedent already established, rather than picking one
convention for the whole catalog - introducing a single unified convention
now would have required silently reinterpreting (and probably breaking)
the 4 already-populated records' existing meaning, which is explicitly out
of scope (this is a backfill onto records that DON'T yet have `size_pc`,
never a correction of ones that already do).

Source cascade, `star_cluster`/`stellar_association` (see
`data_sources.cluster_radius` module docstring for the full paper-lineage
rationale - short version: this catalog's cluster/association records
already trace to the Cantat-Gaudin/Tarricq Gaia-membership open-cluster
lineage via their own `source.reference` `coo_bibcode`s):

  1. Tarricq et al. 2022 tidal radius (`Rt`, pc) - the closest available
     match to the Pleiades precedent's own "tidal radius" convention.
  2. Tarricq et al. 2022 core radius (`Rc`, pc) - same paper/table, used
     only when that row's own `Rt` is unavailable; still a genuine
     structural radius, just a smaller definition.
  3. Cantat-Gaudin et al. 2020 `r50` (half-member radius), converted from
     degrees to pc via the record's own already-populated `distance_pc`.
  4. SIMBAD `galdim_majaxis` (arcmin) -> physical diameter via the
     record's own `distance_pc`, HALVED to a radius (the diffuse-structure
     side of this Story uses the same SIMBAD field as a diameter directly;
     here it is halved to keep the cluster family's own RADIUS convention
     - see `data_sources.simbad_size`). Reserved for the handful of large
     OB associations/loose groups (Sco-Cen, the Cepheus/Orion/Perseus/Vela
     OB associations, the Kounkel & Covey 2019 "Theia" groups) that are
     not compact enough to appear in a Gaia-membership open-cluster
     catalog at all.
  5. Honest failure: no `size_pc` change, recorded in `--results-output`
     with a clear reason.

Source, diffuse structures (`molecular_cloud`/`hii_region`/
`planetary_nebula`/`supernova_remnant`):

  1. SIMBAD `galdim_majaxis` (arcmin) -> physical diameter via the
     record's own `distance_pc` (`data_sources.simbad_size`), queried
     first under the record's own catalog `name`, then (for the handful
     of records whose primary name resolves on SIMBAD but carries no
     `galdim_majaxis` under that specific identifier) a short, hand-
     curated list of alternate identifiers established by live testing
     every candidate during this Story's development - see
     `DIFFUSE_STRUCTURE_QUERY_ALIASES` below - never guessed.
  2. Honest failure (in practice: only `m8_lagoon`/M8 the Lagoon Nebula -
     every alias tried, live, during development - `NGC 6523`, `Lagoon
     Nebula`, `Sh 2-25`, `NAME Lagoon Nebula`, `GRS G006.00 -01.20`,
     `LBN 25` - resolves on SIMBAD but none carries a `galdim_majaxis`).

Data-shape note (mirrors Story #307's own `backfill_open_space_velocity.py`
docstring): every one of these ~254 records is an EXISTING curated catalog
record - this is a `size_pc` BACKFILL onto already-curated records, never a
new-record gap-fill. Only `visual.size_pc` is merged back into each
in-scope record; every other field, INCLUDING `notes`, is left byte-
identical - this Story's acceptance criteria explicitly forbid touching
notes/position/distance/group/aliases on these records. Source/method-per-
record documentation therefore cannot live in `notes` either; it instead
goes into a separate checked-in artifact (`--results-output`, default
`data/raw/cluster_radius/backfill_structure_size_results.json`), mirroring
Story #307's own `--unresolved-output`/`--failures-output` convention for
exactly this "cannot touch notes, but still need auditable provenance"
tension.

Usage:

    python scripts/backfill_structure_size.py
    python scripts/backfill_structure_size.py --dry-run
    python scripts/backfill_structure_size.py --only m42_orion pleiades-open-cluster
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

REPO_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(REPO_ROOT / "src"))

from local_galactic_structures.data_sources import cluster_radius  # noqa: E402
from local_galactic_structures.data_sources import simbad_size  # noqa: E402

RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"
DEFAULT_RESULTS_OUTPUT = (
    REPO_ROOT / "data" / "raw" / "cluster_radius" / "backfill_structure_size_results.json"
)

CLUSTER_TYPES = {"star_cluster", "stellar_association"}
DIFFUSE_TYPES = {"molecular_cloud", "hii_region", "planetary_nebula", "supernova_remnant"}
TARGET_TYPES = CLUSTER_TYPES | DIFFUSE_TYPES

#: Established by live SIMBAD testing during this Story's development
#: (module docstring, diffuse-structure source step 1): these records' own
#: catalog `name` resolves on SIMBAD but carries no `galdim_majaxis` under
#: that exact identifier, while the alias below does. `orion-molecular-
#: cloud-complex` in particular has no single SIMBAD entry combining Orion
#: A and B; "Orion A" (420 arcmin major axis) is used as the larger of the
#: complex's two named halves (Orion B is 360 arcmin) - the same "larger
#: axis represents the complex" convention this catalog's own pre-existing
#: `cepheus-flare` record already established for a multi-component cloud.
DIFFUSE_STRUCTURE_QUERY_ALIASES: dict[str, str] = {
    "chamaeleon-molecular-cloud": "Cha cloud",
    "lupus-molecular-cloud": "Lupus cloud",
    "ophiuchus-rho-ophiuchi-molecular-cloud": "Rho Ophiuchi cloud",
    "orion-molecular-cloud-complex": "Orion A",
}


def _load_records(path: Path) -> list[dict]:
    return json.loads(path.read_text())


def missing_target_records(records: list[dict]) -> list[dict]:
    """Every `object_type` in `TARGET_TYPES` currently carrying no
    `visual.size_pc` (null or absent)."""
    return [
        r
        for r in records
        if r.get("object_type") in TARGET_TYPES and not (r.get("visual") or {}).get("size_pc")
    ]


def _backfill_cluster(
    record: dict,
    *,
    tarricq_rows: list[dict],
    tarricq_by_simbad: dict[str, int],
    tarricq_by_cluster: dict[str, int],
    cg_rows: list[dict],
    cg_by_simbad: dict[str, int],
    cg_by_cluster: dict[str, int],
) -> dict[str, Any]:
    name = record["name"]
    distance_pc = record["distance"]["value_pc"]

    row = cluster_radius.find_row(name, tarricq_rows, tarricq_by_simbad, tarricq_by_cluster)
    if row is not None:
        rt = row.get("Rt")
        if rt is not None:
            return {
                "size_pc": float(rt),
                "method": "tarricq2022_Rt",
                "detail": (
                    f"Tarricq et al. 2022 (VizieR J/A+A/659/A59) tidal radius "
                    f"Rt={rt} pc, matched cluster {row.get('Cluster')!r} "
                    f"(SimbadName {row.get('SimbadName')!r})."
                ),
            }
        rc = row.get("Rc")
        if rc is not None:
            return {
                "size_pc": float(rc),
                "method": "tarricq2022_Rc",
                "detail": (
                    f"Tarricq et al. 2022 (VizieR J/A+A/659/A59) core radius "
                    f"Rc={rc} pc (Rt unavailable for this cluster), matched "
                    f"cluster {row.get('Cluster')!r} (SimbadName "
                    f"{row.get('SimbadName')!r})."
                ),
            }

    row = cluster_radius.find_row(name, cg_rows, cg_by_simbad, cg_by_cluster)
    if row is not None:
        r50 = cluster_radius.r50_pc(row, distance_pc)
        if r50 is not None:
            return {
                "size_pc": r50,
                "method": "cantat_gaudin_2020_r50",
                "detail": (
                    f"Cantat-Gaudin et al. 2020 (VizieR J/A+A/633/A99) "
                    f"r50={row.get('r50')} deg -> {r50:.4f} pc via this "
                    f"record's own distance_pc={distance_pc}, matched cluster "
                    f"{row.get('Cluster')!r} (SimbadName {row.get('SimbadName')!r})."
                ),
            }

    diam = simbad_size.resolve_angular_diameter(name)
    if diam is not None:
        diameter_pc = simbad_size.diameter_pc_from_angular_size(
            diam["majaxis_arcmin"], distance_pc
        )
        radius_pc = diameter_pc / 2.0
        return {
            "size_pc": radius_pc,
            "method": "simbad_galdim_halved",
            "detail": (
                f"No Tarricq et al. 2022/Cantat-Gaudin et al. 2020 row matched "
                f"this cluster/association's name; fell back to SIMBAD "
                f"galdim_majaxis={diam['majaxis_arcmin']} arcmin (identifier "
                f"{diam['main_id']!r}, bibcode {diam['bibcode']}) -> diameter "
                f"{diameter_pc:.4f} pc via distance_pc={distance_pc}, halved to "
                f"radius {radius_pc:.4f} pc to match this record type's "
                "RADIUS convention."
            ),
        }

    return {
        "size_pc": None,
        "method": None,
        "detail": (
            "No Tarricq et al. 2022 or Cantat-Gaudin et al. 2020 row matched "
            "this cluster/association's name, and SIMBAD has no "
            "galdim_majaxis on file for it either - no resolvable size; "
            "never fabricated."
        ),
    }


def _backfill_diffuse(record: dict) -> dict[str, Any]:
    record_id = record["id"]
    name = record["name"]
    distance_pc = record["distance"]["value_pc"]

    query_names = [name]
    alias = DIFFUSE_STRUCTURE_QUERY_ALIASES.get(record_id)
    if alias:
        query_names.append(alias)

    for query in query_names:
        diam = simbad_size.resolve_angular_diameter(query)
        if diam is not None:
            diameter_pc = simbad_size.diameter_pc_from_angular_size(
                diam["majaxis_arcmin"], distance_pc
            )
            return {
                "size_pc": diameter_pc,
                "method": "simbad_galdim_diameter",
                "detail": (
                    f"SIMBAD galdim_majaxis={diam['majaxis_arcmin']} arcmin "
                    f"(queried as {query!r} -> resolved identifier "
                    f"{diam['main_id']!r}, bibcode {diam['bibcode']}) -> "
                    f"diameter {diameter_pc:.4f} pc via this record's own "
                    f"distance_pc={distance_pc}."
                ),
            }

    return {
        "size_pc": None,
        "method": None,
        "detail": (
            f"SIMBAD has no galdim_majaxis on file for {name!r} or any tried "
            f"alias ({query_names}) - no resolvable size; never fabricated."
        ),
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--records", default=str(RECORDS_PATH))
    parser.add_argument("--results-output", default=str(DEFAULT_RESULTS_OUTPUT))
    parser.add_argument(
        "--only",
        nargs="*",
        default=None,
        help="Restrict the backfill to these catalog ids (for testing/re-runs).",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Print what would be backfilled without querying anything or writing.",
    )
    parser.add_argument(
        "--force-refresh-tables",
        action="store_true",
        help=(
            "Re-fetch the whole-table Tarricq2022/Cantat-Gaudin2020 VizieR "
            "caches instead of reusing what's already on disk."
        ),
    )
    args = parser.parse_args(argv)

    records_path = Path(args.records)
    records = _load_records(records_path)
    targets = missing_target_records(records)
    if args.only:
        wanted = set(args.only)
        targets = [r for r in targets if r["id"] in wanted]
        # `--only` is documented above ("Restrict the backfill to these
        # catalog ids (for testing/re-runs)") as a way to re-run the
        # backfill for specific ids - but until now it only ever narrowed
        # *within* `missing_target_records(records)`, so an id that had
        # already been successfully backfilled (size_pc populated, e.g. by
        # an earlier invocation of this same script) silently produced ZERO
        # targets and therefore zero results-output entries for that id -
        # even though the caller explicitly asked for it by name. This is
        # what let `cl_alessi_1`/`m42_orion` end up with a correct
        # `size_pc` (written by an earlier run) but no provenance entry at
        # all (dropped by a later `--only` run that intended to
        # re-verify/regenerate their entry but instead found `targets`
        # empty for them). Explicitly-requested ids therefore bypass the
        # "still missing size_pc" filter entirely: found by id among ALL
        # `TARGET_TYPES` records, not just the currently-unresolved ones.
        already_targeted = {r["id"] for r in targets}
        extra_ids = wanted - already_targeted
        if extra_ids:
            by_id_all = {r["id"]: r for r in records}
            for record_id in sorted(extra_ids):
                record = by_id_all.get(record_id)
                if record is not None and record.get("object_type") in TARGET_TYPES:
                    targets.append(record)

    print(
        f"{len(records)} total records; {len(targets)} target record(s) in "
        "scope (size_pc-missing, plus any explicitly re-targeted via "
        "--only regardless of size_pc state)."
    )

    if args.dry_run:
        for r in targets:
            print(f"  would backfill {r['id']!r} ({r['object_type']})")
        return 0

    print(
        "Loading Tarricq et al. 2022 / Cantat-Gaudin et al. 2020 reference "
        "tables (cached after first fetch)..."
    )
    tarricq_rows = cluster_radius.load_tarricq_2022(force_refresh=args.force_refresh_tables)
    tarricq_by_simbad, tarricq_by_cluster = cluster_radius.build_name_index(tarricq_rows)
    cg_rows = cluster_radius.load_cantat_gaudin_2020(force_refresh=args.force_refresh_tables)
    cg_by_simbad, cg_by_cluster = cluster_radius.build_name_index(cg_rows)
    print(
        f"  Tarricq et al. 2022: {len(tarricq_rows)} clusters; "
        f"Cantat-Gaudin et al. 2020: {len(cg_rows)} clusters."
    )

    by_id = {r["id"]: r for r in records}
    results: list[dict[str, Any]] = []
    resolved = 0
    method_counts: dict[str, int] = {}

    for i, record in enumerate(targets, start=1):
        record_id = record["id"]
        if record["object_type"] in CLUSTER_TYPES:
            outcome = _backfill_cluster(
                record,
                tarricq_rows=tarricq_rows,
                tarricq_by_simbad=tarricq_by_simbad,
                tarricq_by_cluster=tarricq_by_cluster,
                cg_rows=cg_rows,
                cg_by_simbad=cg_by_simbad,
                cg_by_cluster=cg_by_cluster,
            )
        else:
            outcome = _backfill_diffuse(record)

        results.append(
            {
                "id": record_id,
                "object_type": record["object_type"],
                "name": record["name"],
                **outcome,
            }
        )

        if outcome["size_pc"] is not None:
            visual = by_id[record_id].setdefault("visual", {})
            # Never overwrite an already-populated size_pc (possible when
            # `--only` explicitly re-targets an id that a previous run
            # already resolved, e.g. to regenerate/verify its results-file
            # entry) - this is a size_pc BACKFILL onto still-null records
            # only; a record that already carries a value keeps that exact
            # value untouched, byte-for-byte, no matter how many times this
            # script is re-run over it.
            if not visual.get("size_pc"):
                visual["size_pc"] = outcome["size_pc"]
            resolved += 1
            method_counts[outcome["method"]] = method_counts.get(outcome["method"], 0) + 1
            print(
                f"[{i}/{len(targets)}] OK {record_id!r}: "
                f"size_pc={outcome['size_pc']:.4f} ({outcome['method']})"
            )
        else:
            print(f"[{i}/{len(targets)}] UNRESOLVED {record_id!r}: {outcome['detail']}")

    records_path.write_text(json.dumps(records, indent=2) + "\n")

    results_output = Path(args.results_output)
    results_output.parent.mkdir(parents=True, exist_ok=True)
    # Merge into, rather than blindly overwrite, any results already on
    # disk. The previous unconditional `write_text(json.dumps(results...))`
    # replaced the ENTIRE results file with only *this run's* `targets`
    # every time - harmless for a single full end-to-end run, but silently
    # DROPPED every previously-recorded entry whenever the script was later
    # re-run over a narrower `--only` subset (exactly how `cl_alessi_1`/
    # `m42_orion` ended up with a correct `size_pc` in the catalog but no
    # entry at all in this file: an earlier full run recorded them, a later
    # `--only` run - not targeting them - overwrote the file with only its
    # own subset). Merging by id keeps every id this run touches at its
    # freshest outcome while preserving every other id's existing entry,
    # and re-sorts by the records file's own catalog order so the output
    # stays stable/readable regardless of which ids any given run covered.
    existing_results: list[dict[str, Any]] = []
    if results_output.exists():
        existing_results = json.loads(results_output.read_text())
    results_by_id = {r["id"]: r for r in existing_results}
    for r in results:
        results_by_id[r["id"]] = r
    order_index = {r["id"]: i for i, r in enumerate(records)}
    merged_results = sorted(
        results_by_id.values(), key=lambda r: order_index.get(r["id"], len(records))
    )
    results_output.write_text(json.dumps(merged_results, indent=2) + "\n")

    print()
    print(f"Resolved: {resolved}/{len(targets)}")
    for method, count in sorted(method_counts.items()):
        print(f"  {method}: {count}")
    print(f"Unresolved: {len(targets) - resolved} (see {results_output})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
