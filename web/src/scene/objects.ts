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
import { sunCoreRadiusPc } from "./sun";

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
 *    radius is already a convention, spec §19/§2.3). Never varies *by type or
 *    size*, so stars can never accidentally grow to match a cluster's
 *    marker. Issue #119 adds a separate, camera-distance-dependent shrink on
 *    top of this baseline for close-in RECONS-batch stars specifically (see
 *    `starMarkerRadiusPc` below) - that's an instance-matrix-level per-frame
 *    override applied downstream of this function, not a change to
 *    `markerRadiusPc`'s own return value, which stays the fixed overview
 *    radius `STAR_MARKER_RADIUS_PC` always.
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

/** Exported (issue #130) so callers outside this module - `main.ts`'s
 * selection-indicator radius resolution among them - can check "is this a
 * star-like type" against the same single source of truth `markerRadiusPc`/
 * `markerOpacityFor`/`setInstanceVisibility` already use below, rather than
 * re-hardcoding the `"star"` string literal in a second place that could
 * silently drift if a second star-like type is ever added here. */
export const STAR_OBJECT_TYPES: ReadonlySet<string> = new Set(["star"]);
export const CLUSTER_OBJECT_TYPES: ReadonlySet<string> = new Set([
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

/** Issue #119: the star marker's floor radius (pc) once the camera is at or
 * inside the RECONS dense batch's own collection radius
 * (`lod.ts`'s `denseBatchCollectionRadiusPc`) - i.e. the close-zoom end of
 * `starMarkerRadiusPc` below, mirroring `scene/sun.ts`'s
 * `SUN_CORE_MIN_RADIUS_PC` for the same LOD volume.
 *
 * `STAR_MARKER_RADIUS_PC` (2pc, the unshrunk/overview radius) is already
 * bigger than the real separation between the Sun's nearest neighbors:
 * Proxima Centauri sits only 1.302pc from the Sun, and only ~0.068pc from
 * the Alpha Centauri A/B system (computed from `scene.json`'s own
 * `position_pc` values, 2026-08-19) - tighter than either star's own 2pc
 * marker radius, let alone two of them side by side. This floor is chosen
 * so two adjacent RECONS-batch stars at their shrunk size stay visually
 * distinct even at that tightest real gap: `2 * STAR_MARKER_MIN_RADIUS_PC`
 * (0.04pc) leaves comfortable clearance under the 0.068pc Proxima-to-Alpha-
 * Centauri-AB separation, while still reading as "small, point-like" rather
 * than literally zero/invisible (matching `SUN_CORE_MIN_RADIUS_PC`'s own
 * "not literally zero" reasoning, issue #113). Alpha Centauri A and B
 * themselves (~0.0001pc apart, a genuinely-unresolvable-at-this-scale real
 * binary) are expected to still render as a single coincident point at this
 * floor - the issue's own acceptance criteria only asks that Proxima and
 * "Alpha Centauri A/B" (as a system) read as distinct, not that A and B
 * resolve from each other. */
export const STAR_MARKER_MIN_RADIUS_PC = 0.02;

/** How far out (as a multiple of the dense batch's own collection radius)
 * the star radius starts shrinking from `STAR_MARKER_RADIUS_PC`, reaching
 * `STAR_MARKER_MIN_RADIUS_PC` exactly at the collection radius itself -
 * the same multiplier `scene/sun.ts` uses for `SUN_CORE_SHRINK_START_MULTIPLIER`,
 * so both LOD-driven shrinks (Sun core, star markers) finish shrinking to
 * their point-like floor at the same camera distance rather than visibly
 * lagging/leading each other. */
export const STAR_MARKER_SHRINK_START_MULTIPLIER = 3;

/**
 * The star marker's camera-distance-dependent radius (pc), issue #119:
 * fixes the same class of scale bug #113 already fixed for the Sun's own
 * marker, this time for individual stars - the fixed `STAR_MARKER_RADIUS_PC`
 * (2pc, tuned for legibility at the ~800pc overview) is bigger than the real
 * distance between the Sun and its nearest neighbors, so at
 * solar-neighborhood zoom Proxima Centauri's and Alpha Centauri A/B's
 * markers visually overlap/engulf the Sun's position instead of reading as
 * distinct nearby stars.
 *
 * Deliberately mirrors `scene/sun.ts`'s `sunCoreRadiusPc` exactly - same
 * signature shape (current camera distance from the origin, plus the
 * data-derived `denseBatchRadiusPc` reference point from `lod.ts`'s
 * `denseBatchCollectionRadiusPc`), same continuous/monotonic linear-shrink
 * curve between the same kind of max/min radius pair and the same
 * `*_SHRINK_START_MULTIPLIER` shape. Only the actual max/min radius values
 * differ (star markers are smaller than the Sun's core to begin with, and
 * need a much smaller floor - see `STAR_MARKER_MIN_RADIUS_PC`'s docstring).
 *
 * Stays at `STAR_MARKER_RADIUS_PC` for any camera distance at or beyond
 * `STAR_MARKER_SHRINK_START_MULTIPLIER * denseBatchRadiusPc` (no regression
 * to the ~800pc overview, where 2pc was already tuned to be visible), and
 * clamps to `STAR_MARKER_MIN_RADIUS_PC` once the camera is at or inside
 * `denseBatchRadiusPc` itself. `denseBatchRadiusPc <= 0` (scene not loaded
 * yet) has nothing to shrink toward, so this simply returns the overview
 * radius, matching pre-#119 appearance.
 *
 * This is only ever applied to RECONS dense-batch star instances (see
 * `setInstanceVisibility` below) - non-dense-batch stars are always far
 * enough from the Sun (closest is ~76.6pc, well outside even
 * `denseBatchRadiusPc`'s ~11.26pc collection radius times the shrink-start
 * multiplier) that this formula would return `STAR_MARKER_RADIUS_PC`
 * unchanged for them anyway; skipping those ~585 instances is a pure
 * performance win with no visual difference, mirroring #104's own
 * dense-batch-only scoping rationale (`lod.ts`'s module docstring).
 */
export function starMarkerRadiusPc(
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
): number {
  if (denseBatchRadiusPc <= 0) {
    return STAR_MARKER_RADIUS_PC;
  }

  const shrinkStartPc = denseBatchRadiusPc * STAR_MARKER_SHRINK_START_MULTIPLIER;
  if (cameraDistanceFromOriginPc >= shrinkStartPc) {
    return STAR_MARKER_RADIUS_PC;
  }
  if (cameraDistanceFromOriginPc <= denseBatchRadiusPc) {
    return STAR_MARKER_MIN_RADIUS_PC;
  }

  const t = (cameraDistanceFromOriginPc - denseBatchRadiusPc) / (shrinkStartPc - denseBatchRadiusPc);
  return STAR_MARKER_MIN_RADIUS_PC + t * (STAR_MARKER_RADIUS_PC - STAR_MARKER_MIN_RADIUS_PC);
}

/** Issue #123's selection-reticle radius resolution, extracted (issue #130)
 * into this testable, pure module function instead of living only as
 * `main.ts`'s unexported `selectedObjectMarkerRadiusPc` closure. Must mirror
 * `setInstanceVisibility`'s own radius-resolution priority - Sun ->
 * dense-batch star -> generic - exactly, or the reticle can visibly
 * disagree with the marker it's supposed to surround. `sunObjectId`,
 * `cameraDistanceFromOriginPc`, and `denseBatchRadiusPc` are taken as
 * explicit parameters (rather than closed over module state, the way
 * `main.ts`'s camera/`denseBatchRadiusPc` live) precisely so this function
 * can be unit tested without needing a real `THREE.PerspectiveCamera` or
 * `main.ts`'s own module-level scene state. */
export function selectedMarkerRadiusPc(
  obj: SceneObject,
  sunObjectId: string,
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
): number {
  if (obj.id === sunObjectId) {
    return sunCoreRadiusPc(cameraDistanceFromOriginPc, denseBatchRadiusPc);
  }
  if (STAR_OBJECT_TYPES.has(obj.object_type) && isDenseBatchMember(obj)) {
    return starMarkerRadiusPc(cameraDistanceFromOriginPc, denseBatchRadiusPc);
  }
  return markerRadiusPc(obj.size_pc, obj.object_type);
}

/** Issue #115: opacity tiers for the same generic catalog-object markers
 * #103 already tiers by radius (spec `Idea-v1.3-visual-fidelity-and-navigation.md`
 * §2.3 follow-up, human owner decision 2026-08-19). Discrete groupings of
 * individual stars (`star`, `star_cluster`, `stellar_association`) keep the
 * pre-#115 fully-opaque look; extended, physically-diffuse structures
 * (gas/dust clouds, ionized regions, bubbles, remnants) render visibly
 * translucent instead, so a marker's opacity hints at "this is a discrete
 * object" vs. "this is a diffuse cloud of something" the same way its color
 * already hints at object_type.
 *
 * Deliberately reuses the exact same `STAR_OBJECT_TYPES`/`CLUSTER_OBJECT_TYPES`
 * partition `markerRadiusPc` already uses, rather than maintaining a second,
 * possibly-drifting list of "which types are structures" - the two axes
 * (radius tier, opacity tier) are conceptually the same split (discrete
 * point-like/grouped objects vs. everything else) and this guarantees they
 * can never disagree about which bucket a given object_type falls into.
 * That also means the catch-all "everything else" bucket picks up
 * `star_forming_region` (a diffuse star-forming gas cloud, physically akin
 * to `molecular_cloud`/`hii_region` even though the issue's own example list
 * didn't spell it out) and `reference_point` (in practice only ever the
 * Sun's own entry today, which never reaches this render path at all - see
 * `SUN_OBJECT_ID` - but per that constant's own comment a future non-Sun
 * `reference_point` object is possible and must render *some* sensible way
 * rather than erroring), plus any future/unrecognized object_type, exactly
 * as `markerRadiusPc` already does for radius. */
const OPAQUE_MARKER_OPACITY = 0.85; // unchanged pre-#115 value - star/cluster/association tier
const EXTENDED_STRUCTURE_OPACITY = 0.35; // #115: visibly translucent - diffuse structure tier

/** Exported for tests - the type-aware opacity a marker's material should
 * use, mirroring `markerRadiusPc`'s tiering (see the comment above). */
export function markerOpacityFor(objectType: string): number {
  if (STAR_OBJECT_TYPES.has(objectType) || CLUSTER_OBJECT_TYPES.has(objectType)) {
    return OPAQUE_MARKER_OPACITY;
  }
  return EXTENDED_STRUCTURE_OPACITY;
}

/**
 * Issue #137: dims every catalog bucket that is NOT the star bucket
 * (clusters, associations, and every extended-structure type - the same
 * "everything but `STAR_OBJECT_TYPES`" partition `markerOpacityFor` already
 * draws) once the camera is inside the RECONS dense batch's own collection
 * sphere (`lod.ts`'s `isCameraInsideDenseBatchSphere`), so the highlighted
 * nearby-star neighborhood reads as the visual focus. The star bucket itself
 * is never touched here - it's excluded by `shouldDimBackground` below, not
 * by the caller, so this can never accidentally dim the very stars issue
 * #137 is spotlighting, even if a future caller forgets to filter it out
 * first.
 *
 * `BACKGROUND_DIM_FACTOR` (not a fixed target opacity) is a multiplier
 * applied to each bucket's own already-tiered `markerOpacityFor` value, so
 * the cluster tier (0.85) and the extended-structure tier (0.35) both dim by
 * the same *proportion* rather than converging toward one flat number -
 * clusters/associations (opaque, discrete objects) stay a bit more visible
 * than diffuse structures even while dimmed, preserving #115's own
 * discrete-vs-diffuse opacity distinction instead of erasing it.
 */
const BACKGROUND_DIM_FACTOR = 0.4;

/** True for every catalog bucket type EXCEPT `STAR_OBJECT_TYPES` - i.e. the
 * "background" this issue dims. Exported so `main.ts`/tests can reason about
 * which buckets are affected without re-deriving the partition themselves. */
export function shouldDimBackground(objectType: string): boolean {
  return !STAR_OBJECT_TYPES.has(objectType);
}

/** Exported for tests - the pure "what opacity should this bucket's
 * material use right now" decision, independent of any `THREE.Material`/
 * `InstancedMesh` plumbing. Returns the bucket's normal, undimmed
 * `markerOpacityFor` value whenever `cameraInsideDenseBatchSphere` is
 * `false`, or `objectType` is the star bucket (never dimmed, regardless of
 * camera position) - only actually applies `BACKGROUND_DIM_FACTOR` in the
 * remaining case (a non-star bucket, camera inside the sphere). */
export function backgroundBucketOpacity(
  objectType: string,
  cameraInsideDenseBatchSphere: boolean,
): number {
  const baseOpacity = markerOpacityFor(objectType);
  if (!cameraInsideDenseBatchSphere || !shouldDimBackground(objectType)) {
    return baseOpacity;
  }
  return baseOpacity * BACKGROUND_DIM_FACTOR;
}

/** Cached by `color`+`opacity` together (not color alone) since #115 - two
 * buckets can now share a color-only cache key but need different
 * materials if they land in different opacity tiers (they never do today,
 * since `OBJECT_TYPE_COLORS` already gives every type its own color, but
 * the combined key keeps that an invariant of the color table rather than
 * of this cache). */
const materialCache = new Map<string, MeshBasicMaterial>();
function materialFor(color: number, opacity: number): MeshBasicMaterial {
  const key = `${color}:${opacity}`;
  let material = materialCache.get(key);
  if (!material) {
    material = new MeshBasicMaterial({ color, transparent: true, opacity });
    materialCache.set(key, material);
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
 * `InstancedMesh`-has-no-per-instance-`.visible` workaround (issue #89).
 *
 * Issue #119: when the instance being shown is both a RECONS dense-batch
 * member (`lod.ts`'s `isDenseBatchMember`) and a `star`-type object, its
 * baked-in `bucket.radiiPc[index]` (the fixed overview radius) is replaced
 * by `starMarkerRadiusPc`'s camera-distance-dependent value instead - the
 * same LOD-gated subset `updateDenseBatchLod` below already recomputes every
 * frame for visibility, now also getting its radius recomputed in the same
 * pass. Every other instance (non-dense-batch, or dense-batch but not a
 * star - not the case in today's data, see `starMarkerRadiusPc`'s
 * docstring, but checked explicitly rather than assumed) keeps using its
 * static baked-in radius, unaffected. `cameraDistanceFromOriginPc`/
 * `denseBatchRadiusPc` default to `Number.POSITIVE_INFINITY`, under which
 * `starMarkerRadiusPc` always returns the unshrunk overview radius anyway -
 * i.e. any existing caller that doesn't pass them sees no behavior change. */
export function setInstanceVisibility(
  bucket: CatalogBucket,
  index: number,
  visible: boolean,
  cameraDistanceFromOriginPc: number = Number.POSITIVE_INFINITY,
  denseBatchRadiusPc: number = Number.POSITIVE_INFINITY,
): void {
  const obj = bucket.objects[index];
  let radiusPc = bucket.radiiPc[index];
  if (visible && STAR_OBJECT_TYPES.has(obj.object_type) && isDenseBatchMember(obj)) {
    radiusPc = starMarkerRadiusPc(cameraDistanceFromOriginPc, denseBatchRadiusPc);
  }
  const effectiveRadiusPc = visible ? radiusPc : HIDDEN_INSTANCE_SCALE;
  bucket.mesh.setMatrixAt(index, instanceMatrixFor(obj, effectiveRadiusPc));
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
    const opacity = markerOpacityFor(objectType);
    const mesh = new InstancedMesh(
      UNIT_SPHERE_GEOMETRY,
      materialFor(color, opacity),
      bucketObjects.length,
    );
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
        cameraDistanceFromOriginPc,
        denseBatchRadiusPc,
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
 * mechanisms can never disagree about what's on screen.
 *
 * Issue #119: this same per-frame pass now also carries the dense batch's
 * `star`-type instances' camera-distance-dependent radius
 * (`starMarkerRadiusPc`, via `setInstanceVisibility`'s
 * `cameraDistanceFromOriginPc`/`denseBatchRadiusPc` passthrough) - piggy-
 * backing on the exact same already-cheap subset/pass rather than adding a
 * second full-catalog or second dense-batch-only walk, since both concerns
 * (LOD visibility, LOD radius) only ever apply to the same ~122-instance
 * dense batch and are cheapest to recompute together. */
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
        cameraDistanceFromOriginPc,
        denseBatchRadiusPc,
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

/**
 * Issue #137: applies (or restores from) the "background dimming" effect
 * across every catalog bucket - swaps each bucket's `InstancedMesh.material`
 * between its normal-opacity material and a dimmed-opacity one, both drawn
 * from the same `materialFor` cache `createCatalogObjectGroup` already uses.
 *
 * Deliberately a reference SWAP, not an in-place `.opacity` mutation of the
 * bucket's existing (cached) material: `materialCache` is keyed by
 * `color:opacity` and is a MODULE-LEVEL singleton, reused across every call
 * to `createCatalogObjectGroup` (e.g. across independent tests, or a
 * hypothetical future scene reload) - mutating a cached material's own
 * `.opacity` in place would leave that mutation visible to any later caller
 * who looks up the exact same `color:opacity` key expecting the original
 * value. `OBJECT_TYPE_COLORS` happens to give every real `object_type` its
 * own distinct color today (checked explicitly - no two types share a
 * `color:opacity` pair), so in-place mutation of "this bucket's own
 * material" would not actually leak into a DIFFERENT bucket's material right
 * now; the cross-call/cross-test leak above is the real risk this avoids.
 * `materialFor`'s cache means the swap itself allocates nothing beyond the
 * first dim/restore cycle (the dimmed-opacity material, once created, is
 * reused on every subsequent toggle) - restoring calls `materialFor` again
 * with the exact original `(color, baseOpacity)` key, so it always resolves
 * back to the SAME original material instance, never a fresh copy.
 *
 * Always safe to call on the star bucket too (its opacity is unaffected -
 * see `backgroundBucketOpacity`), so callers don't need to filter buckets
 * themselves before calling this.
 */
export function updateBackgroundDimming(
  buckets: CatalogBucket[],
  cameraInsideDenseBatchSphere: boolean,
): void {
  for (const bucket of buckets) {
    const color = OBJECT_TYPE_COLORS[bucket.objectType] ?? DEFAULT_COLOR;
    const opacity = backgroundBucketOpacity(bucket.objectType, cameraInsideDenseBatchSphere);
    bucket.mesh.material = materialFor(color, opacity);
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
