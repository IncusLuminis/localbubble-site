import { describe, expect, it } from "vitest";
import {
  absoluteMagnitudeToBrightness,
  DEFAULT_BRIGHTNESS,
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
