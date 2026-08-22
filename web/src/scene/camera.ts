import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { SceneObject } from "./sceneTypes";
import { excludeDedicatedMarkerObjects } from "./objects";
import { SUN_CORE_MIN_RADIUS_PC } from "./sun";

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
 * `SUN_CORE_MIN_RADIUS_PC` (0.15pc, `scene/sun.ts`) rather than an
 * independent margin constant: that's exactly the Sun core's own
 * fully-shrunk radius at this close a zoom (see `sunCoreRadiusPc`'s
 * docstring - any camera distance this close is already within the RECONS
 * dense batch's collection radius, issue #104, so the core has finished
 * shrinking to its point-like floor). Anchoring the margin to that value
 * guarantees the camera can never be closer to the origin than the Sun's
 * own marker's edge, without needing a second, separately-tuned number. */
const MIN_ZOOM_MARGIN_PC = SUN_CORE_MIN_RADIUS_PC;

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
