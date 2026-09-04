"""Reproduces (and documents) the live acquisition behind Story #326's
2 new catalog records - Iris Nebula (`molecular_cloud`) and Veil Nebula/
Cygnus Loop (`supernova_remnant`) - plus the 2 candidates investigated and
deliberately excluded, Horsehead Nebula and Flame Nebula. See
`data/raw/gap_fills/README.md`'s Story #326 section and each new record's
own `source`/`notes` fields in `data/normalized/initial_catalog_records.json`
for the full narrative.

Unlike Stories #318/#324/#325 (`scripts/acquire_molecular_cloud_gap_fill.py`),
none of this Story's 4 candidates are in the Zucker et al. 2020
molecular-cloud compendium at all - that paper is specifically about
molecular clouds, and 3 of these 4 candidates are not molecular clouds in
the first place (a reflection nebula, a supernova remnant, and two more
that turned out to be near-duplicates of an already-loaded record). This
script therefore does NOT import `data_sources.zucker_molecular_clouds` -
per the issue's own explicit instruction not to force these through the
molecular-cloud-specific pipeline. It instead re-runs the same live SIMBAD
queries (via `data_sources.simbad.SimbadResolver`/`data_sources.simbad_size`
directly, the same adapters the Messier-nebula-gap-fill batch, issue #221,
and the Vela SNR record itself already use) this Story's own acquisition
used, plus the redundancy-check separations against the already-loaded
Orion Molecular Cloud Complex record, for anyone who wants to independently
re-verify them.

Not a mechanical re-run-to-regenerate script (same rationale
`acquire_molecular_cloud_gap_fill.py`'s own docstring gives): this Story's
candidate selection involved real judgment calls (nebula classification,
which SIMBAD identifier to anchor to, the Horsehead/Flame redundancy call)
documented in prose, not something meant to be silently re-decided by
blind automation on a future re-run.

Usage:

    python scripts/acquire_nebula_gap_fill.py
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT / "src"))

from astropy.coordinates import SkyCoord  # noqa: E402
import astropy.units as u  # noqa: E402

from local_galactic_structures.data_sources import simbad_size, slugify  # noqa: E402
from local_galactic_structures.data_sources.simbad import SimbadResolver  # noqa: E402


def _angular_sep_deg(ra1: float, dec1: float, ra2: float, dec2: float) -> float:
    a = SkyCoord(ra=ra1 * u.deg, dec=dec1 * u.deg, frame="icrs")
    b = SkyCoord(ra=ra2 * u.deg, dec=dec2 * u.deg, frame="icrs")
    return float(a.separation(b).deg)


#: The already-loaded Orion Molecular Cloud Complex record's own stored
#: position (`data/normalized/initial_catalog_records.json`,
#: `orion-molecular-cloud-complex`) and `visual.size_pc` (a DIAMETER per
#: this catalog's own established convention, so radius = size_pc / 2) -
#: the redundancy-check anchor for Horsehead/Flame below.
ORION_COMPLEX_RA_DEG = 86.2152
ORION_COMPLEX_DEC_DEG = -1.3456
ORION_COMPLEX_DISTANCE_PC = 433.0
ORION_COMPLEX_RADIUS_PC = 52.90092962794813 / 2.0


def acquire_iris_nebula() -> None:
    """Iris Nebula (NGC 7023) - live-queried and ADDED as `molecular_cloud`.

    `NAME Iris Nebula` resolves on SIMBAD to main_id `NGC  7023`, otype
    `OpC` (Open Cluster - the embedded young cluster, not the nebula
    itself; the same "named-nebula identifier resolves to a co-located
    companion object" quirk issue #221 already documented for M8/M16/M17/
    M20). A live region search around that position finds the nebula's
    own distinct SIMBAD entry, `Ced 187` (Cederblad 187), otype `RNe`
    (Reflection Nebula), 0.026 deg away - confirming this is genuinely a
    reflection nebula, not an emission/HII region like the 5 already-
    loaded Messier nebulae, and closer in kind to this catalog's existing
    dark-nebula `molecular_cloud` precedent (Pipe Nebula, Coalsack Nebula)
    than to `hii_region`. NGC 7023 carries a real usable parallax
    (Ced 187 does not), so it is used as the position/distance anchor.
    """
    resolver = SimbadResolver(object_type="molecular_cloud")
    obj = resolver.resolve("NAME Iris Nebula")
    print("Iris Nebula (NGC 7023):")
    print(f"  otype-confirmed anchor: {obj.name!r}")
    print(f"  position: ra={obj.coordinates.ra_deg}, dec={obj.coordinates.dec_deg}")
    print(
        f"  distance: {obj.distance.value_pc:.2f} +/- {obj.distance.error_pc:.2f} pc "
        "(SIMBAD parallax)"
    )
    for alias in ("NAME Iris Nebula", "NGC 7023", "Ced 187", "LBN 487", "Cl VDB 139"):
        size = simbad_size.resolve_angular_diameter(alias)
        print(f"  size_pc via {alias!r}: {size!r}")
    print()


def acquire_veil_nebula() -> None:
    """Veil Nebula (Cygnus Loop) - live-queried and ADDED as
    `supernova_remnant`, the catalog's second (after Vela SNR).

    `NAME Cygnus Loop` resolves to main_id `NAME Cyg Loop`, otype `SNR`
    (confirmed genuine SuperNova Remnant, not a generic ISM/shell label) -
    chosen over the sibling entry `NAME Veil Nebula`/NGC 6960 (otype
    `ISM`, one specific western filament, 1.155 deg away - well within
    this remnant's own ~1.9 deg angular radius). SIMBAD has no parallax
    and no mesDistance on file for any Cygnus Loop identifier - distance
    comes from Fesen et al. 2021 (MNRAS 507, 244, arXiv:2109.05368), a
    Gaia EDR3-based revised distance to the remnant itself (725 +/- 15 pc),
    the same "literature paper directly measures the object's own
    distance" convention Vela SNR's own record already uses.
    """
    resolver = SimbadResolver(object_type="supernova_remnant")
    for name in ("NAME Cygnus Loop", "NAME Veil Nebula", "NGC 6960", "NGC 6992", "NGC 6995"):
        try:
            obj = resolver.resolve(name)
            print(f"  {name!r} resolved (unexpected - has a usable distance): {obj.distance}")
        except ValueError as exc:
            print(f"  {name!r}: honest failure (expected) - {exc}")

    cyg_loop_pos = (312.75, 30.666666666666668)
    veil_pos = (311.4083333333333, 30.708333333333332)
    sep = _angular_sep_deg(*cyg_loop_pos, *veil_pos)
    print(f"  'NAME Cyg Loop' vs 'NAME Veil Nebula'/NGC 6960 separation: {sep:.4f} deg")

    size = simbad_size.resolve_angular_diameter("NAME Cygnus Loop")
    print(f"  galdim via 'NAME Cygnus Loop': {size!r}")
    if size is not None:
        diameter_pc = simbad_size.diameter_pc_from_angular_size(
            size["majaxis_arcmin"], 725.0
        )
        print(f"  size_pc (diameter @ 725pc): {diameter_pc:.2f}")
    print()


def redundancy_check_horsehead_and_flame() -> None:
    """Horsehead Nebula / Flame Nebula - live-queried, both EXCLUDED as
    redundant with the already-loaded Orion Molecular Cloud Complex
    record (mandatory redundancy check, issue's own explicit requirement,
    performed regardless of outcome).

    Both resolve cleanly and unambiguously on SIMBAD: `NAME Horsehead
    Nebula` (otype `DNe`, Dark Nebula - Barnard 33) and `NAME Flame
    Nebula` (otype `HII`, HII Region - NGC 2024's associated nebula).
    Neither carries a usable SIMBAD parallax or mesDistance of its own.
    Both real SIMBAD positions sit closer to the existing Orion Molecular
    Cloud Complex record's own stored position than that record's own
    `visual.size_pc` radius - i.e. both already sit inside the volume
    that record renders as - so adding either as a separate point would
    be a near-duplicate with no independently-verified distance of its
    own to justify a distinct record.
    """
    resolver = SimbadResolver(object_type="molecular_cloud")
    for name, expected_otype in (
        ("NAME Horsehead Nebula", "DNe"),
        ("NAME Flame Nebula", "HII"),
    ):
        try:
            obj = resolver.resolve(name)
            print(f"  {name!r} resolved (unexpected): {obj.distance}")
            ra, dec = obj.coordinates.ra_deg, obj.coordinates.dec_deg
        except ValueError as exc:
            print(f"  {name!r}: no usable SIMBAD distance (expected) - {exc}")
            # Re-derive position/otype independently for the checks below
            # (the raw identification query is still cached even though
            # resolve() raised - see data/raw/simbad/).
            cache_path = REPO_ROOT / "data" / "raw" / "simbad" / f"{slugify(name)}.json"
            raw = json.loads(cache_path.read_text())["raw"]
            ra, dec = raw["ra"], raw["dec"]
            otype = raw.get("otype")
            match_note = "confirmed" if otype == expected_otype else f"UNEXPECTED, expected {expected_otype!r}"
            print(f"    otype: {otype!r} ({match_note})")

        sep_deg = _angular_sep_deg(ra, dec, ORION_COMPLEX_RA_DEG, ORION_COMPLEX_DEC_DEG)
        # Small-angle approx, consistent with simbad_size.diameter_pc_from_angular_size
        physical_offset_pc = ORION_COMPLEX_DISTANCE_PC * math.radians(sep_deg)
        inside_radius = physical_offset_pc < ORION_COMPLEX_RADIUS_PC
        print(
            f"    separation from Orion Molecular Cloud Complex record: "
            f"{sep_deg:.3f} deg -> ~{physical_offset_pc:.2f} pc physical offset "
            f"(record's own radius: {ORION_COMPLEX_RADIUS_PC:.2f} pc) - "
            f"{'INSIDE existing record radius (redundant)' if inside_radius else 'outside'}"
        )
    print()


def main() -> None:
    acquire_iris_nebula()
    acquire_veil_nebula()
    redundancy_check_horsehead_and_flame()


if __name__ == "__main__":
    main()
