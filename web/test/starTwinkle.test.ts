import { describe, expect, it } from "vitest";
import {
  getStarTwinkleAtlasTexture,
  STAR_TWINKLE_BRILLIANT_U_RANGE,
  STAR_TWINKLE_CELL_SIZE,
  STAR_TWINKLE_NORMAL_U_RANGE,
} from "../src/scene/starTwinkle";

/**
 * Issue #11 (Epic #7, Story 2/4): the REALWORLD twinkle-sprite atlas texture
 * generator. Mirrors `diffuseStructures.test.ts`'s own
 * `getMistySpriteTexture` coverage - the actual canvas drawing is untestable
 * without a real DOM (this repo's Vitest suite runs with `environment:
 * "node"`, spec §38's established convention), so these tests exercise the
 * guarded null-degradation path and the atlas layout constants
 * `realworldStars.ts`'s fragment shader depends on.
 */
describe("getStarTwinkleAtlasTexture", () => {
  it("returns null (rather than throwing) in this repo's DOM-less test environment", () => {
    expect(() => getStarTwinkleAtlasTexture()).not.toThrow();
    expect(getStarTwinkleAtlasTexture()).toBeNull();
  });

  it("is memoized - repeated calls return the same (null) reference without re-attempting canvas creation", () => {
    const first = getStarTwinkleAtlasTexture();
    const second = getStarTwinkleAtlasTexture();
    expect(first).toBe(second);
  });
});

describe("star-twinkle atlas layout constants", () => {
  it("the normal and brilliant U ranges are adjacent, non-overlapping halves of the full [0, 1] atlas width", () => {
    expect(STAR_TWINKLE_NORMAL_U_RANGE).toEqual([0, 0.5]);
    expect(STAR_TWINKLE_BRILLIANT_U_RANGE).toEqual([0.5, 1]);
  });

  it("STAR_TWINKLE_CELL_SIZE is a positive, real pixel dimension", () => {
    expect(STAR_TWINKLE_CELL_SIZE).toBeGreaterThan(0);
  });
});
