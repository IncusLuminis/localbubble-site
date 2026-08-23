"""Normalized astronomical object schema (spec Idea.md §7).

This is the common internal representation every data source adapter
(SIMBAD, Gaia, VizieR, literature - see data_sources/) must normalize into,
and the only shape the rest of the pipeline (coordinates, models, scene
export) depends on. Keep it free of any renderer- or Three.js-specific
fields (spec §45).
"""

from __future__ import annotations

from pydantic import BaseModel, Field

# Known object types (spec §8). This is a reference set for documentation
# and tooling, not an enum - the type system must stay extensible without
# core changes, so `AstronomicalObject.object_type` remains a plain string.
KNOWN_OBJECT_TYPES = {
    "star",
    "star_cluster",
    "stellar_association",
    "molecular_cloud",
    "star_forming_region",
    "hii_region",
    "supernova_remnant",
    "bubble",
    "reference_point",
}


class Coordinates(BaseModel):
    ra_deg: float = Field(ge=0.0, lt=360.0)
    dec_deg: float = Field(ge=-90.0, le=90.0)
    galactic_l_deg: float = Field(ge=0.0, lt=360.0)
    galactic_b_deg: float = Field(ge=-90.0, le=90.0)


class Distance(BaseModel):
    # 0 is a valid special case: the Sun/reference_point convention for the
    # coordinate-system origin (spec §6), not a measured zero distance.
    value_pc: float = Field(ge=0.0)
    error_pc: float | None = None


class Cartesian(BaseModel):
    """Heliocentric Galactic Cartesian position in parsecs (spec §6)."""

    x_pc: float
    y_pc: float
    z_pc: float


class Group(BaseModel):
    primary: str | None = None
    secondary: list[str] = Field(default_factory=list)


class Source(BaseModel):
    """Provenance for this record (spec §11). `reference` is required -
    no scientific value may appear without a traceable origin."""

    reference: str
    url: str | None = None
    catalog: str | None = None


class Visual(BaseModel):
    size_pc: float | None = None
    color_class: str | None = None
    #: Raw SIMBAD `sp_type` string (e.g. "G2V", "M5.5Ve"), stored verbatim -
    #: no normalization/bucketing into a fixed taxonomy (that is a later,
    #: frontend-side Story's job). This is a dedicated field rather than a
    #: reuse of `color_class` above: `color_class` reads as a *normalized*
    #: bucket a renderer would key a color ramp off of, which is exactly
    #: the not-yet-built frontend concern this field must NOT preempt: it
    #: stays unpopulated by this pipeline until that Story defines it.
    spectral_type: str | None = None
    #: Absolute V magnitude, derived via the standard distance modulus
    #: (M = m - 5*log10(d_pc) + 5) from SIMBAD's apparent V magnitude and
    #: this record's own `distance_pc` - see
    #: `data_sources.simbad.absolute_magnitude_from_distance_modulus`.
    #: `None` when SIMBAD has no usable V magnitude on file; never
    #: fabricated.
    absolute_magnitude: float | None = None


class AstronomicalObject(BaseModel):
    id: str
    name: str
    aliases: list[str] = Field(default_factory=list)
    object_type: str
    coordinates: Coordinates
    distance: Distance
    cartesian: Cartesian
    group: Group = Field(default_factory=Group)
    source: Source
    visual: Visual = Field(default_factory=Visual)
    notes: str | None = None
