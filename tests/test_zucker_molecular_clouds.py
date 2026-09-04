"""Unit tests for the Story #318 `data_sources/zucker_molecular_clouds.py`
adapter - the pure-function logic (nearest-sightline matching, the paper's
own systematic-uncertainty convention, the statistical/systematic
quadrature-sum error) exercised against small, hand-built fixture rows
rather than the live network, same convention `test_structure_size_sources.py`
already establishes for the sibling Story #314 adapters.
"""

from __future__ import annotations

import pytest

from local_galactic_structures.data_sources import zucker_molecular_clouds as zucker

FIXTURE_ROWS = [
    {
        "Name": "Corona_Australis",
        "GLON": 359.5,
        "GLAT": -17.8,
        "d16": 142,
        "d50": 147,
        "d84": 152,
        "_RA.icrs": 285.2282,
        "_DE.icrs": -37.3192,
    },
    {
        "Name": "Corona_Australis",
        "GLON": 0.8,
        "GLAT": -20.1,
        "d16": 149,
        "d50": 155,
        "d84": 160,
        "_RA.icrs": 288.4684,
        "_DE.icrs": -36.9581,
    },
    {
        "Name": "Coalsack",
        "GLON": 301.4,
        "GLAT": -2.6,
        "d16": 176,
        "d50": 182,
        "d84": 187,
        "_RA.icrs": 189.1772,
        "_DE.icrs": -65.4279,
    },
]


def test_nearest_row_picks_closest_by_angular_separation():
    # Very close to the first Corona_Australis row.
    row, sep_deg = zucker.nearest_row(285.25, -37.30, FIXTURE_ROWS)
    assert row["_RA.icrs"] == 285.2282
    assert sep_deg == pytest.approx(0.0, abs=0.05)


def test_nearest_row_crosses_name_groups_when_physically_closer():
    # Positioned near the Coalsack row, not either Corona_Australis row -
    # nearest_row must not restrict itself to a single Name group.
    row, sep_deg = zucker.nearest_row(189.2, -65.4, FIXTURE_ROWS)
    assert row["Name"] == "Coalsack"
    assert sep_deg < 1.0


def test_nearest_row_within_group_restricts_to_matching_name():
    row, sep_deg = zucker.nearest_row_within_group(
        189.2, -65.4, FIXTURE_ROWS, "Corona_Australis"
    )
    # Even though the Coalsack row is much closer overall, restricting to
    # "Corona_Australis" must pick one of its own 2 rows.
    assert row["Name"] == "Corona_Australis"
    assert sep_deg > 10.0


def test_nearest_row_within_group_returns_none_for_absent_name():
    assert zucker.nearest_row_within_group(0.0, 0.0, FIXTURE_ROWS, "Nonexistent_Group") is None


def test_systematic_fraction_uses_7_percent_for_southern_clouds():
    assert zucker.systematic_fraction_for("Corona_Australis") == pytest.approx(0.07)
    assert zucker.systematic_fraction_for("Lupus") == pytest.approx(0.07)
    assert zucker.systematic_fraction_for("Chamaeleon") == pytest.approx(0.07)


def test_systematic_fraction_uses_5_percent_general_case():
    assert zucker.systematic_fraction_for("Coalsack") == pytest.approx(0.05)
    assert zucker.systematic_fraction_for("California") == pytest.approx(0.05)
    assert zucker.systematic_fraction_for("Serpens_Main") == pytest.approx(0.05)


def test_quadrature_error_pc_matches_hand_computation():
    # Corona Australis nearest-sightline figures used by this Story's own
    # corona-australis-molecular-cloud record: d16=142, d50=147, d84=152,
    # 7% systematic -> stat=5.0, sys=10.29, sqrt(5^2+10.29^2)=11.4405.
    error_pc = zucker.quadrature_error_pc(142, 147, 152, 0.07)
    assert error_pc == pytest.approx(11.4405, rel=1e-4)


def test_quadrature_error_pc_handles_asymmetric_percentiles():
    # California nearest-sightline figures: d16=436, d50=454, d84=471, 5%
    # systematic -> stat=mean(18,17)=17.5, sys=22.7,
    # sqrt(17.5^2+22.7^2)=28.6625.
    error_pc = zucker.quadrature_error_pc(436, 454, 471, 0.05)
    assert error_pc == pytest.approx(28.6625, rel=1e-4)
