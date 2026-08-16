"""Local Bubble structure-layer model (spec Idea.md §18, Story #62).

The Local Bubble is the cavity of hot, rarefied gas in the interstellar
medium that the Sun sits inside of. Per spec §18 it is implemented as an
optional, independently-toggleable structure layer, and for the MVP a
"simplified volume" representation is acceptable as long as it is backed
by a real, cited source (spec §11).

This module is deliberately config-driven, not hard-coded: the geometry
lives in `models/local_bubble.yaml`, and `LocalBubbleModel` here only
defines the shape of that config and validates it. The `representation`
field and this schema are generic across sphere/ellipsoid/mesh/
point_cloud so a later, more realistic 3D reconstruction (e.g. the
spherical-harmonic shell surfaces of Pelgrims et al. 2020, or Gaia-dust-
map-based reconstructions such as Lallement et al. 2019 or the "Local
Chimney" model of O'Neill et al. 2024) can replace today's simplified
volume without any changes to the renderer - it would only need to
recognize a new `representation` value and its associated fields.

Coordinates follow spec §6: heliocentric Galactic Cartesian, Sun at the
origin, +X toward the Galactic Center, +Y toward the direction of
Galactic rotation, +Z toward the North Galactic Pole, units parsecs -
the same convention as `schema.Cartesian`, which `center_pc` reuses.

Per spec §19, this whole model is a "scientific model" - a fitted
geometric approximation - not measured data, derived data, or visual
decoration; `LocalBubbleModel.data_classification` records that
explicitly.
"""

from __future__ import annotations

from pathlib import Path
from typing import Literal

import yaml
from pydantic import BaseModel, Field

from .schema import Cartesian

# Reference set of representation kinds spec §18 explicitly allows for
# the MVP simplified volume. Kept as a plain Literal (not extended with
# custom validation) since a future Story may add a fifth kind (e.g. a
# spherical-harmonic shell) without this module needing to change beyond
# adding it here.
RepresentationKind = Literal["sphere", "ellipsoid", "mesh", "point_cloud"]

DataClassification = Literal[
    "measured", "derived", "scientific_model", "visual_decoration"
]


class SemiAxes(BaseModel):
    """Semi-axis lengths of an ellipsoid (or, if all three are equal, a
    sphere), in parsecs. All must be strictly positive - a zero or
    negative semi-axis is not a valid volume."""

    a_pc: float = Field(gt=0.0)
    b_pc: float = Field(gt=0.0)
    c_pc: float = Field(gt=0.0)


class Orientation(BaseModel):
    """Orientation of the modeled volume's own axes. Fields are optional
    since not every `representation` kind (or every source paper) reports
    orientation the same way - this MVP's ellipsoid source reports both
    Euler angles and a directly-stated long-axis pointing direction, so
    both are kept rather than forcing a single convention."""

    theta_ell_deg: float | None = None
    psi_ell_deg: float | None = None
    phi_ell_deg: float | None = None
    long_axis_l_deg: float | None = Field(default=None, ge=0.0, lt=360.0)
    long_axis_b_deg: float | None = Field(default=None, ge=-90.0, le=90.0)


class Uncertainty(BaseModel):
    """Preserved fit uncertainties (spec §20). All fields are optional -
    source papers frequently fix/assume some parameters during a fit,
    leaving them with no associated uncertainty."""

    aspect_ratio_c_over_a: float | None = None
    aspect_ratio_c_over_a_error: float | None = None
    theta_ell_deg_error: float | None = None
    psi_ell_deg_error: float | None = None
    offset_fraction_of_semi_minor_axis: float | None = None


class LocalBubbleSource(BaseModel):
    """Provenance for this model (spec §11). `reference` is required and
    must be non-empty - no scientific value may appear without a
    traceable origin, mirroring `schema.Source`."""

    reference: str = Field(min_length=1)
    url: str | None = None
    catalog: str | None = None
    # This model's physical scale is anchored using an approximate figure
    # distinct from its precisely-fitted shape parameters (see
    # models/local_bubble.yaml for the full explanation) - kept as its
    # own field, rather than folded into `reference`, so the two
    # provenance trails stay separately traceable.
    secondary_reference: str | None = None


class LocalBubbleModel(BaseModel):
    """Local Bubble structure-layer config (spec §18), as loaded from
    `models/local_bubble.yaml`."""

    representation: RepresentationKind
    enabled: bool = True
    center_pc: Cartesian
    semi_axes_pc: SemiAxes
    orientation: Orientation = Field(default_factory=Orientation)
    uncertainty: Uncertainty = Field(default_factory=Uncertainty)
    data_classification: DataClassification = "scientific_model"
    source: LocalBubbleSource
    notes: str | None = None


def load_local_bubble_model(path: str | Path) -> LocalBubbleModel:
    """Load and validate the Local Bubble model config at `path` (YAML).

    Raises `pydantic.ValidationError` if the file is missing required
    fields or has values outside their allowed range (e.g. a non-positive
    semi-axis, or a missing/empty `source.reference`).
    """
    path = Path(path)
    with open(path) as f:
        raw = yaml.safe_load(f)
    return LocalBubbleModel(**raw)
