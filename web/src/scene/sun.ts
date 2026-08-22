import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";

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
 * or beyond `SUN_CORE_SHRINK_START_MULTIPLIER * denseBatchRadiusPc`
 * (issue #113) - i.e. the pre-#113 fixed radius, preserved as the upper
 * bound of `sunCoreRadiusPc` below so overview-scale appearance doesn't
 * regress. */
export const SUN_CORE_MAX_RADIUS_PC = 3;

/** The core's radius (pc) once the camera reaches the RECONS dense batch's
 * own collection radius (`lod.ts`'s `denseBatchCollectionRadiusPc`, issue
 * #104) - small enough to read as "point-like" and clearly not
 * overlap/dominate Proxima Centauri's own marker (1.3pc from the Sun), but
 * not literally zero/invisible (issue #113's acceptance criteria).
 *
 * Chosen against the pre-#119 fixed `STAR_MARKER_RADIUS_PC` (2pc in
 * `scene/objects.ts`) since that was the only star marker radius that
 * existed at the time. Issue #119 later gave close-in star markers their
 * own camera-distance-dependent shrink (`objects.ts`'s
 * `starMarkerRadiusPc`), so at the same close zoom this core's 0.15pc now
 * sits alongside a star marker that has *also* shrunk (down to
 * `STAR_MARKER_MIN_RADIUS_PC`, 0.02pc) - only more clearance against
 * Proxima's 1.302pc gap than before, never less, so this value did not need
 * to change.
 *
 * Issue #136: pre-#136, this was also the *final* floor - the curve froze
 * here for the rest of the zoom range down to the camera's actual minimum
 * distance, since #113 predates #134's closer zoom floor. It's kept as-is
 * (name, value, and `camera.ts`'s import of it for `MIN_ZOOM_MARGIN_PC` are
 * both untouched by #136) but now serves as the *middle* anchor of a
 * three-segment curve - the radius at the dense-batch boundary itself,
 * where the curve hands off from "shrinking toward the boundary" to
 * "shrinking toward the real zoom floor" (`SUN_CORE_FLOOR_RADIUS_PC`
 * below). */
export const SUN_CORE_MID_RADIUS_PC = 0.15;

/** @deprecated Issue #136: kept only as a stable alias so `camera.ts`'s
 * existing `MIN_ZOOM_MARGIN_PC = SUN_CORE_MIN_RADIUS_PC` (issue #134,
 * unrelated to this issue's scope) keeps compiling and its derivation
 * unchanged. Use `SUN_CORE_MID_RADIUS_PC` for anything about the Sun's own
 * rendering curve - it is no longer the curve's minimum since #136 added
 * `SUN_CORE_FLOOR_RADIUS_PC` below it. */
export const SUN_CORE_MIN_RADIUS_PC = SUN_CORE_MID_RADIUS_PC;

/** The core's radius (pc) at or inside the camera's actual enforced zoom
 * floor (#134's data-derived `OrbitControls.minDistance`, ~1.452pc against
 * the current catalog - see `camera.ts`'s `deriveMinZoomDistancePc`).
 *
 * Issue #136: pre-#136 the core's shrink was fully "used up" by
 * `SUN_CORE_MID_RADIUS_PC` at the dense-batch boundary (~11.26pc), well
 * before the camera's real zoom floor (~1.45pc, another ~8x closer) - so
 * from the boundary inward the core sat frozen, visibly not tracking the
 * user's continued zoom. This value is where the curve now bottoms out
 * instead, at the actual point beyond which the camera cannot get any
 * closer.
 *
 * Chosen as 2.5x `objects.ts`'s `STAR_MARKER_MIN_RADIUS_PC` (0.02pc, issue
 * #119's own fully-shrunk star-marker floor): smaller than the old
 * `SUN_CORE_MID_RADIUS_PC` (0.15pc) so the shrink visibly continues all the
 * way to the zoom floor per this issue's acceptance criteria, but
 * deliberately a bit larger than an individual star marker's floor so the
 * Sun still reads as a distinct, prominent central object at max zoom
 * rather than shrinking to the same indistinguishable point-size as a
 * regular star. */
export const SUN_CORE_FLOOR_RADIUS_PC = 0.05;

/** How far out (as a multiple of the dense batch's own collection radius)
 * the core starts shrinking from `SUN_CORE_MAX_RADIUS_PC`, reaching
 * `SUN_CORE_MID_RADIUS_PC` exactly at the collection radius itself - chosen
 * so the core has already finished this first stage of shrinking by
 * the time `passesDenseBatchLod` (`lod.ts`) starts actually revealing the
 * dense batch's own markers (camera distance <= collection radius), rather
 * than the two LOD effects visibly fighting/lagging each other. */
export const SUN_CORE_SHRINK_START_MULTIPLIER = 3;

/**
 * The Sun core's camera-distance-dependent radius (pc), issue #113
 * (extended by #136): fixes the scale bug where the Sun's opaque core (a
 * fixed 3pc radius, sized for legibility at the ~800pc overview) was larger
 * than the RECONS batch's nearest star, Proxima Centauri, at 1.3pc from the
 * Sun - at solar-neighborhood zoom the core read as an oversized bubble
 * engulfing the nearest stars rather than "the Sun".
 *
 * Mirrors this codebase's existing camera-distance-driven pure-function
 * style (`labels.ts`'s `effectiveMaxLabelDistancePc`, #94;
 * `objects.ts`'s `updateDenseBatchLod`, #104) rather than inventing a new
 * one: a pure function of camera distance (plus the data-derived dense
 * batch radius and the camera's own zoom floor it's benchmarked against,
 * per #104's "must not hard-code a permanent limit" principle - see
 * `lod.ts`'s `denseBatchCollectionRadiusPc` docstring), called by `main.ts`
 * once per frame/camera-move.
 *
 * Three segments, continuous and monotonic across the whole range, no
 * discontinuous jump at any boundary:
 * 1. At or beyond `SUN_CORE_SHRINK_START_MULTIPLIER * denseBatchRadiusPc`
 *    (comfortably covering the ~800pc overview and the default ~1087pc
 *    "Perspective" pose): flat at `SUN_CORE_MAX_RADIUS_PC` - unchanged by
 *    #136.
 * 2. From there down to `denseBatchRadiusPc` itself (the dense-LOD sphere's
 *    own boundary, #104): shrinks linearly to `SUN_CORE_MID_RADIUS_PC` -
 *    also unchanged by #136, so appearance in this range doesn't regress.
 * 3. Issue #136: from `denseBatchRadiusPc` down to `minZoomDistancePc`
 *    (#134's data-derived `OrbitControls.minDistance` - the camera's actual
 *    enforced zoom floor, ~1.45pc against the current catalog): continues
 *    shrinking linearly, this time to `SUN_CORE_FLOOR_RADIUS_PC`, rather
 *    than freezing at `SUN_CORE_MID_RADIUS_PC` for the entire remaining
 *    (and largest, ~8x) portion of the zoom range as it did pre-#136.
 *    Clamped to `SUN_CORE_FLOOR_RADIUS_PC` for any distance at or inside
 *    `minZoomDistancePc`, so a still-frame taken while the camera is
 *    settling (e.g. damping) never renders a smaller-than-floor radius.
 *
 * `denseBatchRadiusPc <= 0` (the "not loaded yet" state - see `main.ts`'s
 * `denseBatchRadiusPc` docstring, and `lod.ts`'s `denseBatchCollectionRadiusPc`
 * returning `0` when nothing is tagged) has nothing to shrink toward, so
 * the core simply stays at its overview-legible max, matching the
 * pre-#113/pre-scene-load appearance - `minZoomDistancePc` is irrelevant in
 * that state and unused.
 *
 * `minZoomDistancePc >= denseBatchRadiusPc` (shouldn't happen with real
 * catalog data - #134's derivation always adds a small margin to the
 * nearest real object's own distance, which sits well inside the RECONS
 * dense batch - but kept defensive rather than assumed) collapses segment
 * 3 to zero width; handled by clamping the inner anchor so the segment's
 * denominator never reaches zero.
 */
export function sunCoreRadiusPc(
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
  minZoomDistancePc: number,
): number {
  if (denseBatchRadiusPc <= 0) {
    return SUN_CORE_MAX_RADIUS_PC;
  }

  const shrinkStartPc = denseBatchRadiusPc * SUN_CORE_SHRINK_START_MULTIPLIER;
  if (cameraDistanceFromOriginPc >= shrinkStartPc) {
    return SUN_CORE_MAX_RADIUS_PC;
  }
  if (cameraDistanceFromOriginPc >= denseBatchRadiusPc) {
    const t = (cameraDistanceFromOriginPc - denseBatchRadiusPc) / (shrinkStartPc - denseBatchRadiusPc);
    return SUN_CORE_MID_RADIUS_PC + t * (SUN_CORE_MAX_RADIUS_PC - SUN_CORE_MID_RADIUS_PC);
  }

  // Issue #136: segment 3 - continue shrinking from SUN_CORE_MID_RADIUS_PC
  // (at denseBatchRadiusPc) down to SUN_CORE_FLOOR_RADIUS_PC (at
  // minZoomDistancePc), instead of freezing flat for the rest of the range.
  const innerAnchorPc = Math.min(minZoomDistancePc, denseBatchRadiusPc - Number.EPSILON);
  if (cameraDistanceFromOriginPc <= innerAnchorPc) {
    return SUN_CORE_FLOOR_RADIUS_PC;
  }
  const innerT = (cameraDistanceFromOriginPc - innerAnchorPc) / (denseBatchRadiusPc - innerAnchorPc);
  return SUN_CORE_FLOOR_RADIUS_PC + innerT * (SUN_CORE_MID_RADIUS_PC - SUN_CORE_FLOOR_RADIUS_PC);
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
