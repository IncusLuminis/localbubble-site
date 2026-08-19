import { describe, expect, it } from "vitest";
import { Mesh, Quaternion } from "three";
import {
  createLocalBubbleLayer,
  gouldBeltEllipsePoints,
  localBubbleLongAxisDirection,
  localBubbleOrientationMatrix,
} from "../src/scene/structures";
import { cartesianToGalacticLB } from "../src/scene/galacticCoords";
import type { GouldBeltStructure, LocalBubbleStructure } from "../src/scene/sceneTypes";

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

/**
 * Story #102 (issue #102): the Local Bubble ellipsoid must now be rotated
 * per the Alves et al. (2018) fitted Euler angles, and that rotation must
 * be verified against the paper's own INDEPENDENTLY-stated long-axis
 * pointing direction (l, b) = (216 deg, 60 deg) - the acceptance
 * criterion's "ground truth" - rather than trusted by construction.
 *
 * These are the actual fitted values from `models/local_bubble.yaml` /
 * `web/public/data/scene.json`'s `structures.local_bubble.orientation`.
 */
const LOCAL_BUBBLE_ORIENTATION = {
  theta_ell_deg: 30.0,
  psi_ell_deg: 216.0,
  phi_ell_deg: 0.0,
  long_axis_l_deg: 216.0,
  long_axis_b_deg: 60.0,
};

const LOCAL_BUBBLE: LocalBubbleStructure = {
  representation: "ellipsoid",
  enabled: true,
  center_pc: { x_pc: 10.2, y_pc: 33.6, z_pc: 0.0 },
  semi_axes_pc: { a_pc: 60.0, b_pc: 60.0, c_pc: 162.0 },
  orientation: LOCAL_BUBBLE_ORIENTATION,
};

describe("localBubbleLongAxisDirection", () => {
  it("matches the paper's independently-stated long-axis ground truth (l, b) = (216 deg, 60 deg)", () => {
    const [x, y, z] = localBubbleLongAxisDirection(LOCAL_BUBBLE_ORIENTATION);
    const { l_deg, b_deg } = cartesianToGalacticLB(x, y, z);
    expect(l_deg).toBeCloseTo(LOCAL_BUBBLE_ORIENTATION.long_axis_l_deg, 6);
    expect(b_deg).toBeCloseTo(LOCAL_BUBBLE_ORIENTATION.long_axis_b_deg, 6);
  });

  it("returns a unit vector", () => {
    const [x, y, z] = localBubbleLongAxisDirection(LOCAL_BUBBLE_ORIENTATION);
    expect(Math.hypot(x, y, z)).toBeCloseTo(1, 10);
  });

  it("is insensitive to phi_ell (intrinsic spin) for this axisymmetric spheroid", () => {
    // phi_ell rotates about the already-pointed symmetry (Z) axis, so it
    // must not move where that axis itself points, for any phi.
    const withZeroPhi = localBubbleLongAxisDirection({ ...LOCAL_BUBBLE_ORIENTATION, phi_ell_deg: 0 });
    const withOtherPhi = localBubbleLongAxisDirection({
      ...LOCAL_BUBBLE_ORIENTATION,
      phi_ell_deg: 137,
    });
    expect(withOtherPhi[0]).toBeCloseTo(withZeroPhi[0], 10);
    expect(withOtherPhi[1]).toBeCloseTo(withZeroPhi[1], 10);
    expect(withOtherPhi[2]).toBeCloseTo(withZeroPhi[2], 10);
  });

  it("degenerates to the un-rotated +Z axis when all Euler angles are 0", () => {
    const [x, y, z] = localBubbleLongAxisDirection({
      theta_ell_deg: 0,
      psi_ell_deg: 0,
      phi_ell_deg: 0,
    });
    expect(x).toBeCloseTo(0, 10);
    expect(y).toBeCloseTo(0, 10);
    expect(z).toBeCloseTo(1, 10);
  });
});

describe("localBubbleOrientationMatrix", () => {
  it("is a pure rotation: orthogonal with determinant +1", () => {
    const m = localBubbleOrientationMatrix(LOCAL_BUBBLE_ORIENTATION).elements;
    // three.js Matrix4.elements is column-major; extract the 3x3 block.
    const r = [
      [m[0]!, m[4]!, m[8]!],
      [m[1]!, m[5]!, m[9]!],
      [m[2]!, m[6]!, m[10]!],
    ];
    const det =
      r[0]![0]! * (r[1]![1]! * r[2]![2]! - r[1]![2]! * r[2]![1]!) -
      r[0]![1]! * (r[1]![0]! * r[2]![2]! - r[1]![2]! * r[2]![0]!) +
      r[0]![2]! * (r[1]![0]! * r[2]![1]! - r[1]![1]! * r[2]![0]!);
    expect(det).toBeCloseTo(1, 10);

    for (let i = 0; i < 3; i++) {
      for (let j = 0; j < 3; j++) {
        let dot = 0;
        for (let k = 0; k < 3; k++) {
          dot += r[i]![k]! * r[j]![k]!;
        }
        expect(dot).toBeCloseTo(i === j ? 1 : 0, 10);
      }
    }
  });
});

describe("createLocalBubbleLayer orientation", () => {
  it("applies the fitted rotation to the mesh's quaternion", () => {
    const group = createLocalBubbleLayer(LOCAL_BUBBLE);
    expect(group).not.toBeNull();
    const mesh = group!.children[0] as Mesh;
    const expected = new Quaternion().setFromRotationMatrix(
      localBubbleOrientationMatrix(LOCAL_BUBBLE_ORIENTATION),
    );
    expect(mesh.quaternion.x).toBeCloseTo(expected.x, 10);
    expect(mesh.quaternion.y).toBeCloseTo(expected.y, 10);
    expect(mesh.quaternion.z).toBeCloseTo(expected.z, 10);
    expect(mesh.quaternion.w).toBeCloseTo(expected.w, 10);
  });

  it("still scales and positions the mesh correctly alongside the rotation", () => {
    const group = createLocalBubbleLayer(LOCAL_BUBBLE);
    const mesh = group!.children[0] as Mesh;
    expect(mesh.scale.x).toBeCloseTo(60.0, 10);
    expect(mesh.scale.y).toBeCloseTo(60.0, 10);
    expect(mesh.scale.z).toBeCloseTo(162.0, 10);
    expect(mesh.position.x).toBeCloseTo(10.2, 10);
    expect(mesh.position.y).toBeCloseTo(33.6, 10);
    expect(mesh.position.z).toBeCloseTo(0.0, 10);
  });

  it("falls back to an axis-aligned (identity-rotation) ellipsoid when orientation is absent", () => {
    const { orientation, ...withoutOrientation } = LOCAL_BUBBLE;
    const group = createLocalBubbleLayer(withoutOrientation as LocalBubbleStructure);
    const mesh = group!.children[0] as Mesh;
    expect(mesh.quaternion.x).toBe(0);
    expect(mesh.quaternion.y).toBe(0);
    expect(mesh.quaternion.z).toBe(0);
    expect(mesh.quaternion.w).toBe(1);
  });

  it("falls back to identity rotation when orientation has non-finite fields (malformed data, spec §38)", () => {
    const group = createLocalBubbleLayer({
      ...LOCAL_BUBBLE,
      orientation: { theta_ell_deg: Number.NaN, psi_ell_deg: 216, phi_ell_deg: 0 },
    });
    const mesh = group!.children[0] as Mesh;
    expect(mesh.quaternion.x).toBe(0);
    expect(mesh.quaternion.y).toBe(0);
    expect(mesh.quaternion.z).toBe(0);
    expect(mesh.quaternion.w).toBe(1);
  });
});
