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

/** The core's radius (pc) once the camera is at or inside the RECONS dense
 * batch's own collection radius (`lod.ts`'s `denseBatchCollectionRadiusPc`,
 * issue #104) - small enough to read as "point-like" and clearly not
 * overlap/dominate Proxima Centauri's own marker (1.3pc from the Sun,
 * `STAR_MARKER_RADIUS_PC` = 2pc in `scene/objects.ts`), but not literally
 * zero/invisible (issue #113's acceptance criteria). */
export const SUN_CORE_MIN_RADIUS_PC = 0.15;

/** How far out (as a multiple of the dense batch's own collection radius)
 * the core starts shrinking from `SUN_CORE_MAX_RADIUS_PC`, reaching
 * `SUN_CORE_MIN_RADIUS_PC` exactly at the collection radius itself - chosen
 * so the core has already finished shrinking to its point-like floor by
 * the time `passesDenseBatchLod` (`lod.ts`) starts actually revealing the
 * dense batch's own markers (camera distance <= collection radius), rather
 * than the two LOD effects visibly fighting/lagging each other. */
export const SUN_CORE_SHRINK_START_MULTIPLIER = 3;

/**
 * The Sun core's camera-distance-dependent radius (pc), issue #113: fixes
 * the scale bug where the Sun's opaque core (a fixed 3pc radius, sized for
 * legibility at the ~800pc overview) was larger than the RECONS batch's
 * nearest star, Proxima Centauri, at 1.3pc from the Sun - at
 * solar-neighborhood zoom the core read as an oversized bubble engulfing
 * the nearest stars rather than "the Sun".
 *
 * Mirrors this codebase's existing camera-distance-driven pure-function
 * style (`labels.ts`'s `effectiveMaxLabelDistancePc`, #94;
 * `objects.ts`'s `updateDenseBatchLod`, #104) rather than inventing a new
 * one: a pure function of camera distance (plus the data-derived dense
 * batch radius it's benchmarked against, per #104's "must not hard-code a
 * permanent limit" principle - see `lod.ts`'s `denseBatchCollectionRadiusPc`
 * docstring), called by `main.ts` once per frame/camera-move.
 *
 * Stays at `SUN_CORE_MAX_RADIUS_PC` for any camera distance at or beyond
 * `SUN_CORE_SHRINK_START_MULTIPLIER * denseBatchRadiusPc` (comfortably
 * covering the ~800pc overview and the default ~1087pc "Perspective" pose),
 * shrinks linearly as the camera closes in, and clamps to
 * `SUN_CORE_MIN_RADIUS_PC` once the camera is at or inside
 * `denseBatchRadiusPc` itself - continuous and monotonic across the whole
 * range, no discontinuous jump at either boundary.
 *
 * `denseBatchRadiusPc <= 0` (the "not loaded yet" state - see `main.ts`'s
 * `denseBatchRadiusPc` docstring, and `lod.ts`'s `denseBatchCollectionRadiusPc`
 * returning `0` when nothing is tagged) has nothing to shrink toward, so
 * the core simply stays at its overview-legible max, matching the
 * pre-#113/pre-scene-load appearance.
 */
export function sunCoreRadiusPc(
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
): number {
  if (denseBatchRadiusPc <= 0) {
    return SUN_CORE_MAX_RADIUS_PC;
  }

  const shrinkStartPc = denseBatchRadiusPc * SUN_CORE_SHRINK_START_MULTIPLIER;
  if (cameraDistanceFromOriginPc >= shrinkStartPc) {
    return SUN_CORE_MAX_RADIUS_PC;
  }
  if (cameraDistanceFromOriginPc <= denseBatchRadiusPc) {
    return SUN_CORE_MIN_RADIUS_PC;
  }

  const t = (cameraDistanceFromOriginPc - denseBatchRadiusPc) / (shrinkStartPc - denseBatchRadiusPc);
  return SUN_CORE_MIN_RADIUS_PC + t * (SUN_CORE_MAX_RADIUS_PC - SUN_CORE_MIN_RADIUS_PC);
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
