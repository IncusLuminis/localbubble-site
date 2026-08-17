import numpy as np
import pytest

from pydantic import ValidationError

from local_galactic_structures.coordinates import (
    CoordinateDerivationError,
    derive_galactic_coordinates,
    derive_galactic_coordinates_batch,
    radec_distance_to_galactic_xyz,
)
from local_galactic_structures.schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    Source,
)


def _object(ra_deg: float, dec_deg: float, distance_pc: float) -> AstronomicalObject:
    return AstronomicalObject(
        id="test-object",
        name="Test Object",
        object_type="star",
        coordinates=Coordinates(
            ra_deg=ra_deg, dec_deg=dec_deg, galactic_l_deg=0.0, galactic_b_deg=0.0
        ),
        distance=Distance(value_pc=distance_pc),
        cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
        source=Source(reference="unit test fixture"),
    )


def test_sun_is_origin():
    sun = _object(ra_deg=0.0, dec_deg=0.0, distance_pc=0.0)
    derived = derive_galactic_coordinates(sun)
    assert derived.cartesian.x_pc == 0.0
    assert derived.cartesian.y_pc == 0.0
    assert derived.cartesian.z_pc == 0.0


@pytest.mark.parametrize(
    "ra_deg,dec_deg,distance_pc",
    [
        (56.75, 24.1167, 136.2),  # Pleiades
        (66.75, 15.87, 47.0),  # Hyades
        (83.8221, -5.3911, 414.0),  # Orion Nebula Cluster
        (280.0, -60.0, 800.0),
    ],
)
def test_distance_is_preserved(ra_deg, dec_deg, distance_pc):
    obj = _object(ra_deg, dec_deg, distance_pc)
    derived = derive_galactic_coordinates(obj)
    reconstructed = np.sqrt(
        derived.cartesian.x_pc**2 + derived.cartesian.y_pc**2 + derived.cartesian.z_pc**2
    )
    assert reconstructed == pytest.approx(distance_pc, abs=1e-6)


@pytest.mark.parametrize(
    "l_deg,distance_pc",
    [(0.0, 100.0), (90.0, 250.0), (180.0, 500.0), (270.0, 50.0)],
)
def test_galactic_plane_gives_zero_z(l_deg, distance_pc):
    # Build an object directly from Galactic (l, b=0) coordinates, converted
    # to ICRS RA/Dec, so the round trip exercises the real ra/dec -> xyz path.
    from astropy.coordinates import Galactic, SkyCoord
    import astropy.units as u

    galactic = SkyCoord(l=l_deg * u.deg, b=0.0 * u.deg, frame=Galactic())
    icrs = galactic.icrs

    obj = _object(ra_deg=icrs.ra.deg, dec_deg=icrs.dec.deg, distance_pc=distance_pc)
    derived = derive_galactic_coordinates(obj)

    assert derived.cartesian.z_pc == pytest.approx(0.0, abs=1e-6)
    assert derived.coordinates.galactic_b_deg == pytest.approx(0.0, abs=1e-6)


def test_radec_distance_to_galactic_xyz_matches_known_pleiades_lb():
    # Well-known Pleiades Galactic coordinates (l ~ 166.6, b ~ -23.5 deg).
    l_deg, b_deg, x_pc, y_pc, z_pc = radec_distance_to_galactic_xyz(
        ra_deg=56.75, dec_deg=24.1167, distance_pc=136.2
    )
    assert l_deg == pytest.approx(166.57, abs=0.1)
    assert b_deg == pytest.approx(-23.52, abs=0.1)
    assert np.sqrt(x_pc**2 + y_pc**2 + z_pc**2) == pytest.approx(136.2, abs=1e-6)


def test_batch_happy_path_matches_single_object_derivation():
    """No behavior change for the happy path: a batch of all-valid objects
    returns exactly what calling derive_galactic_coordinates() on each
    object individually would return."""
    objects = [
        _object(56.75, 24.1167, 136.2),  # Pleiades
        _object(66.75, 15.87, 47.0),  # Hyades
        _object(0.0, 0.0, 0.0),  # Sun (degenerate distance=0 case)
        _object(83.8221, -5.3911, 414.0),  # Orion Nebula Cluster
    ]
    batch_result = derive_galactic_coordinates_batch(objects)
    individual_result = [derive_galactic_coordinates(obj) for obj in objects]

    assert len(batch_result) == len(objects)
    for batch_obj, individual_obj in zip(batch_result, individual_result):
        assert batch_obj == individual_obj


def test_batch_with_one_bad_object_raises_coordinate_derivation_error_with_attribution():
    """A real (not monkeypatched) failure trigger: `distance.value_pc` is
    schema-valid at construction time (Distance only requires ge=0.0, and
    inf satisfies that), but driving astropy's ICRS -> Galactic transform
    with an infinite distance produces `nan` for l/b, which then fails
    Coordinates' range constraints (#67) when derive_galactic_coordinates()
    reconstructs the model. This exercises the actual failure path end to
    end, not a simulated one."""
    good_before = _object(56.75, 24.1167, 136.2)  # Pleiades
    bad = AstronomicalObject(
        id="bad-object-id",
        name="Bad Object Name",
        object_type="star",
        coordinates=Coordinates(
            ra_deg=56.75, dec_deg=24.1167, galactic_l_deg=0.0, galactic_b_deg=0.0
        ),
        distance=Distance(value_pc=float("inf")),
        cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
        source=Source(reference="unit test fixture"),
    )
    good_after = _object(66.75, 15.87, 47.0)  # Hyades

    with pytest.warns(RuntimeWarning):
        with pytest.raises(CoordinateDerivationError) as exc_info:
            derive_galactic_coordinates_batch([good_before, bad, good_after])

    err = exc_info.value
    # Attribution: identifies the specific failing object, not just "a" failure.
    assert err.object_id == "bad-object-id"
    assert err.object_name == "Bad Object Name"
    assert "bad-object-id" in str(err)
    assert "Bad Object Name" in str(err)

    # Root cause is still fully visible via exception chaining.
    assert err.__cause__ is not None
    assert isinstance(err.__cause__, ValidationError)
    assert err.original is err.__cause__


def test_batch_fails_fast_without_returning_partial_results():
    """Fail-fast means the whole batch call raises - it does not swallow
    the error and return a partial list of the objects processed before
    the bad one. Callers that want partial results must catch the
    exception themselves; this function doesn't hand back a half-built
    list on failure."""
    good_before = _object(56.75, 24.1167, 136.2)
    bad = AstronomicalObject(
        id="bad-object-id",
        name="Bad Object Name",
        object_type="star",
        coordinates=Coordinates(
            ra_deg=56.75, dec_deg=24.1167, galactic_l_deg=0.0, galactic_b_deg=0.0
        ),
        distance=Distance(value_pc=float("inf")),
        cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
        source=Source(reference="unit test fixture"),
    )

    with pytest.warns(RuntimeWarning):
        try:
            derive_galactic_coordinates_batch([good_before, bad])
            assert False, "expected CoordinateDerivationError to be raised"
        except CoordinateDerivationError:
            # The call raised rather than returning; there is no partial
            # list handed back to inspect here, by design.
            pass
