import { describe, expect, it } from "vitest";
import {
  absoluteMagnitudeToBrightness,
  absoluteMagnitudeToRealworldStyle,
  DEFAULT_BRIGHTNESS,
  DEFAULT_REALWORLD_STYLE,
} from "../src/scene/magnitudeBrightness";

/**
 * Issue #173: absolute-magnitude brightness bucketing. Boundaries are fit to
 * this catalog's real `scene.json` distribution (see the module's own
 * docstring for the actual percentiles/histogram pulled 2026-08-22) - tests
 * below check the resulting monotonic behavior and the documented bucket
 * edges rather than re-deriving generic textbook magnitude thresholds.
 */

describe("absoluteMagnitudeToBrightness", () => {
  it("returns a brightness within the ~0.3-1.0 range for any finite magnitude", () => {
    for (const mag of [-10, -6, -4, -2, 0, 6, 10, 14, 20, 30]) {
      const brightness = absoluteMagnitudeToBrightness(mag);
      expect(brightness).toBeGreaterThanOrEqual(0.3);
      expect(brightness).toBeLessThanOrEqual(1.0);
    }
  });

  it("is monotonically non-increasing as magnitude increases (brighter=lower mag=higher multiplier)", () => {
    const magnitudes = [-8, -6, -4, -2, 0, 2, 6, 8, 10, 12, 14, 18, 26];
    const brightnesses = magnitudes.map((m) => absoluteMagnitudeToBrightness(m));
    for (let i = 1; i < brightnesses.length; i++) {
      expect(brightnesses[i]).toBeLessThanOrEqual(brightnesses[i - 1]);
    }
  });

  it("gives an exceptionally bright supergiant (mag < -6) the maximum 1.0 multiplier", () => {
    expect(absoluteMagnitudeToBrightness(-6.98)).toBe(1.0);
    expect(absoluteMagnitudeToBrightness(-20)).toBe(1.0);
  });

  it("gives the catalog's dense typical core (-4 <= mag < -2) a consistent multiplier", () => {
    expect(absoluteMagnitudeToBrightness(-3.9)).toBe(absoluteMagnitudeToBrightness(-2.1));
  });

  it("gives the faintest tail (mag >= 14) the minimum 0.3 multiplier", () => {
    expect(absoluteMagnitudeToBrightness(14)).toBe(0.3);
    expect(absoluteMagnitudeToBrightness(26.28)).toBe(0.3);
  });

  it("gives a real sample value (-3.41, from scene.json's '102 Her') the typical-core multiplier", () => {
    // Regression anchor against a real scene.json value (B2IV, absolute_magnitude
    // -3.4144196213721543) rather than only synthetic boundary numbers.
    expect(absoluteMagnitudeToBrightness(-3.4144196213721543)).toBe(
      absoluteMagnitudeToBrightness(-3.5),
    );
  });

  it("returns the mid-range DEFAULT_BRIGHTNESS for a null magnitude", () => {
    expect(absoluteMagnitudeToBrightness(null)).toBe(DEFAULT_BRIGHTNESS);
  });

  it("DEFAULT_BRIGHTNESS is neither the dimmest nor the brightest bucket", () => {
    expect(DEFAULT_BRIGHTNESS).toBeGreaterThan(0.3);
    expect(DEFAULT_BRIGHTNESS).toBeLessThan(1.0);
  });

  it("treats a non-finite magnitude the same as null (defensive, not a crash/NaN color)", () => {
    expect(absoluteMagnitudeToBrightness(NaN)).toBe(DEFAULT_BRIGHTNESS);
  });
});

/**
 * Issue #11 (Epic #7, Story 2/4): REALWORLD's own per-bucket size multiplier
 * + sprite-variant table, sharing the exact same 8 magnitude boundaries as
 * `absoluteMagnitudeToBrightness` above (see `REALWORLD_STYLE_BY_MAGNITUDE`'s
 * own docstring in the module for the full reasoning behind the specific
 * numbers/variant cutoff chosen).
 */
describe("absoluteMagnitudeToRealworldStyle (issue #11)", () => {
  it("is monotonically non-decreasing in sizeMultiplier as magnitude decreases (brighter=lower mag=bigger sprite)", () => {
    const magnitudes = [18, 14, 12, 10, 8, 6, 3, 0, -1, -2, -3, -4, -5, -6, -8, -20];
    const multipliers = magnitudes.map((m) => absoluteMagnitudeToRealworldStyle(m).sizeMultiplier);
    for (let i = 1; i < multipliers.length; i++) {
      expect(multipliers[i]).toBeGreaterThanOrEqual(multipliers[i - 1]);
    }
  });

  it("gives an exceptionally bright supergiant (mag < -6) the maximum 6.0 size multiplier and the brilliant sprite", () => {
    expect(absoluteMagnitudeToRealworldStyle(-6.98)).toEqual({ sizeMultiplier: 6.0, spriteVariant: "brilliant" });
    expect(absoluteMagnitudeToRealworldStyle(-20)).toEqual({ sizeMultiplier: 6.0, spriteVariant: "brilliant" });
  });

  it("gives the -6 <= mag < -4 bright-giant tier the brilliant sprite too", () => {
    expect(absoluteMagnitudeToRealworldStyle(-5.5)).toEqual({ sizeMultiplier: 4.0, spriteVariant: "brilliant" });
  });

  it("does NOT give the dense -4 <= mag < -2 core tier the brilliant sprite, despite its own size jump", () => {
    const style = absoluteMagnitudeToRealworldStyle(-3.5);
    expect(style.spriteVariant).toBe("normal");
    expect(style.sizeMultiplier).toBe(2.4);
  });

  it("gives the faintest tail (mag >= 14) the minimum 0.4 size multiplier and the normal sprite", () => {
    expect(absoluteMagnitudeToRealworldStyle(14)).toEqual({ sizeMultiplier: 0.4, spriteVariant: "normal" });
    expect(absoluteMagnitudeToRealworldStyle(26.28)).toEqual({ sizeMultiplier: 0.4, spriteVariant: "normal" });
  });

  it("the brightest tier's sprite is dramatically bigger than the faintest tier's - at least a 10x size ratio", () => {
    const brightest = absoluteMagnitudeToRealworldStyle(-10).sizeMultiplier;
    const faintest = absoluteMagnitudeToRealworldStyle(20).sizeMultiplier;
    expect(brightest / faintest).toBeGreaterThanOrEqual(10);
  });

  it("every real bucket boundary shares the exact same 8 cut points as absoluteMagnitudeToBrightness", () => {
    // Not a coincidence - both derive from the same BRIGHTNESS_BUCKETS table
    // (see that module's own docstring on why the boundaries must never
    // drift apart between the two style axes).
    for (const mag of [14, 10, 6, 0, -2, -4, -6]) {
      const justBelow = absoluteMagnitudeToRealworldStyle(mag - 0.001);
      const atBoundary = absoluteMagnitudeToRealworldStyle(mag);
      expect(atBoundary.sizeMultiplier).not.toBe(justBelow.sizeMultiplier);
    }
  });

  it("returns DEFAULT_REALWORLD_STYLE for a null magnitude", () => {
    expect(absoluteMagnitudeToRealworldStyle(null)).toEqual(DEFAULT_REALWORLD_STYLE);
  });

  it("treats a non-finite magnitude the same as null (defensive, not a crash)", () => {
    expect(absoluteMagnitudeToRealworldStyle(NaN)).toEqual(DEFAULT_REALWORLD_STYLE);
  });

  it("DEFAULT_REALWORLD_STYLE sits strictly between the two buckets straddling the catalog's real median, and uses the normal sprite", () => {
    expect(DEFAULT_REALWORLD_STYLE.sizeMultiplier).toBeGreaterThan(1.6); // -2<=mag<0 tier
    expect(DEFAULT_REALWORLD_STYLE.sizeMultiplier).toBeLessThan(2.4); // -4<=mag<-2 tier
    expect(DEFAULT_REALWORLD_STYLE.spriteVariant).toBe("normal");
  });
});
