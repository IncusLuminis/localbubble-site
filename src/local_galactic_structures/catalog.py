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
    Group,
    Source,
    Visual,
)

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
        ),
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
