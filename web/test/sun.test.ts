import { describe, expect, it } from "vitest";
import {
  createSunMarker,
  SUN_BUBBLE_VIEW_OUTER_RADIUS_PC,
  SUN_CORE_FLOOR_RADIUS_PC,
  SUN_CORE_MAX_RADIUS_PC,
  sunCoreRadiusPc,
} from "../src/scene/sun";
import {
  STAR_MARKER_MIN_RADIUS_PC,
  STAR_MARKER_NEAR_SUN_RADIUS_PC,
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
 *
 * Issue #219 adds a further, camera-driven taper stage between the RECONS
 * shrink-start threshold and `SUN_BUBBLE_VIEW_OUTER_RADIUS_PC` (see
 * `sun.ts`'s `sunCoreRadiusPc` docstring for the full rationale and the
 * live-verified "Fit to Local Bubble" camera distance that motivated it).
 * That means several assertions below that used to hold for "any distance
 * at or beyond the shrink-start threshold" now only hold at or beyond the
 * NEW, farther-out `SUN_BUBBLE_VIEW_OUTER_RADIUS_PC` bound - updated
 * in place, with the old shrink-start-relative behavior re-tested as the
 * new taper's own inner endpoint instead of the old flat ceiling.
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

  it("is the max radius at any distance at or beyond SUN_BUBBLE_VIEW_OUTER_RADIUS_PC (issue #219)", () => {
    // Pre-#219, this held at or beyond the much closer shrink-start
    // threshold (~34pc for this realistic radius) - see the "Local Bubble
    // taper stage" describe block below for that now-tapered range.
    expect(sunCoreRadiusPc(SUN_BUBBLE_VIEW_OUTER_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      SUN_CORE_MAX_RADIUS_PC,
    );
    expect(
      sunCoreRadiusPc(SUN_BUBBLE_VIEW_OUTER_RADIUS_PC + 1000, REALISTIC_DENSE_BATCH_RADIUS_PC),
    ).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("is the floor radius (SUN_CORE_FLOOR_RADIUS_PC) exactly at the dense batch's own collection radius", () => {
    expect(sunCoreRadiusPc(REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      SUN_CORE_FLOOR_RADIUS_PC,
    );
  });

  it("interpolates continuously and monotonically between the shrink-start threshold and the collection radius, now capped at the near-Sun floor (issue #219)", () => {
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * STAR_MARKER_SHRINK_START_MULTIPLIER;
    const midpointPc = (shrinkStartPc + REALISTIC_DENSE_BATCH_RADIUS_PC) / 2;

    const atStart = sunCoreRadiusPc(shrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC);
    const atMidpoint = sunCoreRadiusPc(midpointPc, REALISTIC_DENSE_BATCH_RADIUS_PC);
    const atBoundary = sunCoreRadiusPc(REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC);

    // Pre-#219, `atStart` was `SUN_CORE_MAX_RADIUS_PC` (2pc) - #219's new
    // taper stage (see below) now makes the ceiling fed into this same
    // close-in shrink `STAR_MARKER_NEAR_SUN_RADIUS_PC` (0.5pc) by the time
    // the camera reaches the shrink-start threshold, continuous with that
    // new stage's own inner endpoint.
    expect(atStart).toBe(STAR_MARKER_NEAR_SUN_RADIUS_PC);
    expect(atBoundary).toBe(SUN_CORE_FLOOR_RADIUS_PC);
    // Strictly between the two clamped bounds, roughly at the linear
    // midpoint - not asserting an exact formula here so the test doesn't
    // just re-implement the function, only that it's continuous/monotonic.
    expect(atMidpoint).toBeLessThan(atStart);
    expect(atMidpoint).toBeGreaterThan(atBoundary);
    expect(atMidpoint).toBeCloseTo((STAR_MARKER_NEAR_SUN_RADIUS_PC + SUN_CORE_FLOOR_RADIUS_PC) / 2, 5);

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

  it("issue #217: matches starMarkerRadiusPc's own output exactly at every sampled camera distance at/inside the RECONS boundary or at/beyond the open-space bound - the confirmed-correct zones this issue must not disturb", () => {
    // Not just equal endpoint constants - the same function call (with the
    // Sun's own flat ceiling), so the two curves are mathematically
    // incapable of disagreeing about shape in these two zones. Issue #219
    // narrows this sample set to only the confirmed-correct
    // open-space/far-overview and at/inside-RECONS-boundary zones - values
    // strictly between the shrink-start threshold and
    // `SUN_BUBBLE_VIEW_OUTER_RADIUS_PC` are now DELIBERATELY smaller than
    // `starMarkerRadiusPc(., ., SUN_CORE_MAX_RADIUS_PC)` would give, per the
    // new Local Bubble taper stage tested in its own describe block below.
    const samplePc = [
      0,
      1,
      1.3, // Proxima Centauri's real distance.
      REALISTIC_DENSE_BATCH_RADIUS_PC, // The RECONS boundary itself.
      SUN_BUBBLE_VIEW_OUTER_RADIUS_PC,
      SUN_BUBBLE_VIEW_OUTER_RADIUS_PC + 200,
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

/**
 * Issue #219: the Sun's marker read too large next to graduated bubble-area
 * stars specifically when the camera was positioned to view the Local
 * Bubble (e.g. via "Fit to Local Bubble") - #215 already made a STAR's own
 * baseline ceiling taper down (independent of camera zoom) across that same
 * region, but the Sun's ceiling stayed flat at `SUN_CORE_MAX_RADIUS_PC`
 * until the camera got much closer (the old shrink-start threshold, only
 * ~34pc for a realistic RECONS radius - much nearer than where "Fit to
 * Local Bubble" actually frames the camera).
 *
 * Fix: `sunCoreRadiusPc` now derives its ceiling from
 * `starMarkerScale.ts`'s `starBaselineRadiusPc` - the exact same
 * interpolation shape issue #215 already established for stars - fed the
 * CAMERA's distance from the origin (in place of a star's own real
 * distance, since the Sun's real distance from itself is always 0), bounded
 * by the RECONS shrink-start threshold (inner) and
 * `SUN_BUBBLE_VIEW_OUTER_RADIUS_PC` (outer, see that constant's own
 * docstring for why 800pc rather than the star tier's own
 * `bubbleOuterRadiusPc`, ~60pc, was chosen after live verification).
 *
 * Live verification (issue #219, against the shipped scene's real Local
 * Bubble data): the "Fit to Local Bubble" toolbar button lands the camera
 * at a real distance of ~317.7pc from the origin (not the ~500pc a naive
 * `fitSpherePose` calculation alone would suggest, due to #201/#205's extra
 * zoom-in-step padding) - `REALISTIC_FIT_LOCAL_BUBBLE_CAMERA_DISTANCE_PC`
 * below reuses that exact observed value so this test exercises the same
 * scenario the human owner will actually see, not an arbitrary sample.
 */
describe("sunCoreRadiusPc - Local Bubble camera-driven taper stage (issue #219)", () => {
  const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * STAR_MARKER_SHRINK_START_MULTIPLIER;

  // The real camera distance (pc) "Fit to Local Bubble" lands at for the
  // shipped scene's actual Local Bubble structure - verified live in the
  // running dev build (`camera.position.length()` immediately after
  // clicking the button), not assumed from `fitSpherePose`'s raw math.
  const REALISTIC_FIT_LOCAL_BUBBLE_CAMERA_DISTANCE_PC = 317.7;

  it("is unaffected (stays at the max radius) at the confirmed-correct open-space/far-overview distances", () => {
    expect(sunCoreRadiusPc(SUN_BUBBLE_VIEW_OUTER_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      SUN_CORE_MAX_RADIUS_PC,
    );
    expect(sunCoreRadiusPc(1087, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("is unaffected (stays at the shared floor) at the confirmed-correct nearest-stars-sphere distances", () => {
    expect(sunCoreRadiusPc(REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      SUN_CORE_FLOOR_RADIUS_PC,
    );
    expect(sunCoreRadiusPc(1.3, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(SUN_CORE_FLOOR_RADIUS_PC);
  });

  it("reads meaningfully smaller than the open-space ceiling, and meaningfully larger than the near-Sun floor, at the real 'Fit to Local Bubble' camera distance", () => {
    const radiusAtFitLocalBubble = sunCoreRadiusPc(
      REALISTIC_FIT_LOCAL_BUBBLE_CAMERA_DISTANCE_PC,
      REALISTIC_DENSE_BATCH_RADIUS_PC,
    );
    expect(radiusAtFitLocalBubble).toBeLessThan(SUN_CORE_MAX_RADIUS_PC);
    expect(radiusAtFitLocalBubble).toBeGreaterThan(STAR_MARKER_NEAR_SUN_RADIUS_PC);
    // Roughly halfway down the new taper, not just barely nudged off the
    // ceiling - this is the actual bug being fixed (issue #219's root
    // cause: the Sun sat at full 2pc while its bubble neighbors were
    // already visibly smaller).
    expect(radiusAtFitLocalBubble).toBeCloseTo(1.06, 1);
  });

  it("is flat at the max radius at or beyond SUN_BUBBLE_VIEW_OUTER_RADIUS_PC, and tapers continuously down to the near-Sun floor by the shrink-start threshold", () => {
    expect(sunCoreRadiusPc(SUN_BUBBLE_VIEW_OUTER_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      SUN_CORE_MAX_RADIUS_PC,
    );
    expect(sunCoreRadiusPc(shrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      STAR_MARKER_NEAR_SUN_RADIUS_PC,
    );

    // Dense monotonic sweep across the whole new taper range.
    const samples = Array.from({ length: 21 }, (_, i) =>
      sunCoreRadiusPc(
        shrinkStartPc + (i / 20) * (SUN_BUBBLE_VIEW_OUTER_RADIUS_PC - shrinkStartPc),
        REALISTIC_DENSE_BATCH_RADIUS_PC,
      ),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
    expect(samples[0]).toBe(STAR_MARKER_NEAR_SUN_RADIUS_PC);
    expect(samples[samples.length - 1]).toBe(SUN_CORE_MAX_RADIUS_PC);
  });

  it("falls back to the flat max radius for every camera distance when denseBatchRadiusPc is 0 (scene not loaded yet)", () => {
    // Mirrors the pre-#219 "not loaded yet" fallback exactly - no graduated
    // taper without a real RECONS radius to anchor the inner bound to.
    expect(sunCoreRadiusPc(REALISTIC_FIT_LOCAL_BUBBLE_CAMERA_DISTANCE_PC, 0)).toBe(SUN_CORE_MAX_RADIUS_PC);
  });
});

/**
 * Issue #300 (Epic #299, Story 1): `sunCoreRadiusPc`'s new `bubbleOuterRadiusPc`
 * parameter widens its shared inner bound (`starMarkerShrinkStartPc`) the
 * exact same way `starMarkerRadiusPc`'s own shrink-start threshold widens -
 * see that function's docstring in `starMarkerScale.ts`. This exercises the
 * Sun-specific consequence: the "viewing the Local Bubble" taper stage now
 * continues all the way to `bubbleOuterRadiusPc` instead of freezing at the
 * old flat ~34pc threshold.
 */
describe("sunCoreRadiusPc's bubbleOuterRadiusPc parameter (issue #300)", () => {
  const REALISTIC_BUBBLE_OUTER_RADIUS_PC = 60;
  const oldShrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * STAR_MARKER_SHRINK_START_MULTIPLIER;

  it("without bubbleOuterRadiusPc (default), behavior is unchanged from pre-#300", () => {
    expect(sunCoreRadiusPc(oldShrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(STAR_MARKER_NEAR_SUN_RADIUS_PC);
  });

  it("with bubbleOuterRadiusPc, keeps shrinking (below the near-Sun radius) past the old ~34pc threshold, reaching it only at bubbleOuterRadiusPc", () => {
    // Pre-#300, this camera distance would already be flat at
    // STAR_MARKER_NEAR_SUN_RADIUS_PC (the old shrink-start threshold); with
    // the widened threshold it's still inside `starMarkerRadiusPc`'s own
    // close-in shrink segment (now stretched all the way to
    // bubbleOuterRadiusPc), so it should read STRICTLY BELOW that value.
    const pastOldThreshold = sunCoreRadiusPc(
      oldShrinkStartPc + 5,
      REALISTIC_DENSE_BATCH_RADIUS_PC,
      REALISTIC_BUBBLE_OUTER_RADIUS_PC,
    );
    expect(pastOldThreshold).toBeGreaterThan(SUN_CORE_FLOOR_RADIUS_PC);
    expect(pastOldThreshold).toBeLessThan(STAR_MARKER_NEAR_SUN_RADIUS_PC);

    expect(
      sunCoreRadiusPc(REALISTIC_BUBBLE_OUTER_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_BUBBLE_OUTER_RADIUS_PC),
    ).toBe(STAR_MARKER_NEAR_SUN_RADIUS_PC);
  });

  it("is monotonic across the widened taper + close-in shrink ranges combined", () => {
    const samples = [1.3, REALISTIC_DENSE_BATCH_RADIUS_PC, 20, 40, REALISTIC_BUBBLE_OUTER_RADIUS_PC, 400, 1087].map(
      (d) => sunCoreRadiusPc(d, REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_BUBBLE_OUTER_RADIUS_PC),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
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
