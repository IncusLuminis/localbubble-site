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

Story #230 additionally requests the `pmra`/`pmdec` (proper motion, mas/yr
- `pmra` is already SIMBAD's own cos(dec)-corrected convention, matching
astropy's `pm_ra_cosdec` parameter directly) and `rvz_radvel` (radial
velocity, km/s) VOTable fields, deriving `schema.Velocity` via
`coordinates.galactic_velocity_kms` - the same ICRS -> Galactic transform
already applied to position, so the resulting XYZ velocity lands in the
identical heliocentric Galactic Cartesian frame as `cartesian.{x,y,z}_pc`.
See `_derive_velocity` below for the two "never fabricate" cases: `pmra`/
`pmdec` absent -> `velocity: None` entirely; present but `rvz_radvel`
absent -> a tangential-only vector with `radial_velocity_known: False`
(astropy silently defaults radial velocity to 0 rather than erroring, so
this must be tracked explicitly, not left implicit).

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

Issue #234 (`V* EZ Aqr`/GJ 866, found by the Validator reviewing Story
#231/PR #233) surfaced a third quirk: SIMBAD's default `rvz_radvel` for
that identifier is `6824.7` km/s (bibcode `2021MNRAS.508.5148C`), which
combined with its proper motion produces an implausible ~6825 km/s space
velocity for a quiet, nearby (3.4 pc) RECONS M dwarf - live-verified as
the genuine, unambiguous SIMBAD "basic" response for every alias of this
star (`GJ 866`, `GJ 866 A/B/C`, `V* EZ Aqr`, `EZ Aqr` all resolve to the
same `main_id` and the same bad value), so this is not a
component-resolution mismatch (the "A"/"B"/"C" split cache files for this
system, `data/raw/simbad/gj_866_{a,b,c}.json`, are a pre-existing
RECONS-side artifact of one star having three separately-catalogued
RECONS components, per issue #104's own dedup note already in this
record's `notes` field - not the cause of this bug). SIMBAD's own
`mesVelocities` table (all individual RV/redshift measurements on file,
not just the one `rvz_radvel` surfaces as "the" default) shows two older,
independent bibcodes (`1995A&AS..114..269D`, `1953GCRV..C......0W`, both
4-measurement means) agreeing at `-60.0` km/s - matching the ~-59.9 km/s
this issue itself cites from the literature - while only the newest
bibcode disagrees by two orders of magnitude, strongly suggesting *that*
bibcode's cross-match (not this pipeline's own unit handling, which was
verified correct against this exact case) is where the bad value
originates. `_query_upstream` now treats any `|rvz_radvel| >
_IMPLAUSIBLE_RV_KMS_THRESHOLD` as suspect and queries `mesVelocities` for
a plausible alternative bibcode/measurement, the same "corrected re-query
over a real, traceable, differently-sourced SIMBAD value" shape as the
`mesDistance` fallback above - never overwriting the original
`rvz_radvel`/`rvz_bibcode` raw fields (spec §13: raw data is never
modified in place), only adding new `rvz_radvel_corrected`/
`rvz_bibcode_corrected`/`rvz_correction_note` keys alongside them. If no
plausible alternative measurement exists either, the star instead falls
back honestly to `radial_velocity_known: False` (tangential-only,
proper-motion-derived vector) rather than propagating the bad value. See
`_query_mes_velocities`/`_derive_velocity` below, and `data/raw/
gap_fills/README.md` for this specific star's investigation writeup.
"""

from __future__ import annotations

import math
from typing import Any

from astroquery.simbad import Simbad as AstroquerySimbad

from . import CacheRecord, CachingObjectResolver, slugify, table_row_to_dict
from ..coordinates import derive_galactic_coordinates, galactic_velocity_kms
from ..schema import (
    AstronomicalObject,
    Cartesian,
    Coordinates,
    Distance,
    Source,
    Velocity,
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

#: A radial velocity beyond this magnitude (km/s) is treated as suspect
#: (module docstring, quirk 3 / issue #234) and triggers a `mesVelocities`
#: cross-check rather than being propagated as-is. Set well above any
#: real velocity this catalog's own stars have ever shown (known "flying
#: stars" like 61 Cygni A top out around 100-110 km/s per Story #230's own
#: spot-checks; even genuine Galactic disk/halo stars are essentially
#: never RV-only above a few hundred km/s) so a real, unusually fast but
#: legitimate star would not be misflagged - while still catching a
#: two-orders-of-magnitude cross-match artifact like V* EZ Aqr's `6824.7`
#: km/s default.
_IMPLAUSIBLE_RV_KMS_THRESHOLD = 500.0


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


def _derive_velocity(
    raw: dict[str, Any],
    *,
    ra_deg: float,
    dec_deg: float,
    distance_pc: float,
    record_id: str,
) -> Velocity | None:
    """Derive `schema.Velocity` from a SIMBAD raw record's `pmra`/`pmdec`/
    `rvz_radvel` fields (Story #230). See `Velocity`'s own docstring for
    the full optionality story - the two cases handled here:

    * `pmra`/`pmdec` themselves absent -> the whole velocity is
      unresolvable, returns `None` (never a fabricated zero vector).
    * `pmra`/`pmdec` present but `rvz_radvel` absent -> radial velocity
      defaults to 0 km/s (astropy does this silently), and
      `radial_velocity_known` is set `False` so this tangential-only
      vector is never presented as a complete 3D space velocity.

    A third case, added for issue #234 (module docstring, quirk 3): when
    `_query_upstream` flagged the default `rvz_radvel` as implausible
    (`|rvz_radvel| > _IMPLAUSIBLE_RV_KMS_THRESHOLD`), it never overwrites
    `raw["rvz_radvel"]`/`raw["rvz_bibcode"]` themselves (raw data is never
    modified in place) - instead it adds `rvz_radvel_corrected`/
    `rvz_bibcode_corrected` (a plausible alternative from SIMBAD's own
    `mesVelocities` table, if one exists) and/or `rvz_correction_note`
    (always present when flagged, explaining what happened either way).
    This method prefers the corrected value when present; otherwise, if
    the star was flagged with no plausible alternative found, it treats
    radial velocity as unknown (same as the "absent" case above) rather
    than propagating the bad default.
    """
    pmra = raw.get("pmra")
    pmdec = raw.get("pmdec")
    if pmra is None or pmdec is None:
        return None

    correction_note = raw.get("rvz_correction_note")
    if raw.get("rvz_radvel_corrected") is not None:
        rv = raw["rvz_radvel_corrected"]
        rvz_bibcode = raw.get("rvz_bibcode_corrected")
    elif correction_note is not None:
        # Flagged as implausible with no plausible mesVelocities
        # alternative - honest fallback, never propagate the bad value.
        rv = None
        rvz_bibcode = None
    else:
        rv = raw.get("rvz_radvel")
        rvz_bibcode = raw.get("rvz_bibcode")

    radial_velocity_known = rv is not None
    vx, vy, vz = galactic_velocity_kms(
        ra_deg, dec_deg, distance_pc, pmra, pmdec, rv if rv is not None else 0.0
    )

    pm_bibcode = raw.get("pm_bibcode")
    reference = f"SIMBAD astronomical database (CDS), record {record_id}"
    if pm_bibcode:
        reference += f", pm bibcode {pm_bibcode}"
    if radial_velocity_known and rvz_bibcode:
        reference += f", rv bibcode {rvz_bibcode}"
    if not radial_velocity_known:
        reference += " (no rvz_radvel on file - tangential-only vector)"
    if correction_note:
        reference += f" [{correction_note}]"

    return Velocity(
        vx_kms=vx,
        vy_kms=vy,
        vz_kms=vz,
        radial_velocity_known=radial_velocity_known,
        source=Source(
            reference=reference,
            url=f"https://simbad.cds.unistra.fr/simbad/sim-id?Ident={record_id}",
            catalog="SIMBAD",
        ),
    )


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
        return (
            "SIMBAD basic identifier query "
            "(ra, dec, parallax, sp_type, V, pmra, pmdec, rvz_radvel)"
        )

    def _query_object_with_fields(
        self, name: str, *, include_v: bool
    ) -> dict[str, Any] | None:
        """One `query_object` call for the standard field set, optionally
        without `V` (see module docstring, quirk 1). Returns `None` (never
        raises) on zero rows, so `_query_upstream` can decide whether to
        retry or give up."""
        client = AstroquerySimbad()
        fields = [
            "plx_value",
            "plx_err",
            "ids",
            "otype",
            "sp_type",
            # Story #230: proper motion (mas/yr, pmra already SIMBAD's own
            # cos(dec)-corrected convention) + radial velocity (km/s), plus
            # each field's own bibcode for Velocity.source provenance -
            # verified live against astroquery 0.4.11 (see module
            # docstring).
            "pmra",
            "pmdec",
            "rvz_radvel",
            "pm_bibcode",
            "rvz_bibcode",
        ]
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

    def _query_mes_velocities(self, name: str) -> dict[str, Any] | None:
        """Fallback radial-velocity lookup via SIMBAD's `mesVelocities`
        table (see module docstring, quirk 3 / issue #234) - only ever
        called when the standard query's default `rvz_radvel` is already
        flagged implausible. Returns the first row (in SIMBAD's own
        `mespos` order) whose `|velvalue|` is plausible, or `None` (never
        fabricates) if every measurement on file is equally implausible or
        the table itself is empty."""
        client = AstroquerySimbad()
        client.add_votable_fields("mesVelocities")
        table = client.query_object(name)
        if table is None or len(table) == 0:
            return None
        rows = [table_row_to_dict(table, i) for i in range(len(table))]
        for row in rows:
            value = row.get("mesvelocities.velvalue")
            veltype = (row.get("mesvelocities.veltype") or "").strip().lower()
            # Only accept true velocity measurements (km/s), not redshifts
            # ("z") or cz - `mesVelocities` mixes all of these into one
            # `velvalue` column with `veltype` distinguishing units, and
            # this fallback must not silently mix a dimensionless redshift
            # into a km/s field.
            if veltype not in ("", "v"):
                continue
            if value is None or abs(value) > _IMPLAUSIBLE_RV_KMS_THRESHOLD:
                continue
            return {
                "kms": value,
                "bibcode": row.get("mesvelocities.bibcode"),
                "nbmes": row.get("mesvelocities.nbmes"),
            }
        return None

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

        rv = raw.get("rvz_radvel")
        if rv is not None and abs(rv) > _IMPLAUSIBLE_RV_KMS_THRESHOLD:
            # Quirk 3 (module docstring, issue #234): the default
            # rvz_radvel looks like a bad cross-match. Never overwrite the
            # original rvz_radvel/rvz_bibcode (raw data is never modified
            # in place) - add separate corrected/note keys instead, which
            # `_derive_velocity` consults.
            alt = self._query_mes_velocities(name)
            if alt is not None:
                raw["rvz_radvel_corrected"] = alt["kms"]
                raw["rvz_bibcode_corrected"] = alt["bibcode"]
                raw["rvz_correction_note"] = (
                    f"Default SIMBAD rvz_radvel ({rv} km/s, bibcode "
                    f"{raw.get('rvz_bibcode')}) is implausible for a "
                    f"resolved star (|rv| > {_IMPLAUSIBLE_RV_KMS_THRESHOLD} "
                    "km/s) - likely a bad upstream cross-match. Corrected "
                    "via SIMBAD's own mesVelocities table to a plausible "
                    f"independent measurement ({alt['kms']} km/s, bibcode "
                    f"{alt['bibcode']}); never fabricated."
                )
            else:
                raw["rvz_correction_note"] = (
                    f"Default SIMBAD rvz_radvel ({rv} km/s, bibcode "
                    f"{raw.get('rvz_bibcode')}) is implausible for a "
                    f"resolved star (|rv| > {_IMPLAUSIBLE_RV_KMS_THRESHOLD} "
                    "km/s) and no plausible alternative measurement was "
                    "found in SIMBAD's mesVelocities table - treated as "
                    "unknown (radial_velocity_known=False) rather than "
                    "propagating the bad value."
                )
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

        velocity = _derive_velocity(
            raw,
            ra_deg=float(raw["ra"]),
            dec_deg=float(raw["dec"]),
            distance_pc=distance_pc,
            record_id=record.record_id,
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
            velocity=velocity,
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
