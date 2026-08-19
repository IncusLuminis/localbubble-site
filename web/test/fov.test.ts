import { describe, expect, it } from "vitest";
import { fovExtentPc } from "../src/scene/fov";

/**
 * Pure-function coverage for the field-of-view extent readout's formula
 * (issue #125): `verticalPc = 2 * distance * tan(fov/2)`,
 * `horizontalPc = verticalPc * aspect`. No `PerspectiveCamera`/DOM
 * dependency - checked against hand-computed expected values.
 */

describe("fovExtentPc", () => {
  it("computes the extent for a 90deg fov (tan(45deg) = 1, easy to hand-check)", () => {
    // verticalPc = 2 * 10 * tan(45deg) = 2 * 10 * 1 = 20
    // horizontalPc = 20 * 1.5 = 30
    const { horizontalPc, verticalPc } = fovExtentPc(90, 1.5, 10);
    expect(verticalPc).toBeCloseTo(20, 10);
    expect(horizontalPc).toBeCloseTo(30, 10);
  });

  it("matches the app's actual default camera fov (50deg) at a representative distance", () => {
    // verticalPc = 2 * 1000 * tan(25deg) = 2 * 1000 * 0.46630765815... = 932.6153...
    const { horizontalPc, verticalPc } = fovExtentPc(50, 16 / 9, 1000);
    expect(verticalPc).toBeCloseTo(932.6153207087978, 3);
    expect(horizontalPc).toBeCloseTo(verticalPc * (16 / 9), 8);
  });

  it("scales linearly with distance for a fixed fov/aspect", () => {
    const near = fovExtentPc(50, 1.777, 10);
    const far = fovExtentPc(50, 1.777, 100);
    expect(far.verticalPc).toBeCloseTo(near.verticalPc * 10, 8);
    expect(far.horizontalPc).toBeCloseTo(near.horizontalPc * 10, 8);
  });

  it("handles a very close-up distance (solar-neighborhood scale, issue #119) without producing absurd/negative values", () => {
    const { horizontalPc, verticalPc } = fovExtentPc(50, 1, 0.02);
    expect(verticalPc).toBeGreaterThan(0);
    expect(verticalPc).toBeCloseTo(2 * 0.02 * Math.tan((50 * Math.PI) / 180 / 2), 12);
    expect(horizontalPc).toBeCloseTo(verticalPc, 12); // aspect 1 -> square
  });

  it("handles a wide overview distance (800pc+ per the spec's dynamic range)", () => {
    const { horizontalPc, verticalPc } = fovExtentPc(50, 1.6, 2000);
    // verticalPc = 2 * 2000 * tan(25deg) = 1865.2306414175957
    expect(verticalPc).toBeCloseTo(1865.2306414175957, 3);
    expect(horizontalPc).toBeCloseTo(verticalPc * 1.6, 6);
  });

  it("returns zero extent at zero distance", () => {
    const { horizontalPc, verticalPc } = fovExtentPc(50, 1.5, 0);
    expect(verticalPc).toBe(0);
    expect(horizontalPc).toBe(0);
  });
});
