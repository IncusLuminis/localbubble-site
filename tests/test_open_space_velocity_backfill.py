"""Validates the Story #307 velocity backfill (Epic #306): ~587 EXISTING
star records beyond the Local Bubble (`web/public/data/scene.json`'s
"open space" zone, up to ~1840pc) that previously all had `velocity: null`
now carry a real, SIMBAD-derived velocity where it resolves - reusing the
exact `SimbadResolver`/`_derive_velocity` pipeline Story #230/#286/#296
already built (`scripts/backfill_open_space_velocity.py`).

Unlike Epic #294's Local Bubble gap-fill (Story #295/#296), these are NOT
new records - Epic #306's own "important data-shape note" - so this
module's central regression guard (mirroring the spirit of Story #295/296's
own "no accidental field changes" tests, and PR #183's clean-venv/pyarrow
lesson cited alongside it) is BYTE-IDENTICAL comparison of a sample of
these records' position/distance/notes/group/aliases against a frozen
pre-backfill snapshot (`tests/fixtures/pre_open_space_velocity_backfill_sample.json`,
captured from `data/normalized/initial_catalog_records.json` at the commit
this Story branched from) - proving the merge only ever added a `velocity`
block and touched nothing else.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from local_galactic_structures.local_bubble import load_local_bubble_model

REPO_ROOT = Path(__file__).resolve().parent.parent
DEFAULT_LOCAL_BUBBLE_PATH = REPO_ROOT / "models" / "local_bubble.yaml"
SIMBAD_CACHE_DIR = REPO_ROOT / "data" / "raw" / "simbad"
UNRESOLVED_OUTPUT_PATH = SIMBAD_CACHE_DIR / "backfill_open_space_velocity_unresolved.json"
FAILURES_OUTPUT_PATH = SIMBAD_CACHE_DIR / "backfill_open_space_velocity_failures.json"
SAMPLE_SNAPSHOT_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "pre_open_space_velocity_backfill_sample.json"
)

#: Same implausibility threshold `data_sources/simbad.py`'s own
#: `_IMPLAUSIBLE_RV_KMS_THRESHOLD` uses, re-applied as a permanent
#: regression guard over each backfilled star's *total* derived space
#: velocity (mirrors Story #296's own `test_gap_fill_stars_carry_velocity`
#: implausible-speed scan).
IMPLAUSIBLE_SPEED_KMS_THRESHOLD = 500.0


def _open_space_radius_pc() -> float:
    """The Local Bubble's outer radius, pc - same live derivation
    `scripts/backfill_bubble_velocity.py`/`backfill_open_space_velocity.py`
    use (`models/local_bubble.yaml`'s `(a_pc + b_pc) / 2`), not hard-coded
    to 60, so this test tracks the real boundary the backfill script itself
    used even if the model file's semi-axes are ever retuned."""
    model = load_local_bubble_model(DEFAULT_LOCAL_BUBBLE_PATH)
    return (model.semi_axes_pc.a_pc + model.semi_axes_pc.b_pc) / 2.0


def _open_space_stars(catalog_objects):
    radius_pc = _open_space_radius_pc()
    return [
        obj
        for obj in catalog_objects
        if obj.object_type == "star" and obj.distance.value_pc > radius_pc
    ]


@pytest.fixture(scope="module")
def open_space_stars(catalog_objects):
    return _open_space_stars(catalog_objects)


@pytest.fixture(scope="module")
def sample_snapshot():
    return json.loads(SAMPLE_SNAPSHOT_PATH.read_text())


@pytest.fixture(scope="module")
def unresolved_ids():
    """Catalog ids Story #307's own acquisition script recorded as a
    genuine honest-failure (SIMBAD resolved the star but had no pmra/pmdec
    on file at all) - see that script's own module docstring for why this
    lives in a separate checked-in artifact rather than the record's own
    `notes` field."""
    if not UNRESOLVED_OUTPUT_PATH.exists():
        return set()
    entries = json.loads(UNRESOLVED_OUTPUT_PATH.read_text())
    return {entry["id"] for entry in entries}


# --------------------------------------------------------------------------
# Scope sanity
# --------------------------------------------------------------------------


def test_exactly_587_open_space_star_records_exist(open_space_stars):
    # Epic #306/#307's own pre-researched figure - re-derived live from the
    # current catalog (not trusted blindly), same convention Story #295's
    # own regression test uses for its "77" figure.
    assert len(open_space_stars) == 587


def test_open_space_boundary_is_60pc(catalog_objects):
    # Sanity-check the live-derived radius still matches the issue's own
    # stated ~60pc boundary, so a future change to models/local_bubble.yaml
    # that silently shifted this boundary would be caught here rather than
    # only showing up as a mysterious count drift in the test above.
    radius_pc = _open_space_radius_pc()
    assert radius_pc == pytest.approx(60.0, abs=0.5)


# --------------------------------------------------------------------------
# Velocity coverage
# --------------------------------------------------------------------------


def test_open_space_stars_have_velocity_populated_where_resolved(
    open_space_stars, unresolved_ids
):
    # Core Story #307 acceptance criterion: previously-null-velocity stars
    # beyond 60pc now carry a real velocity where SIMBAD resolves it. Any
    # star still missing velocity must be individually accounted for by the
    # acquisition script's own honest-failure record - a star silently
    # missing velocity with NO corresponding explanation would mean the
    # merge dropped it rather than genuinely failing to resolve it.
    still_missing = [obj.id for obj in open_space_stars if obj.velocity is None]
    unexplained = [oid for oid in still_missing if oid not in unresolved_ids]
    assert not unexplained, (
        "open-space star(s) missing velocity with no honest-failure "
        f"explanation on file: {unexplained}"
    )

    # Per the Epic's own pre-acquisition research (161-star stratified
    # SIMBAD sample, 100% full PM+RV coverage), genuine failures are
    # expected to be rare/near-zero - assert coverage is overwhelmingly
    # complete rather than hard-coding "587/587", so a legitimate rare
    # honest failure does not spuriously fail this test as long as it is
    # documented (checked above).
    resolved_fraction = 1 - (len(still_missing) / len(open_space_stars))
    assert resolved_fraction >= 0.95, (
        f"only {resolved_fraction:.1%} of open-space stars resolved a "
        "velocity - expected near-100% per Epic #306's own research sample"
    )


def test_no_open_space_star_has_an_implausible_derived_speed(open_space_stars):
    implausible = [
        (obj.id, (obj.velocity.vx_kms**2 + obj.velocity.vy_kms**2 + obj.velocity.vz_kms**2) ** 0.5)
        for obj in open_space_stars
        if obj.velocity is not None
        and (obj.velocity.vx_kms**2 + obj.velocity.vy_kms**2 + obj.velocity.vz_kms**2) ** 0.5
        > IMPLAUSIBLE_SPEED_KMS_THRESHOLD
    ]
    assert not implausible, f"implausible (>500 km/s) derived speed: {implausible}"


def test_local_bubble_stars_are_unaffected(catalog_objects):
    # This Story's scope is strictly the complement of Story #286/#296's
    # own <= radius_pc scope - a regression guard that this backfill did
    # not touch (or remove velocity from) any in-bubble star.
    radius_pc = _open_space_radius_pc()
    in_bubble_stars = [
        obj
        for obj in catalog_objects
        if obj.object_type == "star" and obj.distance.value_pc <= radius_pc
    ]
    without_velocity = [obj.id for obj in in_bubble_stars if obj.velocity is None]
    assert not without_velocity, (
        "in-bubble star(s) unexpectedly missing velocity - Story #307 must "
        f"only touch stars beyond the bubble: {without_velocity}"
    )


# --------------------------------------------------------------------------
# Byte-identical regression guard (unrelated fields untouched)
# --------------------------------------------------------------------------


def _find_by_id(catalog_objects, catalog_id):
    matches = [obj for obj in catalog_objects if obj.id == catalog_id]
    assert len(matches) == 1, f"expected exactly one record for {catalog_id!r}, found {len(matches)}"
    return matches[0]


def test_sample_records_position_distance_notes_group_aliases_are_byte_identical(
    catalog_objects, sample_snapshot
):
    for catalog_id, expected in sample_snapshot.items():
        obj = _find_by_id(catalog_objects, catalog_id)

        assert obj.name == expected["name"], f"{catalog_id}: name changed"
        assert obj.aliases == expected["aliases"], f"{catalog_id}: aliases changed"
        assert obj.notes == expected["notes"], f"{catalog_id}: notes changed"
        assert obj.group.primary == expected["group"]["primary"], f"{catalog_id}: group.primary changed"
        assert obj.group.secondary == expected["group"]["secondary"], f"{catalog_id}: group.secondary changed"

        assert obj.coordinates.ra_deg == pytest.approx(expected["coordinates"]["ra_deg"], abs=1e-9)
        assert obj.coordinates.dec_deg == pytest.approx(expected["coordinates"]["dec_deg"], abs=1e-9)
        assert obj.coordinates.galactic_l_deg == pytest.approx(
            expected["coordinates"]["galactic_l_deg"], abs=1e-9
        )
        assert obj.coordinates.galactic_b_deg == pytest.approx(
            expected["coordinates"]["galactic_b_deg"], abs=1e-9
        )

        assert obj.distance.value_pc == pytest.approx(expected["distance"]["value_pc"], abs=1e-9)
        if expected["distance"]["error_pc"] is None:
            assert obj.distance.error_pc is None
        else:
            assert obj.distance.error_pc == pytest.approx(expected["distance"]["error_pc"], abs=1e-9)

        assert obj.cartesian.x_pc == pytest.approx(expected["cartesian"]["x_pc"], abs=1e-9)
        assert obj.cartesian.y_pc == pytest.approx(expected["cartesian"]["y_pc"], abs=1e-9)
        assert obj.cartesian.z_pc == pytest.approx(expected["cartesian"]["z_pc"], abs=1e-9)


def test_sample_records_previously_had_no_velocity(sample_snapshot):
    # Sanity-check the fixture itself: every sampled record genuinely had
    # velocity: null BEFORE this Story ran, so the byte-identical check
    # above is comparing against a true pre-backfill snapshot, not one that
    # already happened to carry a velocity for some unrelated reason.
    for catalog_id, expected in sample_snapshot.items():
        assert expected["velocity_before"] is None, (
            f"{catalog_id}: fixture's own pre-backfill velocity is not "
            "null - snapshot does not represent the pre-Story #307 state"
        )


def test_sample_records_now_have_velocity_unless_honestly_unresolved(
    catalog_objects, sample_snapshot, unresolved_ids
):
    for catalog_id in sample_snapshot:
        obj = _find_by_id(catalog_objects, catalog_id)
        if catalog_id in unresolved_ids:
            continue
        assert obj.velocity is not None, (
            f"{catalog_id}: expected a backfilled velocity (not in the "
            "honest-failure unresolved list)"
        )


# --------------------------------------------------------------------------
# Spot checks (Story #307's own required hand-verification, re-asserted as
# permanent regression guards)
# --------------------------------------------------------------------------


def test_betelgeuse_has_sensible_velocity(catalog_objects):
    obj = _find_by_id(catalog_objects, "alf_ori")
    assert "Betelgeuse" in " ".join(obj.aliases) or "alf Ori" in obj.name
    assert obj.velocity is not None
    speed = (obj.velocity.vx_kms**2 + obj.velocity.vy_kms**2 + obj.velocity.vz_kms**2) ** 0.5
    # Betelgeuse's known peculiar velocity is of order a few tens of km/s -
    # generous bounds, not a re-assertion of SIMBAD's exact current value.
    assert 1.0 < speed < 200.0


def test_alpha_crucis_has_sensible_velocity(catalog_objects):
    obj = _find_by_id(catalog_objects, "alf_cru")
    assert "Acrux" in " ".join(obj.aliases)
    assert obj.velocity is not None
    speed = (obj.velocity.vx_kms**2 + obj.velocity.vy_kms**2 + obj.velocity.vz_kms**2) ** 0.5
    assert 1.0 < speed < 200.0


def test_tau_sco_implausible_rv_was_corrected_via_mesvelocities(catalog_objects):
    # The Epic's own flagged anomaly: tau Sco's default SIMBAD rvz_radvel
    # cross-match is an implausible ~-650 km/s, requiring
    # `_derive_velocity`'s established `mesVelocities` fallback (already
    # exercised/verified by Story #230's own issue #234 case) to resolve
    # to a plausible value instead of propagating the bad one.
    obj = _find_by_id(catalog_objects, "tau_sco")
    assert obj.velocity is not None
    speed = (obj.velocity.vx_kms**2 + obj.velocity.vy_kms**2 + obj.velocity.vz_kms**2) ** 0.5
    assert speed < IMPLAUSIBLE_SPEED_KMS_THRESHOLD, (
        f"tau Sco's implausible RV cross-match was not corrected: |v|={speed} km/s"
    )
    assert obj.velocity.radial_velocity_known is True
    assert "mesVelocities" in obj.velocity.source.reference or "corrected" in obj.velocity.source.reference.lower()
