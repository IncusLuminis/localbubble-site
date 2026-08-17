import { describe, expect, it } from "vitest";
import {
  edgeOnPose,
  faceOnPose,
  fitAllPose,
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
});
