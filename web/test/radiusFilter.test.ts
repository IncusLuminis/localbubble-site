import { describe, expect, it } from "vitest";
import { DEFAULT_RADIUS_PC, isWithinRadius, RADIUS_PRESETS_PC } from "../src/scene/radiusFilter";

/**
 * Pure-predicate coverage for the radius filter (spec Idea.md §28). No
 * WebGL/Three.js dependency - `isWithinRadius` is a plain numeric
 * predicate over `distance_pc` values already present in `scene.json`.
 */

describe("RADIUS_PRESETS_PC", () => {
  it("matches spec §28's preset list", () => {
    expect(RADIUS_PRESETS_PC).toEqual([100, 250, 500, 800, 1000, 2000]);
  });

  it("defaults to 800pc, matching the spec §2 conceptual UI sketch", () => {
    expect(DEFAULT_RADIUS_PC).toBe(800);
  });
});

describe("isWithinRadius", () => {
  it("includes an object exactly at the radius boundary", () => {
    expect(isWithinRadius(800, 800)).toBe(true);
  });

  it("excludes an object just beyond the radius", () => {
    expect(isWithinRadius(800.01, 800)).toBe(false);
  });

  it("includes a nearby object well within the radius", () => {
    expect(isWithinRadius(47.5, 800)).toBe(true);
  });

  it("excludes the Cepheus OB associations (816-1009pc) at the 800pc preset", () => {
    expect(isWithinRadius(816, 800)).toBe(false);
    expect(isWithinRadius(886.5, 800)).toBe(false);
    expect(isWithinRadius(1009, 800)).toBe(false);
  });

  it("includes the Cepheus OB associations once the radius is widened enough", () => {
    // cepheus-ob3 (816pc) and cepheus-ob2 (886.5pc) fit within the 1kpc
    // preset; cepheus-ob4 (1009pc) needs the 2kpc preset (it's just past
    // 1000pc).
    expect(isWithinRadius(816, 1000)).toBe(true);
    expect(isWithinRadius(886.5, 1000)).toBe(true);
    expect(isWithinRadius(1009, 1000)).toBe(false);
    expect(isWithinRadius(1009, 2000)).toBe(true);
  });

  it("treats a null radius as 'no filter' (everything visible)", () => {
    expect(isWithinRadius(0, null)).toBe(true);
    expect(isWithinRadius(50_000, null)).toBe(true);
  });

  it("does not hard-code an 800pc ceiling - an arbitrary larger radius still works", () => {
    expect(isWithinRadius(5000, 10_000)).toBe(true);
  });
});
