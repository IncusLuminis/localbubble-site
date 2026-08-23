import { describe, expect, it } from "vitest";
import {
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
