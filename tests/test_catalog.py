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


def test_sample_catalog_file_is_present_and_valid():
    repo_root = Path(__file__).resolve().parent.parent
    parquet_path = repo_root / "data" / "normalized" / "catalog.parquet"
    assert parquet_path.exists(), (
        "data/normalized/catalog.parquet is missing - run "
        "scripts/build_sample_catalog.py"
    )

    objects = load_catalog(parquet_path)
    assert len(objects) >= 1
    names = {obj.name for obj in objects}
    assert "Sun" in names

    sun = next(obj for obj in objects if obj.name == "Sun")
    assert sun.cartesian == Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0)

    for obj in objects:
        assert obj.source.reference, f"{obj.name} is missing source.reference"
