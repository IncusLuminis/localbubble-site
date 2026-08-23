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

const CATALOG = [ALPHA_CENTAURI, ALPHA_CENTAURI_B, BARNARDS_STAR, SUN_ENTRY];

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
});
