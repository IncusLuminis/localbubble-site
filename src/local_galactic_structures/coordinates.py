"""RA/Dec/distance -> heliocentric Galactic Cartesian XYZ (spec Idea.md §6).

All transforms go through astropy.coordinates. No custom RA/Dec -> Galactic
math is implemented here, per spec §6.

Coordinate convention (astropy's `Galactic` frame, undisplaced - i.e. still
centered on the observer/Sun since we only supply a distance, not a
galactocentric offset):
    Sun = (0, 0, 0)
    +X -> Galactic Center
    +Y -> direction of Galactic rotation
    +Z -> North Galactic Pole
"""

from __future__ import annotations

import astropy.units as u
from astropy.coordinates import SkyCoord

from .schema import AstronomicalObject, Cartesian, Coordinates


def radec_distance_to_galactic_xyz(
    ra_deg: float, dec_deg: float, distance_pc: float
) -> tuple[float, float, float, float, float]:
    """Convert ICRS RA/Dec + heliocentric distance to Galactic l/b and XYZ.

    Returns (l_deg, b_deg, x_pc, y_pc, z_pc).
    """
    coord = SkyCoord(
        ra=ra_deg * u.deg,
        dec=dec_deg * u.deg,
        distance=distance_pc * u.pc,
        frame="icrs",
    )
    galactic = coord.galactic
    cartesian = galactic.cartesian
    return (
        float(galactic.l.deg),
        float(galactic.b.deg),
        float(cartesian.x.to(u.pc).value),
        float(cartesian.y.to(u.pc).value),
        float(cartesian.z.to(u.pc).value),
    )


def derive_galactic_coordinates(obj: AstronomicalObject) -> AstronomicalObject:
    """Return a copy of `obj` with `coordinates` (l/b) and `cartesian` (XYZ)
    (re)computed from `coordinates.ra_deg`/`dec_deg` and `distance.value_pc`.

    The Sun (distance = 0) is the one degenerate case RA/Dec cannot resolve
    (undefined direction at zero distance) and is passed through unchanged
    at the origin instead of being run through astropy.
    """
    if obj.distance.value_pc == 0:
        return obj.model_copy(
            update={
                "coordinates": obj.coordinates.model_copy(
                    update={"galactic_l_deg": 0.0, "galactic_b_deg": 0.0}
                ),
                "cartesian": Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
            }
        )

    l_deg, b_deg, x_pc, y_pc, z_pc = radec_distance_to_galactic_xyz(
        obj.coordinates.ra_deg, obj.coordinates.dec_deg, obj.distance.value_pc
    )
    return obj.model_copy(
        update={
            "coordinates": Coordinates(
                ra_deg=obj.coordinates.ra_deg,
                dec_deg=obj.coordinates.dec_deg,
                galactic_l_deg=l_deg,
                galactic_b_deg=b_deg,
            ),
            "cartesian": Cartesian(x_pc=x_pc, y_pc=y_pc, z_pc=z_pc),
        }
    )


def derive_galactic_coordinates_batch(
    objects: list[AstronomicalObject],
) -> list[AstronomicalObject]:
    return [derive_galactic_coordinates(obj) for obj in objects]
