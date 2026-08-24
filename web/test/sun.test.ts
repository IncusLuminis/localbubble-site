import { describe, expect, it } from "vitest";
import {
  createSunMarker,
  SUN_CORE_FLOOR_RADIUS_PC,
  SUN_CORE_MAX_RADIUS_PC,
  sunCoreRadiusPc,
} from "../src/scene/sun";
import {
  STAR_MARKER_MIN_RADIUS_PC,
  STAR_MARKER_RADIUS_PC,
  STAR_MARKER_SHRINK_START_MULTIPLIER,
  starMarkerRadiusPc,
} from "../src/scene/starMarkerScale";

/**
 * Issue #113: the Sun core's camera-distance-dependent radius. Before this
 * issue, `scene/sun.ts`'s core was a fixed 3pc-radius sphere - larger than
 * the RECONS batch's nearest star, Proxima Centauri, at 1.3pc from the Sun,
 * so at solar-neighborhood zoom the Sun read as an oversized bubble rather
 * than "the Sun". Mirrors `lod.test.ts`/`labels.test.ts`'s style for
 * testing a pure camera-distance-driven function: boundary values at both
 * clamped ends, plus the interpolated region in between.
 *
 * Issue #136 (now reverted by #217's scope expansion): added a third,
 * Sun-only breakpoint ("MID") so the core kept shrinking past the RECONS
 * boundary down to a smaller floor at the camera's real `minDistance`,
 * rather than freezing at the boundary. The Validator reviewing PR #218
 * (issue #217's original, narrower fix - recalibrating only the three
 * magnitude constants, not the curve shape) found that this extra
 * breakpoint meant the Sun's curve disagreed in SHAPE with
 * `starMarkerScale.ts`'s `starMarkerRadiusPc`, producing a 4x-25x size
 * mismatch between the RECONS boundary and the shared shrink-start
 * threshold - reproducible via the "Fit to Nearest-Stars Sphere" preset
 * (~36pc) and nearly reproducing the pre-#113 bug this whole feature area
 * exists to fix. The human owner decided #136's original rationale (keep
 * the Sun deliberately more prominent than a star at max zoom) is obsolete:
 * the Sun should never stand out from its surroundings at any zoom level.
 *
 * `sunCoreRadiusPc` is now a thin wrapper around `starMarkerRadiusPc`
 * itself (see `sun.ts`'s docstring) - the tests below both cover
 * `sunCoreRadiusPc`'s own two-segment curve directly AND assert it's
 * byte-for-byte identical to `starMarkerRadiusPc`'s output for the Sun's
 * own ceiling, since that equivalence (not just equal endpoint constants)
 * is the actual fix.
 */

// The actual RECONS dense-batch collection radius is ~11.26pc
// (`lod.test.ts`'s `DENSE_MEMBER_FAR`) - used here as a realistic
// `denseBatchRadiusPc` rather than a round number, so these tests exercise
// the same values `main.ts` would see at runtime.
const REALISTIC_DENSE_BATCH_RADIUS_PC = 11.26;

describe("sunCoreRadiusPc", () => {
  it("is the max radius at the default ~1087pc 'Perspective' camera distance", () => {
    expect(sunCoreRadiusPc(1087, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("is the max radius at the ~800pc overview radius-filter preset", () => {
    expect(sunCoreRadiusPc(800, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("is the max radius at any distance at or beyond the shrink-start threshold", () => {
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * STAR_MARKER_SHRINK_START_MULTIPLIER;
    expect(sunCoreRadiusPc(shrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(sunCoreRadiusPc(shrinkStartPc + 1000, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      SUN_CORE_MAX_RADIUS_PC,
    );
  });

  it("is the floor radius (SUN_CORE_FLOOR_RADIUS_PC) exactly at the dense batch's own collection radius", () => {
    expect(sunCoreRadiusPc(REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      SUN_CORE_FLOOR_RADIUS_PC,
    );
  });

  it("interpolates continuously and monotonically between the shrink-start threshold and the collection radius", () => {
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * STAR_MARKER_SHRINK_START_MULTIPLIER;
    const midpointPc = (shrinkStartPc + REALISTIC_DENSE_BATCH_RADIUS_PC) / 2;

    const atStart = sunCoreRadiusPc(shrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC);
    const atMidpoint = sunCoreRadiusPc(midpointPc, REALISTIC_DENSE_BATCH_RADIUS_PC);
    const atBoundary = sunCoreRadiusPc(REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC);

    expect(atStart).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(atBoundary).toBe(SUN_CORE_FLOOR_RADIUS_PC);
    // Strictly between the two clamped bounds, roughly at the linear
    // midpoint - not asserting an exact formula here so the test doesn't
    // just re-implement the function, only that it's continuous/monotonic.
    expect(atMidpoint).toBeLessThan(atStart);
    expect(atMidpoint).toBeGreaterThan(atBoundary);
    expect(atMidpoint).toBeCloseTo((SUN_CORE_MAX_RADIUS_PC + SUN_CORE_FLOOR_RADIUS_PC) / 2, 5);

    // Sample a denser sweep to check monotonicity holds throughout the
    // interpolated region, not just at one midpoint.
    const samples = Array.from({ length: 11 }, (_, i) =>
      sunCoreRadiusPc(
        REALISTIC_DENSE_BATCH_RADIUS_PC + (i / 10) * (shrinkStartPc - REALISTIC_DENSE_BATCH_RADIUS_PC),
        REALISTIC_DENSE_BATCH_RADIUS_PC,
      ),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it("clamps to the floor radius for any distance at or inside the dense batch's own collection radius - issue #217, no longer keeps shrinking past it", () => {
    // Pre-#217 (issue #136), this range would have continued shrinking past
    // SUN_CORE_MID_RADIUS_PC toward a separate, smaller floor at the
    // camera's real minDistance. #217 removes that third segment entirely -
    // the curve is now flat at the single floor for the whole inside-the-
    // boundary range, exactly like starMarkerRadiusPc.
    expect(sunCoreRadiusPc(5, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_FLOOR_RADIUS_PC);
    expect(sunCoreRadiusPc(1.3, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_FLOOR_RADIUS_PC);
    expect(sunCoreRadiusPc(1, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_FLOOR_RADIUS_PC);
    expect(sunCoreRadiusPc(0, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_FLOOR_RADIUS_PC);
  });

  it("issue #217: the two tiers directly reuse the star baseline scale's ceiling/floor constants", () => {
    // Recalibrated (issue #217's original scope) to track objects.ts's #215
    // star baseline scale exactly (via the shared, dependency-free
    // starMarkerScale.ts, to avoid a module cycle - see that module's
    // docstring) rather than a separately-tuned pair that can drift out of
    // sync with it again. The "MID" tier (#136) no longer exists - see the
    // module-level docstring above for why.
    expect(SUN_CORE_MAX_RADIUS_PC).toBe(STAR_MARKER_RADIUS_PC);
    expect(SUN_CORE_FLOOR_RADIUS_PC).toBe(STAR_MARKER_MIN_RADIUS_PC);
  });

  it("issue #217: matches starMarkerRadiusPc's own output exactly at every sampled camera distance - the whole point of the fix", () => {
    // Not just equal endpoint constants - the same function call, so the two
    // curves are mathematically incapable of disagreeing about shape.
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * STAR_MARKER_SHRINK_START_MULTIPLIER;
    const samplePc = [
      0,
      1,
      1.3, // Proxima Centauri's real distance.
      REALISTIC_DENSE_BATCH_RADIUS_PC, // The RECONS boundary itself.
      REALISTIC_DENSE_BATCH_RADIUS_PC + 5, // Strictly between the boundary and shrink-start - the exact gap the Validator found.
      (REALISTIC_DENSE_BATCH_RADIUS_PC + shrinkStartPc) / 2,
      shrinkStartPc,
      800,
      1087,
    ];
    for (const cameraDistancePc of samplePc) {
      expect(sunCoreRadiusPc(cameraDistancePc, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
        starMarkerRadiusPc(cameraDistancePc, REALISTIC_DENSE_BATCH_RADIUS_PC, SUN_CORE_MAX_RADIUS_PC),
      );
    }
  });

  it("stays comfortably smaller than Proxima Centauri's own distance/marker once inside the LOD volume", () => {
    // Proxima is 1.3pc from the Sun (`lod.test.ts`'s DENSE_MEMBER); the
    // core's radius must not overlap/dominate it (issue #113's acceptance
    // criteria) - well under both that distance and `STAR_MARKER_RADIUS_PC`
    // (2pc), throughout the whole shrunk range.
    const atFloor = sunCoreRadiusPc(1.3, REALISTIC_DENSE_BATCH_RADIUS_PC);
    expect(atFloor).toBeLessThan(1.3);
    expect(atFloor).toBeGreaterThan(0);
  });

  it("stays at the max radius regardless of camera distance when denseBatchRadiusPc is 0 (not loaded yet)", () => {
    expect(sunCoreRadiusPc(0, 0)).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(sunCoreRadiusPc(1087, 0)).toBe(SUN_CORE_MAX_RADIUS_PC);
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
