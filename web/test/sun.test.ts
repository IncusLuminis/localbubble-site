import { describe, expect, it } from "vitest";
import {
  createSunMarker,
  SUN_CORE_FLOOR_RADIUS_PC,
  SUN_CORE_MAX_RADIUS_PC,
  SUN_CORE_MID_RADIUS_PC,
  SUN_CORE_MIN_RADIUS_PC,
  SUN_CORE_SHRINK_START_MULTIPLIER,
  sunCoreRadiusPc,
} from "../src/scene/sun";

/**
 * Issue #113: the Sun core's camera-distance-dependent radius. Before this
 * issue, `scene/sun.ts`'s core was a fixed 3pc-radius sphere - larger than
 * the RECONS batch's nearest star, Proxima Centauri, at 1.3pc from the Sun,
 * so at solar-neighborhood zoom the Sun read as an oversized bubble rather
 * than "the Sun". Mirrors `lod.test.ts`/`labels.test.ts`'s style for
 * testing a pure camera-distance-driven function: boundary values at both
 * clamped ends, plus the interpolated region in between.
 *
 * Issue #136: pre-#136, the curve was two-segment - flat max beyond
 * `3 * denseBatchRadiusPc`, linear down to `SUN_CORE_MIN_RADIUS_PC` at
 * `denseBatchRadiusPc`, then flat at that floor for anything closer. That
 * left the Sun frozen at 0.15pc for the entire (and largest, ~8x) remaining
 * zoom range down to #134's real camera zoom floor. #136 extends the curve
 * with a third segment continuing the shrink from that same point down to
 * a new, smaller `SUN_CORE_FLOOR_RADIUS_PC` at `minZoomDistancePc` - the
 * tests below cover both the (unchanged) outer two segments and the new
 * third one, plus the seam between segments 2 and 3 at `denseBatchRadiusPc`
 * itself.
 */

// The actual RECONS dense-batch collection radius is ~11.26pc
// (`lod.test.ts`'s `DENSE_MEMBER_FAR`) - used here as a realistic
// `denseBatchRadiusPc` rather than a round number, so these tests exercise
// the same values `main.ts` would see at runtime.
const REALISTIC_DENSE_BATCH_RADIUS_PC = 11.26;

// #134's real data-derived close-zoom floor against the current catalog
// (Proxima Centauri's 1.3019705975979945pc + SUN_CORE_MIN_RADIUS_PC's
// 0.15pc margin, per `camera.ts`'s `deriveMinZoomDistancePc`/PR #135) -
// used here, again, so these tests exercise the same value `main.ts` would
// see at runtime via `controls.minDistance`.
const REALISTIC_MIN_ZOOM_DISTANCE_PC = 1.452;

describe("sunCoreRadiusPc", () => {
  it("is the max radius at the default ~1087pc 'Perspective' camera distance", () => {
    expect(
      sunCoreRadiusPc(1087, REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_MIN_ZOOM_DISTANCE_PC),
    ).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("is the max radius at the ~800pc overview radius-filter preset", () => {
    expect(
      sunCoreRadiusPc(800, REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_MIN_ZOOM_DISTANCE_PC),
    ).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("is the max radius at any distance at or beyond the shrink-start threshold", () => {
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * SUN_CORE_SHRINK_START_MULTIPLIER;
    expect(
      sunCoreRadiusPc(shrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_MIN_ZOOM_DISTANCE_PC),
    ).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(
      sunCoreRadiusPc(
        shrinkStartPc + 1000,
        REALISTIC_DENSE_BATCH_RADIUS_PC,
        REALISTIC_MIN_ZOOM_DISTANCE_PC,
      ),
    ).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("is the mid radius (SUN_CORE_MID_RADIUS_PC) exactly at the dense batch's own collection radius - unchanged seam from pre-#136", () => {
    expect(
      sunCoreRadiusPc(
        REALISTIC_DENSE_BATCH_RADIUS_PC,
        REALISTIC_DENSE_BATCH_RADIUS_PC,
        REALISTIC_MIN_ZOOM_DISTANCE_PC,
      ),
    ).toBe(SUN_CORE_MID_RADIUS_PC);
  });

  it("interpolates continuously and monotonically between the shrink-start threshold and the collection radius (segment 2, unchanged by #136)", () => {
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * SUN_CORE_SHRINK_START_MULTIPLIER;
    const midpointPc = (shrinkStartPc + REALISTIC_DENSE_BATCH_RADIUS_PC) / 2;

    const atStart = sunCoreRadiusPc(
      shrinkStartPc,
      REALISTIC_DENSE_BATCH_RADIUS_PC,
      REALISTIC_MIN_ZOOM_DISTANCE_PC,
    );
    const atMidpoint = sunCoreRadiusPc(
      midpointPc,
      REALISTIC_DENSE_BATCH_RADIUS_PC,
      REALISTIC_MIN_ZOOM_DISTANCE_PC,
    );
    const atBoundary = sunCoreRadiusPc(
      REALISTIC_DENSE_BATCH_RADIUS_PC,
      REALISTIC_DENSE_BATCH_RADIUS_PC,
      REALISTIC_MIN_ZOOM_DISTANCE_PC,
    );

    expect(atStart).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(atBoundary).toBe(SUN_CORE_MID_RADIUS_PC);
    // Strictly between the two clamped bounds, roughly at the linear
    // midpoint - not asserting an exact formula here so the test doesn't
    // just re-implement the function, only that it's continuous/monotonic.
    expect(atMidpoint).toBeLessThan(atStart);
    expect(atMidpoint).toBeGreaterThan(atBoundary);
    expect(atMidpoint).toBeCloseTo((SUN_CORE_MAX_RADIUS_PC + SUN_CORE_MID_RADIUS_PC) / 2, 5);

    // Sample a denser sweep to check monotonicity holds throughout the
    // interpolated region, not just at one midpoint.
    const samples = Array.from({ length: 11 }, (_, i) =>
      sunCoreRadiusPc(
        REALISTIC_DENSE_BATCH_RADIUS_PC + (i / 10) * (shrinkStartPc - REALISTIC_DENSE_BATCH_RADIUS_PC),
        REALISTIC_DENSE_BATCH_RADIUS_PC,
        REALISTIC_MIN_ZOOM_DISTANCE_PC,
      ),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it("issue #136: continues shrinking (rather than freezing) between the collection radius and the real minimum zoom distance", () => {
    const insideThePc = (REALISTIC_DENSE_BATCH_RADIUS_PC + REALISTIC_MIN_ZOOM_DISTANCE_PC) / 2;
    const radius = sunCoreRadiusPc(
      insideThePc,
      REALISTIC_DENSE_BATCH_RADIUS_PC,
      REALISTIC_MIN_ZOOM_DISTANCE_PC,
    );
    // Pre-#136 this would have been clamped flat at SUN_CORE_MID_RADIUS_PC
    // (0.15pc) - the whole point of #136 is that it no longer is.
    expect(radius).toBeLessThan(SUN_CORE_MID_RADIUS_PC);
    expect(radius).toBeGreaterThan(SUN_CORE_FLOOR_RADIUS_PC);
  });

  it("issue #136: is the new floor radius (SUN_CORE_FLOOR_RADIUS_PC) exactly at the real minimum zoom distance", () => {
    expect(
      sunCoreRadiusPc(
        REALISTIC_MIN_ZOOM_DISTANCE_PC,
        REALISTIC_DENSE_BATCH_RADIUS_PC,
        REALISTIC_MIN_ZOOM_DISTANCE_PC,
      ),
    ).toBe(SUN_CORE_FLOOR_RADIUS_PC);
  });

  it("issue #136: clamps to the floor radius for any distance inside the real minimum zoom distance", () => {
    expect(
      sunCoreRadiusPc(1, REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_MIN_ZOOM_DISTANCE_PC),
    ).toBe(SUN_CORE_FLOOR_RADIUS_PC);
    expect(
      sunCoreRadiusPc(0, REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_MIN_ZOOM_DISTANCE_PC),
    ).toBe(SUN_CORE_FLOOR_RADIUS_PC);
  });

  it("issue #136: interpolates continuously and monotonically between the collection radius and the real minimum zoom distance (segment 3)", () => {
    const samples = Array.from({ length: 11 }, (_, i) =>
      sunCoreRadiusPc(
        REALISTIC_MIN_ZOOM_DISTANCE_PC +
          (i / 10) * (REALISTIC_DENSE_BATCH_RADIUS_PC - REALISTIC_MIN_ZOOM_DISTANCE_PC),
        REALISTIC_DENSE_BATCH_RADIUS_PC,
        REALISTIC_MIN_ZOOM_DISTANCE_PC,
      ),
    );
    expect(samples[0]).toBe(SUN_CORE_FLOOR_RADIUS_PC);
    expect(samples[samples.length - 1]).toBe(SUN_CORE_MID_RADIUS_PC);
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it("issue #136: the new floor is smaller than the old (now mid-curve) radius, and larger than a star marker's own floor", () => {
    // Acceptance criteria: the new floor must be strictly smaller than the
    // pre-#136 "premature" floor (SUN_CORE_MID_RADIUS_PC/SUN_CORE_MIN_RADIUS_PC,
    // 0.15pc) - the whole point is that the shrink continues past it - while
    // staying a bit larger than objects.ts's STAR_MARKER_MIN_RADIUS_PC
    // (0.02pc) so the Sun still reads as a distinct, prominent object even
    // at max zoom rather than shrinking to the same point-size as a star.
    expect(SUN_CORE_FLOOR_RADIUS_PC).toBeLessThan(SUN_CORE_MID_RADIUS_PC);
    expect(SUN_CORE_FLOOR_RADIUS_PC).toBeGreaterThan(0.02);
  });

  it("stays comfortably smaller than Proxima Centauri's own distance/marker once inside the LOD volume", () => {
    // Proxima is 1.3pc from the Sun (`lod.test.ts`'s DENSE_MEMBER); the
    // core's radius must not overlap/dominate it (issue #113's acceptance
    // criteria) - well under both that distance and `objects.ts`'s
    // STAR_MARKER_RADIUS_PC (2pc), throughout the whole shrunk range
    // including #136's extended inner segment.
    const atOldFloor = sunCoreRadiusPc(
      1.3,
      REALISTIC_DENSE_BATCH_RADIUS_PC,
      REALISTIC_MIN_ZOOM_DISTANCE_PC,
    );
    expect(atOldFloor).toBeLessThan(1.3);
    expect(atOldFloor).toBeGreaterThan(0);

    const atNewFloor = sunCoreRadiusPc(
      REALISTIC_MIN_ZOOM_DISTANCE_PC,
      REALISTIC_DENSE_BATCH_RADIUS_PC,
      REALISTIC_MIN_ZOOM_DISTANCE_PC,
    );
    expect(atNewFloor).toBeLessThan(1.3);
    expect(atNewFloor).toBeGreaterThan(0);
  });

  it("stays at the max radius regardless of camera distance when denseBatchRadiusPc is 0 (not loaded yet)", () => {
    expect(sunCoreRadiusPc(0, 0, REALISTIC_MIN_ZOOM_DISTANCE_PC)).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(sunCoreRadiusPc(1087, 0, REALISTIC_MIN_ZOOM_DISTANCE_PC)).toBe(SUN_CORE_MAX_RADIUS_PC);
    // minZoomDistancePc is irrelevant/unused in this "not loaded yet" state -
    // still the overview max even if it were somehow 0 too.
    expect(sunCoreRadiusPc(0, 0, 0)).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("issue #136: defensively handles a degenerate minZoomDistancePc at or beyond denseBatchRadiusPc without throwing or returning NaN", () => {
    // Shouldn't happen with real catalog data (#134's derivation always adds
    // a margin to a real nearest-object distance well inside the dense
    // batch's own radius) but the function should stay total rather than
    // dividing by zero.
    const radius = sunCoreRadiusPc(5, REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC);
    expect(Number.isFinite(radius)).toBe(true);
    expect(radius).toBeGreaterThanOrEqual(SUN_CORE_FLOOR_RADIUS_PC);
    expect(radius).toBeLessThanOrEqual(SUN_CORE_MID_RADIUS_PC);
  });
});

describe("createSunMarker", () => {
  it("returns a group named 'sun' containing both the core and halo meshes, plus a direct core reference", () => {
    const { group, core } = createSunMarker();
    expect(group.name).toBe("sun");
    expect(group.children).toContain(core);
    expect(group.children.length).toBe(2);
  });

  it("initializes the core at the max radius (matching pre-#113 overview appearance)", () => {
    const { core } = createSunMarker();
    expect(core.scale.x).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(core.scale.y).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(core.scale.z).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("is positioned at the coordinate origin", () => {
    const { group } = createSunMarker();
    expect(group.position.x).toBe(0);
    expect(group.position.y).toBe(0);
    expect(group.position.z).toBe(0);
  });
});

describe("SUN_CORE_MIN_RADIUS_PC (issue #136 backward-compat alias)", () => {
  it("still equals SUN_CORE_MID_RADIUS_PC, so camera.ts's existing MIN_ZOOM_MARGIN_PC derivation (issue #134) is unaffected by #136", () => {
    expect(SUN_CORE_MIN_RADIUS_PC).toBe(SUN_CORE_MID_RADIUS_PC);
  });
});
