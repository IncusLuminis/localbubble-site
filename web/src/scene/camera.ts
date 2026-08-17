import { PerspectiveCamera, Vector3 } from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";

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

export function createControls(
  camera: PerspectiveCamera,
  domElement: HTMLElement,
): OrbitControls {
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 0, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.screenSpacePanning = true;
  controls.minDistance = 5;
  controls.maxDistance = 20_000;
  controls.update();
  return controls;
}
