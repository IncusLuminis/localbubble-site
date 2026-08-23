"""Tests for `schema.py`'s `Visual.spectral_type`/`Visual.absolute_magnitude`
fields (Story #170 acceptance criteria: "schema fields' optionality").
"""

from __future__ import annotations

from local_galactic_structures.schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    ExoplanetSummary,
    PlanetSummary,
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


# ---------------------------------------------------------------------------
# PlanetSummary / ExoplanetSummary / AstronomicalObject.exoplanets (Story
# #171 acceptance criteria: "schema's optionality")
# ---------------------------------------------------------------------------


def _make_object_with_exoplanets(exoplanets: ExoplanetSummary | None) -> AstronomicalObject:
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
        exoplanets=exoplanets,
    )


class TestPlanetSummaryOptionality:
    def test_only_name_is_required(self):
        planet = PlanetSummary(name="GJ 876 b")
        assert planet.orbital_period_days is None
        assert planet.minimum_mass_earth is None
        assert planet.radius_earth is None
        assert planet.discovery_method is None
        assert planet.discovery_year is None
        assert planet.discovery_facility is None

    def test_all_fields_can_be_populated(self):
        planet = PlanetSummary(
            name="GJ 876 b",
            orbital_period_days=61.1166,
            minimum_mass_earth=723.2235,
            radius_earth=13.3,
            discovery_method="Radial Velocity",
            discovery_year=1998,
            discovery_facility="Multiple Observatories",
        )
        assert planet.orbital_period_days == 61.1166
        assert planet.minimum_mass_earth == 723.2235
        assert planet.radius_earth == 13.3
        assert planet.discovery_method == "Radial Velocity"
        assert planet.discovery_year == 1998
        assert planet.discovery_facility == "Multiple Observatories"

    def test_radius_earth_can_be_null_for_non_transiting_planet(self):
        # pl_rade is null for RV-only (non-transiting) detections - a real,
        # common case, not a data error.
        planet = PlanetSummary(name="Proxima Cen b", radius_earth=None)
        assert planet.radius_earth is None


class TestExoplanetsOptionality:
    def test_astronomical_object_exoplanets_defaults_to_none(self):
        # The expected common case (~97% of the 707 star records): no
        # exoplanets on file must not require constructing anything.
        obj = _make_object_with_exoplanets(None)
        assert obj.exoplanets is None

    def test_exoplanets_can_be_populated_with_multiple_planets(self):
        summary = ExoplanetSummary(
            count=2,
            planets=[
                PlanetSummary(name="Proxima Cen b"),
                PlanetSummary(name="Proxima Cen d"),
            ],
            source_reference="NASA Exoplanet Archive, pscomppars",
            source_url="https://exoplanetarchive.ipac.caltech.edu",
        )
        obj = _make_object_with_exoplanets(summary)
        assert obj.exoplanets is not None
        assert obj.exoplanets.count == 2
        assert [p.name for p in obj.exoplanets.planets] == [
            "Proxima Cen b",
            "Proxima Cen d",
        ]

    def test_exoplanets_planets_defaults_to_empty_list(self):
        summary = ExoplanetSummary(
            count=0,
            source_reference="NASA Exoplanet Archive, pscomppars",
            source_url="https://exoplanetarchive.ipac.caltech.edu",
        )
        assert summary.planets == []

    def test_round_trips_through_model_dump_and_validate(self):
        summary = ExoplanetSummary(
            count=1,
            planets=[PlanetSummary(name="GJ 876 b", orbital_period_days=61.1166)],
            source_reference="NASA Exoplanet Archive, pscomppars",
            source_url="https://exoplanetarchive.ipac.caltech.edu",
        )
        obj = _make_object_with_exoplanets(summary)
        rebuilt = AstronomicalObject.model_validate(obj.model_dump())
        assert rebuilt.exoplanets is not None
        assert rebuilt.exoplanets.count == 1
        assert rebuilt.exoplanets.planets[0].name == "GJ 876 b"
        assert rebuilt.exoplanets.planets[0].orbital_period_days == 61.1166

    def test_default_astronomical_object_omits_exoplanets_key_free_construction(self):
        # exoplanets can be omitted entirely from the constructor call
        # (unlike visual/group, it has no default_factory - a plain `None`
        # default is enough since it is a whole-object optional field, not
        # a sub-model with its own always-present shape).
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
        )
        assert obj.exoplanets is None
