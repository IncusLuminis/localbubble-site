"""Tests for `schema.py`'s `Visual.spectral_type`/`Visual.absolute_magnitude`
fields (Story #170 acceptance criteria: "schema fields' optionality").
"""

from __future__ import annotations

import pytest
from pydantic import ValidationError

from local_galactic_structures.schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    ExoplanetSummary,
    PlanetSummary,
    Source,
    Velocity,
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
        assert planet.semi_major_axis_au is None
        assert planet.orbital_eccentricity is None
        assert planet.discovery_method is None
        assert planet.discovery_year is None
        assert planet.discovery_facility is None

    def test_all_fields_can_be_populated(self):
        planet = PlanetSummary(
            name="GJ 876 b",
            orbital_period_days=61.1166,
            minimum_mass_earth=723.2235,
            radius_earth=13.3,
            semi_major_axis_au=0.2083,
            orbital_eccentricity=0.0324,
            discovery_method="Radial Velocity",
            discovery_year=1998,
            discovery_facility="Multiple Observatories",
        )
        assert planet.orbital_period_days == 61.1166
        assert planet.minimum_mass_earth == 723.2235
        assert planet.radius_earth == 13.3
        assert planet.semi_major_axis_au == 0.2083
        assert planet.orbital_eccentricity == 0.0324
        assert planet.discovery_method == "Radial Velocity"
        assert planet.discovery_year == 1998
        assert planet.discovery_facility == "Multiple Observatories"

    def test_radius_earth_can_be_null_for_non_transiting_planet(self):
        # pl_rade is null for RV-only (non-transiting) detections - a real,
        # common case, not a data error.
        planet = PlanetSummary(name="Proxima Cen b", radius_earth=None)
        assert planet.radius_earth is None

    def test_semi_major_axis_and_eccentricity_can_be_null(self):
        # Story #181: some older RV-only discoveries lack a
        # well-constrained pl_orbsmax/pl_orbeccen - null, never fabricated.
        planet = PlanetSummary(
            name="Some Old RV Planet b",
            semi_major_axis_au=None,
            orbital_eccentricity=None,
        )
        assert planet.semi_major_axis_au is None
        assert planet.orbital_eccentricity is None

    def test_semi_major_axis_and_eccentricity_round_trip(self):
        # Story #181: verified live values for GJ 876 c.
        planet = PlanetSummary(
            name="GJ 876 c",
            semi_major_axis_au=0.12959,
            orbital_eccentricity=0.25591,
        )
        assert planet.semi_major_axis_au == 0.12959
        assert planet.orbital_eccentricity == 0.25591


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


# ---------------------------------------------------------------------------
# Velocity / AstronomicalObject.velocity (Story #230 acceptance criteria:
# "schema fields' optionality")
# ---------------------------------------------------------------------------


def _make_object_with_velocity(velocity: Velocity | None) -> AstronomicalObject:
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
        velocity=velocity,
    )


class TestVelocityOptionality:
    def test_astronomical_object_velocity_defaults_to_none(self):
        # The common case for everything outside the ~127-star in-sphere
        # set this Story scoped fetching to.
        obj = _make_object_with_velocity(None)
        assert obj.velocity is None

    def test_velocity_is_not_nested_under_visual(self):
        # Story #230 acceptance criteria: velocity is a top-level field,
        # mirroring exoplanets' own precedent (physical/kinematic data, not
        # a rendering style) - NOT a Visual attribute.
        assert "velocity" not in Visual.model_fields
        assert "velocity" in AstronomicalObject.model_fields

    def test_full_3d_velocity_can_be_populated(self):
        velocity = Velocity(
            vx_kms=-140.95,
            vy_kms=5.14,
            vz_kms=18.56,
            radial_velocity_known=True,
            source=Source(reference="SIMBAD astronomical database (CDS)"),
        )
        obj = _make_object_with_velocity(velocity)
        assert obj.velocity is not None
        assert obj.velocity.vx_kms == -140.95
        assert obj.velocity.vy_kms == 5.14
        assert obj.velocity.vz_kms == 18.56
        assert obj.velocity.radial_velocity_known is True

    def test_tangential_only_velocity_sets_radial_velocity_known_false(self):
        # Story #230: when SIMBAD had pmra/pmdec but no rvz_radvel, the
        # vector is tangential-only (radial velocity defaulted to 0 by
        # astropy) and must be flagged, never silently presented as a
        # complete 3D space velocity.
        velocity = Velocity(
            vx_kms=1.0,
            vy_kms=2.0,
            vz_kms=3.0,
            radial_velocity_known=False,
            source=Source(reference="SIMBAD astronomical database (CDS)"),
        )
        obj = _make_object_with_velocity(velocity)
        assert obj.velocity.radial_velocity_known is False

    def test_velocity_requires_its_own_source_reference(self):
        # spec §11: no scientific value may appear without a traceable
        # origin - Velocity.source is its own provenance block (may differ
        # from the object's own position/distance source.reference).
        with pytest.raises(ValidationError):
            Velocity(
                vx_kms=1.0,
                vy_kms=2.0,
                vz_kms=3.0,
                radial_velocity_known=True,
                source=Source(),  # missing required `reference`
            )

    def test_round_trips_through_model_dump_and_validate(self):
        velocity = Velocity(
            vx_kms=-28.31,
            vy_kms=0.67,
            vz_kms=13.74,
            radial_velocity_known=True,
            source=Source(
                reference="SIMBAD astronomical database (CDS), record GJ 551"
            ),
        )
        obj = _make_object_with_velocity(velocity)
        rebuilt = AstronomicalObject.model_validate(obj.model_dump())
        assert rebuilt.velocity is not None
        assert rebuilt.velocity.vx_kms == -28.31
        assert rebuilt.velocity.radial_velocity_known is True
        assert rebuilt.velocity.source.reference == velocity.source.reference

    def test_default_astronomical_object_omits_velocity_key_free_construction(self):
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
        assert obj.velocity is None
