"""Renderer-independent scene export (spec Idea.md §21, §45, Story #63).

Composes the normalized object catalog (schema.py/catalog.py) and the three
scientific model layers (gould_belt.py, radcliffe_wave.py, local_bubble.py)
into a single JSON-serializable "scene" - the artifact the (separate,
not-yet-built) Three.js web visualizer will consume. This module owns none
of the underlying science; it only assembles what those other modules
already computed/validated into the spec §21 shape:

    {
      "metadata": {...},
      "objects": [...],
      "structures": {
          "gould_belt": {...}, "radcliffe_wave": {...}, "local_bubble": {...}
      }
    }

Renderer independence (spec §45): nothing in this module's output may
reference Three.js or any renderer-specific concept (materials, meshes,
geometry types, etc) - only physical/scientific fields a renderer would
need in order to *build* its own geometry. `models[*].model_dump()` is
reused as-is for `structures` because those Pydantic models are already
pure geometry/provenance (see each model module's own docstring); nothing
here precomputes mesh geometry, and the Radcliffe Wave's `points` list -
already just XYZ pc per point - is exported close to as-is.

Radius filtering (spec §28): `build_scene`'s `radius_pc` parameter filters
`objects` only. Model/structure layers represent whole physical structures,
not point objects at a specific heliocentric distance, so they are never
radius-filtered - each is included in full whenever `enabled` (for the
model layers that carry that field) or unconditionally (for
`GouldBeltModel`, which currently has no `enabled` field at all - a known,
pre-existing minor inconsistency across the three model layers, not
introduced or fixed by this Story). The architecture must not hard-code any
particular radius as a permanent limit (spec §28): `radius_pc=None` (the
default here) applies no filtering at all. A default of 800 pc appears only
as an ordinary, overridable CLI flag default (spec §35's own example), not
baked into this library function.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Mapping, Sequence

from pydantic import BaseModel

from .schema import AstronomicalObject

#: Fixed key set for the `structures` block (spec §21's example enumerates
#: exactly these three). A model layer that is absent (not passed in
#: `models`) or disabled is still represented by its key, with an empty
#: dict value, so a consumer can always rely on all three keys existing.
STRUCTURE_KEYS = ("gould_belt", "radcliffe_wave", "local_bubble")

#: Spec §21 `metadata` block - fixed for this project's one coordinate
#: convention (spec §6): heliocentric Galactic Cartesian, parsecs.
SCENE_METADATA = {
    "coordinate_system": "heliocentric_galactic_cartesian",
    "distance_unit": "pc",
}


def _object_to_scene_entry(obj: AstronomicalObject) -> dict:
    """One catalog object -> its spec §21/§45 scene representation.

    Only renderer-agnostic, scientific/descriptive fields (spec §45's
    "good" example: `object_type`/`position_pc`/`size_pc`) - no Three.js
    or renderer-specific keys (materials, geometry types, mesh data).
    """
    return {
        "id": obj.id,
        "name": obj.name,
        "aliases": list(obj.aliases),
        "object_type": obj.object_type,
        "position_pc": [obj.cartesian.x_pc, obj.cartesian.y_pc, obj.cartesian.z_pc],
        "distance_pc": obj.distance.value_pc,
        "distance_error_pc": obj.distance.error_pc,
        "size_pc": obj.visual.size_pc,
        "color_class": obj.visual.color_class,
        "group": {
            "primary": obj.group.primary,
            "secondary": list(obj.group.secondary),
        },
        "source": {
            "reference": obj.source.reference,
            "url": obj.source.url,
            "catalog": obj.source.catalog,
        },
        "notes": obj.notes,
    }


def _model_to_structure(model: BaseModel | None) -> dict:
    """One scientific model layer -> its `structures.<key>` entry.

    `None` (layer not supplied) or an explicitly disabled layer
    (`model.enabled is False`) both serialize to `{}` - the layer's key is
    still present in `structures` (spec §21's example shape), just empty,
    rather than silently omitted. A model with no `enabled` field at all
    (currently `GouldBeltModel` - see spec §16 vs §17/§18's `enabled`) is
    always included in full, since it has no way to express "disabled".
    """
    if model is None:
        return {}
    if getattr(model, "enabled", True) is False:
        return {}
    return model.model_dump(mode="json")


def build_scene(
    objects: Sequence[AstronomicalObject],
    models: Mapping[str, BaseModel | None] | None = None,
    radius_pc: float | None = None,
) -> dict:
    """Compose `objects` and `models` into a spec §21 renderer-independent
    scene dict.

    `objects`: the normalized catalog (spec §7), e.g. from
    `catalog.load_catalog()`.

    `models`: mapping of structure key (`"gould_belt"`, `"radcliffe_wave"`,
    `"local_bubble"`) to that layer's loaded Pydantic model instance (from
    `gould_belt.load_gould_belt_model`, `radcliffe_wave.load_radcliffe_wave`,
    `local_bubble.load_local_bubble_model`), or omitted/`None` for a layer
    that has not been built. Unknown keys are ignored; all three
    `STRUCTURE_KEYS` are always present in the returned scene's
    `structures`, even if empty.

    `radius_pc`: if given, `objects` are filtered to those within
    `radius_pc` pc of the Sun (heliocentric distance, spec §28); `None`
    (the default) applies no filtering. Structures/model layers are never
    radius-filtered - they describe whole physical structures, not point
    objects (see module docstring).
    """
    models = models or {}
    scene_objects = [
        _object_to_scene_entry(obj)
        for obj in objects
        if radius_pc is None or obj.distance.value_pc <= radius_pc
    ]
    structures = {key: _model_to_structure(models.get(key)) for key in STRUCTURE_KEYS}
    return {
        "metadata": dict(SCENE_METADATA),
        "objects": scene_objects,
        "structures": structures,
    }


def export_scene(scene: dict, path: str | Path) -> Path:
    """Write `scene` (as built by `build_scene`) to `path` as JSON.

    Creates parent directories as needed. Returns the resolved `Path`
    written to.
    """
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(scene, indent=2) + "\n")
    return path


def load_scene(path: str | Path) -> dict:
    """Load a scene JSON file previously written by `export_scene`.

    Round-trips exactly what was exported as a plain dict - not
    reconstructed into `AstronomicalObject`/model instances, since the
    scene format is intentionally a plain, renderer-independent
    serialization (spec §21, §45), not the scientific pipeline's own
    in-memory types.
    """
    return json.loads(Path(path).read_text())
