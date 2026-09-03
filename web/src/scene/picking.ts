import { Camera, InstancedMesh, Mesh, Object3D, Raycaster, Vector2 } from "three";
import type { CatalogBucket } from "./objects";
import type { DiffuseStructureMesh } from "./diffuseStructures";
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
 * `InstancedMesh`, plus (Story #315) every individual diffuse-structure
 * `Mesh` in `diffuseMeshes`; returns the nearest hit's `SceneObject`
 * (resolved via the hit's `.instanceId` and the owning bucket's `objects[]`
 * mapping for an `InstancedMesh` hit, or a direct `mesh -> object` lookup
 * for a diffuse-structure `Mesh` hit), or `null` if nothing was hit.
 *
 * Story #315: the four diffuse-structure types (`molecular_cloud`/
 * `hii_region`/`planetary_nebula`/`supernova_remnant`) moved from
 * `CatalogBucket` `InstancedMesh` point markers to individual translucent
 * `Mesh`es (`scene/diffuseStructures.ts`) and so stopped being present in
 * `buckets` at all - without this second target list, clicking one of
 * those ~19 objects would silently stop opening the Inspector, a picking
 * regression this Story's own scope doesn't call out but that would
 * clearly read as broken to a user. `diffuseMeshes` defaults to `[]` so
 * every pre-#315 caller/test that only passes `buckets` keeps working
 * unchanged.
 *
 * `THREE.Raycaster.intersectObjects` does NOT consult `Object3D.visible` on
 * its own - that flag only affects the WebGL render pass, not raycasting
 * (verified directly against `node_modules/three`'s own `Raycaster.js`: the
 * internal `intersect()` helper calls `object.raycast()` unconditionally,
 * with no `visible` check anywhere in the call chain). `objects.ts`'s
 * `InstancedMesh` buckets never needed an explicit check for this reason -
 * a hidden instance is made unhittable by collapsing its own transform to
 * zero scale instead (see that module's docstring), which the raycast's
 * own ray-vs-bounding-sphere math already naturally misses. A diffuse-
 * structure `Mesh` has no such trick applied to it
 * (`updateDiffuseStructureVisibility` just sets `.visible`, the idiomatic
 * API for a real, non-instanced `Mesh`) - so this function filters
 * `diffuseMeshes` down to the currently-visible ones itself, before
 * raycasting, rather than relying on `Raycaster` to skip them (it won't).
 */
export function pickSceneObject(
  raycaster: Raycaster,
  camera: Camera,
  ndc: Vector2,
  buckets: CatalogBucket[],
  diffuseMeshes: readonly DiffuseStructureMesh[] = [],
): SceneObject | null {
  raycaster.setFromCamera(ndc, camera);

  const visibleDiffuseMeshes = diffuseMeshes.filter(({ mesh }) => mesh.visible);

  const meshToBucket = new Map<InstancedMesh, CatalogBucket>(
    buckets.map((bucket) => [bucket.mesh, bucket]),
  );
  const meshToObject = new Map<Mesh, SceneObject>(
    visibleDiffuseMeshes.map(({ mesh, object }) => [mesh, object]),
  );
  const targets: Object3D[] = [
    ...buckets.map((bucket) => bucket.mesh),
    ...visibleDiffuseMeshes.map(({ mesh }) => mesh),
  ];
  const hits = raycaster.intersectObjects(targets, false);

  for (const hit of hits) {
    const bucket = meshToBucket.get(hit.object as InstancedMesh);
    if (bucket) {
      if (hit.instanceId === undefined) {
        continue;
      }
      const sceneObject = bucket.objects[hit.instanceId];
      if (sceneObject) {
        return sceneObject;
      }
      continue;
    }
    const diffuseObject = meshToObject.get(hit.object as Mesh);
    if (diffuseObject) {
      return diffuseObject;
    }
  }
  return null;
}
