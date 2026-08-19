import { MathUtils } from "three";

/**
 * Field-of-view real-world extent (issue #125): "how wide/tall is the
 * visible slice of space at the point I'm currently looking at/orbiting
 * around" - i.e. the horizontal/vertical extent (in pc) of the camera's
 * view frustum at the distance from the camera to `OrbitControls.target`
 * (the point the camera orbits around, per `main.ts`'s `applyCameraPose`
 * and camera presets).
 *
 * Deliberately a plain, camera/DOM-free function (no `PerspectiveCamera`
 * dependency) so it's unit-testable without a real Three.js scene - the
 * caller (`ui/fovReadout.ts`, wired into `main.ts`'s `animate()` loop) is
 * responsible for reading `camera.fov`/`camera.aspect`/
 * `camera.position.distanceTo(controls.target)` live each frame.
 *
 * Standard perspective-camera frustum-extent formula: the vertical field of
 * view `fovDeg` and the `distancePc` to the target determine the visible
 * height at that distance; `aspect` (width / height) scales that into the
 * visible width.
 */
export interface FovExtentPc {
  horizontalPc: number;
  verticalPc: number;
}

export function fovExtentPc(fovDeg: number, aspect: number, distancePc: number): FovExtentPc {
  const verticalPc = 2 * distancePc * Math.tan(MathUtils.degToRad(fovDeg) / 2);
  const horizontalPc = verticalPc * aspect;
  return { horizontalPc, verticalPc };
}
