"""Gaia adapter (spec Idea.md §12).

Queries `astroquery.gaia.Gaia` (the Gaia archive TAP service) and
normalizes the response into an `AstronomicalObject` (spec §7), deriving
real Galactic l/b and Cartesian XYZ via
`coordinates.derive_galactic_coordinates()` (spec §6).

Unlike SIMBAD, Gaia has no free-text name resolver of its own - its
namespace is `source_id` (a Gaia DR3 designator). `resolve(name)` on this
adapter therefore expects `name` to *be* a Gaia DR3 source_id, either
bare (`"66727234683960320"`) or prefixed (`"Gaia DR3 66727234683960320"`,
the conventional designator form) - not a free-text object name. This is
a deliberate, honest constraint rather than faking a name lookup Gaia
does not provide; resolving a free-text name to a Gaia source_id is a
SIMBAD/VizieR cross-match concern, which those adapters already cover.

That constraint is enforced, not just documented: `_parse_source_id`
only accepts a 15-19 digit run (real Gaia source_ids fall in that
range) optionally preceded by the literal `"Gaia DR3 "` prefix - it
requires the *whole* input to be one of those two shapes. A free-text
name (`"M 31"`, `"NGC 1976"`, `"HD 23514"`) or a same-shaped designator
from a different data release (`"Gaia DR2 ..."`) is rejected with a
`ValueError` rather than silently coerced into a plausible-but-wrong
source_id - Gaia DR2 and DR3 source_ids are not guaranteed identical
for every source, so accepting a DR2 designator here would risk
querying `gaiadr3.gaia_source` with the wrong id.

Live network access to the Gaia archive TAP service
(https://gea.esac.esa.int) was confirmed reachable from this environment
during development (see PR description for what was tried).
"""

from __future__ import annotations

import re
from typing import Any

from astroquery.gaia import Gaia as AstroqueryGaia

from . import CacheRecord, CachingObjectResolver, slugify, table_row_to_dict
from ..coordinates import derive_galactic_coordinates
from ..schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    Source,
)

_PARALLAX_MAS_TO_PC = 1000.0

#: Real Gaia DR2/DR3 source_ids are 15-19 digit integers (HEALPix-level-12
#: encoded). Requiring the *entire* (stripped) input to match this shape -
#: optionally preceded by the literal "Gaia DR3 " designator prefix - is
#: what actually rejects free-text names and other catalogs' identifiers
#: (Messier/NGC/HD numbers are far shorter) as well as other releases'
#: designators (a literal "Gaia DR2 ..." prefix does not match "Gaia DR3 ").
_GAIA_SOURCE_ID_RE = re.compile(r"(?:gaia\s+dr3\s+)?(\d{15,19})", re.IGNORECASE)


def _parse_source_id(name: str) -> int:
    """Extract the numeric Gaia DR3 source_id from `name`, accepting only
    a bare 15-19 digit id or the `"Gaia DR3 <id>"` designator form -
    anything else (a free-text name, a different catalog's identifier, or
    a differently-labeled release such as "Gaia DR2 ...") is rejected."""
    match = _GAIA_SOURCE_ID_RE.fullmatch(name.strip())
    if not match:
        raise ValueError(
            f"{name!r} is not a Gaia DR3 source_id. The Gaia adapter "
            "resolves by source_id (e.g. '66727234683960320' or "
            "'Gaia DR3 66727234683960320') - a bare 15-19 digit id, "
            "optionally prefixed with the literal 'Gaia DR3 ' designator "
            "- not by free-text name or another catalog's identifier. Use "
            "SimbadResolver or VizierResolver to look up a source_id "
            "for a named object first."
        )
    return int(match.group(1))


class GaiaResolver(CachingObjectResolver):
    """`ObjectResolver` backed by the Gaia archive (spec §12)."""

    SOURCE_NAME = "gaia"

    def __init__(
        self,
        *,
        object_type: str = "star",
        table: str = "gaiadr3.gaia_source",
        cache_dir: str | None = None,
        manifest_path: str | None = None,
    ) -> None:
        super().__init__(cache_dir=cache_dir, manifest_path=manifest_path)
        self.object_type = object_type
        self.table = table

    def _dataset_label(self) -> str:
        return f"Gaia TAP query against {self.table} (ra, dec, parallax)"

    def _query_upstream(self, name: str) -> dict[str, Any]:
        source_id = _parse_source_id(name)
        query = (
            "SELECT source_id, ra, dec, parallax, parallax_error, "
            f"phot_g_mean_mag FROM {self.table} "
            f"WHERE source_id = {source_id}"
        )
        job = AstroqueryGaia.launch_job(query)
        table = job.get_results()
        if table is None or len(table) == 0:
            raise ValueError(f"Gaia has no record for source_id {source_id}")
        return table_row_to_dict(table, 0)

    def _extract_record_id(self, name: str, raw: dict[str, Any]) -> str:
        return f"Gaia DR3 {raw.get('source_id')}"

    def _normalize(self, name: str, record: CacheRecord) -> AstronomicalObject:
        raw = record.raw
        plx_mas = raw.get("parallax")
        if plx_mas is None or plx_mas <= 0:
            raise ValueError(
                f"Gaia record {record.record_id} has no usable parallax "
                "- cannot derive a distance without one."
            )
        distance_pc = _PARALLAX_MAS_TO_PC / plx_mas
        plx_err_mas = raw.get("parallax_error")
        error_pc = (
            distance_pc * (plx_err_mas / plx_mas)
            if plx_err_mas is not None
            else None
        )

        obj = AstronomicalObject(
            id=slugify(record.record_id),
            name=record.record_id,
            aliases=[],
            object_type=self.object_type,
            coordinates=Coordinates(
                ra_deg=float(raw["ra"]),
                dec_deg=float(raw["dec"]),
                galactic_l_deg=0.0,
                galactic_b_deg=0.0,
            ),
            distance=Distance(value_pc=distance_pc, error_pc=error_pc),
            cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
            source=Source(
                reference=f"Gaia Data Release 3, {record.record_id}",
                url=(
                    "https://gea.esac.esa.int/archive/#Source%20id="
                    f"{raw.get('source_id')}"
                ),
                catalog="Gaia DR3",
            ),
            notes=(
                f"Retrieved from Gaia archive TAP ({self.table}) on "
                f"{record.retrieved_utc}; upstream record id: "
                f"{record.record_id}; phot_g_mean_mag: "
                f"{raw.get('phot_g_mean_mag')}."
            ),
        )
        return derive_galactic_coordinates(obj)
