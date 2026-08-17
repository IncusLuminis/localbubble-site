"""Data acquisition layer (spec Idea.md §12).

Each concrete adapter in this package (`simbad.py`, `gaia.py`, `vizier.py`,
`literature.py`) implements the common `ObjectResolver` interface so the
rest of the pipeline never depends on which specific external service a
given record came from:

    class ObjectResolver(Protocol):
        def resolve(self, name: str) -> AstronomicalObject: ...

This module holds the shared machinery every *live-query* adapter
(SIMBAD/Gaia/VizieR) reuses:

* `CacheRecord` - the on-disk shape of one cached upstream response
  (spec §14: retrieval date + source reference must be retained).
* `read_cache`/`write_cache` - cache I/O. `write_cache` refuses to
  silently overwrite an existing cache file unless `allow_overwrite=True`
  is passed explicitly (spec §14: "not be silently overwritten").
* `update_manifest` - appends/updates a retrieval record in
  `data_manifest.yaml` (spec §14).
* `CachingObjectResolver` - an ABC that wires "check cache -> query
  upstream on miss -> write cache -> update manifest -> normalize" once,
  so `simbad.py`/`gaia.py`/`vizier.py` only implement the
  service-specific query and normalization logic.

`literature.py` is deliberately NOT built on `CachingObjectResolver` - it
has no upstream service to cache against; see its own module docstring.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol, runtime_checkable

import yaml
from pydantic import BaseModel, Field

from ..schema import AstronomicalObject

#: Repository root, computed from this file's location
#: (src/local_galactic_structures/data_sources/__init__.py -> repo root),
#: used as the default base for cache/manifest paths. Every path derived
#: from this is still overridable per-call/per-instance (tests always
#: override it with a tmp_path so they never touch the real repo tree or
#: the network).
REPO_ROOT = Path(__file__).resolve().parents[3]

DEFAULT_MANIFEST_PATH = REPO_ROOT / "data_manifest.yaml"


@runtime_checkable
class ObjectResolver(Protocol):
    """Common interface every data source adapter implements (spec §12).

    The scientific core depends only on this shape, never on a specific
    adapter class, so SIMBAD/Gaia/VizieR/literature are interchangeable.
    """

    def resolve(self, name: str) -> AstronomicalObject: ...


def slugify(text: str) -> str:
    """Turn an arbitrary query string into a filesystem-safe cache key."""
    slug = re.sub(r"[^a-z0-9]+", "_", text.strip().lower()).strip("_")
    return slug or "unnamed"


def now_utc_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def to_python(value: Any) -> Any:
    """Convert a numpy/astropy scalar (as found in astroquery result
    tables) into a plain, JSON-serializable Python value. Masked/missing
    values become `None` rather than numpy's masked-value sentinel."""
    try:
        import numpy as np

        if value is np.ma.masked:
            return None
        if isinstance(value, np.integer):
            return int(value)
        if isinstance(value, np.floating):
            f = float(value)
            return None if f != f else f  # NaN -> None
        if isinstance(value, np.bool_):
            return bool(value)
        if isinstance(value, np.ndarray):
            return [to_python(v) for v in value.tolist()]
    except ImportError:
        pass
    if isinstance(value, bytes):
        return value.decode("utf-8", errors="replace")
    return value


def table_row_to_dict(table, row_index: int = 0) -> dict[str, Any]:
    """Flatten one row of an astropy `Table` (as returned by astroquery)
    into a plain JSON-serializable dict, keyed by column name."""
    return {col: to_python(table[col][row_index]) for col in table.colnames}


class CacheRecord(BaseModel):
    """On-disk shape of one cached upstream response (spec §11, §14).

    `raw` is the upstream response, normalized only enough to be
    JSON-serializable (see `table_row_to_dict`) - never modified once
    written (spec §13: "raw data must never be modified in place").
    `retrieved_utc` and `record_id` are the two provenance facts the
    normalized `AstronomicalObject.source` schema (spec §7) has no
    dedicated field for; this cache record - plus `AstronomicalObject
    .notes`, which adapters also populate - is where they are genuinely
    queryable rather than merely implied.
    """

    source: str
    query: str
    retrieved_utc: str
    record_id: str
    raw: dict[str, Any] = Field(default_factory=dict)


def read_cache(path: Path) -> CacheRecord | None:
    if not path.exists():
        return None
    return CacheRecord.model_validate_json(path.read_text())


def write_cache(
    path: Path, record: CacheRecord, *, allow_overwrite: bool = False
) -> None:
    """Write `record` to `path`.

    Raises `FileExistsError` if `path` already exists and
    `allow_overwrite` is not explicitly set - a cached response is never
    silently overwritten (spec §14).
    """
    if path.exists() and not allow_overwrite:
        raise FileExistsError(
            f"Refusing to silently overwrite existing cache file {path} "
            "(pass force_refresh=True to explicitly refresh it)."
        )
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(record.model_dump_json(indent=2))


def update_manifest(
    *,
    source: str,
    query: str,
    retrieved_utc: str,
    record_id: str,
    dataset: str,
    cache_path: Path,
    manifest_path: Path = DEFAULT_MANIFEST_PATH,
) -> None:
    """Record (or refresh) one retrieval event in `data_manifest.yaml`
    (spec §14). Only called when an actual upstream fetch happened (cache
    miss or explicit `force_refresh`) - a cache *hit* performs no
    retrieval and therefore does not touch the manifest.

    Entries are keyed by `id` (`"<source>:<query>"`); a repeat retrieval
    of the same query updates that entry's `retrieved`/`record_id`
    in place rather than appending a duplicate row.
    """
    manifest_path = Path(manifest_path)
    if manifest_path.exists():
        data = yaml.safe_load(manifest_path.read_text()) or {}
    else:
        data = {}
    sources: list[dict[str, Any]] = data.setdefault("sources", [])

    entry_id = f"{source}:{query}"
    entry = {
        "id": entry_id,
        "source": source,
        "query": query,
        "dataset": dataset,
        "retrieved": retrieved_utc,
        "record_id": record_id,
        "cache_path": str(cache_path),
    }
    for i, existing in enumerate(sources):
        if existing.get("id") == entry_id:
            sources[i] = entry
            break
    else:
        sources.append(entry)

    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    manifest_path.write_text(yaml.safe_dump(data, sort_keys=False))


class CachingObjectResolver(ABC):
    """Shared "check cache -> query upstream on miss -> cache -> record
    in manifest -> normalize" orchestration for the live-query adapters
    (spec §12, §14). Subclasses implement only the service-specific
    pieces: `_query_upstream` (the actual network call, kept isolated so
    tests can monkeypatch it instead of hitting the network) and
    `_normalize` (raw response -> `AstronomicalObject`, spec §7/§11).
    """

    #: Short, human-readable source name (spec §14 manifest `source`
    #: field, and `AstronomicalObject.source.catalog`). Set by subclasses.
    SOURCE_NAME: str = "unknown"

    def __init__(
        self,
        *,
        cache_dir: str | Path | None = None,
        manifest_path: str | Path | None = None,
    ) -> None:
        self.cache_dir = Path(cache_dir) if cache_dir is not None else (
            REPO_ROOT / "data" / "raw" / self.SOURCE_NAME
        )
        self.manifest_path = (
            Path(manifest_path) if manifest_path is not None else DEFAULT_MANIFEST_PATH
        )

    def _cache_path(self, name: str) -> Path:
        return self.cache_dir / f"{slugify(name)}.json"

    @abstractmethod
    def _query_upstream(self, name: str) -> dict[str, Any]:
        """Perform the live query and return a JSON-serializable dict of
        the raw upstream record. The only method that touches the
        network - isolated so tests can monkeypatch it."""

    @abstractmethod
    def _extract_record_id(self, name: str, raw: dict[str, Any]) -> str:
        """The upstream record's own identifier (e.g. a SIMBAD main_id or
        a Gaia source_id), for provenance (spec §11)."""

    @abstractmethod
    def _dataset_label(self) -> str:
        """A short description of what was queried, for the manifest's
        `dataset` field (spec §14 example: `dataset: "..."`)."""

    @abstractmethod
    def _normalize(self, name: str, record: CacheRecord) -> AstronomicalObject:
        """Turn a cached/fetched `CacheRecord` into an `AstronomicalObject`
        (spec §7), including deriving Galactic l/b/XYZ (spec §6) and
        populating `source`/`notes` provenance (spec §11)."""

    def resolve(self, name: str, *, force_refresh: bool = False) -> AstronomicalObject:
        """Implements `ObjectResolver.resolve` (spec §12).

        Reuses the local cache when present; only performs a live query
        - and only then updates the manifest - on a cache miss or when
        `force_refresh=True` is passed explicitly (spec §14).
        """
        cache_path = self._cache_path(name)
        record = read_cache(cache_path) if not force_refresh else None

        if record is None:
            raw = self._query_upstream(name)
            record = CacheRecord(
                source=self.SOURCE_NAME,
                query=name,
                retrieved_utc=now_utc_iso(),
                record_id=self._extract_record_id(name, raw),
                raw=raw,
            )
            write_cache(cache_path, record, allow_overwrite=force_refresh)
            update_manifest(
                source=self.SOURCE_NAME,
                query=name,
                retrieved_utc=record.retrieved_utc,
                record_id=record.record_id,
                dataset=self._dataset_label(),
                cache_path=cache_path,
                manifest_path=self.manifest_path,
            )

        return self._normalize(name, record)
