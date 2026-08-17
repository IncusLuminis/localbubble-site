import { describe, expect, it } from "vitest";
import { cartesianToGalacticLB } from "../src/scene/galacticCoords";

/**
 * Round-trip sanity checks for the XYZ -> Galactic l/b inversion (spec
 * Idea.md §6, §24). Forward transform (matching astropy's Galactic frame,
 * used by `src/local_galactic_structures/coordinates.py`):
 *   x = d*cos(b)*cos(l), y = d*cos(b)*sin(l), z = d*sin(b)
 */

function forward(l_deg: number, b_deg: number, d: number): [number, number, number] {
  const l = (l_deg * Math.PI) / 180;
  const b = (b_deg * Math.PI) / 180;
  return [d * Math.cos(b) * Math.cos(l), d * Math.cos(b) * Math.sin(l), d * Math.sin(b)];
}

describe("cartesianToGalacticLB", () => {
  it("returns (0, 0) for the origin (the Sun) without NaN", () => {
    const { l_deg, b_deg } = cartesianToGalacticLB(0, 0, 0);
    expect(l_deg).toBe(0);
    expect(b_deg).toBe(0);
  });

  it("recovers l=0, b=0 for a point on the +X axis", () => {
    const { l_deg, b_deg } = cartesianToGalacticLB(100, 0, 0);
    expect(l_deg).toBeCloseTo(0, 6);
    expect(b_deg).toBeCloseTo(0, 6);
  });

  it("recovers l=90 for a point on the +Y axis", () => {
    const { l_deg, b_deg } = cartesianToGalacticLB(0, 100, 0);
    expect(l_deg).toBeCloseTo(90, 6);
    expect(b_deg).toBeCloseTo(0, 6);
  });

  it("recovers b=90 for a point on the +Z axis (North Galactic Pole)", () => {
    const { b_deg } = cartesianToGalacticLB(0, 0, 100);
    expect(b_deg).toBeCloseTo(90, 6);
  });

  it("normalizes negative longitudes into [0, 360)", () => {
    const { l_deg } = cartesianToGalacticLB(0, -100, 0);
    expect(l_deg).toBeCloseTo(270, 6);
    expect(l_deg).toBeGreaterThanOrEqual(0);
  });

  it("round-trips several arbitrary (l, b, distance) triples through the forward transform", () => {
    const cases: [number, number, number][] = [
      [45, 20, 150],
      [180.4, 0, 104], // Gould Belt center, per Perrot & Grenier 2003
      [216, 60, 60], // Local Bubble long-axis direction, per Alves et al. 2018
      [10, -30, 500],
      [359, 5, 800],
    ];
    for (const [l_deg, b_deg, d] of cases) {
      const [x, y, z] = forward(l_deg, b_deg, d);
      const recovered = cartesianToGalacticLB(x, y, z);
      expect(recovered.l_deg).toBeCloseTo(l_deg, 6);
      expect(recovered.b_deg).toBeCloseTo(b_deg, 6);
    }
  });

  it("matches the sign/quadrant of the real cepheus-flare catalog entry", () => {
    // From web/public/data/scene.json: position_pc [-157.14993444550686,
    // 308.94684209096664, 61.31677475040692], distance_pc 352.0. Since
    // atan2(y,x) with x<0, y>0 lands in the second quadrant, l should be
    // between 90 and 180 degrees; z>0 (small relative to distance) means a
    // modest positive b.
    const { l_deg, b_deg } = cartesianToGalacticLB(
      -157.14993444550686,
      308.94684209096664,
      61.31677475040692,
    );
    expect(l_deg).toBeGreaterThan(90);
    expect(l_deg).toBeLessThan(180);
    expect(b_deg).toBeGreaterThan(0);
  });
});
