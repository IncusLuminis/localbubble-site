import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneObject } from "./sceneTypes";
import { excludeDedicatedMarkerObjects } from "./objects";
import { SUN_CORE_FLOOR_RADIUS_PC } from "./sun";

/**
 * Camera + orbit controls (spec Idea.md §22: "orbit-style camera control;
 * zoom; pan"). Camera presets (face-on/edge-on/Sun-centered/etc, spec §29)
 * are explicitly out of scope for this Story (#65's job) - this sets up a
 * single sensible default view and leaves free orbit/pan/zoom navigation
 * to `OrbitControls`.
 *
 * The scientific coordinate frame (spec §6) is +X -> Galactic Center,
 * +Y -> Galactic rotation, +Z -> North Galactic Pole - i.e. Z-up, not
 * Three.js's default Y-up. Rather than remapping any object's position
 * (which `scene/sceneData.ts` deliberately never does), the camera's own
 * `up` vector is set to +Z so `OrbitControls` orbits around the Galactic Z
 * axis and the Galactic Plane (spec §26, at Z=0) reads as the "floor" of
 * the scene.
 */

export function createCamera(): PerspectiveCamera {
  const camera = new PerspectiveCamera(
    50,
    window.innerWidth / window.innerHeight,
    0.1,
    100_000,
  );
  camera.up.set(0, 0, 1);
  // Default view: off-axis and elevated so the Galactic Plane, the Sun at
  // the origin, and catalog objects above/below the plane are all visible
  // at once, per spec §30's "prioritize spatial clarity".
  camera.position.set(700, -700, 450);
  camera.lookAt(new Vector3(0, 0, 0));
  return camera;
}

/** Pre-#134 default close-zoom floor (pc), used only until the real scene
 * data has loaded and `deriveMinZoomDistancePc` below can compute the
 * actual data-derived floor (`main.ts`'s `loadScene().then(...)` does so,
 * the same "0 until loaded" pattern `main.ts`'s `denseBatchRadiusPc`
 * already uses for issue #104). Kept as a safe fallback rather than
 * something tighter, since nothing is known about real object distances
 * yet at camera-construction time. */
const FALLBACK_MIN_DISTANCE_PC = 5;

/** How far beyond the nearest real (non-Sun, non-dedicated-marker) catalog
 * object's distance the close-zoom floor should sit, issue #134. Chosen as
 * `SUN_CORE_FLOOR_RADIUS_PC` (`scene/sun.ts`'s single floor radius for the
 * Sun's own marker, deliberately not hard-coded here so this margin tracks
 * that constant automatically) rather than an independent margin constant:
 * that's exactly the Sun core's own fully-shrunk radius at this close a
 * zoom (see `sunCoreRadiusPc`'s docstring - any camera distance this close
 * is already within the RECONS dense batch's collection radius, issue #104,
 * so the core is already flat at its point-like floor). Anchoring the
 * margin to that value guarantees the camera can never be closer to the
 * origin than the Sun's own marker's edge, without needing a second,
 * separately-tuned number.
 *
 * Issue #217 (scope expansion): previously aliased to `SUN_CORE_MIN_RADIUS_PC`,
 * which - despite the name - was actually issue #136's "MID" breakpoint value
 * (0.5pc), not the curve's true minimum (that distinction only made sense
 * back when the Sun's curve had an extra segment past the RECONS boundary,
 * bottoming out at a smaller, separate floor only right at the camera's
 * exact `minDistance`). Now that `sunCoreRadiusPc` is flat at a single floor
 * for the Sun's ENTIRE inside-the-boundary range (see that function's
 * docstring), this margin correctly derives from that same single floor
 * (`SUN_CORE_FLOOR_RADIUS_PC`, 0.02pc) instead - shrinking from 0.5pc to
 * 0.02pc. This does not change what this constant is FOR (still just "how
 * far past the nearest object the enforced zoom floor sits, so the camera
 * can't clip inside the Sun's own marker") - it lets the camera zoom in
 * measurably closer than before, which is the correct behavior now that the
 * Sun's marker at that same close range is itself smaller (0.02pc, matching
 * a fully-shrunk star, rather than the old 0.5pc "stay prominent" value). */
const MIN_ZOOM_MARGIN_PC = SUN_CORE_FLOOR_RADIUS_PC;

/**
 * Issue #134: the OrbitControls close-zoom floor (pc), derived from the
 * real loaded catalog rather than the pre-#134 hard-coded `5` - which sat
 * well outside Alpha Centauri A/B (~1.347pc from the Sun) and Proxima
 * Centauri (~1.302pc, the actual nearest real object in the catalog as of
 * 2026-08-22's `scene.json`), so the user could never zoom in close enough
 * to visually separate the Sun from its own nearest neighbor even though
 * #113/#119's LOD-shrunk marker radii render sensibly much closer than 5pc.
 *
 * Mirrors `lod.ts`'s `denseBatchCollectionRadiusPc` (#104): a plain scan
 * over the loaded `SceneObject[]` for the true minimum, rather than a
 * hard-coded guess, so this tracks the real catalog automatically if it's
 * ever re-resolved with a closer object. Excludes the Sun and any other
 * dedicated-marker entry (`objects.ts`'s `excludeDedicatedMarkerObjects` -
 * today just the Sun and the Local Bubble centroid) the same way the
 * generic catalog render loop already does, so this can never mistake the
 * origin itself (or an unrelated centroid point) for "the nearest star".
 *
 * Returns `FALLBACK_MIN_DISTANCE_PC` if `objects` has no non-dedicated-marker
 * entries at all (shouldn't happen with real data, but keeps this function
 * total rather than returning `Infinity`/`NaN` for an empty/malformed scene).
 */
export function deriveMinZoomDistancePc(objects: SceneObject[]): number {
  let nearestPc = Number.POSITIVE_INFINITY;
  for (const obj of excludeDedicatedMarkerObjects(objects)) {
    if (obj.distance_pc < nearestPc) {
      nearestPc = obj.distance_pc;
    }
  }
  if (!Number.isFinite(nearestPc)) {
    return FALLBACK_MIN_DISTANCE_PC;
  }
  return nearestPc + MIN_ZOOM_MARGIN_PC;
}

/**
 * Issue #197: pure dolly-distance computation for the bottom-left toolbar's
 * Zoom In (+) / Zoom Out (-) buttons - moves `position` along the existing
 * camera->target line by `factor` (values below 1 move closer/"zoom in",
 * above 1 move away/"zoom out"), clamping the resulting distance to
 * `[minDistance, maxDistance]` the same way `OrbitControls`' own scroll-wheel
 * zoom already respects `controls.minDistance`/`maxDistance` (`createControls`
 * above). Kept free of `THREE`/`OrbitControls` (plain tuples in, plain tuple
 * out) so it's unit-testable without a WebGL context (spec §38) - `main.ts`'s
 * zoom button handlers are thin wrappers supplying the live
 * `camera.position`/`controls.target`/`controls.minDistance`/`maxDistance`
 * and writing the result back onto the real `camera.position` themselves.
 *
 * Degenerate case: if `position` and `target` already coincide (zero
 * current distance), there is no direction to scale along - returns
 * `position` unchanged rather than producing a `NaN` result.
 */
export function dollyPosition(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
  factor: number,
  minDistance: number,
  maxDistance: number,
): [number, number, number] {
  const [px, py, pz] = position;
  const [tx, ty, tz] = target;
  const dx = px - tx;
  const dy = py - ty;
  const dz = pz - tz;
  const currentDistance = Math.hypot(dx, dy, dz);
  if (currentDistance === 0) {
    return [px, py, pz];
  }
  const desiredDistance = currentDistance * factor;
  const clampedDistance = Math.min(Math.max(desiredDistance, minDistance), maxDistance);
  const scale = clampedDistance / currentDistance;
  return [tx + dx * scale, ty + dy * scale, tz + dz * scale];
}

/**
 * Issue #201: applies `dollyPosition`'s step `steps` times in a row, for the
 * "fit" buttons' extra zoom-out padding (Show All +3, Fit to Local Bubble
 * +2, Fit to Nearest-Stars Sphere +6 - `main.ts`'s
 * `applyCameraPoseWithExtraZoomOut`). Deliberately reuses `dollyPosition`
 * itself (one call per step, each re-clamped to `[minDistance,
 * maxDistance]`) rather than reimplementing the step math as a single
 * "distance * factor^steps" computation - this way it can never drift out of
 * sync with what `steps` real "-" button clicks would actually produce
 * (`main.ts`'s `zoomBy`), and behaves identically to that under clamping:
 * once a single step saturates at `minDistance`/`maxDistance`, every
 * subsequent step is also computed from (and clamped to) that same
 * saturated distance, exactly as repeated live clicks would.
 *
 * `steps <= 0` is a no-op (returns `position` unchanged) - callers only ever
 * pass positive counts today, but this keeps the function total rather than
 * silently reversing direction for a negative count.
 */
export function dollyPositionSteps(
  position: readonly [number, number, number],
  target: readonly [number, number, number],
  factor: number,
  minDistance: number,
  maxDistance: number,
  steps: number,
): [number, number, number] {
  let result: [number, number, number] = [position[0], position[1], position[2]];
  for (let i = 0; i < steps; i++) {
    result = dollyPosition(result, target, factor, minDistance, maxDistance);
  }
  return result;
}

export function createControls(
  camera: PerspectiveCamera,
  domElement: HTMLElement,
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  // Issue #134: this is the pre-scene-load fallback only - `main.ts`'s
  // `loadScene().then(...)` overwrites this with the real data-derived
  // floor (`deriveMinZoomDistancePc` above) once the catalog is available.
  controls.minDistance = FALLBACK_MIN_DISTANCE_PC;
  controls.maxDistance = 20_000;
  controls.update();
  return controls;
}
