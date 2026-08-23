"""Tests for the data acquisition layer (spec Idea.md §12, §11, §14 -
Story #58): the shared `ObjectResolver` interface, caching machinery, each
adapter's normalization logic against canned/monkeypatched upstream
responses, and `literature.py`'s construct-and-validate path.

None of the tests below (other than the ones explicitly gated behind
`LGS_RUN_NETWORK_TESTS=1`, see the bottom of this file) touch the
network: each live-query adapter isolates its actual network call in
`_query_upstream`, which is monkeypatched here with fixed, real-shaped
response data captured from manual interactive runs against SIMBAD/
Gaia/VizieR during development (see the PR description for what those
manual runs found).
"""

from __future__ import annotations

import os
from pathlib import Path

import pytest
import yaml
from pydantic import ValidationError

from local_galactic_structures.data_sources import (
    CacheRecord,
    CachingObjectResolver,
    ObjectResolver,
    read_cache,
    slugify,
    update_manifest,
    write_cache,
)
from local_galactic_structures.data_sources.gaia import GaiaResolver, _parse_source_id
from local_galactic_structures.data_sources.literature import (
    LiteratureResolver,
    build_object_from_literature,
)
from local_galactic_structures.data_sources.nasa_exoplanet_archive import (
    ExoplanetCrossMatcher,
    _build_identifier_index,
    _normalize_identifier,
    _row_value_to_python,
    find_matching_hostname,
    load_or_fetch_pscomppars_rows,
    match_exoplanets,
)
from local_galactic_structures.data_sources.simbad import (
    SimbadResolver,
    absolute_magnitude_from_distance_modulus,
)
from local_galactic_structures.data_sources.vizier import VizierResolver
from local_galactic_structures.schema import AstronomicalObject

RUN_NETWORK_TESTS = os.environ.get("LGS_RUN_NETWORK_TESTS") == "1"
network = pytest.mark.skipif(
    not RUN_NETWORK_TESTS,
    reason="live network test against SIMBAD/Gaia/VizieR; set "
    "LGS_RUN_NETWORK_TESTS=1 to run it",
)


# ---------------------------------------------------------------------------
# ObjectResolver interface shape (spec §12)
# ---------------------------------------------------------------------------


class TestObjectResolverInterface:
    def test_all_adapters_satisfy_object_resolver_protocol(self):
        simbad = SimbadResolver()
        gaia = GaiaResolver()
        vizier = VizierResolver("I/355/gaiadr3")
        literature = LiteratureResolver()
        for adapter in (simbad, gaia, vizier, literature):
            assert isinstance(adapter, ObjectResolver)

    def test_protocol_requires_only_resolve_by_name(self):
        class MinimalResolver:
            def resolve(self, name: str) -> AstronomicalObject:
                raise NotImplementedError

        assert isinstance(MinimalResolver(), ObjectResolver)

    def test_object_missing_resolve_does_not_satisfy_protocol(self):
        class NotAResolver:
            pass

        assert not isinstance(NotAResolver(), ObjectResolver)


# ---------------------------------------------------------------------------
# Shared cache/manifest machinery
# ---------------------------------------------------------------------------


class TestSlugify:
    def test_slugify_lowercases_and_replaces_punctuation(self):
        assert slugify("Rho Ophiuchi") == "rho_ophiuchi"
        assert slugify("61 Cygni A") == "61_cygni_a"

    def test_slugify_never_empty(self):
        assert slugify("   ") == "unnamed"

    def test_slugify_does_not_collide_on_non_ascii_bayer_designations(self):
        # Regression test (Story #88 Validator review): the original
        # implementation stripped non-ASCII characters entirely, so every
        # "<Greek letter>[superscript digit] <constellation>"-shaped query
        # with no other ASCII content collapsed to the same cache key
        # (e.g. both "omega Ori" and "chi2 Ori" slugified to just "ori"),
        # silently resolving distinct stars to whichever got cached first.
        slugs = {
            slugify(s)
            for s in ["ω Ori", "χ² Ori", "π⁵ Ori", "φ¹ Ori", "ι CMa", "β¹ Sco"]
        }
        assert len(slugs) == 6, f"expected 6 distinct slugs, got {slugs}"


class TestCacheRecordRoundtrip:
    def test_write_then_read_cache_roundtrips(self, tmp_path: Path):
        record = CacheRecord(
            source="simbad",
            query="Pleiades",
            retrieved_utc="2026-08-17T00:00:00+00:00",
            record_id="Cl Melotte 22",
            raw={"ra": 56.6, "dec": 24.1, "plx_value": 7.364},
        )
        path = tmp_path / "pleiades.json"
        write_cache(path, record)
        loaded = read_cache(path)
        assert loaded == record

    def test_read_cache_returns_none_for_missing_file(self, tmp_path: Path):
        assert read_cache(tmp_path / "does_not_exist.json") is None


class TestCacheNeverSilentlyOverwritten:
    def test_second_write_without_allow_overwrite_raises(self, tmp_path: Path):
        path = tmp_path / "record.json"
        first = CacheRecord(
            source="simbad", query="X", retrieved_utc="t0", record_id="r0", raw={}
        )
        write_cache(path, first)

        second = CacheRecord(
            source="simbad", query="X", retrieved_utc="t1", record_id="r1", raw={}
        )
        with pytest.raises(FileExistsError):
            write_cache(path, second)

        # The original cache content must be untouched.
        assert read_cache(path) == first

    def test_allow_overwrite_explicitly_replaces_cache(self, tmp_path: Path):
        path = tmp_path / "record.json"
        first = CacheRecord(
            source="simbad", query="X", retrieved_utc="t0", record_id="r0", raw={}
        )
        write_cache(path, first)

        second = CacheRecord(
            source="simbad", query="X", retrieved_utc="t1", record_id="r1", raw={}
        )
        write_cache(path, second, allow_overwrite=True)
        assert read_cache(path) == second


class TestManifest:
    def test_update_manifest_creates_file_with_entry(self, tmp_path: Path):
        manifest_path = tmp_path / "data_manifest.yaml"
        update_manifest(
            source="simbad",
            query="Pleiades",
            retrieved_utc="2026-08-17T00:00:00+00:00",
            record_id="Cl Melotte 22",
            dataset="SIMBAD basic identifier query",
            cache_path=tmp_path / "simbad" / "pleiades.json",
            manifest_path=manifest_path,
        )
        data = yaml.safe_load(manifest_path.read_text())
        assert len(data["sources"]) == 1
        entry = data["sources"][0]
        assert entry["id"] == "simbad:Pleiades"
        assert entry["retrieved"] == "2026-08-17T00:00:00+00:00"
        assert entry["record_id"] == "Cl Melotte 22"

    def test_update_manifest_updates_existing_entry_in_place(self, tmp_path: Path):
        manifest_path = tmp_path / "data_manifest.yaml"
        kwargs = dict(
            source="simbad",
            query="Pleiades",
            record_id="Cl Melotte 22",
            dataset="SIMBAD basic identifier query",
            cache_path=tmp_path / "simbad" / "pleiades.json",
            manifest_path=manifest_path,
        )
        update_manifest(retrieved_utc="2026-08-17T00:00:00+00:00", **kwargs)
        update_manifest(retrieved_utc="2026-08-18T00:00:00+00:00", **kwargs)

        data = yaml.safe_load(manifest_path.read_text())
        assert len(data["sources"]) == 1  # updated, not duplicated
        assert data["sources"][0]["retrieved"] == "2026-08-18T00:00:00+00:00"

    def test_update_manifest_preserves_unrelated_existing_entries(
        self, tmp_path: Path
    ):
        manifest_path = tmp_path / "data_manifest.yaml"
        update_manifest(
            source="simbad",
            query="Pleiades",
            retrieved_utc="2026-08-17T00:00:00+00:00",
            record_id="r1",
            dataset="d1",
            cache_path=tmp_path / "a.json",
            manifest_path=manifest_path,
        )
        update_manifest(
            source="gaia",
            query="Gaia DR3 1",
            retrieved_utc="2026-08-17T00:00:00+00:00",
            record_id="r2",
            dataset="d2",
            cache_path=tmp_path / "b.json",
            manifest_path=manifest_path,
        )
        data = yaml.safe_load(manifest_path.read_text())
        assert {e["id"] for e in data["sources"]} == {
            "simbad:Pleiades",
            "gaia:Gaia DR3 1",
        }


# ---------------------------------------------------------------------------
# CachingObjectResolver orchestration (cache hit vs. miss, force_refresh,
# manifest only updated on an actual fetch) via a minimal dummy adapter -
# exercises the shared base class without depending on any real service.
# ---------------------------------------------------------------------------


class _DummyResolver(CachingObjectResolver):
    SOURCE_NAME = "dummy"

    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.fetch_count = 0

    def _dataset_label(self) -> str:
        return "dummy dataset"

    def _query_upstream(self, name: str) -> dict:
        self.fetch_count += 1
        return {"ra": 10.0, "dec": 20.0, "plx_mas": 20.0}

    def _extract_record_id(self, name: str, raw: dict) -> str:
        return f"dummy-{name}"

    def _normalize(self, name: str, record: CacheRecord) -> AstronomicalObject:
        from local_galactic_structures.coordinates import derive_galactic_coordinates
        from local_galactic_structures.schema import (
            Cartesian,
            Coordinates,
            Distance,
            Source,
        )

        obj = AstronomicalObject(
            id=slugify(name),
            name=name,
            object_type="star",
            coordinates=Coordinates(
                ra_deg=record.raw["ra"],
                dec_deg=record.raw["dec"],
                galactic_l_deg=0.0,
                galactic_b_deg=0.0,
            ),
            distance=Distance(value_pc=1000.0 / record.raw["plx_mas"]),
            cartesian=Cartesian(x_pc=0.0, y_pc=0.0, z_pc=0.0),
            source=Source(reference=f"Dummy source for {name}", catalog="Dummy"),
            notes=f"Retrieved on {record.retrieved_utc}; record {record.record_id}.",
        )
        return derive_galactic_coordinates(obj)


class TestCachingObjectResolverOrchestration:
    def _make(self, tmp_path: Path) -> _DummyResolver:
        return _DummyResolver(
            cache_dir=tmp_path / "raw" / "dummy",
            manifest_path=tmp_path / "data_manifest.yaml",
        )

    def test_first_resolve_fetches_and_writes_cache_and_manifest(
        self, tmp_path: Path
    ):
        resolver = self._make(tmp_path)
        obj = resolver.resolve("Test Object")
        assert resolver.fetch_count == 1
        assert (tmp_path / "raw" / "dummy" / "test_object.json").exists()
        manifest = yaml.safe_load((tmp_path / "data_manifest.yaml").read_text())
        assert manifest["sources"][0]["id"] == "dummy:Test Object"
        # Real, non-placeholder derived coordinates (spec §12):
        assert (obj.cartesian.x_pc, obj.cartesian.y_pc, obj.cartesian.z_pc) != (
            0.0,
            0.0,
            0.0,
        )

    def test_second_resolve_reuses_cache_without_refetching(self, tmp_path: Path):
        resolver = self._make(tmp_path)
        resolver.resolve("Test Object")
        resolver.resolve("Test Object")
        assert resolver.fetch_count == 1

    def test_second_resolve_does_not_duplicate_manifest_entry(self, tmp_path: Path):
        resolver = self._make(tmp_path)
        resolver.resolve("Test Object")
        resolver.resolve("Test Object")
        manifest = yaml.safe_load((tmp_path / "data_manifest.yaml").read_text())
        assert len(manifest["sources"]) == 1

    def test_force_refresh_refetches_and_overwrites_cache(self, tmp_path: Path):
        resolver = self._make(tmp_path)
        resolver.resolve("Test Object")
        resolver.resolve("Test Object", force_refresh=True)
        assert resolver.fetch_count == 2

    def test_different_names_each_get_their_own_cache_entry(self, tmp_path: Path):
        resolver = self._make(tmp_path)
        resolver.resolve("Object A")
        resolver.resolve("Object B")
        assert resolver.fetch_count == 2
        assert (tmp_path / "raw" / "dummy" / "object_a.json").exists()
        assert (tmp_path / "raw" / "dummy" / "object_b.json").exists()

    def test_cache_content_preserves_provenance_fields(self, tmp_path: Path):
        resolver = self._make(tmp_path)
        resolver.resolve("Test Object")
        record = read_cache(tmp_path / "raw" / "dummy" / "test_object.json")
        assert record.source == "dummy"
        assert record.retrieved_utc  # non-empty retrieval date
        assert record.record_id == "dummy-Test Object"


# ---------------------------------------------------------------------------
# SimbadResolver normalization (monkeypatched _query_upstream - no network)
# ---------------------------------------------------------------------------

# Real-shaped response captured from a manual, interactive SIMBAD query for
# "Pleiades" during development (see PR description).
_SIMBAD_PLEIADES_RAW = {
    "main_id": "Cl Melotte   22",
    "ra": 56.600833333333334,
    "dec": 24.11388888888889,
    "coo_bibcode": "2021A&A...647A..19T",
    "plx_value": 7.364,
    "plx_err": 0.005,
    "ids": (
        "[KC2019] Theia  369|C 0344+239|NAME Pleiades|NAME Seven Sisters|"
        "Cl Melotte   22"
    ),
    "otype": "OpC",
    # Real-shaped sp_type/V fields (Story #170) - a cluster's aggregate
    # entry has neither on file, which is the common/expected case for
    # non-stellar SIMBAD records and exercises the "field absent" path.
    "sp_type": None,
    "V": None,
}

# Real-shaped single-star response (captured from a live `query_object`
# against astroquery 0.4.11 during Story #170 development - see module
# docstring / PR description) with both new fields present.
_SIMBAD_SIRIUS_RAW = {
    "main_id": "* alf CMa",
    "ra": 101.28715533333335,
    "dec": -16.71611586111111,
    "coo_bibcode": "2007A&A...474..653V",
    "plx_value": 379.21,
    "plx_err": 1.58,
    "ids": "* alf CMa|NAME Sirius|HD  48915",
    "otype": "SB*",
    "sp_type": "A0mA1Va",
    "V": -1.46,
}


class TestSimbadResolver:
    def _resolver(self, tmp_path: Path) -> SimbadResolver:
        return SimbadResolver(
            object_type="star_cluster",
            cache_dir=tmp_path / "raw" / "simbad",
            manifest_path=tmp_path / "data_manifest.yaml",
        )

    def test_resolve_normalizes_known_fields(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(_SIMBAD_PLEIADES_RAW)
        )
        obj = resolver.resolve("Pleiades")
        assert obj.name == "Cl Melotte   22"
        assert obj.object_type == "star_cluster"
        assert obj.coordinates.ra_deg == pytest.approx(56.600833333333334)
        assert obj.coordinates.dec_deg == pytest.approx(24.11388888888889)
        # distance_pc = 1000 / parallax_mas
        assert obj.distance.value_pc == pytest.approx(1000.0 / 7.364)
        assert obj.distance.error_pc is not None and obj.distance.error_pc > 0
        assert "NAME Pleiades" in obj.aliases
        assert "Cl Melotte   22" not in obj.aliases  # main_id excluded from aliases

    def test_resolve_derives_real_nonzero_galactic_coordinates(
        self, tmp_path: Path, monkeypatch
    ):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(_SIMBAD_PLEIADES_RAW)
        )
        obj = resolver.resolve("Pleiades")
        assert obj.coordinates.galactic_l_deg != 0.0
        assert obj.coordinates.galactic_b_deg != 0.0
        assert obj.cartesian.x_pc != 0.0
        assert obj.cartesian.y_pc != 0.0

    def test_resolve_populates_provenance(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(_SIMBAD_PLEIADES_RAW)
        )
        obj = resolver.resolve("Pleiades")
        assert obj.source.reference  # non-empty, traceable
        assert obj.source.catalog == "SIMBAD"
        assert obj.source.url is not None and "Cl Melotte" in obj.source.url
        assert obj.notes is not None
        assert "SIMBAD" in obj.notes
        assert "record id" in obj.notes

    def test_resolve_raises_without_usable_parallax(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        raw = dict(_SIMBAD_PLEIADES_RAW)
        raw["plx_value"] = None
        monkeypatch.setattr(resolver, "_query_upstream", lambda name: raw)
        with pytest.raises(ValueError, match="parallax"):
            resolver.resolve("Pleiades")

    def test_resolve_caches_and_does_not_refetch(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        calls = []

        def fake_query(name):
            calls.append(name)
            return dict(_SIMBAD_PLEIADES_RAW)

        monkeypatch.setattr(resolver, "_query_upstream", fake_query)
        resolver.resolve("Pleiades")
        resolver.resolve("Pleiades")
        assert len(calls) == 1

    # -- Story #170: spectral_type / absolute_magnitude -------------------

    def test_resolve_populates_spectral_type_and_absolute_magnitude_when_present(
        self, tmp_path: Path, monkeypatch
    ):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(_SIMBAD_SIRIUS_RAW)
        )
        obj = resolver.resolve("Sirius")
        assert obj.visual.spectral_type == "A0mA1Va"
        # M = m - 5*log10(d_pc) + 5, d_pc = 1000 / 379.21
        import math

        distance_pc = 1000.0 / 379.21
        expected = -1.46 - 5.0 * math.log10(distance_pc) + 5.0
        assert obj.visual.absolute_magnitude == pytest.approx(expected)

    def test_resolve_nulls_spectral_type_and_absolute_magnitude_when_absent(
        self, tmp_path: Path, monkeypatch
    ):
        # _SIMBAD_PLEIADES_RAW has sp_type=None, V=None - the common case
        # for a non-stellar/aggregate SIMBAD record with neither on file.
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(_SIMBAD_PLEIADES_RAW)
        )
        obj = resolver.resolve("Pleiades")
        assert obj.visual.spectral_type is None
        assert obj.visual.absolute_magnitude is None

    def test_resolve_nulls_absolute_magnitude_when_only_v_mag_missing(
        self, tmp_path: Path, monkeypatch
    ):
        # sp_type present, V absent - the two fields must fail independently,
        # never fail (or fabricate) the whole record.
        resolver = self._resolver(tmp_path)
        raw = dict(_SIMBAD_SIRIUS_RAW)
        raw["V"] = None
        monkeypatch.setattr(resolver, "_query_upstream", lambda name: raw)
        obj = resolver.resolve("Sirius")
        assert obj.visual.spectral_type == "A0mA1Va"
        assert obj.visual.absolute_magnitude is None

    def test_resolve_nulls_spectral_type_when_blank_string(
        self, tmp_path: Path, monkeypatch
    ):
        # SIMBAD can return an empty string rather than an absent column -
        # treated the same as "no spectral type on file", not a real value.
        resolver = self._resolver(tmp_path)
        raw = dict(_SIMBAD_SIRIUS_RAW)
        raw["sp_type"] = ""
        monkeypatch.setattr(resolver, "_query_upstream", lambda name: raw)
        obj = resolver.resolve("Sirius")
        assert obj.visual.spectral_type is None

    def test_query_upstream_requests_sp_type_and_v_votable_fields(
        self, tmp_path: Path, monkeypatch
    ):
        # Confirms the exact votable field names this Story settled on
        # (spec §170: `flux(V)` is rejected by the installed astroquery
        # version - `V` is the working name, verified empirically) without
        # hitting the network: monkeypatch AstroquerySimbad itself and
        # inspect what add_votable_fields was called with.
        import local_galactic_structures.data_sources.simbad as simbad_module

        recorded_fields = []

        class FakeClient:
            def add_votable_fields(self, *fields):
                recorded_fields.extend(fields)

            def query_object(self, name):
                return None

        monkeypatch.setattr(
            simbad_module, "AstroquerySimbad", lambda: FakeClient()
        )
        resolver = self._resolver(tmp_path)
        with pytest.raises(ValueError, match="no record"):
            resolver._query_upstream("Sirius")
        assert "sp_type" in recorded_fields
        assert "V" in recorded_fields


# ---------------------------------------------------------------------------
# absolute_magnitude_from_distance_modulus (Story #170, pure function)
# ---------------------------------------------------------------------------


class TestAbsoluteMagnitudeFromDistanceModulus:
    def test_matches_known_value_for_sirius(self):
        # Sirius: V = -1.46, parallax 379.21 mas -> d_pc = 1000/379.21.
        # Known real absolute magnitude of Sirius A is ~1.4.
        distance_pc = 1000.0 / 379.21
        result = absolute_magnitude_from_distance_modulus(-1.46, distance_pc)
        assert result == pytest.approx(1.43, abs=0.05)

    def test_ten_parsecs_is_a_no_op(self):
        # By definition, M == m at exactly 10 pc.
        assert absolute_magnitude_from_distance_modulus(
            7.5, 10.0
        ) == pytest.approx(7.5)

    def test_returns_none_when_apparent_magnitude_missing(self):
        assert absolute_magnitude_from_distance_modulus(None, 10.0) is None

    def test_returns_none_when_distance_missing(self):
        assert absolute_magnitude_from_distance_modulus(5.0, None) is None

    def test_returns_none_when_both_missing(self):
        assert absolute_magnitude_from_distance_modulus(None, None) is None

    def test_returns_none_rather_than_raising_for_zero_distance(self):
        # 0 pc is the Sun/origin convention (spec §6); log10(0) is
        # undefined, so this must degrade to None, not raise.
        assert absolute_magnitude_from_distance_modulus(5.0, 0.0) is None

    def test_returns_none_rather_than_raising_for_negative_distance(self):
        assert absolute_magnitude_from_distance_modulus(5.0, -3.0) is None

    def test_farther_distance_yields_brighter_negative_absolute_magnitude(self):
        # Same apparent brightness at a farther distance implies the star
        # is intrinsically more luminous (a more negative M).
        near = absolute_magnitude_from_distance_modulus(5.0, 10.0)
        far = absolute_magnitude_from_distance_modulus(5.0, 100.0)
        assert far < near


# ---------------------------------------------------------------------------
# GaiaResolver normalization (monkeypatched _query_upstream - no network)
# ---------------------------------------------------------------------------

# Real-shaped response captured from a manual TAP query for a real Gaia DR3
# source_id during development (see PR description).
_GAIA_RAW = {
    "source_id": 66727234683960320,
    "ra": 56.760485086776846,
    "dec": 24.149991010998228,
    "parallax": 7.36,
    "parallax_error": 0.02484166,
    "phot_g_mean_mag": 14.433147,
}


class TestGaiaResolver:
    def _resolver(self, tmp_path: Path) -> GaiaResolver:
        return GaiaResolver(
            cache_dir=tmp_path / "raw" / "gaia",
            manifest_path=tmp_path / "data_manifest.yaml",
        )

    def test_parse_source_id_accepts_bare_and_designator_forms(self):
        assert _parse_source_id("66727234683960320") == 66727234683960320
        assert _parse_source_id("Gaia DR3 66727234683960320") == 66727234683960320

    def test_parse_source_id_rejects_free_text_name(self):
        with pytest.raises(ValueError, match="source_id"):
            _parse_source_id("Pleiades")

    def test_parse_source_id_rejects_other_catalogs_short_numeric_ids(self):
        # Regression test (Validator review of PR #76): the previous regex
        # `r"(\d+)\s*$"` matched *any* trailing digit run, so these all
        # silently "resolved" to a plausible-looking-but-wrong source_id
        # (e.g. "M 31" -> 31) instead of being rejected. Real Gaia
        # source_ids are 15-19 digits; Messier/NGC/HD numbers are far
        # shorter and must not be accepted as one.
        for bogus in ("M 31", "NGC 1976", "HD 23514", "31", "1976"):
            with pytest.raises(ValueError, match="source_id"):
                _parse_source_id(bogus)

    def test_parse_source_id_rejects_wrong_data_release_designator(self):
        # A same-shaped designator from a different Gaia data release must
        # not be silently accepted - DR2 and DR3 source_ids are not
        # guaranteed identical for every source, and this adapter only
        # ever queries `gaiadr3.gaia_source`.
        with pytest.raises(ValueError, match="source_id"):
            _parse_source_id("Gaia DR2 66727234683960320")
        with pytest.raises(ValueError, match="source_id"):
            _parse_source_id("Gaia DR1 66727234683960320")

    def test_resolve_normalizes_known_fields(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(resolver, "_query_upstream", lambda name: dict(_GAIA_RAW))
        obj = resolver.resolve("Gaia DR3 66727234683960320")
        assert obj.coordinates.ra_deg == pytest.approx(56.760485086776846)
        assert obj.distance.value_pc == pytest.approx(1000.0 / 7.36)
        assert obj.distance.error_pc is not None

    def test_resolve_derives_real_nonzero_cartesian(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(resolver, "_query_upstream", lambda name: dict(_GAIA_RAW))
        obj = resolver.resolve("Gaia DR3 66727234683960320")
        assert obj.cartesian.x_pc != 0.0

    def test_resolve_populates_provenance(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(resolver, "_query_upstream", lambda name: dict(_GAIA_RAW))
        obj = resolver.resolve("Gaia DR3 66727234683960320")
        assert obj.source.catalog == "Gaia DR3"
        assert "66727234683960320" in obj.source.reference
        assert obj.notes is not None and "Gaia" in obj.notes

    def test_resolve_raises_without_usable_parallax(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        raw = dict(_GAIA_RAW)
        raw["parallax"] = None
        monkeypatch.setattr(resolver, "_query_upstream", lambda name: raw)
        with pytest.raises(ValueError, match="parallax"):
            resolver.resolve("Gaia DR3 66727234683960320")


# ---------------------------------------------------------------------------
# VizierResolver normalization (monkeypatched _query_upstream - no network)
# ---------------------------------------------------------------------------

# Real-shaped response captured from a manual VizieR query against
# I/355/gaiadr3 during development (see PR description).
_VIZIER_RAW = {
    "RA_ICRS": 217.39356944287,
    "DE_ICRS": -62.69982441330,
    "Source": 5853494207692668160,
    "Plx": 0.1496 * 1000,  # a nearby-ish test value, in mas
    "e_Plx": 0.0288,
}


class TestVizierResolver:
    def _resolver(self, tmp_path: Path) -> VizierResolver:
        return VizierResolver(
            "I/355/gaiadr3",
            cache_dir=tmp_path / "raw" / "vizier",
            manifest_path=tmp_path / "data_manifest.yaml",
        )

    def test_resolve_normalizes_known_fields(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(_VIZIER_RAW)
        )
        obj = resolver.resolve("Test Star")
        assert obj.coordinates.ra_deg == pytest.approx(217.39356944287)
        assert obj.distance.value_pc == pytest.approx(1000.0 / _VIZIER_RAW["Plx"])

    def test_resolve_derives_real_nonzero_cartesian(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(_VIZIER_RAW)
        )
        obj = resolver.resolve("Test Star")
        assert obj.cartesian.z_pc != 0.0

    def test_resolve_populates_provenance(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(_VIZIER_RAW)
        )
        obj = resolver.resolve("Test Star")
        assert obj.source.catalog == "VizieR:I/355/gaiadr3"
        assert "I/355/gaiadr3" in obj.source.reference

    def test_cache_path_is_namespaced_by_catalog(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(_VIZIER_RAW)
        )
        resolver.resolve("Test Star")
        assert (
            tmp_path / "raw" / "vizier" / "i_355_gaiadr3" / "test_star.json"
        ).exists()

    def test_resolve_raises_without_usable_parallax(self, tmp_path: Path, monkeypatch):
        resolver = self._resolver(tmp_path)
        raw = dict(_VIZIER_RAW)
        raw["Plx"] = None
        monkeypatch.setattr(resolver, "_query_upstream", lambda name: raw)
        with pytest.raises(ValueError, match="parallax"):
            resolver.resolve("Test Star")

    def test_resolve_raises_when_expected_columns_missing(
        self, tmp_path: Path, monkeypatch
    ):
        resolver = self._resolver(tmp_path)
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: {"unexpected": 1}
        )
        with pytest.raises(ValueError, match="missing expected columns"):
            resolver.resolve("Test Star")

    def test_record_id_does_not_fall_back_to_angular_separation_column(
        self, tmp_path: Path, monkeypatch
    ):
        # Regression test (Validator review of PR #76): a catalog without
        # `Source`/`recno` columns must NOT have its record identifier
        # silently set to `_r` (the cone-search angular separation, a
        # distance in arcsec) - that masquerades a measurement as a
        # traceable id (spec §11). It must fall back to an explicit
        # "no stable identifier" marker instead.
        resolver = self._resolver(tmp_path)
        raw_without_source_or_recno = {
            "RA_ICRS": 217.39356944287,
            "DE_ICRS": -62.69982441330,
            "Plx": 149.6,
            "e_Plx": 0.0288,
            "_r": 0.0209,  # must not end up in record_id/AstronomicalObject.id
        }
        monkeypatch.setattr(
            resolver, "_query_upstream", lambda name: dict(raw_without_source_or_recno)
        )
        obj = resolver.resolve("Test Star")

        assert "0.0209" not in obj.id
        assert "0.0209" not in obj.notes
        assert VizierResolver.NO_STABLE_IDENTIFIER in obj.notes

        cached = read_cache(
            tmp_path / "raw" / "vizier" / "i_355_gaiadr3" / "test_star.json"
        )
        assert cached.record_id == (
            f"I/355/gaiadr3:{VizierResolver.NO_STABLE_IDENTIFIER}:Test Star"
        )
        assert "0.0209" not in cached.record_id

    def test_record_id_prefers_source_column_when_present(self, tmp_path: Path):
        resolver = self._resolver(tmp_path)
        assert (
            resolver._extract_record_id("Test Star", dict(_VIZIER_RAW))
            == f"I/355/gaiadr3:{_VIZIER_RAW['Source']}"
        )

    def test_record_id_falls_back_to_recno_when_source_absent(self, tmp_path: Path):
        resolver = self._resolver(tmp_path)
        raw = {"recno": 42}
        assert resolver._extract_record_id("Test Star", raw) == "I/355/gaiadr3:42"


# ---------------------------------------------------------------------------
# NasaExoplanetArchive adapter (Story #171): bulk-fetch-then-local-match
# architecture + cross-matching logic, including the multi-component-system
# case (spec AC3). None of the tests below (other than the one explicitly
# gated behind LGS_RUN_NETWORK_TESTS=1) touch the network - the bulk fetch
# is isolated in `fetch_pscomppars_rows`, monkeypatched here exactly like
# every other adapter's `_query_upstream`.
# ---------------------------------------------------------------------------

# Real-shaped rows (columns matching SELECT_COLUMNS) captured from manual
# live `query_criteria` pulls against `pscomppars` during development (see
# PR description) - GJ 876's four confirmed planets, and Proxima
# Centauri's two.
_GJ876_ROWS = [
    {
        "hostname": "GJ 876",
        "hd_name": "",
        "hip_name": "HIP 113020",
        "tic_id": "TIC 188580272",
        "gaia_dr2_id": "Gaia DR2 2603090003484152064",
        "gaia_dr3_id": "Gaia DR3 2603090003484152064",
        "pl_name": "GJ 876 b",
        "pl_orbper": 61.1166,
        "pl_bmasse": 723.2235,
        "pl_rade": 13.3,
        "pl_orbsmax": 0.2083,
        "pl_orbeccen": 0.0324,
        "discoverymethod": "Radial Velocity",
        "disc_year": 1998,
        "disc_facility": "Multiple Observatories",
    },
    {
        "hostname": "GJ 876",
        "hd_name": "",
        "hip_name": "HIP 113020",
        "tic_id": "TIC 188580272",
        "gaia_dr2_id": "Gaia DR2 2603090003484152064",
        "gaia_dr3_id": "Gaia DR3 2603090003484152064",
        "pl_name": "GJ 876 c",
        "pl_orbper": 30.0881,
        "pl_bmasse": 226.9846,
        "pl_rade": 14.0,
        # Story #181: verified live against the archive.
        "pl_orbsmax": 0.12959,
        "pl_orbeccen": 0.25591,
        "discoverymethod": "Radial Velocity",
        "disc_year": 2000,
        "disc_facility": "Multiple Observatories",
    },
    {
        "hostname": "GJ 876",
        "hd_name": "",
        "hip_name": "HIP 113020",
        "tic_id": "TIC 188580272",
        "gaia_dr2_id": "Gaia DR2 2603090003484152064",
        "gaia_dr3_id": "Gaia DR3 2603090003484152064",
        "pl_name": "GJ 876 d",
        "pl_orbper": 1.93778,
        "pl_bmasse": 6.83,
        "pl_rade": 2.51,
        "pl_orbsmax": 0.02080,
        "pl_orbeccen": 0.207,
        "discoverymethod": "Radial Velocity",
        "disc_year": 2005,
        "disc_facility": "W. M. Keck Observatory",
    },
    {
        "hostname": "GJ 876",
        "hd_name": "",
        "hip_name": "HIP 113020",
        "tic_id": "TIC 188580272",
        "gaia_dr2_id": "Gaia DR2 2603090003484152064",
        "gaia_dr3_id": "Gaia DR3 2603090003484152064",
        "pl_name": "GJ 876 e",
        "pl_orbper": 124.26,
        "pl_bmasse": 14.6,
        "pl_rade": 3.92,
        "pl_orbsmax": 0.3343,
        "pl_orbeccen": 0.055,
        "discoverymethod": "Radial Velocity",
        "disc_year": 2010,
        "disc_facility": "W. M. Keck Observatory",
    },
]

_PROXIMA_ROWS = [
    {
        "hostname": "Proxima Cen",
        "hd_name": "",
        "hip_name": "HIP 70890",
        "tic_id": "TIC 388857263",
        "gaia_dr2_id": "Gaia DR2 5853498713160606720",
        "gaia_dr3_id": "Gaia DR3 5853498713190525696",
        "pl_name": "Proxima Cen b",
        "pl_orbper": 11.18465,
        "pl_bmasse": 1.055,
        "pl_rade": 1.02,
        "pl_orbsmax": 0.04856,
        "pl_orbeccen": 0.109,
        "discoverymethod": "Radial Velocity",
        "disc_year": 2016,
        "disc_facility": "European Southern Observatory",
    },
    {
        "hostname": "Proxima Cen",
        "hd_name": "",
        "hip_name": "HIP 70890",
        "tic_id": "TIC 388857263",
        "gaia_dr2_id": "Gaia DR2 5853498713160606720",
        "gaia_dr3_id": "Gaia DR3 5853498713190525696",
        "pl_name": "Proxima Cen d",
        "pl_orbper": 5.12338,
        "pl_bmasse": 0.26,
        "pl_rade": None,  # non-transiting - real, common case
        "pl_orbsmax": 0.02885,
        "pl_orbeccen": None,  # not well-constrained for this detection
        "discoverymethod": "Radial Velocity",
        "disc_year": 2025,
        "disc_facility": "La Silla Observatory",
    },
]

# Synthetic (but archive-shaped) multi-star-component system - spec AC3's
# scenario: two SIMBAD-distinct catalog stars ("Alf Cen A" and "Alf Cen B")
# that share a bare system name but are separate physical components with
# their own distinct HD/HIP/TIC/Gaia identifiers in the archive, only one
# of which (B) has a confirmed planet on file. A substring match on the
# bare "Alf Cen" name would incorrectly attach B's planet to A as well;
# an identifier match must not.
_ALF_CEN_ROWS = [
    {
        "hostname": "Alf Cen B",
        "hd_name": "HD 128621",
        "hip_name": "HIP 71681",
        "tic_id": "TIC 471011144",
        "gaia_dr2_id": "Gaia DR2 5853087267337602880",
        "gaia_dr3_id": "Gaia DR3 5853087262742454272",
        "pl_name": "Alf Cen B b",
        "pl_orbper": 3.2357,
        "pl_bmasse": 1.13,
        "pl_rade": None,
        "pl_orbsmax": 0.04,
        "pl_orbeccen": None,
        "discoverymethod": "Radial Velocity",
        "disc_year": 2012,
        "disc_facility": "La Silla Observatory",
    },
]

_ALF_CEN_A_ALIASES = [
    "GJ 559 A",
    "HD 128620",
    "HIP 71683",
    "TIC 471011145",
    "Gaia DR3 5853087267337600128",
]
_ALF_CEN_B_ALIASES = [
    "GJ 559 B",
    "HD  128621",  # SIMBAD-style double-space padding
    "HIP 71681",
    "TIC 471011144",
    "Gaia DR2 5853087267337602880",
]


class TestNasaExoplanetArchiveNormalization:
    def test_normalize_identifier_collapses_whitespace_and_uppercases(self):
        assert _normalize_identifier("HD  20794") == "HD 20794"
        assert _normalize_identifier("hd 20794") == "HD 20794"
        assert _normalize_identifier("  HIP   15510  ") == "HIP 15510"

    def test_row_value_to_python_returns_plain_values_unchanged(self):
        assert _row_value_to_python("HD 2039") == "HD 2039"
        assert _row_value_to_python(2002) == 2002
        assert _row_value_to_python(None) is None


class TestNasaExoplanetArchiveCrossMatching:
    def test_matches_single_planet_host_by_hip(self):
        # Proxima Centauri's real aliases (from web/public/data/scene.json)
        # carry no HD designation, only HIP/TIC/Gaia - HIP is next in
        # priority order.
        aliases = [
            "TIC 388857263",
            "GJ 551",
            "HIP 70890",
            "Gaia DR3 5853498713190525696",
        ]
        summary = match_exoplanets(aliases, _PROXIMA_ROWS)
        assert summary is not None
        assert summary.count == 2
        assert {p.name for p in summary.planets} == {
            "Proxima Cen b",
            "Proxima Cen d",
        }

    def test_null_radius_is_preserved_for_non_transiting_planet(self):
        aliases = ["HIP 70890"]
        summary = match_exoplanets(aliases, _PROXIMA_ROWS)
        by_name = {p.name: p for p in summary.planets}
        assert by_name["Proxima Cen d"].radius_earth is None
        assert by_name["Proxima Cen b"].radius_earth == 1.02

    def test_semi_major_axis_and_eccentricity_are_matched(self):
        # Story #181: verified live values for GJ 876 c.
        aliases = ["TIC 188580272", "GJ 876", "HIP 113020"]
        summary = match_exoplanets(aliases, _GJ876_ROWS)
        by_name = {p.name: p for p in summary.planets}
        assert by_name["GJ 876 c"].semi_major_axis_au == 0.12959
        assert by_name["GJ 876 c"].orbital_eccentricity == 0.25591

    def test_null_eccentricity_is_preserved_when_not_well_constrained(self):
        # Story #181: pl_orbeccen can be null even when pl_orbsmax is
        # populated - null, never fabricated.
        aliases = ["HIP 70890"]
        summary = match_exoplanets(aliases, _PROXIMA_ROWS)
        by_name = {p.name: p for p in summary.planets}
        assert by_name["Proxima Cen d"].semi_major_axis_au == 0.02885
        assert by_name["Proxima Cen d"].orbital_eccentricity is None

    def test_matches_multi_planet_host_returns_all_planets(self):
        aliases = ["TIC 188580272", "GJ 876", "HIP 113020"]
        summary = match_exoplanets(aliases, _GJ876_ROWS)
        assert summary is not None
        assert summary.count == 4
        assert {p.name for p in summary.planets} == {
            "GJ 876 b",
            "GJ 876 c",
            "GJ 876 d",
            "GJ 876 e",
        }

    def test_no_match_returns_none(self):
        # The common case (spec: ~97% of the 707 stars) - a star with real
        # aliases that simply has no confirmed exoplanet on file.
        aliases = ["HD 48915", "HIP 32349", "NAME Sirius"]
        assert match_exoplanets(aliases, _GJ876_ROWS) is None

    def test_hd_alias_whitespace_padding_is_normalized(self):
        # SIMBAD pads HD numbers to a fixed field width with extra internal
        # spaces ("HD  20794", two spaces) - the archive's own hd_name
        # ("HD 20794", one space) must still match.
        rows = [
            {
                "hostname": "HD 20794",
                "hd_name": "HD 20794",
                "hip_name": "HIP 15510",
                "tic_id": "",
                "gaia_dr2_id": "",
                "gaia_dr3_id": "",
                "pl_name": "HD 20794 b",
                "pl_orbper": 18.315,
                "pl_bmasse": 2.7,
                "pl_rade": None,
                "pl_orbsmax": 0.1207,
                "pl_orbeccen": None,
                "discoverymethod": "Radial Velocity",
                "disc_year": 2011,
                "disc_facility": "European Southern Observatory",
            }
        ]
        summary = match_exoplanets(["HD  20794", "*  82 Eri"], rows)
        assert summary is not None
        assert summary.count == 1

    def test_falls_through_to_lower_priority_identifier_when_higher_absent(self):
        # A star's aliases may carry no HD designation at all (real case:
        # GJ 876/GJ 1061 have none) - matching must fall through to
        # HIP/TIC/Gaia rather than giving up.
        aliases = ["TIC 188580272"]  # no HD, no HIP alias supplied here
        summary = match_exoplanets(aliases, _GJ876_ROWS)
        assert summary is not None
        assert summary.count == 4

    def test_empty_identifier_columns_are_never_indexed(self):
        # `hd_name: ""` (the real shape for a star with no HD number, per
        # the live archive) must not become a spurious index entry that
        # some other star's blank/absent alias could accidentally match.
        index = _build_identifier_index(_GJ876_ROWS)
        assert "" not in index["HD"]

    def test_unmatched_prefix_does_not_short_circuit_the_whole_lookup(self):
        # A star can have an HD alias present that simply isn't in the
        # archive's index (e.g. it's a real HD number but this particular
        # star has no confirmed planet) while a *different* identifier
        # type does match a real host - the HD miss must not cause the
        # whole lookup to give up before trying HIP/TIC/Gaia.
        aliases = ["HD 999999", "HIP 113020"]
        summary = match_exoplanets(aliases, _GJ876_ROWS)
        assert summary is not None
        assert summary.count == 4

    # -- Multi-component systems (spec AC3) --------------------------------

    def test_multi_component_system_attaches_planet_to_correct_component_only(self):
        # Alf Cen A and Alf Cen B are distinct catalog stars that happen to
        # share a bare system name; only B has a confirmed planet in the
        # archive, attached to hostname "Alf Cen B" specifically.
        summary_b = match_exoplanets(_ALF_CEN_B_ALIASES, _ALF_CEN_ROWS)
        assert summary_b is not None
        assert summary_b.count == 1
        assert summary_b.planets[0].name == "Alf Cen B b"

    def test_multi_component_system_does_not_leak_planet_to_sibling_component(self):
        # Regression guard for the exact bug spec AC3 calls out: a naive
        # substring match on "Alf Cen" would match *both* components since
        # both catalog stars' names contain that substring. Identifier
        # matching must not - Alf Cen A's own HD/HIP/TIC/Gaia ids are all
        # absent from _ALF_CEN_ROWS (only B's are present), so A must get
        # no exoplanets at all.
        summary_a = match_exoplanets(_ALF_CEN_A_ALIASES, _ALF_CEN_ROWS)
        assert summary_a is None

    def test_find_matching_hostname_is_component_qualified(self):
        index = _build_identifier_index(_ALF_CEN_ROWS)
        assert find_matching_hostname(_ALF_CEN_B_ALIASES, index) == "Alf Cen B"
        assert find_matching_hostname(_ALF_CEN_A_ALIASES, index) is None


class TestExoplanetCrossMatcherReusesIndex:
    def test_matcher_built_once_matches_many_stars(self):
        rows = _GJ876_ROWS + _PROXIMA_ROWS + _ALF_CEN_ROWS
        matcher = ExoplanetCrossMatcher(rows)

        gj876 = matcher.match(["TIC 188580272"])
        proxima = matcher.match(["HIP 70890"])
        alf_cen_a = matcher.match(_ALF_CEN_A_ALIASES)
        alf_cen_b = matcher.match(_ALF_CEN_B_ALIASES)
        no_match = matcher.match(["HD 48915"])

        assert gj876.count == 4
        assert proxima.count == 2
        assert alf_cen_a is None
        assert alf_cen_b.count == 1
        assert no_match is None


class TestLoadOrFetchPscompparsRows:
    """Bulk-fetch-then-local-match architecture (spec AC1): one cached
    snapshot, reusing CacheRecord/write_cache/update_manifest, no
    per-star network round-trips. Mirrors
    TestCachingObjectResolverOrchestration's shape but for the bulk
    (not per-object) fetch path.
    """

    def _cache_path(self, tmp_path: Path) -> Path:
        return tmp_path / "raw" / "nasa_exoplanet_archive" / "pscomppars_bulk.json"

    def test_first_call_fetches_and_writes_cache_and_manifest(
        self, tmp_path: Path, monkeypatch
    ):
        import local_galactic_structures.data_sources.nasa_exoplanet_archive as nea

        calls = []

        def fake_fetch():
            calls.append(1)
            return list(_GJ876_ROWS)

        monkeypatch.setattr(nea, "fetch_pscomppars_rows", fake_fetch)

        rows = nea.load_or_fetch_pscomppars_rows(
            cache_path=self._cache_path(tmp_path),
            manifest_path=tmp_path / "data_manifest.yaml",
        )
        assert len(calls) == 1
        assert rows == _GJ876_ROWS
        assert self._cache_path(tmp_path).exists()

        manifest = yaml.safe_load((tmp_path / "data_manifest.yaml").read_text())
        assert manifest["sources"][0]["id"] == "nasa_exoplanet_archive:pscomppars_bulk"
        assert manifest["sources"][0]["source"] == "nasa_exoplanet_archive"

    def test_second_call_reuses_cache_without_refetching(
        self, tmp_path: Path, monkeypatch
    ):
        import local_galactic_structures.data_sources.nasa_exoplanet_archive as nea

        calls = []
        monkeypatch.setattr(
            nea, "fetch_pscomppars_rows", lambda: (calls.append(1), list(_GJ876_ROWS))[1]
        )

        cache_path = self._cache_path(tmp_path)
        manifest_path = tmp_path / "data_manifest.yaml"
        nea.load_or_fetch_pscomppars_rows(cache_path=cache_path, manifest_path=manifest_path)
        nea.load_or_fetch_pscomppars_rows(cache_path=cache_path, manifest_path=manifest_path)

        assert len(calls) == 1

    def test_force_refresh_refetches_and_overwrites_cache(
        self, tmp_path: Path, monkeypatch
    ):
        import local_galactic_structures.data_sources.nasa_exoplanet_archive as nea

        calls = []
        monkeypatch.setattr(
            nea, "fetch_pscomppars_rows", lambda: (calls.append(1), list(_GJ876_ROWS))[1]
        )

        cache_path = self._cache_path(tmp_path)
        manifest_path = tmp_path / "data_manifest.yaml"
        nea.load_or_fetch_pscomppars_rows(cache_path=cache_path, manifest_path=manifest_path)
        nea.load_or_fetch_pscomppars_rows(
            cache_path=cache_path, manifest_path=manifest_path, force_refresh=True
        )

        assert len(calls) == 2

    def test_cache_content_preserves_provenance_fields(self, tmp_path: Path, monkeypatch):
        import local_galactic_structures.data_sources.nasa_exoplanet_archive as nea

        monkeypatch.setattr(nea, "fetch_pscomppars_rows", lambda: list(_GJ876_ROWS))
        cache_path = self._cache_path(tmp_path)
        nea.load_or_fetch_pscomppars_rows(
            cache_path=cache_path, manifest_path=tmp_path / "data_manifest.yaml"
        )
        record = read_cache(cache_path)
        assert record.source == "nasa_exoplanet_archive"
        assert record.retrieved_utc
        assert "4" in record.record_id  # "4 pscomppars rows"


@network
def test_nasa_exoplanet_archive_live_smoke(tmp_path: Path):
    rows = load_or_fetch_pscomppars_rows(
        cache_path=tmp_path / "pscomppars_bulk.json",
        manifest_path=tmp_path / "data_manifest.yaml",
    )
    assert len(rows) > 1000  # real table has thousands of confirmed planets
    summary = match_exoplanets(
        ["TIC 188580272", "GJ 876", "HIP 113020"], rows
    )
    assert summary is not None
    assert summary.count >= 4  # GJ 876 b/c/d/e are all confirmed


# ---------------------------------------------------------------------------
# literature.py: construct-and-validate, not a live query
# ---------------------------------------------------------------------------


class TestBuildObjectFromLiterature:
    def test_builds_valid_object_with_derived_coordinates(self):
        obj = build_object_from_literature(
            id="orion_omc",
            name="Orion Molecular Cloud Complex",
            object_type="molecular_cloud",
            ra_deg=83.8,
            dec_deg=-5.4,
            distance_pc=400.0,
            distance_error_pc=20.0,
            source_reference="Menten et al. 2007, A&A 474, 515",
            source_url="https://doi.org/10.1051/0004-6361:20078247",
            source_catalog="literature",
        )
        assert obj.id == "orion_omc"
        assert obj.distance.value_pc == 400.0
        assert obj.source.reference
        # Real, non-placeholder derived coordinates, same as the live
        # adapters (spec §12).
        assert obj.coordinates.galactic_l_deg != 0.0 or obj.coordinates.galactic_b_deg != 0.0
        assert (obj.cartesian.x_pc, obj.cartesian.y_pc, obj.cartesian.z_pc) != (
            0.0,
            0.0,
            0.0,
        )

    def test_blank_source_reference_raises_value_error(self):
        with pytest.raises(ValueError, match="source_reference"):
            build_object_from_literature(
                name="X",
                object_type="star",
                ra_deg=10.0,
                dec_deg=10.0,
                distance_pc=100.0,
                source_reference="   ",
            )

    def test_missing_source_reference_raises_type_error(self):
        with pytest.raises(TypeError):
            build_object_from_literature(
                name="X",
                object_type="star",
                ra_deg=10.0,
                dec_deg=10.0,
                distance_pc=100.0,
            )

    def test_invalid_dec_raises_validation_error(self):
        with pytest.raises(ValidationError):
            build_object_from_literature(
                name="X",
                object_type="star",
                ra_deg=10.0,
                dec_deg=200.0,  # out of [-90, 90]
                distance_pc=100.0,
                source_reference="Some paper",
            )

    def test_id_defaults_to_slugified_name(self):
        obj = build_object_from_literature(
            name="Rho Ophiuchi",
            object_type="star_forming_region",
            ra_deg=246.8,
            dec_deg=-24.5,
            distance_pc=140.0,
            source_reference="Some paper",
        )
        assert obj.id == "rho_ophiuchi"


class TestLiteratureResolver:
    def test_resolve_looks_up_registered_entry(self):
        resolver = LiteratureResolver(
            {
                "Orion Molecular Cloud Complex": dict(
                    id="orion_omc",
                    object_type="molecular_cloud",
                    ra_deg=83.8,
                    dec_deg=-5.4,
                    distance_pc=400.0,
                    source_reference="Menten et al. 2007",
                )
            }
        )
        obj = resolver.resolve("Orion Molecular Cloud Complex")
        assert isinstance(obj, AstronomicalObject)
        assert obj.id == "orion_omc"

    def test_resolve_raises_key_error_for_unregistered_name(self):
        resolver = LiteratureResolver()
        with pytest.raises(KeyError):
            resolver.resolve("Not Registered")

    def test_register_adds_entry_usable_by_resolve(self):
        resolver = LiteratureResolver()
        resolver.register(
            "Taurus Molecular Cloud",
            object_type="molecular_cloud",
            ra_deg=65.0,
            dec_deg=25.0,
            distance_pc=140.0,
            source_reference="Some paper",
        )
        obj = resolver.resolve("Taurus Molecular Cloud")
        assert obj.name == "Taurus Molecular Cloud"

    def test_from_yaml_loads_curated_entries(self, tmp_path: Path):
        yaml_path = tmp_path / "literature_entries.yaml"
        yaml_path.write_text(
            yaml.safe_dump(
                {
                    "Hyades": {
                        "object_type": "star_cluster",
                        "ra_deg": 66.75,
                        "dec_deg": 15.87,
                        "distance_pc": 47.5,
                        "source_reference": "Gaia Collaboration et al. 2018",
                    }
                }
            )
        )
        resolver = LiteratureResolver.from_yaml(yaml_path)
        obj = resolver.resolve("Hyades")
        assert obj.object_type == "star_cluster"
        assert obj.distance.value_pc == 47.5


# ---------------------------------------------------------------------------
# Optional live network smoke tests (spec §12: real external services) -
# skipped by default; run with LGS_RUN_NETWORK_TESTS=1 pytest ...
# ---------------------------------------------------------------------------


@network
def test_simbad_resolver_live_smoke(tmp_path: Path):
    resolver = SimbadResolver(
        object_type="star_cluster",
        cache_dir=tmp_path / "raw" / "simbad",
        manifest_path=tmp_path / "data_manifest.yaml",
    )
    obj = resolver.resolve("Pleiades")
    assert obj.distance.value_pc > 0
    assert obj.cartesian.x_pc != 0.0


@network
def test_gaia_resolver_live_smoke(tmp_path: Path):
    resolver = GaiaResolver(
        cache_dir=tmp_path / "raw" / "gaia",
        manifest_path=tmp_path / "data_manifest.yaml",
    )
    obj = resolver.resolve("Gaia DR3 66727234683960320")
    assert obj.distance.value_pc > 0


@network
def test_vizier_resolver_live_smoke(tmp_path: Path):
    resolver = VizierResolver(
        "I/355/gaiadr3",
        cache_dir=tmp_path / "raw" / "vizier",
        manifest_path=tmp_path / "data_manifest.yaml",
    )
    # A cataloged field star near the Pleiades center is enough to prove
    # end-to-end connectivity + normalization; see the VizierResolver
    # module docstring for the known limitation that name-based cone
    # search does not reliably resolve to a specific named bright star.
    obj = resolver.resolve("HD 23514")
    assert obj.coordinates.ra_deg > 0
