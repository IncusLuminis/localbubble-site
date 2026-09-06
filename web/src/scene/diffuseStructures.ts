import {
  CanvasTexture,
  Color,
  Group,
  Mesh,
  MeshBasicMaterial,
  Sprite,
  SpriteMaterial,
  SphereGeometry,
} from "three";
import type { SceneObject } from "./sceneTypes";
import {
  backgroundBucketOpacity,
  DEFAULT_COLOR,
  isCatalogObjectVisible,
  markerOpacityFor,
  OBJECT_TYPE_COLORS,
  STRUCTURE_MIN_RADIUS_PC,
} from "./objects";

/**
 * Story #315 (Epic #313): extended-volume rendering for genuinely diffuse/
 * extended catalog object types, generalizing `structures.ts`'s already-
 * proven "one translucent mesh per structure, built once at scene-load time"
 * pattern to N catalog records rather than three bespoke named structures.
 *
 * Story #320 (this file's current scope) formalizes a confirmed live-tested
 * design on top of #315's foundation:
 *  - `molecular_cloud`/`hii_region`/`supernova_remnant` get a "misty cloud"
 *    sprite-cluster shape (`buildMistyCloudGroup`) instead of a plain sphere,
 *    for a wispier, non-hard-edged look.
 *  - `stellar_association`/`star_cluster` - previously left as generic
 *    point markers in `objects.ts`'s `InstancedMesh` buckets - move into this
 *    same extended-volume system with their own shapes (`buildAssociationGroup`/
 *    `buildClusterGroup`), the key visual distinction being that a cluster's
 *    member "sparks" are strictly contained within its bounding sphere while
 *    an association's are allowed to drift past its haze's nominal radius.
 *  - `planetary_nebula` keeps #315's original plain-sphere treatment
 *    (`buildDiffuseStructureMesh`) - no shape change was ever requested for
 *    it.
 *
 * Every shape here is decorative (`Sprite`/`Mesh` children with no collision
 * geometry of their own) - `picking.ts` raycasts only against each record's
 * own invisible proxy `Mesh` (`DiffuseStructureMesh.mesh`, always registered,
 * see that field's own docstring), never against the decorative shape. This
 * is what keeps click-to-inspect, category-toggle visibility, and
 * camera-distance dimming all working via the exact same mechanism #315
 * established, regardless of how elaborate the on-screen shape gets.
 *
 * Labels are NOT built here - see this docstring's own earlier revision
 * (still accurate): every record stays a normal member of `main.ts`'s
 * `catalogObjects` array, so `scene/labels.ts`'s existing label pool keeps
 * covering these objects unchanged by either Story.
 */

/** Every catalog object type this module renders as an extended volume
 * instead of `objects.ts`'s generic point-marker `InstancedMesh` bucket.
 * Story #315: the four genuinely-diffuse types. Story #320: adds
 * `stellar_association`/`star_cluster` too, once they got their own
 * confirmed shapes (`buildAssociationGroup`/`buildClusterGroup`) - Epic
 * #313's original scope had deliberately left both as point markers, but
 * that's superseded by this Story's own confirmed design.
 *
 * Exported so `main.ts` can exclude these types' records from the objects
 * array it hands to `objects.ts`'s `createCatalogObjectGroup` (which stays
 * completely generic/unmodified), and so this module's own
 * `createDiffuseStructureLayer` can select exactly this same record set.
 * `main.ts` filtering off this ONE set (rather than a second, possibly-
 * drifting exclusion list) is what guarantees no double-rendering - a type
 * added here is automatically removed from the point-marker path too. */
export const DIFFUSE_STRUCTURE_OBJECT_TYPES: ReadonlySet<string> = new Set([
  "molecular_cloud",
  "hii_region",
  "planetary_nebula",
  "supernova_remnant",
  "stellar_association",
  "star_cluster",
]);

/** The subset of `DIFFUSE_STRUCTURE_OBJECT_TYPES` that gets the "misty
 * cloud" sprite-cluster shape (`buildMistyCloudGroup`) - `planetary_nebula`
 * is deliberately excluded (never requested; keeps #315's plain-sphere
 * look), and `stellar_association`/`star_cluster` have their own distinct
 * shapes instead (see `createDiffuseStructureLayer`'s dispatch below). */
const MISTY_CLOUD_OBJECT_TYPES: ReadonlySet<string> = new Set([
  "molecular_cloud",
  "hii_region",
  "supernova_remnant",
]);

/**
 * `size_pc` -> mesh radius (pc), per Story #314's own verified, MIXED
 * convention: unlike `star_cluster`/`stellar_association` (where `size_pc`
 * is a RADIUS), the diffuse types this function serves store `size_pc` as a
 * DIAMETER (confirmed by two independent Validator passes against Orion
 * Nebula M42's own real angular size - see Story #314's PR). A sphere built
 * directly from `size_pc` as if it were already a radius would render every
 * diffuse structure at exactly 2x its correct visual size, so this function
 * is the one place that conversion happens, tested explicitly against M42's
 * own real value below.
 *
 * Falls back to `STRUCTURE_MIN_RADIUS_PC` (10pc) for a `size_pc` that's
 * still `null`/non-finite/non-positive after Story #314's honest-failure
 * handling (one record today: M8/Lagoon Nebula) - the exact same floor
 * `objects.ts`'s `markerRadiusPc` already used as this record's own
 * point-marker radius pre-#315. Never renders a zero/NaN-sized mesh either
 * way.
 *
 * Story #320: still ONLY used for the `molecular_cloud`/`hii_region`/
 * `supernova_remnant`/`planetary_nebula` DIAMETER-convention types - the new
 * `star_cluster`/`stellar_association` shapes use `resolveRadiusPcFromSize`
 * below instead, since Story #314 documented those two types as using the
 * opposite (RADIUS) convention. */
export function diffuseStructureRadiusPc(sizePc: number | null): number {
  if (sizePc === null || !Number.isFinite(sizePc) || sizePc <= 0) {
    return STRUCTURE_MIN_RADIUS_PC;
  }
  return sizePc / 2;
}

/** `size_pc` -> render radius (pc) for the RADIUS-convention types
 * (`star_cluster`/`stellar_association`, Story #314) - unlike
 * `diffuseStructureRadiusPc` above, no /2 conversion: a real, finite,
 * positive `size_pc` IS the radius already. Falls back to `fallbackPc`
 * (each caller's own deliberate design constant - see
 * `CLUSTER_DEFAULT_RADIUS_PC`/`ASSOCIATION_DEFAULT_RADIUS_PC` below) when
 * `size_pc` is `null`/non-finite/non-positive, mirroring
 * `diffuseStructureRadiusPc`'s own honest-failure handling. Factored out as
 * its own function (Story #320 cleanup) since both the cluster and
 * association branches of `createDiffuseStructureLayer` need the identical
 * "real size_pc, else fallback" resolution - keeping one copy avoids the
 * two ever silently drifting apart. */
function resolveRadiusPcFromSize(sizePc: number | null, fallbackPc: number): number {
  if (sizePc !== null && Number.isFinite(sizePc) && sizePc > 0) {
    return sizePc;
  }
  return fallbackPc;
}

/** PR #321 Validator-found regression fix: the exact render radius (pc) that
 * `createDiffuseStructureLayer` below computes for a `star_cluster`/
 * `stellar_association` record - real `size_pc` when present (via
 * `resolveRadiusPcFromSize`), else each type's own default
 * (`CLUSTER_DEFAULT_RADIUS_PC`/`ASSOCIATION_DEFAULT_RADIUS_PC`), with
 * `CLUSTER_MAX_RADIUS_PC` applied for `star_cluster` only. Factored out of
 * `createDiffuseStructureLayer`'s own two branches (which now call this
 * instead of inlining the same arithmetic) specifically so a second consumer
 * - `main.ts`'s `selectedObjectMarkerRadiusPc` - can source the selection
 * reticle's radius from this exact same computation rather than
 * copy-pasting these constants into a second place that could silently
 * drift out of sync again.
 *
 * Story #320 originally left the reticle sourcing its radius for these two
 * types from `objects.ts`'s OLD point-marker tier formula (`markerRadiusPc`'s
 * `CLUSTER_OBJECT_TYPES` branch: floor 5pc/ceiling 9pc, `size_pc / 4`) -
 * correct before that Story, when these two types actually rendered through
 * that formula, but never updated once their rendering moved here. Most
 * visibly wrong for a `size_pc`-less `stellar_association` (the common case
 * per Story #314's own documented honest-failure rate): the reticle showed
 * ~5-9pc while the haze itself rendered at `ASSOCIATION_DEFAULT_RADIUS_PC`
 * (22pc). See PR #321's Validator comment for the full writeup, and
 * `test/diffuseStructures.test.ts`'s "clusterOrAssociationShapeRadiusPc"
 * describe block for the regression tests.
 *
 * Throws for any other `object_type` - a caller asking this function for a
 * type it doesn't own is itself a bug (there is no meaningful radius to
 * return), not something to silently paper over. */
export function clusterOrAssociationShapeRadiusPc(obj: SceneObject): number {
  if (obj.object_type === "star_cluster") {
    const rawRadiusPc = resolveRadiusPcFromSize(obj.size_pc, CLUSTER_DEFAULT_RADIUS_PC);
    return Math.min(rawRadiusPc, CLUSTER_MAX_RADIUS_PC);
  }
  if (obj.object_type === "stellar_association") {
    return resolveRadiusPcFromSize(obj.size_pc, ASSOCIATION_DEFAULT_RADIUS_PC);
  }
  throw new Error(
    `clusterOrAssociationShapeRadiusPc: expected object_type "star_cluster" or "stellar_association", got "${obj.object_type}" (id: "${obj.id}")`,
  );
}

/** Shared unit-radius sphere geometry - every diffuse-structure mesh
 * (visual plain-sphere meshes, invisible picking proxies, AND the cluster
 * shape's bounded gray sphere) scales this to its own real radius rather
 * than each owning a distinct `SphereGeometry`, mirroring `objects.ts`'s own
 * `UNIT_SPHERE_GEOMETRY` convention. 24/16 segments matches
 * `structures.ts`'s `createLocalBubbleLayer` sphere - smooth enough to read
 * as a soft volume at this population size; segment count is irrelevant to
 * frame cost here either way (this file's meshes are all static, built once
 * at scene-load time). */
const UNIT_SPHERE_GEOMETRY = new SphereGeometry(1, 24, 16);

/** One diffuse-structure record's built mesh, plus the real `SceneObject`
 * it came from - `main.ts` needs both together for visibility/dimming
 * updates and for picking (raycast hit -> real object), the same shape
 * `objects.ts`'s `CatalogBucket` serves for the point-marker buckets. */
export interface DiffuseStructureMesh {
  object: SceneObject;
  /** The raycast/visibility target `picking.ts` and
   * `updateDiffuseStructureVisibility` actually operate on.
   *
   * For `planetary_nebula` (the one type that kept #315's original
   * treatment) this IS the visible sphere itself.
   *
   * For every other type in this Story (`molecular_cloud`/`hii_region`/
   * `supernova_remnant`/`stellar_association`/`star_cluster`), this is
   * instead an INVISIBLE (opacity 0, but `visible: true`) proxy sphere -
   * the actual on-screen look lives in `spriteGroup` below. Critically, this
   * proxy's radius is capped at `PICK_PROXY_RADIUS_CAP_PC`, decoupled from
   * however large the shape renders visually (see that constant's own
   * docstring for the exact bug this fixes: an oversized proxy stealing
   * clicks meant for a smaller, nearby object). */
  mesh: Mesh;
  /** Present only when `mesh` is an invisible picking proxy (see above) -
   * the real decorative shape, kept in sync with `mesh`'s visibility/dimming
   * state by `updateDiffuseStructureVisibility`/`updateDiffuseStructureDimming`
   * below. Absent (`undefined`) for `planetary_nebula`, whose `mesh` is
   * itself the visible shape. */
  spriteGroup?: Group;
}

export interface DiffuseStructureLayer {
  group: Group;
  meshes: DiffuseStructureMesh[];
}

/** Builds one translucent sphere `Mesh` for `obj` - color from
 * `OBJECT_TYPE_COLORS` (falling back to `DEFAULT_COLOR` for a future/
 * unrecognized type), opacity from `markerOpacityFor` (the "extended
 * structure" tier), radius from `diffuseStructureRadiusPc`, position from
 * `position_pc` directly. `depthWrite: false` so overlapping translucent
 * volumes blend rather than incorrectly occlude one another.
 *
 * Story #320: now used ONLY for `planetary_nebula` (the one diffuse type
 * that keeps this Story's predecessor's plain-sphere look) - every other
 * type gets one of the new shapes below plus its own dedicated invisible
 * proxy (`buildPickProxyMesh`), so this function no longer needs an
 * opacity override or any other new parameter. */
function buildDiffuseStructureMesh(obj: SceneObject): Mesh {
  const color = OBJECT_TYPE_COLORS[obj.object_type] ?? DEFAULT_COLOR;
  const radiusPc = diffuseStructureRadiusPc(obj.size_pc);
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: markerOpacityFor(obj.object_type),
    depthWrite: false,
  });
  const mesh = new Mesh(UNIT_SPHERE_GEOMETRY, material);
  mesh.name = `diffuse-structure-${obj.id}`;
  mesh.scale.setScalar(radiusPc);
  mesh.position.set(obj.position_pc[0], obj.position_pc[1], obj.position_pc[2]);
  // Issue #26: stashed so `updateDiffuseStructureSizeScale` can recompute
  // `baseRadiusPc * sizeScale` fresh on every "Object size" slider change,
  // rather than compounding repeated multiplications of `mesh.scale`'s own
  // live value - mirrors this module's existing `userData.baseOpacity`
  // convention (same "need the pre-effect base value later" problem).
  mesh.userData.baseRadiusPc = radiusPc;
  return mesh;
}

/** Story #320: hard cap (pc) on the INVISIBLE PICKING PROXY's radius,
 * applied uniformly to every shaped type below (misty clouds/nebulae/SNR,
 * associations, clusters) - deliberately separate from, and generally much
 * smaller than, any of those types' own VISUAL radius (which can legitimately
 * run to tens of pc for a real molecular cloud or supernova remnant).
 *
 * This is the fix for a real bug the human owner found and reported during
 * live testing: a proxy sized to the shape's full VISUAL radius (e.g. Vela
 * Supernova Remnant's real ~80pc extent) creates a raycast hit-target large
 * enough to win the "nearest intersection along the ray" contest against a
 * much smaller object's own proxy, even when that smaller object sits
 * further from the camera in true 3D depth and renders as a visually
 * distinct dot ON TOP of the larger structure's translucent haze. That
 * "on top" appearance comes purely from transparent-material blend order,
 * not real depth - `Raycaster` only cares about true distance-to-camera, so
 * an oversized proxy's near surface can sit closer to the camera than the
 * small object's own surface even though the small object is what the user
 * is actually looking at and clicking on. Confirmed live: clicking a small
 * cluster's own visible marker, sitting inside/near Vela SNR's big misty
 * patch, opened the Inspector for Vela SNR instead of the cluster.
 *
 * Capping every proxy at this one small, fixed radius means a big
 * structure's invisible hit-target only ever extends 8pc from its own
 * center - any smaller object whose own proxy sits further than that from
 * the big structure's center can no longer be shadowed by it, regardless of
 * how large the big structure's VISUAL shape renders. See
 * `test/picking.test.ts`'s "picking-proxy radius cap" describe block for the
 * regression test proving this precedence. */
const PICK_PROXY_RADIUS_CAP_PC = 8;

/** Builds one invisible (opacity 0, but `visible: true`) proxy `Mesh` for
 * `obj`, radius capped at `PICK_PROXY_RADIUS_CAP_PC` regardless of the
 * shape's own visual `radiusPc` (see that constant's docstring for why the
 * cap exists) - this is the sole raycast/visibility target `picking.ts` and
 * `updateDiffuseStructureVisibility` operate on for every shaped type below.
 * A flat black, always-zero-opacity material is used since the color is
 * never actually visible; `depthWrite: false` matches every other
 * translucent mesh in this module (irrelevant at opacity 0, kept for
 * consistency). */
function buildPickProxyMesh(obj: SceneObject, radiusPc: number): Mesh {
  const material = new MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0,
    depthWrite: false,
  });
  const mesh = new Mesh(UNIT_SPHERE_GEOMETRY, material);
  mesh.name = `diffuse-structure-proxy-${obj.id}`;
  const cappedRadiusPc = Math.min(radiusPc, PICK_PROXY_RADIUS_CAP_PC);
  mesh.scale.setScalar(cappedRadiusPc);
  mesh.position.set(obj.position_pc[0], obj.position_pc[1], obj.position_pc[2]);
  // Issue #26: same `updateDiffuseStructureSizeScale` bookkeeping as
  // `buildDiffuseStructureMesh` above - stores the CAPPED radius (not the
  // shape's own uncapped `radiusPc`) since that's the value actually baked
  // into `mesh.scale` here, and is what should be scaled by the size slider.
  mesh.userData.baseRadiusPc = cappedRadiusPc;
  return mesh;
}

/* ------------------------------------------------------------------------
 * Story #320: confirmed shape treatments. Colors/radii/counts below are the
 * human owner's own values, settled during a live interactive session (see
 * issue #320's own "Confirmed design" section) - not derived from any
 * physical data, and not up for re-litigation by this Story.
 * ---------------------------------------------------------------------- */

/** One shared soft radial-gradient texture (white centre fading to fully
 * transparent) for every misty-cloud/haze/spark sprite in this module -
 * built once, reused (tinted per-sprite via `SpriteMaterial.color`), so this
 * costs at most one small canvas + one GPU texture upload total, never one
 * per sprite/object.
 *
 * Story #320 known-issue fix: the reference prototype called
 * `document.createElement("canvas")` unconditionally, which threw
 * `ReferenceError: document is not defined` under this repo's `environment:
 * "node"` Vitest config (no DOM global at all) - breaking every test that
 * builds a `DiffuseStructureLayer`, including pre-existing ones in
 * `picking.test.ts` unrelated to this Story. Rather than pull in a jsdom
 * environment (this repo's own established convention, see
 * `axes.ts`/`structures.ts`/`labels.ts`'s own docstrings, is instead to keep
 * DOM-touching code reachable-but-untested from the `environment: "node"`
 * suite), this guards on `typeof document === "undefined"` and returns
 * `null` in that case - every caller already treats a `null`/absent texture
 * as "sprite with a flat, untextured material" (still fully constructible
 * and testable: real position/scale/color/opacity, just no soft gradient
 * map), so the test suite can exercise every bit of this module's actual
 * shape-building logic without a real DOM. In a real browser `document` is
 * always defined, so production rendering is completely unaffected. */
let mistySpriteTexture: CanvasTexture | null | undefined;
export function getMistySpriteTexture(): CanvasTexture | null {
  if (mistySpriteTexture !== undefined) {
    return mistySpriteTexture;
  }
  if (typeof document === "undefined") {
    mistySpriteTexture = null;
    return mistySpriteTexture;
  }
  const size = 128;
  const canvas = document.createElement("canvas");
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    mistySpriteTexture = null;
    return mistySpriteTexture;
  }
  const gradient = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  gradient.addColorStop(0, "rgba(255,255,255,0.9)");
  gradient.addColorStop(0.4, "rgba(255,255,255,0.5)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, size, size);
  mistySpriteTexture = new CanvasTexture(canvas);
  return mistySpriteTexture;
}

/** Builds one `SpriteMaterial` tinted `color` at `opacity`, using the shared
 * misty-sprite texture when one is available (real browser) and omitting
 * `map` entirely when it's not (this repo's DOM-less test environment) -
 * `new SpriteMaterial({ map: undefined, ... })` would otherwise log a
 * `THREE.Material: parameter 'map' has value of undefined` console warning
 * on every sprite built under test, since Three.js's own `Material.setValues`
 * warns on any explicitly-passed `undefined` parameter value regardless of
 * whether that's semantically "no map." Factored out (Story #320 cleanup)
 * since every shape builder below needs this same texture-or-not
 * conditional. */
function makeSpriteMaterial(texture: CanvasTexture | null, color: Color, opacity: number): SpriteMaterial {
  return new SpriteMaterial({
    ...(texture ? { map: texture } : {}),
    color,
    transparent: true,
    opacity,
    depthWrite: false,
  });
}

/** Deterministic pseudo-random in [0,1) (Park-Miller minimal-standard LCG),
 * seeded per-object so a given record's cloud/haze/cluster looks identical
 * across reloads rather than reshuffling on every page load - makes visual
 * regressions/screenshots comparable. Not cryptographically meaningful, just
 * a cheap, dependency-free deterministic sequence. */
function seededRandom(seed: number): () => number {
  let s = seed % 2147483647;
  if (s <= 0) {
    s += 2147483646;
  }
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Amount `createDiffuseStructureLayer`'s running seed advances between
 * successive shaped records, so no two records ever sample the exact same
 * pseudo-random sequence. Prime, and much larger than any single shape's own
 * `rand()` call count (at most `2 * CLUSTER_STAR_COUNT` + 1 calls per
 * record), so consecutive records' sequences don't overlap either. */
const SHAPE_SEED_STEP = 97;

/** How many overlapping soft sprites make up one "misty cloud" shape
 * (`molecular_cloud`/`hii_region`/`supernova_remnant`) - confirmed value
 * from live testing, small enough to stay cheap (a few hundred sprites total
 * across the whole catalog) while still reading as a wispy, non-spherical
 * volume rather than a single flat billboard. */
export const MISTY_CLOUD_SPRITE_COUNT = 6;

/** Builds a "misty cloud" `Group`: `spriteCount` overlapping soft,
 * camera-facing sprites cube-sampled within `radiusPc` of `positionPc`
 * (deliberately allowed to poke slightly past the nominal radius - part of
 * the amorphous/wispy look, unlike `buildClusterGroup`'s strictly-contained
 * sparks below), tinted `colorHex`. Purely decorative - never itself a
 * raycast/visibility target, see `DiffuseStructureMesh.spriteGroup`'s own
 * docstring. */
export function buildMistyCloudGroup(
  positionPc: readonly [number, number, number],
  radiusPc: number,
  colorHex: number,
  seed: number,
  spriteCount: number = MISTY_CLOUD_SPRITE_COUNT,
): Group {
  const group = new Group();
  const texture = getMistySpriteTexture();
  const rand = seededRandom(seed);
  const tint = new Color(colorHex);
  for (let i = 0; i < spriteCount; i++) {
    const baseOpacity = 0.22 + rand() * 0.16;
    const material = makeSpriteMaterial(texture, tint, baseOpacity);
    const sprite = new Sprite(material);
    // Stashed so `updateDiffuseStructureDimming` can scale relative to each
    // sprite's own randomized base opacity rather than clobbering the
    // variation with one flat dimmed value.
    sprite.userData.baseOpacity = baseOpacity;
    const offsetScale = radiusPc * 0.55;
    sprite.position.set(
      (rand() * 2 - 1) * offsetScale,
      (rand() * 2 - 1) * offsetScale,
      (rand() * 2 - 1) * offsetScale,
    );
    const spriteRadius = radiusPc * (0.55 + rand() * 0.55);
    sprite.scale.setScalar(spriteRadius * 2);
    group.add(sprite);
  }
  group.position.set(positionPc[0], positionPc[1], positionPc[2]);
  return group;
}

/** Fallback radius (pc) for a `stellar_association` record lacking
 * `size_pc` - most of these do (Story #314's own documented honest-failure
 * rate for large-scale OB associations/moving groups with no well-defined
 * structural radius in any source). Deliberate visual-design constant from
 * live testing, not data-derived - kept exactly as confirmed, no cap
 * requested/needed for this type (unlike `star_cluster`'s
 * `CLUSTER_MAX_RADIUS_PC` below). */
export const ASSOCIATION_DEFAULT_RADIUS_PC = 22;

/** How many small bright "member star" spark sprites scatter within one
 * `stellar_association`'s haze - confirmed value from live testing. */
export const ASSOCIATION_SPARK_COUNT = 16;

/** Warm-white "member star" spark tint, shared by `buildAssociationGroup`'s
 * sparks and `buildClusterGroup`'s sparks below - distinct from any
 * `OBJECT_TYPE_COLORS` entry so a spark reads as "an individual star" rather
 * than blending into its own group's haze/sphere color. */
const MEMBER_STAR_SPARK_COLOR = 0xfff4d6;

/** Builds a `stellar_association` volume: one big, low-opacity haze sprite
 * (the same soft-billboard technique as `buildMistyCloudGroup`, just a
 * single larger one) tinted the association's own `OBJECT_TYPE_COLORS`
 * color, plus `sparkCount` small bright sprites scattered within it standing
 * in for individual member stars. Real membership data is NOT used - this
 * is a purely decorative impression that an association is a loose scatter
 * of stars, not a single point.
 *
 * Sparks are cube-sampled (like the misty cloud, unlike
 * `buildClusterGroup`'s rejection-sampled sparks) - deliberately allowed to
 * drift past the haze's nominal radius, which is this shape's own key visual
 * distinction from a cluster's strictly-bounded sparks (the human owner's
 * own explicit requirement, see `buildClusterGroup`'s docstring). */
export function buildAssociationGroup(
  positionPc: readonly [number, number, number],
  radiusPc: number,
  colorHex: number,
  seed: number,
  sparkCount: number = ASSOCIATION_SPARK_COUNT,
): Group {
  const group = new Group();
  const texture = getMistySpriteTexture();
  const rand = seededRandom(seed);

  const hazeOpacity = 0.16;
  const hazeMaterial = makeSpriteMaterial(texture, new Color(colorHex), hazeOpacity);
  const haze = new Sprite(hazeMaterial);
  haze.userData.baseOpacity = hazeOpacity;
  haze.scale.setScalar(radiusPc * 2);
  group.add(haze);

  const sparkTint = new Color(MEMBER_STAR_SPARK_COLOR);
  for (let i = 0; i < sparkCount; i++) {
    const baseOpacity = 0.75 + rand() * 0.25;
    const sparkMaterial = makeSpriteMaterial(texture, sparkTint, baseOpacity);
    const spark = new Sprite(sparkMaterial);
    spark.userData.baseOpacity = baseOpacity;
    // Scattered within 85% of the haze radius so sparks read as "inside"
    // the ball, not poking out past its own soft edge (cube-sampled, so a
    // spark CAN still exit the true nominal radius at the cube's corners -
    // deliberate, see this function's own docstring).
    const offsetScale = radiusPc * 0.85;
    spark.position.set(
      (rand() * 2 - 1) * offsetScale,
      (rand() * 2 - 1) * offsetScale,
      (rand() * 2 - 1) * offsetScale,
    );
    const sparkRadius = radiusPc * (0.04 + rand() * 0.03);
    spark.scale.setScalar(sparkRadius * 2);
    group.add(spark);
  }
  group.position.set(positionPc[0], positionPc[1], positionPc[2]);
  return group;
}

/** Fallback radius (pc) for a `star_cluster` record lacking `size_pc` -
 * clusters resolve real sizes far more often than associations (Story
 * #314), so this is a rarer fallback than `ASSOCIATION_DEFAULT_RADIUS_PC`,
 * kept smaller since clusters are physically tighter groupings than OB
 * associations/moving groups. Deliberate visual-design constant from live
 * testing, not data-derived. */
export const CLUSTER_DEFAULT_RADIUS_PC = 8;

/** Hard cap (pc) on a cluster's RENDERED radius - a render-size clamp only,
 * does NOT touch the underlying `size_pc` data. The catalog's real
 * backfilled `size_pc` for `star_cluster` (Story #314, Tarricq/Cantat-Gaudin
 * tidal-radius sourced) has a long tail: median ~7pc, but a handful of
 * loosely-bound groups resolve tidal radii up to ~99pc, and at that size the
 * translucent sphere dominates the view and blocks clicking on anything else
 * nearby (human owner's own live-testing report - the render-size problem
 * that motivated this cap, distinct from the picking-proxy problem
 * `PICK_PROXY_RADIUS_CAP_PC` fixes). Clamping keeps the vast majority of
 * clusters (median/p90 well under this) rendering at their real size while
 * preventing the runaway outliers from swallowing the scene. Deliberate
 * visual-design constant from live testing, not data-derived. */
export const CLUSTER_MAX_RADIUS_PC = 12;

/** Very light gray - deliberately NOT `OBJECT_TYPE_COLORS`'s own cluster
 * yellow, so the bounding sphere itself reads as a neutral containing volume
 * and the warm-white sparks inside are what carries the cluster's
 * color/identity. Confirmed value from live testing. */
const CLUSTER_SPHERE_COLOR = 0xd8dde6;

/** How many small bright "member star" spark sprites scatter, strictly
 * contained, within one `star_cluster`'s bounding sphere - confirmed value
 * from live testing. */
export const CLUSTER_STAR_COUNT = 12;

/** Maximum rejection-sampling attempts before `randomPointStrictlyInsideUnitSphere`
 * falls back to a scaled-down sample - a uniform cube sample lands inside
 * the inscribed unit sphere ~52% of the time, so 20 attempts is
 * astronomically unlikely to ever matter in practice; it exists purely so a
 * pathological `rand()` sequence can't loop forever. */
const MAX_SPHERE_REJECTION_ATTEMPTS = 20;

/** Uniform-random point strictly inside a radius-1 ball, via rejection
 * sampling (reject any cube sample outside the unit sphere, retry). Unlike
 * `buildAssociationGroup`'s deliberately cube-sampled sparks (which can poke
 * past the haze's nominal radius, part of that shape's own "amorphous"
 * look), a cluster's member points must NEVER exit its bounding sphere - the
 * human owner's own explicit distinguishing requirement from associations -
 * so this needs an actual in-sphere guarantee, not merely "usually inside."
 *
 * Exported directly for unit testing: the precise, testable claim is "every
 * sample this function ever returns has length <= 1", verified against many
 * samples in `test/diffuseStructures.test.ts`. */
export function randomPointStrictlyInsideUnitSphere(rand: () => number): [number, number, number] {
  for (let attempt = 0; attempt < MAX_SPHERE_REJECTION_ATTEMPTS; attempt++) {
    const x = rand() * 2 - 1;
    const y = rand() * 2 - 1;
    const z = rand() * 2 - 1;
    const lengthSq = x * x + y * y + z * z;
    if (lengthSq <= 1) {
      return [x, y, z];
    }
  }
  // Fallback: scale the last sample down to 90% of the unit ball's radius
  // rather than retrying indefinitely - still strictly inside.
  const x = rand() * 2 - 1;
  const y = rand() * 2 - 1;
  const z = rand() * 2 - 1;
  const length = Math.sqrt(x * x + y * y + z * z) || 1;
  const scale = 0.9 / length;
  return [x * scale, y * scale, z * scale];
}

/** Keeps a spark's own small radius from poking through the bounding
 * sphere's surface even when `randomPointStrictlyInsideUnitSphere` samples a
 * point very close to the unit sphere's own surface (length very close to
 * 1) - applied on top of the sampling already being strictly `<= 1`. */
const CLUSTER_SPARK_CONTAINMENT_MARGIN = 0.9;

/** Builds a `star_cluster` volume: one translucent, very-light-gray
 * `SphereGeometry` `Mesh` (a crisp, bounded volume - distinct from
 * `buildAssociationGroup`'s soft amorphous haze sprite) plus `starCount`
 * small bright sprites scattered STRICTLY inside that sphere's true radius
 * via `randomPointStrictlyInsideUnitSphere` - the human owner's own explicit
 * distinguishing requirement from associations, where sparks may extend
 * past the nominal radius. Real membership data is NOT used, same "no need
 * for real shape/scale" instruction as the association shape. */
export function buildClusterGroup(
  positionPc: readonly [number, number, number],
  radiusPc: number,
  seed: number,
  starCount: number = CLUSTER_STAR_COUNT,
): Group {
  const group = new Group();
  const rand = seededRandom(seed);

  const sphereOpacity = 0.14;
  const sphereMaterial = new MeshBasicMaterial({
    color: CLUSTER_SPHERE_COLOR,
    transparent: true,
    opacity: sphereOpacity,
    depthWrite: false,
  });
  const sphere = new Mesh(UNIT_SPHERE_GEOMETRY, sphereMaterial);
  sphere.userData.baseOpacity = sphereOpacity;
  sphere.scale.setScalar(radiusPc);
  group.add(sphere);

  const texture = getMistySpriteTexture();
  const sparkTint = new Color(MEMBER_STAR_SPARK_COLOR);
  for (let i = 0; i < starCount; i++) {
    const baseOpacity = 0.75 + rand() * 0.25;
    const sparkMaterial = makeSpriteMaterial(texture, sparkTint, baseOpacity);
    const spark = new Sprite(sparkMaterial);
    spark.userData.baseOpacity = baseOpacity;
    const [ux, uy, uz] = randomPointStrictlyInsideUnitSphere(rand);
    spark.position.set(
      ux * radiusPc * CLUSTER_SPARK_CONTAINMENT_MARGIN,
      uy * radiusPc * CLUSTER_SPARK_CONTAINMENT_MARGIN,
      uz * radiusPc * CLUSTER_SPARK_CONTAINMENT_MARGIN,
    );
    const sparkRadius = radiusPc * (0.04 + rand() * 0.03);
    spark.scale.setScalar(sparkRadius * 2);
    group.add(spark);
  }
  group.position.set(positionPc[0], positionPc[1], positionPc[2]);
  return group;
}

/**
 * Builds the whole diffuse-structure extended-volume layer: one entry per
 * `DIFFUSE_STRUCTURE_OBJECT_TYPES` record found in `objects` (every other
 * record is ignored - this is not a general-purpose catalog renderer, only
 * this module's own six types), all parented under one returned `Group` for
 * `main.ts` to add to the scene once at scene-load time. Order-preserving
 * (records appear in `meshes` in the same order they appear in `objects`),
 * though nothing currently depends on that order.
 *
 * `shapeSeed` advances by `SHAPE_SEED_STEP` for every shaped (non-
 * `planetary_nebula`) record, giving each one an independent deterministic
 * pseudo-random sequence for its own sprite scatter.
 */
export function createDiffuseStructureLayer(objects: readonly SceneObject[]): DiffuseStructureLayer {
  const group = new Group();
  group.name = "diffuse-structures";
  const meshes: DiffuseStructureMesh[] = [];
  let shapeSeed = 1;

  for (const obj of objects) {
    if (!DIFFUSE_STRUCTURE_OBJECT_TYPES.has(obj.object_type)) {
      continue;
    }

    if (MISTY_CLOUD_OBJECT_TYPES.has(obj.object_type)) {
      const radiusPc = diffuseStructureRadiusPc(obj.size_pc);
      const color = OBJECT_TYPE_COLORS[obj.object_type] ?? DEFAULT_COLOR;
      const proxyMesh = buildPickProxyMesh(obj, radiusPc);
      const cloud = buildMistyCloudGroup(obj.position_pc, radiusPc, color, shapeSeed);
      cloud.name = `diffuse-structure-misty-${obj.id}`;
      shapeSeed += SHAPE_SEED_STEP;
      group.add(proxyMesh, cloud);
      meshes.push({ object: obj, mesh: proxyMesh, spriteGroup: cloud });
      continue;
    }

    if (obj.object_type === "stellar_association") {
      const radiusPc = clusterOrAssociationShapeRadiusPc(obj);
      const color = OBJECT_TYPE_COLORS[obj.object_type] ?? DEFAULT_COLOR;
      const proxyMesh = buildPickProxyMesh(obj, radiusPc);
      const association = buildAssociationGroup(obj.position_pc, radiusPc, color, shapeSeed);
      association.name = `diffuse-structure-association-${obj.id}`;
      shapeSeed += SHAPE_SEED_STEP;
      group.add(proxyMesh, association);
      meshes.push({ object: obj, mesh: proxyMesh, spriteGroup: association });
      continue;
    }

    if (obj.object_type === "star_cluster") {
      const radiusPc = clusterOrAssociationShapeRadiusPc(obj);
      const proxyMesh = buildPickProxyMesh(obj, radiusPc);
      const cluster = buildClusterGroup(obj.position_pc, radiusPc, shapeSeed);
      cluster.name = `diffuse-structure-cluster-${obj.id}`;
      shapeSeed += SHAPE_SEED_STEP;
      group.add(proxyMesh, cluster);
      meshes.push({ object: obj, mesh: proxyMesh, spriteGroup: cluster });
      continue;
    }

    // planetary_nebula - the one type that keeps #315's original plain,
    // hard-edged translucent sphere; no shape change was ever requested.
    const mesh = buildDiffuseStructureMesh(obj);
    group.add(mesh);
    meshes.push({ object: obj, mesh });
  }
  return { group, meshes };
}

/**
 * Applies the current category-toggle/radius-filter state to every entry in
 * `layer` - `main.ts`'s `applyCatalogVisibility()` calls this alongside its
 * existing `updateCatalogVisibility(catalogBuckets, ...)` call, so the two
 * mechanisms always agree with each other and with the Layers panel
 * checkboxes. Reuses `objects.ts`'s own `isCatalogObjectVisible` predicate
 * directly rather than re-deriving a second one.
 *
 * Story #320: `spriteGroup`, when present, is kept in lockstep with its
 * proxy `mesh`'s visibility - `picking.ts` only ever checks `mesh.visible`
 * (see that module's own docstring), so this is purely so the decorative
 * shape actually disappears from the RENDERED scene when its category is
 * toggled off, not just from the (already-invisible) picking proxy.
 */
export function updateDiffuseStructureVisibility(
  layer: DiffuseStructureLayer,
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
): void {
  for (const { object, mesh, spriteGroup } of layer.meshes) {
    const visible = isCatalogObjectVisible(object, categoryVisibility, radiusPc);
    mesh.visible = visible;
    if (spriteGroup) {
      spriteGroup.visible = visible;
    }
  }
}

/**
 * Applies the "Object size" slider (issue #26) to every diffuse-structure
 * entry IN PLACE, one entry at a time - never to `layer.group` (the shared
 * top-level container every entry lives inside, sitting at the Sun's own
 * origin). Scaling `layer.group` itself was the bug this replaces: each
 * entry's `mesh`/`spriteGroup` already has its real Sun-relative POSITION
 * baked in at construction (`obj.position_pc`, via `mesh.position.set(...)`/
 * `group.position.set(...)`), and Three.js composes a child's final world
 * transform as `parent.matrixWorld * child.matrix` - so scaling the shared
 * parent multiplies every child's own local position too, moving every
 * nebula/cluster/association radially toward or away from the Sun as the
 * slider moved, instead of just resizing each one in place. Scaling each
 * entry's OWN transform instead leaves `layer.group` (and therefore every
 * child's position) untouched; only geometry actually changes size.
 *
 * The two fields need different treatment, since they encode radius
 * differently:
 *  - `mesh` (the invisible picking proxy for a shaped type, or the plain
 *    visible sphere itself for `planetary_nebula`) bakes its OWN radius
 *    directly into `.scale` at construction (`buildDiffuseStructureMesh`/
 *    `buildPickProxyMesh`) - so this recomputes `baseRadiusPc * sizeScale`
 *    fresh each call, using the ORIGINAL radius stashed in
 *    `mesh.userData.baseRadiusPc` by those builders (rather than compounding
 *    repeated multiplications of `mesh.scale`'s own already-live value).
 *  - `spriteGroup`, when present, is a wrapping `Group` whose OWN `.scale`
 *    is never touched at construction (only `.position` is set) - every
 *    child sprite/mesh inside it already encodes its own position/radius
 *    relative to the group's own origin (that structure's real position).
 *    Setting the group's `.scale` directly to `sizeScale` therefore already
 *    means "resize every child around this structure's own center", with no
 *    separate base value to track - and produces the exact same effective
 *    on-screen magnitude the old (buggy) `layer.group.scale.setScalar(sizeScale)`
 *    did for these children, since a nested group's default scale was
 *    already 1 (so scaling the-then-shared top-level container by
 *    `sizeScale` was mathematically equivalent to scaling this group alone
 *    by `sizeScale` - only the now-fixed position side effect differs).
 */
export function updateDiffuseStructureSizeScale(layer: DiffuseStructureLayer, sizeScale: number): void {
  for (const { mesh, spriteGroup } of layer.meshes) {
    const baseRadiusPc = (mesh.userData.baseRadiusPc as number | undefined) ?? 1;
    mesh.scale.setScalar(baseRadiusPc * sizeScale);
    if (spriteGroup) {
      spriteGroup.scale.setScalar(sizeScale);
    }
  }
}

/**
 * Dims/restores every diffuse-structure entry's opacity in place - the same
 * three-tier camera-distance dimming (`objects.ts`'s `backgroundBucketOpacity`)
 * `main.ts`'s `applyBackgroundDimming` already applies to every other
 * non-star catalog bucket and to `structures.ts`'s three named overlays.
 *
 * For a `planetary_nebula` entry (no `spriteGroup`), this mutates `mesh`'s
 * own material opacity directly, unchanged from #315.
 *
 * Story #320: for every shaped entry (`spriteGroup` present), the proxy
 * `mesh` stays permanently invisible (opacity 0) - only the group's own
 * children carry visible opacity, each scaled relative to its OWN
 * randomized/fixed base opacity (stashed in `userData.baseOpacity` by every
 * builder above) so the dimming ratio applies uniformly without erasing the
 * child-to-child variation those builders deliberately introduce. Duck-typed
 * on `instanceof Sprite || instanceof Mesh` rather than a `Sprite`-only
 * check (#315's original loop) - `buildClusterGroup`'s bounding sphere is a
 * `Mesh`, not a `Sprite`, and needs the exact same treatment as every
 * sprite child alongside it, or a dimmed cluster would show its still-full-
 * opacity gray sphere with only its sparks dimmed.
 */
export function updateDiffuseStructureDimming(
  layer: DiffuseStructureLayer,
  cameraInsideDenseBatchSphere: boolean,
  cameraInsideLocalBubble = false,
): void {
  for (const { object, mesh, spriteGroup } of layer.meshes) {
    const opacity = backgroundBucketOpacity(
      object.object_type,
      cameraInsideDenseBatchSphere,
      cameraInsideLocalBubble,
    );
    if (spriteGroup) {
      const fullOpacity = markerOpacityFor(object.object_type);
      const dimRatio = fullOpacity > 0 ? opacity / fullOpacity : 0;
      for (const child of spriteGroup.children) {
        if (!(child instanceof Sprite || child instanceof Mesh)) {
          continue;
        }
        const baseOpacity = (child.userData.baseOpacity as number | undefined) ?? 0.3;
        (child.material as SpriteMaterial | MeshBasicMaterial).opacity = baseOpacity * dimRatio;
      }
      continue;
    }
    (mesh.material as MeshBasicMaterial).opacity = opacity;
  }
}

/** The diffuse-structure `SceneObject`s currently visible under
 * `categoryVisibility`/`radiusPc`, mirroring `objects.ts`'s
 * `visibleCatalogObjects` for this layer - `main.ts`'s "Fit all" camera
 * preset unions this with `visibleCatalogObjects(catalogBuckets, ...)` so
 * framing still includes diffuse structures exactly as it did when they
 * were point-marker bucket members. Reuses the exact same
 * `isCatalogObjectVisible` predicate as `updateDiffuseStructureVisibility`
 * above, so the two can never disagree about what's actually on screen. */
export function visibleDiffuseStructureObjects(
  layer: DiffuseStructureLayer,
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
): SceneObject[] {
  return layer.meshes
    .map(({ object }) => object)
    .filter((object) => isCatalogObjectVisible(object, categoryVisibility, radiusPc));
}
