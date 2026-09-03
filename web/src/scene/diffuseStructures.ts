import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
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
 * Story #315 (Epic #313): extended-volume rendering for the four genuinely
 * diffuse catalog object types - `molecular_cloud`, `hii_region`,
 * `planetary_nebula`, `supernova_remnant` (~19 records). Pre-#315 these
 * rendered through `scene/objects.ts`'s generic per-`object_type`
 * `InstancedMesh` point-marker bucket, exactly like a star or a cluster - a
 * uniform small dot with no relation to the object's real physical extent,
 * which is wrong for a genuinely-extended object like a molecular cloud or
 * an SNR shell now that Story #314 backfilled real `size_pc` values to
 * render against.
 *
 * Architecturally this reuses `scene/structures.ts`'s already-proven
 * pattern for the Local Bubble/Gould Belt/Radcliffe Wave layers - one
 * translucent `THREE.Mesh` per structure, built once at scene-load time
 * (zero per-frame construction cost), non-`depthWrite` so overlapping
 * volumes blend rather than incorrectly occlude - but GENERALIZED to build
 * one mesh per CATALOG RECORD from `position_pc`/`size_pc`/`object_type`,
 * rather than `structures.ts`'s three bespoke, one-structure-each named
 * functions. This module is deliberately its own file rather than an
 * addition to `structures.ts` itself: `structures.ts` is about the
 * `scene.json` `structures` block (named, one-off model overlays with their
 * own bespoke geometry - an ellipse annulus, a fitted spline, a fitted
 * ellipsoid), a fundamentally different data source and shape from "N
 * uniform catalog records of a few known types", which is instead
 * `scene/objects.ts`'s domain (the module that already owns per-`object_type`
 * catalog-object color/opacity conventions) - hence this module importing
 * FROM `objects.ts` rather than `structures.ts`.
 *
 * Labels are NOT built here. Every diffuse-structure record stays a normal
 * member of `main.ts`'s `catalogObjects` array (only the Sun and the Local
 * Bubble centroid are ever excluded from that, via
 * `excludeDedicatedMarkerObjects` - see that function's own docstring) -
 * `scene/labels.ts`'s existing label pool already covers these objects
 * exactly as it did before this Story, keyed purely off `categoryVisibility`/
 * `radiusPc`/camera distance, with no dependency on how the object's own
 * marker/volume is rendered. Reusing that existing mechanism (rather than
 * building a second, `structures.ts`-style `CSS2DObject` per diffuse
 * structure) is itself "reusing the existing label conventions already
 * established for these object types" per this Story's own acceptance
 * criteria - there already IS a label for every one of these ~19 objects,
 * unchanged by this Story.
 */

/** The four object types this Story converts from point-marker to
 * extended-volume rendering (Epic #313's own scope decision -
 * `star_cluster`/`stellar_association` explicitly stay point markers).
 * Exported so `main.ts` can exclude these types' records from the objects
 * array it hands to `objects.ts`'s `createCatalogObjectGroup` (which stays
 * completely unmodified/generic - see this module's own docstring for why
 * the exclusion happens at the `main.ts` call site instead of inside
 * `createCatalogObjectGroup` itself), and so this module's own factory
 * below can select exactly this same record set from the full catalog. */
export const DIFFUSE_STRUCTURE_OBJECT_TYPES: ReadonlySet<string> = new Set([
  "molecular_cloud",
  "hii_region",
  "planetary_nebula",
  "supernova_remnant",
]);

/**
 * `size_pc` -> mesh radius (pc), per Story #314's own verified, MIXED
 * convention: unlike `star_cluster`/`stellar_association` (where `size_pc`
 * is a RADIUS), the four diffuse types this Story renders store `size_pc`
 * as a DIAMETER (confirmed by two independent Validator passes against
 * Orion Nebula M42's own real angular size - see Story #314's PR). A sphere
 * built directly from `size_pc` as if it were already a radius would render
 * every diffuse structure at exactly 2x its correct visual size, so this
 * function is the one place that conversion happens, tested explicitly
 * against M42's own real value below.
 *
 * Falls back to `STRUCTURE_MIN_RADIUS_PC` (10pc) for a `size_pc` that's
 * still `null`/non-finite/non-positive after Story #314's honest-failure
 * handling (one record today: M8/Lagoon Nebula, per
 * `data/raw/cluster_radius/backfill_structure_size_results.json`) - the
 * exact same floor `objects.ts`'s `markerRadiusPc` already used as this
 * record's own point-marker radius pre-#315, chosen over point-marker
 * fallback (this Story's other documented option) so a `size_pc`-less
 * record still participates in the new "extended volume" visual language
 * rather than reading as a leftover dot among translucent spheres - and
 * over an arbitrary new constant, so this doesn't invent a second "what
 * does a sizeless structure look like" answer alongside the one that
 * already existed. Never renders a zero/NaN-sized mesh either way. */
export function diffuseStructureRadiusPc(sizePc: number | null): number {
  if (sizePc === null || !Number.isFinite(sizePc) || sizePc <= 0) {
    return STRUCTURE_MIN_RADIUS_PC;
  }
  return sizePc / 2;
}

/** Shared unit-radius sphere geometry - every diffuse-structure mesh scales
 * this to its own real radius rather than each owning a distinct
 * `SphereGeometry`, mirroring `objects.ts`'s own `UNIT_SPHERE_GEOMETRY`
 * convention (cheap to share since none of these ~19 meshes is ever
 * per-frame-mutated). 24/16 segments matches `structures.ts`'s
 * `createLocalBubbleLayer` sphere - smooth enough to read as a soft volume
 * at this population size (~19 meshes total; segment count is irrelevant to
 * frame cost here either way). */
const UNIT_SPHERE_GEOMETRY = new SphereGeometry(1, 24, 16);

/** One diffuse-structure record's built mesh, plus the real `SceneObject`
 * it came from - `main.ts` needs both together for visibility/dimming
 * updates and for picking (raycast hit -> real object), the same shape
 * `objects.ts`'s `CatalogBucket` serves for the point-marker buckets. */
export interface DiffuseStructureMesh {
  object: SceneObject;
  mesh: Mesh;
}

export interface DiffuseStructureLayer {
  group: Group;
  meshes: DiffuseStructureMesh[];
}

/** Builds one translucent sphere `Mesh` for `obj` - color from
 * `OBJECT_TYPE_COLORS` (falling back to `DEFAULT_COLOR` for a future/
 * unrecognized type, matching `createCatalogObjectGroup`'s own fallback),
 * opacity from `markerOpacityFor` (the exact same 0.35 "extended structure"
 * tier these types' point markers already used - issue #115's existing
 * translucency convention, reused rather than a new invented value),
 * radius from `diffuseStructureRadiusPc`, position from `position_pc`
 * directly (heliocentric Galactic Cartesian, same axes/units as every other
 * mesh in the scene). `depthWrite: false` matches every other translucent
 * structure mesh in this app (`structures.ts`'s tubes/ellipsoid) - a solid
 * translucent sphere that writes depth would incorrectly occlude whatever
 * sits behind it instead of blending with it, and would also make
 * overlapping diffuse structures (rare, but the Orion Molecular Cloud
 * Complex and M42 sit close together) fight over depth ordering. */
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
  return mesh;
}

/**
 * Builds the whole diffuse-structure extended-volume layer: one mesh per
 * `DIFFUSE_STRUCTURE_OBJECT_TYPES` record found in `objects` (every other
 * record is ignored - this is not a general-purpose catalog renderer, only
 * this Story's four types), all parented under one returned `Group` for
 * `main.ts` to add to the scene once at scene-load time. Order-preserving
 * (records appear in `meshes` in the same order they appear in `objects`),
 * though nothing currently depends on that order.
 */
export function createDiffuseStructureLayer(objects: readonly SceneObject[]): DiffuseStructureLayer {
  const group = new Group();
  group.name = "diffuse-structures";
  const meshes: DiffuseStructureMesh[] = [];
  for (const obj of objects) {
    if (!DIFFUSE_STRUCTURE_OBJECT_TYPES.has(obj.object_type)) {
      continue;
    }
    const mesh = buildDiffuseStructureMesh(obj);
    group.add(mesh);
    meshes.push({ object: obj, mesh });
  }
  return { group, meshes };
}

/**
 * Applies the current category-toggle/radius-filter state to every mesh in
 * `layer` - `main.ts`'s `applyCatalogVisibility()` calls this alongside its
 * existing `updateCatalogVisibility(catalogBuckets, ...)` call, so the two
 * mechanisms (InstancedMesh point markers for every other type, these
 * individual meshes for the four diffuse types) always agree with each
 * other and with the Layers panel checkboxes. Reuses `objects.ts`'s own
 * `isCatalogObjectVisible` predicate directly (category + radius-filter +
 * dense-batch LOD, in that same combined decision) rather than
 * re-deriving a second one - these types are never dense-batch members
 * (`lod.ts`'s `isDenseBatchMember` is keyed off a RECONS-nearby-star
 * provenance tag no diffuse-structure record carries), so the LOD
 * parameters are safely left at their "no gating" defaults.
 *
 * A plain `Mesh`, unlike `InstancedMesh`, has a real `.visible` - so
 * hide/show here is the ordinary Three.js mechanism, not
 * `objects.ts`'s zero-scale InstancedMesh workaround (see that module's
 * own docstring for why THAT trick is needed there and not here).
 */
export function updateDiffuseStructureVisibility(
  layer: DiffuseStructureLayer,
  categoryVisibility: ReadonlyMap<string, boolean>,
  radiusPc: number | null,
): void {
  for (const { object, mesh } of layer.meshes) {
    mesh.visible = isCatalogObjectVisible(object, categoryVisibility, radiusPc);
  }
}

/**
 * Dims/restores every diffuse-structure mesh's opacity in place - the same
 * three-tier camera-distance dimming (`objects.ts`'s `backgroundBucketOpacity`)
 * `main.ts`'s `applyBackgroundDimming` already applies to every other
 * non-star catalog bucket AND to `structures.ts`'s three named overlays
 * (`setGouldBeltDimmed`/`setRadcliffeWaveDimmed`/`setLocalBubbleDimmed`).
 * These four types were ALREADY part of that same dimming system pre-#315
 * (as point markers - `shouldDimBackground` returns `true` for every
 * non-star type), so reusing it verbatim here - rather than inventing a new
 * dim-factor scheme, the Story's own explicitly-allowed simpler option -
 * keeps their dimming behavior visually IDENTICAL across this Story's
 * rendering-mode change: the RECONS-sphere/Local-Bubble spotlight effect
 * still recedes these structures by the exact same proportion it always
 * did, just applied to a translucent sphere's opacity instead of an
 * InstancedMesh bucket's shared material opacity.
 *
 * In-place `.opacity` mutation (not a cached-material swap, unlike
 * `objects.ts`'s `updateBackgroundDimming`) is safe here for the same
 * reason it's safe in `structures.ts`'s `setStructureLayerOpacityFactor`:
 * each mesh owns its own freshly-constructed, never-cached
 * `MeshBasicMaterial` (`buildDiffuseStructureMesh` above), so there is no
 * other owner of this exact material instance a mutation could leak into. */
export function updateDiffuseStructureDimming(
  layer: DiffuseStructureLayer,
  cameraInsideDenseBatchSphere: boolean,
  cameraInsideLocalBubble = false,
): void {
  for (const { object, mesh } of layer.meshes) {
    const opacity = backgroundBucketOpacity(
      object.object_type,
      cameraInsideDenseBatchSphere,
      cameraInsideLocalBubble,
    );
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
