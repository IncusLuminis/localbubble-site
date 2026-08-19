import {
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { SceneObject } from "./sceneTypes";
import { positionToVector3 } from "./sceneData";
import { isWithinRadius } from "./radiusFilter";
import { isDenseBatchMember, passesDenseBatchLod } from "./lod";

/**
 * Catalog object rendering (spec Idea.md §22/§45, issue #64: "Catalog
 * objects loaded from the scene export and rendered in their correct
 * positions"). Basic per-`object_type` color/size distinction only - a
 * full styling system is explicitly out of scope (spec §41 defers heavy
 * visual refinement to Phase 7).
 *
 * Story #88 grew the catalog from ~20 to 605 objects (585 of them
 * individual stars). Issue #89: at that scale, one plain `THREE.Mesh` per
 * object (the original Story #64 approach, back when "do not prematurely
 * optimize for millions of stars" - spec §44 - genuinely meant "don't
 * bother yet") stops being the cheap option. This module now builds one
 * `THREE.InstancedMesh` per `object_type` (matching `OBJECT_TYPE_COLORS`'s
 * existing per-type color bucketing) - a single shared unit-radius
 * `SphereGeometry` per bucket, with each instance's transform matrix
 * encoding both its position AND its own per-object radius as a uniform
 * scale (`Matrix4.compose`). This keeps geometry/draw-call count at "one
 * per object_type" (~7-9 buckets) regardless of how large the catalog
 * grows, instead of "one per object".
 *
 * Per-instance show/hide (category toggle, radius filter) has no direct
 * `InstancedMesh` equivalent to a plain `Mesh`'s `.visible` - the standard
 * trick, used throughout this module, is to collapse a hidden instance's
 * transform to zero scale rather than remove it from the buffer: instance
 * count/indices stay stable (so the index -> `SceneObject` mapping below
 * never shifts), and a zero-scale sphere is both invisible to the renderer
 * and (for `scene/picking.ts`'s purposes) unhittable by a raycast, since
 * its transformed bounding sphere collapses to a single point.
 *
 * The Sun is itself present in `scene.json`'s `objects` array (`id: "sun"`,
 * `object_type: "reference_point"`, `position_pc: [0, 0, 0]`) - it's a real
 * catalog entry from the Python pipeline's point of view. It already gets
 * its own dedicated, distinctly-styled marker (`scene/sun.ts`), so this
 * generic catalog loop must exclude it - otherwise it draws a second,
 * generic-grey sphere on top of the dedicated marker, both at the exact
 * origin (found in PR #79 review; see `SUN_OBJECT_ID`).
 *
 * Issue #101 found the same problem for the Local Bubble: `scene.json`
 * carries a `local-bubble-centroid` point (`object_type: "bubble"`,
 * `size_pc: 60`) that this generic loop would otherwise draw as a 15pc
 * marker sphere (`markerRadiusPc(60)`) at the same time `scene/structures.ts`'s
 * `createLocalBubbleLayer` draws a true-scale wireframe ellipsoid for the
 * exact same real object - two disagreeing representations at once (the Sun
 * sits outside the 15pc marker but inside the true-scale ellipsoid, which is
 * what surfaced the bug). Same fix, same mechanism: exclude it here and let
 * the structure layer be the sole visual (see `LOCAL_BUBBLE_OBJECT_ID`).
 */

/** `scene.json`'s stable id for the Sun's own catalog entry (see
 * `src/local_galactic_structures/initial_catalog.py`/the checked-in
 * initial-catalog records). Filtered out of the generic catalog-object
 * render loop below because the Sun already has a dedicated marker
 * (`scene/sun.ts`). Matched on `id` rather than `object_type ===
 * "reference_point"` so a future, non-Sun `reference_point` object (the
 * type is not currently Sun-exclusive per spec §8) would still render
 * normally through this loop instead of being silently dropped. */
export const SUN_OBJECT_ID = "sun";

/** `scene.json`'s stable id for the Local Bubble's centroid catalog entry
 * (`object_type: "bubble"`). Filtered out of the generic catalog-object
 * render loop below (issue #101) because `scene/structures.ts`'s
 * `createLocalBubbleLayer` already renders a true-scale wireframe ellipsoid
 * for this same real object - matched on `id`, same reasoning as
 * `SUN_OBJECT_ID`, so a future non-Local-Bubble `bubble`-type object (out of
 * scope per issue #101, but not precluded by the schema) would still render
 * normally through this loop instead of being silently dropped. */
export const LOCAL_BUBBLE_OBJECT_ID = "local-bubble-centroid";

/** Catalog object ids that already have their own dedicated visual
 * representation elsewhere in the scene (a hand-styled marker or a
 * structure-layer mesh), and so must be excluded from the generic
 * catalog-object render loop below - otherwise the same real object would
 * be drawn twice, in two different (and potentially disagreeing) ways. */
const DEDICATED_MARKER_OBJECT_IDS: ReadonlySet<string> = new Set([
  SUN_OBJECT_ID,
  LOCAL_BUBBLE_OBJECT_ID,
]);

/** `scene.json` objects that should NOT be drawn by the generic catalog
 * loop because they already have their own dedicated marker. Exported so
 * `main.ts` can derive an accurate "N objects" count from the same
 * definition used to build the render group. */
export function excludeDedicatedMarkerObjects(objects: SceneObject[]): SceneObject[] {
  return objects.filter((obj) => !DEDICATED_MARKER_OBJECT_IDS.has(obj.id));
}

/**
 * Distinct `object_type` values actually present in the catalog (excluding
 * dedicated-marker entries such as the Sun and the Local Bubble centroid),
 * sorted for a stable UI order.
 *
 * Story #65's layer-toggle panel (spec §23) builds one checkbox per
 * category found here rather than a hard-coded list of the spec §8 object
 * types - this keeps the control panel accurate if the catalog later grows
 * new types (spec §8: "The type system must be extensible without changes
 * to the core architecture") without requiring a `web/` code change.
 */
export function catalogObjectTypes(objects: SceneObject[]): string[] {
  const types = new Set(excludeDedicatedMarkerObjects(objects).map((obj) => obj.object_type));
  return Array.from(types).sort();
}

const OBJECT_TYPE_COLORS: Record<string, number> = {
  star: 0xffffff,
  star_cluster: 0xffd27f,
  stellar_association: 0xff9f6b,
  molecular_cloud: 0x7fb8ff,
  star_forming_region: 0xff7fb0,
  hii_region: 0xb07fff,
  supernova_remnant: 0xff5f5f,
  bubble: 0x5fffe0,
  reference_point: 0x9aa7bd,
};

const DEFAULT_COLOR = 0xaab4c8;

/** Visual-only marker radius tiers (pc) - issue #103, spec
 * `Idea-v1.3-visual-fidelity-and-navigation.md` §2.3. This is display
 * convenience, not a scientific value (spec §19 distinguishes
 * measured/derived/model data from visual decoration).
 *
 * Before #103, every object type shared one `size_pc`-driven formula with a
 * single floor/ceiling. At 834-object scale (585 of them individual stars,
 * spec v1.2) that meant a star and a small cluster - both of which usually
 * lack `size_pc` in this catalog - rendered at the exact same radius, with
 * nothing distinguishing "this is a point-source star" from "this is a
 * genuinely-sized cluster." Confirmed against
 * `data/normalized/initial_catalog_records.json` (2026-08-18): all 585
 * `star` entries have `size_pc: null`; of 228 `star_cluster` and 10
 * `stellar_association` entries, only 1 `star_cluster` carries a nonnull
 * `size_pc` (11.6pc) - so both tiers are floor-dominated in practice, and
 * the floors themselves are what need to differ.
 *
 * Three tiers, small to large, matching the spec's decision:
 *
 * 1. Individual stars (`star`) - a single small, fixed radius, deliberately
 *    decoupled from `size_pc` entirely (stars are point sources; any nonzero
 *    radius is already a convention, spec §19/§2.3). Never varies, so stars
 *    can never accidentally grow to match a cluster's marker.
 * 2. Clusters/associations (`star_cluster`, `stellar_association`) - a
 *    mid-sized range. Still primarily floor-driven given the data above, but
 *    a real `size_pc` nudges the radius up within the tier's own range,
 *    per spec: "may still take a cue from `size_pc` where present."
 * 3. Everything else (extended structures - molecular clouds, HII regions,
 *    supernova remnants, bubbles - plus any other/future object type): the
 *    pre-#103 `size_pc`-driven range, floor raised just enough to sit
 *    strictly above tier 2's own ceiling.
 *
 * The three ranges - `STAR_MARKER_RADIUS_PC` / `[CLUSTER_MIN, CLUSTER_MAX]`
 * / `[STRUCTURE_MIN, STRUCTURE_MAX]` - are constructed not to overlap
 * (2 < [5, 9] < [10, 45]), so `star < cluster < structure` holds for *every*
 * possible `size_pc`, not just today's catalog values. */
const STAR_MARKER_RADIUS_PC = 2;

const CLUSTER_MIN_RADIUS_PC = 5;
const CLUSTER_MAX_RADIUS_PC = 9;

const STRUCTURE_MIN_RADIUS_PC = 10;
const STRUCTURE_MAX_RADIUS_PC = 45;

/** `size_pc` divisor shared by the cluster and structure tiers (unchanged
 * from the pre-#103 single-tier formula), so a given `size_pc` value means
 * the same thing in both tiers - only each tier's clamp range differs. */
const SIZE_PC_DIVISOR = 4;

const STAR_OBJECT_TYPES: ReadonlySet<string> = new Set(["star"]);
const CLUSTER_OBJECT_TYPES: ReadonlySet<string> = new Set([
  "star_cluster",
  "stellar_association",
]);

/** Exported for tests - the same visual-radius derivation, per object, that
 * gets baked into each instance's transform matrix below. Type-aware
 * (issue #103): `objectType` picks which of the three tiers above applies;
 * only the cluster/structure tiers then also look at `sizePc`, clamped to
 * that tier's own range. */
export function markerRadiusPc(sizePc: number | null, objectType: string): number {
  if (STAR_OBJECT_TYPES.has(objectType)) {
    return STAR_MARKER_RADIUS_PC;
  }

  const [minRadiusPc, maxRadiusPc] = CLUSTER_OBJECT_TYPES.has(objectType)
    ? [CLUSTER_MIN_RADIUS_PC, CLUSTER_MAX_RADIUS_PC]
    : [STRUCTURE_MIN_RADIUS_PC, STRUCTURE_MAX_RADIUS_PC];

  if (sizePc === null || !Number.isFinite(sizePc) || sizePc <= 0) {
    return minRadiusPc;
  }
  return Math.min(Math.max(sizePc / SIZE_PC_DIVISOR, minRadiusPc), maxRadiusPc);
}

const materialCache = new Map<number, MeshBasicMaterial>();
function materialFor(color: number): MeshBasicMaterial {
  let material = materialCache.get(color);
  if (!material) {
    material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    materialCache.set(color, material);
  }
  return material;
}

/** Shared unit-radius sphere geometry, reused by every bucket's
 * `InstancedMesh` - per-object size is applied entirely via each
 * instance's transform-matrix scale (see `instanceMatrixFor` below), so
 * there is never a need for more than one sphere geometry no matter how
 * many distinct `size_pc` values the catalog contains. */
const UNIT_SPHERE_GEOMETRY = new SphereGeometry(1, 16, 12);

/** Scale used to collapse a hidden instance's transform to nothing -
 * zero, exactly, so its transformed bounding sphere is a single point:
 * invisible to the renderer and (deliberately) unhittable by
 * `scene/picking.ts`'s raycaster, matching what a `visible = false` plain
 * `Mesh` used to do for both concerns at once. */
const HIDDEN_INSTANCE_SCALE = 0;

// Scratch objects reused across `instanceMatrixFor` calls to avoid an
// allocation per instance per visibility update (up to 605 objects).
const scratchMatrix = new Matrix4();
const scratchPosition = new Vector3();
const scratchScale = new Vector3();
const IDENTITY_QUATERNION = new Quaternion();

function instanceMatrixFor(obj: SceneObject, radiusPc: number): Matrix4 {
  scratchPosition.copy(positionToVector3(obj.position_pc));
  scratchScale.setScalar(radiusPc);
  return scratchMatrix.compose(scratchPosition, IDENTITY_QUATERNION, scratchScale);
}

/** One `InstancedMesh` per `object_type` bucket, plus the index -> real
 * `SceneObject` mapping (and the per-object visual radius baked into each
 * instance) that picking (`scene/picking.ts`) and visibility updates need.
 * `objects[i]`/`radiiPc[i]` correspond to instance `i` of `mesh`. */
export interface CatalogBucket {
  objectType: string;
  mesh: InstancedMesh;
  objects: SceneObject[];
  radiiPc: number[];
}

/** True if `obj` should currently be shown, given the category-toggle,
 * radius-filter, and dense-batch LOD (issue #104) state - the single
 * predicate `updateCatalogVisibility`/`updateDenseBatchLod` (which drive
 * the instance matrices) and `visibleCatalogObjects` (used for "Fit all"
 * camera framing) all evaluate against, so none of them can disagree about
 * what's actually on screen.
 *
 * `cameraDistanceFromOriginPc`/`denseBatchRadiusPc` default to
 * `Number.POSITIVE_INFINITY`, i.e. "no LOD gating" - every existing caller
 * that doesn't pass them (any object outside the LOD-gated dense batch,
 * see `lod.ts`'s `passesDenseBatchLod`) is completely unaffected. */
export function isCatalogObjectVisible(
  obj: SceneObject,
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
  cameraDistanceFromOriginPc: number = Number.POSITIVE_INFINITY,
  denseBatchRadiusPc: number = Number.POSITIVE_INFINITY,
): boolean {
  const categoryOn = categoryVisibility.get(obj.object_type) ?? true;
  return (
    categoryOn &&
    isWithinRadius(obj.distance_pc, radiusPc) &&
    passesDenseBatchLod(obj, cameraDistanceFromOriginPc, denseBatchRadiusPc)
  );
}

/** Sets instance `index` of `bucket.mesh`'s transform to its real
 * position + radius (visible) or to the zero-scale hidden transform,
 * without touching instance count/order - the standard
 * `InstancedMesh`-has-no-per-instance-`.visible` workaround (issue #89). */
export function setInstanceVisibility(bucket: CatalogBucket, index: number, visible: boolean): void {
  const obj = bucket.objects[index];
  const radiusPc = visible ? bucket.radiiPc[index] : HIDDEN_INSTANCE_SCALE;
  bucket.mesh.setMatrixAt(index, instanceMatrixFor(obj, radiusPc));
  bucket.mesh.instanceMatrix.needsUpdate = true;
}

/** Builds one `InstancedMesh` per `object_type` present in `objects`
 * (excluding dedicated-marker entries, see `DEDICATED_MARKER_OBJECT_IDS`), all
 * parented under a returned `Group`, plus the `CatalogBucket[]` mapping
 * `main.ts`/`scene/picking.ts` need to resolve instances back to real
 * `SceneObject`s and to drive visibility. */
export function createCatalogObjectGroup(objects: SceneObject[]): {
  group: Group;
  buckets: CatalogBucket[];
} {
  const group = new Group();
  group.name = "catalog-objects";

  const byType = new Map<string, SceneObject[]>();
  for (const obj of excludeDedicatedMarkerObjects(objects)) {
    const bucket = byType.get(obj.object_type);
    if (bucket) {
      bucket.push(obj);
    } else {
      byType.set(obj.object_type, [obj]);
    }
  }

  const buckets: CatalogBucket[] = [];
  for (const objectType of Array.from(byType.keys()).sort()) {
    const bucketObjects = byType.get(objectType) as SceneObject[];
    const color = OBJECT_TYPE_COLORS[objectType] ?? DEFAULT_COLOR;
    const mesh = new InstancedMesh(UNIT_SPHERE_GEOMETRY, materialFor(color), bucketObjects.length);
    mesh.name = `catalog-${objectType}`;

    const radiiPc = bucketObjects.map((obj) => markerRadiusPc(obj.size_pc, obj.object_type));
    bucketObjects.forEach((obj, i) => {
      mesh.setMatrixAt(i, instanceMatrixFor(obj, radiiPc[i]));
    });
    mesh.instanceMatrix.needsUpdate = true;

    group.add(mesh);
    buckets.push({ objectType, mesh, objects: bucketObjects, radiiPc });
  }

  return { group, buckets };
}

/** Applies the current category-toggle/radius-filter state to every
 * instance across all buckets (the zero-scale visibility mechanism) -
 * called by `main.ts` whenever either changes. Object *size* (the
 * `sizeScale` slider) is a separate, cheaper concern - see
 * `updateCatalogSizeScale`, which scales each bucket's `InstancedMesh`
 * itself rather than touching per-instance matrices. */
export function updateCatalogVisibility(
  buckets: CatalogBucket[],
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
  cameraDistanceFromOriginPc: number = Number.POSITIVE_INFINITY,
  denseBatchRadiusPc: number = Number.POSITIVE_INFINITY,
): void {
  for (const bucket of buckets) {
    bucket.objects.forEach((obj, i) => {
      setInstanceVisibility(
        bucket,
        i,
        isCatalogObjectVisible(
          obj,
          categoryVisibility,
          radiusPc,
          cameraDistanceFromOriginPc,
          denseBatchRadiusPc,
        ),
      );
    });
  }
}

/**
 * Per-frame LOD-only visibility update (issue #104): unlike
 * `updateCatalogVisibility` (called once per category/radius filter
 * change, touching every instance), this is cheap enough to call every
 * frame from the render loop - it walks every bucket's objects but only
 * ever touches the instance matrix of objects that are actually members of
 * the LOD-gated dense batch (`lod.ts`'s `isDenseBatchMember`), skipping
 * everything else with a single cheap array-membership check. Still
 * defers to `isCatalogObjectVisible` for the full visibility decision, so
 * a dense-batch member that's also currently category-off or outside the
 * radius filter stays hidden regardless of camera distance - the two
 * mechanisms can never disagree about what's on screen. */
export function updateDenseBatchLod(
  buckets: CatalogBucket[],
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
): void {
  for (const bucket of buckets) {
    bucket.objects.forEach((obj, i) => {
      if (!isDenseBatchMember(obj)) return;
      setInstanceVisibility(
        bucket,
        i,
        isCatalogObjectVisible(
          obj,
          categoryVisibility,
          radiusPc,
          cameraDistanceFromOriginPc,
          denseBatchRadiusPc,
        ),
      );
    });
  }
}

/** The "Object size" slider (spec §23) scales every instance uniformly.
 * Applied at the `InstancedMesh` container level (its own `Object3D.scale`
 * multiplies through every instance's local matrix at render time) rather
 * than by rewriting every instance matrix - cheap regardless of catalog
 * size, and composes correctly with the zero-scale hidden state (0 *
 * anything is still 0). */
export function updateCatalogSizeScale(buckets: CatalogBucket[], sizeScale: number): void {
  for (const bucket of buckets) {
    bucket.mesh.scale.setScalar(sizeScale);
  }
}

/** Whether the currently-selected object (by id) is still visible under the
 * current category-toggle/radius-filter state (issue #95). Reuses
 * `isCatalogObjectVisible` so this can never disagree with what
 * `updateCatalogVisibility` actually renders - `main.ts` calls this from
 * `applyCatalogVisibility()` (the one chokepoint every filter change already
 * runs through) to decide whether the Inspector should keep showing the
 * selection or hide it until the object is visible again, instead of
 * leaving stale data on screen for an object that's no longer
 * pickable/visible.
 *
 * `selectedId === null` (nothing selected) and "id not found in `objects`"
 * both return `false` - neither case has anything valid to show. */
export function isSelectedObjectVisible(
  objects: readonly SceneObject[],
  selectedId: string | null,
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
  cameraDistanceFromOriginPc: number = Number.POSITIVE_INFINITY,
  denseBatchRadiusPc: number = Number.POSITIVE_INFINITY,
): boolean {
  if (selectedId === null) {
    return false;
  }
  const obj = objects.find((o) => o.id === selectedId);
  if (!obj) {
    return false;
  }
  return isCatalogObjectVisible(
    obj,
    categoryVisibility,
    radiusPc,
    cameraDistanceFromOriginPc,
    denseBatchRadiusPc,
  );
}

/** The `SceneObject`s currently visible under `categoryVisibility`/
 * `radiusPc`, across all buckets - used by `main.ts`'s "Fit all" camera
 * preset, which needs to frame exactly what's actually on screen. Shares
 * `isCatalogObjectVisible` with `updateCatalogVisibility` so the two can
 * never disagree. */
export function visibleCatalogObjects(
  buckets: CatalogBucket[],
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
  cameraDistanceFromOriginPc: number = Number.POSITIVE_INFINITY,
  denseBatchRadiusPc: number = Number.POSITIVE_INFINITY,
): SceneObject[] {
  const result: SceneObject[] = [];
  for (const bucket of buckets) {
    for (const obj of bucket.objects) {
      if (
        isCatalogObjectVisible(
          obj,
          categoryVisibility,
          radiusPc,
          cameraDistanceFromOriginPc,
          denseBatchRadiusPc,
        )
      ) {
        result.push(obj);
      }
    }
  }
  return result;
}
