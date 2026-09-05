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

/** The star marker's fully-camera-zoom-shrunk floor (pc), issue #119.
 *
 * Issue #1: raised from the original 0.02pc to 0.03pc (50% larger radius,
 * ~2.25x larger on-screen area) as a best-effort mitigation for "star
 * markers disappear entirely on mobile, inside the RECONS sphere" -
 * investigated live (desktop Chrome only - no real mobile device or true
 * mobile-GPU emulation was available; see the PR description for the full
 * writeup). Confirmed live: at this floor, a shrink-eligible star's actual
 * on-screen size at a typical "Fit to Nearest-Stars Sphere" pose is already
 * only ~9px diameter on a generous desktop-class render target (1654px-tall
 * buffer), and a plausible-but-not-extreme worse camera geometry (a star
 * near the far side of the ~11.26pc RECONS sphere from the camera) plus a
 * smaller/mobile-class buffer height pushes the SAME computed world radius
 * down toward ~1.5-2px - a regime where mobile GPUs' antialiasing/small-
 * primitive rasterization coverage rules (known to vary by vendor/driver,
 * unlike this app's shader float precision - see this constant's own
 * `objects.ts`/`createScene.ts` callers, and the PR description, for why
 * `mediump`-vs-`highp` was investigated and ruled out as the cause here)
 * become a live risk of a marker not rasterizing at all, not just rendering
 * small. This 50% bump was chosen as the largest value that stayed visually
 * indistinguishable from the original 0.02pc in a live side-by-side at the
 * default RECONS-sphere fit pose (verified via screenshot comparison) -
 * i.e. it's deliberately conservative, NOT a confident full fix: it was not
 * possible to reproduce the reported full-disappearance on any GPU
 * available for this investigation, so this raises the floor's margin
 * against the mechanism the evidence best supports without confirming it
 * eliminates the symptom on the real affected device. */
export const STAR_MARKER_MIN_RADIUS_PC = 0.03;

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
 * Issue #300 (Epic #299, Story 1): `starMarkerRadiusPc`'s shrink-start
 * threshold, hoisted into its own function (rather than left as an inline
 * expression duplicated at each call site) so `objects.ts`'s
 * `isStarMarkerShrinkEligible` - which needs the EXACT same threshold to
 * decide which stars are close enough to bother camera-shrinking at all -
 * can share it instead of maintaining a second, possibly-drifting copy.
 * This mirrors this module's own established philosophy (see e.g.
 * `sunCoreRadiusPc`'s docstring in `sun.ts`, or this module's own top
 * docstring): whenever two curves/checks must agree on a boundary, make
 * that agreement structural (one shared function) rather than two
 * separately-tuned numbers that happen to match today.
 *
 * Investigated live (issue #300): with the pre-#300 flat
 * `denseBatchRadiusPc * STAR_MARKER_SHRINK_START_MULTIPLIER` threshold
 * (~33.8pc for the shipped scene's real ~11.26pc RECONS radius), star
 * markers' camera-proximity shrink completes a little less than halfway
 * across the ~60pc Local Bubble - every star's marker sits flat at its own
 * real-distance-graduated `starBaselineRadiusPc` ceiling for the entire
 * remaining ~34-60pc (and beyond) with zero further camera-distance
 * feedback. Quantitatively (a representative star at `distance_pc = 45`,
 * radius/cameraDistance as an angular-size proxy): the proxy climbs from
 * ~0.018 at 15pc to a PEAK of ~0.0455 right at the old ~33.8pc threshold,
 * then immediately starts FALLING again - 0.0385 at 40pc, 0.0256 at 60pc,
 * 0.0128 at 120pc - for the rest of the Local Bubble and beyond, since nothing
 * compensates for the camera's natural perspective shrink there anymore. That
 * peak-then-reverse is a real, measurable artifact, not just a theoretical
 * one: flying outward from the RECONS sphere toward "Fit to Local Bubble"
 * framing, markers visibly grow most prominent a bit past the RECONS boundary
 * and then start shrinking again well before the bubble's own edge - the same
 * "loses proximity feedback, looks lost at the wider zoom" symptom Epic #299
 * names for vectors/trails, just for star markers instead of arrow length.
 *
 * Fix: when a Local Bubble layer IS loaded (`bubbleOuterRadiusPc` a real
 * positive value, and meaningfully outside `denseBatchRadiusPc` - a
 * degenerate closer-in bubble radius would make "shrink start" narrower than
 * the RECONS sphere itself, nonsensical), the shrink-start threshold becomes
 * `bubbleOuterRadiusPc` itself (not a further multiple of it) rather than the
 * old flat `denseBatchRadiusPc * STAR_MARKER_SHRINK_START_MULTIPLIER` - so
 * the camera-proximity shrink now completes exactly as the camera crosses
 * `isCameraInsideLocalBubble`'s own boundary, not partway through it. Re-run
 * with this threshold, the same angular-size proxy above climbs
 * monotonically for the star's entire real position range up to the bubble
 * edge (0.0091 at 15pc -> 0.0251 at 55pc -> 0.0256 at 60pc) and only then
 * starts the same natural perspective-only falloff beyond it (as expected -
 * "you have now left the region this whole feature tracks proximity within"
 * is a legitimate transition, not an artifact) - no more premature
 * peak-and-reverse anywhere inside the bubble. Verified live in the browser
 * at ~20/35/55/65pc camera distances against the shipped scene, alongside
 * this numeric sweep.
 *
 * No Local Bubble layer at all (`bubbleOuterRadiusPc === null`/`<= 0`, or
 * pathologically not outside `denseBatchRadiusPc`) falls back to the exact
 * pre-#300 flat multiplier - zero behavior change for a scene without
 * `structures.local_bubble`, matching this Story's other sentinel-handling
 * (`currentViewScalePc`'s own "no bubble" degrade in `viewScale.ts`). */
export function starMarkerShrinkStartPc(denseBatchRadiusPc: number, bubbleOuterRadiusPc: number | null = null): number {
  if (
    bubbleOuterRadiusPc !== null &&
    Number.isFinite(bubbleOuterRadiusPc) &&
    bubbleOuterRadiusPc > denseBatchRadiusPc
  ) {
    return bubbleOuterRadiusPc;
  }
  return denseBatchRadiusPc * STAR_MARKER_SHRINK_START_MULTIPLIER;
}

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
 * 1. At or beyond `starMarkerShrinkStartPc(denseBatchRadiusPc,
 *    bubbleOuterRadiusPc)` (pre-#300: always the flat
 *    `STAR_MARKER_SHRINK_START_MULTIPLIER * denseBatchRadiusPc`, comfortably
 *    covering the ~800pc overview and the default ~1087pc "Perspective" pose;
 *    issue #300 extends this to `bubbleOuterRadiusPc` itself when a Local
 *    Bubble layer is loaded - see that function's own docstring for why):
 *    flat at `maxRadiusPc`.
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
 *
 * Issue #300: `bubbleOuterRadiusPc` (defaulting to `null` for backward
 * compatibility - every pre-#300 caller that doesn't pass it keeps its exact
 * previous behavior) is threaded through to `starMarkerShrinkStartPc` alone -
 * it does NOT otherwise change this function's shape, only where segment 1's
 * boundary sits. See that function's docstring for the live investigation
 * that motivated extending it past the flat RECONS-relative multiplier.
 */
export function starMarkerRadiusPc(
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
  maxRadiusPc: number = STAR_MARKER_RADIUS_PC,
  bubbleOuterRadiusPc: number | null = null,
): number {
  if (denseBatchRadiusPc <= 0) {
    return maxRadiusPc;
  }

  const shrinkStartPc = starMarkerShrinkStartPc(denseBatchRadiusPc, bubbleOuterRadiusPc);
  if (cameraDistanceFromOriginPc >= shrinkStartPc) {
    return maxRadiusPc;
  }
  if (cameraDistanceFromOriginPc <= denseBatchRadiusPc) {
    return STAR_MARKER_MIN_RADIUS_PC;
  }

  const t = (cameraDistanceFromOriginPc - denseBatchRadiusPc) / (shrinkStartPc - denseBatchRadiusPc);
  return STAR_MARKER_MIN_RADIUS_PC + t * (maxRadiusPc - STAR_MARKER_MIN_RADIUS_PC);
}

/**
 * Issue #215 (hoisted here by #219 - see this module's own docstring for why
 * `sun.ts` can't import straight from `objects.ts`): a star's baseline
 * marker ceiling (pc), graduated by the star's own real radial `distancePc`
 * from the Sun - independent of camera zoom (that's `starMarkerRadiusPc`
 * above, which uses THIS function's result as its own ceiling rather than
 * the flat `STAR_MARKER_RADIUS_PC`, for the star tier).
 *
 * Deliberately uses plain radial distance, not the Local Bubble's true
 * off-centered/tilted ellipsoid shape (`center_pc`/`semi_axes_pc`/
 * `orientation`) - replicating that full geometry as a continuous per-star
 * gradient is a much bigger undertaking than a diffuse visual effect like
 * this justifies (per issue #215). `objects.ts`'s `bubbleOuterRadiusPcFrom`
 * is expected to be the STAR tier's `bubbleOuterRadiusPc` input, derived
 * from the bubble's two shorter, roughly-equal semi-axes (`a_pc`/`b_pc`,
 * both 60pc in the current model) rather than its elongated `c_pc` (162pc)
 * long axis, which would make a simple radial gradient wildly
 * direction-dependent - see that function's own docstring.
 *
 * Issue #219 reuses this exact function (not a re-derived copy) for
 * `sun.ts`'s own camera-distance-driven taper too - see `sunCoreRadiusPc`'s
 * docstring for why passing the CAMERA's distance from the origin in place
 * of a star's real `distancePc` (with a different, camera-scale-appropriate
 * pair of bounds, not the star tier's own `denseBatchRadiusPc`/
 * `bubbleOuterRadiusPc`) is a meaningful, correct reuse of this same shape
 * rather than a coincidental one: both are "how close is the relevant thing
 * to the Sun, on a scale from the RECONS boundary to the Local-Bubble-ish
 * outer edge" - a star's OWN position for a star, the CAMERA's position for
 * the Sun (whose own real position is always the origin, so it has no
 * "distance from itself" to graduate by).
 *
 * - `distancePc >= outerRadiusPc` ("open space", relative to whichever
 *   scale the caller's `outerRadiusPc` represents): the unchanged flat
 *   `STAR_MARKER_RADIUS_PC` (2pc).
 * - `distancePc <= innerRadiusPc` (at/inside the caller's own "near-Sun"
 *   scale): `STAR_MARKER_NEAR_SUN_RADIUS_PC` (0.5pc).
 * - In between: linear interpolation between those two values.
 *
 * `outerRadiusPc === null` (no graduated-sizing scale available - e.g. the
 * loaded scene has no `structures.local_bubble`, per issue #215's AC) or a
 * degenerate/nonpositive `innerRadiusPc`/`outerRadiusPc` (scene not loaded
 * yet, or the inner bound isn't strictly inside the outer one) both fall
 * back to the unchanged flat `STAR_MARKER_RADIUS_PC` for every input - no
 * graduated sizing, but never an error or a NaN/negative-`t` extrapolation.
 */
export function starBaselineRadiusPc(
  distancePc: number,
  innerRadiusPc: number,
  outerRadiusPc: number | null,
): number {
  if (
    outerRadiusPc === null ||
    !Number.isFinite(outerRadiusPc) ||
    innerRadiusPc <= 0 ||
    outerRadiusPc <= innerRadiusPc
  ) {
    return STAR_MARKER_RADIUS_PC;
  }
  if (distancePc >= outerRadiusPc) {
    return STAR_MARKER_RADIUS_PC;
  }
  if (distancePc <= innerRadiusPc) {
    return STAR_MARKER_NEAR_SUN_RADIUS_PC;
  }

  const t = (distancePc - innerRadiusPc) / (outerRadiusPc - innerRadiusPc);
  return STAR_MARKER_NEAR_SUN_RADIUS_PC + t * (STAR_MARKER_RADIUS_PC - STAR_MARKER_NEAR_SUN_RADIUS_PC);
}
