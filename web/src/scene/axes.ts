import { AxesHelper } from "three";

/**
 * Optional coordinate axes (spec Idea.md §27): "+X -> Galactic Center,
 * +Y -> Galactic rotation, +Z -> North Galactic Pole". Included here since
 * it is cheap and helps visually validate orientation (per Story #64's
 * brief) - not made toggleable, since UI toggles are #65's scope.
 *
 * `THREE.AxesHelper` draws lines along the object's own local +X (red),
 * +Y (green), +Z (blue) axes from the origin - which line up with the
 * Galactic frame's axes exactly as defined, with no permutation needed,
 * since scene object positions are placed with an identity mapping (see
 * `scene/sceneData.ts`).
 */
export function createAxes(sizePc: number): AxesHelper {
  const axes = new AxesHelper(sizePc);
  axes.name = "coordinate-axes";
  return axes;
}
