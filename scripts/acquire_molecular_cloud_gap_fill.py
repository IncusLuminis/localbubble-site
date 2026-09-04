"""Reproduces (and documents) the live acquisition behind Story #318's 4
new `molecular_cloud` catalog records (Corona Australis Molecular Cloud,
Coalsack Nebula, California Molecular Cloud, Serpens Molecular Cloud) plus
the 2 candidates investigated and deliberately excluded (Musca, Aquila
Rift), AND Story #324's follow-on batch (North America Nebula, Pelican
Nebula, IC 5146/Cocoon Nebula, Circinus, Norma, Mon OB1/NGC 2264, IC 2118/
Witch Head Nebula, Orion_Lam/Lambda Orionis Ring, Draco Cloud, Northern
Coalsack) - see `data/raw/gap_fills/README.md`'s Story #318/#324 sections
and each new record's own `source`/`notes` fields in
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

from astropy.coordinates import SkyCoord  # noqa: E402
import astropy.units as u  # noqa: E402

from local_galactic_structures.data_sources import (  # noqa: E402
    simbad_size,
    zucker_molecular_clouds as zucker,
)


def _angular_sep_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    a = SkyCoord(ra=ra1 * u.deg, dec=dec1 * u.deg, frame="icrs")
    b = SkyCoord(ra=ra2 * u.deg, dec=dec2 * u.deg, frame="icrs")
    return float(a.separation(b).deg)

# (record id, SIMBAD identification query, SIMBAD identification-only
# (ra_deg, dec_deg) resolved during this Story's own research - re-queried
# live below only for the nearest-sightline lookup, not re-trusted blindly)
CANDIDATES = [
    ("corona-australis-molecular-cloud", "NAME Corona Australis Cloud", 285.4625, -36.98166666666667),
    ("coalsack-nebula", "NAME Coalsack Nebula", 187.82916666666665, -63.74333333333333),
    ("california-molecular-cloud", "NAME California Molecular Cloud", 62.50000000000001, 39.0),
    ("serpens-molecular-cloud", "NAME Serpens Main Cloud", 277.3, 0.6),
    # --- Story #324 follow-on batch below ---
    ("north-america-nebula", "NAME North America Nebula", 314.6958333333333, 44.33),
    ("pelican-nebula", "NAME Pelican Nebula", 312.75, 44.36666666666667),
    ("ic-5146-cocoon-nebula", "NAME Cocoon Nebula", 328.372, 47.246),
    ("circinus-molecular-cloud", "Circinus Cloud", 225.5, -63.0),
    ("norma-molecular-cloud", "Norma Cloud", 248.5, -45.0),
    ("mon-ob1-ngc-2264", "NGC 2264", 100.21708333333333, 9.876944444444444),
    ("ic-2118-witch-head-nebula", "IC 2118", 75.5, -7.9),
    ("orion-lam-lambda-orionis-ring", "Sh 2-264", 83.825, 9.933333333333332),
    ("draco-cloud", "NAME Draco Cloud", 252.07083333333333, 60.19666666666667),
    ("northern-coalsack", "NAME Northern Coalsack", 305.25, 37.0),
]

#: Investigated and NOT added - printed for audit completeness, not
#: turned into records by this script.
EXCLUDED_CANDIDATES = [
    ("Musca Molecular Cloud", "NAME Musca", 185.75, -71.3),
    ("Aquila Rift", "NAME Aql Rift", 278.0, -1.0),
]

#: Story #324's own redundancy checks (issue's own explicit requirement):
#: candidate identification position vs. the ALREADY-LOADED record it might
#: be a near-duplicate of, by real angular separation on the sky - not by
#: name alone. (label, candidate ra/dec, existing record id, existing
#: record's own stored ra/dec).
REDUNDANCY_CHECKS = [
    (
        "Orion_Lam (Sh 2-264 / lam Ori Molecular Ring) vs. Orion Molecular Cloud Complex",
        83.825, 9.933333333333332,
        "orion-molecular-cloud-complex", 86.2152, -1.3456,
    ),
    (
        "Northern Coalsack vs. Coalsack Nebula",
        305.25, 37.0,
        "coalsack-nebula", 189.1772, -65.4279,
    ),
]


def main() -> int:
    print("Loading Zucker et al. 2020 Star Formation Handbook sightline table "
          "(VizieR J/A+A/633/A51/handbook, cached after first fetch)...")
    rows = zucker.load_zucker_2020_handbook()
    print(f"  {len(rows)} sightlines across {len({r['Name'] for r in rows})} named groups.\n")

    print("=== Story #324 redundancy checks (real position separation, not name matching) ===\n")
    for label, ra, dec, existing_id, existing_ra, existing_dec in REDUNDANCY_CHECKS:
        sep_deg = _angular_sep_deg(ra, dec, existing_ra, existing_dec)
        print(f"{label}")
        print(
            f"  candidate identification position: ra={ra} dec={dec}"
        )
        print(
            f"  existing record {existing_id!r} stored position: ra={existing_ra} dec={existing_dec}"
        )
        print(f"  angular separation: {sep_deg:.3f} deg -> {'DISTINCT' if sep_deg > 1.0 else 'POSSIBLE DUPLICATE'}")
        print()

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
