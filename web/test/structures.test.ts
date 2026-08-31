import { describe, expect, it } from "vitest";
import { Mesh, Object3D, Quaternion, TubeGeometry } from "three";
import {
  createGouldBeltLayer,
  createLocalBubbleLayer,
  createRadcliffeWaveLayer,
  gouldBeltEllipsePoints,
  gouldBeltLabelPosition,
  localBubbleLongAxisDirection,
  localBubbleOrientationMatrix,
  radcliffeWaveLabelPosition,
  setGouldBeltDimmed,
  setLocalBubbleDimmed,
  setRadcliffeWaveDimmed,
} from "../src/scene/structures";
import { cartesianToGalacticLB } from "../src/scene/galacticCoords";
import type {
  GouldBeltStructure,
  LocalBubbleStructure,
  RadcliffeWaveStructure,
} from "../src/scene/sceneTypes";

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

/**
 * Issue #124: the Gould Belt / Radcliffe Wave overlays moved from a
 * hairline `THREE.Line` to a translucent `THREE.TubeGeometry` band (plus an
 * optional, unobtrusive `CSS2DObject` label `main.ts` builds and parents
 * under the same group - see `structures.ts`'s `structureLabel` docstring
 * for why label construction is a separate, DOM-touching call rather than
 * baked into `createGouldBeltLayer`/`createRadcliffeWaveLayer` themselves:
 * this repo's `vitest.config.ts` runs with `environment: "node"`, so
 * `document.createElement` isn't available here, mirroring why
 * `scene/labels.ts`'s `createSunLabel` isn't unit-tested for its own DOM
 * call either. These tests cover the new tube-geometry construction (fully
 * DOM-free) and the pure label-position math - the acceptance criteria this
 * issue actually added ("visibly thicker band", "translucent... not
 * visually dominant").
 */
describe("createGouldBeltLayer tube geometry", () => {
  it("renders a translucent TubeGeometry mesh (not a hairline Line)", () => {
    const group = createGouldBeltLayer(GOULD_BELT);
    expect(group).not.toBeNull();
    expect(group!.children).toHaveLength(1); // tube only - no DOM/label
    const mesh = group!.children[0] as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.geometry).toBeInstanceOf(TubeGeometry);

    const material = mesh.material as import("three").MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    // Visible but subordinate (issue #124: "not visually dominant over
    // catalog object markers or the Local Bubble ellipsoid") - strictly
    // between fully transparent and fully opaque, matching issue #115's
    // extended-structure opacity tier (0.35) used elsewhere in this app.
    expect(material.opacity).toBeGreaterThan(0);
    expect(material.opacity).toBeLessThan(1);
    expect(material.opacity).toBeCloseTo(0.35, 10);
    // Matches `createLocalBubbleLayer`'s own translucent-mesh convention -
    // a depth-writing translucent mesh would incorrectly occlude whatever's
    // behind it along the band instead of blending with it.
    expect(material.depthWrite).toBe(false);
  });

  it("builds a closed tube (the ellipse loops back on itself)", () => {
    const group = createGouldBeltLayer(GOULD_BELT);
    const mesh = group!.children[0] as Mesh;
    const geometry = mesh.geometry as TubeGeometry;
    expect(geometry.parameters.closed).toBe(true);
  });

  it("uses a small radius relative to the ellipse's own extent (a band, not a pipe)", () => {
    const group = createGouldBeltLayer(GOULD_BELT);
    const mesh = group!.children[0] as Mesh;
    const geometry = mesh.geometry as TubeGeometry;
    expect(geometry.parameters.radius).toBeGreaterThan(0);
    // Well under the ellipse's own major radius (373pc) - a visibly
    // thicker band than a hairline, but nowhere near overpowering the
    // structure itself.
    expect(geometry.parameters.radius).toBeLessThan(GOULD_BELT.major_radius_pc / 10);
  });

  it("does not duplicate the closing point as an extra near-zero-length curve segment", () => {
    // `gouldBeltEllipsePoints`'s first and last points coincide by
    // construction; the tube's underlying curve should be built from the
    // de-duplicated point set (n-1 points), not the raw n-point array,
    // since `closed: true` already wraps the curve back to its start.
    const rawPoints = gouldBeltEllipsePoints(GOULD_BELT);
    const group = createGouldBeltLayer(GOULD_BELT);
    const mesh = group!.children[0] as Mesh;
    const geometry = mesh.geometry as TubeGeometry;
    const curve = geometry.parameters.path as import("three").CatmullRomCurve3;
    expect(curve.points.length).toBe(rawPoints.length - 1);
  });
});

describe("gouldBeltLabelPosition", () => {
  it("returns the ellipse's apex (t=0, i.e. points[0] of gouldBeltEllipsePoints)", () => {
    const points = gouldBeltEllipsePoints(GOULD_BELT);
    const position = gouldBeltLabelPosition(GOULD_BELT);
    expect(position[0]).toBeCloseTo(points[0]![0], 10);
    expect(position[1]).toBeCloseTo(points[0]![1], 10);
    expect(position[2]).toBeCloseTo(points[0]![2], 10);
  });
});

const RADCLIFFE_WAVE: RadcliffeWaveStructure = {
  model: "radcliffe_wave",
  representation: "spline",
  points: [
    { s_pc: 0, x_pc: -900, y_pc: -900, z_pc: 0 },
    { s_pc: 500, x_pc: -600, y_pc: -400, z_pc: 50 },
    { s_pc: 1000, x_pc: -300, y_pc: 0, z_pc: 100 },
    { s_pc: 1500, x_pc: 0, y_pc: 400, z_pc: 50 },
    { s_pc: 2000, x_pc: 300, y_pc: 900, z_pc: 0 },
    { s_pc: 2500, x_pc: 600, y_pc: 1300, z_pc: -50 },
  ],
};

describe("createRadcliffeWaveLayer tube geometry", () => {
  it("renders a translucent TubeGeometry mesh (not a hairline Line)", () => {
    const group = createRadcliffeWaveLayer(RADCLIFFE_WAVE);
    expect(group).not.toBeNull();
    expect(group!.children).toHaveLength(1); // tube only - no DOM/label
    const mesh = group!.children[0] as Mesh;
    expect(mesh).toBeInstanceOf(Mesh);
    expect(mesh.geometry).toBeInstanceOf(TubeGeometry);

    const material = mesh.material as import("three").MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBeCloseTo(0.35, 10);
    expect(material.depthWrite).toBe(false);
  });

  it("builds an open (non-looping) tube - the spine's endpoints are genuinely distinct", () => {
    const group = createRadcliffeWaveLayer(RADCLIFFE_WAVE);
    const mesh = group!.children[0] as Mesh;
    const geometry = mesh.geometry as TubeGeometry;
    expect(geometry.parameters.closed).toBe(false);
  });

  it("caps tubularSegments well below the raw point count for large point arrays", () => {
    const denselySampled: RadcliffeWaveStructure = {
      model: "radcliffe_wave",
      representation: "spline",
      points: Array.from({ length: 1500 }, (_, i) => ({
        s_pc: i,
        x_pc: -900 + i,
        y_pc: -900 + i * 1.5,
        z_pc: Math.sin(i / 100) * 50,
      })),
    };
    const group = createRadcliffeWaveLayer(denselySampled);
    const mesh = group!.children[0] as Mesh;
    const geometry = mesh.geometry as TubeGeometry;
    expect(geometry.parameters.tubularSegments).toBeLessThan(500);
    expect(geometry.parameters.tubularSegments).toBeGreaterThan(1);
  });

  it("still returns null for missing/too-short point data (spec §38 - unchanged from the pre-#124 behavior)", () => {
    expect(createRadcliffeWaveLayer(undefined)).toBeNull();
    expect(
      createRadcliffeWaveLayer({ ...RADCLIFFE_WAVE, points: [RADCLIFFE_WAVE.points[0]!] }),
    ).toBeNull();
  });
});

describe("radcliffeWaveLabelPosition", () => {
  it("returns the spine's midpoint by point-array index", () => {
    const position = radcliffeWaveLabelPosition(RADCLIFFE_WAVE);
    const midpoint = RADCLIFFE_WAVE.points[Math.floor((RADCLIFFE_WAVE.points.length - 1) / 2)]!;
    expect(position[0]).toBeCloseTo(midpoint.x_pc, 10);
    expect(position[1]).toBeCloseTo(midpoint.y_pc, 10);
    expect(position[2]).toBeCloseTo(midpoint.z_pc, 10);
  });
});

/**
 * Issue #137: dims/restores these three structure-layer overlays (Gould
 * Belt, Radcliffe Wave, Local Bubble) once the camera is inside the RECONS
 * dense batch's collection sphere, as part of the "spotlight the nearby
 * stars by dimming the background" effect (`objects.ts`'s
 * `updateBackgroundDimming` covers the catalog-bucket half of this same
 * effect). Each `set*Dimmed` mutates the layer's own (not-cached,
 * freshly-constructed-per-call) material's `.opacity` in place - safe here
 * specifically because `createGouldBeltLayer`/`createRadcliffeWaveLayer`/
 * `createLocalBubbleLayer` never share a material instance across separate
 * calls (unlike `objects.ts`'s `materialFor` cache).
 */
describe("setGouldBeltDimmed / setRadcliffeWaveDimmed / setLocalBubbleDimmed (issue #137)", () => {
  it("dims the Gould Belt tube's opacity, then restores it exactly", () => {
    const group = createGouldBeltLayer(GOULD_BELT);
    const material = (group!.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const originalOpacity = material.opacity;

    setGouldBeltDimmed(group, true);
    expect(material.opacity).toBeLessThan(originalOpacity);
    expect(material.opacity).toBeGreaterThan(0);

    setGouldBeltDimmed(group, false);
    expect(material.opacity).toBe(originalOpacity);
  });

  it("dims the Radcliffe Wave tube's opacity, then restores it exactly", () => {
    const group = createRadcliffeWaveLayer(RADCLIFFE_WAVE);
    const material = (group!.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const originalOpacity = material.opacity;

    setRadcliffeWaveDimmed(group, true);
    expect(material.opacity).toBeLessThan(originalOpacity);
    expect(material.opacity).toBeGreaterThan(0);

    setRadcliffeWaveDimmed(group, false);
    expect(material.opacity).toBe(originalOpacity);
  });

  it("dims the Local Bubble ellipsoid's opacity, then restores it exactly", () => {
    const group = createLocalBubbleLayer(LOCAL_BUBBLE);
    const material = (group!.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const originalOpacity = material.opacity;

    setLocalBubbleDimmed(group, true);
    expect(material.opacity).toBeLessThan(originalOpacity);
    expect(material.opacity).toBeGreaterThan(0);

    setLocalBubbleDimmed(group, false);
    expect(material.opacity).toBe(originalOpacity);
  });

  it("dims to roughly 15% of normal opacity (issue #156: strengthened from #137's original 40%)", () => {
    const gouldGroup = createGouldBeltLayer(GOULD_BELT);
    const gouldMaterial = (gouldGroup!.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const gouldOriginal = gouldMaterial.opacity;
    setGouldBeltDimmed(gouldGroup, true);
    expect(gouldMaterial.opacity / gouldOriginal).toBeCloseTo(0.15, 5);
    expect(gouldMaterial.opacity / gouldOriginal).toBeLessThan(0.2);

    const bubbleGroup = createLocalBubbleLayer(LOCAL_BUBBLE);
    const bubbleMaterial = (bubbleGroup!.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const bubbleOriginal = bubbleMaterial.opacity;
    setLocalBubbleDimmed(bubbleGroup, true);
    expect(bubbleMaterial.opacity / bubbleOriginal).toBeCloseTo(0.15, 5);
    expect(bubbleMaterial.opacity / bubbleOriginal).toBeLessThan(0.2);
  });

  it("is a safe no-op when the layer is null (structure failed to build from missing/malformed data)", () => {
    expect(() => setGouldBeltDimmed(null, true)).not.toThrow();
    expect(() => setRadcliffeWaveDimmed(null, true)).not.toThrow();
    expect(() => setLocalBubbleDimmed(null, true)).not.toThrow();
  });

  it("still dims correctly even with an unrelated child (the optional structure label) present in the group", () => {
    const group = createGouldBeltLayer(GOULD_BELT)!;
    // Simulates `main.ts` parenting the CSS2DObject label under the same
    // group (see `structures.ts`'s `structureLabel` docstring) - a plain
    // `Object3D` stand-in is enough here since `structureLayerMesh` only
    // needs to NOT mistake it for the real tube `Mesh` (it isn't one).
    group.add(new Object3D());
    const material = (group.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const originalOpacity = material.opacity;

    setGouldBeltDimmed(group, true);
    expect(material.opacity).toBeLessThan(originalOpacity);
  });
});

/**
 * Issue #227: the new, gentler, earlier-triggering Local Bubble dim tier -
 * applies to the Gould Belt and Radcliffe Wave overlays (via a new
 * `insideBubble` parameter) but deliberately NOT to the Local Bubble's own
 * overlay, whose dimming stays tied only to the RECONS sphere trigger.
 */
describe("setGouldBeltDimmed / setRadcliffeWaveDimmed - Local Bubble tier (issue #227)", () => {
  it("dims the Gould Belt tube gently when inside the bubble but outside the sphere", () => {
    const group = createGouldBeltLayer(GOULD_BELT);
    const material = (group!.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const originalOpacity = material.opacity;

    setGouldBeltDimmed(group, false, true);
    expect(material.opacity).toBeLessThan(originalOpacity);
    expect(material.opacity).toBeGreaterThan(0);
  });

  it("dims the Radcliffe Wave tube gently when inside the bubble but outside the sphere", () => {
    const group = createRadcliffeWaveLayer(RADCLIFFE_WAVE);
    const material = (group!.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const originalOpacity = material.opacity;

    setRadcliffeWaveDimmed(group, false, true);
    expect(material.opacity).toBeLessThan(originalOpacity);
    expect(material.opacity).toBeGreaterThan(0);
  });

  it("the bubble tier dims less strongly than the sphere tier", () => {
    const group = createGouldBeltLayer(GOULD_BELT);
    const material = (group!.children[0] as Mesh).material as import("three").MeshBasicMaterial;

    setGouldBeltDimmed(group, false, true);
    const bubbleOpacity = material.opacity;

    setGouldBeltDimmed(group, true, true);
    const sphereOpacity = material.opacity;

    expect(bubbleOpacity).toBeGreaterThan(sphereOpacity);
  });

  it("the sphere tier wins when both insideSphere and insideBubble are true", () => {
    const group = createGouldBeltLayer(GOULD_BELT);
    const material = (group!.children[0] as Mesh).material as import("three").MeshBasicMaterial;

    setGouldBeltDimmed(group, true, false);
    const sphereOnlyOpacity = material.opacity;

    setGouldBeltDimmed(group, true, true);
    expect(material.opacity).toBe(sphereOnlyOpacity);
  });

  it("restores to full opacity when outside both boundaries", () => {
    const group = createGouldBeltLayer(GOULD_BELT);
    const material = (group!.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const originalOpacity = material.opacity;

    setGouldBeltDimmed(group, false, true);
    setGouldBeltDimmed(group, false, false);
    expect(material.opacity).toBe(originalOpacity);
  });

  it("does NOT apply the bubble tier to the Local Bubble's own overlay - setLocalBubbleDimmed stays a plain sphere-only boolean", () => {
    const group = createLocalBubbleLayer(LOCAL_BUBBLE);
    const material = (group!.children[0] as Mesh).material as import("three").MeshBasicMaterial;
    const originalOpacity = material.opacity;

    // setLocalBubbleDimmed only ever takes one boolean - there is no
    // insideBubble parameter to even pass here, by design (issue #227's
    // "do NOT apply the new bubble-tier to the Local Bubble's own overlay").
    setLocalBubbleDimmed(group, false);
    expect(material.opacity).toBe(originalOpacity);
  });
});
