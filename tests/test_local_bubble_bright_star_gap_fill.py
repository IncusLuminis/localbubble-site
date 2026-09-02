"""Validates the Story #295 batch of standalone single-star "gap-fill"
catalog additions (Epic #294): 77 more real, genuinely-`NAME `-prefixed
bright stars (V<4.0) within 11-60pc (inside the Local Bubble, outside the
already-exhaustively-curated ~11.26pc RECONS sphere) not previously in the
catalog, following the same mechanism `test_gap_fill_stars.py` (Fomalhaut,
issue #207) and `test_bright_star_gap_fills.py` (34 more, issue #213)
already cover.

Unlike those two batches, this one was NOT built from any name list
transcribed by hand - it was re-derived live from a SIMBAD TAP/ADQL query
(V<4.0, parallax corresponding to 11-60pc, filtered for a genuine `NAME
`-prefixed common-name alias per this project's own `hasProperName`
convention, `web/src/scene/labels.ts`), then cross-checked against the
catalog that existed *before* this Story to exclude anything already
present. That re-derivation happened to reproduce exactly 77 new
candidates - matching Epic #294's own research count - including every one
of its 33 illustrative example names, plus Mizar B (a genuinely distinct
companion star to the already-cataloged Mizar A / zet01 UMa) which the
Epic separately flagged.

All 77 candidates resolved cleanly on the first attempt (0 skipped) -
including the four flagged near-RECONS-boundary candidates (Muphrid
~11.40pc, Porrima ~12.02pc, Deneb Algedi ~11.87pc, Zavijava ~11.00pc, all
individually verified to carry their own distinct `NAME `-prefixed alias
absent from the pre-Story catalog, not an alias collision with an existing
record) and the two other flagged multi-component systems (Algol, Castor):
neither produced a *new* NAME-prefixed candidate at all, since SIMBAD
resolves both names to the same already-cataloged component the earlier
gap-fill batch already added - correctly excluded by the pre-acquisition
cross-check, not silently re-added under a different id.

See `data/raw/gap_fills/README.md` for the full writeup.
"""

TAG = "local-bubble-bright-named-gap-fill"

#: (proper name exactly as it appears after SIMBAD's "NAME " prefix,
#: (min_pc, max_pc)) - distance bounds are a generous +/-15% margin around
#: this Story's own live-resolved figure (same convention
#: test_bright_star_gap_fills.py already uses), not a re-assertion of
#: SIMBAD's exact current parallax-derived value, which can drift slightly
#: on a future re-resolution.
GAP_FILL_STARS = [
    ("alioth", (21.5, 29.1)),
    ("kaus australis", (37.3, 50.5)),
    ("alhena", (28.5, 38.5)),
    ("menkent", (15.3, 20.7)),
    ("alpheratz", (25.3, 34.2)),
    ("caph", (14.3, 19.3)),
    ("ankaa", (22.1, 29.9)),
    ("phecda", (21.7, 29.3)),
    ("markab", (34.8, 47.0)),
    ("zosma", (15.2, 20.6)),
    ("gienah", (40.0, 54.2)),
    ("ascella", (23.0, 31.1)),
    ("mahasim", (43.1, 58.4)),
    ("kraz", (38.6, 52.3)),
    ("sheratan", (15.3, 20.7)),
    ("ruchbah", (25.9, 35.1)),
    ("muphrid", (9.7, 13.1)),
    ("porrima", (10.2, 13.8)),
    ("yed prior", (41.6, 56.3)),
    ("cebalrai", (21.7, 29.3)),
    ("kornephoros", (38.6, 52.3)),
    ("cursa", (23.5, 31.7)),
    ("vindemiatrix", (28.1, 38.1)),
    ("tureis", (16.5, 22.4)),
    ("kaus borealis", (19.8, 26.8)),
    ("deneb algedi", (10.1, 13.6)),
    ("nihal", (40.7, 55.1)),
    ("cor caroli", (26.0, 35.1)),
    ("gomeisa", (42.1, 57.0)),
    ("altaleban", (45.3, 61.3)),
    ("zaurak", (50.0, 67.6)),
    ("algorab", (22.3, 30.2)),
    ("alnasl", (26.3, 35.6)),
    ("aldhanab", (47.7, 64.6)),
    ("seginus", (22.4, 30.3)),
    ("tania australis", (47.8, 64.6)),
    ("altais", (25.5, 34.5)),
    ("wazn", (23.0, 31.2)),
    ("sarin", (19.6, 26.5)),
    ("talitha", (12.3, 16.7)),
    ("yed posterior", (27.9, 37.7)),
    ("hadir", (49.9, 67.6)),
    ("skat", (36.7, 49.7)),
    ("edasich", (26.1, 35.4)),
    ("megrez", (21.1, 28.5)),
    ("chertan", (41.8, 56.6)),
    ("minelauva", (48.8, 66.1)),
    ("heze", (19.4, 26.3)),
    ("muscida", (47.4, 64.1)),
    ("mothallah", (16.6, 22.4)),
    ("kaffaljidhma", (20.7, 28.1)),
    ("sadalbari", (29.4, 39.7)),
    ("subra", (35.1, 47.5)),
    ("ain", (38.0, 51.4)),
    ("wasat", (15.8, 21.4)),
    ("biham", (23.1, 31.3)),
    ("algedi", (28.4, 38.4)),
    ("zavijava", (9.4, 12.7)),
    ("rotanev", (26.3, 35.6)),
    ("prima hyadum", (39.2, 53.1)),
    ("nashira", (44.5, 60.2)),
    ("chow", (39.4, 53.3)),
    ("nusakan", (30.4, 41.2)),
    ("alshain", (11.6, 15.6)),
    ("grumium", (29.2, 39.6)),
    ("secunda hyadum", (41.9, 56.6)),
    ("misam", (29.6, 40.0)),
    ("praecipua", (25.8, 34.9)),
    ("sadachbia", (32.9, 44.5)),
    ("sceptrum", (29.4, 39.8)),
    ("azha", (35.1, 47.5)),
    ("mizar b", (21.1, 28.5)),
    ("rasalas", (32.6, 44.1)),
    ("tyl", (39.9, 53.9)),
    ("kitalpha", (49.4, 66.9)),
    ("asellus australis", (35.7, 48.3)),
    ("rukbat", (46.9, 63.5)),
]

#: Candidates individually flagged by Epic #294 as needing extra care
#: before acquiring - either near the ~11.26pc RECONS sphere boundary, or
#: belonging to a multi-component system where a sibling component is
#: already cataloged. All are exact-name-matched below like every other
#: entry; this subset is spot-checked again in
#: test_recons_boundary_candidates_are_genuinely_distinct for extra
#: confidence, since these were the ones most likely to turn out to be
#: duplicates/alias collisions.
RECONS_BOUNDARY_NAMES = {"muphrid", "porrima", "deneb algedi", "zavijava"}


def _find_by_exact_name(catalog_objects, proper_name):
    """Match a record whose `name` or an alias is EXACTLY "NAME <proper_name>"
    (case-insensitive) - not a bare/word-boundary substring search.

    A word-boundary substring search is not safe here: "Algedi" is a whole
    word inside "NAME Deneb Algedi" too (a *different*, already-distinct
    catalog record in this same batch), so `\\bAlgedi\\b` would match both.
    Requiring the *entire* alias to equal "NAME <proper_name>" is exactly
    the same check the acquisition script itself used to verify each
    candidate before acquiring it (see data/raw/gap_fills/README.md), so
    the test re-asserts the same unambiguous identity check rather than a
    looser heuristic that could silently pass on a collision like this.
    """
    target = f"name {proper_name}".strip().lower()
    return [
        obj
        for obj in catalog_objects
        if obj.name.strip().lower() == target
        or any(alias.strip().lower() == target for alias in obj.aliases)
    ]


def test_all_77_gap_fill_stars_present_exactly_once(catalog_objects):
    missing = []
    duplicated = []
    for proper_name, _bounds in GAP_FILL_STARS:
        matches = _find_by_exact_name(catalog_objects, proper_name)
        if len(matches) == 0:
            missing.append(proper_name)
        elif len(matches) > 1:
            duplicated.append((proper_name, len(matches)))
    assert not missing, f"expected gap-fill stars not found in catalog: {missing}"
    assert not duplicated, f"gap-fill stars matched more than one record: {duplicated}"


def test_gap_fill_stars_are_type_star(catalog_objects):
    for proper_name, _bounds in GAP_FILL_STARS:
        obj = _find_by_exact_name(catalog_objects, proper_name)[0]
        assert obj.object_type == "star", f"{proper_name} is not object_type 'star'"


def test_gap_fill_stars_tagged_with_correct_provenance_tag(catalog_objects):
    for proper_name, _bounds in GAP_FILL_STARS:
        obj = _find_by_exact_name(catalog_objects, proper_name)[0]
        assert TAG in obj.group.secondary, (
            f"{proper_name} (id={obj.id}) expected tag {TAG!r}, got "
            f"{obj.group.secondary!r}"
        )


def test_gap_fill_star_distances_are_physically_sane(catalog_objects):
    for proper_name, (min_pc, max_pc) in GAP_FILL_STARS:
        obj = _find_by_exact_name(catalog_objects, proper_name)[0]
        assert min_pc < obj.distance.value_pc < max_pc, (
            f"{proper_name} (id={obj.id}) distance {obj.distance.value_pc} pc "
            f"outside expected [{min_pc}, {max_pc}] pc"
        )


def test_gap_fill_star_distances_are_within_local_bubble_range(catalog_objects):
    # Story #295's own acceptance criterion: 11-60pc (inside the Local
    # Bubble, outside the exhaustively-curated ~11.26pc RECONS sphere).
    # Generous +/-2% slack on both ends for parallax-derivation rounding
    # (Zavijava resolves to ~11.00pc, just inside the nominal 11pc query
    # boundary and, like Fomalhaut before it (issue #207), a genuine
    # RECONS-transcription gap rather than a duplicate - see
    # test_recons_boundary_candidates_are_genuinely_distinct below).
    for proper_name, _bounds in GAP_FILL_STARS:
        obj = _find_by_exact_name(catalog_objects, proper_name)[0]
        assert 10.5 < obj.distance.value_pc < 61.5, (
            f"{proper_name} (id={obj.id}) distance {obj.distance.value_pc} pc "
            "is outside this Story's own 11-60pc Local Bubble query range"
        )


def test_gap_fill_stars_have_dual_provenance_and_do_not_claim_batch_membership(
    catalog_objects,
):
    for proper_name, _bounds in GAP_FILL_STARS:
        obj = _find_by_exact_name(catalog_objects, proper_name)[0]
        assert obj.source.catalog == "SIMBAD"
        assert obj.source.reference
        notes_lower = (obj.notes or "").lower()
        assert "gap-fill" in notes_lower or "gap fill" in notes_lower, (
            f"{proper_name} (id={obj.id}) notes do not document gap-fill provenance"
        )
        # Must not claim membership in any prior curated/gap-fill batch -
        # that's the whole point of this batch's own distinct tag.
        assert "recons-nearest-100" not in obj.group.secondary
        assert "nearby-bright-star-gap-fill" not in obj.group.secondary
        assert "luminous-poster-gap-fill" not in obj.group.secondary


def test_gap_fill_tags_do_not_leak_into_other_batches(catalog_objects):
    # Regression guard mirroring the other gap-fill test modules' own
    # version of this check: this batch's tag must stay disjoint from
    # every other batch's tag.
    other_tags = {
        "recons-nearest-100",
        "nearby-bright-star-gap-fill",
        "luminous-poster-gap-fill",
        "messier-nebula-gap-fill",
    }
    tagged = [obj for obj in catalog_objects if TAG in obj.group.secondary]
    for obj in tagged:
        assert not other_tags.intersection(obj.group.secondary), (
            f"{obj.id} carries {TAG!r} plus a conflicting batch tag "
            f"{obj.group.secondary!r}"
        )
    for obj in catalog_objects:
        if other_tags.intersection(obj.group.secondary):
            assert TAG not in obj.group.secondary


def test_mizar_b_is_genuinely_distinct_from_already_cataloged_mizar_a(catalog_objects):
    # Epic #294 specifically flagged Mizar as a multi-component system
    # where one component (Mizar A / zet01 UMa, "nearby-bright-star-gap-fill",
    # issue #213) was already cataloged - Mizar B resolves to a distinct
    # SIMBAD identifier (zet02 UMa) with its own parallax/photometry, not a
    # duplicate of A.
    mizar_b_matches = _find_by_exact_name(catalog_objects, "mizar b")
    assert len(mizar_b_matches) == 1
    mizar_b = mizar_b_matches[0]
    assert mizar_b.id == "zet02_uma"
    assert TAG in mizar_b.group.secondary

    mizar_a_matches = [
        obj
        for obj in catalog_objects
        if any("NAME Mizar A" in alias for alias in obj.aliases)
    ]
    assert len(mizar_a_matches) == 1
    mizar_a = mizar_a_matches[0]
    assert mizar_a.id == "zet01_uma"
    assert mizar_a.id != mizar_b.id
    assert "nearby-bright-star-gap-fill" in mizar_a.group.secondary


def test_recons_boundary_candidates_are_genuinely_distinct(catalog_objects):
    # Epic #294 flagged Muphrid (~11.4pc), Porrima (~12.0pc), Deneb Algedi
    # (~11.9pc), and Zavijava (~11.0pc) as sitting right at/near the
    # ~11.26pc RECONS sphere boundary, to be double-checked as genuinely
    # distinct, not-already-cataloged objects rather than alias collisions.
    # All four resolved to their own unique catalog record here.
    for proper_name in RECONS_BOUNDARY_NAMES:
        matches = _find_by_exact_name(catalog_objects, proper_name)
        assert len(matches) == 1, (
            f"RECONS-boundary candidate {proper_name!r} matched "
            f"{len(matches)} records, expected exactly 1"
        )
        obj = matches[0]
        assert TAG in obj.group.secondary
        assert "recons-nearest-100" not in obj.group.secondary


def test_algol_and_castor_did_not_produce_duplicate_new_records(catalog_objects):
    # Epic #294 also flagged Algol and Castor as multi-component systems to
    # verify - unlike Mizar, live re-derivation found no genuinely NEW
    # NAME-prefixed candidate under either name: SIMBAD resolves both to
    # the same already-cataloged component the issue #213 gap-fill batch
    # added, so the pre-acquisition cross-check correctly excluded them
    # rather than re-adding a duplicate under a new id. This just confirms
    # exactly one Algol and one Castor record exist post-Story, both still
    # carrying their original (not this Story's) gap-fill tag.
    algol_matches = [
        obj
        for obj in catalog_objects
        if any(alias.strip().lower() == "name algol" for alias in obj.aliases)
        or obj.name.strip().lower() == "name algol"
    ]
    assert len(algol_matches) == 1
    assert TAG not in algol_matches[0].group.secondary

    castor_matches = [
        obj
        for obj in catalog_objects
        if any(alias.strip().lower() == "name castor" for alias in obj.aliases)
        or obj.name.strip().lower() == "name castor"
    ]
    assert len(castor_matches) == 1
    assert TAG not in castor_matches[0].group.secondary


def test_gap_fill_batch_adds_exactly_77_new_records(catalog_objects):
    tagged = [obj for obj in catalog_objects if TAG in obj.group.secondary]
    assert len(tagged) == len(GAP_FILL_STARS) == 77


def test_gap_fill_stars_carry_velocity(catalog_objects):
    # Story #296 supersedes this test's prior form (the Validator's PR
    # #297 regression guard, which asserted the *opposite*: that this
    # batch must NOT carry velocity yet, since Story #295's own Definition
    # of Done explicitly deferred derivation - "that's Story 2's job").
    # Story #296 is that Story 2: every one of the 77 gap-fill stars must
    # now carry a real, derived `velocity` (never fabricated - see
    # `data_sources/simbad.py`'s own "never fabricate" docstring), and
    # this test flips to guard *that* invariant instead so a future
    # re-acquisition of this batch cannot silently regress it back to
    # velocity-less.
    #
    # Checked two ways: every catalog record carrying this batch's tag
    # (not just the name-matched subset), and every individually
    # name-matched GAP_FILL_STARS entry - so a record that lost its tag
    # but kept its name, or vice versa, cannot silently slip past either
    # check.
    tagged = [obj for obj in catalog_objects if TAG in obj.group.secondary]
    assert len(tagged) == 77
    tagged_without_velocity = [obj.id for obj in tagged if obj.velocity is None]
    assert not tagged_without_velocity, (
        "gap-fill batch records must carry a derived velocity as of Story "
        f"#296: {tagged_without_velocity}"
    )

    named_without_velocity = []
    for proper_name, _bounds in GAP_FILL_STARS:
        obj = _find_by_exact_name(catalog_objects, proper_name)[0]
        if obj.velocity is None:
            named_without_velocity.append(proper_name)
    assert not named_without_velocity, (
        f"gap-fill stars must carry a derived velocity as of Story #296: "
        f"{named_without_velocity}"
    )

    # Story #296's own implausible-speed scan (issue #234/#286's
    # established pitfall: a bad SIMBAD rvz_radvel cross-match producing a
    # nonsensical total space velocity) - re-asserted here as a permanent
    # regression guard, not just a one-time PR-documented scan, since a
    # future re-derivation of this exact batch could reintroduce a bad
    # value the `mesVelocities` fallback (`data_sources/simbad.py`) is
    # meant to catch.
    implausible = [
        (obj.id, (obj.velocity.vx_kms**2 + obj.velocity.vy_kms**2 + obj.velocity.vz_kms**2) ** 0.5)
        for obj in tagged
        if (obj.velocity.vx_kms**2 + obj.velocity.vy_kms**2 + obj.velocity.vz_kms**2) ** 0.5 > 500.0
    ]
    assert not implausible, f"implausible (>500 km/s) derived speed: {implausible}"
