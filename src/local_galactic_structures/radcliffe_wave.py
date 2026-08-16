"""Radcliffe Wave scientific model layer (spec Idea.md §17).

This module loads and validates `models/radcliffe_wave.csv` - a 3D
polyline tracing the Radcliffe Wave's best-fit spine, kept as its own
scientific model layer (spec §19: "scientific model", distinct from
measured catalog data and from the individual labeled cloud/cluster
objects the wave passes near).

Source and representation (spec §17 acceptance criteria)
----------------------------------------------------------
Per spec §17, the preferred sources for this layer are, in order:
(1) published XYZ positions of associated clouds, (2) a published
parametric model, or (3) a spline fitted to published observational
positions - explicitly NOT an arbitrary hand-drawn sinusoid.

The points loaded here come from Konietzka, K. K., Goodman, A. A.,
Zucker, C., Burkert, A., Alves, J., Foley, M., Swiggum, C., Koller, M.
& Miret-Roig, N. (2024), "The Radcliffe Wave is oscillating", Nature,
626, 63-68, https://doi.org/10.1038/s41586-024-07127-3, arXiv:2402.12596.
Specifically, the paper's own published best-fit model spine, retrieved
from its Harvard Dataverse dataset (DOI 10.7910/DVN/F98QHY, file
`Radcliffe_Wave_best_fit_model_Konietzka2024.tab`, CC0-licensed),
retrieved 2026-08-16. That file is kept unmodified in
`data/raw/Radcliffe_Wave_best_fit_model_Konietzka2024.tab` (spec §13:
raw data is never modified in place); `models/radcliffe_wave.csv` is
the derived polyline (spec §17 schema: `s_pc, x_pc, y_pc, z_pc`), with
`s_pc` computed here as cumulative 3D arclength along the file's own
point ordering, starting at 0 pc at the Wave's first tabulated point
(near CMa OB1, per the paper's Methods section, "Modeling the Spatial
Molecular Cloud Distribution").

Coordinate convention: the source paper states its `x, y, z` columns
are "Heliocentric Galactic Cartesian coordinates" (Methods, "Full
Spatial and Kinematic Model"), the same convention as spec §6 - Sun at
the origin, +X toward the Galactic Center, +Y toward the direction of
Galactic rotation, +Z toward the North Galactic Pole, units parsecs -
and the same convention `schema.Cartesian` and `coordinates.py` use
elsewhere in this repo. As an independent sanity check (beyond taking
the paper's stated convention at face value): converting the Orion
Molecular Cloud Complex's well-known approximate Galactic coordinates
(l ~ 209 deg, b ~ -19 deg, d ~ 400 pc) into this same XYZ convention
lands within ~54 pc of the nearest point on the loaded wave spine,
consistent with Orion being one of the major star-forming regions the
Wave threads through (see Fig. 1a of the source paper) and confirming
the sign/axis convention matches rather than being flipped or rotated.

Observed clouds vs. the fitted curve (spec §17 acceptance criteria)
----------------------------------------------------------------------
This Konietzka et al. (2024) dataset is the paper's own published
BEST-FIT MODEL - i.e. it already IS the fitted/interpolated spine, not
raw individual cloud or cluster measurements. Individual labeled cloud
positions (Taurus, Perseus, Orion, etc. as discrete catalog objects)
are a separate concern - the normalized object catalog (spec §7),
populated by Story #59 - and are explicitly out of scope here (see this
Story's issue #61 "Out of scope": Gould Belt, Local Bubble are separate
Stories, and no cloud catalog is shipped by this module).

Because only the fitted curve is available in this Story,
`RadcliffeWaveModel.curve_type` is hard-coded to the literal
`"fitted"` and can never be `"observed"` - nothing constructed via
`load_radcliffe_wave` can be mistaken by downstream code for raw
observed cloud positions. `RadcliffeWaveModel.notes` also states this
distinction in the loaded data itself, not just in this docstring, so a
consumer that never reads this module's source can still discover it
in the model object.

This module carries no renderer- or Three.js-specific fields (spec
§45) - only the geometric/scientific parameters a renderer would
consume.
"""

from __future__ import annotations

import csv
from pathlib import Path
from typing import Literal

from pydantic import BaseModel, Field

#: Geometric representations spec §17 allows for the Radcliffe Wave layer.
RADCLIFFE_WAVE_REPRESENTATIONS = {"polyline", "spline"}

#: This layer is always the fitted/interpolated curve, never raw observed
#: cloud positions (see module docstring). Kept as a single-member Literal
#: (rather than a plain str) so that constructing a `RadcliffeWaveModel`
#: with any other value is a validation error, not a silent typo.
CurveType = Literal["fitted"]


class RadcliffeWavePoint(BaseModel):
    """A single point on the Radcliffe Wave's best-fit spine.

    `s_pc` is the cumulative 3D arclength along the ordered polyline,
    starting at 0 pc at the first point in the source file. `x_pc`,
    `y_pc`, `z_pc` are heliocentric Galactic Cartesian coordinates in
    parsecs (spec §6), matching `schema.Cartesian`.
    """

    s_pc: float = Field(ge=0.0)
    x_pc: float
    y_pc: float
    z_pc: float


class RadcliffeWaveSource(BaseModel):
    """Provenance for this model's points (spec §11 principle, applied to
    model layers per spec §16/§17: every model parameter set must
    reference the literature from which it was derived). `reference` is
    required - no scientific value may appear without a traceable
    origin.
    """

    reference: str = Field(min_length=1)
    doi: str | None = None
    dataset_doi: str | None = None
    url: str | None = None
    retrieved: str | None = None
    notes: str | None = None


class RadcliffeWaveModel(BaseModel):
    """Radcliffe Wave scientific model layer (spec §17).

    Pure geometry/provenance - independently toggleable by a consumer
    (`enabled`) and free of any renderer/Three.js-specific properties.
    """

    model: Literal["radcliffe_wave"] = "radcliffe_wave"
    representation: Literal["polyline", "spline"] = "polyline"
    enabled: bool = True
    #: Always "fitted" - see module docstring. This model layer never
    #: represents raw observed cloud positions.
    curve_type: CurveType = "fitted"
    points: list[RadcliffeWavePoint] = Field(min_length=2)
    source: RadcliffeWaveSource
    notes: str | None = None


#: Provenance for the shipped `models/radcliffe_wave.csv`. Kept as a
#: module-level constant (rather than duplicated in the CSV, which per
#: spec §17 has a fixed `s_pc, x_pc, y_pc, z_pc` schema with no room for
#: metadata columns) so `load_radcliffe_wave` can attach it to every load
#: of the shipped dataset.
KONIETZKA_2024_SOURCE = RadcliffeWaveSource(
    reference=(
        "Konietzka, R., Goodman, A. A., Zucker, C., Burkert, A., Alves, J., "
        "Foley, M., Swiggum, C., Koller, M. & Miret-Roig, N. (2024), "
        '"The Radcliffe Wave is oscillating", Nature, 626, 63-68'
    ),
    doi="10.1038/s41586-024-07127-3",
    dataset_doi="10.7910/DVN/F98QHY",
    url="https://doi.org/10.7910/DVN/F98QHY",
    retrieved="2026-08-16",
    notes=(
        "arXiv:2402.12596. Points are the paper's own published best-fit "
        "model spine (file "
        "'Radcliffe_Wave_best_fit_model_Konietzka2024.tab', CC0-licensed), "
        "i.e. the fitted/interpolated curve, not raw individual cloud or "
        "cluster measurements - see 'curve_type' and this module's "
        "docstring. Raw file kept unmodified at "
        "data/raw/Radcliffe_Wave_best_fit_model_Konietzka2024.tab (spec "
        "§13). s_pc is this repo's own derived cumulative 3D arclength "
        "along the file's point ordering (not a column in the source "
        "file). The source file's x, y, z columns are stated by the "
        "paper (Methods, 'Full Spatial and Kinematic Model') to be "
        "Heliocentric Galactic Cartesian coordinates, matching spec §6's "
        "convention; the source file's fourth column, vz (line-of-sight "
        "velocity), is not part of this Story's spatial schema and is "
        "not carried into models/radcliffe_wave.csv."
    ),
)

#: Explicit note carried on every loaded model, restating the observed-
#: vs-fitted distinction on the object itself (spec §17 acceptance
#: criteria: "distinguishes observed cloud positions from the
#: interpolated/fitted curve; the curve does not replace the actual
#: objects").
_FITTED_CURVE_NOTE = (
    "This is the interpolated/fitted Radcliffe Wave curve (Konietzka et "
    "al. 2024's published best-fit spine), not observed cloud positions. "
    "It does not replace the individual astronomical objects (e.g. "
    "Taurus, Perseus, Orion) that make up the Wave - those are separate "
    "catalog entries (spec §7) tracked elsewhere."
)


def _read_points_csv(path: Path) -> list[RadcliffeWavePoint]:
    with open(path, newline="") as f:
        reader = csv.DictReader(f)
        return [
            RadcliffeWavePoint(
                s_pc=float(row["s_pc"]),
                x_pc=float(row["x_pc"]),
                y_pc=float(row["y_pc"]),
                z_pc=float(row["z_pc"]),
            )
            for row in reader
        ]


def load_radcliffe_wave(path: str | Path) -> RadcliffeWaveModel:
    """Load and validate the Radcliffe Wave polyline from a CSV file at
    `path` (schema: `s_pc, x_pc, y_pc, z_pc`, spec §17), attaching this
    module's Konietzka et al. (2024) source provenance.

    Raises `pydantic.ValidationError` if the resulting model fails
    validation (e.g. fewer than 2 points), `FileNotFoundError` if `path`
    does not exist, and `KeyError`/`ValueError` if the CSV is missing a
    required column or contains non-numeric values.
    """
    path = Path(path)
    if not path.exists():
        raise FileNotFoundError(path)
    points = _read_points_csv(path)
    return RadcliffeWaveModel(
        points=points,
        source=KONIETZKA_2024_SOURCE,
        notes=_FITTED_CURVE_NOTE,
    )
