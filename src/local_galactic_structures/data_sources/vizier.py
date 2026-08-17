"""VizieR adapter (spec Idea.md §12).

Queries `astroquery.vizier.Vizier` and normalizes the response into an
`AstronomicalObject` (spec §7), deriving real Galactic l/b and Cartesian
XYZ via `coordinates.derive_galactic_coordinates()` (spec §6).

VizieR hosts thousands of independent catalogs, each with its own column
naming - there is no single universal "VizieR schema". This adapter is
therefore constructed against one specific catalog (VizieR catalog id,
e.g. `"I/355/gaiadr3"` for Gaia DR3 as republished on VizieR) plus the
column names within that catalog for RA/Dec/parallax (defaulted to the
Gaia-DR3-on-VizieR convention `RA_ICRS`/`DE_ICRS`/`Plx`/`e_Plx`, which is
shared by most VizieR-republished Gaia-derived catalogs, but overridable
for catalogs that use different names).

Record identifiers (spec §11) are taken from whichever of the catalog's
own `Source` (Gaia-style) or `recno` (generic VizieR row number) columns
is present. If a catalog has neither, `_extract_record_id` does **not**
fall back to some other column value (in particular not the `_r`
cone-search angular-separation column added by `_query_upstream` for
match selection, which is a distance in arcsec, not an identifier) -
it returns an explicit `"<catalog>:no-stable-identifier-available:<query>"`
marker instead, so the absence of a stable id is traceable rather than
silently masked by a value that merely looks like one.

Live network access to VizieR (https://vizier.cds.unistra.fr) was
confirmed reachable from this environment during development (see PR
description for what was tried).
"""

from __future__ import annotations

from pathlib import Path
from typing import Any

from astroquery.vizier import Vizier as AstroqueryVizier

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


class VizierResolver(CachingObjectResolver):
    """`ObjectResolver` backed by one specific VizieR catalog (spec §12)."""

    SOURCE_NAME = "vizier"

    def __init__(
        self,
        catalog: str,
        *,
        object_type: str = "star",
        ra_column: str = "RA_ICRS",
        dec_column: str = "DE_ICRS",
        parallax_column: str | None = "Plx",
        parallax_error_column: str | None = "e_Plx",
        cache_dir: str | None = None,
        manifest_path: str | None = None,
    ) -> None:
        super().__init__(cache_dir=cache_dir, manifest_path=manifest_path)
        self.catalog = catalog
        self.object_type = object_type
        self.ra_column = ra_column
        self.dec_column = dec_column
        self.parallax_column = parallax_column
        self.parallax_error_column = parallax_error_column

    def _cache_path(self, name: str) -> Path:
        # Namespace by catalog too: the same object name queried against
        # two different VizieR catalogs must not collide in the cache.
        return self.cache_dir / slugify(self.catalog) / f"{slugify(name)}.json"

    def _dataset_label(self) -> str:
        return f"VizieR catalog {self.catalog}"

    def _query_upstream(self, name: str) -> dict[str, Any]:
        # "+_r" asks VizieR to also return each row's angular separation
        # from the name-resolved query coordinate and to sort results by
        # it ascending - a name query is a cone search that can return
        # many field sources near the target, and the nearest one is the
        # only defensible choice of "the" match without additional
        # disambiguation (e.g. cross-matching on brightness/proper
        # motion), which is out of scope for this generic adapter.
        client = AstroqueryVizier(columns=["*", "+_r"])
        result = client.query_object(name, catalog=self.catalog)
        if result is None or len(result) == 0:
            raise ValueError(
                f"VizieR catalog {self.catalog!r} has no record for {name!r}"
            )
        table = result[0]
        if len(table) == 0:
            raise ValueError(
                f"VizieR catalog {self.catalog!r} returned an empty table "
                f"for {name!r}"
            )
        return table_row_to_dict(table, 0)

    #: Marker used when a VizieR catalog provides neither a `Source` nor a
    #: `recno` column - i.e. no genuinely stable per-row identifier is
    #: available. Deliberately not silently replaced by some other
    #: column's value (in particular not `_r`, the cone-search angular
    #: separation, which is a *distance*, not an identifier - spec §11
    #: requires a traceable record identifier, and a distance masquerading
    #: as one is worse than admitting there isn't one).
    NO_STABLE_IDENTIFIER = "no-stable-identifier-available"

    def _extract_record_id(self, name: str, raw: dict[str, Any]) -> str:
        stable_id = raw.get("Source") or raw.get("recno")
        if stable_id is None:
            # Fold the query name in so two different queries against
            # this catalog that both lack a stable id still get distinct
            # record ids (and distinct AstronomicalObject.id values,
            # since `id=slugify(record.record_id)` derives from this)
            # instead of silently colliding.
            return f"{self.catalog}:{self.NO_STABLE_IDENTIFIER}:{name}"
        return f"{self.catalog}:{stable_id}"

    def _normalize(self, name: str, record: CacheRecord) -> AstronomicalObject:
        raw = record.raw
        if self.ra_column not in raw or self.dec_column not in raw:
            raise ValueError(
                f"VizieR catalog {self.catalog!r} response is missing "
                f"expected columns {self.ra_column!r}/{self.dec_column!r} "
                f"- got {sorted(raw.keys())}"
            )

        distance_pc: float | None = None
        error_pc: float | None = None
        if self.parallax_column and raw.get(self.parallax_column):
            plx_mas = raw[self.parallax_column]
            if plx_mas and plx_mas > 0:
                distance_pc = _PARALLAX_MAS_TO_PC / plx_mas
                plx_err = (
                    raw.get(self.parallax_error_column)
                    if self.parallax_error_column
                    else None
                )
                if plx_err is not None:
                    error_pc = distance_pc * (plx_err / plx_mas)

        if distance_pc is None:
            raise ValueError(
                f"VizieR catalog {self.catalog!r} record for {name!r} has "
                "no usable parallax - cannot derive a distance. Pass "
                "parallax_column=None only for catalogs that report "
                "distance directly (not yet supported by this adapter)."
            )

        obj = AstronomicalObject(
            id=slugify(record.record_id),
            name=name,
            aliases=[],
            object_type=self.object_type,
            coordinates=Coordinates(
                ra_deg=float(raw[self.ra_column]),
                dec_deg=float(raw[self.dec_column]),
                galactic_l_deg=0.0,
                galactic_b_deg=0.0,
            ),
            distance=Distance(value_pc=distance_pc, error_pc=error_pc),
            cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
            source=Source(
                reference=f"VizieR catalog {self.catalog}, record {record.record_id}",
                url=f"https://vizier.cds.unistra.fr/viz-bin/VizieR-4?-source={self.catalog}",
                catalog=f"VizieR:{self.catalog}",
            ),
            notes=(
                f"Retrieved from VizieR ({self.catalog}) on "
                f"{record.retrieved_utc}; upstream record id: "
                f"{record.record_id}."
            ),
        )
        return derive_galactic_coordinates(obj)
