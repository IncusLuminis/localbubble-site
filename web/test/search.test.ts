import { describe, expect, it } from "vitest";
import { searchObjects } from "../src/scene/search";
import { SUN_OBJECT_ID } from "../src/scene/objects";
import type { SceneObject } from "../src/scene/sceneTypes";

/**
 * Name/alias search matching (issue #106, spec §2.6): "type a name ... the
 * view centers/frames on the matching object". Covers the three defined
 * outcomes from the issue's acceptance criteria - a unique match, ambiguous
 * (multiple) matches, and zero matches - plus the Sun-exclusion and
 * case/substring/alias matching rules `searchObjects` implements.
 */

function makeObject(overrides: Partial<SceneObject>): SceneObject {
  return {
    id: "test-object",
    name: "Test Object",
    aliases: [],
    object_type: "star",
    position_pc: [10, 20, 30],
    distance_pc: 37.4,
    distance_error_pc: null,
    size_pc: null,
    color_class: null,
    spectral_type: null,
    absolute_magnitude: null,
    apparent_magnitude: null,
    exoplanets: null,
    velocity: null,
    group: { primary: null, secondary: [] },
    source: { reference: "test fixture", url: null, catalog: null },
    notes: null,
    ...overrides,
  };
}

const ALPHA_CENTAURI = makeObject({
  id: "alpha-centauri",
  name: "Alpha Centauri",
  aliases: ["Rigil Kentaurus", "Toliman"],
});
const ALPHA_CENTAURI_B = makeObject({
  id: "alpha-centauri-b",
  name: "Alpha Centauri B",
  aliases: [],
});
const BARNARDS_STAR = makeObject({
  id: "barnards-star",
  name: "Barnard's Star",
  aliases: ["Gliese 699"],
});
const SUN_ENTRY = makeObject({
  id: SUN_OBJECT_ID,
  name: "Sun",
  object_type: "reference_point",
  position_pc: [0, 0, 0],
  distance_pc: 0,
});
// Mirrors real SIMBAD fixed-width padding quirks (issue #223): the
// catalog's actual "M  27" name and "HD  95735"-style multi-space aliases
// use two-or-more internal spaces, not one.
const M27_DUMBBELL = makeObject({
  id: "m27-dumbbell",
  name: "M  27",
  aliases: ["NAME Dumbbell Nebula"],
});
const LALANDE_21185 = makeObject({
  id: "lalande-21185",
  name: "Lalande 21185",
  aliases: ["HD  95735"],
});
// A decoy that mirrors a real, common catalog shape: a padded designation
// ("M  1234") embedded AFTER another catalog prefix token ("UBV"), rather
// than standing alone. A naive "strip all whitespace, then substring match"
// implementation would make a no-space query like "M1" match this too
// (since "ubvm1234" contains "m1") - the fix must not do that.
const DECOY_UBV_STAR = makeObject({
  id: "decoy-ubv-star",
  name: "Decoy Star",
  aliases: ["UBV M  1234"],
});

// Real collision found live during Validator review of this issue: querying
// "M1" against the actual #221 Messier-nebula batch matched not just the
// intended M 1 (Crab Nebula) but also M 16 and M 17, because the pre-fix
// tier-2 pattern only checked that the stored number STARTS WITH the
// query's digits, not that it equals them. These three mirror that exact
// batch's real name/alias shapes.
const CRAB_NEBULA = makeObject({
  id: "crab-nebula",
  name: "CRAB NEB",
  aliases: ["M   1"],
});
const EAGLE_NEBULA = makeObject({
  id: "eagle-nebula",
  name: "Eagle Nebula",
  aliases: ["M 16"],
});
const HORSESHOE_NEBULA = makeObject({
  id: "horseshoe-nebula",
  name: "NGC 6618 Horseshoe",
  aliases: ["M 17"],
});

const CATALOG = [
  ALPHA_CENTAURI,
  ALPHA_CENTAURI_B,
  BARNARDS_STAR,
  SUN_ENTRY,
  M27_DUMBBELL,
  LALANDE_21185,
  DECOY_UBV_STAR,
  CRAB_NEBULA,
  EAGLE_NEBULA,
  HORSESHOE_NEBULA,
];

describe("searchObjects", () => {
  it("returns a unique match when exactly one object's name matches", () => {
    const results = searchObjects(CATALOG, "Barnard");
    expect(results.map((o) => o.id)).toEqual(["barnards-star"]);
  });

  it("is case-insensitive", () => {
    const results = searchObjects(CATALOG, "ALPHA centauri b");
    expect(results.map((o) => o.id)).toEqual(["alpha-centauri-b"]);
  });

  it("matches as a substring, not just a prefix", () => {
    const results = searchObjects(CATALOG, "entaur");
    expect(results.map((o) => o.id).sort()).toEqual(["alpha-centauri", "alpha-centauri-b"]);
  });

  it("returns ambiguous (multiple) matches when the query is not specific enough", () => {
    const results = searchObjects(CATALOG, "Alpha Centauri");
    expect(results).toHaveLength(2);
    expect(results.map((o) => o.id).sort()).toEqual(["alpha-centauri", "alpha-centauri-b"]);
  });

  it("returns zero matches (an empty array, not an error) for a name not in the catalog", () => {
    const results = searchObjects(CATALOG, "Betelgeuse");
    expect(results).toEqual([]);
  });

  it("returns zero matches for an empty or whitespace-only query", () => {
    expect(searchObjects(CATALOG, "")).toEqual([]);
    expect(searchObjects(CATALOG, "   ")).toEqual([]);
  });

  it("matches against aliases, not just the primary name", () => {
    const results = searchObjects(CATALOG, "Rigil Kentaurus");
    expect(results.map((o) => o.id)).toEqual(["alpha-centauri"]);

    const gliese = searchObjects(CATALOG, "Gliese 699");
    expect(gliese.map((o) => o.id)).toEqual(["barnards-star"]);
  });

  it("excludes the Sun's dedicated-marker catalog entry even when its name matches", () => {
    const results = searchObjects(CATALOG, "Sun");
    expect(results).toEqual([]);
  });

  it("does not crash on an empty catalog", () => {
    expect(searchObjects([], "Alpha Centauri")).toEqual([]);
  });

  describe("whitespace normalization (issue #223)", () => {
    // Stored name is "M  27" (two internal spaces, SIMBAD's fixed-width
    // padding) - this would NOT substring-match "M27" or "M 27" pre-fix.
    it("matches a no-space query against a multi-space stored name", () => {
      const results = searchObjects(CATALOG, "M27");
      expect(results.map((o) => o.id)).toEqual(["m27-dumbbell"]);
    });

    it("matches a single-space query against a multi-space stored name", () => {
      const results = searchObjects(CATALOG, "M 27");
      expect(results.map((o) => o.id)).toEqual(["m27-dumbbell"]);
    });

    it("matches the query in its exact stored multi-space form too", () => {
      const results = searchObjects(CATALOG, "M  27");
      expect(results.map((o) => o.id)).toEqual(["m27-dumbbell"]);
    });

    it("applies the same normalization to multi-space aliases, not just names", () => {
      expect(searchObjects(CATALOG, "HD95735").map((o) => o.id)).toEqual(["lalande-21185"]);
      expect(searchObjects(CATALOG, "HD 95735").map((o) => o.id)).toEqual(["lalande-21185"]);
      expect(searchObjects(CATALOG, "HD  95735").map((o) => o.id)).toEqual(["lalande-21185"]);
    });

    it("does not affect matching for names/aliases without the multi-space quirk", () => {
      // A single-space query still matches only its intended single-space
      // target, and does not spuriously match the multi-space "M  27" entry.
      const results = searchObjects(CATALOG, "Alpha Centauri");
      expect(results.map((o) => o.id).sort()).toEqual(["alpha-centauri", "alpha-centauri-b"]);
      expect(results.map((o) => o.id)).not.toContain("m27-dumbbell");
    });

    it("does not let a no-space designation query match a padded number buried after another catalog prefix", () => {
      // Regression guard: an earlier implementation stripped ALL whitespace
      // from the compared text unconditionally, which made "M1" match
      // "UBV M  1234" too (both reduce to containing "m1" once every space
      // is removed). The fix requires the letter-prefix to be the target's
      // own LEADING token, not embedded after an unrelated prefix.
      const results = searchObjects(CATALOG, "M1234");
      expect(results.map((o) => o.id)).not.toContain("decoy-ubv-star");
      expect(results).toEqual([]);
    });

    it("does not let a no-space designation query match a stored number that merely starts with the same digits (regression: M1 vs M 16/M 17)", () => {
      // Live-reproduced by Validator: pre-fix, "M1" matched "M 16" and
      // "M 17" too, since the tier-2 pattern had no boundary after the
      // digit group and "16"/"17" both start with "1". The fix requires
      // the full number to match, not just a leading-digit prefix of it.
      const results = searchObjects(CATALOG, "M1");
      expect(results.map((o) => o.id)).toEqual(["crab-nebula"]);
      expect(results.map((o) => o.id)).not.toContain("eagle-nebula");
      expect(results.map((o) => o.id)).not.toContain("horseshoe-nebula");
    });
  });
});
