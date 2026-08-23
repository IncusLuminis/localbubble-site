import { describe, expect, it } from "vitest";
import { deriveMinZoomDistancePc, dollyPosition } from "../src/scene/camera";
import { SUN_CORE_MIN_RADIUS_PC } from "../src/scene/sun";
import { SUN_OBJECT_ID, LOCAL_BUBBLE_OBJECT_ID } from "../src/scene/objects";
import type { SceneObject } from "../src/scene/sceneTypes";

/**
 * Issue #134: the OrbitControls close-zoom floor, derived from the real
 * loaded catalog's nearest non-Sun object rather than the pre-#134
 * hard-coded `5`pc - mirrors `lod.test.ts`'s style for testing a data-derived
 * distance function with plain `SceneObject` fixtures.
 */

function makeObject(overrides: Partial<SceneObject>): SceneObject {
  return {
    id: "test-object",
    name: "Test Object",
    aliases: [],
    object_type: "star",
    position_pc: [1, 0, 0],
    distance_pc: 1,
    distance_error_pc: null,
    size_pc: null,
    color_class: null,
    spectral_type: null,
    absolute_magnitude: null,
    apparent_magnitude: null,
    exoplanets: null,
    group: { primary: null, secondary: [] },
    source: { reference: "test fixture", url: null, catalog: null },
    notes: null,
    ...overrides,
  };
}

const SUN = makeObject({ id: SUN_OBJECT_ID, object_type: "reference_point", distance_pc: 0 });
const LOCAL_BUBBLE = makeObject({
  id: LOCAL_BUBBLE_OBJECT_ID,
  object_type: "bubble",
  distance_pc: 35.1,
});
// Real 2026-08-22 `scene.json` values (see `camera.ts`'s docstring).
const PROXIMA = makeObject({ id: "proxima", distance_pc: 1.3019705975979945 });
const ALPHA_CEN_A = makeObject({ id: "alf-cen-a", distance_pc: 1.3474909718104888 });
const FAR_STAR = makeObject({ id: "far-star", distance_pc: 95 });

describe("deriveMinZoomDistancePc", () => {
  it("is the nearest non-Sun, non-dedicated-marker object's distance plus the Sun core's min radius margin", () => {
    const result = deriveMinZoomDistancePc([SUN, LOCAL_BUBBLE, PROXIMA, ALPHA_CEN_A, FAR_STAR]);
    expect(result).toBeCloseTo(PROXIMA.distance_pc + SUN_CORE_MIN_RADIUS_PC, 10);
  });

  it("ignores the Sun's own (0pc) distance - otherwise the floor would collapse to ~0", () => {
    const result = deriveMinZoomDistancePc([SUN, FAR_STAR]);
    expect(result).toBeCloseTo(FAR_STAR.distance_pc + SUN_CORE_MIN_RADIUS_PC, 10);
  });

  it("ignores the Local Bubble centroid the same way the generic catalog render loop does", () => {
    const withoutBubble = deriveMinZoomDistancePc([SUN, PROXIMA]);
    const withBubble = deriveMinZoomDistancePc([SUN, LOCAL_BUBBLE, PROXIMA]);
    expect(withBubble).toBe(withoutBubble);
  });

  it("sits comfortably above the camera's own near clipping plane (0.1pc, camera.ts)", () => {
    const result = deriveMinZoomDistancePc([SUN, PROXIMA, ALPHA_CEN_A]);
    expect(result).toBeGreaterThan(0.1);
  });

  it("stays strictly above the nearest star's own distance (no clipping into that star's marker)", () => {
    const result = deriveMinZoomDistancePc([SUN, PROXIMA, ALPHA_CEN_A]);
    expect(result).toBeGreaterThan(PROXIMA.distance_pc);
  });

  it("falls back to the pre-#134 default (5pc) if there are no non-dedicated-marker objects at all", () => {
    expect(deriveMinZoomDistancePc([SUN, LOCAL_BUBBLE])).toBe(5);
    expect(deriveMinZoomDistancePc([])).toBe(5);
  });
});

/**
 * Issue #197: pure dolly-distance clamping for the bottom-left toolbar's
 * Zoom In (+) / Zoom Out (-) buttons - the "does it respect minDistance/
 * maxDistance the same way scroll-wheel zoom already does" acceptance
 * criterion, tested here without a live WebGL context/OrbitControls
 * instance (spec §38), same style as `deriveMinZoomDistancePc` above.
 */
describe("dollyPosition", () => {
  it("moves the camera closer to the target for a factor below 1 (zoom in)", () => {
    const result = dollyPosition([100, 0, 0], [0, 0, 0], 0.8, 1, 1000);
    expect(result).toEqual([80, 0, 0]);
  });

  it("moves the camera further from the target for a factor above 1 (zoom out)", () => {
    const result = dollyPosition([100, 0, 0], [0, 0, 0], 1.25, 1, 1000);
    expect(result).toEqual([125, 0, 0]);
  });

  it("clamps zooming in past minDistance", () => {
    const result = dollyPosition([10, 0, 0], [0, 0, 0], 0.1, 5, 1000);
    // Unclamped would be distance 1 - clamped to the 5pc floor instead.
    expect(result).toEqual([5, 0, 0]);
  });

  it("clamps zooming out past maxDistance", () => {
    const result = dollyPosition([100, 0, 0], [0, 0, 0], 50, 1, 1000);
    // Unclamped would be distance 5000 - clamped to the 1000pc ceiling instead.
    expect(result).toEqual([1000, 0, 0]);
  });

  it("preserves direction and works around an arbitrary (non-origin) target", () => {
    const result = dollyPosition([110, 20, 5], [10, 20, 5], 0.5, 1, 1000);
    // Original offset from target was [100, 0, 0]; halving distance halves
    // that offset while target stays fixed.
    expect(result[0]).toBeCloseTo(60, 9);
    expect(result[1]).toBeCloseTo(20, 9);
    expect(result[2]).toBeCloseTo(5, 9);
  });

  it("is a no-op when the camera is already exactly at the target (degenerate, no direction)", () => {
    const result = dollyPosition([5, 5, 5], [5, 5, 5], 0.8, 1, 1000);
    expect(result).toEqual([5, 5, 5]);
  });

  it("round-trips (approximately) when zooming in then out by reciprocal factors", () => {
    const zoomedIn = dollyPosition([200, 0, 0], [0, 0, 0], 0.8, 1, 1000);
    const backOut = dollyPosition(zoomedIn, [0, 0, 0], 1 / 0.8, 1, 1000);
    expect(backOut[0]).toBeCloseTo(200, 9);
  });
});
