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
    ra_deg: float
    dec_deg: float
    galactic_l_deg: float
    galactic_b_deg: float


class Distance(BaseModel):
    value_pc: float
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
