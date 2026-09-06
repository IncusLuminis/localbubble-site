import {
  Color,
  Group,
  InstancedMesh,
  Matrix4,
  MeshBasicMaterial,
  Quaternion,
  SphereGeometry,
  Vector3,
} from "three";
import type { LocalBubbleStructure, SceneObject } from "./sceneTypes";
import { isWithinRadius } from "./radiusFilter";
import { isDenseBatchMember, passesDenseBatchLod } from "./lod";
import { sunCoreRadiusPc } from "./sun";
import { spectralColorFor } from "./spectralColor";
import { absoluteMagnitudeToBrightness } from "./magnitudeBrightness";
import { DEFAULT_STAR_RENDER_STYLE, type StarRenderStyle } from "./starRenderStyle";
import {
  STAR_MARKER_NEAR_SUN_RADIUS_PC,
  STAR_MARKER_MIN_RADIUS_PC,
  STAR_MARKER_SHRINK_START_MULTIPLIER,
  starMarkerRadiusPc,
  starMarkerShrinkStartPc,
  starBaselineRadiusPc,
} from "./starMarkerScale";

// Issue #217: re-exported so existing callers/tests that import these from
// `objects.ts` (their original home) keep working unchanged - the values
// (and, per the scope expansion, `starMarkerRadiusPc` itself) now live in
// `starMarkerScale.ts` (see that module's docstring) so `sun.ts` can reuse
// them too without a module cycle. Issue #219: `starBaselineRadiusPc`
// (issue #215's own baseline-shape function) joins them for the same
// reason - `sun.ts`'s new camera-driven taper stage reuses it directly,
// see `starMarkerScale.ts`'s docstring on that function. Issue #300:
// `starMarkerShrinkStartPc` joins them too - `isStarMarkerShrinkEligible`
// below shares it with `starMarkerRadiusPc` itself so the two thresholds
// can't drift apart.
export {
  STAR_MARKER_NEAR_SUN_RADIUS_PC,
  STAR_MARKER_MIN_RADIUS_PC,
  STAR_MARKER_SHRINK_START_MULTIPLIER,
  starMarkerRadiusPc,
  starMarkerShrinkStartPc,
  starBaselineRadiusPc,
};

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

/** Issue #315: exported so `scene/diffuseStructures.ts`'s generic extended-
 * volume mesh factory can color each diffuse-structure mesh with the exact
 * same per-`object_type` color this module's point-marker buckets already
 * used for the same types - reusing this table verbatim (spec's own "reuse
 * existing per-type color... conventions" instruction) rather than
 * maintaining a second, possibly-drifting copy. */
export const OBJECT_TYPE_COLORS: Record<string, number> = {
  star: 0xffffff,
  // Story #320: yellow, confirmed via live testing - was 0xffd27f. The
  // sphere shape itself (`diffuseStructures.ts`'s `buildClusterGroup`) is
  // deliberately a neutral gray, NOT this color; this is instead the tint
  // used by nothing today except any future generic-bucket fallback path
  // and this constant's own re-export for other callers.
  star_cluster: 0xffe066,
  stellar_association: 0xff9f6b,
  // Story #320: pink/H-alpha reddish-pink, confirmed via live testing (the
  // human owner's own framing: "science-pop traditionally shows
  // hydrogen-alpha as pinkish-red") - was 0x7fb8ff (blue).
  molecular_cloud: 0xff6f9f,
  star_forming_region: 0xff7fb0,
  // Story #320: warm coral/orange-red, confirmed via live testing - same
  // H-alpha-emission color family as `molecular_cloud` above (real
  // astrophotos of both often read reddish-pink), but a visibly different
  // hue so the two stay distinguishable at a glance, per the human owner's
  // own "slightly different but still related" instruction - was 0xb07fff
  // (violet).
  hii_region: 0xff8f5f,
  supernova_remnant: 0xff5f5f,
  // Issue #221: teal/green, distinct from `bubble`'s cyan (0x5fffe0) and
  // `hii_region`'s violet (0xb07fff) - real planetary nebulae commonly
  // show doubly-ionized oxygen (OIII) emission at ~500.7nm, which reads
  // visually as teal/green, so this color is also physically apt, not
  // just distinguishable.
  planetary_nebula: 0x7dffa0,
  bubble: 0x5fffe0,
  reference_point: 0x9aa7bd,
};

/** Issue #315: exported alongside `OBJECT_TYPE_COLORS` for the same reason
 * - `scene/diffuseStructures.ts` needs the identical "unrecognized type"
 * color fallback `createCatalogObjectGroup`/`updateBackgroundDimming` below
 * already use, rather than inventing a second fallback color. */
export const DEFAULT_COLOR = 0xaab4c8;

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
 * possible `size_pc`, not just today's catalog values.
 *
 * Issue #217: the value itself now lives in `starMarkerScale.ts` (imported
 * above) so `scene/sun.ts` can reuse it for its own overview tier without a
 * module cycle - see that module's docstring. */

const CLUSTER_MIN_RADIUS_PC = 5;
const CLUSTER_MAX_RADIUS_PC = 9;

/** Issue #315: exported so `scene/diffuseStructures.ts` can reuse this
 * exact same floor as its own fallback radius for a diffuse-structure
 * record that still lacks `size_pc` after Story #314's honest-failure
 * backfill (one record today: M8/Lagoon Nebula) - the object then renders
 * at exactly the same visual radius its old point marker used to (this was
 * already that marker's own floor for every `size_pc`-less structure/
 * diffuse-type object pre-#315), rather than an arbitrary new default. */
export const STRUCTURE_MIN_RADIUS_PC = 10;
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

/** Issue #215: the star baseline's "near-Sun" floor (pc) - the smaller end
 * of `starBaselineRadiusPc`'s gradient, reached once a star's own real
 * `distance_pc` is at or inside the RECONS dense-batch sphere's edge
 * (`denseBatchRadiusPc`, ~11.26pc). Chosen by live visual iteration in the
 * running viewer, at the default ~1087pc "Perspective" overview: with every
 * non-star category and structure layer toggled off (isolating star
 * markers), stars inside the Local Bubble wireframe read as clearly, legibly
 * smaller spheres than the uniform ~2pc markers outside it - confirming the
 * graduated falloff is visible at a glance, not just on paper. 0.3pc, 0.5pc,
 * and 0.8pc (spanning the issue's suggested range) were each tried live via
 * hot-reload at that same fixed zoom; the differences among the three are
 * subtle at overview scale (the absolute pc deltas are small relative to the
 * ~1087pc camera distance), so no single value in that range stood out as
 * obviously better purely from the overview. 0.5pc was settled on as the
 * balanced middle choice: a clean 4x reduction from the flat 2pc "open
 * space" ceiling (unambiguously smaller, never confusable with an
 * unshrunk marker), while staying well clear of `STAR_MARKER_MIN_RADIUS_PC`
 * (0.02pc) so the existing camera-zoom shrink (#119/#211) still has a
 * meaningful range left to shrink through as the camera approaches.
 *
 * Issue #217: the value itself now lives in `starMarkerScale.ts` (imported
 * above, re-exported here for existing callers) so `scene/sun.ts` can reuse
 * it for its own mid tier without a module cycle - see that module's
 * docstring. */

/** Issue #215: derives `starBaselineRadiusPc`'s `bubbleOuterRadiusPc` input
 * from the loaded scene's own `structures.local_bubble.semi_axes_pc`
 * (averaging `a_pc`/`b_pc` - the bubble's two shorter, roughly-equal axes;
 * `c_pc`, the elongated long axis, is deliberately excluded, see
 * `starBaselineRadiusPc`'s docstring) rather than hard-coding a duplicate of
 * that number. Returns `null` (never throws) when `structure` is absent or
 * malformed - `structure ?? null` at the `main.ts` call site already handles
 * "no Local Bubble layer in this scene"; this additionally guards against a
 * structurally-present-but-incomplete `semi_axes_pc`, matching this module's
 * existing "missing optional data degrades gracefully" convention (spec
 * §38). */
export function bubbleOuterRadiusPcFrom(structure: LocalBubbleStructure | null): number | null {
  const axes = structure?.semi_axes_pc;
  if (!axes || !Number.isFinite(axes.a_pc) || !Number.isFinite(axes.b_pc)) {
    return null;
  }
  return (axes.a_pc + axes.b_pc) / 2;
}

/** Exported for tests - the same visual-radius derivation, per object, that
 * gets baked into each instance's transform matrix below. Type-aware
 * (issue #103): `objectType` picks which of the three tiers above applies;
 * only the cluster/structure tiers then also look at `sizePc`, clamped to
 * that tier's own range.
 *
 * Issue #215: the star tier's flat ceiling is now `starBaselineRadiusPc`,
 * graduated by the star's own real `distancePc` - `distancePc`,
 * `denseBatchRadiusPc`, and `bubbleOuterRadiusPc` all default to values that
 * make this a no-op fallback to the original flat `STAR_MARKER_RADIUS_PC`
 * (matching `starBaselineRadiusPc`'s own "scene/bubble not loaded" fallback),
 * so every pre-#215 caller that doesn't pass them - the cluster/structure
 * tiers never needed them either - keeps its exact previous behavior. */
export function markerRadiusPc(
  sizePc: number | null,
  objectType: string,
  distancePc = 0,
  denseBatchRadiusPc = 0,
  bubbleOuterRadiusPc: number | null = null,
): number {
  if (STAR_OBJECT_TYPES.has(objectType)) {
    return starBaselineRadiusPc(distancePc, denseBatchRadiusPc, bubbleOuterRadiusPc);
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
 * `SUN_CORE_FLOOR_RADIUS_PC` for the same LOD volume (issue #217: the two
 * are now the exact same value, and `sunCoreRadiusPc` calls this module's
 * `starMarkerRadiusPc` directly - see `sun.ts`'s docstring).
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
 * than literally zero/invisible (matching `SUN_CORE_FLOOR_RADIUS_PC`'s own
 * "not literally zero" reasoning, issue #113). Alpha Centauri A and B
 * themselves (~0.0001pc apart, a genuinely-unresolvable-at-this-scale real
 * binary) are expected to still render as a single coincident point at this
 * floor - the issue's own acceptance criteria only asks that Proxima and
 * "Alpha Centauri A/B" (as a system) read as distinct, not that A and B
 * resolve from each other.
 *
 * Issue #217: the value itself now lives in `starMarkerScale.ts` (imported
 * above, re-exported here for existing callers) so `scene/sun.ts` can reuse
 * it for its own close-zoom floor tier without a module cycle - see that
 * module's docstring. */

/**
 * Issue #211: is `obj` eligible for `starMarkerRadiusPc`'s camera-distance-
 * dependent shrink - decoupled from `lod.ts`'s `isDenseBatchMember`
 * (`recons-nearest-100`) tag, which issue #119 originally (and only ever
 * incidentally) used as this eligibility gate. That tag is a *provenance*
 * fact (was this object resolved from the original RECONS "100 nearest
 * systems" candidate list) - a completely different concern from "is this
 * star geometrically close enough to the Sun that the shrink formula
 * produces a different, meaningful result for it." The two happened to
 * coincide for every star in today's catalog except one: Fomalhaut
 * (`alf_psa`, 7.70pc, tagged `nearby-bright-star-gap-fill` per #207/#208,
 * deliberately NOT `recons-nearest-100` since it wasn't actually on the
 * original RECONS list) is genuinely close to the Sun but was silently
 * excluded from the shrink purely because it lacked the tag - rendering at
 * a fixed, oversized `STAR_MARKER_RADIUS_PC` while its true RECONS-tagged
 * neighbors correctly shrink alongside it.
 *
 * Eligibility is now purely geometric: `obj.distance_pc` compared against
 * `starMarkerRadiusPc`'s own shrink-start threshold
 * (`starMarkerShrinkStartPc(denseBatchRadiusPc, bubbleOuterRadiusPc)`,
 * `starMarkerScale.ts`) - the same distance beyond which `starMarkerRadiusPc`
 * returns the unshrunk `STAR_MARKER_RADIUS_PC` for ANY camera position
 * anyway. This is a superset of the old tag-based eligibility, not a
 * behavior change for existing tagged stars: `denseBatchRadiusPc` (`lod.ts`'s
 * `denseBatchCollectionRadiusPc`, untouched by this issue - still keyed
 * off `recons-nearest-100` only) is BY DEFINITION the max `distance_pc`
 * among `recons-nearest-100`-tagged objects, so every one of those ~122
 * stars automatically satisfies `distance_pc <= denseBatchRadiusPc <
 * shrinkStartPc` (the threshold is always > `denseBatchRadiusPc`) and stays
 * eligible exactly as before. Fomalhaut (7.70pc) now also satisfies it.
 *
 * Issue #300: `bubbleOuterRadiusPc` (defaulting to `null` for backward
 * compatibility) is threaded through to `starMarkerShrinkStartPc` here too -
 * when a Local Bubble layer is loaded, the threshold widens from the old flat
 * ~33.8pc (`denseBatchRadiusPc * 3`) to `bubbleOuterRadiusPc` itself (~60pc),
 * per the live investigation documented on `starMarkerShrinkStartPc`. This
 * newly makes stars with `distance_pc` in the old gap (~34-60pc) eligible for
 * camera-proximity shrink, which they weren't before - an intentional
 * widening, not a bug, so their markers also get the smoothed-out shrink
 * across the whole Local Bubble rather than sitting flat at their baseline
 * ceiling for that whole range. The ~585 genuinely-far catalog stars
 * (closest ~76.6pc, still beyond even the widened ~60pc threshold) remain
 * ineligible and unaffected either way.
 *
 * `denseBatchRadiusPc <= 0` (scene not loaded yet) has nothing to compare
 * against, so nothing is eligible - matching `starMarkerRadiusPc`'s own
 * "return the overview radius" fallback for that case. The check itself is
 * a single numeric comparison (plus a `Set.has` for the object-type guard)
 * - cheap enough to evaluate for every catalog object, including the ~585
 * genuinely-far stars, with no meaningful per-frame cost even though it's
 * no longer gated behind the tag-membership array check first (see
 * `updateDenseBatchLod`'s docstring for the per-frame-walk performance
 * reasoning). */
export function isStarMarkerShrinkEligible(
  obj: SceneObject,
  denseBatchRadiusPc: number,
  bubbleOuterRadiusPc: number | null = null,
): boolean {
  if (!STAR_OBJECT_TYPES.has(obj.object_type) || denseBatchRadiusPc <= 0) {
    return false;
  }
  return obj.distance_pc < starMarkerShrinkStartPc(denseBatchRadiusPc, bubbleOuterRadiusPc);
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
 * `main.ts`'s own module-level scene state.
 *
 * Issue #217 (scope expansion): used to also take an explicit
 * `minZoomDistancePc` parameter (issue #136), threaded through to
 * `sunCoreRadiusPc` for the Sun branch - that parameter no longer exists on
 * either function. `sunCoreRadiusPc`'s curve was simplified to the same
 * two-segment shape `starMarkerRadiusPc` already uses (see `sun.ts`'s
 * docstring): both now bottom out at a single flat floor for any camera
 * distance at or inside `denseBatchRadiusPc`, with nothing left that varies
 * by the camera's *actual* real-time minimum-zoom distance - so there is no
 * longer anything for a `minZoomDistancePc` parameter to do.
 *
 * `bubbleOuterRadiusPc` (issue #215) is threaded through to both the
 * shrink-eligible branch (as `starMarkerRadiusPc`'s new per-star ceiling,
 * via `starBaselineRadiusPc`) and the generic `markerRadiusPc` fallback, so
 * the reticle around ANY star - shrink-eligible or not - matches that same
 * star's graduated baseline, not just the flat overview radius.
 *
 * PR #321 (Story #320 follow-up): `main.ts`'s `selectedObjectMarkerRadiusPc`
 * now special-cases `CLUSTER_OBJECT_TYPES` (`star_cluster`/
 * `stellar_association`) BEFORE calling this function at all, sourcing
 * their radius from `diffuseStructures.ts`'s `clusterOrAssociationShapeRadiusPc`
 * instead - Story #320 moved those two types' actual rendering out of the
 * generic point-marker buckets this function describes and into
 * `diffuseStructureLayer`'s own shapes, so this function's own `markerRadiusPc`
 * fallback for those two types is now stale/unused in the live reticle path
 * (kept here only as this function's still-correct behavior for any other
 * direct caller/test). This module deliberately does NOT import from
 * `diffuseStructures.ts` to make that special-case here instead - that
 * module already imports FROM this one, and reversing it would create an
 * import cycle; `main.ts` sits above both, so it does the special-casing. */
export function selectedMarkerRadiusPc(
  obj: SceneObject,
  sunObjectId: string,
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
  bubbleOuterRadiusPc: number | null = null,
): number {
  if (obj.id === sunObjectId) {
    return sunCoreRadiusPc(cameraDistanceFromOriginPc, denseBatchRadiusPc, bubbleOuterRadiusPc);
  }
  if (isStarMarkerShrinkEligible(obj, denseBatchRadiusPc, bubbleOuterRadiusPc)) {
    const baselineRadiusPc = starBaselineRadiusPc(obj.distance_pc, denseBatchRadiusPc, bubbleOuterRadiusPc);
    return starMarkerRadiusPc(cameraDistanceFromOriginPc, denseBatchRadiusPc, baselineRadiusPc, bubbleOuterRadiusPc);
  }
  return markerRadiusPc(obj.size_pc, obj.object_type, obj.distance_pc, denseBatchRadiusPc, bubbleOuterRadiusPc);
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
/** Issue #18: both tiers are now live-configurable from the Settings panel's
 * "Model" tuning section (`ui/controls.ts`'s "Marker opacity"/"Diffuse
 * structure opacity" sliders) instead of fixed constants - `main.ts` seeds
 * the panel from `DEFAULT_MARKER_OPACITY_TUNING` below and pushes slider
 * changes through `setMarkerOpacityTuning`. Module-level mutable state
 * (rather than threading a tuning object through every `markerOpacityFor`
 * call site - `objects.ts`, `diffuseStructures.ts`, and their own downstream
 * `backgroundBucketOpacity` callers) mirrors this file's existing
 * `materialCache` singleton, and keeps every consumer's fresh-build path
 * automatically current with no plumbing changes needed there. */
export interface MarkerOpacityTuning {
  opaqueMarkerOpacity: number; // star/cluster/association tier (0.85 pre-#115/#18 value)
  extendedStructureOpacity: number; // diffuse structure tier (0.35, #115)
}

export const DEFAULT_MARKER_OPACITY_TUNING: MarkerOpacityTuning = {
  opaqueMarkerOpacity: 0.85,
  extendedStructureOpacity: 0.35,
};

let markerOpacityTuning: MarkerOpacityTuning = { ...DEFAULT_MARKER_OPACITY_TUNING };

/** Patches the live tuning values `markerOpacityFor` reads below. Only
 * updates FRESHLY BUILT bucket/mesh materials on its own (any subsequent
 * `createCatalogObjectGroup`/`buildStarCatalogBucket`/
 * `createDiffuseStructureLayer` call) - reflecting the change onto
 * ALREADY-BUILT materials is the caller's job, exactly as `main.ts`'s own
 * `onModelMarkerOpacityChange` handler does by re-running
 * `updateBackgroundDimming`/`updateDiffuseStructureDimming` (both already
 * exist for the unrelated camera-distance dimming feature, and both already
 * recompute every material's opacity from `markerOpacityFor`/
 * `backgroundBucketOpacity` fresh on every call - reusing them here needs no
 * new bucket-iteration code). */
export function setMarkerOpacityTuning(patch: Partial<MarkerOpacityTuning>): void {
  Object.assign(markerOpacityTuning, patch);
}

/** Exported for tests - the type-aware opacity a marker's material should
 * use, mirroring `markerRadiusPc`'s tiering (see the comment above). */
export function markerOpacityFor(objectType: string): number {
  if (STAR_OBJECT_TYPES.has(objectType) || CLUSTER_OBJECT_TYPES.has(objectType)) {
    return markerOpacityTuning.opaqueMarkerOpacity;
  }
  return markerOpacityTuning.extendedStructureOpacity;
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
 *
 * Issue #156: #137's original 0.4 (60% dimmer) still left the background
 * visually competitive with the spotlighted nearby stars per the human
 * owner's live feedback. Dropped to 0.15 (85% dimmer, within the issue's
 * requested 10-20%-of-normal range) rather than a full hide (opacity/
 * visibility 0) - a full hide would erase spatial context for where the
 * dense-LOD sphere sits relative to the wider catalog/structures, whereas a
 * faint-but-still-present background at 15% keeps that context while still
 * reading unambiguously as background, not competing focus.
 */
const BACKGROUND_DIM_FACTOR = 0.15;

/**
 * Issue #227: the gentler, EARLIER dim tier - applied once the camera is
 * inside the much larger Local Bubble (`lod.ts`'s `isCameraInsideLocalBubble`,
 * ~60pc) but not yet inside the RECONS dense-batch sphere (~11.26pc, which
 * still uses `BACKGROUND_DIM_FACTOR` above, unchanged). Since the sphere
 * always sits geometrically inside the bubble, this makes background
 * dimming a three-zone system: full opacity outside the bubble -> this
 * gentler factor inside the bubble (outside the sphere) -> the existing
 * stronger `BACKGROUND_DIM_FACTOR` inside the sphere.
 *
 * 0.6 (40% dimmer) - live-tuned within the issue's suggested 0.5-0.7
 * starting range: gentle enough to read as clearly distinct from
 * `BACKGROUND_DIM_FACTOR`'s much stronger 0.15 (so the RECONS sphere
 * crossing still reads as a second, bigger step down, not a redundant
 * one), while still being visibly darker than full opacity the moment the
 * camera crosses into the bubble - checked live via hot-reload flying the
 * camera in from open space.
 */
const BUBBLE_BACKGROUND_DIM_FACTOR = 0.6;

/** True for every catalog bucket type EXCEPT `STAR_OBJECT_TYPES` - i.e. the
 * "background" this issue dims. Exported so `main.ts`/tests can reason about
 * which buckets are affected without re-deriving the partition themselves. */
export function shouldDimBackground(objectType: string): boolean {
  return !STAR_OBJECT_TYPES.has(objectType);
}

/**
 * Exported for tests - the pure "what opacity should this bucket's material
 * use right now" decision, independent of any `THREE.Material`/
 * `InstancedMesh` plumbing.
 *
 * Issue #227: now a three-way decision instead of #137's original two-way
 * one. Returns the bucket's normal, undimmed `markerOpacityFor` value
 * whenever `objectType` is the star bucket (never dimmed, regardless of
 * camera position) or the camera is outside both boundaries. Otherwise
 * `cameraInsideDenseBatchSphere` takes priority over
 * `cameraInsideLocalBubble` (the sphere is always inside the bubble, so
 * both can legitimately be `true` at once - the strongest applicable tier
 * should win, not whichever happens to be checked first) and applies
 * `BACKGROUND_DIM_FACTOR`; only when the camera is inside the bubble but
 * NOT inside the sphere does the gentler `BUBBLE_BACKGROUND_DIM_FACTOR`
 * apply.
 */
export function backgroundBucketOpacity(
  objectType: string,
  cameraInsideDenseBatchSphere: boolean,
  cameraInsideLocalBubble = false,
): number {
  const baseOpacity = markerOpacityFor(objectType);
  if (!shouldDimBackground(objectType)) {
    return baseOpacity;
  }
  if (cameraInsideDenseBatchSphere) {
    return baseOpacity * BACKGROUND_DIM_FACTOR;
  }
  if (cameraInsideLocalBubble) {
    return baseOpacity * BUBBLE_BACKGROUND_DIM_FACTOR;
  }
  return baseOpacity;
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

/** Story #239 (scope expansion): `positionPcOverride`, when given, replaces
 * `obj`'s own static `position_pc` for this one matrix - the mechanism the
 * motion player uses to display the ~127 in-sphere animated stars at their
 * time-extrapolated position each frame while every other instance (no
 * override passed) keeps rendering at its real, unchanged catalog position
 * exactly as before. Defaults to `undefined` (i.e. "use `obj.position_pc`"),
 * so every pre-#239 caller is completely unaffected. */
function instanceMatrixFor(
  obj: SceneObject,
  radiusPc: number,
  positionPcOverride?: readonly [number, number, number],
): Matrix4 {
  const [x, y, z] = positionPcOverride ?? obj.position_pc;
  scratchPosition.set(x, y, z);
  scratchScale.setScalar(radiusPc);
  return scratchMatrix.compose(scratchPosition, IDENTITY_QUATERNION, scratchScale);
}

/** Issue #173: reused across `instanceColorFor` calls (up to 707 stars) to
 * avoid allocating a fresh `THREE.Color` per instance, mirroring the
 * `scratchMatrix`/`scratchPosition`/`scratchScale` pattern above. */
const scratchColor = new Color();

/** The star bucket's own per-instance color (issue #173): the star's
 * spectral-class color (`spectralColor.ts`, OBAFGKM blue-to-red, or the
 * "unknown" gray for null/unparseable `spectral_type`) scaled by its
 * absolute-magnitude brightness multiplier (`magnitudeBrightness.ts`,
 * data-fit to this catalog's real distribution). The star bucket's material
 * base color is plain white (`OBJECT_TYPE_COLORS['star']`, unchanged by this
 * Story) specifically so `InstancedMesh.instanceColor`'s per-instance value
 * - which Three.js multiplies against the material's own color - comes
 * through as this function's exact return value, not further tinted.
 * Exported for tests; only ever called for `STAR_OBJECT_TYPES` buckets in
 * `createCatalogObjectGroup` below - every other object type keeps its
 * single flat `OBJECT_TYPE_COLORS` bucket color, untouched by this Story. */
export function instanceColorFor(obj: SceneObject): Color {
  const brightness = absoluteMagnitudeToBrightness(obj.absolute_magnitude);
  return scratchColor.setHex(spectralColorFor(obj.spectral_type)).multiplyScalar(brightness);
}

/** One `InstancedMesh` per `object_type` bucket, plus the index -> real
 * `SceneObject` mapping (and the per-object visual radius baked into each
 * instance) that picking (`scene/picking.ts`) and visibility updates need.
 * `objects[i]`/`radiiPc[i]`/`visible[i]` correspond to instance `i` of `mesh`.
 *
 * Bug fix (issue #26): `sizeScale`/`visible` are bucket-level MUTABLE state,
 * not construction-time-only inputs. `updateCatalogSizeScale` used to scale
 * `mesh` itself (`Object3D.scale`), which multiplies every instance's
 * baked-in position along with its size - moving every object radially
 * instead of just resizing it. The fix rewrites each instance's own matrix
 * with `radiiPc[i] * sizeScale` instead (position untouched), via
 * `setInstanceVisibility` - but `setInstanceVisibility` is also called every
 * frame by `updateDenseBatchLod` and per filter-change by
 * `updateCatalogVisibility`, neither of which know about the size slider.
 * Stashing the CURRENT `sizeScale` on the bucket itself (rather than
 * threading it through every one of those call sites) means any of them can
 * apply it just by reading `bucket.sizeScale`, so a LOD/visibility pass
 * occurring after a size-scale change can never silently reset an instance
 * back to its unscaled radius. `visible[i]` is the same idea for the reverse
 * direction: `updateCatalogSizeScale` must never resurrect a
 * category/radius-filtered-out instance just because its size changed, so it
 * needs to know which instances are currently hidden without re-deriving
 * that from `categoryVisibility`/`radiusPc` (which it isn't given). Both
 * default to "everything visible, no scaling" at construction time, matching
 * every bucket's actual initial state (full radius, unfiltered) before the
 * first real `updateCatalogVisibility()`/`updateCatalogSizeScale()` call. */
export interface CatalogBucket {
  objectType: string;
  mesh: InstancedMesh;
  objects: SceneObject[];
  radiiPc: number[];
  sizeScale: number;
  visible: boolean[];
}

/** MODEL star-bucket instance construction (issue #10, Epic #7) - the exact
 * per-instance matrix + color logic this module used to inline directly in
 * `createCatalogObjectGroup`'s main loop, extracted verbatim (no behavior
 * change) so `buildStarCatalogBucket` below can call it only for `MODEL`
 * (issue #11: REALWORLD no longer dispatches through this function at all -
 * see that function's own docstring). Mutates `mesh` in place; `radiiPc[i]`
 * must already be `starObjects[i]`'s resolved marker radius (from
 * `markerRadiusPc`, computed by the caller). */
function buildModelStarInstances(mesh: InstancedMesh, starObjects: SceneObject[], radiiPc: number[]): void {
  starObjects.forEach((obj, i) => {
    mesh.setMatrixAt(i, instanceMatrixFor(obj, radiiPc[i]));
  });
  mesh.instanceMatrix.needsUpdate = true;

  // Issue #173: per-instance color (spectral class x magnitude brightness) -
  // the star bucket's own distinguishing visual, unchanged by this Story.
  starObjects.forEach((obj, i) => {
    mesh.setColorAt(i, instanceColorFor(obj));
  });
  if (mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  }
}

/** Issue #11 (Epic #7, Story 2/4): REALWORLD's star bucket is no longer an
 * alias of `buildModelStarInstances` - it's now a genuinely separate
 * `THREE.Points`-based rendering system (`scene/realworldStars.ts`'s
 * `buildRealworldStarLayer`) with its own texture, per-star size/color
 * attributes, and visibility/size-scale update functions, built and owned
 * entirely by `main.ts` alongside (not through) `CatalogBucket`/
 * `InstancedMesh`. It deliberately does NOT reuse `CatalogBucket`'s shape:
 * that interface hard-codes `InstancedMesh`-only APIs (`setMatrixAt`,
 * `instanceColor`, the zero-scale-instance hiding convention) throughout
 * `objects.ts`/`picking.ts`, none of which have an equivalent on a `Points`
 * object with no per-vertex transform matrices at all - forcing the two
 * systems into one shared interface would mean sprinkling
 * `instanceof Points` branches through every function that walks
 * `CatalogBucket[]` today (`setInstanceVisibility`, `updateDenseBatchLod`,
 * `updateCatalogSizeScale`, `updateBackgroundDimming`, `picking.ts`'s
 * `pickSceneObject`/`findTapFallbackObject`) for a style that explicitly
 * doesn't need most of what those functions do (no per-frame camera-distance
 * LOD radius, no picking support yet - see `realworldStars.ts`'s own
 * docstring for the full reasoning).
 *
 * Concretely, this means `buildStarCatalogBucket` below now returns `null`
 * for `style === "VISUAL"` - REALWORLD has NO `CatalogBucket`/
 * `InstancedMesh` entry for the `star` type at all, matching this function's
 * own pre-existing "return `null`, nothing to build" convention for an empty
 * `starObjects` input. `main.ts`'s `rebuildStarRenderLayer` is what builds
 * (and tears down) the separate `RealworldStarLayer` instead, exactly
 * mirroring how it already calls this function for `MODEL`. */

/** Builds the `star`-type `CatalogBucket` on its own - extracted out of
 * `createCatalogObjectGroup`'s main per-type loop (issue #10, Epic #7) so it
 * can also be called standalone, independent of every other bucket, when
 * `main.ts`'s Settings-panel toggle switches the active `StarRenderStyle`
 * live: rebuild the star bucket alone and swap it into the existing catalog
 * group, rather than rebuilding (and thereby visually resetting - e.g.
 * losing `updateBackgroundDimming`'s current dimmed-material state) every
 * other bucket too.
 *
 * Returns `null` for an empty `starObjects` input (nothing to build,
 * matching `createCatalogObjectGroup`'s own loop, which likewise only ever
 * creates a bucket for a type with at least one object present), AND
 * (issue #11) for `style === "VISUAL"` - see this section's own docstring
 * above for why REALWORLD's star rendering deliberately lives entirely
 * outside the `CatalogBucket`/`InstancedMesh` system instead. */
export function buildStarCatalogBucket(
  starObjects: SceneObject[],
  denseBatchRadiusPc = 0,
  bubbleOuterRadiusPc: number | null = null,
  style: StarRenderStyle = DEFAULT_STAR_RENDER_STYLE,
): CatalogBucket | null {
  if (starObjects.length === 0 || style === "VISUAL") {
    return null;
  }

  const color = OBJECT_TYPE_COLORS.star ?? DEFAULT_COLOR;
  const opacity = markerOpacityFor("star");
  const mesh = new InstancedMesh(UNIT_SPHERE_GEOMETRY, materialFor(color, opacity), starObjects.length);
  mesh.name = "catalog-star";

  const radiiPc = starObjects.map((obj) =>
    markerRadiusPc(obj.size_pc, obj.object_type, obj.distance_pc, denseBatchRadiusPc, bubbleOuterRadiusPc),
  );

  buildModelStarInstances(mesh, starObjects, radiiPc);

  return {
    objectType: "star",
    mesh,
    objects: starObjects,
    radiiPc,
    sizeScale: 1,
    visible: starObjects.map(() => true),
  };
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
 * Issue #119 (eligibility decoupled from RECONS provenance by #211): when
 * the instance being shown is shrink-eligible (`isStarMarkerShrinkEligible`
 * above - a `star`-type object genuinely close to the Sun, no longer
 * limited to `lod.ts`'s `isDenseBatchMember`/`recons-nearest-100` tag), its
 * baked-in `bucket.radiiPc[index]` (the fixed overview radius) is replaced
 * by `starMarkerRadiusPc`'s camera-distance-dependent value instead - the
 * same close-in subset `updateDenseBatchLod` below already recomputes every
 * frame (for dense-batch visibility, and now also for any shrink-eligible
 * star's radius) gets its radius recomputed in the same pass. Every other
 * instance (not shrink-eligible - too far from the Sun, or not a star) keeps
 * using its static baked-in radius, unaffected. `cameraDistanceFromOriginPc`/
 * `denseBatchRadiusPc` both default to `Number.POSITIVE_INFINITY` ("no LOD
 * gating"); a star can still test shrink-eligible under that sentinel (any
 * finite `distance_pc` is "less than" an infinite threshold), but
 * `starMarkerRadiusPc` itself resolves an infinite `denseBatchRadiusPc` to
 * an infinite shrink-start distance too, so it always falls into its own
 * "camera at/beyond shrink-start" branch and returns its `maxRadiusPc`
 * regardless - i.e. any existing caller that doesn't pass real values sees
 * no behavior change, just a redundant (still-cheap) recomputation of the
 * same radius.
 *
 * Issue #215: `bubbleOuterRadiusPc` (defaulting to `null`, i.e. "no
 * graduated sizing") feeds `starBaselineRadiusPc` to compute THIS star's own
 * per-distance ceiling, which is then passed as `starMarkerRadiusPc`'s
 * `maxRadiusPc` instead of the flat `STAR_MARKER_RADIUS_PC`.
 *
 * Issue #26: also records `visible` on `bucket.visible[index]`, and - only
 * when actually visible - multiplies the resolved radius by
 * `bucket.sizeScale` (the "Object size" slider's current value, patched onto
 * the bucket by `updateCatalogSizeScale`; 1 until the slider is ever moved).
 * This is what lets a category/radius-filter or per-frame LOD pass (this
 * function's other callers, none of which know about the size slider) keep
 * respecting the current size scale instead of silently resetting a
 * visible instance back to its unscaled radius. A HIDDEN instance is never
 * scaled by `sizeScale` (it's already `HIDDEN_INSTANCE_SCALE`, i.e. 0), so
 * this can never resurrect a filtered-out instance.
 *
 * Story #239 (scope expansion): `positionPcOverride`, forwarded straight
 * through to `instanceMatrixFor` (see that function's own docstring), lets
 * the motion player display an animated star at its time-extrapolated
 * position while every radius/shrink/visibility computation above is
 * completely unaffected - it still keys entirely off `obj.distance_pc` (the
 * star's real, static catalog distance, never the animated one) exactly as
 * before. This is deliberately an EXTENSION of this existing function
 * (reusing its already-correct radius/visibility logic verbatim) rather than
 * a second, parallel position-setting function that could drift from it -
 * per this Story's own explicit instruction not to duplicate/diverge from
 * this logic. Defaults to `undefined`, so every pre-#239 caller (every
 * `updateCatalogVisibility`/`updateDenseBatchLod` call across the whole
 * catalog) is completely unaffected. */
export function setInstanceVisibility(
  bucket: CatalogBucket,
  index: number,
  visible: boolean,
  cameraDistanceFromOriginPc: number = Number.POSITIVE_INFINITY,
  denseBatchRadiusPc: number = Number.POSITIVE_INFINITY,
  bubbleOuterRadiusPc: number | null = null,
  positionPcOverride?: readonly [number, number, number],
): void {
  const obj = bucket.objects[index];
  bucket.visible[index] = visible;
  let radiusPc = bucket.radiiPc[index];
  if (visible && isStarMarkerShrinkEligible(obj, denseBatchRadiusPc, bubbleOuterRadiusPc)) {
    const baselineRadiusPc = starBaselineRadiusPc(obj.distance_pc, denseBatchRadiusPc, bubbleOuterRadiusPc);
    radiusPc = starMarkerRadiusPc(cameraDistanceFromOriginPc, denseBatchRadiusPc, baselineRadiusPc, bubbleOuterRadiusPc);
  }
  const effectiveRadiusPc = visible ? radiusPc * bucket.sizeScale : HIDDEN_INSTANCE_SCALE;
  bucket.mesh.setMatrixAt(index, instanceMatrixFor(obj, effectiveRadiusPc, positionPcOverride));
  bucket.mesh.instanceMatrix.needsUpdate = true;
}

/** Story #239: one animated star's resolved location within the
 * `CatalogBucket[]` array - which bucket its `InstancedMesh` instance lives
 * in, and its index within that bucket. `buildObjectIndexLookup` below
 * builds this once per scene load (well before any player session starts),
 * so `main.ts`'s per-frame animation loop never needs to scan
 * `CatalogBucket.objects` per animated star per frame - a single `Map.get`
 * instead. */
export interface CatalogObjectRef {
  bucket: CatalogBucket;
  index: number;
}

/** Builds an `id -> (bucket, index)` lookup across every bucket/object in
 * `buckets`, once. Generic over the whole catalog (not scoped to the ~127
 * animated stars specifically) since building it is already O(number of
 * catalog objects) regardless - about 700 `Map.set` calls, negligible and
 * done exactly once at scene-load time, not per frame or per player
 * session. `main.ts`'s motion player looks up only the animated stars' ids
 * in the result; nothing stops a future caller from reusing the same
 * lookup for an unrelated id -> instance resolution need. */
export function buildObjectIndexLookup(buckets: CatalogBucket[]): Map<string, CatalogObjectRef> {
  const lookup = new Map<string, CatalogObjectRef>();
  for (const bucket of buckets) {
    bucket.objects.forEach((obj, index) => {
      lookup.set(obj.id, { bucket, index });
    });
  }
  return lookup;
}

/** Builds one `InstancedMesh` per `object_type` present in `objects`
 * (excluding dedicated-marker entries, see `DEDICATED_MARKER_OBJECT_IDS`), all
 * parented under a returned `Group`, plus the `CatalogBucket[]` mapping
 * `main.ts`/`scene/picking.ts` need to resolve instances back to real
 * `SceneObject`s and to drive visibility.
 *
 * Issue #215: `denseBatchRadiusPc`/`bubbleOuterRadiusPc` (both defaulting to
 * "no graduated sizing", matching `markerRadiusPc`'s own defaults) are
 * forwarded into each star instance's baked-in `radiiPc` entry via
 * `markerRadiusPc`, so a star's OWN baseline radius - not just the flat
 * `STAR_MARKER_RADIUS_PC` - is what gets baked in at scene-load time.
 *
 * Issue #10 (Epic #7): `starRenderStyle` (defaulting to
 * `DEFAULT_STAR_RENDER_STYLE`, i.e. `MODEL` - every pre-#10 caller/test that
 * doesn't pass it keeps today's exact, unchanged behavior) is forwarded to
 * the star bucket's own construction (`buildStarCatalogBucket`) only - every
 * other object_type's bucket below is built exactly as before this issue,
 * completely untouched by the style. */
export function createCatalogObjectGroup(
  objects: SceneObject[],
  denseBatchRadiusPc = 0,
  bubbleOuterRadiusPc: number | null = null,
  starRenderStyle: StarRenderStyle = DEFAULT_STAR_RENDER_STYLE,
): {
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

    // Issue #10 (Epic #7): the star bucket's construction is dispatched by
    // the active `StarRenderStyle` via the extracted `buildStarCatalogBucket`
    // - kept as its own standalone function (rather than inlined here, as
    // it was pre-#10) specifically so `main.ts` can also call it alone to
    // rebuild JUST the star bucket on a live Settings-panel toggle, without
    // rebuilding (and thereby visually resetting) every other bucket too.
    // Every non-star bucket below keeps this loop's original, completely
    // unmodified construction.
    if (STAR_OBJECT_TYPES.has(objectType)) {
      const starBucket = buildStarCatalogBucket(
        bucketObjects,
        denseBatchRadiusPc,
        bubbleOuterRadiusPc,
        starRenderStyle,
      );
      if (starBucket) {
        group.add(starBucket.mesh);
        buckets.push(starBucket);
      }
      continue;
    }

    const color = OBJECT_TYPE_COLORS[objectType] ?? DEFAULT_COLOR;
    const opacity = markerOpacityFor(objectType);
    const mesh = new InstancedMesh(
      UNIT_SPHERE_GEOMETRY,
      materialFor(color, opacity),
      bucketObjects.length,
    );
    mesh.name = `catalog-${objectType}`;

    const radiiPc = bucketObjects.map((obj) =>
      markerRadiusPc(obj.size_pc, obj.object_type, obj.distance_pc, denseBatchRadiusPc, bubbleOuterRadiusPc),
    );
    bucketObjects.forEach((obj, i) => {
      mesh.setMatrixAt(i, instanceMatrixFor(obj, radiiPc[i]));
    });
    mesh.instanceMatrix.needsUpdate = true;

    group.add(mesh);
    buckets.push({
      objectType,
      mesh,
      objects: bucketObjects,
      radiiPc,
      sizeScale: 1,
      visible: bucketObjects.map(() => true),
    });
  }

  return { group, buckets };
}

/** Applies the current category-toggle/radius-filter state to every
 * instance across all buckets (the zero-scale visibility mechanism) -
 * called by `main.ts` whenever either changes. Object *size* (the
 * `sizeScale` slider) is a separate concern - see `updateCatalogSizeScale`,
 * which (issue #26) rewrites each visible instance's own matrix with its
 * radius times the current scale, rather than touching `mesh.scale` (which
 * would also scale every instance's baked-in position). This function
 * itself is unaffected by `sizeScale` changes - it always re-derives each
 * instance's radius via `setInstanceVisibility`, which reads `bucket.sizeScale`
 * on its own. */
export function updateCatalogVisibility(
  buckets: CatalogBucket[],
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
  cameraDistanceFromOriginPc: number = Number.POSITIVE_INFINITY,
  denseBatchRadiusPc: number = Number.POSITIVE_INFINITY,
  bubbleOuterRadiusPc: number | null = null,
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
        bubbleOuterRadiusPc,
      );
    });
  }
}

/**
 * Per-frame LOD-only update (issue #104): unlike `updateCatalogVisibility`
 * (called once per category/radius filter change, touching every
 * instance), this is cheap enough to call every frame from the render loop
 * - it walks every bucket's objects but only ever touches the instance
 * matrix of objects that actually need per-frame recomputation: members of
 * the LOD-gated dense batch (`lod.ts`'s `isDenseBatchMember`, for
 * visibility gating via `isCatalogObjectVisible`/`passesDenseBatchLod`), OR
 * any star that's shrink-eligible by real distance
 * (`isStarMarkerShrinkEligible`, issue #211 - for radius only, since
 * `passesDenseBatchLod` always leaves non-dense-batch objects visible
 * regardless of camera position). Everything else is skipped with two
 * cheap checks (an array-membership test, a numeric comparison) - still
 * negligible per-object cost even now that it's evaluated for all ~707
 * catalog objects every frame instead of short-circuiting on the tag
 * alone, since neither check allocates or does more than constant work.
 * Still defers to `isCatalogObjectVisible` for the full visibility
 * decision, so a dense-batch member that's also currently category-off or
 * outside the radius filter stays hidden regardless of camera distance -
 * the two mechanisms can never disagree about what's on screen. A
 * shrink-eligible non-dense-batch star (Fomalhaut today) is never gated by
 * `passesDenseBatchLod`, so it only ever gets its radius refreshed here,
 * never hidden/shown by this pass.
 *
 * Issue #119: this same per-frame pass carries every eligible `star`-type
 * instance's camera-distance-dependent radius (`starMarkerRadiusPc`, via
 * `setInstanceVisibility`'s `cameraDistanceFromOriginPc`/
 * `denseBatchRadiusPc` passthrough) - piggy-backing on the exact same
 * already-cheap subset/pass rather than adding a second full-catalog or
 * second dense-batch-only walk, since both concerns (LOD visibility, LOD
 * radius) only ever apply to the same small (~122, now ~123 with
 * Fomalhaut) set of close-in stars and are cheapest to recompute
 * together. */
export function updateDenseBatchLod(
  buckets: CatalogBucket[],
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
  cameraDistanceFromOriginPc: number,
  denseBatchRadiusPc: number,
  bubbleOuterRadiusPc: number | null = null,
): void {
  for (const bucket of buckets) {
    bucket.objects.forEach((obj, i) => {
      if (!isDenseBatchMember(obj) && !isStarMarkerShrinkEligible(obj, denseBatchRadiusPc, bubbleOuterRadiusPc)) return;
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
        bubbleOuterRadiusPc,
      );
    });
  }
}

/** The "Object size" slider (spec §23) scales every instance uniformly.
 *
 * Bug fix (issue #26): this used to set `bucket.mesh.scale` (the whole
 * `InstancedMesh` container's own `Object3D.scale`) directly. That multiplies
 * every instance's baked-in TRANSLATION along with its geometry - Three.js
 * computes each instance's final world position as `mesh.matrixWorld *
 * instanceMatrix[i]`, and `mesh.matrixWorld` bakes in `mesh.scale` - so every
 * marker's real position (already encoded in `instanceMatrix[i]` via
 * `instanceMatrixFor`) got scaled too, moving every object radially toward
 * or away from the Sun as the slider moved instead of just resizing it in
 * place.
 *
 * The fix instead rewrites each instance's own matrix with its baked-in
 * radius (`radiiPc[i]`) times the new `sizeScale`, leaving `instanceMatrixFor`'s
 * position argument (`bucket.objects[i].position_pc`, or the LOD/motion-
 * player's current override - see below) completely untouched, so this only
 * ever changes the geometry's scale component, never its translation.
 *
 * Two things this delegates to `setInstanceVisibility` rather than
 * reimplementing inline, both to avoid fighting other code paths that also
 * rewrite instance matrices after a bucket is built:
 *  - Skips any instance currently marked hidden (`bucket.visible[i] ===
 *    false`, per the category/radius filter or dense-batch LOD) - applying
 *    `radiiPc[i] * sizeScale` unconditionally would un-hide it by giving it a
 *    nonzero scale again.
 *  - For a currently-visible instance, calls `setInstanceVisibility(bucket,
 *    i, true, ...)` rather than composing the matrix here directly, so a
 *    dense-batch/shrink-eligible star's camera-distance-dependent radius
 *    (`starMarkerRadiusPc`, not the flat baked-in `radiiPc[i]`) is still
 *    correctly recomputed and THEN scaled - matching exactly what
 *    `updateCatalogVisibility`/`updateDenseBatchLod` would compute for it.
 *
 * Also stashes `sizeScale` on the bucket itself (`bucket.sizeScale`, read by
 * `setInstanceVisibility`) so that `updateDenseBatchLod`'s own per-frame
 * matrix rewrites (for the dense-batch/shrink-eligible subset, run every
 * frame independently of this function) keep applying the current size scale
 * too, instead of resetting those instances back to their unscaled radius on
 * the very next frame after the slider moves.
 *
 * `cameraDistanceFromOriginPc`/`denseBatchRadiusPc`/`bubbleOuterRadiusPc`
 * default to the same "no LOD gating" sentinels every other function here
 * uses, so a caller/test that doesn't pass them (i.e. no dense-batch/star-
 * shrink stars in play) sees each visible instance scaled by exactly
 * `radiiPc[i] * sizeScale`, matching the pre-fix magnitude - just without
 * moving anything.
 *
 * Motion-player interaction: this doesn't pass an animated star's
 * time-extrapolated `positionPcOverride` (`main.ts`'s `applyPlayerAnimation`
 * owns that), so calling this while the player sits on a nonzero time
 * momentarily snaps a currently-visible animated star back to its real
 * static position for one frame. This is the same tradeoff `main.ts`'s
 * `animate()` already documents for `applyDenseBatchLod` (which does the
 * same "reset to static position" every frame, unconditionally) - the
 * player's own per-frame loop runs every `requestAnimationFrame` regardless
 * of play/pause state and immediately re-applies the correct animated
 * position, so this is a self-correcting single-frame artifact, not a
 * persistent bug, exactly like the pre-existing LOD interaction. */
export function updateCatalogSizeScale(
  buckets: CatalogBucket[],
  sizeScale: number,
  cameraDistanceFromOriginPc: number = Number.POSITIVE_INFINITY,
  denseBatchRadiusPc: number = Number.POSITIVE_INFINITY,
  bubbleOuterRadiusPc: number | null = null,
): void {
  for (const bucket of buckets) {
    bucket.sizeScale = sizeScale;
    bucket.objects.forEach((_, i) => {
      if (!bucket.visible[i]) {
        return;
      }
      setInstanceVisibility(
        bucket,
        i,
        true,
        cameraDistanceFromOriginPc,
        denseBatchRadiusPc,
        bubbleOuterRadiusPc,
      );
    });
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
  cameraInsideLocalBubble = false,
): void {
  for (const bucket of buckets) {
    const color = OBJECT_TYPE_COLORS[bucket.objectType] ?? DEFAULT_COLOR;
    const opacity = backgroundBucketOpacity(
      bucket.objectType,
      cameraInsideDenseBatchSphere,
      cameraInsideLocalBubble,
    );
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
