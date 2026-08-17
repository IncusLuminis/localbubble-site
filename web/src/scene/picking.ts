import { Camera, Object3D, Raycaster, Vector2 } from "three";
import type { SceneObject } from "./sceneTypes";

/**
 * Object picking (spec Idea.md §22: "object picking"; §24: "Clicking or
 * selecting an object should display its metadata"). Thin wrapper around
 * `THREE.Raycaster` against the catalog-object meshes built by
 * `scene/objects.ts` (each mesh carries its originating `SceneObject` on
 * `mesh.userData.sceneObject`, see `createCatalogObjectGroup`).
 *
 * Only considers meshes whose current `.visible` is true, so a
 * radius-filtered-out or layer-toggled-off object can't be picked (matches
 * what the user can actually see, per spec §24's plain "clicking an
 * object" framing - there is nothing to click on a hidden marker).
 */

/** Convert a pointer/mouse client position to normalized device
 * coordinates ([-1, 1] on both axes) for `Raycaster.setFromCamera`. */
export function toNdc(clientX: number, clientY: number, rect: DOMRect): Vector2 {
  return new Vector2(
    ((clientX - rect.left) / rect.width) * 2 - 1,
    -((clientY - rect.top) / rect.height) * 2 + 1,
  );
}

/**
 * Raycast from `camera` through `ndc` against `group`'s descendants;
 * returns the nearest hit's `SceneObject`, or `null` if nothing visible was
 * hit.
 */
export function pickSceneObject(
  raycaster: Raycaster,
  camera: Camera,
  ndc: Vector2,
  group: Object3D,
): SceneObject | null {
  raycaster.setFromCamera(ndc, camera);
  const hits = raycaster.intersectObjects(group.children, false);
  for (const hit of hits) {
    if (!hit.object.visible) {
      continue;
    }
    const sceneObject = hit.object.userData.sceneObject as SceneObject | undefined;
    if (sceneObject) {
      return sceneObject;
    }
  }
  return null;
}
