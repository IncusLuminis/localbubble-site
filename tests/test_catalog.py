from pathlib import Path

import pytest
from pydantic import ValidationError

from local_galactic_structures.catalog import (
    from_record,
    load_catalog,
    save_catalog,
    to_record,
)
from local_galactic_structures.schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    Group,
    Source,
    Visual,
)


def _sample_objects() -> list[AstronomicalObject]:
    return [
        AstronomicalObject(
            id="sun",
            name="Sun",
            object_type="reference_point",
            coordinates=Coordinates(
                ra_deg=0.0, dec_deg=0.0, galactic_l_deg=0.0, galactic_b_deg=0.0
            ),
            distance=Distance(value_pc=0.0, error_pc=0.0),
            cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
            source=Source(reference="Origin by definition"),
        ),
        AstronomicalObject(
            id="pleiades",
            name="Pleiades",
            aliases=["M45"],
            object_type="star_cluster",
            coordinates=Coordinates(
                ra_deg=56.75, dec_deg=24.1167, galactic_l_deg=166.57, galactic_b_deg=-23.52
            ),
            distance=Distance(value_pc=136.2, error_pc=1.2),
            cartesian=Cartesian(x_pc=-121.47, y_pc=29.0, z_pc=-54.36),
            group=Group(primary="Local Bubble", secondary=["Taurus-Auriga"]),
            source=Source(
                reference="Lodieu et al. 2019, A&A 628, A66",
                catalog="Gaia DR2",
                url="https://doi.org/10.1051/0004-6361/201935372",
            ),
            visual=Visual(size_pc=4.0, color_class="hot_blue"),
            notes="Sample.",
        ),
    ]


def test_schema_requires_source_reference():
    with pytest.raises(ValidationError):
        AstronomicalObject(
            id="x",
            name="X",
            object_type="star",
            coordinates=Coordinates(
                ra_deg=0.0, dec_deg=0.0, galactic_l_deg=0.0, galactic_b_deg=0.0
            ),
            distance=Distance(value_pc=10.0),
            cartesian=Cartesian(x_pc=10.0, y_pc=0.0, z_pc=0.0),
            source=Source(),  # missing required `reference`
        )


def test_object_type_is_not_restricted_to_known_set():
    # Type system must stay extensible without core changes (spec §8).
    obj = AstronomicalObject(
        id="future-object",
        name="Future Object",
        object_type="some_future_structure_type",
        coordinates=Coordinates(
            ra_deg=0.0, dec_deg=0.0, galactic_l_deg=0.0, galactic_b_deg=0.0
        ),
        distance=Distance(value_pc=100.0),
        cartesian=Cartesian(x_pc=100.0, y_pc=0.0, z_pc=0.0),
        source=Source(reference="hypothetical"),
    )
    assert obj.object_type == "some_future_structure_type"


@pytest.mark.parametrize(
    "field,value",
    [
        ("ra_deg", -0.1),
        ("ra_deg", 360.0),
        ("dec_deg", -90.1),
        ("dec_deg", 90.1),
        ("galactic_l_deg", -0.1),
        ("galactic_l_deg", 360.0),
        ("galactic_b_deg", -90.1),
        ("galactic_b_deg", 90.1),
    ],
)
def test_coordinates_reject_out_of_range_values(field, value):
    kwargs = {
        "ra_deg": 10.0,
        "dec_deg": 10.0,
        "galactic_l_deg": 10.0,
        "galactic_b_deg": 10.0,
    }
    kwargs[field] = value
    with pytest.raises(ValidationError):
        Coordinates(**kwargs)


@pytest.mark.parametrize(
    "field,value",
    [
        ("ra_deg", 0.0),
        ("ra_deg", 359.9),
        ("dec_deg", -90.0),
        ("dec_deg", 90.0),
        ("galactic_l_deg", 0.0),
        ("galactic_b_deg", -90.0),
        ("galactic_b_deg", 90.0),
    ],
)
def test_coordinates_accept_boundary_values(field, value):
    kwargs = {
        "ra_deg": 10.0,
        "dec_deg": 10.0,
        "galactic_l_deg": 10.0,
        "galactic_b_deg": 10.0,
    }
    kwargs[field] = value
    Coordinates(**kwargs)  # does not raise


def test_distance_rejects_negative_value():
    with pytest.raises(ValidationError):
        Distance(value_pc=-1.0)


def test_distance_allows_zero_for_sun_convention():
    Distance(value_pc=0.0)  # does not raise


def test_save_catalog_rejects_duplicate_ids(tmp_path: Path):
    objects = _sample_objects()
    duplicate = objects[0].model_copy(update={"name": "Sun (duplicate)"})
    with pytest.raises(ValueError, match="Duplicate object id"):
        save_catalog([*objects, duplicate], tmp_path / "catalog.parquet")


def test_record_round_trip_preserves_all_fields():
    for obj in _sample_objects():
        rebuilt = from_record(to_record(obj))
        assert rebuilt == obj


def test_save_and_load_catalog_round_trip(tmp_path: Path):
    objects = _sample_objects()
    parquet_path = tmp_path / "catalog.parquet"
    csv_path = tmp_path / "catalog.csv"

    save_catalog(objects, parquet_path, csv_path)

    assert parquet_path.exists()
    assert csv_path.exists()

    loaded = load_catalog(parquet_path)
    assert loaded == objects


def test_csv_column_order_matches_to_record_output(tmp_path: Path):
    # Column order must come from to_record()'s own keys (single source of
    # truth), not a separately hand-maintained list that can drift.
    objects = _sample_objects()
    csv_path = tmp_path / "catalog.csv"
    save_catalog(objects, tmp_path / "catalog.parquet", csv_path)

    with open(csv_path) as f:
        header = f.readline().strip().split(",")

    assert header == list(to_record(objects[0]).keys())


def test_initial_catalog_file_is_present():
    # Content-level checks (>=20 objects, full seed-list coverage, Sun at
    # the origin, every object sourced, ...) live in test_initial_catalog.py
    # - this just confirms the file scripts/build_initial_catalog.py
    # produces is actually there and loadable.
    repo_root = Path(__file__).resolve().parent.parent
    parquet_path = repo_root / "data" / "normalized" / "catalog.parquet"
    assert parquet_path.exists(), (
        "data/normalized/catalog.parquet is missing - run "
        "scripts/build_initial_catalog.py"
    )
    assert len(load_catalog(parquet_path)) >= 1
