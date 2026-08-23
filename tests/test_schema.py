"""Tests for `schema.py`'s `Visual.spectral_type`/`Visual.absolute_magnitude`
fields (Story #170 acceptance criteria: "schema fields' optionality").
"""

from __future__ import annotations

from local_galactic_structures.schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    Source,
    Visual,
)


def _make_object(visual: Visual) -> AstronomicalObject:
    return AstronomicalObject(
        id="x",
        name="X",
        object_type="star",
        coordinates=Coordinates(
            ra_deg=10.0, dec_deg=10.0, galactic_l_deg=0.0, galactic_b_deg=0.0
        ),
        distance=Distance(value_pc=10.0),
        cartesian=Cartesian(x_pc=10.0, y_pc=0.0, z_pc=0.0),
        source=Source(reference="Unit test fixture"),
        visual=visual,
    )


class TestVisualOptionality:
    def test_spectral_type_and_absolute_magnitude_default_to_none(self):
        # A bare Visual() (e.g. a non-SIMBAD-sourced object, or the default
        # factory `AstronomicalObject.visual` uses) must not require either
        # new field.
        visual = Visual()
        assert visual.spectral_type is None
        assert visual.absolute_magnitude is None

    def test_default_visual_factory_leaves_new_fields_null(self):
        obj = AstronomicalObject(
            id="y",
            name="Y",
            object_type="molecular_cloud",
            coordinates=Coordinates(
                ra_deg=0.0, dec_deg=0.0, galactic_l_deg=0.0, galactic_b_deg=0.0
            ),
            distance=Distance(value_pc=50.0),
            cartesian=Cartesian(x_pc=50.0, y_pc=0.0, z_pc=0.0),
            source=Source(reference="Unit test fixture"),
            # visual omitted entirely -> default_factory=Visual
        )
        assert obj.visual.spectral_type is None
        assert obj.visual.absolute_magnitude is None

    def test_both_fields_can_be_populated_independently(self):
        obj = _make_object(Visual(spectral_type="M5.5Ve"))
        assert obj.visual.spectral_type == "M5.5Ve"
        assert obj.visual.absolute_magnitude is None

        obj2 = _make_object(Visual(absolute_magnitude=12.3))
        assert obj2.visual.spectral_type is None
        assert obj2.visual.absolute_magnitude == 12.3

    def test_both_fields_can_be_populated_together(self):
        obj = _make_object(Visual(spectral_type="G2V", absolute_magnitude=4.83))
        assert obj.visual.spectral_type == "G2V"
        assert obj.visual.absolute_magnitude == 4.83

    def test_round_trips_through_model_dump_and_validate(self):
        obj = _make_object(Visual(spectral_type="K3V", absolute_magnitude=6.5))
        dumped = obj.model_dump()
        rebuilt = AstronomicalObject.model_validate(dumped)
        assert rebuilt.visual.spectral_type == "K3V"
        assert rebuilt.visual.absolute_magnitude == 6.5

    def test_color_class_and_spectral_type_are_independent_fields(self):
        # Story #170 deliberately keeps color_class (a future, normalized/
        # bucketed frontend concern) and spectral_type (the raw SIMBAD
        # string) as two distinct, independently-settable fields rather
        # than reusing one for the other.
        obj = _make_object(Visual(color_class="hot_blue", spectral_type="B2V"))
        assert obj.visual.color_class == "hot_blue"
        assert obj.visual.spectral_type == "B2V"
