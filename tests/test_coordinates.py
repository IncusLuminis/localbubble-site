import numpy as np
import pytest

from pydantic import ValidationError

from local_galactic_structures.coordinates import (
    CoordinateDerivationError,
    derive_galactic_coordinates,
    derive_galactic_coordinates_batch,
    galactic_velocity_kms,
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


def test_batch_output_identical_to_per_object_loop_for_larger_mixed_batch():
    """#70 regression check: the vectorized batch path must produce output
    identical (within tight float tolerance) to running every object
    through the unchanged single-object `derive_galactic_coordinates()` in
    a loop - that per-object loop is kept as the "ground truth" precisely
    so the vectorized path can be checked against it. Uses a larger, more
    varied set of RA/Dec/distance combinations than the happy-path test,
    including the Sun mixed in among non-zero-distance objects and objects
    spanning all four RA quadrants and both hemispheres."""
    objects = [
        _object(56.75, 24.1167, 136.2),  # Pleiades
        _object(0.0, 0.0, 0.0),  # Sun
        _object(66.75, 15.87, 47.0),  # Hyades
        _object(83.8221, -5.3911, 414.0),  # Orion Nebula Cluster
        _object(280.0, -60.0, 800.0),
        _object(10.0, 89.0, 5000.0),  # near north celestial pole
        _object(350.0, -89.0, 1.0),  # near south celestial pole
        _object(180.0, 0.0, 250.0),
        _object(0.0, 0.0, 1e6),
        _object(359.999, 45.0, 10.0),
    ]

    batch_result = derive_galactic_coordinates_batch(objects)
    individual_result = [derive_galactic_coordinates(obj) for obj in objects]

    assert len(batch_result) == len(objects)
    for batch_obj, individual_obj in zip(batch_result, individual_result):
        assert batch_obj.coordinates.galactic_l_deg == pytest.approx(
            individual_obj.coordinates.galactic_l_deg, abs=1e-9
        )
        assert batch_obj.coordinates.galactic_b_deg == pytest.approx(
            individual_obj.coordinates.galactic_b_deg, abs=1e-9
        )
        assert batch_obj.cartesian.x_pc == pytest.approx(
            individual_obj.cartesian.x_pc, abs=1e-9
        )
        assert batch_obj.cartesian.y_pc == pytest.approx(
            individual_obj.cartesian.y_pc, abs=1e-9
        )
        assert batch_obj.cartesian.z_pc == pytest.approx(
            individual_obj.cartesian.z_pc, abs=1e-9
        )
        assert batch_obj == individual_obj


def test_batch_sun_mixed_with_others_stays_at_origin_in_original_order():
    """The Sun (zero distance) is excluded from the vectorized astropy call
    and handled via pass-through, while surrounding objects go through the
    vectorized path - confirm the Sun still lands exactly at the origin
    and every object comes back in its original input position/order,
    regardless of which "group" (zero- vs positive-distance) it fell into
    internally."""
    pleiades = _object(56.75, 24.1167, 136.2)
    hyades = _object(66.75, 15.87, 47.0)
    sun = _object(0.0, 0.0, 0.0)
    onc = _object(83.8221, -5.3911, 414.0)
    other = _object(280.0, -60.0, 800.0)

    objects = [pleiades, hyades, sun, onc, other]
    results = derive_galactic_coordinates_batch(objects)

    assert len(results) == 5
    # Original order preserved: each result's stored ra_deg still matches
    # the input object at that same position (ra_deg is distinct per
    # object here, so this fingerprints position, not just count).
    for result, source in zip(results, objects):
        assert result.coordinates.ra_deg == source.coordinates.ra_deg
        assert result.coordinates.dec_deg == source.coordinates.dec_deg

    sun_result = results[2]
    assert sun_result.cartesian.x_pc == 0.0
    assert sun_result.cartesian.y_pc == 0.0
    assert sun_result.cartesian.z_pc == 0.0
    assert sun_result.coordinates.galactic_l_deg == 0.0
    assert sun_result.coordinates.galactic_b_deg == 0.0

    # Non-Sun objects got real vectorized-derived values (non-degenerate,
    # matching what the single-object function produces for the same
    # inputs).
    for idx, expected_src in [(0, pleiades), (1, hyades), (3, onc), (4, other)]:
        expected = derive_galactic_coordinates(expected_src)
        actual = results[idx]
        assert actual.cartesian.x_pc == pytest.approx(expected.cartesian.x_pc, abs=1e-9)
        assert actual.cartesian.y_pc == pytest.approx(expected.cartesian.y_pc, abs=1e-9)
        assert actual.cartesian.z_pc == pytest.approx(expected.cartesian.z_pc, abs=1e-9)
        distance = np.sqrt(
            actual.cartesian.x_pc**2 + actual.cartesian.y_pc**2 + actual.cartesian.z_pc**2
        )
        assert distance == pytest.approx(expected_src.distance.value_pc, abs=1e-6)
        assert distance > 0.0  # not degenerately at the origin like the Sun


def test_batch_large_synthetic_catalog_transforms_correctly_via_vectorized_path():
    """Sanity check at catalog scale (spec Idea.md §44 mentions "hundreds
    or thousands of objects"): a synthetic batch of 150 objects spanning
    the full RA/Dec range and a wide range of distances round-trips
    through the vectorized path with the same per-object correctness as
    the single-object function - not asserting a specific speedup, just
    correctness at scale."""
    rng = np.random.default_rng(seed=70)
    n = 150
    objects = [
        _object(
            ra_deg=float(rng.uniform(0.0, 359.999)),
            dec_deg=float(rng.uniform(-89.999, 89.999)),
            distance_pc=float(rng.uniform(0.1, 5000.0)),
        )
        for _ in range(n)
    ]

    batch_result = derive_galactic_coordinates_batch(objects)
    assert len(batch_result) == n

    for obj, batch_obj in zip(objects, batch_result):
        expected = derive_galactic_coordinates(obj)
        assert batch_obj.coordinates.galactic_l_deg == pytest.approx(
            expected.coordinates.galactic_l_deg, abs=1e-9
        )
        assert batch_obj.coordinates.galactic_b_deg == pytest.approx(
            expected.coordinates.galactic_b_deg, abs=1e-9
        )
        assert batch_obj.cartesian.x_pc == pytest.approx(expected.cartesian.x_pc, abs=1e-9)
        assert batch_obj.cartesian.y_pc == pytest.approx(expected.cartesian.y_pc, abs=1e-9)
        assert batch_obj.cartesian.z_pc == pytest.approx(expected.cartesian.z_pc, abs=1e-9)

        distance = np.sqrt(
            batch_obj.cartesian.x_pc**2
            + batch_obj.cartesian.y_pc**2
            + batch_obj.cartesian.z_pc**2
        )
        assert distance == pytest.approx(obj.distance.value_pc, abs=1e-6)


def test_batch_empty_list_returns_empty_list():
    assert derive_galactic_coordinates_batch([]) == []


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


# ---------------------------------------------------------------------------
# galactic_velocity_kms (Story #230, schema.py's Velocity)
# ---------------------------------------------------------------------------


class TestGalacticVelocityKms:
    def test_zero_proper_motion_and_radial_velocity_yields_zero_vector(self):
        # No motion in any of the three astrometric inputs -> the fixed
        # ICRS -> Galactic rotation of a zero vector is still zero. A basic
        # sanity check that the transform doesn't introduce any spurious
        # constant offset (e.g. accidentally including the Sun's own LSR
        # motion, which this Story's heliocentric convention must not).
        vx, vy, vz = galactic_velocity_kms(
            ra_deg=100.0,
            dec_deg=20.0,
            distance_pc=10.0,
            pmra_mas_yr=0.0,
            pmdec_mas_yr=0.0,
            radial_velocity_kms=0.0,
        )
        assert vx == pytest.approx(0.0, abs=1e-9)
        assert vy == pytest.approx(0.0, abs=1e-9)
        assert vz == pytest.approx(0.0, abs=1e-9)

    def test_barnards_star_matches_known_literature_space_velocity(self):
        # Real SIMBAD-shaped values for Barnard's Star (live-verified during
        # Story #230 development - see PR description). Known literature
        # total space velocity relative to the Sun is ~142 km/s (one of the
        # highest-proper-motion stars known) - this is the Story's own
        # documented sanity gate.
        ra_deg = 269.4520769586187
        dec_deg = 4.693364966576667
        plx_mas = 546.9759
        distance_pc = 1000.0 / plx_mas
        pmra = -801.551
        pmdec = 10362.394
        rv = -110.11

        vx, vy, vz = galactic_velocity_kms(
            ra_deg, dec_deg, distance_pc, pmra, pmdec, rv
        )
        magnitude = (vx**2 + vy**2 + vz**2) ** 0.5
        assert magnitude == pytest.approx(142.3, abs=1.0)

    def test_returns_plain_python_floats(self):
        # Not numpy/astropy Quantity scalars - schema.Velocity's fields are
        # plain `float`, and the caller (simbad.py's _derive_velocity)
        # relies on this to construct it directly.
        vx, vy, vz = galactic_velocity_kms(
            ra_deg=10.0,
            dec_deg=10.0,
            distance_pc=10.0,
            pmra_mas_yr=100.0,
            pmdec_mas_yr=-50.0,
            radial_velocity_kms=5.0,
        )
        assert isinstance(vx, float)
        assert isinstance(vy, float)
        assert isinstance(vz, float)
