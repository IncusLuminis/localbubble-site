import { describe, expect, it } from "vitest";
import { gouldBeltEllipsePoints } from "../src/scene/structures";
import type { GouldBeltStructure } from "../src/scene/sceneTypes";

/**
 * Numerical sanity checks for the Gould Belt ellipse parametrization (spec
 * Idea.md §16), which must match
 * `notebooks/local_neighborhood.ipynb`'s `gould_belt_ellipse_points`
 * exactly (Story #65's brief): ellipse in its own plane -> rotate by
 * inclination about x -> rotate by orientation about z -> translate by
 * center.
 */

// The actual fitted values from `web/public/data/scene.json`'s
// `structures.gould_belt` (Perrot & Grenier 2003), used here as a
// realistic, non-trivial (non-zero inclination/orientation/offset-center)
// fixture rather than synthetic round numbers.
const GOULD_BELT: GouldBeltStructure = {
  model: "gould_belt",
  representation: "annulus",
  center: { x_pc: -104.0, y_pc: -0.73, z_pc: 0.0 },
  major_radius_pc: 373.0,
  minor_radius_pc: 233.0,
  inclination_deg: 17.2,
  orientation_deg: 296.1,
  thickness_pc: 60.0,
};

describe("gouldBeltEllipsePoints", () => {
  it("returns n points", () => {
    const points = gouldBeltEllipsePoints(GOULD_BELT, 50);
    expect(points).toHaveLength(50);
  });

  it("closes the loop: first and last sampled points coincide (t runs 0..2pi inclusive)", () => {
    const points = gouldBeltEllipsePoints(GOULD_BELT, 200);
    const first = points[0]!;
    const last = points[points.length - 1]!;
    expect(last[0]).toBeCloseTo(first[0], 6);
    expect(last[1]).toBeCloseTo(first[1], 6);
    expect(last[2]).toBeCloseTo(first[2], 6);
  });

  it("matches a hand-computed point at t=0 (x0=major_radius, y0=0)", () => {
    // At t=0: x0 = major_radius, y0 = 0 -> unaffected by the inclination
    // rotation (y0=0) -> only the orientation (z-axis) rotation applies.
    const orientRad = (GOULD_BELT.orientation_deg * Math.PI) / 180;
    const expectedX = GOULD_BELT.major_radius_pc * Math.cos(orientRad) + GOULD_BELT.center.x_pc;
    const expectedY = GOULD_BELT.major_radius_pc * Math.sin(orientRad) + GOULD_BELT.center.y_pc;
    const expectedZ = GOULD_BELT.center.z_pc;

    const points = gouldBeltEllipsePoints(GOULD_BELT, 200);
    const [x, y, z] = points[0]!;
    expect(x).toBeCloseTo(expectedX, 6);
    expect(y).toBeCloseTo(expectedY, 6);
    expect(z).toBeCloseTo(expectedZ, 6);
  });

  it("matches a hand-computed point at t=pi/2 (x0=0, y0=minor_radius)", () => {
    // At t=pi/2 (i = (n-1)/4 for n=201): x0=0, y0=minor_radius.
    const n = 201; // n-1=200 divisible by 4, so t hits exactly pi/2 at i=50.
    const points = gouldBeltEllipsePoints(GOULD_BELT, n);
    const quarterIndex = (n - 1) / 4;
    const inclRad = (GOULD_BELT.inclination_deg * Math.PI) / 180;
    const orientRad = (GOULD_BELT.orientation_deg * Math.PI) / 180;
    const y0 = GOULD_BELT.minor_radius_pc;
    const y1 = y0 * Math.cos(inclRad);
    const z1 = y0 * Math.sin(inclRad);
    const expectedX = -y1 * Math.sin(orientRad) + GOULD_BELT.center.x_pc;
    const expectedY = y1 * Math.cos(orientRad) + GOULD_BELT.center.y_pc;
    const expectedZ = z1 + GOULD_BELT.center.z_pc;

    const [x, y, z] = points[quarterIndex]!;
    expect(x).toBeCloseTo(expectedX, 6);
    expect(y).toBeCloseTo(expectedY, 6);
    expect(z).toBeCloseTo(expectedZ, 6);
  });

  it("is planar: every point lies on the single tilted plane through the center", () => {
    // Cross product of two non-parallel in-plane vectors (from the center
    // point) gives the plane normal; every other point-minus-center vector
    // must be perpendicular to it (dot product ~= 0), regardless of the
    // inclination/orientation rotations applied (both are rigid rotations,
    // which preserve planarity).
    const points = gouldBeltEllipsePoints(GOULD_BELT, 100);
    const center = GOULD_BELT.center;
    const relative = (p: [number, number, number]): [number, number, number] => [
      p[0] - center.x_pc,
      p[1] - center.y_pc,
      p[2] - center.z_pc,
    ];
    const a = relative(points[0]!);
    const b = relative(points[25]!);
    const normal: [number, number, number] = [
      a[1] * b[2] - a[2] * b[1],
      a[2] * b[0] - a[0] * b[2],
      a[0] * b[1] - a[1] * b[0],
    ];
    const normalLength = Math.hypot(...normal);

    for (const p of points) {
      const r = relative(p);
      const dot = r[0] * normal[0] + r[1] * normal[1] + r[2] * normal[2];
      // Normalize by both vector magnitudes so the tolerance is scale-free.
      const rLength = Math.hypot(...r) || 1;
      expect(Math.abs(dot) / (normalLength * rLength)).toBeLessThan(1e-9);
    }
  });
});
