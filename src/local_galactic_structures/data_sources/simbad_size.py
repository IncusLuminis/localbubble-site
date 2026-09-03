"""SIMBAD angular-diameter adapter (Story #314, Epic #313).

`data_sources/simbad.py` was built for kinematics (parallax/proper motion/
radial velocity) - it never requests SIMBAD's own angular-size fields, so
this narrowly-scoped sibling module adds just that: a lookup of SIMBAD's
`galdim_majaxis`/`galdim_minaxis` votable fields (the "Galaxy dimension"
major/minor axis - despite the `gal`-prefixed name, this is SIMBAD's
general extended-object angular-size field, populated for nebulae/
molecular clouds/SNRs/planetary nebulae, not only galaxies; verified live
against several of this catalog's own diffuse-structure records, e.g. M42/
the Orion Nebula, during development) plus `galdim_angle`/`galdim_qual`/
`galdim_bibcode` for provenance.

This is deliberately NOT built on `CachingObjectResolver` (the
`simbad.py`/`vizier.py`/`gaia.py` shared base) - that class's contract
ends in a full `AstronomicalObject`, and there is no such object to build
here: this module answers one narrower question ("does SIMBAD have an
angular size on file for this identifier, and if so what is it") for a
record that already exists in the catalog and already has its own
`distance_pc`. It reuses the same cache-record shape and cache/manifest
helpers `data_sources/__init__.py` exports, just without the
`_normalize`-to-`AstronomicalObject` step.

`galdim_majaxis`/`galdim_minaxis` are in **arcminutes** (SIMBAD's own
convention for this field, confirmed via `Simbad.list_votable_fields()`'s
own description and live spot-checks below) - `diameter_pc_from_angular_
size` converts a major-axis angular size plus a distance into a physical
size in parsecs via the same small-angle approximation `simbad.py`'s own
parallax -> distance conversion already relies on.

**Never fabricates**: `resolve_angular_diameter` returns `None` (not a
best-guess) whenever SIMBAD has no `galdim_majaxis` on file for the given
identifier at all - the caller (this Story's backfill script) is
responsible for trying alternate aliases of the same physical object
before accepting that as a genuine honest-failure, exactly the same
"caller tries alternates, adapter itself never guesses" split
`refresh_star_spectral_and_magnitude.build_id_to_query` already
established for id->query recovery.
"""

from __future__ import annotations

import math
from pathlib import Path
from typing import Any

from astroquery.simbad import Simbad as AstroquerySimbad

from . import (
    REPO_ROOT,
    CacheRecord,
    now_utc_iso,
    read_cache,
    slugify,
    table_row_to_dict,
    update_manifest,
    write_cache,
)

SOURCE_NAME = "simbad_size"

DEFAULT_CACHE_DIR = REPO_ROOT / "data" / "raw" / SOURCE_NAME


def _query_galdim(name: str) -> dict[str, Any] | None:
    """One live SIMBAD `query_object` call for the angular-size field set.
    Returns `None` (never raises) on zero rows - "no such identifier" -
    distinct from "identifier resolved but no galdim on file", which
    `resolve_angular_diameter` below distinguishes by inspecting
    `galdim_majaxis` on the returned raw dict."""
    client = AstroquerySimbad()
    client.add_votable_fields(
        "galdim_majaxis",
        "galdim_minaxis",
        "galdim_angle",
        "galdim_qual",
        "galdim_bibcode",
    )
    table = client.query_object(name)
    if table is None or len(table) == 0:
        return None
    return table_row_to_dict(table, 0)


def resolve_angular_diameter(
    name: str,
    *,
    cache_dir: str | Path | None = None,
    manifest_path: str | Path | None = None,
    force_refresh: bool = False,
) -> dict[str, Any] | None:
    """Resolve `name` against SIMBAD and return its angular-size record:

        {"main_id", "majaxis_arcmin", "minaxis_arcmin", "qual", "bibcode"}

    or `None` if SIMBAD either has no record for `name` at all, or has a
    record but no `galdim_majaxis` on file for it (both are "honest
    failure" from this function's point of view - never fabricated).

    Caches successful (identifier resolved AND galdim present) responses
    under `cache_dir` (default `data/raw/simbad_size/`), same on-disk
    `CacheRecord` shape every other live adapter in this package uses, and
    records the retrieval in `data_manifest.yaml` (spec §14) via
    `update_manifest`, matching the discipline `CachingObjectResolver`
    itself provides. A resolution with no usable `galdim_majaxis` is
    deliberately NOT cached (there is nothing to preserve, and re-trying
    it live on a future run is cheap and keeps the door open for SIMBAD's
    own data to improve over time) - this mirrors `simbad.py`'s
    `_query_mes_distance` fallback never caching a still-empty result
    either.
    """
    cache_dir = Path(cache_dir) if cache_dir is not None else DEFAULT_CACHE_DIR
    cache_path = cache_dir / f"{slugify(name)}.json"

    record = read_cache(cache_path) if not force_refresh else None
    if record is None:
        raw = _query_galdim(name)
        if raw is None or raw.get("galdim_majaxis") is None:
            return None
        record = CacheRecord(
            source=SOURCE_NAME,
            query=name,
            retrieved_utc=now_utc_iso(),
            record_id=str(raw.get("main_id") or name),
            raw=raw,
        )
        write_cache(cache_path, record, allow_overwrite=force_refresh)
        update_manifest(
            source=SOURCE_NAME,
            query=name,
            retrieved_utc=record.retrieved_utc,
            record_id=record.record_id,
            dataset="SIMBAD angular-size query (galdim_majaxis, galdim_minaxis, galdim_angle, galdim_qual, galdim_bibcode)",
            cache_path=cache_path,
            manifest_path=Path(manifest_path) if manifest_path is not None else (REPO_ROOT / "data_manifest.yaml"),
        )

    raw = record.raw
    majaxis = raw.get("galdim_majaxis")
    if majaxis is None:
        return None
    return {
        "main_id": raw.get("main_id"),
        "majaxis_arcmin": float(majaxis),
        "minaxis_arcmin": (
            float(raw["galdim_minaxis"]) if raw.get("galdim_minaxis") is not None else None
        ),
        "qual": raw.get("galdim_qual") or None,
        "bibcode": raw.get("galdim_bibcode") or None,
    }


def diameter_pc_from_angular_size(majaxis_arcmin: float, distance_pc: float) -> float:
    """Physical diameter in parsecs from an angular major-axis size
    (arcminutes) and a distance (parsecs), via the standard small-angle
    approximation: `diameter_pc = distance_pc * angle_radians`. The same
    approximation `simbad.py`'s own `_PARALLAX_MAS_TO_PC` distance
    conversion already relies on, just applied to an angular *size*
    (major-axis extent) rather than a parallax (angular *shift*)."""
    angle_rad = math.radians(majaxis_arcmin / 60.0)
    return distance_pc * angle_rad
