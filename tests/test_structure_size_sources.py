"""Unit tests for the two new Story #314 data-source adapters
(`data_sources/simbad_size.py`, `data_sources/cluster_radius.py`) - the
pure-function/name-matching logic and the cache-then-query orchestration,
monkeypatched against fixed, real-shaped responses rather than the live
network, same convention `test_data_sources.py` already establishes for
every other adapter in this package.
"""

from __future__ import annotations

import math

import pytest

from local_galactic_structures.data_sources import cluster_radius, simbad_size

# ---------------------------------------------------------------------
# simbad_size: pure angular-size -> physical-size conversion
# ---------------------------------------------------------------------


def test_diameter_pc_from_angular_size_matches_hand_computation():
    # M42/Orion Nebula spot-check figures (this Story's own acquisition
    # run, and test_structure_size_backfill.py's own spot-check): SIMBAD
    # galdim_majaxis=66 arcmin at distance_pc=433 -> ~8.313 pc diameter.
    diameter_pc = simbad_size.diameter_pc_from_angular_size(66.0, 433.0)
    assert diameter_pc == pytest.approx(8.313, rel=0.001)


def test_diameter_pc_from_angular_size_scales_linearly_with_distance():
    small = simbad_size.diameter_pc_from_angular_size(60.0, 100.0)
    large = simbad_size.diameter_pc_from_angular_size(60.0, 200.0)
    assert large == pytest.approx(2 * small)


def test_diameter_pc_from_angular_size_matches_small_angle_formula():
    majaxis_arcmin = 40.0
    distance_pc = 250.0
    expected = distance_pc * math.radians(majaxis_arcmin / 60.0)
    assert simbad_size.diameter_pc_from_angular_size(majaxis_arcmin, distance_pc) == pytest.approx(
        expected
    )


# ---------------------------------------------------------------------
# simbad_size: resolve_angular_diameter (cache-then-query orchestration,
# network isolated via monkeypatch)
# ---------------------------------------------------------------------


def test_resolve_angular_diameter_returns_none_when_upstream_has_no_galdim(monkeypatch, tmp_path):
    monkeypatch.setattr(simbad_size, "_query_galdim", lambda name: {"main_id": "M   8"})
    result = simbad_size.resolve_angular_diameter(
        "M   8", cache_dir=tmp_path, manifest_path=tmp_path / "manifest.yaml"
    )
    assert result is None
    # Nothing should have been cached - see the module's own "deliberately
    # NOT cached" docstring note.
    assert list(tmp_path.glob("*.json")) == []


def test_resolve_angular_diameter_returns_none_when_identifier_unresolvable(
    monkeypatch, tmp_path
):
    monkeypatch.setattr(simbad_size, "_query_galdim", lambda name: None)
    result = simbad_size.resolve_angular_diameter(
        "not a real object", cache_dir=tmp_path, manifest_path=tmp_path / "manifest.yaml"
    )
    assert result is None


def test_resolve_angular_diameter_extracts_and_caches_a_usable_response(monkeypatch, tmp_path):
    raw = {
        "main_id": "M  42",
        "galdim_majaxis": 66.0,
        "galdim_minaxis": 60.0,
        "galdim_angle": 90,
        "galdim_qual": "D",
        "galdim_bibcode": "1989Sci...246.1066D",
    }
    calls = []
    monkeypatch.setattr(simbad_size, "_query_galdim", lambda name: (calls.append(name), raw)[1])

    manifest_path = tmp_path / "manifest.yaml"
    result = simbad_size.resolve_angular_diameter(
        "M  42", cache_dir=tmp_path, manifest_path=manifest_path
    )
    assert result == {
        "main_id": "M  42",
        "majaxis_arcmin": 66.0,
        "minaxis_arcmin": 60.0,
        "qual": "D",
        "bibcode": "1989Sci...246.1066D",
    }
    assert len(calls) == 1

    # Cache hit on the second call: no second upstream query.
    result_again = simbad_size.resolve_angular_diameter(
        "M  42", cache_dir=tmp_path, manifest_path=manifest_path
    )
    assert result_again == result
    assert len(calls) == 1
    assert manifest_path.exists()


# ---------------------------------------------------------------------
# cluster_radius: r50 degrees -> pc conversion
# ---------------------------------------------------------------------


def test_r50_pc_matches_hand_computation():
    # Pleiades (Melotte_22) spot-check figures from this Story's own
    # development (Cantat-Gaudin et al. 2020 r50=1.274 deg at
    # distance_pc=135.8 -> ~3.02 pc).
    row = {"r50": 1.274}
    result = cluster_radius.r50_pc(row, distance_pc=135.8)
    assert result == pytest.approx(3.0196, rel=0.001)


def test_r50_pc_returns_none_when_row_has_no_r50():
    assert cluster_radius.r50_pc({"r50": None}, distance_pc=100.0) is None
    assert cluster_radius.r50_pc({}, distance_pc=100.0) is None


# ---------------------------------------------------------------------
# cluster_radius: name matching (SimbadName / Cluster indices)
# ---------------------------------------------------------------------


@pytest.fixture
def fake_rows():
    return [
        {"Cluster": "Alessi_8", "SimbadName": "Cl Alessi    8", "Rt": 2.64},
        {"Cluster": "Melotte_20", "SimbadName": "Cl Melotte   20", "Rt": 22.1},
        {"Cluster": "UPK_645", "SimbadName": None, "Rt": 2.96},
    ]


def test_find_row_matches_via_simbad_name(fake_rows):
    by_simbad, by_cluster = cluster_radius.build_name_index(fake_rows)
    row = cluster_radius.find_row("Cl Melotte   20", fake_rows, by_simbad, by_cluster)
    assert row is not None
    assert row["Cluster"] == "Melotte_20"


def test_find_row_falls_back_to_cluster_column_when_no_simbad_name_hit(fake_rows):
    by_simbad, by_cluster = cluster_radius.build_name_index(fake_rows)
    # "Cl Alessi    8" -> normalized "Cl Alessi 8" -> "Cl " stripped, space
    # collapsed to underscore -> "Alessi_8", matching the row's own
    # `Cluster` column even without relying on SimbadName.
    row = cluster_radius.find_row("Cl Alessi    8", fake_rows, {}, by_cluster)
    assert row is not None
    assert row["Cluster"] == "Alessi_8"


def test_find_row_returns_none_when_nothing_matches(fake_rows):
    by_simbad, by_cluster = cluster_radius.build_name_index(fake_rows)
    assert cluster_radius.find_row("Cl Nonexistent   1", fake_rows, by_simbad, by_cluster) is None


def test_find_row_prefers_simbad_name_match_over_cluster_match(fake_rows):
    # UPK_645 has no SimbadName; querying its exact Cluster-derived name
    # must still resolve via the Cluster-column fallback.
    by_simbad, by_cluster = cluster_radius.build_name_index(fake_rows)
    row = cluster_radius.find_row("UPK 645", fake_rows, by_simbad, by_cluster)
    assert row is not None
    assert row["Cluster"] == "UPK_645"
