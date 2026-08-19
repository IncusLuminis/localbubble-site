import { describe, expect, it } from "vitest";
import {
  createSelectionIndicator,
  RETICLE_RADIUS_MULTIPLIER,
  reticleScaleFor,
} from "../src/scene/selectionIndicator";
import { isSelectedObjectVisible } from "../src/scene/objects";
import type { SceneObject } from "../src/scene/sceneTypes";

/**
 * Issue #123: the selection reticle + line-to-Sun indicator. Mirrors
 * `sun.test.ts`'s style of testing plain `Three.js` geometry/transform
 * values directly (no WebGL context needed, spec §38) plus a pure
 * scale-formula function, and reuses `objects.test.ts`'s
 * `isSelectedObjectVisible` coverage as the show/hide contract this
 * module's own `setVisible` is driven by from `main.ts`.
 */

function makeObject(overrides: Partial<SceneObject>): SceneObject {
  return {
    id: "test-object",
    name: "Test Object",
    aliases: [],
    object_type: "molecular_cloud",
    position_pc: [10, 20, 30],
    distance_pc: 37.4,
    distance_error_pc: null,
    size_pc: null,
    color_class: null,
    group: { primary: null, secondary: [] },
    source: { reference: "test fixture", url: null, catalog: null },
    notes: null,
    ...overrides,
  };
}

describe("reticleScaleFor", () => {
  it("scales linearly by RETICLE_RADIUS_MULTIPLIER", () => {
    expect(reticleScaleFor(1)).toBe(RETICLE_RADIUS_MULTIPLIER);
    expect(reticleScaleFor(2)).toBe(2 * RETICLE_RADIUS_MULTIPLIER);
    expect(reticleScaleFor(0)).toBe(0);
  });

  it("stays proportionally the same 'ring around the marker' at any marker size", () => {
    // A tiny LOD-shrunk star marker (issue #119's STAR_MARKER_MIN_RADIUS_PC,
    // 0.02pc) and a large structure marker (issue #103's
    // STRUCTURE_MAX_RADIUS_PC, 45pc) should both scale by the exact same
    // multiplier - the reticle reads as "N times this marker's own current
    // radius" regardless of how big or small that radius currently is.
    expect(reticleScaleFor(0.02)).toBeCloseTo(0.02 * RETICLE_RADIUS_MULTIPLIER, 10);
    expect(reticleScaleFor(45)).toBeCloseTo(45 * RETICLE_RADIUS_MULTIPLIER, 10);
  });

  it("is always at least as large as the marker itself for any positive radius", () => {
    // RETICLE_RADIUS_MULTIPLIER > 1 is the whole point (a ring AROUND the
    // marker, not overlapping/smaller than it) - assert the invariant
    // rather than hard-coding the current multiplier's value here.
    expect(RETICLE_RADIUS_MULTIPLIER).toBeGreaterThan(1);
    expect(reticleScaleFor(5)).toBeGreaterThan(5);
  });
});

describe("createSelectionIndicator", () => {
  it("returns a group named 'selection-indicator', starting hidden (nothing selected on load)", () => {
    const { group } = createSelectionIndicator();
    expect(group.name).toBe("selection-indicator");
    expect(group.visible).toBe(false);
  });

  it("contains a reticle sub-group (3 orthogonal circles) and a 2-point line-to-Sun", () => {
    const { group } = createSelectionIndicator();
    const reticle = group.children.find((c) => c.name === "selection-reticle");
    const line = group.children.find((c) => c.name === "selection-line-to-sun");
    expect(reticle).toBeDefined();
    expect(reticle?.children.length).toBe(3);
    expect(line).toBeDefined();
  });

  it("setVisible(true)/setVisible(false) toggles the whole group in lockstep", () => {
    const indicator = createSelectionIndicator();
    indicator.setVisible(true);
    expect(indicator.group.visible).toBe(true);
    indicator.setVisible(false);
    expect(indicator.group.visible).toBe(false);
  });

  it("updateForObject positions and scales the reticle at the object's position/radius", () => {
    const indicator = createSelectionIndicator();
    indicator.updateForObject([12, -5, 3], 2);

    const reticle = indicator.group.children.find((c) => c.name === "selection-reticle");
    expect(reticle).toBeDefined();
    expect(reticle!.position.x).toBe(12);
    expect(reticle!.position.y).toBe(-5);
    expect(reticle!.position.z).toBe(3);
    expect(reticle!.scale.x).toBeCloseTo(reticleScaleFor(2), 10);
    expect(reticle!.scale.y).toBeCloseTo(reticleScaleFor(2), 10);
    expect(reticle!.scale.z).toBeCloseTo(reticleScaleFor(2), 10);
  });

  it("updateForObject draws the line from the Sun (origin) to the object's position", () => {
    const indicator = createSelectionIndicator();
    indicator.updateForObject([12, -5, 3], 2);

    const line = indicator.group.children.find((c) => c.name === "selection-line-to-sun");
    expect(line).toBeDefined();
    const positions = (line as unknown as { geometry: { attributes: { position: { array: ArrayLike<number> } } } })
      .geometry.attributes.position.array;
    // Point 0: the Sun/origin.
    expect(positions[0]).toBe(0);
    expect(positions[1]).toBe(0);
    expect(positions[2]).toBe(0);
    // Point 1: the selected object's position.
    expect(positions[3]).toBe(12);
    expect(positions[4]).toBe(-5);
    expect(positions[5]).toBe(3);
  });

  it("updateForObject called again (e.g. next frame, or a different selection) overwrites the previous position/scale", () => {
    const indicator = createSelectionIndicator();
    indicator.updateForObject([12, -5, 3], 2);
    indicator.updateForObject([0, 0, 100], 0.5);

    const reticle = indicator.group.children.find((c) => c.name === "selection-reticle");
    const line = indicator.group.children.find((c) => c.name === "selection-line-to-sun");
    expect(reticle!.position.z).toBe(100);
    expect(reticle!.scale.x).toBeCloseTo(reticleScaleFor(0.5), 10);
    const positions = (line as unknown as { geometry: { attributes: { position: { array: ArrayLike<number> } } } })
      .geometry.attributes.position.array;
    expect(positions[5]).toBe(100);
  });
});

/**
 * Issue #123's acceptance criterion: "the reticle/line should hide together
 * with the Inspector when the selected object becomes invisible, and
 * reappear when it's visible again" - reusing #95/#97's existing
 * `isSelectedObjectVisible` (`objects.ts`) as the single show/hide
 * predicate `main.ts`'s `refreshSelectionVisibility` now drives both the
 * Inspector AND `selectionIndicator.setVisible` from. This is exactly the
 * predicate under test in `objects.test.ts` already - re-asserted here,
 * scoped to the selection-indicator's own contract, so a regression in that
 * shared predicate is caught from this module's test suite too.
 */
describe("selection indicator show/hide contract (isSelectedObjectVisible)", () => {
  const VISIBLE_OBJECT = makeObject({ id: "visible-object", object_type: "molecular_cloud" });
  const objects = [VISIBLE_OBJECT];
  const allCategoriesOn = new Map<string, boolean>([["molecular_cloud", true]]);
  const categoryOff = new Map<string, boolean>([["molecular_cloud", false]]);

  it("is visible when the selected object passes the category/radius/LOD filters", () => {
    expect(isSelectedObjectVisible(objects, "visible-object", allCategoriesOn, null)).toBe(true);
  });

  it("is hidden when the selected object's category is toggled off", () => {
    expect(isSelectedObjectVisible(objects, "visible-object", categoryOff, null)).toBe(false);
  });

  it("is hidden when nothing is selected", () => {
    expect(isSelectedObjectVisible(objects, null, allCategoriesOn, null)).toBe(false);
  });
});
