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

Issue #221 (10 popular Messier nebulae) surfaced two further SIMBAD/
astroquery quirks, both handled here rather than by any caller:

1. Requesting the `V` votable field turns the underlying query into a
   join that returns *zero rows* for any object with no cataloged
   apparent V magnitude - previously documented (`data/raw/gap_fills/
   README.md`) as a "Mizar-specific alias quirk", but empirically it is
   not alias-specific at all: several bright, well-known extended
   objects (M1/the Crab Nebula, M42/the Orion Nebula, M8, M16, M17, M20)
   hit the exact same zero-row join failure, purely because they are
   diffuse nebulae with no single point-source V magnitude on file, not
   because the identifier itself is unresolvable. `_query_upstream` now
   retries once without `V` whenever the first attempt returns zero
   rows; a genuinely unresolvable name still returns zero rows on the
   retry too and falls through to the same honest `ValueError` as
   before.
2. Extended/diffuse objects are not point sources and typically have no
   measured trigonometric parallax at all (`plx_value` absent), even
   once resolved - true for every one of the six objects above. Rather
   than failing resolution outright, `_query_upstream` falls back to
   SIMBAD's own `mesDistance` table (literature-cited distances "by
   several means", still a real, traceable SIMBAD-served value, never
   fabricated) when `plx_value` is unusable, preferring a `mesDistance`
   row whose bibcode is `2020A&A...633A..51Z` (Zucker et al. 2020) when
   present - the same paper this catalog's own `literature.py`-sourced
   molecular clouds already cite (`data/normalized/
   initial_catalog_records.json`'s `taurus-molecular-cloud` etc.), for
   consistency - and otherwise the first row SIMBAD returns. See
   `_query_mes_distance`/`_normalize` below.
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

#: `mesDistance` bibcode preferred when a record has more than one
#: measurement on file (module docstring, quirk 2) - Zucker et al. 2020,
#: already this catalog's own citation for its other literature-sourced
#: extended structures (molecular clouds), so reusing it here keeps
#: distance provenance consistent across the catalog rather than picking
#: an arbitrary different paper per object.
_PREFERRED_MESDISTANCE_BIBCODE = "2020A&A...633A..51Z"

#: `mesDistance.unit` -> parsec multiplier. SIMBAD's own three units for
#: this table (values arrive with trailing whitespace, e.g. `"pc  "`,
#: hence the `.strip()` at the call site).
_MESDISTANCE_UNIT_TO_PC = {"pc": 1.0, "kpc": 1_000.0, "mpc": 1_000_000.0}


def _mes_distance_to_pc(value: float, unit: str | None) -> float | None:
    """Convert one `mesDistance.dist` value to parsecs given its
    `mesDistance.unit`. Returns `None` (never fabricates/guesses) for an
    unrecognized or missing unit."""
    if unit is None:
        return None
    factor = _MESDISTANCE_UNIT_TO_PC.get(unit.strip().lower())
    if factor is None:
        return None
    return value * factor


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

    def _query_object_with_fields(
        self, name: str, *, include_v: bool
    ) -> dict[str, Any] | None:
        """One `query_object` call for the standard field set, optionally
        without `V` (see module docstring, quirk 1). Returns `None` (never
        raises) on zero rows, so `_query_upstream` can decide whether to
        retry or give up."""
        client = AstroquerySimbad()
        fields = ["plx_value", "plx_err", "ids", "otype", "sp_type"]
        if include_v:
            fields.append("V")
        client.add_votable_fields(*fields)
        table = client.query_object(name)
        if table is None or len(table) == 0:
            return None
        return table_row_to_dict(table, 0)

    def _query_mes_distance(self, name: str) -> dict[str, Any] | None:
        """Fallback distance lookup via SIMBAD's `mesDistance` table (see
        module docstring, quirk 2) - only ever called when the standard
        query already returned a record but with no usable `plx_value`.
        Returns `None` (never fabricates) if SIMBAD has no `mesDistance`
        measurement on file either."""
        client = AstroquerySimbad()
        client.add_votable_fields("mesDistance")
        table = client.query_object(name)
        if table is None or len(table) == 0:
            return None
        rows = [table_row_to_dict(table, i) for i in range(len(table))]
        preferred = next(
            (r for r in rows if r.get("mesdistance.bibcode") == _PREFERRED_MESDISTANCE_BIBCODE),
            None,
        )
        row = preferred or rows[0]
        dist = row.get("mesdistance.dist")
        if dist is None:
            return None
        distance_pc = _mes_distance_to_pc(dist, row.get("mesdistance.unit"))
        if distance_pc is None:
            return None
        method = (row.get("mesdistance.method") or "").strip() or None
        return {
            "pc": distance_pc,
            "bibcode": row.get("mesdistance.bibcode"),
            "method": method,
        }

    def _query_upstream(self, name: str) -> dict[str, Any]:
        raw = self._query_object_with_fields(name, include_v=True)
        if raw is None:
            # Quirk 1 (module docstring): a zero-row result with `V`
            # requested can mean either "no such object" or "object
            # exists but has no cataloged V magnitude". Retry without `V`
            # to tell the two apart honestly.
            raw = self._query_object_with_fields(name, include_v=False)
        if raw is None:
            raise ValueError(f"SIMBAD has no record for {name!r}")

        plx_mas = raw.get("plx_value")
        if plx_mas is None or plx_mas <= 0:
            # Quirk 2 (module docstring): no usable parallax - try the
            # mesDistance fallback rather than failing resolution outright.
            # `_normalize` still raises if this also comes back empty.
            mes = self._query_mes_distance(name)
            if mes is not None:
                raw["mesdistance_pc"] = mes["pc"]
                raw["mesdistance_bibcode"] = mes["bibcode"]
                raw["mesdistance_method"] = mes["method"]
        return raw

    def _extract_record_id(self, name: str, raw: dict[str, Any]) -> str:
        return str(raw.get("main_id") or name)

    def _normalize(self, name: str, record: CacheRecord) -> AstronomicalObject:
        raw = record.raw
        plx_mas = raw.get("plx_value")
        mesdistance_pc = raw.get("mesdistance_pc")
        mesdistance_note = ""
        mesdistance_bibcode = None
        if plx_mas is not None and plx_mas > 0:
            distance_pc = _PARALLAX_MAS_TO_PC / plx_mas
            plx_err_mas = raw.get("plx_err")
            error_pc = (
                distance_pc * (plx_err_mas / plx_mas)
                if plx_err_mas is not None
                else None
            )
        elif mesdistance_pc is not None:
            # Quirk 2 (module docstring): no usable parallax on file - this
            # is the common case for extended/diffuse objects, which are
            # not point sources. Fall back to SIMBAD's own `mesDistance`
            # table instead of failing resolution outright. No error
            # estimate is available from this source (unlike the
            # parallax-derived path above), so `error_pc` stays `None`
            # rather than fabricating one.
            distance_pc = mesdistance_pc
            error_pc = None
            mesdistance_bibcode = raw.get("mesdistance_bibcode")
            method = raw.get("mesdistance_method")
            mesdistance_note = (
                f" No usable SIMBAD parallax on file; distance instead "
                f"taken from SIMBAD's mesDistance table (bibcode "
                f"{mesdistance_bibcode}"
                + (f", method {method}" if method else "")
                + ")."
            )
        else:
            raise ValueError(
                f"SIMBAD record for {name!r} has no usable parallax "
                "(plx_value) and no mesDistance fallback - cannot derive "
                "a distance."
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
                    + (
                        f", mesDistance bibcode {mesdistance_bibcode}"
                        if mesdistance_bibcode
                        else ""
                    )
                ),
                url=f"https://simbad.cds.unistra.fr/simbad/sim-id?Ident={record.record_id}",
                catalog="SIMBAD",
            ),
            notes=(
                f"Retrieved from SIMBAD on {record.retrieved_utc}; "
                f"upstream record id: {record.record_id}; "
                f"otype: {raw.get('otype')}."
                f"{mesdistance_note}"
            ),
        )
        return derive_galactic_coordinates(obj)
