"""Gould Belt scientific model layer (spec Idea.md §16).

This module loads and validates `models/gould_belt.yaml` - a literature-
derived geometric approximation of the Gould Belt, kept as a separate
scientific model layer (spec §19: "scientific model", distinct from
measured or derived catalog data). Parameters are never hard-coded here;
they live entirely in the YAML config and are only validated by this
module.

Representation: annulus (a tilted elliptical ring). Perrot & Grenier
(2003) - the source cited in the shipped config - describe the Gould Belt
as "a broad elliptical ring of young stars and interstellar matter", not a
filled disk or solid volume, so an annulus (an elliptical ring swept
through `thickness_pc`) is the representation closest to what was actually
fitted. See the comments in `models/gould_belt.yaml` for the full
derivation of each parameter from the source paper.

This model config carries no renderer- or Three.js-specific fields (spec
§45) - only the geometric/scientific parameters a renderer would consume.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

#: Geometric representations spec §16 allows for the Gould Belt layer.
GOULD_BELT_REPRESENTATIONS = {"tilted_ellipse", "ellipsoid", "annulus"}


class GouldBeltCenter(BaseModel):
    """Heliocentric Galactic Cartesian center of the model, in parsecs
    (spec §6): Sun = (0, 0, 0); +X -> Galactic Center; +Y -> Galactic
    rotation direction; +Z -> North Galactic Pole."""

    x_pc: float
    y_pc: float
    z_pc: float


class GouldBeltSource(BaseModel):
    """Provenance for this model's parameters (spec §11 principle, applied
    to model layers per spec §16: "every model parameter set must
    reference the literature from which it was derived"). `reference` is
    required - no scientific value may appear without a traceable origin.
    """

    reference: str = Field(min_length=1)
    doi: str | None = None
    url: str | None = None
    notes: str | None = None


class GouldBeltModel(BaseModel):
    """Gould Belt scientific model layer (spec §16).

    Pure geometry/provenance - independently toggleable by a consumer and
    free of any renderer/Three.js-specific properties.
    """

    model: Literal["gould_belt"] = "gould_belt"
    representation: Literal["tilted_ellipse", "ellipsoid", "annulus"]
    center: GouldBeltCenter
    major_radius_pc: float = Field(gt=0.0)
    minor_radius_pc: float = Field(gt=0.0)
    inclination_deg: float = Field(ge=0.0, le=90.0)
    orientation_deg: float = Field(ge=0.0, lt=360.0)
    thickness_pc: float = Field(gt=0.0)
    source: GouldBeltSource


def load_gould_belt_model(path: str | Path) -> GouldBeltModel:
    """Load and validate the Gould Belt model config from a YAML file.

    Raises `pydantic.ValidationError` if required fields (including
    `source.reference`) are missing, or if any parameter fails its
    sanity-range validation (e.g. non-positive radii).
    """
    with open(path) as f:
        raw = yaml.safe_load(f)
    return GouldBeltModel.model_validate(raw)
