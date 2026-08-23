import { describe, expect, it } from "vitest";
import { classifySpectralType, spectralColorFor, SpectralClass } from "../src/scene/spectralColor";

/**
 * Issue #173: the spectral-class parser/color lookup. SIMBAD `spectral_type`
 * strings are messy free text (confirmed against the real `scene.json`), so
 * coverage leans on real-world-shaped examples rather than only the clean
 * "G2V" case - white dwarfs, carbon stars, S-type, Wolf-Rayet, and brown
 * dwarfs should all fall back to `UNKNOWN`, not be misclassified into one of
 * the 7 OBAFGKM buckets just because they superficially resemble one.
 */

describe("classifySpectralType", () => {
  it.each([
    ["O5V", SpectralClass.O],
    ["B2IV", SpectralClass.B],
    ["A0V", SpectralClass.A],
    ["F8V", SpectralClass.F],
    ["G2V", SpectralClass.G],
    ["K5III", SpectralClass.K],
    ["M5.5Ve", SpectralClass.M],
  ])("classifies a clean %s spectral type as %s", (spectralType, expected) => {
    expect(classifySpectralType(spectralType)).toBe(expected);
  });

  it("is case-insensitive on the leading letter", () => {
    expect(classifySpectralType("g2v")).toBe(SpectralClass.G);
  });

  it("ignores leading/trailing whitespace", () => {
    expect(classifySpectralType("  K0III  ")).toBe(SpectralClass.K);
  });

  it("returns UNKNOWN for a null spectral_type", () => {
    expect(classifySpectralType(null)).toBe(SpectralClass.UNKNOWN);
  });

  it("returns UNKNOWN for an empty string", () => {
    expect(classifySpectralType("")).toBe(SpectralClass.UNKNOWN);
  });

  // Real non-OBAFGKM notations present in this catalog's actual scene.json -
  // these are correct UNKNOWN classifications, not bugs (see the module's
  // own docstring).
  it.each([
    ["DA3", "white dwarf"],
    ["C-N5", "carbon star"],
    ["S5,5", "S-type"],
    ["WN7", "Wolf-Rayet"],
    ["T6", "brown dwarf"],
    ["sdB", "subdwarf B (leading letter 's', not 'B')"],
  ])("returns UNKNOWN for %s (%s)", (spectralType) => {
    expect(classifySpectralType(spectralType)).toBe(SpectralClass.UNKNOWN);
  });

  it("returns UNKNOWN for a string with no leading letter", () => {
    expect(classifySpectralType("...")).toBe(SpectralClass.UNKNOWN);
  });
});

describe("spectralColorFor", () => {
  it("returns a distinct color for each of the 7 OBAFGKM classes plus unknown", () => {
    const inputs = ["O5V", "B2IV", "A0V", "F8V", "G2V", "K5III", "M5.5Ve", null];
    const colors = new Set(inputs.map((s) => spectralColorFor(s)));
    expect(colors.size).toBe(inputs.length);
  });

  it("colors follow the blue-to-red OBAFGKM sequence (O bluest, M reddest)", () => {
    // Blueness proxied as (blue channel - red channel); should strictly
    // decrease from O through M.
    const blueness = (hex: number) => (hex & 0xff) - ((hex >> 16) & 0xff);
    const sequence = ["O5V", "B2IV", "A0V", "F8V", "G2V", "K5III", "M5.5Ve"].map((s) =>
      blueness(spectralColorFor(s)),
    );
    for (let i = 1; i < sequence.length; i++) {
      expect(sequence[i]).toBeLessThan(sequence[i - 1]);
    }
  });

  it("gives the unknown color a light, near-neutral gray (close to the pre-#173 flat white)", () => {
    const hex = spectralColorFor(null);
    const r = (hex >> 16) & 0xff;
    const g = (hex >> 8) & 0xff;
    const b = hex & 0xff;
    // Near-neutral: channels within a small range of each other.
    expect(Math.max(r, g, b) - Math.min(r, g, b)).toBeLessThan(30);
    // Light, not dark.
    expect(Math.min(r, g, b)).toBeGreaterThan(150);
  });
});
