"""Catalog storage: normalized `AstronomicalObject` records <-> parquet/CSV.

Preferred internal storage is `data/normalized/catalog.parquet` (spec §7);
CSV is generated alongside it for human inspection and interoperability.
"""

from __future__ import annotations

import json
from pathlib import Path

import pyarrow as pa
import pyarrow.parquet as pq

from .schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    ExoplanetSummary,
    Group,
    Source,
    Velocity,
    Visual,
)


def _exoplanets_to_json(exoplanets: ExoplanetSummary | None) -> str | None:
    """`exoplanets` -> a single JSON-string column (`exoplanets_json`).

    Unlike `aliases`/`group_secondary` (lists of plain scalars, which
    parquet/Arrow stores natively), `exoplanets` is a nested optional
    object containing a variable-length list of sub-objects
    (`ExoplanetSummary.planets: list[PlanetSummary]`) that is `None` for
    ~97% of rows - storing it pre-serialized as JSON avoids Arrow schema
    inference edge cases for a nested struct column that is null almost
    everywhere, and keeps this field's round-trip exercised by the exact
    same plain-value flat-dict shape every other `to_record` field uses.
    """
    return exoplanets.model_dump_json() if exoplanets is not None else None


def _exoplanets_from_json(value: str | None) -> ExoplanetSummary | None:
    if not value:
        return None
    return ExoplanetSummary.model_validate_json(value)


def _velocity_to_json(velocity: Velocity | None) -> str | None:
    """`velocity` -> a single JSON-string column (`velocity_json`), same
    convention as `_exoplanets_to_json` above (Story #230): `Velocity` is a
    nested optional object, `None` for the overwhelming majority of rows
    (everything outside the ~127-star in-sphere set), so pre-serialized
    JSON storage sidesteps Arrow nested-struct-column edge cases the same
    way it already does for `exoplanets`.
    """
    return velocity.model_dump_json() if velocity is not None else None


def _velocity_from_json(value: str | None) -> Velocity | None:
    if not value:
        return None
    return Velocity.model_validate_json(value)


def to_record(obj: AstronomicalObject) -> dict:
    """Flatten an `AstronomicalObject` into a flat dict (one catalog row)."""
    return {
        "id": obj.id,
        "name": obj.name,
        "aliases": list(obj.aliases),
        "object_type": obj.object_type,
        "ra_deg": obj.coordinates.ra_deg,
        "dec_deg": obj.coordinates.dec_deg,
        "galactic_l_deg": obj.coordinates.galactic_l_deg,
        "galactic_b_deg": obj.coordinates.galactic_b_deg,
        "distance_value_pc": obj.distance.value_pc,
        "distance_error_pc": obj.distance.error_pc,
        "x_pc": obj.cartesian.x_pc,
        "y_pc": obj.cartesian.y_pc,
        "z_pc": obj.cartesian.z_pc,
        "group_primary": obj.group.primary,
        "group_secondary": list(obj.group.secondary),
        "source_reference": obj.source.reference,
        "source_url": obj.source.url,
        "source_catalog": obj.source.catalog,
        "visual_size_pc": obj.visual.size_pc,
        "visual_color_class": obj.visual.color_class,
        "visual_spectral_type": obj.visual.spectral_type,
        "visual_absolute_magnitude": obj.visual.absolute_magnitude,
        "visual_apparent_magnitude": obj.visual.apparent_magnitude,
        "exoplanets_json": _exoplanets_to_json(obj.exoplanets),
        "velocity_json": _velocity_to_json(obj.velocity),
        "notes": obj.notes,
    }


def from_record(record: dict) -> AstronomicalObject:
    """Rebuild an `AstronomicalObject` from a flat catalog row."""
    return AstronomicalObject(
        id=record["id"],
        name=record["name"],
        aliases=list(record.get("aliases") or []),
        object_type=record["object_type"],
        coordinates=Coordinates(
            ra_deg=record["ra_deg"],
            dec_deg=record["dec_deg"],
            galactic_l_deg=record["galactic_l_deg"],
            galactic_b_deg=record["galactic_b_deg"],
        ),
        distance=Distance(
            value_pc=record["distance_value_pc"],
            error_pc=record.get("distance_error_pc"),
        ),
        cartesian=Cartesian(
            x_pc=record["x_pc"], y_pc=record["y_pc"], z_pc=record["z_pc"]
        ),
        group=Group(
            primary=record.get("group_primary"),
            secondary=list(record.get("group_secondary") or []),
        ),
        source=Source(
            reference=record["source_reference"],
            url=record.get("source_url"),
            catalog=record.get("source_catalog"),
        ),
        visual=Visual(
            size_pc=record.get("visual_size_pc"),
            color_class=record.get("visual_color_class"),
            spectral_type=record.get("visual_spectral_type"),
            absolute_magnitude=record.get("visual_absolute_magnitude"),
            apparent_magnitude=record.get("visual_apparent_magnitude"),
        ),
        exoplanets=_exoplanets_from_json(record.get("exoplanets_json")),
        velocity=_velocity_from_json(record.get("velocity_json")),
        notes=record.get("notes"),
    )


def _check_unique_ids(objects: list[AstronomicalObject]) -> None:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for obj in objects:
        if obj.id in seen:
            duplicates.add(obj.id)
        seen.add(obj.id)
    if duplicates:
        raise ValueError(
            f"Duplicate object id(s) in catalog: {sorted(duplicates)}"
        )


def save_catalog(
    objects: list[AstronomicalObject],
    parquet_path: str | Path,
    csv_path: str | Path | None = None,
) -> None:
    """Write `objects` to `parquet_path` (and optionally `csv_path`).

    Raises `ValueError` if `objects` contains duplicate `id`s.
    """
    _check_unique_ids(objects)
    records = [to_record(obj) for obj in objects]
    # Column order is derived from to_record()'s own output - the single
    # source of truth for the flat record shape - rather than hand-kept in
    # sync with a separate constant.
    columns = list(records[0].keys()) if records else []

    parquet_path = Path(parquet_path)
    parquet_path.parent.mkdir(parents=True, exist_ok=True)
    table = pa.Table.from_pylist(records)
    pq.write_table(table, parquet_path)

    if csv_path is not None:
        import pandas as pd

        csv_records = [
            {
                **r,
                "aliases": json.dumps(r["aliases"]),
                "group_secondary": json.dumps(r["group_secondary"]),
            }
            for r in records
        ]
        df = pd.DataFrame(csv_records, columns=columns)
        csv_path = Path(csv_path)
        csv_path.parent.mkdir(parents=True, exist_ok=True)
        df.to_csv(csv_path, index=False)


def load_catalog(parquet_path: str | Path) -> list[AstronomicalObject]:
    """Load a catalog previously written by `save_catalog`."""
    table = pq.read_table(parquet_path)
    return [from_record(r) for r in table.to_pylist()]
