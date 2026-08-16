"""Tests for the Local Bubble structure-layer model (spec Idea.md §18,
Story #62): models/local_bubble.yaml loads and validates, required
provenance is present, and the geometry is physically sane.
"""

import math
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from local_galactic_structures.local_bubble import (
    LocalBubbleModel,
    LocalBubbleSource,
    Orientation,
    SemiAxes,
    Uncertainty,
    load_local_bubble_model,
)
from local_galactic_structures.schema import Cartesian

REPO_ROOT = Path(__file__).resolve().parent.parent
MODEL_PATH = REPO_ROOT / "models" / "local_bubble.yaml"

# Sun sits inside the Local Bubble, whose overall extent (per the
# published sources this Story surveyed) is on the order of a few
# hundred parsecs at most. An offset of the ellipsoid center from the
# Sun by more than this is not physically sane for something the Sun is
# supposed to sit inside of.
MAX_SANE_CENTER_OFFSET_PC = 300.0


def _minimal_kwargs(**overrides):
    kwargs = dict(
        representation="ellipsoid",
        center_pc=Cartesian(x_pc=10.0, y_pc=30.0, z_pc=0.0),
        semi_axes_pc=SemiAxes(a_pc=60.0, b_pc=60.0, c_pc=162.0),
        source=LocalBubbleSource(reference="Unit test fixture"),
    )
    kwargs.update(overrides)
    return kwargs


def test_model_file_exists():
    assert MODEL_PATH.exists(), (
        "models/local_bubble.yaml is missing - Story #62 must ship the "
        "config file or explicitly flag the model as unavailable"
    )


def test_model_file_loads_and_validates():
    model = load_local_bubble_model(MODEL_PATH)
    assert isinstance(model, LocalBubbleModel)


def test_model_file_is_enabled_and_toggleable():
    model = load_local_bubble_model(MODEL_PATH)
    # `enabled` must exist as a plain bool so the layer can be
    # independently toggled (acceptance criterion: "independently
    # toggleable") without touching the geometry fields.
    assert isinstance(model.enabled, bool)


def test_model_file_representation_is_a_known_mvp_kind():
    model = load_local_bubble_model(MODEL_PATH)
    assert model.representation in {"sphere", "ellipsoid", "mesh", "point_cloud"}


def test_model_file_has_nonempty_source_reference():
    model = load_local_bubble_model(MODEL_PATH)
    assert model.source.reference
    assert model.source.reference.strip() != ""


def test_model_file_data_classification_is_scientific_model():
    # spec §19: a fitted geometric approximation is a scientific model,
    # not measured data, derived data, or visual decoration.
    model = load_local_bubble_model(MODEL_PATH)
    assert model.data_classification == "scientific_model"


def test_model_file_semi_axes_are_positive():
    model = load_local_bubble_model(MODEL_PATH)
    assert model.semi_axes_pc.a_pc > 0
    assert model.semi_axes_pc.b_pc > 0
    assert model.semi_axes_pc.c_pc > 0


def test_model_file_center_is_offset_from_sun_but_physically_sane():
    # The Local Bubble is explicitly NOT centered on the Sun (spec §18
    # research finding) - the offset should be nonzero...
    model = load_local_bubble_model(MODEL_PATH)
    center = model.center_pc
    offset = math.sqrt(center.x_pc**2 + center.y_pc**2 + center.z_pc**2)
    assert offset > 0.0
    # ...but small compared to the Bubble's own size, since the Sun sits
    # inside the cavity rather than far outside it.
    assert offset < MAX_SANE_CENTER_OFFSET_PC
    assert offset < max(
        model.semi_axes_pc.a_pc, model.semi_axes_pc.b_pc, model.semi_axes_pc.c_pc
    )


def test_model_file_matches_raw_yaml_values():
    # Cross-check the validated model against the raw YAML so a future
    # accidental edit to one but not the other is caught.
    with open(MODEL_PATH) as f:
        raw = yaml.safe_load(f)
    model = load_local_bubble_model(MODEL_PATH)

    assert model.representation == raw["representation"]
    assert model.enabled == raw["enabled"]
    assert model.center_pc.x_pc == raw["center_pc"]["x_pc"]
    assert model.center_pc.y_pc == raw["center_pc"]["y_pc"]
    assert model.center_pc.z_pc == raw["center_pc"]["z_pc"]
    assert model.semi_axes_pc.a_pc == raw["semi_axes_pc"]["a_pc"]
    assert model.semi_axes_pc.b_pc == raw["semi_axes_pc"]["b_pc"]
    assert model.semi_axes_pc.c_pc == raw["semi_axes_pc"]["c_pc"]
    assert model.source.reference.strip() == raw["source"]["reference"].strip()


def test_source_requires_nonempty_reference():
    with pytest.raises(ValidationError):
        LocalBubbleSource()  # missing required `reference`

    with pytest.raises(ValidationError):
        LocalBubbleSource(reference="")  # empty is not a traceable origin


def test_semi_axes_reject_non_positive_values():
    with pytest.raises(ValidationError):
        SemiAxes(a_pc=0.0, b_pc=60.0, c_pc=162.0)

    with pytest.raises(ValidationError):
        SemiAxes(a_pc=60.0, b_pc=-10.0, c_pc=162.0)


def test_model_requires_source():
    with pytest.raises(ValidationError):
        LocalBubbleModel(
            representation="ellipsoid",
            center_pc=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
            semi_axes_pc=SemiAxes(a_pc=60.0, b_pc=60.0, c_pc=162.0),
        )


def test_model_rejects_unknown_representation_kind():
    with pytest.raises(ValidationError):
        LocalBubbleModel(**_minimal_kwargs(representation="wireframe_donut"))


def test_model_defaults_enabled_true_and_classification_scientific_model():
    model = LocalBubbleModel(**_minimal_kwargs())
    assert model.enabled is True
    assert model.data_classification == "scientific_model"


def test_model_accepts_sphere_representation_with_equal_semi_axes():
    # Architecture must allow a plain sphere (spec §18 lists it as a
    # valid MVP representation kind alongside ellipsoid/mesh/point_cloud).
    model = LocalBubbleModel(
        **_minimal_kwargs(
            representation="sphere",
            semi_axes_pc=SemiAxes(a_pc=75.0, b_pc=75.0, c_pc=75.0),
        )
    )
    assert model.representation == "sphere"
    assert model.semi_axes_pc.a_pc == model.semi_axes_pc.b_pc == model.semi_axes_pc.c_pc


def test_orientation_and_uncertainty_default_to_all_none():
    # Orientation/uncertainty fields are optional (spec §20: preserving
    # uncertainty metadata is required only "where available").
    model = LocalBubbleModel(**_minimal_kwargs())
    assert model.orientation == Orientation()
    assert model.uncertainty == Uncertainty()


def test_load_local_bubble_model_raises_for_missing_file(tmp_path: Path):
    with pytest.raises(FileNotFoundError):
        load_local_bubble_model(tmp_path / "does_not_exist.yaml")
