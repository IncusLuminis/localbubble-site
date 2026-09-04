"""Zucker et al. 2020 molecular-cloud-distance Vizier table adapter (Story
#318, follow-on to Epic #313).

This catalog's original 8 `molecular_cloud` records (spec `Idea.md` §9's
own minimum seed list) already cite Zucker, C., Speagle, J. S., Schlafly,
E. F., Green, G. M., Finkbeiner, D. P., Goodman, A. A., & Alves, J.
(2020), "A compendium of distances to molecular clouds in the Star
Formation Handbook", Astronomy & Astrophysics, 633, A51
(arXiv:2001.00591) for their DISTANCE specifically - but as a hand-cited
literature value at the time those 8 were curated, not a live machine
query. This module queries the REAL, machine-readable VizieR table
(`J/A+A/633/A51/handbook`) directly via astroquery, mirroring
`cluster_radius.py`'s own whole-table fetch-and-cache pattern for exactly
the same reason that module documents: this is a bulk, ~326-row reference
table (94 named sightline groups covering ~60 star-forming regions, with
several sightlines per group), not a per-object cone search - fetched and
cached ONCE, as a whole, rather than per-object.

**Why this matters (issue #318's own warning):** a first research pass for
this Story hit a real, silent-corruption trap - extracting distances from
a scraped/AI-summarized version of the paper's own prose got at least one
value visibly wrong. Querying the actual VizieR table rows (via
`astroquery.vizier`, requesting every column with `columns=["**"]` - the
default VizieR query only returns a handful of "recommended" columns,
silently dropping the `d16`/`d84` percentile columns error_pc depends on)
avoids that failure mode entirely.

**Distance-uncertainty convention** (`J/A+A/633/A51`'s own ReadMe,
Description section - not implemented as a table column at all, since it
is a same-for-many-rows footnote, not per-row data): "There is an
additional systematic uncertainty, which is unknown but estimated to be
~5% in distance for clouds <1.5kpc, ~10% in distance for clouds >1.5kpc,
and ~7% in distance for the southern clouds Lupus, Chamaeleon, and Corona
Australis. These should be added in quadrature with the statistical
uncertainties reported in the table." `systematic_fraction_for` below
implements exactly this rule; `quadrature_error_pc` combines it with the
table's own `d16`/`d50`/`d84` percentiles the same way this catalog's
existing 8 molecular_cloud records' own `source.reference` text already
describes doing by hand ("distance.error_pc is sqrt(mean(statistical
+/-)^2 + systematic^2)").

**Matching convention** (see `data/raw/gap_fills/README.md`'s Story #318
section and each new record's own `source`/`notes` fields for the full
per-candidate writeup): a candidate's DISTANCE/position-anchor sightline
is the table row with the smallest angular separation, on the sky, from
that candidate's own SIMBAD identification-only position - regardless of
which `Name` group label that nearest row happens to carry. The `Name`
column is the paper's own loose grouping label for sightlines aimed at
the same broad complex, not a strict cross-catalog identity key; nothing
in the paper or this catalog's own established two-step convention
(Chamaeleon/Lupus/etc.'s own `source.reference` text) requires an exact
string match between a candidate's common name and the row's `Name`
label, only physical proximity. `nearest_row` below implements this
directly; `nearest_row_within_group` is provided for when a caller
specifically wants to consider only same-named rows (used during this
Story's own research to establish just how far the "Aquila_Rift"-named
group in the table sits from SIMBAD's own "NAME Aql Rift" position - the
key finding behind that candidate's exclusion).
"""

from __future__ import annotations

import json
import math
from pathlib import Path
from typing import Any

from astropy.coordinates import SkyCoord
import astropy.units as u
from astroquery.vizier import Vizier as AstroqueryVizier

from . import REPO_ROOT, table_row_to_dict

DEFAULT_CACHE_DIR = REPO_ROOT / "data" / "raw" / "zucker_molecular_clouds"
CACHE_FILENAME = "zucker_2020_handbook_table1.json"

CATALOG = "J/A+A/633/A51/handbook"

#: Named sightline groups the paper's own ReadMe explicitly calls out for
#: the higher ~7% systematic uncertainty (Description section, verbatim:
#: "~7% in distance for the southern clouds Lupus, Chamaeleon, and Corona
#: Australis").
SOUTHERN_SEVEN_PERCENT_GROUPS = {"Lupus", "Chamaeleon", "Corona_Australis"}


def load_zucker_2020_handbook(
    *, cache_dir: str | Path | None = None, force_refresh: bool = False, timeout: float = 120.0
) -> list[dict[str, Any]]:
    """Fetch (or load from cache) the full Zucker et al. 2020 Star
    Formation Handbook sightline table, every column (`columns=["**"]` -
    without this, VizieR's default column subset silently omits `d16`/
    `d84`, `SimbadName`, and `recno`), as a flat list of row-dicts.

    Cached under `cache_dir` (default `data/raw/zucker_molecular_clouds/`)
    after the first live fetch, mirroring `cluster_radius.py`'s own
    whole-table caching (no per-fetch manifest entry, same precedent that
    module already establishes for a bulk reference table rather than a
    per-object cone search).
    """
    cache_dir = Path(cache_dir) if cache_dir is not None else DEFAULT_CACHE_DIR
    cache_path = cache_dir / CACHE_FILENAME

    if cache_path.exists() and not force_refresh:
        return json.loads(cache_path.read_text())

    client = AstroqueryVizier(row_limit=-1, timeout=timeout, columns=["**"])
    tables = client.get_catalogs(CATALOG)
    if not tables:
        raise ValueError(f"VizieR catalog {CATALOG!r} returned no tables")
    table = tables[0]
    rows = [table_row_to_dict(table, i) for i in range(len(table))]

    cache_dir.mkdir(parents=True, exist_ok=True)
    cache_path.write_text(json.dumps(rows, indent=2))
    return rows


def nearest_row(
    ra_deg: float, dec_deg: float, rows: list[dict[str, Any]]
) -> tuple[dict[str, Any], float]:
    """The row in `rows` nearest `(ra_deg, dec_deg)` by angular separation
    on the sky (via each row's own VizieR-computed `_RA.icrs`/`_DE.icrs`),
    regardless of that row's own `Name` label - see module docstring's
    "Matching convention" section for why this does not require a
    same-name match. Returns `(row, separation_deg)`."""
    target = SkyCoord(ra=ra_deg * u.deg, dec=dec_deg * u.deg, frame="icrs")
    table_coords = SkyCoord(
        ra=[r["_RA.icrs"] for r in rows] * u.deg,
        dec=[r["_DE.icrs"] for r in rows] * u.deg,
        frame="icrs",
    )
    seps = target.separation(table_coords).deg
    best_index = min(range(len(rows)), key=lambda i: seps[i])
    return rows[best_index], float(seps[best_index])


def nearest_row_within_group(
    ra_deg: float, dec_deg: float, rows: list[dict[str, Any]], name: str
) -> tuple[dict[str, Any], float] | None:
    """Same as `nearest_row`, restricted to rows whose own `Name` column
    equals `name` exactly. Returns `None` if no row carries that name at
    all."""
    group_rows = [r for r in rows if r.get("Name") == name]
    if not group_rows:
        return None
    return nearest_row(ra_deg, dec_deg, group_rows)


def systematic_fraction_for(name: str) -> float:
    """The paper's own distance-dependent/region-dependent systematic
    uncertainty fraction for a row's `Name` group (module docstring). Only
    the <1.5kpc/southern-cloud cases are relevant to this Story (every
    candidate considered is well under 1.5kpc); the >1.5kpc 10% case is
    included for completeness even though nothing in this Story's own
    candidate set reaches it."""
    if name in SOUTHERN_SEVEN_PERCENT_GROUPS:
        return 0.07
    return 0.05


def quadrature_error_pc(d16: float, d50: float, d84: float, systematic_fraction: float) -> float:
    """`sqrt(mean(|d50-d16|, |d84-d50|)^2 + (systematic_fraction * d50)^2)`
    - the same statistical/systematic quadrature-sum convention this
    catalog's existing 8 molecular_cloud records' own `source.reference`
    text already describes applying by hand (e.g.
    `chamaeleon-molecular-cloud`: "distance.error_pc is sqrt(mean
    (statistical +/-)^2 + systematic^2)")."""
    statistical = (abs(d50 - d16) + abs(d84 - d50)) / 2.0
    systematic = systematic_fraction * d50
    return math.sqrt(statistical**2 + systematic**2)
