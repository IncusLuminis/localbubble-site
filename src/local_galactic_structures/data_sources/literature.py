"""Literature adapter (spec Idea.md §12).

Unlike `simbad.py`/`gaia.py`/`vizier.py`, this adapter is not a live
query against an external service - it is the on-ramp for values that
were read by a human out of a paper, review article, or dataset table
and need to enter the pipeline through the same `AstronomicalObject`
schema (spec §7) with the same provenance discipline (spec §11) as
everything else. There is nothing to cache here (there is no upstream
response to preserve raw) and no `data_manifest.yaml` entry to write
(no retrieval happened) - "resolve" means "construct-and-validate from
already-supplied fields", not "fetch".

Two ways to use it, both going through the same validation:

* `build_object_from_literature(...)` - construct a single
  `AstronomicalObject` directly from ra/dec/distance/source fields,
  deriving Galactic l/b/XYZ via `coordinates.derive_galactic_coordinates`
  (spec §6) just like the live adapters do.
* `LiteratureResolver` - implements the common `ObjectResolver`
  interface (spec §12) over a curated `{name: fields}` table supplied at
  construction (e.g. loaded from a small YAML file of hand-entered
  values), so code that only knows about `ObjectResolver.resolve(name)`
  can use literature-sourced objects interchangeably with live-queried
  ones.
"""

from __future__ import annotations

from pathlib import Path

import yaml

from . import slugify
from ..coordinates import derive_galactic_coordinates
from ..schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    Group,
    Source,
    Visual,
)


def build_object_from_literature(
    *,
    id: str | None = None,
    name: str,
    object_type: str,
    ra_deg: float,
    dec_deg: float,
    distance_pc: float,
    distance_error_pc: float | None = None,
    source_reference: str,
    source_url: str | None = None,
    source_catalog: str | None = None,
    aliases: list[str] | None = None,
    group_primary: str | None = None,
    group_secondary: list[str] | None = None,
    visual_size_pc: float | None = None,
    visual_color_class: str | None = None,
    notes: str | None = None,
) -> AstronomicalObject:
    """Construct-and-validate an `AstronomicalObject` from manually
    curated literature values (spec §12).

    `source_reference` is required and must be non-empty - per spec §11,
    no scientific value may appear without a traceable origin.
    `schema.Source.reference` itself has no non-empty constraint (it is
    shared by every adapter, some of which may legitimately have less to
    say), so this adapter enforces it explicitly here rather than
    silently accepting a blank citation for a manually-curated value.
    Raises `ValueError` for a missing/blank reference, or
    `pydantic.ValidationError` for any other invalid field (e.g. dec
    outside [-90, 90]).
    """
    if not source_reference or not source_reference.strip():
        raise ValueError(
            "source_reference must be a non-empty, traceable citation "
            "(spec §11) - literature-sourced values cannot be entered "
            "without one."
        )
    obj = AstronomicalObject(
        id=id or slugify(name),
        name=name,
        aliases=list(aliases or []),
        object_type=object_type,
        coordinates=Coordinates(
            ra_deg=ra_deg,
            dec_deg=dec_deg,
            galactic_l_deg=0.0,
            galactic_b_deg=0.0,
        ),
        distance=Distance(value_pc=distance_pc, error_pc=distance_error_pc),
        cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
        group=Group(primary=group_primary, secondary=list(group_secondary or [])),
        source=Source(
            reference=source_reference, url=source_url, catalog=source_catalog
        ),
        visual=Visual(size_pc=visual_size_pc, color_class=visual_color_class),
        notes=notes,
    )
    return derive_galactic_coordinates(obj)


class LiteratureResolver:
    """`ObjectResolver` (spec §12) over a curated table of manually
    entered, literature-sourced values - not a live query.

    Entries are supplied at construction as `{name: {field: value, ...}}`,
    where each inner dict is the keyword arguments to
    `build_object_from_literature` (minus `name`, which is taken from the
    outer key unless overridden). `resolve(name)` looks the name up and
    builds-and-validates the object on every call (curated tables are
    small; no caching is needed for a pure in-memory construction).
    """

    SOURCE_NAME = "literature"

    def __init__(self, entries: dict[str, dict] | None = None) -> None:
        self._entries: dict[str, dict] = dict(entries or {})

    @classmethod
    def from_yaml(cls, path: str | Path) -> "LiteratureResolver":
        """Load a curated entries table from a YAML file shaped as
        `{name: {field: value, ...}}` (mirroring the keyword arguments of
        `build_object_from_literature`)."""
        with open(path) as f:
            raw = yaml.safe_load(f) or {}
        return cls(raw)

    def register(self, name: str, **fields) -> None:
        """Add or replace one curated entry."""
        self._entries[name] = fields

    def resolve(self, name: str) -> AstronomicalObject:
        try:
            fields = self._entries[name]
        except KeyError as exc:
            raise KeyError(
                f"No literature entry registered for {name!r}. "
                "LiteratureResolver only constructs objects from values "
                "supplied directly - register one with .register(...) or "
                "LiteratureResolver({...}) / .from_yaml(...)."
            ) from exc
        fields = {**fields}
        fields.setdefault("name", name)
        return build_object_from_literature(**fields)
