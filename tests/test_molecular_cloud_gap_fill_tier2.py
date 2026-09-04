"""Validates the Story #325 new-record `molecular_cloud` gap-fill ("second
tier", follow-on to Story #324, itself follow-on to Story #318/Epic #313):
the remaining named regions from the already-cached Zucker et al. 2020
table (`data/raw/zucker_molecular_clouds/zucker_2020_handbook_table1.json`)
that are real and well-under-800pc but less mainstream-famous than Story
#324's tier - Cam, Hercules, Pegasus, Polaris (Flare), Ursa Major, Lacerta,
Spider, Aquila_Rift.

Same two-step provenance convention as Story #318/#324 (data/raw/gap_fills/
README.md): DISTANCE from the real, live-queried VizieR table
`J/A+A/633/A51/handbook`, POSITION from a separate SIMBAD identification-only
cross-match, `size_pc` (where resolvable) via the same SIMBAD
`galdim_majaxis`-based DIAMETER convention `data_sources/simbad_size.py`
(Story #314) established for this object type. `scripts/
acquire_molecular_cloud_gap_fill.py` was extended (not replaced) with this
Story's own candidates, its own `FALSE_COGNATE_CHECKS` block, and a 5th
element (Zucker `Name` group) on `EXCLUDED_CANDIDATES` tuples.

**4 candidates added** (all resolved cleanly via SIMBAD, well within this
Story's own established clean-match range - every genuine same-object match
across Story #318/#324/#325 lands under ~1.8 deg separation from the
matching Zucker sightline): Hercules Cloud (0.562 deg), Pegasus Cloud (1.718
deg), Spider Cirrus (0.058 deg), Ursa Major Cloud (0.918 deg, under a
corrected identifier - see below).

**4 candidates investigated and deliberately NOT added, all for the same
false-cognate/superposition-feature problem Story #318 first documented for
Aquila Rift and Story #324 re-hit for Northern Coalsack:**

* **Aquila_Rift** - re-examined per this Story's own explicit mandate, not
  re-attempted blindly. Same conclusion as Story #318 (already-established
  precedent, cited rather than re-derived): SIMBAD's own single-point
  identification ("NAME Aql Rift") sits 9.586 deg from the nearest
  `Aquila_Rift`-named sightline, and its own `galdim_majaxis` (1530 arcmin,
  ~25.5 deg) confirms it is an enormous superposition/foreground-extinction
  feature, not a single coherent cloud.
* **Cam** - SIMBAD's only resolvable identifier, "NAME Cam Cloud", sits 6.280
  deg from the nearest real `Cam`-named sightline. A `Simbad.query_region`
  around the real sightline group's own centroid found only catalog-only
  PGCC/DOBASHI/TGU designations there, no popular NAME-prefixed common name
  to anchor a corrected record to (the same shape of search Story #324 ran
  for Northern Coalsack).
* **Lacerta** - "NAME Lacerta Cloud" sits 6.744 deg from the nearest real
  `Lacerta`-named sightline; same empty-region-search result (only "NAME BL
  Lac", an unrelated blazar, within a few deg of the real centroid).
* **Polaris** - "NAME Polaris Cirrus Cloud" sits 4.440 deg from the nearest
  real `Polaris`-named sightline (an alternate identifier, "NAME Polaris
  Flare", was also tried - 7.511 deg, worse, not better). Same
  empty-region-search result.

**1 candidate required an alias correction rather than exclusion: Ursa
Major.** The table's own naive `SimbadName`-style identifier, "NAME UMa
Region" (otype `reg`, a generic region label), sits 19.457 deg from the
nearest real `Ursa_Major`-named sightline - worse than the Aquila Rift
exclusion threshold, and would have been excluded under the same reasoning.
But unlike Cam/Lacerta/Polaris, a *different* SIMBAD identifier for the same
physical object exists and resolves cleanly: "NAME UMa Cloud" (otype `MoC`,
also known as MBM 32 / "Ursa Major Cirrus" in the literature) sits only
0.918 deg away - a clean match. Added under this corrected identifier, per
`data_sources/simbad_size.py`'s own established "caller tries alternates,
adapter itself never guesses" convention. See `scripts/
acquire_molecular_cloud_gap_fill.py`'s `FALSE_COGNATE_CHECKS` block for the
reproducible side-by-side comparison of both identifiers.

**3 of 4 new records have `visual.size_pc: null`** - an honest failure (no
`galdim_majaxis` on file for the resolved identifier), not fabricated. Only
Hercules Cloud and Pegasus Cloud had a usable SIMBAD angular size.
"""

from __future__ import annotations

TAG = "molecular-cloud-gap-fill"

#: (catalog id, (min_pc, max_pc) sanity window around this Story's own
#: live-resolved Zucker+2020 d50 value) - same generous-margin convention
#: Story #318/#324's own NEW_MOLECULAR_CLOUDS tables use.
NEW_MOLECULAR_CLOUDS = [
    ("hercules-cloud", (190.0, 260.0)),
    ("pegasus-cloud", (220.0, 300.0)),
    ("spider-cirrus", (330.0, 410.0)),
    ("ursa-major-cloud", (360.0, 450.0)),
]

#: Story #318's original 4 new-record ids, and Story #324's 9 - used to
#: confirm this Story left them untouched.
STORY_318_IDS = {
    "corona-australis-molecular-cloud",
    "coalsack-nebula",
    "california-molecular-cloud",
    "serpens-molecular-cloud",
}

STORY_324_IDS = {
    "north-america-nebula",
    "pelican-nebula",
    "ic-5146-cocoon-nebula",
    "circinus-molecular-cloud",
    "norma-molecular-cloud",
    "mon-ob1-ngc-2264",
    "ic-2118-witch-head-nebula",
    "orion-lam-lambda-orionis-ring",
    "draco-cloud",
}

#: This Story's own honest-failure investigation results: candidates the
#: issue itself raised, live-checked, and explicitly did NOT add as
#: standalone records. Regression guard against accidentally introducing a
#: forced/fabricated record for any of them later. "aquila rift"/"aql rift"
#: duplicated here (Story #318 already guards this in
#: tests/test_molecular_cloud_gap_fill.py) since this Story explicitly
#: re-examined that exclusion and must not reverse it.
EXCLUDED_CANDIDATE_NAME_FRAGMENTS = [
    "aquila rift",
    "aql rift",
    "cam cloud",
    "lacerta cloud",
    "polaris cirrus cloud",
    "polaris flare",
]

#: The one candidate this Story corrected to an alternate SIMBAD identifier
#: rather than excluding - regression guard that the misleading alias
#: ("NAME UMa Region") never sneaks in as a record name/alias even though
#: the underlying object (under its corrected name) is legitimately added.
MISLEADING_ALIAS_FRAGMENTS = ["uma region"]

#: Every other gap-fill batch tag already in the catalog - this Story's own
#: additions must stay disjoint from all of them.
OTHER_GAP_FILL_TAGS = {
    "nearby-bright-star-gap-fill",
    "luminous-poster-gap-fill",
    "messier-nebula-gap-fill",
    "local-bubble-bright-named-gap-fill",
}


def _by_id(catalog_objects, object_id):
    matches = [obj for obj in catalog_objects if obj.id == object_id]
    assert len(matches) == 1, f"expected exactly one record with id {object_id!r}, got {len(matches)}"
    return matches[0]


def test_all_4_new_molecular_clouds_present_exactly_once(catalog_objects):
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


def test_new_record_distances_are_well_under_800pc(catalog_objects):
    # The spec's own stated molecular_cloud scope (Idea.md §9: "structures
    # within approximately 800 pc of the Sun") - this tier's own candidates
    # are all reported well under that, 163-472pc across the issue's list.
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.distance.value_pc < 500.0, (
            f"{object_id} distance {obj.distance.value_pc} pc is not well under "
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
    # Hercules Cloud and Pegasus Cloud both resolved a real SIMBAD
    # galdim_majaxis -> size_pc (DIAMETER convention, Story #314).
    for object_id in ("hercules-cloud", "pegasus-cloud"):
        obj = _by_id(catalog_objects, object_id)
        assert obj.visual.size_pc is not None
        assert obj.visual.size_pc > 0.0


def test_new_records_with_honest_failure_size_pc_are_null_and_documented(catalog_objects):
    honest_failure_ids = [
        object_id
        for object_id, _bounds in NEW_MOLECULAR_CLOUDS
        if object_id not in ("hercules-cloud", "pegasus-cloud")
    ]
    assert len(honest_failure_ids) == 2
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


def test_story_318_and_324_records_are_unchanged(catalog_objects):
    by_id = {obj.id: obj for obj in catalog_objects}
    expected = {
        "corona-australis-molecular-cloud": 147.0,
        "coalsack-nebula": 182.0,
        "california-molecular-cloud": 454.0,
        "serpens-molecular-cloud": 425.0,
        "north-america-nebula": 784.0,
        "pelican-nebula": 792.0,
        "ic-5146-cocoon-nebula": 751.0,
        "circinus-molecular-cloud": 675.0,
        "norma-molecular-cloud": 721.0,
        "mon-ob1-ngc-2264": 759.0,
        "ic-2118-witch-head-nebula": 273.0,
        "orion-lam-lambda-orionis-ring": 423.0,
        "draco-cloud": 481.0,
    }
    for object_id, distance_pc in expected.items():
        obj = by_id[object_id]
        assert obj.distance.value_pc == distance_pc


def test_catalog_has_at_least_the_25_expected_molecular_cloud_records(catalog_objects):
    # Relaxed from a strict `== 25` to a growth-tolerant `>=` (Story #326,
    # mirroring this same test's own #324 -> #325 precedent below): #326
    # adds Iris Nebula as a 26th molecular_cloud record (a non-Zucker
    # reflection nebula, tagged "non-zucker-nebula-gap-fill", not part of
    # this test's own #318/#324/#325 Zucker-batch id sets) - this test's
    # own job is confirming nothing pre-existing disappeared, not acting
    # as a permanent ceiling on legitimate future growth.
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
    expected = original_eight | STORY_318_IDS | STORY_324_IDS | {oid for oid, _ in NEW_MOLECULAR_CLOUDS}
    assert len(molecular_clouds) >= 25
    assert expected <= ids


def test_gap_fill_tag_now_covers_exactly_17_records(catalog_objects):
    # 4 from Story #318 + 9 from Story #324 + 4 from this Story - the
    # up-to-date total for the shared "molecular-cloud-gap-fill" batch tag.
    tagged = [obj for obj in catalog_objects if TAG in obj.group.secondary]
    tagged_ids = {obj.id for obj in tagged}
    assert len(tagged) == 17
    assert tagged_ids == STORY_318_IDS | STORY_324_IDS | {oid for oid, _ in NEW_MOLECULAR_CLOUDS}


def test_gap_fill_tag_does_not_leak_into_other_batches(catalog_objects):
    tagged = [obj for obj in catalog_objects if TAG in obj.group.secondary]
    for obj in tagged:
        assert not OTHER_GAP_FILL_TAGS.intersection(obj.group.secondary), (
            f"{obj.id} carries {TAG!r} plus a conflicting batch tag {obj.group.secondary!r}"
        )


def test_excluded_candidates_were_not_added_as_separate_records(catalog_objects):
    # Aquila_Rift, Cam, Lacerta, Polaris were investigated (per this
    # module's own docstring) and deliberately excluded as honest
    # failures/false cognates - regression guard against any of them
    # accidentally shipping later as a fabricated/force-matched record.
    for obj in catalog_objects:
        name_and_aliases = " ".join([obj.name, *obj.aliases]).lower()
        for fragment in EXCLUDED_CANDIDATE_NAME_FRAGMENTS:
            assert fragment not in name_and_aliases, (
                f"{obj.id} unexpectedly matches excluded-candidate fragment {fragment!r} "
                f"({obj.name!r} / {obj.aliases!r})"
            )


def test_misleading_ursa_major_alias_never_used_as_record_name(catalog_objects):
    # "NAME UMa Region" was the misleading, false-cognate alias (19.457 deg
    # from the real data) - the Ursa Major record that WAS added uses the
    # corrected "NAME UMa Cloud" identifier instead. Regression guard that
    # the misleading alias text itself never appears as this record's own
    # name/alias, even though the underlying object is legitimately present.
    for obj in catalog_objects:
        name_and_aliases = " ".join([obj.name, *obj.aliases]).lower()
        for fragment in MISLEADING_ALIAS_FRAGMENTS:
            assert fragment not in name_and_aliases, (
                f"{obj.id} unexpectedly matches misleading-alias fragment {fragment!r} "
                f"({obj.name!r} / {obj.aliases!r})"
            )


def test_ursa_major_cloud_was_added_under_the_corrected_identifier(catalog_objects):
    obj = _by_id(catalog_objects, "ursa-major-cloud")
    assert "MBM 32" in obj.aliases or any("MBM 32" in a for a in obj.aliases)
    assert "NAME UMa Cloud" in obj.source.reference


def test_no_new_molecular_cloud_record_has_a_zero_or_negative_distance(catalog_objects):
    for object_id, _bounds in NEW_MOLECULAR_CLOUDS:
        obj = _by_id(catalog_objects, object_id)
        assert obj.distance.value_pc > 0.0
