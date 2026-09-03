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

  describe("overall continuity/monotonicity across a wide sweep", () => {
    it("never decreases and never jumps by more than the local step size", () => {
      const step = 0.5;
      let previous = currentViewScalePc(0, DENSE_BATCH_RADIUS_PC, BUBBLE_OUTER_RADIUS_PC);
      for (let d = step; d <= 400; d += step) {
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
