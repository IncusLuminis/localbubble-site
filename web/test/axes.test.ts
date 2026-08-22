import { describe, expect, it } from "vitest";
import { AxesHelper, PerspectiveCamera, Vector3 } from "three";
import {
  clampDirectionToEdge,
  createAxes,
  edgeClampedDirection,
  galacticCenterIndicatorPlacement,
  galacticCenterLabelPosition,
  galacticCenterOnScreenArrowAngleDeg,
  GALACTIC_CENTER_EDGE_MARGIN,
  isNdcOnScreen,
  projectToNdc,
  type NdcProjection,
} from "../src/scene/axes";

/** Builds a real `PerspectiveCamera` at `position` looking at `target`,
 * with its matrices fully resolved (`updateMatrixWorld`/
 * `updateProjectionMatrix`) so `projectToNdc` sees the same
 * `matrixWorldInverse`/`projectionMatrix` state the live app's render loop
 * would - mirrors `scene/camera.ts`'s `createCamera` (Z-up, spec §6). */
function makeCamera(
  position: [number, number, number],
  target: [number, number, number],
  aspect = 1,
): PerspectiveCamera {
  const camera = new PerspectiveCamera(50, aspect, 0.1, 100_000);
  camera.up.set(0, 0, 1);
  camera.position.set(...position);
  camera.lookAt(new Vector3(...target));
  camera.updateMatrixWorld(true);
  camera.updateProjectionMatrix();
  return camera;
}

describe("createAxes", () => {
  it("returns an AxesHelper sized to the given extent", () => {
    const axes = createAxes(2000);
    expect(axes).toBeInstanceOf(AxesHelper);
    expect(axes.name).toBe("coordinate-axes");
  });
});

describe("galacticCenterLabelPosition", () => {
  // Issue #149: replaces #146's fixed 300pc point with one that scales with
  // the camera's own current distance from the origin
  // (`GALACTIC_CENTER_LABEL_DISTANCE_FACTOR` = 0.3, see axes.ts's docstring
  // for the per-camera-preset reasoning behind that factor), so the label
  // stays roughly in view across the app's full zoom range rather than only
  // near the default "Perspective" pose.

  it("scales with the camera's current distance from the origin (0.3x)", () => {
    // Mid-range: default "Perspective" pose distance (~1087pc, camera at
    // (700,-700,450) per scene/camera.ts).
    expect(galacticCenterLabelPosition(1087, 2000)).toEqual([1087 * 0.3, 0, 0]);
    // A different mid-range distance, to confirm this is genuinely
    // proportional, not just correct at one hardcoded point.
    expect(galacticCenterLabelPosition(500, 2000)).toEqual([150, 0, 0]);
  });

  it("stays well within view at the app's closest zoom (#134's ~1.45pc minimum)", () => {
    // At this distance the visible field of view only spans a few pc
    // (50deg FOV), so the label must land well under that, not at a
    // fixed hundreds-of-pc distance that would be far off-screen here.
    const [x, y, z] = galacticCenterLabelPosition(1.45, 2000);
    expect(x).toBeCloseTo(1.45 * 0.3, 5);
    expect(x).toBeLessThan(2);
    expect(y).toBe(0);
    expect(z).toBe(0);
  });

  it("caps at maxDistancePc (the axis's own drawn extent) at/beyond the app's overview zoom", () => {
    // At WORLD_EXTENT_PC = 2000pc (the largest radius preset) or beyond
    // (controls.maxDistance = 20000pc), 0.3x the camera distance would
    // exceed the axis's own endpoint - clamp there instead, exactly as
    // #146's original fixed-point version clamped to sizePc.
    expect(galacticCenterLabelPosition(2000, 2000)).toEqual([600, 0, 0]);
    expect(galacticCenterLabelPosition(20000, 2000)).toEqual([2000, 0, 0]);
  });

  it("floors above zero for a degenerate zero camera distance", () => {
    // The real app's OrbitControls.minDistance keeps the camera away from
    // the literal origin (#134), so this is a defensive-only case: the
    // pure function should still be total and never place the label
    // exactly on top of the Sun's own marker/label at the origin.
    const [x] = galacticCenterLabelPosition(0, 2000);
    expect(x).toBeGreaterThan(0);
  });

  it("always stays on the X axis (y=z=0)", () => {
    for (const cameraDistancePc of [0, 1.45, 100, 500, 1087, 2000, 20000]) {
      const [, y, z] = galacticCenterLabelPosition(cameraDistancePc, 2000);
      expect(y).toBe(0);
      expect(z).toBe(0);
    }
  });
});

/**
 * Issue #154 (Validator-flagged gap in #149): #149's `galacticCenterLabelPosition`
 * above only ever fixes the "wrong distance along +X" failure - it does
 * nothing for "the camera isn't looking anywhere near the +X axis at all",
 * which is exactly what happens once "go to object" search (#106)
 * recenters `controls.target` on a real, distant catalog object (the
 * Validator's reported repro: `* 55 Cyg`, ~1840pc, mostly along +Y). These
 * tests cover the new on/off-screen decision and edge-clamp math that
 * closes that gap - see `scene/axes.ts`'s docstrings for the full
 * reasoning (particularly why `behindCamera` has to be tracked separately
 * from the NDC x/y/z range check).
 */
describe("projectToNdc / isNdcOnScreen (issue #154)", () => {
  it("is on-screen, dead-center, for the point the camera is directly looking at", () => {
    const camera = makeCamera([0, 1740, 0], [0, 1840, 0]);
    const ndc = projectToNdc(new Vector3(0, 1840, 0), camera);
    expect(ndc.behindCamera).toBe(false);
    expect(ndc.x).toBeCloseTo(0, 5);
    expect(ndc.y).toBeCloseTo(0, 5);
    expect(isNdcOnScreen(ndc)).toBe(true);
  });

  it("reproduces #154's reported failure: the #149 label point lands behind the camera once it orbits a distant search target", () => {
    // Same shape as the real bug: camera near (0, 1840, 0) looking further
    // out along +Y (an `objectCenteredPose` "go to object" framing), while
    // the #149 label point sits on +X near the origin - far behind this
    // camera.
    const camera = makeCamera([0, 1740, 0], [0, 1840, 0]);
    const [x, y, z] = galacticCenterLabelPosition(1840, 2000);
    const ndc = projectToNdc(new Vector3(x, y, z), camera);
    expect(ndc.behindCamera).toBe(true);
    expect(isNdcOnScreen(ndc)).toBe(false);
  });

  it("is NOT on-screen for a point in front of the camera but outside the horizontal field of view", () => {
    const camera = makeCamera([0, -100, 0], [0, 0, 0]);
    const ndc = projectToNdc(new Vector3(400, 50, 0), camera);
    expect(ndc.behindCamera).toBe(false);
    expect(ndc.z).toBeGreaterThanOrEqual(-1);
    expect(ndc.z).toBeLessThanOrEqual(1);
    expect(Math.abs(ndc.x)).toBeGreaterThan(1);
    expect(isNdcOnScreen(ndc)).toBe(false);
  });

  it("is on-screen for the app's default Perspective pose + #149's label point (no regression)", () => {
    // scene/camera.ts's default pose, and axes.ts's own
    // `GALACTIC_CENTER_LABEL_DISTANCE_FACTOR` docstring, both already
    // verify this combination lands in-frustum - confirms #154's new
    // on/off-screen gate doesn't regress the already-working default case.
    const camera = makeCamera([700, -700, 450], [0, 0, 0]);
    const cameraDistancePc = Math.hypot(700, 700, 450);
    const [x, y, z] = galacticCenterLabelPosition(cameraDistancePc, 2000);
    const ndc = projectToNdc(new Vector3(x, y, z), camera);
    expect(isNdcOnScreen(ndc)).toBe(true);
  });
});

describe("edgeClampedDirection (issue #154)", () => {
  it("passes x/y through unchanged when not behind the camera", () => {
    const ndc: NdcProjection = { x: 0.3, y: -0.6, z: 0.5, behindCamera: false };
    expect(edgeClampedDirection(ndc)).toEqual({ x: 0.3, y: -0.6 });
  });

  it("negates (un-mirrors) x/y when behind the camera", () => {
    // `Vector3.project`'s perspective divide flips the sign of x/y for
    // points behind the camera (negative w) - see axes.ts's docstring. A
    // point physically to the camera's right-and-up but behind it
    // projects to negative/negative NDC; this restores the true
    // right/up direction so the fallback indicator points the correct way.
    const ndc: NdcProjection = { x: -0.4, y: -0.2, z: 1.5, behindCamera: true };
    expect(edgeClampedDirection(ndc)).toEqual({ x: 0.4, y: 0.2 });
  });
});

describe("clampDirectionToEdge (issue #154)", () => {
  it("scales the larger-magnitude axis to exactly the margin, preserving direction", () => {
    const result = clampDirectionToEdge({ x: 2, y: 1 });
    expect(result.x).toBeCloseTo(GALACTIC_CENTER_EDGE_MARGIN, 10);
    expect(result.y).toBeCloseTo(GALACTIC_CENTER_EDGE_MARGIN / 2, 10);
  });

  it("handles a y-dominant direction the same way", () => {
    const result = clampDirectionToEdge({ x: -1, y: 4 });
    expect(result.y).toBeCloseTo(GALACTIC_CENTER_EDGE_MARGIN, 10);
    expect(result.x).toBeCloseTo(-GALACTIC_CENTER_EDGE_MARGIN / 4, 10);
  });

  it("respects a custom margin", () => {
    expect(clampDirectionToEdge({ x: 1, y: 0 }, 0.5)).toEqual({ x: 0.5, y: 0 });
  });

  it("defaults to straight up for the degenerate zero-vector case", () => {
    // Only reachable when the target point sits exactly behind the camera
    // along its own view axis - an arbitrary but harmless choice since
    // that's a measure-zero set of camera poses.
    expect(clampDirectionToEdge({ x: 0, y: 0 })).toEqual({ x: 0, y: GALACTIC_CENTER_EDGE_MARGIN });
  });
});

/**
 * Issue #155: the on-screen anchored label was plain text with no
 * directional glyph, reading as "this is where the Galactic Center is"
 * rather than "this way is the Galactic Center" - these tests cover
 * `galacticCenterOnScreenArrowAngleDeg`, the pure function that derives the
 * arrow's screen-space rotation from the projected screen positions of two
 * points on the +X axis (per the issue's explicit ask to reuse
 * `projectToNdc` rather than a second projection method).
 */
describe("galacticCenterOnScreenArrowAngleDeg (issue #155)", () => {
  it("points straight up (0deg, the arrow's resting orientation) when the axis runs straight up on screen", () => {
    const origin: NdcProjection = { x: 0, y: 0, z: 0, behindCamera: false };
    const anchor: NdcProjection = { x: 0, y: 0.5, z: 0, behindCamera: false };
    expect(galacticCenterOnScreenArrowAngleDeg(origin, anchor)).toBeCloseTo(0, 10);
  });

  it("points right (90deg) when the axis runs rightward on screen", () => {
    const origin: NdcProjection = { x: 0, y: 0, z: 0, behindCamera: false };
    const anchor: NdcProjection = { x: 0.5, y: 0, z: 0, behindCamera: false };
    expect(galacticCenterOnScreenArrowAngleDeg(origin, anchor)).toBeCloseTo(90, 10);
  });

  it("points down-left (-135deg) for a down-left on-screen direction", () => {
    const origin: NdcProjection = { x: 0, y: 0, z: 0, behindCamera: false };
    const anchor: NdcProjection = { x: -0.3, y: -0.3, z: 0, behindCamera: false };
    expect(galacticCenterOnScreenArrowAngleDeg(origin, anchor)).toBeCloseTo(-135, 10);
  });

  it("un-mirrors each point's x/y individually before taking their difference (behind-camera sign flip)", () => {
    // Same sign-flip correction #154's `edgeClampedDirection` already
    // handles - if the origin end of the axis were behind the camera plane
    // while the anchor end (already confirmed on-screen by the caller) is
    // not, the raw NDC difference would be wrong without un-mirroring each
    // point first.
    const origin: NdcProjection = { x: 0.2, y: 0.1, z: 1.5, behindCamera: true };
    const anchor: NdcProjection = { x: 0.3, y: 0.4, z: 0, behindCamera: false };
    // Un-mirrored origin is (-0.2, -0.1); dx = 0.3 - (-0.2) = 0.5,
    // dy = 0.4 - (-0.1) = 0.5 -> 45deg.
    expect(galacticCenterOnScreenArrowAngleDeg(origin, anchor)).toBeCloseTo(45, 10);
  });

  it("defaults to 0deg (the resting orientation) for the degenerate case of coincident points", () => {
    const ndc: NdcProjection = { x: 0.1, y: -0.2, z: 0, behindCamera: false };
    expect(galacticCenterOnScreenArrowAngleDeg(ndc, ndc)).toBe(0);
  });

  it("end-to-end: points right for the 'Edge-on' preset, where +X runs along the camera's screen-right", () => {
    // Camera on -Y looking at the origin, Z-up (this app's convention, see
    // `makeCamera` above): forward = (0,1,0), world up = (0,0,1), so
    // screen-right = normalize(cross(forward, up)) = (1,0,0) - i.e. world
    // +X really does run straight rightward on screen in this pose, giving
    // a hand-verifiable 90deg expectation (not just "some finite number").
    const camera = makeCamera([0, -1280, 0], [0, 0, 0], 16 / 9);
    const originNdc = projectToNdc(new Vector3(0, 0, 0), camera);
    const [x, y, z] = galacticCenterLabelPosition(1280, 2000);
    const anchorNdc = projectToNdc(new Vector3(x, y, z), camera);
    expect(galacticCenterOnScreenArrowAngleDeg(originNdc, anchorNdc)).toBeCloseTo(90, 5);
  });

  it("end-to-end: the arrow angle changes with camera pose, rather than sitting at a fixed orientation", () => {
    // Core requirement of issue #155: the axis's on-screen angle changes
    // with every camera pose, so the arrow can't be a static glyph. Compare
    // the default "Perspective" pose against "Edge-on" above and confirm
    // they genuinely differ.
    const perspectiveCamera = makeCamera([700, -700, 450], [0, 0, 0], 16 / 9);
    const perspectiveDistance = Math.hypot(700, 700, 450);
    const perspectiveOriginNdc = projectToNdc(new Vector3(0, 0, 0), perspectiveCamera);
    const [px, py, pz] = galacticCenterLabelPosition(perspectiveDistance, 2000);
    const perspectiveAnchorNdc = projectToNdc(new Vector3(px, py, pz), perspectiveCamera);
    const perspectiveAngle = galacticCenterOnScreenArrowAngleDeg(perspectiveOriginNdc, perspectiveAnchorNdc);

    const edgeOnCamera = makeCamera([0, -1280, 0], [0, 0, 0], 16 / 9);
    const edgeOnOriginNdc = projectToNdc(new Vector3(0, 0, 0), edgeOnCamera);
    const [ex, ey, ez] = galacticCenterLabelPosition(1280, 2000);
    const edgeOnAnchorNdc = projectToNdc(new Vector3(ex, ey, ez), edgeOnCamera);
    const edgeOnAngle = galacticCenterOnScreenArrowAngleDeg(edgeOnOriginNdc, edgeOnAnchorNdc);

    expect(Number.isFinite(perspectiveAngle)).toBe(true);
    expect(perspectiveAngle).not.toBeCloseTo(edgeOnAngle, 1);
  });
});

describe("galacticCenterIndicatorPlacement (issue #154)", () => {
  it("reports onScreen: true and zeroed edge coordinates when the point is genuinely on-screen", () => {
    const ndc: NdcProjection = { x: 0.1, y: -0.2, z: 0, behindCamera: false };
    expect(galacticCenterIndicatorPlacement(ndc)).toEqual({ onScreen: true, edgeX: 0, edgeY: 0 });
  });

  it("clamps to the edge, un-mirrored, when the point is behind the camera", () => {
    const ndc: NdcProjection = { x: -0.1, y: -0.2, z: 1.5, behindCamera: true };
    const placement = galacticCenterIndicatorPlacement(ndc);
    expect(placement.onScreen).toBe(false);
    // Un-mirrored direction is (+0.1, +0.2) - the clamped point should
    // stay in that same quadrant, not the raw projected (negative,
    // negative) one.
    expect(placement.edgeX).toBeGreaterThan(0);
    expect(placement.edgeY).toBeGreaterThan(0);
    expect(Math.max(Math.abs(placement.edgeX), Math.abs(placement.edgeY))).toBeCloseTo(
      GALACTIC_CENTER_EDGE_MARGIN,
      10,
    );
  });

  it("end-to-end: reproduces #154's reported failure and confirms the fallback engages", () => {
    const camera = makeCamera([0, 1740, 0], [0, 1840, 0]);
    const [x, y, z] = galacticCenterLabelPosition(1840, 2000);
    const ndc = projectToNdc(new Vector3(x, y, z), camera);
    const placement = galacticCenterIndicatorPlacement(ndc);
    expect(placement.onScreen).toBe(false);
    expect(Math.max(Math.abs(placement.edgeX), Math.abs(placement.edgeY))).toBeCloseTo(
      GALACTIC_CENTER_EDGE_MARGIN,
      10,
    );
  });

  it("stays onScreen: true across every built-in camera preset at its own default distance (no regression)", () => {
    // Mirrors `GALACTIC_CENTER_LABEL_DISTANCE_FACTOR`'s own docstring
    // verification in axes.ts - every built-in preset orbits near the
    // origin, so the #149 label point should always resolve on-screen
    // through the new #154 gate, never triggering the edge-clamp fallback.
    const presets: Array<{ name: string; position: [number, number, number]; target: [number, number, number] }> = [
      { name: "Perspective", position: [700, -700, 450], target: [0, 0, 0] },
      { name: "Sun-centered", position: [60, -60, 40], target: [0, 0, 0] },
      { name: "Top view", position: [0, 0, 1280], target: [0, 0, 0] },
      { name: "Face-on", position: [0, 0, 1280], target: [0, 0, 0] },
      { name: "Edge-on", position: [0, -1280, 0], target: [0, 0, 0] },
    ];
    for (const preset of presets) {
      const camera = makeCamera(preset.position, preset.target, 16 / 9);
      const cameraDistancePc = Math.hypot(...preset.position);
      const [x, y, z] = galacticCenterLabelPosition(cameraDistancePc, 2000);
      const ndc = projectToNdc(new Vector3(x, y, z), camera);
      expect(galacticCenterIndicatorPlacement(ndc).onScreen, `${preset.name} preset`).toBe(true);
    }
  });
});
