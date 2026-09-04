"""Validates the Story #324 new-record `molecular_cloud` gap-fill (follow-on
to Story #318, itself follow-on to Epic #313): a more thorough mining of the
already-cached Zucker et al. 2020 table (`data/raw/zucker_molecular_clouds/
zucker_2020_handbook_table1.json`) found real, well-under-800pc candidates
that Story #318's earlier research pass either missed (North America Nebula,
explicitly requested by the human owner, plus its optional twin the Pelican
Nebula) or WRONGLY excluded based on bad secondary sources (IC5146/Cocoon
Nebula, Circinus, Norma were guessed at ~950pc-2kpc from garbled web text;
the real cached table puts them all well under 800pc).

Same two-step provenance convention as Story #318 (data/raw/gap_fills/
README.md): DISTANCE from the real, live-queried VizieR table
`J/A+A/633/A51/handbook`, POSITION from a separate SIMBAD identification-only
cross-match, `size_pc` (where resolvable) via the same SIMBAD
`galdim_majaxis`-based DIAMETER convention `data_sources/simbad_size.py`
(Story #314) established for this object type. `scripts/
acquire_molecular_cloud_gap_fill.py` was extended (not replaced) with this
Story's own candidates and its own redundancy-check block.

**9 candidates added** (all resolved cleanly via SIMBAD, all well under
800pc): North America Nebula, Pelican Nebula (issue's own optional twin -
resolved cleanly, added), IC 5146 (Cocoon Nebula), Circinus Molecular Cloud,
Norma Molecular Cloud, Mon OB1/NGC 2264, IC 2118 (Witch Head Nebula), Lambda
Orionis Ring (Orion_Lam), Draco Cloud.

**1 candidate investigated and deliberately NOT added: Northern Coalsack.**
The issue's own redundancy-check instruction was to verify this candidate is
not the same object as the already-loaded Coalsack Nebula record - that part
cleanly PASSED (SIMBAD's real "NAME Northern Coalsack" position, ra=305.25,
dec=37.0, sits 133.9 deg from Coalsack Nebula's own stored position,
ra=189.1772, dec=-65.4279 - opposite general regions of the sky, obviously
distinct objects). But a second, unanticipated problem surfaced during
acquisition: SIMBAD's actual "NAME Northern Coalsack" record is an alias for
the **Cygnus Rift** ("NAME Cyg Rift"/"NAME Cygnus Rift", otype DNe, galactic
l=74.75 b=0.00) - NOT the same sky position as the Zucker table's own
`Northern_Coalsack`-named sightline group (l=91.3-92.6, b=3.5-4.3), which
sits 16.4 deg away from that real SIMBAD identification (every genuine
same-object match in this Story and Story #318 landed under ~1.8 deg
separation). The table's own `SimbadName` column for those rows literally
reads "Northern_Coalsack" too, but that is the paper's own group-label
string echoed back, not an independent cross-match confirmation - the exact
same false-cognate trap Story #318 hit and documented for Aquila Rift. A
region search around the Zucker table's actual `Northern_Coalsack`
coordinates (ra~314-317, dec~52-53) found only catalog-only dark-nebula
designations (LDN 1018/1027, DOBASHI 3003/3008/3009/3016/3044, TGU H541
P11) - no popularly "NAME"-prefixed SIMBAD identifier exists there to anchor
a corrected record to. And the real SIMBAD "Northern Coalsack"/Cygnus Rift
object's own `galdim_majaxis` (1410 arcmin, ~23.5 deg on the sky) confirms
it is itself an enormous extended dark-lane/superposition feature spanning
much of Cygnus, not a single coherent cloud - the identical "poor fit for
this catalog's single-point/single-distance object model" reasoning that
excluded Aquila Rift in Story #318. Excluded as an honest failure, not
force-matched/fabricated.

**Redundancy check for Orion_Lam vs. the already-loaded Orion Molecular
Cloud Complex record: also explicitly verified, and PASSED.** SIMBAD's
identification-only position for the Lambda Orionis ring ("Sh 2-264" ->
main_id "NAME lam Ori Molecular Ring", ra=83.825, dec=9.933) sits 11.527 deg
from the existing `orion-molecular-cloud-complex` record's own stored
position (ra=86.2152, dec=-1.3456) - a real angular separation via astropy
`SkyCoord`, not a name-only comparison. Genuinely distinct: the Lambda
Orionis ring sits north of the Orion Belt/Sword region (dec ~+6 to +14 deg)
while the Orion Complex record is anchored near M42 (dec ~-1 to -8 deg).
Added as its own record.

See `scripts/acquire_molecular_cloud_gap_fill.py`'s own `REDUNDANCY_CHECKS`
block for the reproducible live computation behind both checks above.
"""

from __future__ import annotations

TAG = "molecular-cloud-gap-fill"

#: (catalog id, (min_pc, max_pc) sanity window around this Story's own
#: live-resolved Zucker+2020 d50 value) - same generous-margin convention
#: Story #318's own NEW_MOLECULAR_CLOUDS table uses.
NEW_MOLECULAR_CLOUDS = [
    ("north-america-nebula", (700.0, 850.0)),
    ("pelican-nebula", (700.0, 850.0)),
    ("ic-5146-cocoon-nebula", (680.0, 820.0)),
    ("circinus-molecular-cloud", (600.0, 750.0)),
    ("norma-molecular-cloud", (650.0, 800.0)),
    ("mon-ob1-ngc-2264", (680.0, 820.0)),
    ("ic-2118-witch-head-nebula", (220.0, 330.0)),
    ("orion-lam-lambda-orionis-ring", (350.0, 470.0)),
    ("draco-cloud", (430.0, 530.0)),
]

#: Story #318's original 4 new-record ids - used to confirm this Story left
#: them untouched.
STORY_318_IDS = {
    "corona-australis-molecular-cloud",
    "coalsack-nebula",
    "california-molecular-cloud",
    "serpens-molecular-cloud",
}

#: Records this Story's own redundancy checks concluded are genuinely
#: distinct, not duplicates - both must remain present as separate records.
REDUNDANCY_CHECK_PAIRS = [
    ("orion-lam-lambda-orionis-ring", "orion-molecular-cloud-complex"),
]

#: This Story's own honest-failure investigation result: Northern Coalsack
#: was investigated (module docstring) and deliberately NOT added. Guards
#: against it accidentally shipping later as a fabricated/force-matched
#: record under this or a future Story.
EXCLUDED_CANDIDATE_NAME_FRAGMENTS = ["northern coalsack", "cygnus rift", "cyg rift"]


def _by_id(catalog_objects, object_id):
    matches = [obj for obj in catalog_objects if obj.id == object_id]
    assert len(matches) == 1, f"expected exactly one record with id {object_id!r}, got {len(matches)}"
    return matches[0]


def test_all_9_new_molecular_clouds_present_exactly_once(catalog_objects):
    ids = [obj.id for obj in catalog_objects]
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        assert ids.count(object_id) == 1, f"{object_id} should appear exactly once, found {ids.count(object_id)}"


def test_new_records_are_type_molecular_cloud(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.object_type == "molecular_cloud"


def test_new_records_tagged_with_correct_provenance_tag(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert TAG in obj.group.secondary, (
            f"{object_id} expected tag {TAG!r}, got {obj.group.secondary!r}"
        )


def test_new_record_distances_are_physically_sane(catalog_objects):
    for object_id, (min_pc, max_pc) in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert min_pc < obj.distance.value_pc < max_pc, (
            f"{object_id} distance {obj.distance.value_pc} pc outside expected "
            f"[{min_pc}, {max_pc}] pc"
        )


def test_new_record_distances_are_under_800pc(catalog_objects):
    # The spec's own stated molecular_cloud scope (Idea.md §9: "structures
    # within approximately 800 pc of the Sun").
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.distance.value_pc < 800.0, (
            f"{object_id} distance {obj.distance.value_pc} pc is not under "
            "the spec's 800pc molecular_cloud scope"
        )


def test_new_record_distances_have_a_positive_error_pc(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.distance.error_pc is not None
        assert obj.distance.error_pc > 0.0


def test_new_records_cite_zucker_2020_vizier_source(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert "Zucker" in obj.source.reference
        assert "J/A+A/633/A51" in (obj.source.catalog or "")
        assert obj.source.url == "https://doi.org/10.1051/0004-6361/201936145"


def test_new_records_document_simbad_identification_only_position(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert "SIMBAD" in obj.source.reference
        assert "identification only" in obj.source.reference


def test_new_records_with_populated_size_pc_are_positive_diameters(catalog_objects):
    # IC 5146 (Cocoon Nebula) and Mon OB1/NGC 2264 both resolved a real
    # SIMBAD galdim_majaxis -> size_pc (DIAMETER convention, Story #314).
    for object_id in ("ic-5146-cocoon-nebula", "mon-ob1-ngc-2264"):
        obj = _by_id(catalog_objects, object_id)
        assert obj.visual.size_pc is not None
        assert obj.visual.size_pc > 0.0


def test_new_records_with_honest_failure_size_pc_are_null_and_documented(catalog_objects):
    honest_failure_ids = [
        object_id
        for object_id, _bounds in NEW_MOLECULAR_CLOUDS
        if object_id not in ("ic-5146-cocoon-nebula", "mon-ob1-ngc-2264")
    ]
    assert len(honest_failure_ids) == 7
    for object_id in honest_failure_ids:
        obj = _by_id(catalog_objects, object_id)
        assert obj.visual.size_pc is None
        notes_lower = (obj.notes or "").lower()
        assert "honest failure" in notes_lower


def test_new_records_notes_document_gap_fill_provenance(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        notes_lower = (obj.notes or "").lower()
        assert "gap-fill" in notes_lower or "gap fill" in notes_lower


def test_story_318_records_are_unchanged(catalog_objects):
    by_id = {obj.id: obj for obj in catalog_objects}
    expected = {
        "corona-australis-molecular-cloud": 147.0,
        "coalsack-nebula": 182.0,
        "california-molecular-cloud": 454.0,
        "serpens-molecular-cloud": 425.0,
    }
    for object_id, distance_pc in expected.items():
        obj = by_id[object_id]
        assert obj.distance.value_pc == distance_pc


def test_catalog_has_the_21_expected_molecular_cloud_records(catalog_objects):
    molecular_clouds = [obj for obj in catalog_objects if obj.object_type == "molecular_cloud"]
    ids = {obj.id for obj in molecular_clouds}
    original_eight = {
        "cepheus-flare",
        "chamaeleon-molecular-cloud",
        "lupus-molecular-cloud",
        "ophiuchus-rho-ophiuchi-molecular-cloud",
        "orion-molecular-cloud-complex",
        "perseus-molecular-cloud",
        "pipe-nebula",
        "taurus-molecular-cloud",
    }
    expected = original_eight | STORY_318_IDS | {oid for oid, _ in NEW_MOLECULAR_CLOUDS}
    assert len(molecular_clouds) == 21
    assert ids == expected


def test_gap_fill_tag_now_covers_exactly_13_records(catalog_objects):
    # 4 from Story #318 + 9 from this Story - the up-to-date total for the
    # shared "molecular-cloud-gap-fill" batch tag (see
    # tests/test_molecular_cloud_gap_fill.py's own note on why its sibling
    # check no longer pins an exact count).
    tagged = [obj for obj in catalog_objects if TAG in obj.group.secondary]
    tagged_ids = {obj.id for obj in tagged}
    assert len(tagged) == 13
    assert tagged_ids == STORY_318_IDS | {oid for oid, _ in NEW_MOLECULAR_CLOUDS}


def test_redundancy_check_pairs_are_both_present_and_genuinely_distinct(catalog_objects):
    # Issue's own explicit requirement: verify via real SIMBAD-resolved
    # positions (not name matching) that Orion_Lam and the already-loaded
    # Orion Molecular Cloud Complex are two distinct objects, and that both
    # remain present as separate records.
    for new_id, existing_id in REDUNDANCY_CHECK_PAIRS:
        new_obj = _by_id(catalog_objects, new_id)
        existing_obj = _by_id(catalog_objects, existing_id)
        assert new_obj.id != existing_obj.id
        # Real positions must differ by much more than measurement noise -
        # a coarse but effective proxy here on the already-loaded/derived
        # coordinates (the actual redundancy check itself, done against
        # live SIMBAD identification positions via astropy SkyCoord, lives
        # in scripts/acquire_molecular_cloud_gap_fill.py's own
        # REDUNDANCY_CHECKS block/printed output - reproduced there, not
        # re-derived here).
        assert abs(new_obj.coordinates.ra_deg - existing_obj.coordinates.ra_deg) > 0.5 or \
            abs(new_obj.coordinates.dec_deg - existing_obj.coordinates.dec_deg) > 0.5


def test_northern_coalsack_was_not_added_as_a_separate_record(catalog_objects):
    # Investigated (module docstring) and deliberately NOT added: SIMBAD's
    # real "Northern Coalsack" identifier is the Cygnus Rift, 16.4 deg from
    # the Zucker table's own Northern_Coalsack-named sightline group, and
    # itself an enormous (~23.5 deg) extended dark-lane feature - the same
    # "poor fit for this catalog's single-point model" exclusion reasoning
    # Story #318 used for Aquila Rift. Never added, never fabricated.
    for obj in catalog_objects:
        name_and_aliases = " ".join([obj.name, *obj.aliases]).lower()
        for fragment in EXCLUDED_CANDIDATE_NAME_FRAGMENTS:
            assert fragment not in name_and_aliases, (
                f"{obj.id} unexpectedly matches excluded-candidate fragment {fragment!r} "
                f"({obj.name!r} / {obj.aliases!r})"
            )


def test_coalsack_nebula_and_northern_coalsack_redundancy_check_documented(catalog_objects):
    # The issue's own redundancy-check instruction for Northern Coalsack:
    # confirm it is NOT the same object as the already-loaded Coalsack
    # Nebula record. That check passed (133.9 deg apart) - Northern
    # Coalsack was excluded for the separate reason above, not because it
    # was a duplicate of Coalsack Nebula. Coalsack Nebula itself must
    # remain untouched by this Story.
    coalsack = _by_id(catalog_objects, "coalsack-nebula")
    assert coalsack.distance.value_pc == 182.0
    assert "molecular-cloud-gap-fill" in coalsack.group.secondary


def test_no_new_molecular_cloud_record_has_a_zero_or_negative_distance(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.distance.value_pc > 0.0
