import { Camera, InstancedMesh, Matrix4, Mesh, Object3D, Quaternion, Raycaster, Vector2, Vector3 } from "three";
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
 *
 * Issue #5: accepts an optional `tapTolerance` (canvas CSS-pixel dimensions)
 * as its final argument - when given, and the exact raycast above finds
 * nothing at all, falls back to `findTapFallbackObject` below rather than
 * returning `null` outright. See that function's own docstring for why this
 * exists and how it's scoped; omitting the argument (every pre-#5 caller,
 * including every pre-#5 test in `test/picking.test.ts`) keeps this
 * function's exact prior behavior with zero change.
 */
export function pickSceneObject(
  raycaster: Raycaster,
  camera: Camera,
  ndc: Vector2,
  buckets: CatalogBucket[],
  diffuseMeshes: readonly DiffuseStructureMesh[] = [],
  tapTolerance?: TapTolerance,
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

  if (tapTolerance) {
    return findTapFallbackObject(camera, ndc, buckets, tapTolerance);
  }
  return null;
}

/** Canvas CSS-pixel dimensions `findTapFallbackObject`/`apparentRadiusPx`
 * need to convert an NDC delta into an actual on-screen pixel distance -
 * NDC space is a `[-1, 1]` square regardless of aspect ratio, so the same
 * NDC delta means a different pixel distance on the X axis than the Y axis
 * whenever the canvas isn't square. `main.ts` derives this from the same
 * `renderer.domElement.getBoundingClientRect()` its click handler already
 * reads to build `ndc` itself via `toNdc`. */
export interface TapTolerance {
  canvasWidthPx: number;
  canvasHeightPx: number;
}

/** Issue #5: how close (CSS pixels) a tap must land to an instance's
 * projected center, AND how small (CSS pixels) that instance's own
 * projected on-screen radius must be, for `findTapFallbackObject` to
 * consider it a candidate at all. One shared constant for both roles is
 * deliberate, not an accident of reuse: this is meant to model "a marker
 * small enough that a fingertip can plausibly miss it by up to this much,"
 * so the tolerance a tap gets should scale with the same notion of size the
 * eligibility check itself uses. ~20px matches the commonly-cited ~40x40 CSS
 * pixel comfortable-touch-target guideline (Apple HIG / Material Design)
 * used as this radius's own justification elsewhere in this codebase (see
 * `starMarkerScale.ts`'s `STAR_MARKER_MIN_RADIUS_PC` docstring, which cites
 * the same figure for the visibility half of this same underlying problem).
 *
 * This is NOT applied to every instance regardless of size - see
 * `findTapFallbackObject`'s own docstring for why a marker whose own
 * apparent radius already exceeds this constant is excluded from the
 * fallback entirely, keeping already-comfortably-sized markers at their
 * existing exact-geometry precision. */
export const TAP_FALLBACK_RADIUS_PX = 20;

/** Reused across `findTapFallbackObject` calls to avoid an allocation per
 * candidate instance per tap, mirroring `objects.ts`'s own scratch-object
 * convention for its hot per-instance paths. A tap is a rare, user-triggered
 * event (not a per-frame concern), so this is a minor nicety rather than a
 * measured necessity - but there's no reason to allocate four fresh
 * `Matrix4`/`Vector3`/`Quaternion`s for every one of up to ~700 catalog
 * instances on every single click either. */
const scratchInstanceLocalMatrix = new Matrix4();
const scratchInstanceWorldMatrix = new Matrix4();
const scratchInstancePosition = new Vector3();
const scratchInstanceScale = new Vector3();
const scratchInstanceQuaternion = new Quaternion();
const scratchCameraForward = new Vector3();
const scratchCameraRight = new Vector3();
const scratchEdgePosition = new Vector3();
const scratchCenterNdc = new Vector3();
const scratchEdgeNdc = new Vector3();

/** Scale below which an instance is treated as hidden (issue #89's
 * zero-scale visibility mechanism, `objects.ts`'s `HIDDEN_INSTANCE_SCALE`) -
 * a small positive epsilon rather than an exact `=== 0` check purely as
 * float-safety margin around `Matrix4.decompose`'s own floating-point
 * arithmetic; every real visible instance's radius is many orders of
 * magnitude above this. */
const HIDDEN_SCALE_EPSILON = 1e-9;

/**
 * The on-screen apparent radius (CSS pixels) of a sphere of world-space
 * radius `worldRadiusPc` centered at `worldPosition`, as seen through
 * `camera` on a `canvasWidthPx`x`canvasHeightPx` viewport - or `0` if
 * `worldPosition` is behind the camera or the projection is otherwise
 * degenerate (can't happen for a real render, but a defensive fallback
 * function like this one should never throw or return `NaN`/`Infinity` on
 * an unexpected input).
 *
 * Computed generically (works for `PerspectiveCamera`, this app's only
 * camera type per `scene/camera.ts`, without hard-coding its FOV math, and
 * would keep working unmodified if an `OrthographicCamera` were ever added):
 * projects both the sphere's center and one point on its surface (offset
 * along the camera's own local +X/"right" axis, taken directly from column
 * 0 of `camera.matrixWorld` - correct for any camera orientation, not just
 * one looking down -Z) to NDC, converts the NDC delta between them to a
 * pixel delta (accounting for a non-square canvas, per `TapTolerance`'s own
 * docstring), and returns its length. This is an approximation (a true
 * perspective-projected sphere silhouette isn't an exact circle off-axis),
 * but well within tolerance for this function's only real use - deciding
 * whether an already-tiny marker's own apparent size is small enough to
 * qualify for the tap-fallback tolerance in the first place. */
export function apparentRadiusPx(
  camera: Camera,
  worldPosition: Vector3,
  worldRadiusPc: number,
  canvasWidthPx: number,
  canvasHeightPx: number,
): number {
  if (worldRadiusPc <= 0) {
    return 0;
  }
  scratchCameraForward.setFromMatrixColumn(camera.matrixWorld, 2).negate();
  const toObject = scratchEdgePosition.copy(worldPosition).sub(camera.position);
  if (toObject.dot(scratchCameraForward) <= 0) {
    return 0;
  }

  scratchCameraRight.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
  scratchEdgePosition.copy(worldPosition).addScaledVector(scratchCameraRight, worldRadiusPc);

  scratchCenterNdc.copy(worldPosition).project(camera);
  scratchEdgeNdc.copy(scratchEdgePosition).project(camera);

  if (![scratchCenterNdc.x, scratchCenterNdc.y, scratchEdgeNdc.x, scratchEdgeNdc.y].every(Number.isFinite)) {
    return 0;
  }

  const dxPx = ((scratchEdgeNdc.x - scratchCenterNdc.x) / 2) * canvasWidthPx;
  const dyPx = ((scratchEdgeNdc.y - scratchCenterNdc.y) / 2) * canvasHeightPx;
  return Math.hypot(dxPx, dyPx);
}

/**
 * Issue #5 ("Mobile: RECONS-sphere star markers are visible but not
 * tappable"): a screen-space fallback, tried only when `pickSceneObject`'s
 * ordinary exact `Raycaster` pass hits nothing at all. Scans every visible
 * `CatalogBucket` instance (every `object_type` that lives in an
 * `InstancedMesh` bucket - stars, star clusters, associations; NOT the
 * `diffuseMeshes` handled separately by `pickSceneObject`, see below),
 * keeps only the ones whose own apparent on-screen radius is under
 * `TAP_FALLBACK_RADIUS_PX`, and among THOSE, returns the one whose projected
 * center is nearest the tap point in screen-space pixels - or `null` if none
 * lands within `TAP_FALLBACK_RADIUS_PX` of the tap at all.
 *
 * Why this approach over the alternatives considered (see this issue's own
 * "Required investigation" for the full list):
 * - A second, invisible, enlarged-scale `InstancedMesh` mirroring each
 *   bucket (the `InstancedMesh`-equivalent of `diffuseStructures.ts`'s
 *   per-object picking-proxy `Mesh` pattern) would need its own instance
 *   matrix kept in perfect sync with the visible mesh's, at every one of
 *   `objects.ts`'s several existing per-instance matrix-writing call sites
 *   (`setInstanceVisibility` itself, plus the motion player's per-frame
 *   position overrides, plus `updateCatalogSizeScale`'s own per-instance
 *   rewrite for the "Object size" slider) - real, ongoing duplication risk
 *   for a system that already
 *   dynamically recomputes a shrink-eligible star's radius every frame,
 *   for a payoff (a real second raycast target) this screen-space
 *   approach gets without touching `objects.ts` at all.
 * - An artificially-enlarged-scale raycast pass (temporarily inflating each
 *   instance's matrix scale just for the raycast, then restoring it) has
 *   the same "which instances get inflated, and by how much, relative to
 *   their real radius" design question this function already has to
 *   answer, but pays for it by mutating and restoring live instance
 *   matrices used for the ACTUAL RENDER on every single tap - fragile if
 *   any exception/early-return skipped the restore step, and this is
 *   exactly the kind of code a future refactor could easily get wrong.
 *
 * The apparent-radius eligibility gate (excluding any instance whose own
 * projected radius already exceeds `TAP_FALLBACK_RADIUS_PX`) is what keeps
 * this scoped to small/shrunk markers specifically, per the issue's own
 * requirement (b): a comfortably-large marker keeps its exact prior
 * click-precision unchanged, because it's simply never a candidate here -
 * only markers already too small to have much exact-geometry precision to
 * protect gain a fallback at all.
 *
 * Nearest-to-tap-point (not nearest-to-camera) tie-breaking is deliberate,
 * per the issue's own explicit requirement: two tiny, nearby RECONS-sphere
 * stars both within tolerance of one tap should resolve to whichever one
 * the user's fingertip was actually closer to, not whichever happens to sit
 * closer to the camera in true 3D depth (which has no necessary relationship
 * to where on the 2D screen the user was aiming). */
export function findTapFallbackObject(
  camera: Camera,
  ndc: Vector2,
  buckets: CatalogBucket[],
  tapTolerance: TapTolerance,
): SceneObject | null {
  const { canvasWidthPx, canvasHeightPx } = tapTolerance;
  let bestObject: SceneObject | null = null;
  let bestDistancePx = TAP_FALLBACK_RADIUS_PX;

  for (const bucket of buckets) {
    for (let index = 0; index < bucket.objects.length; index++) {
      bucket.mesh.getMatrixAt(index, scratchInstanceLocalMatrix);
      scratchInstanceWorldMatrix.multiplyMatrices(bucket.mesh.matrixWorld, scratchInstanceLocalMatrix);
      scratchInstanceWorldMatrix.decompose(
        scratchInstancePosition,
        scratchInstanceQuaternion,
        scratchInstanceScale,
      );

      const worldRadiusPc = scratchInstanceScale.x;
      if (worldRadiusPc <= HIDDEN_SCALE_EPSILON) {
        continue; // Hidden instance (issue #89's zero-scale mechanism) - never tappable.
      }
      if (apparentRadiusPx(camera, scratchInstancePosition, worldRadiusPc, canvasWidthPx, canvasHeightPx) >= TAP_FALLBACK_RADIUS_PX) {
        continue; // Already comfortably sized - keep exact-geometry-only precision for it.
      }

      scratchCenterNdc.copy(scratchInstancePosition).project(camera);
      if (!Number.isFinite(scratchCenterNdc.x) || !Number.isFinite(scratchCenterNdc.y)) {
        continue;
      }
      const dxPx = ((scratchCenterNdc.x - ndc.x) / 2) * canvasWidthPx;
      const dyPx = ((ndc.y - scratchCenterNdc.y) / 2) * canvasHeightPx;
      const distancePx = Math.hypot(dxPx, dyPx);

      if (distancePx < bestDistancePx) {
        bestDistancePx = distancePx;
        bestObject = bucket.objects[index] ?? null;
      }
    }
  }

  return bestObject;
}
