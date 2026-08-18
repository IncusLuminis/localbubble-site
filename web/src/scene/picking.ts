import { Camera, InstancedMesh, Raycaster, Vector2 } from "three";
import type { CatalogBucket } from "./objects";
import type { SceneObject } from "./sceneTypes";

/**
 * Object picking (spec Idea.md §22: "object picking"; §24: "Clicking or
 * selecting an object should display its metadata"). Thin wrapper around
 * `THREE.Raycaster` against the per-`object_type` `InstancedMesh` buckets
 * built by `scene/objects.ts` (issue #89's `InstancedMesh` conversion).
 *
 * `Raycaster.intersectObject` on an `InstancedMesh` returns an
 * `.instanceId` (the index within that bucket's instance buffer) rather
 * than the plain-`Mesh`-era `userData.sceneObject` - resolved back to the
 * real `SceneObject` via the bucket's own `objects[]` index mapping (see
 * `CatalogBucket`, same order the matrices were built in).
 *
 * A radius-filtered-out or layer-toggled-off object is never picked - not
 * via any explicit `.visible` check here, but because `scene/objects.ts`
 * already collapses such an instance's transform to zero scale, which
 * (deliberately) makes it unhittable by a raycast in the first place -
 * matches what the user can actually see, per spec §24's plain "clicking an
 * object" framing.
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
 * Raycast from `camera` through `ndc` against every bucket's
 * `InstancedMesh`; returns the nearest hit's `SceneObject` (resolved via
 * the hit's `.instanceId` and the owning bucket's `objects[]` mapping), or
 * `null` if nothing was hit.
 */
export function pickSceneObject(
  raycaster: Raycaster,
  camera: Camera,
  ndc: Vector2,
  buckets: CatalogBucket[],
): SceneObject | null {
  raycaster.setFromCamera(ndc, camera);

  const meshToBucket = new Map<InstancedMesh, CatalogBucket>(
    buckets.map((bucket) => [bucket.mesh, bucket]),
  );
  const hits = raycaster.intersectObjects(buckets.map((bucket) => bucket.mesh), false);

  for (const hit of hits) {
    if (hit.instanceId === undefined) {
      continue;
    }
    const bucket = meshToBucket.get(hit.object as InstancedMesh);
    const sceneObject = bucket?.objects[hit.instanceId];
    if (sceneObject) {
      return sceneObject;
    }
  }
  return null;
}
