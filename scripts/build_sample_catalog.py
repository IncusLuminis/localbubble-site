#!/usr/bin/env python3
"""Build the small sample catalog used to validate the Story #57 pipeline
(schema, storage, coordinate transforms) end to end.

This is a hand-picked set of well-documented objects, not the curated
>=20-object initial catalog required by spec §9 / Story #59 - that is a
separate, larger acquisition effort with its own provenance review.

Usage:
    python scripts/build_sample_catalog.py
"""

from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from local_galactic_structures.catalog import save_catalog  # noqa: E402
from local_galactic_structures.coordinates import (  # noqa: E402
    derive_galactic_coordinates_batch,
)
from local_galactic_structures.schema import (  # noqa: E402
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    Source,
)

REPO_ROOT = Path(__file__).resolve().parent.parent


def _placeholder_cartesian() -> Cartesian:
    return Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0)


def build_sample_objects() -> list[AstronomicalObject]:
    sun = AstronomicalObject(
        id="sun",
        name="Sun",
        object_type="reference_point",
        coordinates=Coordinates(
            ra_deg=0.0, dec_deg=0.0, galactic_l_deg=0.0, galactic_b_deg=0.0
        ),
        distance=Distance(value_pc=0.0, error_pc=0.0),
        cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
        source=Source(reference="Origin of the heliocentric coordinate system by definition"),
        notes="Coordinate system origin (spec Idea.md §6).",
    )

    pleiades = AstronomicalObject(
        id="pleiades",
        name="Pleiades",
        aliases=["M45", "Seven Sisters", "Melotte 22"],
        object_type="star_cluster",
        coordinates=Coordinates(
            ra_deg=56.75, dec_deg=24.1167, galactic_l_deg=0.0, galactic_b_deg=0.0
        ),
        distance=Distance(value_pc=136.2, error_pc=1.2),
        cartesian=_placeholder_cartesian(),
        source=Source(
            reference="Lodieu et al. 2019, A&A 628, A66 - Gaia DR2 astrometric distance to the Pleiades",
            catalog="Gaia DR2",
        ),
        notes="Sample record for Story #57 pipeline validation.",
    )

    hyades = AstronomicalObject(
        id="hyades",
        name="Hyades",
        aliases=["Melotte 25", "Caldwell 41"],
        object_type="star_cluster",
        coordinates=Coordinates(
            ra_deg=66.75, dec_deg=15.87, galactic_l_deg=0.0, galactic_b_deg=0.0
        ),
        distance=Distance(value_pc=47.0, error_pc=0.5),
        cartesian=_placeholder_cartesian(),
        source=Source(
            reference="Gaia Collaboration, Babusiaux et al. 2018, A&A 616, A10 - Gaia DR2 HR diagram (Hyades)",
            catalog="Gaia DR2",
        ),
        notes="Sample record for Story #57 pipeline validation.",
    )

    onc = AstronomicalObject(
        id="orion_nebula_cluster",
        name="Orion Nebula Cluster",
        aliases=["Trapezium Cluster", "M42 cluster"],
        object_type="star_forming_region",
        coordinates=Coordinates(
            ra_deg=83.8221, dec_deg=-5.3911, galactic_l_deg=0.0, galactic_b_deg=0.0
        ),
        distance=Distance(value_pc=414.0, error_pc=7.0),
        cartesian=_placeholder_cartesian(),
        source=Source(
            reference="Menten et al. 2007, A&A 474, 515 - VLBI parallax distance to the Orion Nebula",
        ),
        notes="Sample record for Story #57 pipeline validation.",
    )

    objects = [sun, pleiades, hyades, onc]
    return derive_galactic_coordinates_batch(objects)


def main() -> None:
    objects = build_sample_objects()
    parquet_path = REPO_ROOT / "data" / "normalized" / "catalog.parquet"
    csv_path = REPO_ROOT / "data" / "normalized" / "catalog.csv"
    save_catalog(objects, parquet_path, csv_path)
    print(f"Wrote {len(objects)} objects to {parquet_path} and {csv_path}")


if __name__ == "__main__":
    main()
