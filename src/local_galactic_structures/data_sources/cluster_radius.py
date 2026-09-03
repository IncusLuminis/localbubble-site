"""Open-cluster/association structural-radius adapter (Story #314, Epic
#313).

This catalog's `star_cluster`/`stellar_association` records were resolved
against SIMBAD by name (`data_sources/simbad.py`), but many carry a
`source.reference` `coo_bibcode` of `2021A&A...647A..19T` (Tarricq et al.
2021, "3D kinematics and age of OCs") - a member/kinematics companion to
Cantat-Gaudin et al.'s Gaia-DR2-membership open-cluster catalog lineage
(spec `Idea.md`'s own hint: "Cl Alessi", "[KC2019] Theia 75"-style naming
indicates this family). That 2021 paper itself has no structural-radius
table, but its sibling paper does:

* **Tarricq et al. 2022** ("Structural parameters of 389 local open
  clusters", VizieR `J/A+A/659/A59/table1`) fits a King-profile-derived
  core radius (`Rc`) and tidal radius (`Rt`) - both **already in parsecs**
  (verified via the VOTable column `unit` metadata during development,
  not assumed) - per cluster. This is the closest available match to this
  catalog's own existing precedent: the one already-populated cluster
  record (Pleiades, `pleiades-open-cluster`, `size_pc: 11.6`) states
  explicitly in its own `notes` that this value **is a tidal radius, not a
  diameter** (from a different paper, Lodieu et al. 2019 - Tarricq+2022
  was not available/used at Pleiades' own resolution time - but the same
  physical quantity). `Rt` is preferred when present; `Rc` (core radius -
  still a radius, just a smaller structural definition) is used as a
  same-catalog fallback when `Rt` is masked but `Rc` is not, rather than
  discarding a usable row entirely.
* **Cantat-Gaudin et al. 2020** ("Gaia DR2 open clusters in the Milky Way.
  II", VizieR `J/A+A/633/A99/table1`) is the larger (1481-row) parent
  catalog Tarricq et al. 2022's own 389-cluster "local" subset draws from,
  covering many more of this catalog's own cluster/association records.
  It publishes `r50` (the radius containing 50% of a cluster's Gaia
  members) - again a genuine structural RADIUS, not a diameter - but
  **in degrees**, not parsecs (also verified via VOTable unit metadata,
  not assumed): `r50_pc` below converts it via the record's own already-
  populated `distance_pc`, the same small-angle approximation
  `data_sources.simbad_size.diameter_pc_from_angular_size` uses for the
  diffuse-structure side of this Story, just producing a radius from an
  already-angular-radius value rather than a diameter from an angular
  diameter.

Both catalogs are fetched and cached **once, as a whole table** (each
~400-1500 rows) rather than per-object like `simbad.py`/`vizier.py`'s
per-name queries - there is no per-object name-resolution cone-search
here, just a bulk table dump matched locally by name, which is both far
fewer network round-trips and immune to VizieR's Sesame name-resolver not
recognizing catalog-internal identifiers like `[KPR2005] 112` (verified
during development: `Vizier.query_object` against such names frequently
returns nothing, while the bulk table itself carries a `SimbadName` column
using this catalog's own exact SIMBAD-identifier spelling for matching).

Matching: each cataloged row carries both its own `Cluster` designation
(the originating paper's own naming, e.g. `Alessi_8`, underscore-joined)
and a `SimbadName` column (SIMBAD's own identifier spelling for the same
object, e.g. `[KPR2005] 10`) - the latter matches this project's own
catalog `name` field directly for the large majority of records (both
ultimately trace to the same SIMBAD cross-match), so it is tried first;
the `Cluster` column (space-vs-underscore normalized) is a fallback for
the remainder.
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from astroquery.vizier import Vizier as AstroqueryVizier

from . import REPO_ROOT, table_row_to_dict

DEFAULT_CACHE_DIR = REPO_ROOT / "data" / "raw" / "cluster_radius"

TARRICQ_2022_CATALOG = "J/A+A/659/A59/table1"
CANTAT_GAUDIN_2020_CATALOG = "J/A+A/633/A99/table1"

TARRICQ_2022_CACHE_FILENAME = "tarricq_2022_structural_parameters_table1.json"
CANTAT_GAUDIN_2020_CACHE_FILENAME = "cantat_gaudin_2020_open_clusters_table1.json"


def _fetch_and_cache_table(
    catalog: str, cache_path: Path, *, force_refresh: bool = False, timeout: float = 120.0
) -> list[dict[str, Any]]:
    """Fetch `catalog` (a single VizieR sub-table id, e.g.
    `"J/A+A/659/A59/table1"`) in full (`row_limit=-1`) and cache it as a
    flat list of row-dicts under `cache_path`. Reuses the cache on repeat
    calls unless `force_refresh=True` - these are large, slow-changing
    reference tables, not per-object live lookups, so there is no reason
    to re-fetch them on every script run."""
    if cache_path.exists() and not force_refresh:
        return json.loads(cache_path.read_text())

    client = AstroqueryVizier(row_limit=-1, timeout=timeout)
    tables = client.get_catalogs(catalog)
    if not tables:
        raise ValueError(f"VizieR catalog {catalog!r} returned no tables")
    table = tables[0]
    rows = [table_row_to_dict(table, i) for i in range(len(table))]

    cache_path.parent.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(rows, indent=2))
    return rows


def load_tarricq_2022(
    *, cache_dir: str | Path | None = None, force_refresh: bool = False
) -> list[dict[str, Any]]:
    """Tarricq et al. 2022 structural-parameters table (`Cluster`,
    `SimbadName`, `Rc`/`e_Rc`, `Rt`/`e_Rt`, both already in pc, among
    other columns) - see module docstring."""
    cache_dir = Path(cache_dir) if cache_dir is not None else DEFAULT_CACHE_DIR
    return _fetch_and_cache_table(
        TARRICQ_2022_CATALOG,
        cache_dir / TARRICQ_2022_CACHE_FILENAME,
        force_refresh=force_refresh,
    )


def load_cantat_gaudin_2020(
    *, cache_dir: str | Path | None = None, force_refresh: bool = False
) -> list[dict[str, Any]]:
    """Cantat-Gaudin et al. 2020 open-cluster table (`Cluster`,
    `SimbadName`, `r50` in DEGREES, among other columns) - see module
    docstring."""
    cache_dir = Path(cache_dir) if cache_dir is not None else DEFAULT_CACHE_DIR
    return _fetch_and_cache_table(
        CANTAT_GAUDIN_2020_CATALOG,
        cache_dir / CANTAT_GAUDIN_2020_CACHE_FILENAME,
        force_refresh=force_refresh,
    )


def _norm(value: Any) -> str:
    return " ".join(str(value).split())


def build_name_index(rows: list[dict[str, Any]]) -> tuple[dict[str, int], dict[str, int]]:
    """Two lookup dicts over `rows` (as returned by `load_tarricq_2022`/
    `load_cantat_gaudin_2020`): normalized `SimbadName` -> row index, and
    normalized `Cluster` -> row index. Built once per table and reused
    across every catalog record being matched, rather than re-scanning the
    whole table per lookup."""
    by_simbad: dict[str, int] = {}
    by_cluster: dict[str, int] = {}
    for i, row in enumerate(rows):
        simbad_name = row.get("SimbadName")
        cluster_name = row.get("Cluster")
        if simbad_name:
            by_simbad.setdefault(_norm(simbad_name), i)
        if cluster_name:
            by_cluster.setdefault(_norm(cluster_name), i)
    return by_simbad, by_cluster


def find_row(
    name: str,
    rows: list[dict[str, Any]],
    by_simbad: dict[str, int],
    by_cluster: dict[str, int],
) -> dict[str, Any] | None:
    """Look up `name` (this project's own catalog `name` field, e.g.
    `"Cl Alessi    1"`, `"[KPR2005] 112"`) against one loaded table's name
    index: normalized `SimbadName` match first (spelling-identical to this
    project's own SIMBAD-derived names for the large majority of records),
    then the table's own `Cluster` designation with the `"Cl "` curation
    prefix stripped and internal whitespace collapsed to underscores (this
    project's `"Cl Melotte   20"` <-> the table's own `"Melotte_20"`).
    Returns the matched row dict, or `None` if neither index has it."""
    normalized = _norm(name)
    cluster_style = normalized.removeprefix("Cl ").replace(" ", "_")

    idx = by_simbad.get(normalized)
    if idx is None:
        idx = by_cluster.get(cluster_style)
    if idx is None:
        return None
    return rows[idx]


def r50_pc(row: dict[str, Any], distance_pc: float) -> float | None:
    """Cantat-Gaudin et al. 2020's `r50` (degrees) -> parsecs, via the
    record's own already-populated `distance_pc` and the same small-angle
    approximation `data_sources.simbad_size.diameter_pc_from_angular_size`
    uses (there `majaxis_arcmin -> diameter_pc`; here `r50_deg -> r50_pc`,
    same relation, already-angular-radius in rather than angular-diameter
    in). Returns `None` (never fabricates) if the row has no usable `r50`."""
    value = row.get("r50")
    if value is None:
        return None
    return distance_pc * math.radians(float(value))
