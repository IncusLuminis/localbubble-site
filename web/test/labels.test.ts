import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_LABEL_DISTANCE_PC,
  effectiveMaxLabelDistancePc,
  LABEL_DISTANCE_CAMERA_SCALE_FACTOR,
  selectNearestLabels,
  shouldShowLabel,
  shouldShowSunLabel,
  type LabelRankCandidate,
} from "../src/scene/labels";

/**
 * Branch coverage for the label clutter-avoidance rule (spec Idea.md §25).
 * Pure predicate - no `THREE`/DOM dependency.
 */

const BASE = {
  labelsEnabled: true,
  layerVisible: true,
  withinRadius: true,
  isSelected: false,
  cameraDistancePc: 100,
  maxCameraDistancePc: 500,
};

describe("shouldShowLabel", () => {
  it("shows a nearby, visible, in-radius object's label when labels are on", () => {
    expect(shouldShowLabel(BASE)).toBe(true);
  });

  it("hides all labels when the global labels toggle is off, even if selected", () => {
    expect(shouldShowLabel({ ...BASE, labelsEnabled: false, isSelected: true })).toBe(false);
  });

  it("hides a label whose category layer is toggled off", () => {
    expect(shouldShowLabel({ ...BASE, layerVisible: false })).toBe(false);
  });

  it("hides a label filtered out by the current radius", () => {
    expect(shouldShowLabel({ ...BASE, withinRadius: false })).toBe(false);
  });

  it("hides a distant, unselected object's label (clutter avoidance)", () => {
    expect(shouldShowLabel({ ...BASE, cameraDistancePc: 5000, maxCameraDistancePc: 500 })).toBe(
      false,
    );
  });

  it("always shows the selected object's label regardless of camera distance", () => {
    expect(
      shouldShowLabel({ ...BASE, isSelected: true, cameraDistancePc: 50_000, maxCameraDistancePc: 500 }),
    ).toBe(true);
  });

  it("selection cannot override an off category layer or a radius exclusion", () => {
    expect(shouldShowLabel({ ...BASE, isSelected: true, layerVisible: false })).toBe(false);
    expect(shouldShowLabel({ ...BASE, isSelected: true, withinRadius: false })).toBe(false);
  });

  it("shows a label exactly at the distance threshold (boundary is inclusive)", () => {
    expect(shouldShowLabel({ ...BASE, cameraDistancePc: 500, maxCameraDistancePc: 500 })).toBe(
      true,
    );
  });
});

/**
 * Issue #89's label-density fix: at 605 catalog objects, the distance
 * cutoff alone (`shouldShowLabel`) can still leave hundreds of objects
 * eligible at a typical zoomed-out view - `selectNearestLabels` is the
 * hard cap on simultaneously-rendered DOM labels that actually bounds
 * `CSS2DRenderer`'s cost regardless of catalog size.
 */
describe("selectNearestLabels", () => {
  function candidate(id: string, cameraDistancePc: number, isSelected = false): LabelRankCandidate {
    return { id, cameraDistancePc, isSelected };
  }

  it("shows everything when the candidate count is already within the cap", () => {
    const candidates = [candidate("a", 10), candidate("b", 20), candidate("c", 30)];
    expect(selectNearestLabels(candidates, 5)).toEqual(new Set(["a", "b", "c"]));
  });

  it("keeps only the nearest N candidates when over the cap", () => {
    const candidates = [
      candidate("far", 500),
      candidate("near", 10),
      candidate("mid", 100),
      candidate("mid-far", 300),
    ];
    const visible = selectNearestLabels(candidates, 2);
    expect(visible).toEqual(new Set(["near", "mid"]));
  });

  it("always includes the selected candidate even if it would rank outside the cap", () => {
    const candidates = [
      candidate("near-1", 10),
      candidate("near-2", 20),
      candidate("near-3", 30),
      candidate("selected-but-far", 9999, true),
    ];
    const visible = selectNearestLabels(candidates, 2);
    expect(visible.has("selected-but-far")).toBe(true);
    expect(visible.size).toBe(2);
    // The nearest of the non-selected candidates fills the remaining budget.
    expect(visible.has("near-1")).toBe(true);
  });

  it("returns an empty set for an empty candidate list", () => {
    expect(selectNearestLabels([], 60)).toEqual(new Set());
  });

  it("handles a cap of zero by showing only selected candidates", () => {
    const candidates = [candidate("a", 10), candidate("b", 20, true)];
    expect(selectNearestLabels(candidates, 0)).toEqual(new Set(["b"]));
  });

  it("at realistic catalog scale (605 objects), caps well below the full eligible set", () => {
    const candidates: LabelRankCandidate[] = Array.from({ length: 548 }, (_, i) =>
      candidate(`obj-${i}`, i),
    );
    const visible = selectNearestLabels(candidates, 60);
    expect(visible.size).toBe(60);
    // The 60 nearest (smallest cameraDistancePc, i.e. indices 0..59) win.
    expect(visible.has("obj-0")).toBe(true);
    expect(visible.has("obj-59")).toBe(true);
    expect(visible.has("obj-60")).toBe(false);
  });
});

/**
 * Issue #94: the default camera pose (`scene/camera.ts`) sits ~1087pc from
 * the origin, well outside the fixed 250pc threshold PR #93/issue #89 set,
 * so on first load - with no user zoom/pan and nothing selected - literally
 * every catalog object failed `shouldShowLabel`'s distance check and zero
 * labels rendered. `effectiveMaxLabelDistancePc` reconciles the two
 * defaults by scaling the threshold with the camera's current distance from
 * the origin, floored at the original 250pc so close-in zoom levels
 * (e.g. the "Sun-centered" preset) keep behaving exactly as before #94.
 */
describe("effectiveMaxLabelDistancePc", () => {
  it("never drops below the DEFAULT_MAX_LABEL_DISTANCE_PC floor when the camera is close in", () => {
    // Sun-centered preset camera distance (~93.8pc, scene/cameraPresets.ts).
    expect(effectiveMaxLabelDistancePc(93.8)).toBe(DEFAULT_MAX_LABEL_DISTANCE_PC);
    expect(effectiveMaxLabelDistancePc(0)).toBe(DEFAULT_MAX_LABEL_DISTANCE_PC);
  });

  it("scales linearly with camera distance once that exceeds the floor", () => {
    const cameraDistancePc = 1000;
    expect(effectiveMaxLabelDistancePc(cameraDistancePc)).toBeCloseTo(
      cameraDistancePc * LABEL_DISTANCE_CAMERA_SCALE_FACTOR,
      6,
    );
  });

  it("at the default 'Perspective' camera pose (~1087pc from the origin), the threshold comfortably covers near-Sun objects that a fixed 250pc threshold would have excluded entirely", () => {
    // scene/camera.ts's default position (700, -700, 450); length ~1087.4pc.
    const defaultCameraDistancePc = Math.sqrt(700 ** 2 + 700 ** 2 + 450 ** 2);
    const threshold = effectiveMaxLabelDistancePc(defaultCameraDistancePc);

    expect(threshold).toBeGreaterThan(DEFAULT_MAX_LABEL_DISTANCE_PC);

    // A star close to the Sun (10, 10, 5) - representative of the
    // catalog's near-Sun density (spec Idea-v1.2-individual-stars.md) - is
    // well within the new threshold from that default camera position,
    // where it would have been >4x the old fixed 250pc threshold away.
    const cameraPosition = { x: 700, y: -700, z: 450 };
    const nearSunObject = { x: 10, y: 10, z: 5 };
    const cameraDistanceToObject = Math.sqrt(
      (cameraPosition.x - nearSunObject.x) ** 2 +
        (cameraPosition.y - nearSunObject.y) ** 2 +
        (cameraPosition.z - nearSunObject.z) ** 2,
    );
    expect(cameraDistanceToObject).toBeGreaterThan(DEFAULT_MAX_LABEL_DISTANCE_PC);
    expect(cameraDistanceToObject).toBeLessThanOrEqual(threshold);
    expect(
      shouldShowLabel({
        labelsEnabled: true,
        layerVisible: true,
        withinRadius: true,
        isSelected: false,
        cameraDistancePc: cameraDistanceToObject,
        maxCameraDistancePc: threshold,
      }),
    ).toBe(true);
  });
});

/**
 * Issue #105 (spec §2.5): the Sun's dedicated marker (`scene/sun.ts`) gets
 * its own label, wired into the same global labels toggle as catalog
 * labels but permanently exempt from the distance-based hide-at-large-zoom
 * threshold (`shouldShowLabel`) and the `MAX_VISIBLE_LABELS` nearest-N cap
 * (`selectNearestLabels`) - "the coordinate origin should never
 * disappear." `shouldShowSunLabel`'s signature takes no distance/rank
 * inputs at all, so there is nothing for these tests to vary except the
 * global toggle itself.
 */
describe("shouldShowSunLabel", () => {
  it("is visible whenever the global labels toggle is on", () => {
    expect(shouldShowSunLabel(true)).toBe(true);
  });

  it("is hidden only when the global labels toggle is off", () => {
    expect(shouldShowSunLabel(false)).toBe(false);
  });

  it("stays visible under camera-distance/rank conditions that would hide any ordinary catalog label", () => {
    // An extreme distance, far beyond any realistic threshold, and a rank
    // that would lose to `MAX_VISIBLE_LABELS` competition for a regular,
    // unselected catalog object under `shouldShowLabel`/
    // `selectNearestLabels` - the Sun's label ignores both, because its
    // visibility function never receives them.
    const extremeCameraDistancePc = 1_000_000;
    const tinyThreshold = 1;

    const ordinaryObjectWouldBeHidden = !shouldShowLabel({
      labelsEnabled: true,
      layerVisible: true,
      withinRadius: true,
      isSelected: false,
      cameraDistancePc: extremeCameraDistancePc,
      maxCameraDistancePc: tinyThreshold,
    });
    expect(ordinaryObjectWouldBeHidden).toBe(true);

    // Same "labels are on" condition, but the Sun's own policy is
    // unaffected by the distance/rank scenario above.
    expect(shouldShowSunLabel(true)).toBe(true);
  });
});
