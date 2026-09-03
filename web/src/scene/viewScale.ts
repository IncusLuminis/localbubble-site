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
 * for good.
 *
 * Story #309 (Epic #306, the Epic's final Story): raised from the original
 * `3` (issue #300) to `40` after live-verifying vectors/trails against real
 * open-space data for the first time - #300 was tuned before Story #308
 * enabled vectors/trails/Time Controls beyond the Local Bubble at all, so it
 * was never actually checked against a moving arrow or trail out there, only
 * against static camera poses. With `3x` (`ceilingPc` ~180pc for the shipped
 * scene's real ~60pc `bubbleOuterRadiusPc`), `currentViewScalePc` - which,
 * for any `bubbleOuterRadiusPc` between `denseBatchRadiusPc` and the
 * ceiling, is mathematically just `cameraDistanceFromOriginPc` itself
 * (segments 2 and 3's two linear-interpolation endpoints both lie exactly on
 * the `y = x` line, so both segments simplify to the identity function, not
 * merely an approach toward one - verify by substitution) - stops growing
 * entirely once the camera is a mere ~180pc from the Sun, while a
 * general-navigation camera's own FRAMING WIDTH keeps growing roughly
 * linearly with its distance from the origin well past that (confirmed live
 * via the app's own "View: W x H" readout: ~171pc wide at a 100pc camera
 * distance, ~512pc wide at 300pc, ~1.71kpc wide at 1000pc - all comfortably
 * past the old 180pc ceiling). The result: arrow/trail length (pinned flat
 * at the `180pc`-ceiling's fixed scale factor, ~15.99x) shrinks steadily
 * RELATIVE to the growing framing the farther out the camera goes - live
 * screenshots at a 100pc camera distance (well inside the old ceiling, still
 * growing) showed clear, differentiated, readable arrows; at 1000pc (deep
 * past it) arrows were reduced to barely-visible few-pixel hairlines with no
 * discernible arrowhead, on real named landmark stars (`* alf Cru`,
 * ~98.7pc, `* alf Ori`/Betelgeuse, ~152.7pc) and the catalog's farther
 * open-space population alike - exactly the "imperceptibly small... before
 * ~1000pc+" failure mode this Story's own issue predicted as a possibility,
 * confirmed live rather than assumed. Worse, the app's own DEFAULT
 * "Perspective" pose (`cameraPresets.ts`'s fixed `[700,-700,450]`, ~1087pc
 * from the origin) already sits well past the old 180pc ceiling - so a
 * first-time user opening the app and toggling vectors on would see this
 * degraded, flattened-out appearance immediately, not only at some rare
 * extreme zoom.
 *
 * `40` (`ceilingPc` = 2400pc for the shipped scene) was chosen against the
 * catalog's own real open-space extent: `starsWithVelocity`'s farthest
 * member (`*  55 Cyg`, ~1840pc, checked directly against `public/data/
 * scene.json` 2026-09-03) sits at scale factor ~163x under this ceiling -
 * still on the growing (identity) segment, not yet flattened - with ~2400pc
 * of headroom before the reference scale itself stops growing, comfortably
 * past every real velocity-bearing star in the catalog today (~30% margin
 * over the current ~1840pc max) without chasing every conceivable camera
 * pose unboundedly (e.g. a `fitAllPose` framing that includes non-stellar
 * deep-sky objects like `M76`, which has no velocity/vectors to draw in the
 * first place and sits ~3.4kpc out, would still eventually flatten well
 * beyond this ceiling, preserving the original "never grows without bound"
 * intent for genuinely extreme zoom). Re-verified live at this new ceiling:
 * a 1000pc camera distance (deep open space, past the old ceiling but well
 * under the new one) now shows clearly visible, differentiated arrows again
 * (scale factor ~88.8x, matching the same relative-to-framing proportions
 * already approved at 100-300pc), and the RECONS-sphere/Bubble-edge segments
 * (1/2 above) are mathematically untouched by this change - only segment 3's
 * own upper bound moved, so `currentViewScalePc`'s existing
 * exact-reproduction guarantee at/inside `denseBatchRadiusPc` and its
 * continuity at the `bubbleOuterRadiusPc` boundary both still hold bit for
 * bit (see `viewScale.test.ts`'s own segment-1/2 tests, unmodified and still
 * green). See this Story's PR description for the full live-verification
 * writeup and screenshots across all three zones. */
export const VIEW_SCALE_OPEN_SPACE_CEILING_MULTIPLIER = 40;

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
