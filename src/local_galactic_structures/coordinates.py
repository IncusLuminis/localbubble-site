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


def _radec_distance_to_galactic_xyz_batch(
    ra_deg: list[float], dec_deg: list[float], distance_pc: list[float]
):
    """Vectorized form of `radec_distance_to_galactic_xyz()`: builds a
    single `SkyCoord` from array-valued RA/Dec/distance and runs one
    ICRS -> Galactic astropy transform for the whole batch, instead of one
    `SkyCoord`/transform per element (#70).

    Callers must exclude zero-distance objects first (see
    `derive_galactic_coordinates_batch`) - distance=0 is degenerate for
    this transform whether done one at a time or vectorized.

    Returns a 5-tuple of numpy arrays (l_deg, b_deg, x_pc, y_pc, z_pc),
    positionally aligned with the input arrays.

    Note: astropy does NOT raise per-element for a bad input here (e.g. an
    `inf` distance) - it silently produces `nan` in that one array
    position among otherwise-good results, with no indication of which
    element failed. Validating/attributing failures to a specific object
    is the caller's job (`derive_galactic_coordinates_batch` does this by
    reconstructing each object's model from its slice of the result and
    letting the schema's range constraints catch bad values).
    """
    coords = SkyCoord(
        ra=ra_deg * u.deg,
        dec=dec_deg * u.deg,
        distance=distance_pc * u.pc,
        frame="icrs",
    )
    galactic = coords.galactic
    cartesian = galactic.cartesian
    return (
        galactic.l.deg,
        galactic.b.deg,
        cartesian.x.to(u.pc).value,
        cartesian.y.to(u.pc).value,
        cartesian.z.to(u.pc).value,
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

    Vectorization (#70): rather than building and transforming one
    `SkyCoord` per object, every non-zero-distance object's RA/Dec/distance
    is transformed via a single vectorized `SkyCoord` - one astropy call
    for the whole batch (the actual performance win). astropy does not
    raise per-element for a bad value within that vectorized transform
    (see `_radec_distance_to_galactic_xyz_batch`), so #68's per-object
    error attribution is preserved with a second pass: each object's slice
    of the vectorized result is still reconstructed into its own
    `Coordinates`/`Cartesian` model individually, in original input order.
    That per-object reconstruction is what actually raises (via
    `Coordinates`' l/b range constraints, #67) and gets attributed to the
    specific object - exactly as the old per-object loop did, just with
    the expensive astropy transform itself done once for the batch instead
    of once per object.

    The Sun (and any other zero-distance object) is excluded from the
    vectorized astropy call entirely - distance=0 is degenerate for the
    ICRS -> Galactic transform (direction undefined at zero distance, see
    `derive_galactic_coordinates`) - and is instead handled via the same
    pass-through-to-origin logic as the single-object function, for every
    zero-distance object in the batch at once. Results are reassembled in
    the original input order regardless of which group each object fell
    into.

    No dual-path/size threshold: a single vectorized `SkyCoord` call
    handles batches of any size, including 0 or 1 non-zero-distance
    objects, without special-casing - astropy's array inputs degrade to
    length-1 arrays cleanly, so there's no concrete reason (measured
    overhead, correctness edge case, etc.) to add a second per-object code
    path just for small N.
    """
    results_by_index: dict[int, AstronomicalObject] = {}

    zero_distance = [
        (i, obj) for i, obj in enumerate(objects) if obj.distance.value_pc == 0
    ]
    positive_distance = [
        (i, obj) for i, obj in enumerate(objects) if obj.distance.value_pc != 0
    ]

    for i, obj in zero_distance:
        results_by_index[i] = obj.model_copy(
            update={
                "coordinates": obj.coordinates.model_copy(
                    update={"galactic_l_deg": 0.0, "galactic_b_deg": 0.0}
                ),
                "cartesian": Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
            }
        )

    if positive_distance:
        ra = [obj.coordinates.ra_deg for _, obj in positive_distance]
        dec = [obj.coordinates.dec_deg for _, obj in positive_distance]
        dist = [obj.distance.value_pc for _, obj in positive_distance]
        l_arr, b_arr, x_arr, y_arr, z_arr = _radec_distance_to_galactic_xyz_batch(
            ra, dec, dist
        )

        for pos, (i, obj) in enumerate(positive_distance):
            try:
                results_by_index[i] = obj.model_copy(
                    update={
                        "coordinates": Coordinates(
                            ra_deg=obj.coordinates.ra_deg,
                            dec_deg=obj.coordinates.dec_deg,
                            galactic_l_deg=float(l_arr[pos]),
                            galactic_b_deg=float(b_arr[pos]),
                        ),
                        "cartesian": Cartesian(
                            x_pc=float(x_arr[pos]),
                            y_pc=float(y_arr[pos]),
                            z_pc=float(z_arr[pos]),
                        ),
                    }
                )
            except Exception as exc:
                raise CoordinateDerivationError(obj, exc) from exc

    return [results_by_index[i] for i in range(len(objects))]
