import { describe, expect, it } from "vitest";
import {
  DEFAULT_STAR_RENDER_STYLE,
  loadStarRenderStyle,
  parseStarRenderStyle,
  saveStarRenderStyle,
  STAR_RENDER_STYLE_STORAGE_KEY,
  STAR_RENDER_STYLES,
} from "../src/scene/starRenderStyle";

/**
 * Issue #10 (Epic #7, Story 1/4): the MODEL/REALWORLD style's persistence
 * plumbing. This repo's vitest config runs in a DOM-free `node` environment
 * (see `vite.config.ts`), so there's no real `localStorage` global to test
 * against - `loadStarRenderStyle`/`saveStarRenderStyle` are deliberately
 * written to take a minimal `Storage`-shaped object as a parameter (rather
 * than reaching for a global themselves) specifically so they're directly
 * testable here with a small fake, mirroring this codebase's existing split
 * between DOM-wiring (untested here, verified live) and pure/injectable
 * logic (unit tested) - see `test/fullscreenToggle.test.ts`'s own docstring
 * for the same pattern elsewhere in this suite.
 */

/** A minimal in-memory fake satisfying the `Pick<Storage, "getItem">`/
 * `Pick<Storage, "setItem">` shapes `loadStarRenderStyle`/`saveStarRenderStyle`
 * actually depend on - not a full `Storage` implementation (no `removeItem`/
 * `clear`/`length`/`key`), which is the point: the production functions
 * don't need more than this either. */
function makeFakeStorage(initial: Record<string, string> = {}): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

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
  it("defaults to MODEL, per issue #10's explicit acceptance criteria", () => {
    expect(DEFAULT_STAR_RENDER_STYLE).toBe("MODEL");
  });

  it("lists exactly MODEL and REALWORLD, nothing else, for this Story", () => {
    expect(STAR_RENDER_STYLES).toEqual(["MODEL", "REALWORLD"]);
  });
});

describe("loadStarRenderStyle", () => {
  it("returns the default when storage is null (e.g. localStorage access itself threw)", () => {
    expect(loadStarRenderStyle(null)).toBe(DEFAULT_STAR_RENDER_STYLE);
  });

  it("returns the default when the key was never set", () => {
    const storage = makeFakeStorage();
    expect(loadStarRenderStyle(storage)).toBe(DEFAULT_STAR_RENDER_STYLE);
  });

  it("returns the persisted REALWORLD choice when present", () => {
    const storage = makeFakeStorage({ [STAR_RENDER_STYLE_STORAGE_KEY]: "REALWORLD" });
    expect(loadStarRenderStyle(storage)).toBe("REALWORLD");
  });

  it("returns the persisted MODEL choice when present", () => {
    const storage = makeFakeStorage({ [STAR_RENDER_STYLE_STORAGE_KEY]: "MODEL" });
    expect(loadStarRenderStyle(storage)).toBe("MODEL");
  });

  it("degrades to the default (never throws) when getItem itself throws", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("simulated private-browsing failure");
      },
    };
    expect(loadStarRenderStyle(throwingStorage)).toBe(DEFAULT_STAR_RENDER_STYLE);
  });

  it("degrades to the default for a corrupt/unrecognized stored value", () => {
    const storage = makeFakeStorage({ [STAR_RENDER_STYLE_STORAGE_KEY]: "not-a-real-style" });
    expect(loadStarRenderStyle(storage)).toBe(DEFAULT_STAR_RENDER_STYLE);
  });
});

describe("saveStarRenderStyle", () => {
  it("does nothing (never throws) when storage is null", () => {
    expect(() => saveStarRenderStyle("REALWORLD", null)).not.toThrow();
  });

  it("writes the style under STAR_RENDER_STYLE_STORAGE_KEY", () => {
    const storage = makeFakeStorage();
    saveStarRenderStyle("REALWORLD", storage);
    expect(storage.data[STAR_RENDER_STYLE_STORAGE_KEY]).toBe("REALWORLD");
  });

  it("round-trips through loadStarRenderStyle", () => {
    const storage = makeFakeStorage();
    saveStarRenderStyle("REALWORLD", storage);
    expect(loadStarRenderStyle(storage)).toBe("REALWORLD");
    saveStarRenderStyle("MODEL", storage);
    expect(loadStarRenderStyle(storage)).toBe("MODEL");
  });

  it("never throws even when setItem itself throws (e.g. quota exceeded)", () => {
    const throwingStorage = {
      setItem: () => {
        throw new Error("simulated quota-exceeded failure");
      },
    };
    expect(() => saveStarRenderStyle("REALWORLD", throwingStorage)).not.toThrow();
  });
});
