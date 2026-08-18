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

/** `scene.json` objects that should NOT be drawn by the generic catalog
 * loop because they already have their own dedicated marker. Exported so
 * `main.ts` can derive an accurate "N objects" count from the same
 * definition used to build the render group. */
export function excludeDedicatedMarkerObjects(objects: SceneObject[]): SceneObject[] {
  return objects.filter((obj) => obj.id !== SUN_OBJECT_ID);
}

/**
 * Distinct `object_type` values actually present in the catalog (excluding
 * the Sun's own dedicated-marker entry), sorted for a stable UI order.
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

/** Visual-only marker radius floor (pc), so point-like objects with no
 * `size_pc` (e.g. stars, clusters) stay visible against an 800pc-scale
 * scene. This is display convenience, not a scientific value (spec §19
 * distinguishes measured/derived/model data from visual decoration). */
const MIN_MARKER_RADIUS_PC = 4;
const MAX_MARKER_RADIUS_PC = 45;

/** Exported for tests - the same visual-radius derivation, per object,
 * that gets baked into each instance's transform matrix below. */
export function markerRadiusPc(sizePc: number | null): number {
  if (sizePc === null || !Number.isFinite(sizePc) || sizePc <= 0) {
    return MIN_MARKER_RADIUS_PC;
  }
  // Extended structures (molecular clouds etc.) carry a physical size;
  // clamp only so a very large cloud doesn't dwarf the whole scene.
  return Math.min(Math.max(sizePc / 4, MIN_MARKER_RADIUS_PC), MAX_MARKER_RADIUS_PC);
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

/** True if `obj` should currently be shown, given the category-toggle and
 * radius-filter state - the single predicate both `updateCatalogVisibility`
 * (which drives the instance matrices) and `visibleCatalogObjects` (used
 * for "Fit all" camera framing) evaluate against, so the two can never
 * disagree about what's actually on screen. */
export function isCatalogObjectVisible(
  obj: SceneObject,
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
): boolean {
  const categoryOn = categoryVisibility.get(obj.object_type) ?? true;
  return categoryOn && isWithinRadius(obj.distance_pc, radiusPc);
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
 * (excluding the Sun's dedicated-marker entry, see `SUN_OBJECT_ID`), all
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

    const radiiPc = bucketObjects.map((obj) => markerRadiusPc(obj.size_pc));
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
): void {
  for (const bucket of buckets) {
    bucket.objects.forEach((obj, i) => {
      setInstanceVisibility(bucket, i, isCatalogObjectVisible(obj, categoryVisibility, radiusPc));
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

/** The `SceneObject`s currently visible under `categoryVisibility`/
 * `radiusPc`, across all buckets - used by `main.ts`'s "Fit all" camera
 * preset, which needs to frame exactly what's actually on screen. Shares
 * `isCatalogObjectVisible` with `updateCatalogVisibility` so the two can
 * never disagree. */
export function visibleCatalogObjects(
  buckets: CatalogBucket[],
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
): SceneObject[] {
  const result: SceneObject[] = [];
  for (const bucket of buckets) {
    for (const obj of bucket.objects) {
      if (isCatalogObjectVisible(obj, categoryVisibility, radiusPc)) {
        result.push(obj);
      }
    }
  }
  return result;
}
