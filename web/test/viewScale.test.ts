import { describe, expect, it } from "vitest";
import { currentViewScalePc, VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER } from "../src/scene/viewScale";

const DENSE_BATCH_RADIUS_PC = 11.26;
const BUBBLE_OUTER_RADIUS_PC = 60;

describe("currentViewScalePc", () => {
  describe("segment 1: at or inside denseBatchRadiusPc", () => {
    it("returns exactly denseBatchRadiusPc at the boundary itself", () => {
      expect(currentViewScalePc(DENSE_BATCH_RADIUS_PC, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC)).toBe(
        DENSE_BATCH_RADIUS_PC,
      );
    });

    it("returns exactly denseBatchRadiusPc for any camera distance inside it, including 0", () => {
      expect(currentViewScalePc(0, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC)).toBe(DENSE_BATCH_RADIUS_PC);
      expect(currentViewScalePc(5, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC)).toBe(DENSE_BATCH_RADIUS_PC);
    });
  });

  describe("segment 2: between denseBatchRadiusPc and bubbleOuterRadiusPc", () => {
    it("linearly interpolates, reaching the midpoint value at the midpoint distance", () => {
      const midDistance = (DENSE_BATCH_RADIUS_PC + BUBBLE_OUTER_RADIUS_PC) / 2;
      const result = currentViewScalePc(midDistance, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC);
      expect(result).toBeCloseTo(midDistance, 10);
    });

    it("is continuous with segment 1 at the denseBatchRadiusPc boundary", () => {
      const justInside = currentViewScalePc(
        DENSE_BATCH_RADIUS_PC - 0.0001,
        DENSE_BATCH_RADIUS_PC,
        BUBBLE_OUTER_RADIUS_PC,
      );
      const justOutside = currentViewScalePc(
        DENSE_BATCH_RADIUS_PC + 0.0001,
        DENSE_BATCH_RADIUS_PC,
        BUBBLE_OUTER_RADIUS_PC,
      );
      expect(Math.abs(justOutside - justInside)).toBeLessThan(0.001);
    });

    it("is monotonically non-decreasing across the segment", () => {
      const a = currentViewScalePc(20, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC);
      const b = currentViewScalePc(40, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC);
      const c = currentViewScalePc(55, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC);
      expect(a).toBeLessThan(b);
      expect(b).toBeLessThan(c);
    });
  });

  describe("segment 3: between bubbleOuterRadiusPc and the open-space ceiling", () => {
    it("returns exactly bubbleOuterRadiusPc at that boundary itself", () => {
      expect(currentViewScalePc(BUBBLE_OUTER_RADIUS_PC, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC)).toBe(
        BUBBLE_OUTER_RADIUS_PC,
      );
    });

    it("is continuous with segment 2 at the bubbleOuterRadiusPc boundary", () => {
      const justInside = currentViewScalePc(
        BUBBLE_OUTER_RADIUS_PC - 0.0001,
        DENSE_BATCH_RADIUS_PC,
        BUBBLE_OUTER_RADIUS_PC,
      );
      const justOutside = currentViewScalePc(
        BUBBLE_OUTER_RADIUS_PC + 0.0001,
        DENSE_BATCH_RADIUS_PC,
        BUBBLE_OUTER_RADIUS_PC,
      );
      expect(Math.abs(justOutside - justInside)).toBeLessThan(0.001);
    });

    it("interpolates between bubbleOuterRadiusPc and the ceiling, then holds flat beyond it", () => {
      const ceilingPc = BUBBLE_OUTER_RADIUS_PC * VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER;
      const midDistance = (BUBBLE_OUTER_RADIUS_PC + ceilingPc) / 2;
      const midResult = currentViewScalePc(midDistance, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC);
      expect(midResult).toBeGreaterThan(BUBBLE_OUTER_RADIUS_PC);
      expect(midResult).toBeLessThan(ceilingPc);

      expect(currentViewScalePc(ceilingPc, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC)).toBe(ceilingPc);
      expect(currentViewScalePc(ceilingPc * 10, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC)).toBe(ceilingPc);
    });
  });

  describe("no Local Bubble layer (bubbleOuterRadiusPc null/non-positive)", () => {
    it("degrades to the flat denseBatchRadiusPc for any camera distance when null", () => {
      expect(currentViewScalePc(5, DENSE_BATCH_RADIUS_PC, null)).toBe(DENSE_BATCH_RADIUS_PC);
      expect(currentViewScalePc(500, DENSE_BATCH_RADIUS_PC, null)).toBe(DENSE_BATCH_RADIUS_PC);
    });

    it("degrades to the flat denseBatchRadiusPc when bubbleOuterRadiusPc is <= 0", () => {
      expect(currentViewScalePc(500, DENSE_BATCH_RADIUS_PC, 0)).toBe(DENSE_BATCH_RADIUS_PC);
      expect(currentViewScalePc(500, DENSE_BATCH_RADIUS_PC, -5)).toBe(DENSE_BATCH_RADIUS_PC);
    });

    it("degrades to the flat denseBatchRadiusPc for a non-finite bubbleOuterRadiusPc", () => {
      expect(currentViewScalePc(500, DENSE_BATCH_RADIUS_PC, Number.POSITIVE_INFINITY)).toBe(DENSE_BATCH_RADIUS_PC);
      expect(currentViewScalePc(500, DENSE_BATCH_RADIUS_PC, Number.NaN)).toBe(DENSE_BATCH_RADIUS_PC);
    });

    it("degrades to the flat denseBatchRadiusPc when bubbleOuterRadiusPc is degenerately <= denseBatchRadiusPc", () => {
      expect(currentViewScalePc(500, DENSE_BATCH_RADIUS_PC, DENSE_BATCH_RADIUS_PC - 1)).toBe(DENSE_BATCH_RADIUS_PC);
    });
  });

  describe("scene not loaded yet (denseBatchRadiusPc <= 0)", () => {
    it("returns 0 regardless of camera distance or bubbleOuterRadiusPc", () => {
      expect(currentViewScalePc(500, 0, BUBBLE_OUTER_RADIUS_PC)).toBe(0);
      expect(currentViewScalePc(0, 0, null)).toBe(0);
      expect(currentViewScalePc(500, -1, BUBBLE_OUTER_RADIUS_PC)).toBe(0);
    });
  });

  describe("Story #309: open-space ceiling raised to cover the real catalog's velocity-bearing range", () => {
    /** The farthest star in the shipped catalog that carries `velocity` data
     * (`*  55 Cyg`, ~1839.93pc - Story #307's open-space backfill), checked
     * directly against `public/data/scene.json` 2026-09-03 rather than
     * trusted from the issue text's rounded "~1840pc". Used below to prove
     * the new ceiling comfortably covers every real open-space vector/trail
     * this Story was actually asked to live-verify, not just an arbitrary
     * round number. */
    const REAL_CATALOG_MAX_VELOCITY_STAR_DISTANCE_PC = 1839.9264029438823;

    it("VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER is 40 (raised from the pre-#309 3)", () => {
      // A change to this constant is a live-verified visual tuning decision,
      // not a refactor - pinned here so an incidental future edit doesn't
      // silently drift it without a fresh live-verification pass. See this
      // constant's own docstring in viewScale.ts for the full reasoning.
      expect(VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER).toBe(40);
    });

    it("the real shipped-scene ceiling comfortably exceeds the catalog's farthest velocity-bearing star", () => {
      const ceilingPc = BUBBLE_OUTER_RADIUS_PC * VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER;
      expect(ceilingPc).toBeGreaterThan(REAL_CATALOG_MAX_VELOCITY_STAR_DISTANCE_PC);
      // At least 20% of headroom past today's real max - some margin for the
      // catalog to grow without immediately pinning every farthest star to
      // the flat ceiling again.
      expect(ceilingPc).toBeGreaterThan(REAL_CATALOG_MAX_VELOCITY_STAR_DISTANCE_PC * 1.2);
    });

    it("currentViewScalePc is still GROWING (not yet flattened) at the catalog's farthest real velocity-bearing star", () => {
      const atMaxRealStar = currentViewScalePc(
        REAL_CATALOG_MAX_VELOCITY_STAR_DISTANCE_PC,
        DENSE_BATCH_RADIUS_PC,
        BUBBLE_OUTER_RADIUS_PC,
      );
      const ceilingPc = BUBBLE_OUTER_RADIUS_PC * VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER;
      // Still on the identity (growing) segment, per this module's own
      // "segments 2 and 3 both simplify to y = x" derivation - equal to the
      // camera distance itself, not yet clamped to the flat ceiling.
      expect(atMaxRealStar).toBeCloseTo(REAL_CATALOG_MAX_VELOCITY_STAR_DISTANCE_PC, 6);
      expect(atMaxRealStar).toBeLessThan(ceilingPc);
    });

    it("the pre-#309 ceiling (3x, ~180pc) would have already been flat at the default Perspective camera pose (~1087pc) - the regression this Story fixes", () => {
      const DEFAULT_PERSPECTIVE_DISTANCE_PC = Math.sqrt(700 * 700 + 700 * 700 + 450 * 450); // cameraPresets.ts's perspectivePose()
      const oldCeilingPc = BUBBLE_OUTER_RADIUS_PC * 3;
      expect(DEFAULT_PERSPECTIVE_DISTANCE_PC).toBeGreaterThan(oldCeilingPc);

      // Under the NEW ceiling, that same default pose is still comfortably
      // on the growing segment.
      const newCeilingPc = BUBBLE_OUTER_RADIUS_PC * VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER;
      expect(DEFAULT_PERSPECTIVE_DISTANCE_PC).toBeLessThan(newCeilingPc);
      expect(
        currentViewScalePc(DEFAULT_PERSPECTIVE_DISTANCE_PC, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC),
      ).toBeCloseTo(DEFAULT_PERSPECTIVE_DISTANCE_PC, 6);
    });
  });

  describe("overall continuity/monotonicity across a wide sweep", () => {
    it("never decreases and never jumps by more than the local step size", () => {
      const step = 0.5;
      let previous = currentViewScalePc(0, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC);
      // Story #309: swept out to 3000pc (was 400pc) - past the new ~2400pc
      // ceiling (BUBBLE_OUTER_RADIUS_PC * VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER),
      // so this continuity/monotonicity check actually exercises the
      // now-much-longer growing segment and its flattening beyond the new
      // ceiling, not just the old ~180pc range.
      for (let d = step; d <= 3000; d += step) {
        const current = currentViewScalePc(d, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC);
        expect(current).toBeGreaterThanOrEqual(previous - 1e-9);
        // Slope is bounded by 1 (segment 2/3 are sub-unity or unity-ish
        // interpolations of a range wider than the step), so no single step
        // should move the result by more than the step itself (plus slack).
        expect(current - previous).toBeLessThanOrEqual(step + 1e-9);
        previous = current;
      }
    });
  });
});
