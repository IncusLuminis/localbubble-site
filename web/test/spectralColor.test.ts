import { describe, expect, it } from "vitest";
import { classifySpectralType, spectralColorFor, SpectralClass } from "../src/scene/spectralColor";

/**
 * Issue #173: the spectral-class parser/color lookup. SIMBAD `spectral_type`
 * strings are messy free text (confirmed against the real `scene.json`), so
 * coverage leans on real-world-shaped examples rather than only the clean
 * "G2V" case - white dwarfs, carbon stars, S-type, Wolf-Rayet, and brown
 * dwarfs should all fall back to `UNKNOWN`, not be misclassified into one of
 * the 7 OBAFGKM buckets just because they superficially resemble one.
 *
 * Issue #177 follow-up (Validator review of #173): lowercase dwarf/subdwarf
 * prefixes ("d", "sd", "esd") must be stripped before matching so real M
 * dwarfs like Wolf 359 ("dM6") resolve to their actual class instead of
 * unknown, and composite/peculiar notations like nu Herculis's
 * "kA9hF2mF2(IV)" must stay UNKNOWN rather than being reinterpreted as class
 * K by accident of case-insensitive matching on the leading letter.
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
  ])("returns UNKNOWN for %s (%s)", (spectralType) => {
    expect(classifySpectralType(spectralType)).toBe(SpectralClass.UNKNOWN);
  });

  it("returns UNKNOWN for a string with no leading letter", () => {
    expect(classifySpectralType("...")).toBe(SpectralClass.UNKNOWN);
  });

  // Issue #177: real dwarf-prefixed M dwarfs in this catalog's actual
  // scene.json (Wolf 359, Ross 128, Teegarden's Star, AD Leo, BR Psc) must
  // strip the lowercase "d" prefix and resolve to their real M class, not
  // fall to UNKNOWN just because "d" isn't itself an OBAFGKM letter.
  it.each([
    ["dM6", "Wolf 359 / Teegarden's Star"],
    ["dM4", "Ross 128"],
    ["dM3", "AD Leo"],
    ["dM1", "BR Psc"],
  ])("strips the dwarf prefix and classifies %s (%s) as M", (spectralType) => {
    expect(classifySpectralType(spectralType)).toBe(SpectralClass.M);
  });

  // Issue #177: "sd"/"esd" (subdwarf / extreme subdwarf) are the same
  // lowercase MK luminosity-class prefix convention as "d" and must be
  // stripped the same way, even though no current catalog value uses them.
  it("strips the sd (subdwarf) prefix and classifies sdB as B", () => {
    expect(classifySpectralType("sdB")).toBe(SpectralClass.B);
  });

  it("strips the esd (extreme subdwarf) prefix and classifies esdG as G", () => {
    expect(classifySpectralType("esdG")).toBe(SpectralClass.G);
  });

  // An uppercase leading "D" is the unrelated white-dwarf spectral class,
  // not the lowercase dwarf-notation prefix - it must not be stripped and
  // must not be misread as a dwarf-prefixed "A"-class star.
  it("does not strip an uppercase D (white-dwarf class) as if it were the dwarf prefix", () => {
    expect(classifySpectralType("DA3")).toBe(SpectralClass.UNKNOWN);
  });

  // Issue #177 regression: nu Herculis's real SIMBAD spectral_type is this
  // composite Am-type peculiar notation - unrelated to spectral class K -
  // and must not be reassigned to K (or any other real class) as a
  // side effect of case-insensitive leading-letter matching or of the new
  // dwarf-prefix-stripping logic.
  it("returns UNKNOWN for nu Herculis's composite peculiar notation kA9hF2mF2(IV), not class K", () => {
    expect(classifySpectralType("kA9hF2mF2(IV)")).toBe(SpectralClass.UNKNOWN);
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
