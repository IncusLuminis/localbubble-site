import numpy as np
import pytest

from local_galactic_structures.coordinates import (
    derive_galactic_coordinates,
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
