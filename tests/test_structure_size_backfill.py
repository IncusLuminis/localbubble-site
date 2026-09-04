"""Validates the Story #314 `size_pc` backfill (Epic #313): the ~254
EXISTING `star_cluster`/`stellar_association`/`molecular_cloud`/
`hii_region`/`planetary_nebula`/`supernova_remnant` records in
`data/normalized/initial_catalog_records.json` that previously all had
`visual.size_pc: null` now carry a real, sourced size where a source
resolves it - reusing `scripts/backfill_structure_size.py`'s Tarricq et
al. 2022 / Cantat-Gaudin et al. 2020 / SIMBAD `galdim_majaxis` cascade
(see that script's own module docstring for the full source-selection
rationale and the radius-vs-diameter convention decision).

Mirrors Story #307's own `test_open_space_velocity_backfill.py` in shape
(byte-identical field-preservation regression guard over a frozen
pre-backfill snapshot, "still missing must be individually explained"
honest-failure check, spot-checks re-asserted as permanent regression
guards) but with one escalation this Story's own acceptance criteria
explicitly call for: the byte-identical check here runs over **all 1079**
catalog records against a **full** pre-backfill snapshot
(`tests/fixtures/pre_size_pc_backfill_full_snapshot.json`, an exact copy
of `initial_catalog_records.json` captured before this Story's branch
made any change), not a curated sample - a Validator is expected to
independently re-verify full-set field preservation, so this test performs
the same full-set comparison itself rather than trusting a sample to
generalize.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

REPO_ROOT = Path(__file__).resolve().parent.parent
RECORDS_PATH = REPO_ROOT / "data" / "normalized" / "initial_catalog_records.json"
FULL_SNAPSHOT_PATH = (
    Path(__file__).resolve().parent / "fixtures" / "pre_size_pc_backfill_full_snapshot.json"
)
RESULTS_PATH = (
    REPO_ROOT / "data" / "raw" / "cluster_radius" / "backfill_structure_size_results.json"
)

CLUSTER_TYPES = {"star_cluster", "stellar_association"}
DIFFUSE_TYPES = {"molecular_cloud", "hii_region", "planetary_nebula", "supernova_remnant"}
TARGET_TYPES = CLUSTER_TYPES | DIFFUSE_TYPES


@pytest.fixture(scope="module")
def pre_backfill_records():
    return json.loads(FULL_SNAPSHOT_PATH.read_text())


@pytest.fixture(scope="module")
def post_backfill_records():
    return json.loads(RECORDS_PATH.read_text())


@pytest.fixture(scope="module")
def post_backfill_by_id(post_backfill_records):
    return {r["id"]: r for r in post_backfill_records}


@pytest.fixture(scope="module")
def target_ids(pre_backfill_records):
    """Ids of every record that was missing `visual.size_pc` BEFORE this
    Story's backfill ran - re-derived live from the frozen pre-backfill
    snapshot rather than hard-coded, same convention Story #295/#307's own
    regression tests use for their own scope-sanity figures."""
    return {
        r["id"]
        for r in pre_backfill_records
        if r.get("object_type") in TARGET_TYPES and not (r.get("visual") or {}).get("size_pc")
    }


@pytest.fixture(scope="module")
def backfill_results():
    """Per-record source/method/honest-failure-reason artifact the backfill
    script writes (mirrors Story #307's own `--unresolved-output`/
    `--failures-output` convention) - the only place this Story's
    provenance can live, since `notes` is explicitly off-limits."""
    entries = json.loads(RESULTS_PATH.read_text())
    return {e["id"]: e for e in entries}


# ---------------------------------------------------------------------
# Scope sanity
# ---------------------------------------------------------------------


def test_exactly_254_target_records_were_missing_size_pc_pre_backfill(target_ids):
    # Epic #313/issue #314's own pre-researched figure (257 total
    # cluster/association/diffuse-structure records, 4 already populated
    # at Epic-research time -> ~253; the live-derived figure below is 254,
    # since the Epic's own count was explicitly an approximation ("confirm
    # the exact existing set yourself")) - re-derived live from the frozen
    # pre-backfill snapshot, not trusted blindly.
    assert len(target_ids) == 254


def test_pre_backfill_snapshot_has_the_full_1079_record_catalog(pre_backfill_records):
    assert len(pre_backfill_records) == 1079


# ---------------------------------------------------------------------
# size_pc coverage
# ---------------------------------------------------------------------


def test_target_records_have_size_pc_populated_or_an_honest_failure_reason(
    target_ids, post_backfill_by_id, backfill_results
):
    still_missing = [
        rid
        for rid in target_ids
        if not (post_backfill_by_id[rid].get("visual") or {}).get("size_pc")
    ]
    unexplained = [
        rid
        for rid in still_missing
        if rid not in backfill_results or backfill_results[rid].get("size_pc") is not None
    ]
    assert not unexplained, (
        "target record(s) missing size_pc with no honest-failure "
        f"explanation on file: {unexplained}"
    )

    # This Story's own research sample (see backfill script docstring) is
    # overwhelmingly resolvable for compact clusters/diffuse structures;
    # genuine failures are concentrated in large-scale OB associations/
    # moving groups with no well-defined structural radius in either
    # source. Assert coverage is high rather than 100%, so a legitimate,
    # already-documented honest failure does not spuriously fail this test.
    resolved_fraction = 1 - (len(still_missing) / len(target_ids))
    assert resolved_fraction >= 0.9, (
        f"only {resolved_fraction:.1%} of target records resolved a "
        "size_pc - expected >=90% per this Story's own acquisition run"
    )


def test_resolved_target_records_have_a_results_file_provenance_entry(
    target_ids, post_backfill_by_id, backfill_results
):
    # The inverse of `test_target_records_have_size_pc_populated_or_an_
    # honest_failure_reason` above: that test only ever asserted the
    # *unresolved* half of this Story's own acceptance criterion ("document
    # which source you used and why") - it walks `still_missing` records
    # and demands each has a results-file entry, but a target record that
    # DID get a `size_pc` never has to appear in `backfill_results` to pass
    # it. That silent gap is exactly how `cl_alessi_1`/`m42_orion` shipped
    # in this Story's original PR with correct, independently-verified
    # `size_pc` values but ZERO documented source/method - a direct
    # violation of the same acceptance criterion, undetected by the
    # existing suite. This test asserts the missing half: every resolved
    # target (populated `visual.size_pc`) must ALSO have a corresponding
    # results-file entry, with a real `method`/`detail`, not just presence.
    resolved_without_provenance = []
    resolved_without_method = []
    for rid in target_ids:
        size_pc = (post_backfill_by_id[rid].get("visual") or {}).get("size_pc")
        if not size_pc:
            continue
        entry = backfill_results.get(rid)
        if entry is None:
            resolved_without_provenance.append(rid)
            continue
        if not entry.get("method") or entry.get("size_pc") is None:
            resolved_without_method.append(rid)
    assert not resolved_without_provenance, (
        "resolved target record(s) with visual.size_pc populated but no "
        f"entry at all in the results-file audit trail: {resolved_without_provenance}"
    )
    assert not resolved_without_method, (
        "resolved target record(s) whose results-file entry has no "
        f"method/size_pc documented: {resolved_without_method}"
    )


def test_no_backfilled_size_pc_is_non_positive(target_ids, post_backfill_by_id):
    for rid in target_ids:
        size = (post_backfill_by_id[rid].get("visual") or {}).get("size_pc")
        if size is not None:
            assert size > 0, f"{rid}: backfilled size_pc must be strictly positive, got {size}"


def test_every_documented_honest_failure_actually_has_no_size_pc(
    backfill_results, post_backfill_by_id
):
    # The inverse of the coverage check above: a record the results
    # artifact says was unresolved must genuinely be null in the catalog,
    # not accidentally populated by some other path.
    for rid, entry in backfill_results.items():
        if entry.get("size_pc") is None:
            actual = (post_backfill_by_id[rid].get("visual") or {}).get("size_pc")
            assert not actual, (
                f"{rid}: results artifact records this as an honest "
                f"failure but the catalog has size_pc={actual}"
            )


# ---------------------------------------------------------------------
# Byte-identical regression guard - FULL record set (not a sample)
# ---------------------------------------------------------------------


def _without_visual_size_pc(record: dict) -> dict:
    record = json.loads(json.dumps(record))
    visual = record.get("visual")
    if visual is not None:
        visual["size_pc"] = None
    return record


def test_full_record_set_is_byte_identical_except_visual_size_pc(
    pre_backfill_records, post_backfill_by_id
):
    """The core Story #314 non-destructiveness guarantee, re-verified
    across ALL 1079 catalog records (not a sample) - every field on every
    record must be untouched except `visual.size_pc`."""
    mismatched = []
    for pre in pre_backfill_records:
        rid = pre["id"]
        post = post_backfill_by_id.get(rid)
        assert post is not None, f"{rid}: record disappeared from the catalog"
        if _without_visual_size_pc(pre) != _without_visual_size_pc(post):
            mismatched.append(rid)
    assert not mismatched, (
        f"record(s) with a field change other than visual.size_pc: {mismatched}"
    )


def test_record_count_and_id_set_are_unchanged(pre_backfill_records, post_backfill_records):
    """Story #314's own non-destructiveness guarantee: the size_pc backfill
    itself did not add, remove, or rename any record - every pre-backfill
    id is still present. This no longer asserts an exact fixed count/
    id-set *equality*: the catalog has since legitimately grown via later
    new-record gap-fill Stories (e.g. Story #318's 4 new molecular_cloud
    records), which is expected growth, not a regression of this Story's
    own invariant. `test_pre_backfill_snapshot_has_the_full_1079_record_
    catalog` above still pins the frozen pre-backfill snapshot itself to
    exactly 1079."""
    pre_ids = {r["id"] for r in pre_backfill_records}
    post_ids = {r["id"] for r in post_backfill_records}
    assert pre_ids <= post_ids, f"pre-backfill record(s) disappeared: {sorted(pre_ids - post_ids)}"
    assert len(post_backfill_records) >= len(pre_backfill_records), (
        "post-backfill catalog must never be smaller than the pre-backfill snapshot"
    )


def test_only_target_records_size_pc_changed(
    pre_backfill_records, post_backfill_by_id, target_ids
):
    """Records OUTSIDE this Story's own target type/missing-`size_pc`
    scope (stars, the 4 already-populated cluster/structure records, etc.)
    must keep their exact pre-backfill `size_pc`, not merely their other
    fields."""
    for pre in pre_backfill_records:
        rid = pre["id"]
        if rid in target_ids:
            continue
        pre_size = (pre.get("visual") or {}).get("size_pc")
        post_size = (post_backfill_by_id[rid].get("visual") or {}).get("size_pc")
        assert pre_size == post_size, (
            f"{rid}: size_pc changed despite being outside this Story's own scope"
        )


# ---------------------------------------------------------------------
# Radius-vs-diameter convention
# ---------------------------------------------------------------------


def test_pleiades_radius_precedent_record_is_unchanged(post_backfill_by_id):
    # Regression guard: this Story must not have touched the one
    # already-populated cluster record its own convention decision is
    # anchored to.
    obj = post_backfill_by_id["pleiades-open-cluster"]
    assert obj["visual"]["size_pc"] == pytest.approx(11.6)


def test_vela_snr_and_cepheus_flare_diameter_precedent_records_are_unchanged(
    post_backfill_by_id,
):
    vela = post_backfill_by_id["vela-supernova-remnant"]
    assert vela["visual"]["size_pc"] == pytest.approx(40.0)
    cepheus = post_backfill_by_id["cepheus-flare"]
    assert cepheus["visual"]["size_pc"] == pytest.approx(90.0)


def test_backfilled_cluster_sizes_are_physically_plausible_radii(
    target_ids, post_backfill_by_id
):
    # Real open-cluster tidal/core/half-member radii span roughly sub-pc
    # (compact, poorly resolved groups) up to ~100pc (the loosest
    # associations with a resolvable membership-catalog radius) -
    # generous bounds, not a re-assertion of any specific value, just a
    # sanity net against a units/convention bug (e.g. accidentally storing
    # a diameter, or a raw un-converted angular value).
    for rid in target_ids:
        record = post_backfill_by_id[rid]
        if record["object_type"] not in CLUSTER_TYPES:
            continue
        size = (record.get("visual") or {}).get("size_pc")
        if size is None:
            continue
        assert 0 < size < 150, f"{rid}: implausible cluster/association radius {size} pc"


def test_backfilled_diffuse_structure_sizes_are_physically_plausible_diameters(
    target_ids, post_backfill_by_id
):
    for rid in target_ids:
        record = post_backfill_by_id[rid]
        if record["object_type"] not in DIFFUSE_TYPES:
            continue
        size = (record.get("visual") or {}).get("size_pc")
        if size is None:
            continue
        assert 0 < size < 120, f"{rid}: implausible diffuse-structure diameter {size} pc"


# ---------------------------------------------------------------------
# Spot checks (this Story's own required hand-verification, re-asserted
# as permanent regression guards)
# ---------------------------------------------------------------------


def test_orion_nebula_m42_has_a_physically_sane_size(post_backfill_by_id):
    obj = post_backfill_by_id["m42_orion"]
    # M42's own catalog distance is 433pc; SIMBAD's galdim_majaxis for
    # this identifier is 66 arcmin, giving a physical diameter of
    # ~8.3pc - well within the Orion Nebula's commonly cited several-pc
    # visible extent (a much larger, fainter halo exists, but the SIMBAD-
    # cataloged 66' figure is the traditional "the nebula" angular size).
    assert obj["visual"]["size_pc"] == pytest.approx(8.313, rel=0.02)
    # Regression guard: position/notes/group must be untouched (checked
    # exhaustively above too, but this is the human-legible spot-check the
    # acceptance criteria specifically ask for).
    assert obj["distance"]["value_pc"] == pytest.approx(433.0)
    assert "NAME Orion Nebula" in obj["aliases"]


def test_m8_lagoon_nebula_is_a_documented_honest_failure(post_backfill_by_id, backfill_results):
    obj = post_backfill_by_id["m8_lagoon"]
    assert obj["visual"]["size_pc"] is None
    assert "m8_lagoon" in backfill_results
    assert backfill_results["m8_lagoon"]["size_pc"] is None


def test_large_scale_ob_associations_are_documented_honest_failures(
    post_backfill_by_id, backfill_results
):
    # Large, loose OB associations/moving groups (tens of degrees across)
    # have no well-defined structural radius in either the Gaia-membership
    # cluster catalogs or SIMBAD's galdim field - a genuine data-
    # availability limitation, not an implementation gap. Re-asserted here
    # as a permanent guard that these stay honestly unresolved rather than
    # silently regressing to a fabricated value in some future change.
    for rid in [
        "cepheus-ob2-association",
        "orion-ob1-association",
        "scorpius-centaurus-association",
        "vela-ob2-stellar-association",
        "hyades-open-cluster",
    ]:
        assert post_backfill_by_id[rid]["visual"]["size_pc"] is None
        assert backfill_results[rid]["size_pc"] is None


# ---------------------------------------------------------------------
# End-to-end: the rebuilt parquet-backed catalog carries the backfill too
# ---------------------------------------------------------------------


def test_catalog_objects_carry_the_backfilled_size_pc(catalog_objects, target_ids):
    """`catalog_objects` (conftest.py) loads from `catalog.parquet`, not
    the JSON records directly - this confirms the parquet rebuild
    (`galactic-structures build-catalog`) actually round-tripped the new
    `size_pc` values, not just the JSON source of truth."""
    by_id = {o.id: o for o in catalog_objects}
    resolved = sum(1 for rid in target_ids if by_id[rid].visual.size_pc is not None)
    resolved_fraction = resolved / len(target_ids)
    assert resolved_fraction >= 0.9, (
        f"only {resolved_fraction:.1%} of target records carry size_pc in "
        "the rebuilt catalog.parquet"
    )
