import { describe, expect, it } from "vitest";
import {
  denseBatchObjectFrameMaxDistancePc,
  edgeOnPose,
  faceOnPose,
  fitAllPose,
  fitSpherePose,
  objectCenteredPose,
  perspectivePose,
  sunCenteredPose,
  topViewPose,
} from "../src/scene/cameraPresets";

/**
 * Pure target/position computation for camera presets (spec Idea.md §29).
 * No `THREE` dependency - these operate on plain number tuples so they can
 * be checked without a WebGL context (spec §38).
 */

describe("perspectivePose", () => {
  it("targets the origin (the Sun, spec §6)", () => {
    expect(perspectivePose().target).toEqual([0, 0, 0]);
  });
});

describe("topViewPose / faceOnPose", () => {
  it("both look straight down the +Z axis at the origin (documented judgment call)", () => {
    const top = topViewPose(800);
    const faceOn = faceOnPose(800);
    expect(top.target).toEqual([0, 0, 0]);
    expect(faceOn).toEqual(top);
    expect(top.position[0]).toBe(0);
    expect(top.position[1]).toBe(0);
    expect(top.position[2]).toBeGreaterThan(0);
  });

  it("moves further out for a larger radius", () => {
    const near = topViewPose(100);
    const far = topViewPose(2000);
    expect(far.position[2]).toBeGreaterThan(near.position[2]);
  });
});

describe("edgeOnPose", () => {
  it("sits in the Z=0 plane (parallel to the Galactic Plane) looking at the origin", () => {
    const pose = edgeOnPose(800);
    expect(pose.position[2]).toBe(0);
    expect(pose.target).toEqual([0, 0, 0]);
    // Not at the origin itself - must actually be offset to look "at" it.
    expect(Math.abs(pose.position[0]) + Math.abs(pose.position[1])).toBeGreaterThan(0);
  });
});

describe("sunCenteredPose", () => {
  it("targets the origin and is zoomed in closer than the default Perspective view", () => {
    const pose = sunCenteredPose();
    expect(pose.target).toEqual([0, 0, 0]);
    const sunDistance = Math.hypot(...pose.position);
    const perspectiveDistance = Math.hypot(...perspectivePose().position);
    expect(sunDistance).toBeLessThan(perspectiveDistance);
  });
});

describe("objectCenteredPose", () => {
  it("targets the object's own position, not the origin", () => {
    const pose = objectCenteredPose([120, -30, 15], 10);
    expect(pose.target).toEqual([120, -30, 15]);
  });

  it("frames a point-like object (small marker radius) at the minimum close-up distance", () => {
    const pose = objectCenteredPose([0, 0, 0], 4); // MIN_MARKER_RADIUS_PC-scale object
    const distance = Math.hypot(...pose.position);
    expect(distance).toBeCloseTo(25, 6); // OBJECT_FRAME_MIN_DISTANCE_PC floor
  });

  it("frames a larger object (bigger marker radius) proportionally further away", () => {
    const small = objectCenteredPose([0, 0, 0], 5);
    const large = objectCenteredPose([0, 0, 0], 45); // MAX_MARKER_RADIUS_PC-scale object
    const smallDistance = Math.hypot(...small.position);
    const largeDistance = Math.hypot(...large.position);
    expect(largeDistance).toBeGreaterThan(smallDistance);
  });

  it("re-centers correctly for an off-origin object (position offset, not overwritten)", () => {
    const origin = objectCenteredPose([0, 0, 0], 20);
    const offset = objectCenteredPose([500, 500, 500], 20);
    const originOffset: [number, number, number] = [
      origin.position[0] - origin.target[0],
      origin.position[1] - origin.target[1],
      origin.position[2] - origin.target[2],
    ];
    const offsetOffset: [number, number, number] = [
      offset.position[0] - offset.target[0],
      offset.position[1] - offset.target[1],
      offset.position[2] - offset.target[2],
    ];
    expect(offsetOffset[0]).toBeCloseTo(originOffset[0], 9);
    expect(offsetOffset[1]).toBeCloseTo(originOffset[1], 9);
    expect(offsetOffset[2]).toBeCloseTo(originOffset[2], 9);
  });

  it("is zoomed in closer than the default Perspective view", () => {
    const pose = objectCenteredPose([0, 0, 0], 45);
    const distance = Math.hypot(...pose.position);
    const perspectiveDistance = Math.hypot(...perspectivePose().position);
    expect(distance).toBeLessThan(perspectiveDistance);
  });

  // Issue #207: `maxDistancePc` caps the generic distance formula - the
  // fix for the oversized dense-batch-star selection reticle (see
  // `denseBatchObjectFrameMaxDistancePc`'s own describe block below for the
  // actual cap value used in production).
  it("caps the framing distance when maxDistancePc is smaller than the generic distance", () => {
    const uncapped = objectCenteredPose([0, 0, 0], 45); // generic distance well above 5
    const capped = objectCenteredPose([0, 0, 0], 45, 5);
    const uncappedDistance = Math.hypot(...uncapped.position);
    const cappedDistance = Math.hypot(...capped.position);
    expect(uncappedDistance).toBeGreaterThan(5);
    expect(cappedDistance).toBeCloseTo(5, 6);
  });

  it("leaves the generic distance unchanged when maxDistancePc is larger than it", () => {
    const withoutCap = objectCenteredPose([0, 0, 0], 4);
    const withLargeCap = objectCenteredPose([0, 0, 0], 4, 1000);
    expect(withLargeCap).toEqual(withoutCap);
  });

  it("leaves the generic distance unchanged when maxDistancePc is omitted", () => {
    const pose = objectCenteredPose([10, 20, 30], 4); // MIN_MARKER_RADIUS_PC-scale object
    const distance = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    expect(distance).toBeCloseTo(25, 6); // OBJECT_FRAME_MIN_DISTANCE_PC floor, unaffected
  });
});

describe("denseBatchObjectFrameMaxDistancePc", () => {
  // Issue #207 root-cause fix: caps `objectCenteredPose`'s framing distance
  // for a dense-batch star so the resulting camera position, by the
  // triangle inequality, can never end up farther from the origin than
  // `denseBatchRadiusPc` by more than the function's own small floor -
  // landing inside the same radius `starMarkerRadiusPc`/`passesDenseBatchLod`
  // already treat as "fully zoomed into the dense-LOD sphere", regardless of
  // where in that sphere the target itself sits.
  it("returns denseBatchRadiusPc minus the target's own distance from the origin, for a target near the origin", () => {
    // Alpha Centauri A's real position_pc is close to [0.9, -0.9, -0.02]
    // (distance from origin ~1.3pc); with a ~11.26pc denseBatchRadiusPc
    // (this batch's real collection radius), the safe budget is ~9.96pc.
    const distanceFromOrigin = Math.hypot(0.9, -0.9, -0.02);
    const denseBatchRadiusPc = 11.26;
    const result = denseBatchObjectFrameMaxDistancePc([0.9, -0.9, -0.02], denseBatchRadiusPc);
    expect(result).toBeCloseTo(denseBatchRadiusPc - distanceFromOrigin, 6);
  });

  it("guarantees (via the triangle inequality) the resulting camera position stays within denseBatchRadiusPc of the origin", () => {
    const denseBatchRadiusPc = 11.26;
    const positionPc: [number, number, number] = [3, -4, 2]; // distance from origin = sqrt(29) ~5.39pc
    const maxDistancePc = denseBatchObjectFrameMaxDistancePc(positionPc, denseBatchRadiusPc);
    const pose = objectCenteredPose(positionPc, 2, maxDistancePc);
    const cameraDistanceFromOrigin = Math.hypot(...pose.position);
    expect(cameraDistanceFromOrigin).toBeLessThanOrEqual(denseBatchRadiusPc + 1e-9);
  });

  it("falls back to a small positive floor rather than ~0 for a target already at the sphere's own edge", () => {
    const denseBatchRadiusPc = 11.26;
    // A target sitting exactly at the collection radius from the origin.
    const positionPc: [number, number, number] = [denseBatchRadiusPc, 0, 0];
    const result = denseBatchObjectFrameMaxDistancePc(positionPc, denseBatchRadiusPc);
    expect(result).toBeGreaterThan(0);
  });

  it("scales down as the target's own distance from the origin grows", () => {
    const denseBatchRadiusPc = 11.26;
    const near = denseBatchObjectFrameMaxDistancePc([1, 0, 0], denseBatchRadiusPc);
    const far = denseBatchObjectFrameMaxDistancePc([8, 0, 0], denseBatchRadiusPc);
    expect(far).toBeLessThan(near);
  });
});

describe("fitAllPose", () => {
  it("falls back to the default Perspective pose when there are no visible objects", () => {
    expect(fitAllPose([])).toEqual(perspectivePose());
  });

  it("centers the target on the centroid of the given positions", () => {
    const positions: [number, number, number][] = [
      [100, 0, 0],
      [-100, 0, 0],
      [0, 100, 0],
      [0, -100, 0],
    ];
    const pose = fitAllPose(positions);
    expect(pose.target[0]).toBeCloseTo(0, 9);
    expect(pose.target[1]).toBeCloseTo(0, 9);
    expect(pose.target[2]).toBeCloseTo(0, 9);
  });

  it("moves the camera further away as the spread of points grows", () => {
    const tight: [number, number, number][] = [
      [10, 0, 0],
      [-10, 0, 0],
    ];
    const wide: [number, number, number][] = [
      [1000, 0, 0],
      [-1000, 0, 0],
    ];
    const tightPose = fitAllPose(tight);
    const widePose = fitAllPose(wide);
    const tightDistance = Math.hypot(
      tightPose.position[0] - tightPose.target[0],
      tightPose.position[1] - tightPose.target[1],
      tightPose.position[2] - tightPose.target[2],
    );
    const wideDistance = Math.hypot(
      widePose.position[0] - widePose.target[0],
      widePose.position[1] - widePose.target[1],
      widePose.position[2] - widePose.target[2],
    );
    expect(wideDistance).toBeGreaterThan(tightDistance);
  });

  it("handles a single object without a degenerate (zero-distance) camera position", () => {
    const pose = fitAllPose([[42, 0, 0]]);
    const distance = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    expect(distance).toBeGreaterThan(0);
  });

  it("matches fitSpherePose given the same centroid/bounding radius (issue #197 refactor)", () => {
    const positions: [number, number, number][] = [
      [100, 0, 0],
      [-100, 0, 0],
      [0, 100, 0],
      [0, -100, 0],
    ];
    const allPose = fitAllPose(positions);
    const spherePose = fitSpherePose([0, 0, 0], 100);
    expect(allPose).toEqual(spherePose);
  });
});

describe("fitSpherePose", () => {
  it("targets the given center, not the origin", () => {
    const pose = fitSpherePose([120, -30, 15], 25);
    expect(pose.target).toEqual([120, -30, 15]);
  });

  it("moves the camera further away as the given radius grows", () => {
    const small = fitSpherePose([0, 0, 0], 20);
    const large = fitSpherePose([0, 0, 0], 500);
    const smallDistance = Math.hypot(...small.position);
    const largeDistance = Math.hypot(...large.position);
    expect(largeDistance).toBeGreaterThan(smallDistance);
  });

  it("floors a point-like (near-zero radius) sphere at a sane non-zero viewing distance", () => {
    const pose = fitSpherePose([0, 0, 0], 0);
    const distance = Math.hypot(...pose.position);
    expect(distance).toBeGreaterThan(0);
  });

  it("views along the same default direction as fitAllPose/perspectivePose, just re-centered", () => {
    const centered = fitSpherePose([0, 0, 0], 200);
    const offset = fitSpherePose([500, -500, 500], 200);
    const centeredOffset: [number, number, number] = [
      centered.position[0] - centered.target[0],
      centered.position[1] - centered.target[1],
      centered.position[2] - centered.target[2],
    ];
    const offsetOffset: [number, number, number] = [
      offset.position[0] - offset.target[0],
      offset.position[1] - offset.target[1],
      offset.position[2] - offset.target[2],
    ];
    expect(offsetOffset[0]).toBeCloseTo(centeredOffset[0], 9);
    expect(offsetOffset[1]).toBeCloseTo(centeredOffset[1], 9);
    expect(offsetOffset[2]).toBeCloseTo(centeredOffset[2], 9);
  });

  it("frames a Local-Bubble-scale sphere (real center_pc/semi_axes_pc shape, issue #197)", () => {
    // Representative real-world magnitudes (Alves et al. 2018-style), not
    // the actual scene.json values - just checking the call shape works.
    const center: [number, number, number] = [-2.5, 20.7, -21.3];
    const radius = Math.max(56, 112, 152); // max(semi_axes_pc)
    const pose = fitSpherePose(center, radius);
    expect(pose.target).toEqual(center);
    const distance = Math.hypot(
      pose.position[0] - pose.target[0],
      pose.position[1] - pose.target[1],
      pose.position[2] - pose.target[2],
    );
    expect(distance).toBeGreaterThan(radius);
  });
});
