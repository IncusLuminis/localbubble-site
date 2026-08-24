import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import {
  STAR_MARKER_RADIUS_PC,
  STAR_MARKER_MIN_RADIUS_PC,
  STAR_MARKER_SHRINK_START_MULTIPLIER,
  starMarkerRadiusPc,
  starBaselineRadiusPc,
} from "./starMarkerScale";

/**
 * The Sun marker at the coordinate origin (spec Idea.md §6, §30/"Sun
 * rendered at the origin" per issue #64's acceptance criteria). The Sun is
 * always exactly (0, 0, 0) by definition of the heliocentric frame (spec
 * §6) - this is the one position in the whole app that is legitimately a
 * literal constant rather than data read from `scene.json`, since it is
 * the coordinate system's own origin, not a measured scientific value.
 *
 * Rendered distinctly from catalog objects: a small bright core plus a
 * faint translucent halo, restrained rather than a lens-flare/glow effect
 * (spec §30's "not photorealistic").
 */

/** The core's radius (pc) at the ~800pc overview / any camera distance at
 * or beyond `STAR_MARKER_SHRINK_START_MULTIPLIER * denseBatchRadiusPc`
 * (issue #113) - i.e. the pre-#113 fixed radius, preserved as the upper
 * bound of `sunCoreRadiusPc` below so overview-scale appearance doesn't
 * regress.
 *
 * Issue #217: was an independent fixed `3` (pre-#215) - since #215 gave
 * individual stars their own graduated open-space ceiling
 * (`objects.ts`'s `STAR_MARKER_RADIUS_PC`, 2pc), the Sun's own open-space
 * tier no longer tracked it and, at 3pc vs. a distant star's 2pc, the Sun
 * read visibly larger than a same-zone background star at the default
 * overview. Now directly reuses `STAR_MARKER_RADIUS_PC` (imported from
 * `starMarkerScale.ts`, not `objects.ts` directly - see that module's
 * docstring for why) instead of a separately-tuned number, so the two
 * scales can't drift apart again. Verified live at the default ~1087pc
 * "Perspective" overview: the Sun's marker and a distant background star's
 * marker now read as the same size, as expected since both use the same
 * 2pc radius in this zone. */
export const SUN_CORE_MAX_RADIUS_PC = STAR_MARKER_RADIUS_PC;

/** The core's radius (pc) at or inside the RECONS dense batch's own
 * collection radius (`lod.ts`'s `denseBatchCollectionRadiusPc`, issue #104)
 * - small enough to read as "point-like" and clearly not overlap/dominate
 * Proxima Centauri's own marker (1.3pc from the Sun), but not literally
 * zero/invisible (issue #113's acceptance criteria).
 *
 * Issue #136 originally inserted a separate, larger "MID" breakpoint here
 * (`SUN_CORE_MID_RADIUS_PC`, 0.5pc) and had the curve keep shrinking past it
 * down to a *smaller* floor at the camera's real `minDistance` - the
 * explicit rationale was to keep the Sun "a distinct, prominent central
 * object" rather than shrinking all the way down to an individual star's
 * own floor. Issue #217's scope expansion (human owner decision, after the
 * Validator caught the resulting 4x-25x size mismatch between the RECONS
 * boundary and the shared shrink-start threshold - a zoom range reachable
 * via the "Fit to Nearest-Stars Sphere" preset, not one of #217's original
 * three named checkpoints) explicitly obsoletes that rationale: the Sun
 * should never read as more (or less) prominent than a same-tier star at
 * ANY zoom, so there is no longer a reason for the Sun's floor to differ
 * from a star's own floor, or for the curve to need a third breakpoint to
 * reach it. This constant now IS that single floor - identical to
 * `STAR_MARKER_MIN_RADIUS_PC` (via `starMarkerScale.ts`), used by
 * `sunCoreRadiusPc` below exactly the way `starMarkerRadiusPc` uses its own
 * floor. Verified live at close zoom inside the RECONS dense-LOD sphere: the
 * Sun's core and a fully-shrunk nearby star's marker read as the same (very
 * small, point-like) size at every distance inside the boundary, not just at
 * the camera's exact `minDistance` as before. */
export const SUN_CORE_FLOOR_RADIUS_PC = STAR_MARKER_MIN_RADIUS_PC;

/** Issue #219: the outer bound (pc, as a CAMERA distance from the origin -
 * not a real physical extent) of the Sun's new "viewing the Local Bubble"
 * taper stage below - beyond this camera distance, the Sun's ceiling is
 * flat at `SUN_CORE_MAX_RADIUS_PC`, matching the confirmed-correct
 * open-space/far-overview appearance exactly as before this issue.
 *
 * 800 (not the star tier's own `bubbleOuterRadiusPc`, ~60pc - see
 * `sunCoreRadiusPc`'s docstring for why that literal reuse doesn't work
 * here) was chosen because it's already the exact camera distance this
 * module's OWN pre-existing tests assert must render the Sun at its flat
 * max (`sun.test.ts`'s "is the max radius at the ~800pc overview
 * radius-filter preset", present since issue #113) - i.e. an
 * already-established, already-verified-correct anchor for "this camera
 * distance is definitely open space", not a new number invented for this
 * issue. Verified live (issue #219): with the shipped scene's real Local
 * Bubble data, "Fit to Local Bubble" lands the camera at ~318pc from the
 * origin (post-#201/#205's extra zoom-in-step padding - notably NOT the
 * ~500pc a naive `fitSpherePose` calculation alone would suggest, exactly
 * the kind of stale-assumption trap this issue's own acceptance criteria
 * warned about) - comfortably inside this 800pc bound, so the new taper
 * stage is actually active there, and comfortably above the RECONS-relative
 * inner bound below, so the Sun reads meaningfully (not just barely)
 * smaller than its open-space ceiling at that preset. */
export const SUN_BUBBLE_VIEW_OUTER_RADIUS_PC = 800;

/**
 * The Sun core's camera-distance-dependent radius (pc), issue #113 (revised
 * by #217 to remove #136's extra breakpoint - see `SUN_CORE_FLOOR_RADIUS_PC`
 * above; revised again by #219 to add the taper stage below): fixes the
 * scale bug where the Sun's opaque core (a fixed 3pc radius, sized for
 * legibility at the ~800pc overview) was larger than the RECONS batch's
 * nearest star, Proxima Centauri, at 1.3pc from the Sun - at
 * solar-neighborhood zoom the core read as an oversized bubble engulfing the
 * nearest stars rather than "the Sun".
 *
 * Issue #217's scope expansion mandates that this curve be the SAME SHAPE as
 * `starMarkerScale.ts`'s `starMarkerRadiusPc` - not just tuned to the same
 * ceiling/floor magnitudes, since a shape mismatch alone was enough to
 * reproduce a large chunk of the pre-#113 bug this whole feature area
 * exists to fix. This is still true post-#219: the close-in shrink below
 * (`starMarkerRadiusPc` itself) is completely unchanged - only the CEILING
 * fed into it is now sometimes less than the flat `SUN_CORE_MAX_RADIUS_PC`.
 *
 * Issue #219: #215 gave individual stars a baseline ceiling that's already
 * graduated by each star's own real distance from the Sun - tapering from
 * the flat 2pc "open space" ceiling down to a 0.5pc "near-Sun" floor across
 * the Local Bubble's own real extent. That graduation is independent of
 * camera zoom, so bubble-area stars already render smaller than 2pc even
 * while the camera is positioned to view the whole bubble (e.g. "Fit to
 * Local Bubble") - a camera distance well beyond where the Sun's own
 * pre-#219 flat 2pc ceiling started shrinking (`starMarkerRadiusPc`'s own
 * `denseBatchRadiusPc * STAR_MARKER_SHRINK_START_MULTIPLIER` threshold, only
 * ~34pc for the real RECONS boundary). The Sun's real distance from itself
 * is always 0, so it can't reuse #215's star-side formula the way a real
 * star does (there's no "how far is the Sun from the Sun" to graduate by) -
 * instead, this reuses `starMarkerScale.ts`'s `starBaselineRadiusPc` (the
 * exact same interpolation SHAPE #215 already established, not a
 * re-derived copy of it) with the CAMERA's own distance from the origin in
 * `distancePc`'s place, so the Sun's ceiling tapers as the CAMERA approaches
 * bubble-viewing range, exactly mirroring how a star's ceiling tapers as
 * ITS real position approaches the same range.
 *
 * The star tier's own bounds (`denseBatchRadiusPc`/`bubbleOuterRadiusPc`,
 * ~11.26pc/~60pc) aren't reused verbatim for this camera-distance stage,
 * per this issue's own explicit allowance to adjust real breakpoints once
 * verified live rather than forcing stale numbers: the real "Fit to Local
 * Bubble" camera distance (~318pc, see `SUN_BUBBLE_VIEW_OUTER_RADIUS_PC`'s
 * docstring) is nowhere near the star tier's ~60pc physical-extent bound,
 * since `fitSpherePose` frames the whole scene with padding, not a tight
 * crop - a camera-distance scale needs camera-distance-appropriate bounds.
 * The INNER bound here is instead `denseBatchRadiusPc *
 * STAR_MARKER_SHRINK_START_MULTIPLIER` - `starMarkerRadiusPc`'s own
 * shrink-start threshold - so this new stage's floor (0.5pc) lands exactly
 * where the pre-existing close-in shrink's ceiling parameter already picks
 * up, by construction rather than by two separately-tuned numbers happening
 * to agree (the same continuity principle #217 established for the
 * boundary one level in, at `denseBatchRadiusPc` itself). The OUTER bound is
 * `SUN_BUBBLE_VIEW_OUTER_RADIUS_PC` (800pc) - see its own docstring.
 *
 * Net effect, camera distance decreasing from the default ~1087pc pose:
 * flat at `SUN_CORE_MAX_RADIUS_PC` (2pc) down to 800pc (unchanged from
 * pre-#219 - the confirmed-correct open-space/far-overview appearance);
 * NEW linearly tapering ceiling from 2pc down to 0.5pc between 800pc and
 * the RECONS shrink-start threshold (~34pc) - this is the "viewing the
 * Local Bubble" range this issue targets; then unchanged from #217,
 * `starMarkerRadiusPc`'s own close-in shrink continues from that (now
 * usually 0.5pc, not 2pc) ceiling down to `SUN_CORE_FLOOR_RADIUS_PC` at/
 * inside `denseBatchRadiusPc` - the confirmed-correct nearest-stars-sphere
 * appearance, also unchanged (that floor never depended on the ceiling to
 * begin with).
 *
 * No longer takes a `minZoomDistancePc` parameter (issue #136 added it for
 * the now-removed third segment) - the camera's actual enforced zoom floor
 * (`controls.minDistance`) always sits well inside `denseBatchRadiusPc` for
 * real catalog data, and the curve is flat at `SUN_CORE_FLOOR_RADIUS_PC` for
 * the entire inside-the-boundary region regardless of exactly how close the
 * camera can get - there is nothing left for that parameter to influence.
 */
export function sunCoreRadiusPc(
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
): number {
  const shrinkStartPc = denseBatchRadiusPc * STAR_MARKER_SHRINK_START_MULTIPLIER;
  const ceilingRadiusPc = starBaselineRadiusPc(
    cameraDistanceFromOriginPc,
    shrinkStartPc,
    SUN_BUBBLE_VIEW_OUTER_RADIUS_PC,
  );
  return starMarkerRadiusPc(cameraDistanceFromOriginPc, denseBatchRadiusPc, ceilingRadiusPc);
}

/** The Sun marker's constituent meshes, returned alongside the `Group` so
 * `main.ts` can rescale `core` each frame/camera-move (`sunCoreRadiusPc`
 * above) without reaching back into the scene graph by name. `core`'s
 * geometry is a unit sphere - its actual on-screen radius (pc) is always
 * `core.scale`, kept in sync with `sunCoreRadiusPc`'s return value, rather
 * than baked into the geometry itself (which would require rebuilding the
 * geometry every frame instead of just setting a scale). */
export interface SunMarker {
  group: Group;
  core: Mesh;
}

export function createSunMarker(): SunMarker {
  const group = new Group();
  group.name = "sun";

  const core = new Mesh(new SphereGeometry(1, 24, 16), new MeshBasicMaterial({ color: 0xfff3c4 }));
  core.scale.setScalar(SUN_CORE_MAX_RADIUS_PC);
  group.add(core);

  const halo = new Mesh(
    new SphereGeometry(6, 24, 16),
    new MeshBasicMaterial({
      color: 0xfff3c4,
      transparent: true,
      opacity: 0.18,
      depthWrite: false,
    }),
  );
  group.add(halo);

  group.position.set(0, 0, 0);
  return { group, core };
}
