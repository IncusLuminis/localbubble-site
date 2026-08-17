import { describe, expect, it } from "vitest";
import { shouldShowLabel } from "../src/scene/labels";

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
