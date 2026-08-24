import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import { STAR_MARKER_RADIUS_PC, STAR_MARKER_MIN_RADIUS_PC, starMarkerRadiusPc } from "./starMarkerScale";

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

/**
 * The Sun core's camera-distance-dependent radius (pc), issue #113 (revised
 * by #217 to remove #136's extra breakpoint - see `SUN_CORE_FLOOR_RADIUS_PC`
 * above): fixes the scale bug where the Sun's opaque core (a fixed 3pc
 * radius, sized for legibility at the ~800pc overview) was larger than the
 * RECONS batch's nearest star, Proxima Centauri, at 1.3pc from the Sun - at
 * solar-neighborhood zoom the core read as an oversized bubble engulfing the
 * nearest stars rather than "the Sun".
 *
 * Issue #217's scope expansion mandates that this curve be the SAME SHAPE as
 * `starMarkerScale.ts`'s `starMarkerRadiusPc` - not just tuned to the same
 * ceiling/floor magnitudes (the prior, narrower scope of this issue), since
 * a shape mismatch alone was enough to reproduce a large chunk of the
 * pre-#113 bug this whole feature area exists to fix. Rather than
 * hand-duplicating that same two-segment interpolation a second time (which
 * is exactly how the two curves drifted apart before, via #136), this is
 * simply a thin wrapper that calls `starMarkerRadiusPc` directly with the
 * Sun's own ceiling as its `maxRadiusPc` - the two functions are now
 * mathematically incapable of disagreeing about shape, since there is only
 * one implementation of the shape. See `starMarkerRadiusPc`'s own docstring
 * for the full two-segment description (flat at the ceiling at/beyond the
 * shrink-start threshold, flat at the floor at/inside `denseBatchRadiusPc`,
 * linear in between) and its `denseBatchRadiusPc <= 0` "not loaded yet"
 * fallback.
 *
 * No longer takes a `minZoomDistancePc` parameter (issue #136 added it for
 * the now-removed third segment) - the camera's actual enforced zoom floor
 * (`controls.minDistance`) always sits well inside `denseBatchRadiusPc` for
 * real catalog data, and the curve is now flat at `SUN_CORE_FLOOR_RADIUS_PC`
 * for the entire inside-the-boundary region regardless of exactly how close
 * the camera can get - there is nothing left for that parameter to
 * influence.
 */
export function sunCoreRadiusPc(
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
): number {
  return starMarkerRadiusPc(cameraDistanceFromOriginPc, denseBatchRadiusPc, SUN_CORE_MAX_RADIUS_PC);
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
