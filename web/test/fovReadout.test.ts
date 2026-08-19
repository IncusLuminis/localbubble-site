import { describe, expect, it } from "vitest";
import { formatExtentPc } from "../src/ui/fovReadout";

/**
 * Coverage for the FOV readout's adaptive pc/kpc formatting (issue #125's
 * "avoid absurd strings like `0.00003847 pc` or `1087234.88 pc`"
 * acceptance criterion) across the app's full dynamic range - from
 * ~0.02pc (star marker floor, issue #119) up to 1000pc+ overviews.
 */

describe("formatExtentPc", () => {
  it("shows extra precision for sub-pc values (solar-neighborhood scale)", () => {
    expect(formatExtentPc(0.024)).toBe("0.024 pc");
  });

  it("shows 2 decimals for single-digit pc values", () => {
    expect(formatExtentPc(4.2345)).toBe("4.23 pc");
  });

  it("shows 1 decimal for double-digit pc values", () => {
    expect(formatExtentPc(42.345)).toBe("42.3 pc");
  });

  it("shows integer pc for triple-digit values", () => {
    expect(formatExtentPc(823.6)).toBe("824 pc");
  });

  it("switches to kpc at 1000pc and above, avoiding an absurd long decimal", () => {
    expect(formatExtentPc(1087234.88)).toBe("1087.23 kpc");
    expect(formatExtentPc(1000)).toBe("1.00 kpc");
  });

  it("never produces an over-long decimal string for a tiny value", () => {
    expect(formatExtentPc(0.00003847)).toBe("0.000 pc");
  });

  it("falls back to a placeholder for non-finite input", () => {
    expect(formatExtentPc(Number.NaN)).toBe("-");
    expect(formatExtentPc(Number.POSITIVE_INFINITY)).toBe("-");
  });
});
