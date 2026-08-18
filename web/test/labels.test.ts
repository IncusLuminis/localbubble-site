import { describe, expect, it } from "vitest";
import { selectNearestLabels, shouldShowLabel, type LabelRankCandidate } from "../src/scene/labels";

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
