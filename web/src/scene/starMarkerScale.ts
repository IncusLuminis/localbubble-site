/**
 * Issue #217: the three magnitude constants of the star baseline scale
 * (issue #215), hoisted out of `scene/objects.ts` into their own
 * dependency-free leaf module so `scene/sun.ts` can reuse them for its own
 * three tiers without creating a module cycle.
 *
 * Why a new file rather than importing straight from `objects.ts` (the
 * issue's own stated starting hypothesis): `objects.ts` already imports
 * `sunCoreRadiusPc` FROM `sun.ts` (for `selectedMarkerRadiusPc`'s Sun
 * branch). Having `sun.ts` import these three constants back from
 * `objects.ts` would make each file's top-level `const`s depend on the
 * other's, and this is not just a style/lint concern - under real ES module
 * evaluation order it throws a live "Cannot access '...' before
 * initialization" error at load time: whichever of the two modules is
 * evaluated first pauses at its `import` of the other, the other module then
 * tries to read a `const` declared later in the first module's
 * not-yet-finished top-level body, and that binding is still in its
 * temporal dead zone. Verified live - the direct-import version crashes
 * `npm run dev`/`npm test` here with exactly that error. Hoisting the three
 * constants to this leaf module (which imports nothing from either
 * `objects.ts` or `sun.ts`) lets both of them import the same single source
 * of truth without either importing the other, so the two scales still
 * can't drift apart again in the future - just via a shared dependency
 * instead of a direct one.
 *
 * The values and their original derivations are unchanged from issue #215 -
 * see `objects.ts`'s (still-authoritative) `starBaselineRadiusPc`/
 * `markerRadiusPc` docstrings for the full rationale behind each number.
 *
 * Issue #217 (scope expansion, post-Validator-review): this module also now
 * holds `starMarkerRadiusPc` itself (moved here from `objects.ts`, where it
 * originated in issue #119) - not just its magnitude constants. The
 * Validator found that `scene/sun.ts`'s `sunCoreRadiusPc` had an extra "MID"
 * breakpoint (issue #136) that this function doesn't, so between the RECONS
 * boundary and the shared shrink-start threshold the two curves disagreed by
 * 4x-25x even though both now shared the same ceiling/floor *constants*. The
 * human owner decided the fix is to make the Sun's curve identical in SHAPE
 * to this one, not just in magnitude - the cleanest way to guarantee that is
 * for `sun.ts`'s `sunCoreRadiusPc` to call this exact function (see its own
 * docstring), which requires the function itself to live somewhere both
 * `objects.ts` and `sun.ts` can import from without the same module-cycle
 * problem the constants already had. `objects.ts` re-exports it (as it
 * already did for the constants) so existing callers/tests are unaffected. */

/** The star baseline's flat "open space" ceiling (pc) - the marker radius
 * for any star at or beyond the Local Bubble's outer edge, and the
 * pre-#215 flat radius every star used regardless of distance. */
export const STAR_MARKER_RADIUS_PC = 2;

/** The star baseline's "near-Sun" floor (pc) - reached once a star's own
 * real `distance_pc` is at or inside the RECONS dense-batch sphere's edge. */
export const STAR_MARKER_NEAR_SUN_RADIUS_PC = 0.5;

/** The star marker's fully-camera-zoom-shrunk floor (pc), issue #119. */
export const STAR_MARKER_MIN_RADIUS_PC = 0.02;

/** How far out (as a multiple of the dense batch's own collection radius)
 * the star radius starts shrinking from `maxRadiusPc`, reaching
 * `STAR_MARKER_MIN_RADIUS_PC` exactly at the collection radius itself.
 * Issue #217: also used, via `sunCoreRadiusPc`'s direct call into
 * `starMarkerRadiusPc` below, as the Sun core's own shrink-start
 * multiplier - so the Sun's and every star's shrink both finish at their
 * point-like floor at the exact same camera distance by construction, not
 * just by two separately-tuned constants happening to agree. */
export const STAR_MARKER_SHRINK_START_MULTIPLIER = 3;

/**
 * The star marker's camera-distance-dependent radius (pc), issue #119:
 * fixes the scale bug where a fixed marker radius (tuned for legibility at
 * the ~800pc overview) was larger than the real distance between the Sun and
 * its nearest neighbors, so at solar-neighborhood zoom nearby stars' markers
 * visually overlapped/engulfed the Sun's position instead of reading as
 * distinct nearby stars.
 *
 * Two segments, continuous and monotonic, no discontinuous jump at either
 * boundary:
 * 1. At or beyond `STAR_MARKER_SHRINK_START_MULTIPLIER * denseBatchRadiusPc`
 *    (comfortably covering the ~800pc overview and the default ~1087pc
 *    "Perspective" pose): flat at `maxRadiusPc`.
 * 2. From there down to `denseBatchRadiusPc` itself (the dense-LOD sphere's
 *    own boundary, #104): shrinks linearly to `STAR_MARKER_MIN_RADIUS_PC`,
 *    then stays clamped there for any distance at or inside
 *    `denseBatchRadiusPc` - i.e. this never has a third, separately-tuned
 *    "keep shrinking past the boundary" segment (issue #136 added exactly
 *    that as a Sun-only special case; issue #217 removed it again, per the
 *    human owner's decision that the Sun should never read as more/less
 *    prominent than a same-tier star at any zoom, obsoleting #136's original
 *    "keep the Sun deliberately distinct at max zoom" rationale).
 *
 * `denseBatchRadiusPc <= 0` (scene not loaded yet) has nothing to shrink
 * toward, so this simply returns `maxRadiusPc`, matching pre-#119 appearance.
 *
 * Issue #215: `maxRadiusPc` (the shrink's un-shrunk ceiling, defaulting to
 * the flat `STAR_MARKER_RADIUS_PC` for backward compatibility) is expected to
 * be the CALLING star's own `starBaselineRadiusPc` result, not always the
 * flat constant - a close star's baseline is already smaller than 2pc at far
 * zoom (per its own real distance), and this shrink still takes it the rest
 * of the way down to the same `STAR_MARKER_MIN_RADIUS_PC` floor as the
 * camera itself approaches. This is not a contradiction: the shrink range is
 * simply narrower for stars that already start closer to the floor.
 *
 * Issue #217: `scene/sun.ts`'s `sunCoreRadiusPc` calls this function directly
 * (passing its own `SUN_CORE_MAX_RADIUS_PC`, which is itself just
 * `STAR_MARKER_RADIUS_PC`) rather than maintaining a second, parallel
 * implementation of the identical curve - see that function's own docstring.
 */
export function starMarkerRadiusPc(
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
  maxRadiusPc: number = STAR_MARKER_RADIUS_PC,
): number {
  if (denseBatchRadiusPc <= 0) {
    return maxRadiusPc;
  }

  const shrinkStartPc = denseBatchRadiusPc * STAR_MARKER_SHRINK_START_MULTIPLIER;
  if (cameraDistanceFromOriginPc >= shrinkStartPc) {
    return maxRadiusPc;
  }
  if (cameraDistanceFromOriginPc <= denseBatchRadiusPc) {
    return STAR_MARKER_MIN_RADIUS_PC;
  }

  const t = (cameraDistanceFromOriginPc - denseBatchRadiusPc) / (shrinkStartPc - denseBatchRadiusPc);
  return STAR_MARKER_MIN_RADIUS_PC + t * (maxRadiusPc - STAR_MARKER_MIN_RADIUS_PC);
}
