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


class CoordinateDerivationError(Exception):
    """Raised by `derive_galactic_coordinates_batch()` when a single object's
    coordinate derivation fails, so the failure can be attributed to a
    specific object instead of surfacing as an opaque, anonymous traceback.

    The original exception (an astropy error, a Pydantic `ValidationError`
    from `Coordinates`' l/b range constraints added in #67, etc.) is
    preserved as `__cause__` via `raise ... from ...` - this wraps the
    failure with attribution, it does not hide the root cause.
    """

    def __init__(self, obj: AstronomicalObject, original: Exception) -> None:
        self.object_id = obj.id
        self.object_name = obj.name
        self.original = original
        super().__init__(
            f"Failed to derive galactic coordinates for object "
            f"id={obj.id!r} name={obj.name!r}: "
            f"{type(original).__name__}: {original}"
        )


def derive_galactic_coordinates_batch(
    objects: list[AstronomicalObject],
) -> list[AstronomicalObject]:
    """Derive galactic coordinates for every object in `objects`.

    Failure policy: fail-fast, not skip-and-collect-errors.

    Every real caller of this function (`initial_catalog.py`'s
    `derive_galactic_coordinates_batch()` use over the full curated
    ~20-object initial catalog, and `cli.py`'s `build-coordinates`
    subcommand over a catalog loaded from a parquet file) runs it over an
    already-curated/loaded catalog, not a best-effort/partial operation - a
    failure there is an anomaly worth surfacing loudly and specifically,
    not something to silently paper over. (Story #58's per-adapter live
    data-acquisition code in `data_sources/*.py` calls the *single-object*
    `derive_galactic_coordinates()` directly, one object at a time inside
    its own `resolve()` methods, so per-object error handling during live
    acquisition already happens naturally at that layer and isn't this
    batch function's concern.)

    A per-object failure here is realistically caused by something at this
    derivation stage specifically - not by out-of-range ra/dec/distance
    inputs, which `AstronomicalObject`/`Coordinates`/`Distance` already
    reject at construction time via #67's schema constraints. For example,
    a valid-but-extreme `distance.value_pc` (e.g. `float('inf')`, which
    satisfies `Distance`'s `ge=0.0` constraint) can drive astropy's
    ICRS -> Galactic transform to produce `nan` for `l`/`b`, which then
    fails when `derive_galactic_coordinates()` reconstructs a `Coordinates`
    model from the result.
    """
    results = []
    for obj in objects:
        try:
            results.append(derive_galactic_coordinates(obj))
        except Exception as exc:
            raise CoordinateDerivationError(obj, exc) from exc
    return results
