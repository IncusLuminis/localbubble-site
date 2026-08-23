"""NASA Exoplanet Archive adapter (Story #171).

Architecturally different from `simbad.py`/`gaia.py`: those adapters query
one named object at a time and cache one file per query
(`CachingObjectResolver`). The NASA Exoplanet Archive's `pscomppars` table
("Planetary Systems Composite Parameters" - one curated row per *planet*,
already merging the best available reference for each parameter, unlike the
raw multi-row-per-planet `ps` table) is instead pulled *once*, in full, via
`astroquery.ipac.nexsci.nasa_exoplanet_archive.NasaExoplanetArchive
.query_criteria` - a bulk snapshot cached as a single JSON file - and every
catalog star's cross-match against it happens locally in Python afterwards,
with no further network round-trips. This module still reuses the shared
`CacheRecord`/`write_cache`/`update_manifest` provenance helpers from
`data_sources/__init__.py` (spec §14), just keyed by one fixed dataset name
instead of one cache file per star.

Live network access to the archive's TAP service
(https://exoplanetarchive.ipac.caltech.edu) was confirmed reachable from
this environment during development: a live `query_criteria` pull of the
columns below returned 6354 rows in ~7s.

Column-name correction found during development: the issue's own research
(and the archive's documentation) refer to a `gaia_id` cross-match column,
but the *actual* `pscomppars` schema (verified empirically against the
installed astroquery 0.4.11 / live TAP service - there is no `gaia_id`
column at all, and requesting it raises `ORA-00904: 'GAIA_ID': invalid
identifier`) splits this into two separate columns, `gaia_dr2_id` and
`gaia_dr3_id`. Both are fetched and indexed: a catalog star's `aliases`
(SIMBAD's `ids` field) can carry either a "Gaia DR2 ..." or "Gaia DR3 ..."
designator (sometimes both), so matching only one release would silently
miss real matches.

Cross-matching (spec Story #171 AC2/AC3): every catalog star's existing
`aliases` (already SIMBAD-resolved, Story #58/#88/#90/#104/#170) are tried
against the archive's `hd_name`/`hip_name`/`tic_id`/`gaia_dr3_id`/
`gaia_dr2_id` columns, in that priority order (the order the issue itself
lists: HD/HIP/TIC/Gaia). Matching is done by *identifier*, never by a
substring match against the bare star/system name - this is what makes
multi-star systems come out right (spec AC3): this catalog carries a
separate record per physical component of a system (e.g. `alf Cen A`/
`alf Cen B`, `omi02 Eri`/`omi02 Eri B`/`omi02 Eri C` for 40 Eridani A/B/C,
`eps Ind A`/`eps Ind B`), each with its *own* HD/HIP/TIC/Gaia identifiers
(verified empirically: e.g. `alf Cen A` and `alf Cen B` have different
`gaia_dr3_id`/`tic_id` values, not just different `hostname` strings), so an
identifier match can only ever land on the correct component's `hostname` -
it never has to guess from a name that might contain another component's
name as a substring. (82 Eridani is a further wrinkle worth noting: its
archive `hostname` is the bare designator `"HD 20794"`, not a Bayer-style
name at all - another reason a name-substring approach would be fragile
where an identifier match is not.)

Per-cell values from `pscomppars`'s numeric columns (`pl_orbper`,
`pl_bmasse`, `pl_rade`) arrive from astroquery as astropy
`MaskedQuantity` scalars (units + a mask for missing data), not the plain
numpy scalars/strings `to_python` (see `data_sources/__init__.py`) already
handles - `_row_value_to_python` below extends that handling: unwrap the
unit (values are stored in `PlanetSummary`'s implied units - days/Earth
masses/Earth radii, matching astroquery's own `pl_orbper`/`pl_bmasse`/
`pl_rade` units) and convert a masked cell to `None` rather than
fabricating a value.
"""

from __future__ import annotations

import re
from pathlib import Path
from typing import Any

from . import (
    REPO_ROOT,
    CacheRecord,
    now_utc_iso,
    read_cache,
    to_python,
    update_manifest,
    write_cache,
)
from ..schema import ExoplanetSummary, PlanetSummary

SOURCE_NAME = "nasa_exoplanet_archive"

#: `pscomppars` = "Planetary Systems Composite Parameters" - the curated,
#: one-row-per-planet table (spec Story #171 AC1); NOT the raw
#: multi-row-per-planet `ps` table.
TABLE_NAME = "pscomppars"

DEFAULT_CACHE_PATH = (
    REPO_ROOT / "data" / "raw" / "nasa_exoplanet_archive" / "pscomppars_bulk.json"
)

SOURCE_REFERENCE = (
    "NASA Exoplanet Archive, Planetary Systems Composite Parameters "
    "(pscomppars) table, operated by Caltech/IPAC under contract with NASA"
)
SOURCE_URL = (
    "https://exoplanetarchive.ipac.caltech.edu/cgi-bin/TblView/"
    "nph-tblView?app=ExoTbls&config=PSCompPars"
)

#: Columns pulled from `pscomppars` (spec Story #171): stellar cross-match
#: keys plus the per-planet fields `PlanetSummary` needs. See module
#: docstring for why this is `gaia_dr2_id`/`gaia_dr3_id`, not a single
#: `gaia_id` column.
SELECT_COLUMNS = (
    "hostname",
    "hd_name",
    "hip_name",
    "tic_id",
    "gaia_dr2_id",
    "gaia_dr3_id",
    "pl_name",
    "pl_orbper",
    "pl_bmasse",
    "pl_rade",
    "discoverymethod",
    "disc_year",
    "disc_facility",
)

#: (archive column, alias prefix) pairs, in the exact priority order this
#: Story's cross-match tries them per star (spec AC2: "trying HD/HIP/TIC/
#: Gaia identifier forms in priority order").
IDENTIFIER_COLUMNS: tuple[tuple[str, str], ...] = (
    ("hd_name", "HD"),
    ("hip_name", "HIP"),
    ("tic_id", "TIC"),
    ("gaia_dr3_id", "GAIA DR3"),
    ("gaia_dr2_id", "GAIA DR2"),
)


def _normalize_identifier(value: str) -> str:
    """Collapse internal whitespace runs, strip, and uppercase.

    SIMBAD's own `ids` field (the source of every catalog star's
    `aliases`) pads catalog numbers to a fixed field width with extra
    internal spaces, e.g. `"HD  20794"` (two spaces, five-digit number)
    vs. `"HD 209100"` (one space, six-digit number) - both denote an
    ordinary single-space-separated HD number in the archive's own
    `hd_name` column (`"HD 20794"`). Without normalizing, these would
    never compare equal even though they identify the same star -
    verified empirically against real `web/public/data/scene.json`
    aliases and a live archive query for the same star (82 Eridani /
    HD 20794).
    """
    return re.sub(r"\s+", " ", value.strip()).upper()


def _row_value_to_python(value: Any) -> Any:
    """One `pscomppars` table cell -> plain JSON-serializable Python
    value. Extends `to_python` (`data_sources/__init__.py`) to also
    unwrap astropy (Masked)Quantity cells (`pl_orbper`/`pl_bmasse`/
    `pl_rade`), which `to_python` alone does not handle - SIMBAD/Gaia/
    VizieR never return Quantity columns, only this table's numeric
    columns do. A masked cell becomes `None`, never a fabricated value.
    """
    mask = getattr(value, "mask", None)
    if mask is not None and bool(mask):
        return None
    if hasattr(value, "unit") and hasattr(value, "value"):
        # Unwrap the Quantity's magnitude. For a single table cell this is
        # always a 0-dimensional (Masked)NDArray, not a "real" >=1-d array
        # - `.item()` converts it straight to a plain Python scalar rather
        # than going through `to_python`'s ndarray branch below, which
        # calls `.tolist()` assuming a real array and raises on a 0-d one
        # (`.tolist()` on a 0-d array returns a bare scalar, not a list).
        value = value.value
        if hasattr(value, "item") and getattr(value, "shape", None) == ():
            value = value.item()
        if isinstance(value, float) and value != value:  # NaN, unmasked
            return None
    return to_python(value)


def _table_to_rows(table) -> list[dict[str, Any]]:
    """An astropy `Table` (as returned by `query_criteria`) -> a list of
    plain, JSON-serializable per-row dicts, one per planet."""
    return [
        {column: _row_value_to_python(table[column][i]) for column in table.colnames}
        for i in range(len(table))
    ]


def fetch_pscomppars_rows() -> list[dict[str, Any]]:
    """The one live bulk query this module ever makes (spec AC1): all
    `pscomppars` rows, restricted to `SELECT_COLUMNS`. Isolated in its
    own function - like every other adapter's `_query_upstream` - purely
    so tests can monkeypatch it instead of touching the network.
    """
    from astroquery.ipac.nexsci.nasa_exoplanet_archive import NasaExoplanetArchive

    table = NasaExoplanetArchive.query_criteria(
        table=TABLE_NAME, select=",".join(SELECT_COLUMNS)
    )
    return _table_to_rows(table)


def load_or_fetch_pscomppars_rows(
    *,
    cache_path: str | Path = DEFAULT_CACHE_PATH,
    manifest_path: str | Path | None = None,
    force_refresh: bool = False,
) -> list[dict[str, Any]]:
    """Bulk equivalent of `CachingObjectResolver.resolve()` (spec AC1):
    one cached snapshot of the whole `pscomppars` table - reusing the
    exact same `CacheRecord`/`write_cache`/`update_manifest` provenance
    helpers every other adapter uses - keyed by one fixed dataset name
    (`"pscomppars_bulk"`) rather than one cache file per star. A cache
    hit performs no network access and does not touch the manifest, same
    convention as `CachingObjectResolver.resolve()`.
    """
    from . import DEFAULT_MANIFEST_PATH

    cache_path = Path(cache_path)
    manifest_path = (
        Path(manifest_path) if manifest_path is not None else DEFAULT_MANIFEST_PATH
    )

    record = read_cache(cache_path) if not force_refresh else None
    if record is None:
        rows = fetch_pscomppars_rows()
        record = CacheRecord(
            source=SOURCE_NAME,
            query="pscomppars_bulk",
            retrieved_utc=now_utc_iso(),
            record_id=f"{len(rows)} pscomppars rows",
            raw={"rows": rows},
        )
        write_cache(cache_path, record, allow_overwrite=force_refresh)
        update_manifest(
            source=SOURCE_NAME,
            query="pscomppars_bulk",
            retrieved_utc=record.retrieved_utc,
            record_id=record.record_id,
            dataset=(
                f"NASA Exoplanet Archive {TABLE_NAME} bulk snapshot "
                f"({', '.join(SELECT_COLUMNS)})"
            ),
            cache_path=cache_path,
            manifest_path=manifest_path,
        )
    return record.raw["rows"]


def _build_identifier_index(
    rows: list[dict[str, Any]],
) -> dict[str, dict[str, str]]:
    """`{alias_prefix -> {normalized_identifier -> hostname}}`, built once
    from the bulk `rows` - one sub-index per identifier column."""
    index: dict[str, dict[str, str]] = {prefix: {} for _, prefix in IDENTIFIER_COLUMNS}
    for row in rows:
        hostname = row.get("hostname")
        if not hostname:
            continue
        for column, prefix in IDENTIFIER_COLUMNS:
            raw_value = row.get(column)
            if not raw_value:
                continue
            index[prefix][_normalize_identifier(str(raw_value))] = hostname
    return index


def find_matching_hostname(
    aliases: list[str], index: dict[str, dict[str, str]]
) -> str | None:
    """Try each identifier type in priority order (HD -> HIP -> TIC ->
    Gaia DR3 -> Gaia DR2, spec AC2) against `aliases`, returning the
    archive's own component-qualified `hostname` for the first hit, or
    `None` if no alias matches any indexed identifier of any type.
    """
    normalized_aliases = [_normalize_identifier(alias) for alias in aliases]
    for _, prefix in IDENTIFIER_COLUMNS:
        prefix_index = index[prefix]
        for alias in normalized_aliases:
            hostname = prefix_index.get(alias)
            if hostname is not None:
                return hostname
    return None


def _planet_from_row(row: dict[str, Any]) -> PlanetSummary:
    return PlanetSummary(
        name=row["pl_name"],
        orbital_period_days=row.get("pl_orbper"),
        minimum_mass_earth=row.get("pl_bmasse"),
        radius_earth=row.get("pl_rade"),
        discovery_method=row.get("discoverymethod") or None,
        discovery_year=row.get("disc_year"),
        discovery_facility=row.get("disc_facility") or None,
    )


class ExoplanetCrossMatcher:
    """Precomputes the identifier index and hostname->planet-rows grouping
    once from a bulk `pscomppars` snapshot (`rows`), then exposes
    `match(aliases)` for repeated, network-free per-star lookups (spec
    AC1: "no additional network round-trips per star") - built once by a
    driver script/test and reused across all 707 catalog stars, rather
    than rebuilding the index on every call.
    """

    def __init__(self, rows: list[dict[str, Any]]) -> None:
        self._index = _build_identifier_index(rows)
        self._by_hostname: dict[str, list[dict[str, Any]]] = {}
        for row in rows:
            hostname = row.get("hostname")
            if hostname:
                self._by_hostname.setdefault(hostname, []).append(row)

    def match(self, aliases: list[str]) -> ExoplanetSummary | None:
        """Cross-match one star's `aliases` (spec AC2/AC3). Returns
        `None` when no identifier matches - the common case (spec: ~97%
        of the 707 stars) - never a fabricated/empty-but-present summary.
        """
        hostname = find_matching_hostname(aliases, self._index)
        if hostname is None:
            return None
        planets = [
            _planet_from_row(row) for row in self._by_hostname.get(hostname, [])
        ]
        if not planets:
            return None
        return ExoplanetSummary(
            count=len(planets),
            planets=planets,
            source_reference=SOURCE_REFERENCE,
            source_url=SOURCE_URL,
        )


def match_exoplanets(
    aliases: list[str], rows: list[dict[str, Any]]
) -> ExoplanetSummary | None:
    """Convenience one-shot cross-match for a single star against `rows`
    (builds a throwaway `ExoplanetCrossMatcher`). For matching many stars
    against the same bulk snapshot, construct one `ExoplanetCrossMatcher`
    and call `.match()` repeatedly instead, to avoid rebuilding the index
    per star.
    """
    return ExoplanetCrossMatcher(rows).match(aliases)
