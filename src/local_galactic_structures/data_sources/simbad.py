"""SIMBAD adapter (spec Idea.md §12).

Queries `astroquery.simbad.Simbad` and normalizes the response into an
`AstronomicalObject` (spec §7), deriving real Galactic l/b and Cartesian
XYZ via `coordinates.derive_galactic_coordinates()` (spec §6) rather than
leaving them at placeholder zeros.

SIMBAD's basic identifier query does not itself return a distance, so
this adapter asks for the `plx_value`/`plx_err` VOTable fields (parallax
in mas) and derives `distance_pc = 1000 / plx_value_mas` (small-angle
approximation, standard for parallaxes this size) with the corresponding
propagated error. If SIMBAD has no parallax on file for the resolved
object, `resolve()` raises `ValueError` rather than fabricating a
distance - per spec §11, no scientific value may appear without a
traceable origin, and a distance of 0 is reserved for the Sun (spec §6)
so it cannot be used as an "unknown" placeholder either.

Story #170 additionally requests the `sp_type` (MK spectral type, e.g.
"G2V") and `V` (apparent V-band magnitude/flux) VOTable fields, and
derives `visual.absolute_magnitude` from the latter via the standard
distance modulus (see `absolute_magnitude_from_distance_modulus` below).
Both are stored as `None` when SIMBAD has no usable value on file - never
fabricated. Note the votable field name for apparent V magnitude is `V`,
not the older `flux(V)` syntax some astroquery docs/examples still show:
verified empirically against the installed astroquery 0.4.11
(`Simbad.list_votable_fields()` lists `V` as a "filter name" field, and a
live `query_object` against it returns a `V` column) - `flux(V)` is
rejected by this version.

Live network access to SIMBAD (https://simbad.cds.unistra.fr) was
confirmed reachable from this environment during development (see PR
description for what was tried).
"""

from __future__ import annotations

import math
from typing import Any

from astroquery.simbad import Simbad as AstroquerySimbad

from . import CacheRecord, CachingObjectResolver, slugify, table_row_to_dict
from ..coordinates import derive_galactic_coordinates
from ..schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    Source,
    Visual,
)

#: mas -> pc, small-angle approximation (standard for parallaxes of this
#: size; the same relation astropy's own `Distance(parallax=...)` uses).
_PARALLAX_MAS_TO_PC = 1000.0


def absolute_magnitude_from_distance_modulus(
    apparent_magnitude: float | None, distance_pc: float | None
) -> float | None:
    """Standard distance modulus: `M = m - 5*log10(d_pc) + 5`.

    Pure, unit-testable helper (Story #170 acceptance criteria) - no
    network/IO. Returns `None` (never fabricates a value) when either
    input is missing, or when `distance_pc` is not strictly positive
    (`log10` is undefined at/below 0; a distance of exactly 0 is the Sun/
    origin convention, spec §6, which has no meaningful apparent-magnitude
    -> absolute-magnitude conversion anyway).
    """
    if apparent_magnitude is None or distance_pc is None:
        return None
    if not (distance_pc > 0):
        return None
    return apparent_magnitude - 5.0 * math.log10(distance_pc) + 5.0


class SimbadResolver(CachingObjectResolver):
    """`ObjectResolver` backed by SIMBAD (spec §12)."""

    SOURCE_NAME = "simbad"

    def __init__(
        self,
        *,
        object_type: str = "star",
        cache_dir: str | None = None,
        manifest_path: str | None = None,
    ) -> None:
        super().__init__(cache_dir=cache_dir, manifest_path=manifest_path)
        # Default object_type for objects resolved through this adapter;
        # SIMBAD's own `otype` taxonomy is far richer than spec §8's
        # KNOWN_OBJECT_TYPES and mapping between the two is a curation
        # decision for whoever populates the catalog (Story "Populate &
        # validate initial object catalog"), not this adapter's job - so
        # it is accepted as a simple override instead of guessed here.
        self.object_type = object_type

    def _dataset_label(self) -> str:
        return "SIMBAD basic identifier query (ra, dec, parallax, sp_type, V)"

    def _query_upstream(self, name: str) -> dict[str, Any]:
        client = AstroquerySimbad()
        client.add_votable_fields(
            "plx_value", "plx_err", "ids", "otype", "sp_type", "V"
        )
        table = client.query_object(name)
        if table is None or len(table) == 0:
            raise ValueError(f"SIMBAD has no record for {name!r}")
        return table_row_to_dict(table, 0)

    def _extract_record_id(self, name: str, raw: dict[str, Any]) -> str:
        return str(raw.get("main_id") or name)

    def _normalize(self, name: str, record: CacheRecord) -> AstronomicalObject:
        raw = record.raw
        plx_mas = raw.get("plx_value")
        if plx_mas is None or plx_mas <= 0:
            raise ValueError(
                f"SIMBAD record for {name!r} has no usable parallax "
                "(plx_value) - cannot derive a distance without one."
            )
        distance_pc = _PARALLAX_MAS_TO_PC / plx_mas
        plx_err_mas = raw.get("plx_err")
        error_pc = (
            distance_pc * (plx_err_mas / plx_mas)
            if plx_err_mas is not None
            else None
        )

        ids_field = raw.get("ids") or ""
        aliases = [alias.strip() for alias in ids_field.split("|") if alias.strip()]
        aliases = [a for a in aliases if a != raw.get("main_id")]

        # Spectral type: raw SIMBAD string as-is, no normalization/bucketing
        # (that's a later frontend Story's job) - blank string means "field
        # present but empty on SIMBAD's side", treated the same as absent.
        sp_type = raw.get("sp_type") or None
        apparent_v_mag = raw.get("V")
        absolute_magnitude = absolute_magnitude_from_distance_modulus(
            apparent_v_mag, distance_pc
        )

        obj = AstronomicalObject(
            id=slugify(record.record_id),
            name=raw.get("main_id") or name,
            aliases=aliases,
            object_type=self.object_type,
            coordinates=Coordinates(
                ra_deg=float(raw["ra"]),
                dec_deg=float(raw["dec"]),
                galactic_l_deg=0.0,
                galactic_b_deg=0.0,
            ),
            distance=Distance(value_pc=distance_pc, error_pc=error_pc),
            cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
            visual=Visual(
                spectral_type=sp_type,
                absolute_magnitude=absolute_magnitude,
                apparent_magnitude=apparent_v_mag,
            ),
            source=Source(
                reference=(
                    f"SIMBAD astronomical database (CDS), record "
                    f"{record.record_id}"
                    + (f", coo_bibcode {raw['coo_bibcode']}" if raw.get("coo_bibcode") else "")
                ),
                url=f"https://simbad.cds.unistra.fr/simbad/sim-id?Ident={record.record_id}",
                catalog="SIMBAD",
            ),
            notes=(
                f"Retrieved from SIMBAD on {record.retrieved_utc}; "
                f"upstream record id: {record.record_id}; "
                f"otype: {raw.get('otype')}."
            ),
        )
        return derive_galactic_coordinates(obj)
