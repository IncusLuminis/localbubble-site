"""Reproduces (and documents) the live acquisition behind Story #318's 4
new `molecular_cloud` catalog records (Corona Australis Molecular Cloud,
Coalsack Nebula, California Molecular Cloud, Serpens Molecular Cloud) plus
the 2 candidates investigated and deliberately excluded (Musca, Aquila
Rift) - see `data/raw/gap_fills/README.md`'s Story #318 section and each
new record's own `source`/`notes` fields in
`data/normalized/initial_catalog_records.json` for the full narrative.

This is NOT a mechanical re-run-to-regenerate script like
`scripts/backfill_structure_size.py`/`backfill_open_space_velocity.py`:
unlike those field BACKFILLS onto already-curated records, this Story's
own candidate selection (which regions to add, which to exclude as an
honest failure, which nearest-sightline match to trust) involved
real judgment calls documented in prose, not a fully mechanical
cascade - re-encoding that judgment as blind automation would risk
silently re-deciding it differently on a future data update. This script
instead exists so that judgment is independently *auditable*: it re-runs
the same two live queries (SIMBAD identification-only position, VizieR
`J/A+A/633/A51/handbook` nearest-sightline distance) this Story's own
acquisition used and prints the same numbers that went into each new
record, for anyone who wants to independently re-verify them (or re-run
this after a future data update to see whether anything has drifted).

`visual.size_pc` is intentionally NOT re-derived here - it already goes
through the fully-general, already-cached
`data_sources.simbad_size.resolve_angular_diameter` (Story #314's own
established DIAMETER-convention adapter for this object type), exactly
the same call every other diffuse-structure record in this catalog uses;
there is nothing Story-#318-specific to reproduce for that half.

Usage:

    python scripts/acquire_molecular_cloud_gap_fill.py
"""

from __future__ import annotations

import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from local_galactic_structures.data_sources import (  # noqa: E402
    simbad_size,
    zucker_molecular_clouds as zucker,
)

# (record id, SIMBAD identification query, SIMBAD identification-only
# (ra_deg, dec_deg) resolved during this Story's own research - re-queried
# live below only for the nearest-sightline lookup, not re-trusted blindly)
CANDIDATES = [
    ("corona-australis-molecular-cloud", "NAME Corona Australis Cloud", 285.4625, -36.98166666666667),
    ("coalsack-nebula", "NAME Coalsack Nebula", 187.82916666666665, -63.74333333333333),
    ("california-molecular-cloud", "NAME California Molecular Cloud", 62.50000000000001, 39.0),
    ("serpens-molecular-cloud", "NAME Serpens Main Cloud", 277.3, 0.6),
]

#: Investigated and NOT added - printed for audit completeness, not
#: turned into records by this script.
EXCLUDED_CANDIDATES = [
    ("Musca Molecular Cloud", "NAME Musca", 185.75, -71.3),
    ("Aquila Rift", "NAME Aql Rift", 278.0, -1.0),
]


def main() -> int:
    print("Loading Zucker et al. 2020 Star Formation Handbook sightline table "
          "(VizieR J/A+A/633/A51/handbook, cached after first fetch)...")
    rows = zucker.load_zucker_2020_handbook()
    print(f"  {len(rows)} sightlines across {len({r['Name'] for r in rows})} named groups.\n")

    print("=== Added records ===\n")
    for record_id, query, ra, dec in CANDIDATES:
        row, sep_deg = zucker.nearest_row(ra, dec, rows)
        systematic_fraction = zucker.systematic_fraction_for(row["Name"])
        error_pc = zucker.quadrature_error_pc(
            row["d16"], row["d50"], row["d84"], systematic_fraction
        )
        print(f"{record_id} (SIMBAD query {query!r}, ra={ra}, dec={dec})")
        print(
            f"  nearest sightline: Name={row['Name']!r} sep={sep_deg:.3f} deg "
            f"l={row['GLON']} b={row['GLAT']}"
        )
        print(
            f"  d50={row['d50']} pc  d16={row['d16']} pc  d84={row['d84']} pc  "
            f"systematic={systematic_fraction:.0%}  error_pc={error_pc:.4f}"
        )
        print(f"  ra_deg={row['_RA.icrs']}  dec_deg={row['_DE.icrs']}")
        diam = simbad_size.resolve_angular_diameter(query)
        if diam is not None:
            size_pc = simbad_size.diameter_pc_from_angular_size(
                diam["majaxis_arcmin"], row["d50"]
            )
            print(
                f"  size_pc={size_pc:.4f} (galdim_majaxis={diam['majaxis_arcmin']} arcmin, "
                f"bibcode {diam['bibcode']})"
            )
        else:
            print("  size_pc=None (honest failure: no galdim_majaxis on file)")
        print()

    print("=== Investigated, NOT added (honest exclusions) ===\n")
    for label, query, ra, dec in EXCLUDED_CANDIDATES:
        row, sep_deg = zucker.nearest_row(ra, dec, rows)
        same_name = zucker.nearest_row_within_group(ra, dec, rows, label.split()[0])
        print(f"{label} (SIMBAD query {query!r}, ra={ra}, dec={dec})")
        print(
            f"  nearest sightline OVERALL: Name={row['Name']!r} sep={sep_deg:.3f} deg "
            f"d50={row['d50']} pc"
        )
        print()

    return 0


if __name__ == "__main__":
    sys.exit(main())
