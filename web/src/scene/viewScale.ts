/**
 * Issue #300 (Epic #299, Story 1 of 3): the shared "current view scale"
 * primitive - a dependency-free leaf module, mirroring `starMarkerScale.ts`'s
 * own "no imports" shape (see that module's docstring for why: so both
 * `objects.ts`/`sun.ts` AND the future `velocityVectors.ts`/`motionTrail.ts`
 * consumers - Stories #301/#302 - can import from here without creating a
 * module cycle with any of those, or with each other via this file).
 *
 * Root problem (Epic #299): several visual-scale constants across this
 * codebase (`velocityVectors.ts`'s arrow-length bounds, `motionTrail.ts`'s
 * trail window, and until this issue `starMarkerScale.ts`'s own camera-shrink
 * outer bound) are tuned as ABSOLUTE parsec values, specifically and only for
 * the ~11.26pc RECONS dense-batch sphere. They read as "natural" there, but
 * increasingly tiny/lost once the camera pulls back to view the much larger
 * ~60pc Local Bubble or beyond, because nothing about them grows with the
 * camera's own framing.
 *
 * `currentViewScalePc` gives every such consumer a single, shared answer to
 * "what's the relevant reference scale (pc) right now, given how far back the
 * camera is": a value that a consumer can multiply one of its own
 * RECONS-tuned proportions by (e.g. `MAX_ARROW_LENGTH_PC / denseBatchRadiusPc`
 * as the fraction, not a re-tuned-from-scratch ratio) to get a result that is
 * mathematically IDENTICAL to today's tuned absolute constant at RECONS-sphere
 * zoom (since this function returns exactly `denseBatchRadiusPc` there - see
 * segment 1 below) while growing smoothly as the camera frames wider scenes.
 *
 * Three continuous, monotonic (non-decreasing) segments as
 * `cameraDistanceFromOriginPc` grows, no discontinuous jump at either
 * boundary:
 *
 * 1. At or inside `denseBatchRadiusPc` (the RECONS dense-batch sphere, #104):
 *    flat, exactly `denseBatchRadiusPc` - not just "close to" it. This exact
 *    equality (rather than merely a continuous approach to it) is what
 *    guarantees zero regression at RECONS-sphere zoom for every future
 *    consumer of this primitive: the RECONS-tuned proportion times this
 *    segment's value reproduces today's already-approved absolute constant
 *    bit-for-bit, not just visually.
 * 2. Between `denseBatchRadiusPc` and `bubbleOuterRadiusPc` (the Local
 *    Bubble's own roughly-circular cross-section radius, `objects.ts`'s
 *    `bubbleOuterRadiusPcFrom` - the shorter, roughly-equal `a_pc`/`b_pc`
 *    semi-axes, not the ellipsoid's elongated `c_pc` long axis, per that
 *    function's own docstring): linear interpolation from `denseBatchRadiusPc`
 *    up to `bubbleOuterRadiusPc`.
 * 3. Between `bubbleOuterRadiusPc` and the further "open space" ceiling
 *    `bubbleOuterRadiusPc * VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER`: linear
 *    interpolation from `bubbleOuterRadiusPc` up to that ceiling, then flat
 *    at the ceiling for any camera distance beyond it - open space never
 *    keeps growing the reference scale without bound, the same way
 *    `starMarkerRadiusPc`'s own pre-existing shrink curve flattens out past
 *    its own analogous multiple-of-a-radius threshold.
 *
 * `bubbleOuterRadiusPc === null` (no `structures.local_bubble` layer in the
 * loaded scene, matching `bubbleOuterRadiusPcFrom`'s own "absent optional
 * structure" return per spec §38) or `<= 0`/non-finite (a malformed or
 * degenerate value) degrades gracefully rather than erroring or producing
 * NaN: with no second reference radius to interpolate toward, there is no
 * segment 2 or 3 to compute, so this simply returns the flat
 * `denseBatchRadiusPc` for ANY camera distance - the exact pre-Epic-#299
 * behavior every existing RECONS-tuned absolute constant already
 * effectively assumed (a fixed value, not one that grows with camera
 * distance), so a scene with no Local Bubble layer sees no behavior change
 * from consumers that adopt this primitive.
 *
 * `denseBatchRadiusPc <= 0` (scene not loaded yet - `main.ts`'s own
 * module-level binding starts at exactly `0` until the catalog resolves) is
 * the same "nothing to be inside of yet" sentinel convention already used
 * throughout this codebase (`lod.ts`'s `isCameraInsideDenseBatchSphere`/
 * `isCameraInsideLocalBubble`, both of which return `false` rather than
 * attempting a comparison against a meaningless radius) - there is no valid
 * reference scale yet at all, so this returns `0` rather than guessing at
 * one. Every current/anticipated caller already gates its own scene-graph
 * work behind `denseBatchRadiusPc > 0` (see e.g. `objects.ts`'s
 * `isStarMarkerShrinkEligible`), so this sentinel is never actually asked to
 * scale a real on-screen size before the scene has loaded.
 */

/** The "open space" ceiling multiplier (segment 3 above) - how far beyond
 * `bubbleOuterRadiusPc` the view scale keeps growing before it flattens out
 * for good. `3`, mirroring `starMarkerScale.ts`'s own pre-existing
 * `STAR_MARKER_SHRINK_START_MULTIPLIER` "x3 of the nearer reference radius"
 * convention (not imported from there directly - this module stays
 * dependency-free like that one - just the same tuned constant chosen for
 * an analogous reason).
 *
 * Verified live (issue #300) against real camera poses: with the shipped
 * scene's actual `bubbleOuterRadiusPc` (~60pc), `3x` puts the ceiling at
 * ~180pc - comfortably past "Fit to Local Bubble" (~318pc camera distance,
 * per `sun.ts`'s `SUN_BUBBLE_VIEW_OUTER_RADIUS_PC` docstring, is a camera
 * FRAMING distance with padding, not the bubble's own physical radius) is
 * actually beyond this ceiling, which is expected and fine - `currentViewScalePc`
 * is not trying to reach every camera pose's exact distance, only to keep
 * growing smoothly a while past the bubble's own edge before capping, so
 * open-space poses farther still don't scale sizes up without bound. No
 * different multiplier read better once observed against the default
 * "Perspective" (~1087pc) and "Fit all" poses - both comfortably beyond the
 * flat ceiling either way - so the mirrored `x3` was kept as-is rather than
 * retuned. */
export const VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER = 3;

/**
 * The shared "current view scale" (pc) - see this module's own docstring for
 * the full three-segment shape and both sentinel cases.
 */
export function currentViewScalePc(
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
  bubbleOuterRadiusPc: number | null,
): number {
  if (denseBatchRadiusPc <= 0) {
    return 0;
  }
  if (cameraDistanceFromOriginPc <= denseBatchRadiusPc) {
    return denseBatchRadiusPc;
  }
  if (
    bubbleOuterRadiusPc === null ||
    !Number.isFinite(bubbleOuterRadiusPc) ||
    bubbleOuterRadiusPc <= denseBatchRadiusPc
  ) {
    return denseBatchRadiusPc;
  }
  if (cameraDistanceFromOriginPc <= bubbleOuterRadiusPc) {
    const t = (cameraDistanceFromOriginPc - denseBatchRadiusPc) / (bubbleOuterRadiusPc - denseBatchRadiusPc);
    return denseBatchRadiusPc + t * (bubbleOuterRadiusPc - denseBatchRadiusPc);
  }

  const ceilingPc = bubbleOuterRadiusPc * VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER;
  if (cameraDistanceFromOriginPc >= ceilingPc) {
    return ceilingPc;
  }
  const t = (cameraDistanceFromOriginPc - bubbleOuterRadiusPc) / (ceilingPc - bubbleOuterRadiusPc);
  return bubbleOuterRadiusPc + t * (ceilingPc - bubbleOuterRadiusPc);
}
