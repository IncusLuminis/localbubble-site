import type { SceneObject } from "./sceneTypes";

/**
 * Camera-distance-gated (LOD) marker visibility for dense, close-in
 * catalog batches (issue #104, spec `Idea-v1.3-visual-fidelity-and-
 * navigation.md` §2.4).
 *
 * The RECONS "100 nearest stellar systems" batch (`data/raw/recons/`) is a
 * magnitude/parallax-limited census, not a "luminous star" selection like
 * the Galaxy Map poster batch (issue #88) - it resolves ~122 real stars
 * within ~11 pc of the Sun, a region where the poster-sourced catalog has
 * almost nothing (poster stars are heavily biased toward bright/distant
 * giants). Rendered unconditionally, that density right around the Sun
 * would reintroduce issue #89's clutter problem at the default/overview
 * zoom the InstancedMesh bucketing + label capping already solved for the
 * sparser existing catalog.
 *
 * Unlike `labels.ts`'s `effectiveMaxLabelDistancePc` (which *grows* the
 * label-visibility threshold as the camera pulls back, so a zoomed-out
 * view still shows *some* labels), this batch should do the opposite:
 * stay hidden by default and only appear once the camera has zoomed in
 * close enough that showing every member no longer floods the view - i.e.
 * gated OFF at the default camera pose, gated ON only within roughly this
 * batch's own collection radius of the Sun (issue #104's own suggested
 * default).
 *
 * Batch membership is read from `SceneObject.group.secondary` (spec §7's
 * existing free-form provenance-tag list) rather than a new schema field
 * or a hard-coded id list - this is a *provenance/resolution-batch*
 * concept (which Story a record came from), not a physical-type one
 * (`object_type` already covers that for other purposes, e.g.
 * `objects.ts`'s per-type color buckets), and it mirrors how the Python
 * pipeline already tags every RECONS-resolved record with
 * `"recons-nearest-100"` (see `data/raw/recons/README.md`).
 */
export const DENSE_BATCH_GROUP_TAG = "recons-nearest-100";

/** True if `obj` belongs to the LOD-gated dense batch. */
export function isDenseBatchMember(obj: SceneObject): boolean {
  return obj.group.secondary.includes(DENSE_BATCH_GROUP_TAG);
}

/**
 * The dense batch's own "collection radius" (pc): the farthest heliocentric
 * distance, among the objects tagged `DENSE_BATCH_GROUP_TAG` actually
 * present in `objects`, that the underlying candidate list was resolved
 * out to. Derived from the data itself rather than a hard-coded constant
 * (spec §28's "must not hard-code a permanent limit" principle, applied
 * here to the LOD threshold too) - if the batch is ever re-resolved with a
 * larger or smaller candidate list, this threshold tracks it automatically
 * instead of silently going stale. Returns `0` if no tagged object is
 * present (nothing to gate - `passesDenseBatchLod` below then only ever
 * sees non-members anyway).
 */
export function denseBatchCollectionRadiusPc(objects: readonly SceneObject[]): number {
  let max = 0;
  for (const obj of objects) {
    if (isDenseBatchMember(obj) && obj.distance_pc > max) {
      max = obj.distance_pc;
    }
  }
  return max;
}

/**
 * The dense-batch LOD predicate: objects that are NOT in the gated batch
 * always pass here (`true`) - this function only ever *restricts* dense-
 * batch members, on top of whatever category/radius-filter visibility a
 * caller applies separately (see `objects.ts`'s `isCatalogObjectVisible`,
 * which combines all three). A dense-batch member passes only once
 * `cameraDistanceFromOriginPc` (the camera's distance from the Sun, spec
 * §6's coordinate origin - NOT the object's own distance) is within
 * `collectionRadiusPc`.
 */
export function passesDenseBatchLod(
  obj: SceneObject,
  cameraDistanceFromOriginPc: number,
  collectionRadiusPc: number,
): boolean {
  if (!isDenseBatchMember(obj)) {
    return true;
  }
  return cameraDistanceFromOriginPc <= collectionRadiusPc;
}

/**
 * Issue #137: a single "is the camera currently inside the dense batch's own
 * collection sphere at all" boolean - unlike `passesDenseBatchLod` above
 * (which answers "should THIS object be visible", and always returns `true`
 * for non-members regardless of camera position), this is a plain,
 * object-independent camera-position check, needed so `main.ts` can decide
 * whether to dim the "background" (non-star catalog buckets, structure-layer
 * overlays) once the camera is inside the same sphere the RECONS nearby-star
 * neighborhood is spotlighted within (see `objects.ts`'s
 * `updateBackgroundDimming`/`structures.ts`'s `set*Dimmed` helpers).
 *
 * Same inclusive (`<=`) boundary and same `collectionRadiusPc <= 0` ("scene
 * not loaded yet" - nothing to be inside of) guard as `passesDenseBatchLod`,
 * so the dimming trigger and the dense-batch visibility/radius LOD effects
 * all agree on exactly where "inside the sphere" begins.
 */
export function isCameraInsideDenseBatchSphere(
  cameraDistanceFromOriginPc: number,
  collectionRadiusPc: number,
): boolean {
  if (collectionRadiusPc <= 0) {
    return false;
  }
  return cameraDistanceFromOriginPc <= collectionRadiusPc;
}
