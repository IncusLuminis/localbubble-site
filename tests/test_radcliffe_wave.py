"""Tests for the Radcliffe Wave model layer (spec Idea.md §17, issue #61):
models/radcliffe_wave.csv loads and validates, required provenance is
present, s_pc is monotonically increasing, coordinates are sane and
cross-check against the raw source file, and the model layer explicitly
marks itself as the fitted/interpolated curve rather than observed cloud
positions.
"""

import csv
import math
from pathlib import Path

import pytest
from pydantic import ValidationError

from local_galactic_structures.radcliffe_wave import (
    RADCLIFFE_WAVE_REPRESENTATIONS,
    RadcliffeWaveModel,
    RadcliffeWavePoint,
    RadcliffeWaveSource,
    load_radcliffe_wave,
)

REPO_ROOT = Path(__file__).resolve().parent.parent
CSV_PATH = REPO_ROOT / "models" / "radcliffe_wave.csv"
RAW_PATH = (
    REPO_ROOT / "data" / "raw" / "Radcliffe_Wave_best_fit_model_Konietzka2024.tab"
)


def _minimal_points():
    return [
        RadcliffeWavePoint(s_pc=0.0, x_pc=-994.6, y_pc=-930.4, z_pc=0.2),
        RadcliffeWavePoint(s_pc=1.1, x_pc=-993.7, y_pc=-929.8, z_pc=-0.0),
        RadcliffeWavePoint(s_pc=2.3, x_pc=-992.9, y_pc=-929.1, z_pc=-0.3),
    ]


def _minimal_kwargs(**overrides):
    kwargs = dict(
        points=_minimal_points(),
        source=RadcliffeWaveSource(reference="Konietzka et al. (2024), Nature 626"),
    )
    kwargs.update(overrides)
    return kwargs


# --- raw source material -----------------------------------------------


def test_raw_source_file_exists():
    assert RAW_PATH.exists(), f"missing {RAW_PATH}"


def test_raw_source_file_has_expected_columns_and_row_count():
    with open(RAW_PATH, newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        assert reader.fieldnames == ["x", "y", "z", "vz"]
        rows = list(reader)
    assert len(rows) == 1500


# --- shipped derived CSV -------------------------------------------------


def test_shipped_csv_exists():
    assert CSV_PATH.exists(), f"missing {CSV_PATH}"


def test_shipped_csv_has_required_schema_columns():
    with open(CSV_PATH, newline="") as f:
        reader = csv.DictReader(f)
        assert reader.fieldnames == ["s_pc", "x_pc", "y_pc", "z_pc"]


def test_shipped_csv_loads_and_validates():
    model = load_radcliffe_wave(CSV_PATH)
    assert isinstance(model, RadcliffeWaveModel)
    assert model.model == "radcliffe_wave"


def test_shipped_csv_point_count_matches_raw_file():
    model = load_radcliffe_wave(CSV_PATH)
    assert len(model.points) == 1500


def test_shipped_csv_s_pc_starts_at_zero():
    model = load_radcliffe_wave(CSV_PATH)
    assert model.points[0].s_pc == 0.0


def test_shipped_csv_s_pc_is_monotonically_increasing():
    model = load_radcliffe_wave(CSV_PATH)
    s_values = [p.s_pc for p in model.points]
    assert all(b > a for a, b in zip(s_values, s_values[1:]))


def test_shipped_csv_total_arclength_matches_expected_wave_length():
    # The source paper describes the Radcliffe Wave as ~2.7 kpc long; the
    # cumulative arclength of the best-fit spine should land in that
    # ballpark (spec §17: representation must trace real published
    # positions, so this is a sanity check the derived s_pc is real
    # geometry, not an arbitrary/rescaled curve).
    model = load_radcliffe_wave(CSV_PATH)
    total_length = model.points[-1].s_pc
    assert 2000.0 < total_length < 3500.0


def test_shipped_csv_coordinates_match_raw_file_extent():
    # Cross-check x/y/z ranges in the derived CSV against the raw file's
    # own extent, so a unit or transcription error would be caught.
    with open(RAW_PATH, newline="") as f:
        reader = csv.DictReader(f, delimiter="\t")
        raw_rows = [
            (float(r["x"]), float(r["y"]), float(r["z"])) for r in reader
        ]
    raw_x = [r[0] for r in raw_rows]
    raw_y = [r[1] for r in raw_rows]
    raw_z = [r[2] for r in raw_rows]

    model = load_radcliffe_wave(CSV_PATH)
    x_values = [p.x_pc for p in model.points]
    y_values = [p.y_pc for p in model.points]
    z_values = [p.z_pc for p in model.points]

    assert min(x_values) == pytest.approx(min(raw_x), abs=1e-3)
    assert max(x_values) == pytest.approx(max(raw_x), abs=1e-3)
    assert min(y_values) == pytest.approx(min(raw_y), abs=1e-3)
    assert max(y_values) == pytest.approx(max(raw_y), abs=1e-3)
    assert min(z_values) == pytest.approx(min(raw_z), abs=1e-3)
    assert max(z_values) == pytest.approx(max(raw_z), abs=1e-3)


def test_shipped_csv_consecutive_step_distances_are_well_ordered():
    # A well-ordered spine (not scattered points) should have small,
    # roughly consistent consecutive-point step distances, not large
    # jumps consistent with a shuffled/corrupted file.
    model = load_radcliffe_wave(CSV_PATH)
    pts = model.points
    steps = [
        math.sqrt(
            (b.x_pc - a.x_pc) ** 2 + (b.y_pc - a.y_pc) ** 2 + (b.z_pc - a.z_pc) ** 2
        )
        for a, b in zip(pts, pts[1:])
    ]
    assert all(0.0 < step < 20.0 for step in steps)


def test_shipped_csv_coordinate_ranges_are_physically_sane():
    # spec §9: initial structures within ~800 pc of the Sun; the Wave
    # itself is ~2.7 kpc long so its own extent legitimately exceeds
    # that, but should stay within a sane few-kpc bound, not blow up to
    # unphysical values from a unit error (e.g. pc vs kpc).
    model = load_radcliffe_wave(CSV_PATH)
    for p in model.points:
        assert abs(p.x_pc) < 5000.0
        assert abs(p.y_pc) < 5000.0
        assert abs(p.z_pc) < 5000.0


# --- provenance ------------------------------------------------------------


def test_shipped_csv_source_has_nonempty_reference():
    model = load_radcliffe_wave(CSV_PATH)
    assert model.source.reference.strip() != ""


def test_shipped_csv_source_cites_literature():
    model = load_radcliffe_wave(CSV_PATH)
    reference = model.source.reference
    assert "Konietzka" in reference
    assert "2024" in reference
    assert "Nature" in reference


def test_shipped_csv_source_has_dataset_doi():
    model = load_radcliffe_wave(CSV_PATH)
    assert model.source.dataset_doi == "10.7910/DVN/F98QHY"


def test_shipped_csv_source_has_retrieval_date():
    model = load_radcliffe_wave(CSV_PATH)
    assert model.source.retrieved


# --- observed-vs-fitted distinction (spec §17 acceptance criteria) --------


def test_shipped_model_curve_type_is_fitted():
    model = load_radcliffe_wave(CSV_PATH)
    assert model.curve_type == "fitted"


def test_model_rejects_curve_type_other_than_fitted():
    with pytest.raises(ValidationError):
        RadcliffeWaveModel(**_minimal_kwargs(curve_type="observed"))


def test_shipped_model_notes_state_fitted_not_observed_distinction():
    model = load_radcliffe_wave(CSV_PATH)
    assert model.notes is not None
    notes_lower = model.notes.lower()
    assert "fitted" in notes_lower
    assert "not observed" in notes_lower or "not raw" in notes_lower


# --- toggleability and representation --------------------------------------


def test_shipped_model_is_enabled_and_toggleable():
    model = load_radcliffe_wave(CSV_PATH)
    assert isinstance(model.enabled, bool)
    assert model.enabled is True


def test_shipped_model_representation_is_a_known_kind():
    model = load_radcliffe_wave(CSV_PATH)
    assert model.representation in RADCLIFFE_WAVE_REPRESENTATIONS


def test_representation_choices_match_spec_options():
    # spec §17: "Preferred representation: 3D spline or 3D polyline."
    assert RADCLIFFE_WAVE_REPRESENTATIONS == {"polyline", "spline"}


def test_shipped_model_has_no_renderer_specific_fields():
    # spec §17/§45: model config must not mix in Three.js-specific
    # properties.
    model = load_radcliffe_wave(CSV_PATH)
    allowed_top_level = set(RadcliffeWaveModel.model_fields.keys())
    raw_keys = set(model.model_dump().keys())
    assert raw_keys <= allowed_top_level


# --- validation / error handling -------------------------------------------


def test_model_requires_source():
    kwargs = _minimal_kwargs()
    del kwargs["source"]
    with pytest.raises(ValidationError):
        RadcliffeWaveModel(**kwargs)


def test_source_requires_nonempty_reference():
    with pytest.raises(ValidationError):
        RadcliffeWaveSource(reference="")


def test_model_rejects_too_few_points():
    with pytest.raises(ValidationError):
        RadcliffeWaveModel(**_minimal_kwargs(points=[_minimal_points()[0]]))


def test_model_rejects_negative_s_pc():
    with pytest.raises(ValidationError):
        RadcliffeWavePoint(s_pc=-1.0, x_pc=0.0, y_pc=0.0, z_pc=0.0)


def test_model_rejects_unknown_representation():
    with pytest.raises(ValidationError):
        RadcliffeWaveModel(**_minimal_kwargs(representation="hand_drawn_sinusoid"))


def test_load_radcliffe_wave_raises_for_missing_file(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_radcliffe_wave(tmp_path / "does_not_exist.csv")


def test_model_defaults_enabled_true_and_curve_type_fitted():
    model = RadcliffeWaveModel(**_minimal_kwargs())
    assert model.enabled is True
    assert model.curve_type == "fitted"
    assert model.representation == "polyline"
