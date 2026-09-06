import { describe, expect, it } from "vitest";
import { DEFAULT_STAR_RENDER_STYLE, parseStarRenderStyle, STAR_RENDER_STYLES } from "../src/scene/starRenderStyle";

/**
 * Issue #10 (Epic #7, Story 1/4): the MODEL/REALWORLD style's type/default/
 * validation. Issue #19 folded this file's former `localStorage` load/save
 * functions (and their own tests, previously here) into
 * `ui/settingsPersistence.ts`'s unified `PersistedSettings` mechanism - see
 * `test/settingsPersistence.test.ts` for that coverage now, including this
 * exact `parseStarRenderStyle` validation reused as one field's parser.
 */

describe("parseStarRenderStyle", () => {
  it("accepts every valid StarRenderStyle value unchanged", () => {
    for (const style of STAR_RENDER_STYLES) {
      expect(parseStarRenderStyle(style)).toBe(style);
    }
  });

  it("falls back to the default for null (key never set)", () => {
    expect(parseStarRenderStyle(null)).toBe(DEFAULT_STAR_RENDER_STYLE);
  });

  it("falls back to the default for an empty string, garbage, or a stale/future value", () => {
    expect(parseStarRenderStyle("")).toBe(DEFAULT_STAR_RENDER_STYLE);
    expect(parseStarRenderStyle("not-a-real-style")).toBe(DEFAULT_STAR_RENDER_STYLE);
    expect(parseStarRenderStyle("model")).toBe(DEFAULT_STAR_RENDER_STYLE); // case-sensitive - not "MODEL"
    expect(parseStarRenderStyle("SPRITE")).toBe(DEFAULT_STAR_RENDER_STYLE); // a hypothetical future Story #11+ style
  });
});

describe("DEFAULT_STAR_RENDER_STYLE / STAR_RENDER_STYLES", () => {
  it("defaults to VISUAL, per issue #33 (Epic #7 graduating to the default experience)", () => {
    expect(DEFAULT_STAR_RENDER_STYLE).toBe("VISUAL");
  });

  it("lists exactly MODEL and REALWORLD, nothing else, for this Story", () => {
    expect(STAR_RENDER_STYLES).toEqual(["MODEL", "VISUAL"]);
  });
});
