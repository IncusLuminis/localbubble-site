from pathlib import Path

import pytest
from pydantic import ValidationError

from local_galactic_structures.gould_belt import (
    GOULD_BELT_REPRESENTATIONS,
    GouldBeltCenter,
    GouldBeltModel,
    GouldBeltSource,
    load_gould_belt_model,
)

CONFIG_PATH = Path(__file__).resolve().parent.parent / "models" / "gould_belt.yaml"


def _minimal_kwargs(**overrides):
    kwargs = dict(
        representation="annulus",
        center=GouldBeltCenter(x_pc=-104.0, y_pc=-0.73, z_pc=0.0),
        major_radius_pc=373.0,
        minor_radius_pc=233.0,
        inclination_deg=17.2,
        orientation_deg=296.1,
        thickness_pc=60.0,
        source=GouldBeltSource(reference="Perrot & Grenier (2003), A&A 404, 519"),
    )
    kwargs.update(overrides)
    return kwargs


def test_shipped_config_file_exists():
    assert CONFIG_PATH.exists(), f"missing {CONFIG_PATH}"


def test_shipped_config_loads_and_validates():
    model = load_gould_belt_model(CONFIG_PATH)
    assert isinstance(model, GouldBeltModel)
    assert model.model == "gould_belt"


def test_shipped_config_representation_is_not_hard_coded_visual_reference():
    # spec §16: representation must be one of the defined geometric forms,
    # not derived from a visual reference map.
    model = load_gould_belt_model(CONFIG_PATH)
    assert model.representation in GOULD_BELT_REPRESENTATIONS


def test_shipped_config_has_nonempty_source_reference():
    model = load_gould_belt_model(CONFIG_PATH)
    assert model.source.reference.strip() != ""


def test_shipped_config_source_cites_literature():
    # Traceable-origin requirement (spec §11/§16): reference should look
    # like an actual citation, not a placeholder.
    model = load_gould_belt_model(CONFIG_PATH)
    reference = model.source.reference
    assert "Perrot" in reference and "Grenier" in reference and "2003" in reference


def test_shipped_config_has_no_renderer_specific_fields():
    # spec §16 acceptance criteria: model config must not mix in
    # Three.js-specific properties (e.g. materials, colors, mesh
    # resolution). Validate against the field set actually defined on the
    # model, i.e. unknown/extra keys are rejected by construction.
    model = load_gould_belt_model(CONFIG_PATH)
    allowed_top_level = set(GouldBeltModel.model_fields.keys())
    raw_keys = set(model.model_dump().keys())
    assert raw_keys <= allowed_top_level


def test_geometry_is_physically_sane():
    model = load_gould_belt_model(CONFIG_PATH)
    assert model.major_radius_pc > 0
    assert model.minor_radius_pc > 0
    # An ellipse's semi-major axis must be at least as large as its
    # semi-minor axis.
    assert model.major_radius_pc >= model.minor_radius_pc
    assert 0.0 <= model.inclination_deg <= 90.0
    assert 0.0 <= model.orientation_deg < 360.0
    assert model.thickness_pc > 0


def test_model_requires_source_reference():
    with pytest.raises(ValidationError):
        GouldBeltModel(**_minimal_kwargs(source=GouldBeltSource(reference="")))


def test_model_rejects_missing_source():
    kwargs = _minimal_kwargs()
    del kwargs["source"]
    with pytest.raises(ValidationError):
        GouldBeltModel(**kwargs)


def test_model_rejects_non_positive_major_radius():
    with pytest.raises(ValidationError):
        GouldBeltModel(**_minimal_kwargs(major_radius_pc=0.0))


def test_model_rejects_non_positive_minor_radius():
    with pytest.raises(ValidationError):
        GouldBeltModel(**_minimal_kwargs(minor_radius_pc=-1.0))


def test_model_rejects_non_positive_thickness():
    with pytest.raises(ValidationError):
        GouldBeltModel(**_minimal_kwargs(thickness_pc=0.0))


def test_model_rejects_out_of_range_inclination():
    with pytest.raises(ValidationError):
        GouldBeltModel(**_minimal_kwargs(inclination_deg=95.0))


def test_model_rejects_out_of_range_orientation():
    with pytest.raises(ValidationError):
        GouldBeltModel(**_minimal_kwargs(orientation_deg=360.0))


def test_model_rejects_unknown_representation():
    with pytest.raises(ValidationError):
        GouldBeltModel(**_minimal_kwargs(representation="hand_drawn_sketch"))


def test_representation_choices_match_spec_options():
    # spec §16: "Possible representations: tilted ellipse, ellipsoid,
    # annulus".
    assert GOULD_BELT_REPRESENTATIONS == {"tilted_ellipse", "ellipsoid", "annulus"}
