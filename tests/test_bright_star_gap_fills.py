"""Validates the issue #213 batch of standalone single-star "gap-fill"
catalog additions - 34 more naked-eye-famous stars missing from both the
Galaxy Map poster batch and the RECONS nearest-100 batch, following the
same mechanism `test_gap_fill_stars.py` already covers for Fomalhaut
(issue #207).

33 of the 34 are proximity-driven (RECONS-gap) additions, tagged
`group.secondary: ["nearby-bright-star-gap-fill"]` - the same tag
Fomalhaut uses. One (Alnilam / epsilon Orionis) is a different kind of
gap - a likely missed import from the Galaxy Map luminous-poster batch,
not a proximity issue - tagged distinctly:
`group.secondary: ["luminous-poster-gap-fill"]`.

See `data/raw/gap_fills/README.md` for the full writeup.
"""

import re

PROXIMITY_TAG = "nearby-bright-star-gap-fill"
LUMINOUS_POSTER_TAG = "luminous-poster-gap-fill"

#: (search substring for name/aliases, expected tag, (min_pc, max_pc))
#: Distance bounds are generous (well beyond SIMBAD's own parallax error)
#: around commonly-cited public figures - this pins gross errors (wrong
#: cross-match, unit mistakes) without re-asserting SIMBAD's exact current
#: parallax-derived figure, which can drift slightly on a future
#: re-resolution (same convention `test_gap_fill_stars.py` uses for
#: Fomalhaut).
GAP_FILL_STARS = [
    # Tier 1
    ("arcturus", PROXIMITY_TAG, (9.0, 13.5)),
    ("vega", PROXIMITY_TAG, (6.5, 9.0)),
    ("capella", PROXIMITY_TAG, (11.0, 15.5)),
    ("aldebaran", PROXIMITY_TAG, (17.0, 24.0)),
    ("regulus", PROXIMITY_TAG, (20.0, 28.0)),
    ("pollux", PROXIMITY_TAG, (8.5, 12.5)),
    ("castor", PROXIMITY_TAG, (13.0, 18.0)),
    ("denebola", PROXIMITY_TAG, (9.0, 13.0)),
    # Tier 2
    ("dubhe", PROXIMITY_TAG, (32.0, 44.0)),
    ("merak", PROXIMITY_TAG, (22.0, 30.0)),
    ("alkaid", PROXIMITY_TAG, (27.0, 37.0)),
    ("mizar", PROXIMITY_TAG, (20.0, 30.0)),
    ("alcor", PROXIMITY_TAG, (21.0, 29.0)),
    ("menkalinan", PROXIMITY_TAG, (21.0, 29.0)),
    ("alderamin", PROXIMITY_TAG, (12.0, 18.0)),
    ("eltanin", PROXIMITY_TAG, (40.0, 55.0)),
    ("rasalhague", PROXIMITY_TAG, (12.0, 18.0)),
    ("kochab", PROXIMITY_TAG, (35.0, 46.0)),
    ("diphda", PROXIMITY_TAG, (25.0, 34.0)),
    ("hamal", PROXIMITY_TAG, (17.0, 24.0)),
    ("algol", PROXIMITY_TAG, (23.0, 32.0)),
    ("alphecca", PROXIMITY_TAG, (20.0, 28.0)),
    ("unukalhai", PROXIMITY_TAG, (19.0, 27.0)),
    ("sabik", PROXIMITY_TAG, (23.0, 32.0)),
    ("zubenelgenubi", PROXIMITY_TAG, (19.0, 28.0)),
    # Tier 3
    ("nunki", PROXIMITY_TAG, (55.0, 85.0)),
    ("alnair", PROXIMITY_TAG, (26.0, 36.0)),
    ("gacrux", PROXIMITY_TAG, (23.0, 32.0)),
    ("elnath", PROXIMITY_TAG, (35.0, 47.0)),
    ("zubeneschamali", PROXIMITY_TAG, (46.0, 65.0)),
    # Borderline
    ("achernar", PROXIMITY_TAG, (36.0, 50.0)),
    ("alphard", PROXIMITY_TAG, (48.0, 64.0)),
    ("peacock", PROXIMITY_TAG, (48.0, 64.0)),
    ("miaplacidus", PROXIMITY_TAG, (28.0, 40.0)),
    # Separate gap: Galaxy Map luminous-poster batch omission (blue
    # supergiant, hundreds of pc away - NOT a proximity/Local-Bubble star).
    ("alnilam", LUMINOUS_POSTER_TAG, (300.0, 900.0)),
]


#: Story #295 (a later, separate batch) added Mizar B (zet02 UMa, tag
#: "local-bubble-bright-named-gap-fill") - a genuinely distinct star whose
#: alias also contains the bare word "Mizar". `_find` below excludes this
#: one specific id so `\bmizar\b` still resolves unambiguously to this
#: module's own Mizar A (zet01 UMa, issue #213); every other word in this
#: module's GAP_FILL_STARS list is unaffected.
_MIZAR_B_ID = "zet02_uma"


def _find(catalog_objects, word):
    # Word-boundary match (not a bare substring) - "hamal" is a bare
    # substring of "Zubeneschamali" (bet_lib's alias "NAME Zubeneschamali"),
    # which a plain `in` check falsely matches as a second "Hamal" record.
    pattern = re.compile(rf"\b{re.escape(word)}\b", re.IGNORECASE)
    return [
        obj
        for obj in catalog_objects
        if obj.id != _MIZAR_B_ID
        and (pattern.search(obj.name) or any(pattern.search(alias) for alias in obj.aliases))
    ]


def test_all_34_gap_fill_stars_present_exactly_once(catalog_objects):
    missing = []
    duplicated = []
    for substring, _tag, _bounds in GAP_FILL_STARS:
        matches = _find(catalog_objects, substring)
        if len(matches) == 0:
            missing.append(substring)
        elif len(matches) > 1:
            duplicated.append((substring, len(matches)))
    assert not missing, f"expected gap-fill stars not found in catalog: {missing}"
    assert not duplicated, f"gap-fill stars matched more than one record: {duplicated}"


def test_gap_fill_stars_are_type_star(catalog_objects):
    for substring, _tag, _bounds in GAP_FILL_STARS:
        obj = _find(catalog_objects, substring)[0]
        assert obj.object_type == "star", f"{substring} is not object_type 'star'"


def test_gap_fill_stars_tagged_with_correct_provenance_tag(catalog_objects):
    for substring, tag, _bounds in GAP_FILL_STARS:
        obj = _find(catalog_objects, substring)[0]
        assert tag in obj.group.secondary, (
            f"{substring} (id={obj.id}) expected tag {tag!r}, got "
            f"{obj.group.secondary!r}"
        )


def test_proximity_and_luminous_poster_tags_stay_disjoint(catalog_objects):
    # Alnilam must NOT carry the proximity gap-fill tag, and none of the
    # proximity stars may carry the luminous-poster tag - the two gap
    # stories are honestly distinct (issue #213) and must not be
    # conflated.
    for substring, tag, _bounds in GAP_FILL_STARS:
        obj = _find(catalog_objects, substring)[0]
        other_tag = LUMINOUS_POSTER_TAG if tag == PROXIMITY_TAG else PROXIMITY_TAG
        assert other_tag not in obj.group.secondary, (
            f"{substring} (id={obj.id}) unexpectedly also carries {other_tag!r}"
        )


def test_gap_fill_star_distances_are_physically_sane(catalog_objects):
    for substring, _tag, (min_pc, max_pc) in GAP_FILL_STARS:
        obj = _find(catalog_objects, substring)[0]
        assert min_pc < obj.distance.value_pc < max_pc, (
            f"{substring} (id={obj.id}) distance {obj.distance.value_pc} pc "
            f"outside expected [{min_pc}, {max_pc}] pc"
        )


def test_gap_fill_stars_have_dual_provenance_and_do_not_claim_batch_membership(
    catalog_objects,
):
    for substring, _tag, _bounds in GAP_FILL_STARS:
        obj = _find(catalog_objects, substring)[0]
        assert obj.source.catalog == "SIMBAD"
        assert obj.source.reference
        notes_lower = (obj.notes or "").lower()
        assert "gap-fill" in notes_lower or "gap fill" in notes_lower, (
            f"{substring} (id={obj.id}) notes do not document gap-fill provenance"
        )
        # Must not claim original RECONS-nearest-100 candidate-list
        # membership - that's the whole point of the gap-fill mechanism.
        assert "recons-nearest-100" not in obj.group.secondary


def test_gap_fill_tags_do_not_leak_into_recons_batch(catalog_objects):
    # Regression guard mirroring test_gap_fill_stars.py's own version of
    # this check: the gap-fill mechanism must stay disjoint from the
    # RECONS batch's own tag/tests (test_nearby_stars.py counts/asserts
    # against "recons-nearest-100" specifically).
    recons_tagged = [
        obj for obj in catalog_objects if "recons-nearest-100" in obj.group.secondary
    ]
    for obj in recons_tagged:
        assert PROXIMITY_TAG not in obj.group.secondary
        assert LUMINOUS_POSTER_TAG not in obj.group.secondary


def test_mizar_resolved_via_disambiguated_simbad_identifier(catalog_objects):
    # "Mizar" is ambiguous once SIMBAD's V (apparent magnitude) votable
    # field is requested (an upstream join quirk on that specific alias -
    # verified empirically: the plain "Mizar" query returns 0 rows once
    # `V` is added to the field list, while every other field works fine).
    # Resolved instead via SIMBAD's own preferred identifier for the
    # bright, visible component, "zet01 UMa" (whose aliases include "NAME
    # Mizar A") - still a live, honest SIMBAD resolution of the same real
    # star, not a fabricated shortcut.
    matches = _find(catalog_objects, "mizar")
    assert len(matches) == 1
    mizar = matches[0]
    assert mizar.id == "zet01_uma"
    assert any("NAME Mizar A" in alias for alias in mizar.aliases)
    assert PROXIMITY_TAG in mizar.group.secondary


def test_alnilam_neighbors_alnitak_and_mintaka_already_present(catalog_objects):
    # Alnilam's gap is specifically a likely missed import from the Galaxy
    # Map luminous-poster batch, evidenced by its Belt neighbors already
    # being present under that batch - regression guard for that claim.
    assert _find(catalog_objects, "alnitak"), "Alnitak (zeta Orionis) missing"
    assert _find(catalog_objects, "mintaka"), "Mintaka (delta Orionis) missing"


def test_gap_fill_batch_adds_exactly_35_new_records(catalog_objects):
    # 34 named stars in issue #213's tiered list (Arcturus...Miaplacidus)
    # plus Alnilam = 35 distinct SIMBAD resolutions attempted and
    # successfully resolved (Mizar required a disambiguated identifier,
    # see test_mizar_resolved_via_disambiguated_simbad_identifier, but is
    # still exactly one star/one record). This is in addition to
    # Fomalhaut's own pre-existing single gap-fill record (issue #207).
    gap_fill_tagged = [
        obj
        for obj in catalog_objects
        if PROXIMITY_TAG in obj.group.secondary or LUMINOUS_POSTER_TAG in obj.group.secondary
    ]
    assert len(gap_fill_tagged) == len(GAP_FILL_STARS) + 1  # +1 for Fomalhaut
