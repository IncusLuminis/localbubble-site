import { describe, expect, it } from "vitest";
import {
  createSunMarker,
  SUN_CORE_MAX_RADIUS_PC,
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
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * SUN_CORE_SHRINK_START_MULTIPLIER;
    expect(sunCoreRadiusPc(shrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(sunCoreRadiusPc(shrinkStartPc + 1000, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("is the min (point-like) radius once the camera is at the dense batch's own collection radius", () => {
    expect(sunCoreRadiusPc(REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      SUN_CORE_MIN_RADIUS_PC,
    );
  });

  it("is the min radius for any distance inside the dense batch's own collection radius", () => {
    expect(sunCoreRadiusPc(1.3, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_MIN_RADIUS_PC);
    expect(sunCoreRadiusPc(0, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_MIN_RADIUS_PC);
  });

  it("stays comfortably smaller than Proxima Centauri's own distance/marker once inside the LOD volume", () => {
    // Proxima is 1.3pc from the Sun (`lod.test.ts`'s DENSE_MEMBER); the
    // core's min radius must not overlap/dominate it (issue #113's
    // acceptance criteria) - well under both that distance and
    // `objects.ts`'s STAR_MARKER_RADIUS_PC (2pc).
    const radius = sunCoreRadiusPc(1.3, REALISTIC_DENSE_BATCH_RADIUS_PC);
    expect(radius).toBeLessThan(1.3);
    expect(radius).toBeGreaterThan(0);
  });

  it("interpolates continuously and monotonically between the shrink-start threshold and the collection radius", () => {
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * SUN_CORE_SHRINK_START_MULTIPLIER;
    const midpointPc = (shrinkStartPc + REALISTIC_DENSE_BATCH_RADIUS_PC) / 2;

    const atStart = sunCoreRadiusPc(shrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC);
    const atMidpoint = sunCoreRadiusPc(midpointPc, REALISTIC_DENSE_BATCH_RADIUS_PC);
    const atFloor = sunCoreRadiusPc(REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC);

    expect(atStart).toBe(SUN_CORE_MAX_RADIUS_PC);
    expect(atFloor).toBe(SUN_CORE_MIN_RADIUS_PC);
    // Strictly between the two clamped bounds, roughly at the linear
    // midpoint - not asserting an exact formula here so the test doesn't
    // just re-implement the function, only that it's continuous/monotonic.
    expect(atMidpoint).toBeLessThan(atStart);
    expect(atMidpoint).toBeGreaterThan(atFloor);
    expect(atMidpoint).toBeCloseTo((SUN_CORE_MAX_RADIUS_PC + SUN_CORE_MIN_RADIUS_PC) / 2, 5);

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
