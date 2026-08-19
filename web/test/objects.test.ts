import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { InstancedMesh, MeshBasicMaterial } from "three";
import {
  catalogObjectTypes,
  createCatalogObjectGroup,
  excludeDedicatedMarkerObjects,
  isCatalogObjectVisible,
  isSelectedObjectVisible,
  LOCAL_BUBBLE_OBJECT_ID,
  markerOpacityFor,
  markerRadiusPc,
  setInstanceVisibility,
  SUN_OBJECT_ID,
  updateCatalogSizeScale,
  updateCatalogVisibility,
  updateDenseBatchLod,
  visibleCatalogObjects,
  type CatalogBucket,
} from "../src/scene/objects";
import { DENSE_BATCH_GROUP_TAG } from "../src/scene/lod";
import type { SceneObject } from "../src/scene/sceneTypes";

/**
 * Regression coverage for PR #79 review (the Sun double-render bug) plus
 * issue #89's `InstancedMesh` conversion: one instance buffer per
 * `object_type`, correct per-instance transforms (position + radius baked
 * into scale), and the zero-scale visibility mechanism that replaces plain
 * `Mesh.visible` now that instances can't have their own `.visible`. None
 * of this needs a real WebGL context - `THREE.InstancedMesh`/`Matrix4` are
 * plain data/math types constructible under Node (spec §38).
 */

function makeObject(overrides: Partial<SceneObject>): SceneObject {
  return {
    id: "test-object",
    name: "Test Object",
    aliases: [],
    object_type: "molecular_cloud",
    position_pc: [10, 20, 30],
    distance_pc: 37.4,
    distance_error_pc: null,
    size_pc: null,
    color_class: null,
    group: { primary: null, secondary: [] },
    source: { reference: "test fixture", url: null, catalog: null },
    notes: null,
    ...overrides,
  };
}

const SUN_ENTRY = makeObject({
  id: "sun",
  name: "Sun",
  object_type: "reference_point",
  position_pc: [0, 0, 0],
  distance_pc: 0,
});

/** Issue #101: the Local Bubble's catalog centroid, `object_type: "bubble"`
 * - `scene/structures.ts`'s `createLocalBubbleLayer` already renders a
 * true-scale wireframe ellipsoid for this same real object, so (like the
 * Sun) it must be excluded from the generic catalog-object render loop. */
const LOCAL_BUBBLE_ENTRY = makeObject({
  id: "local-bubble-centroid",
  name: "Local Bubble",
  object_type: "bubble",
  position_pc: [10.2, 33.6, 0],
  distance_pc: 35.11,
  size_pc: 60,
});

const CLOUD_A = makeObject({ id: "cloud-a", position_pc: [100, 0, 0], distance_pc: 100 });
const CLOUD_B = makeObject({ id: "cloud-b", position_pc: [0, 200, -10], distance_pc: 200.25 });
const STAR_A = makeObject({
  id: "star-a",
  object_type: "star",
  position_pc: [5, 5, 5],
  distance_pc: 8.66,
});
const STAR_B = makeObject({
  id: "star-b",
  object_type: "star",
  position_pc: [50, 0, 0],
  distance_pc: 50,
});

/** Reads instance `index`'s baked transform back out of `bucket.mesh` via
 * `Three`'s own `Matrix4.decompose`, so tests assert against the real
 * position/scale rather than internals of how the matrix was built. */
function decomposeInstanceMatrix(
  bucket: CatalogBucket,
  index: number,
): { position: Vector3; quaternion: Quaternion; scale: Vector3 } {
  const matrix = new Matrix4();
  (bucket.mesh as InstancedMesh).getMatrixAt(index, matrix);
  const position = new Vector3();
  const quaternion = new Quaternion();
  const scale = new Vector3();
  matrix.decompose(position, quaternion, scale);
  return { position, quaternion, scale };
}

/**
 * Issue #103: type-aware three-tier marker-radius hierarchy (spec
 * `Idea-v1.3-visual-fidelity-and-navigation.md` §2.3) - individual stars
 * strictly smaller than clusters/associations, which are strictly smaller
 * than everything else (extended structures, and any unrecognized/future
 * object_type as a catch-all). The tiers' pc ranges are constructed not to
 * overlap, so `star < cluster < structure` must hold for *every* possible
 * `size_pc`, not just the catalog's actual (mostly-null) values - these
 * tests sweep a range of `size_pc` inputs rather than asserting one sample
 * point, so a future change that lets one tier's range creep into another's
 * would fail here even if today's catalog data happened not to expose it.
 */
describe("markerRadiusPc (issue #103 three-tier hierarchy)", () => {
  const CLUSTER_TYPES = ["star_cluster", "stellar_association"];
  // Representative of "everything else": real extended-structure types plus
  // an unrecognized/future object_type, which must fall through to the same
  // catch-all tier rather than erroring or silently matching a real tier.
  const STRUCTURE_TYPES = [
    "molecular_cloud",
    "hii_region",
    "supernova_remnant",
    "bubble",
    "some_future_object_type",
  ];
  const SIZE_PC_SAMPLES = [null, 0, -5, 1, 4, 8, 11.6, 20, 45, 60, 200, 10_000];

  it("stars always render at one fixed radius, regardless of size_pc", () => {
    const radii = new Set(SIZE_PC_SAMPLES.map((sizePc) => markerRadiusPc(sizePc, "star")));
    expect(radii.size).toBe(1);
  });

  it("clusters and associations share the same tier for every size_pc sample", () => {
    for (const sizePc of SIZE_PC_SAMPLES) {
      const radii = CLUSTER_TYPES.map((type) => markerRadiusPc(sizePc, type));
      expect(new Set(radii).size).toBe(1);
    }
  });

  it("every structure type (plus an unrecognized/future type) shares the same catch-all tier", () => {
    for (const sizePc of SIZE_PC_SAMPLES) {
      const radii = STRUCTURE_TYPES.map((type) => markerRadiusPc(sizePc, type));
      expect(new Set(radii).size).toBe(1);
    }
  });

  it("holds star < cluster < structure strictly, across every size_pc sample and every type combination", () => {
    for (const sizePc of SIZE_PC_SAMPLES) {
      const starRadius = markerRadiusPc(sizePc, "star");
      for (const clusterType of CLUSTER_TYPES) {
        const clusterRadius = markerRadiusPc(sizePc, clusterType);
        expect(starRadius).toBeLessThan(clusterRadius);
        for (const structureType of STRUCTURE_TYPES) {
          const structureRadius = markerRadiusPc(sizePc, structureType);
          expect(clusterRadius).toBeLessThan(structureRadius);
          expect(starRadius).toBeLessThan(structureRadius);
        }
      }
    }
  });

  it("a real size_pc nudges the cluster tier's radius up within its own range, without ever reaching the structure tier's minimum", () => {
    const floorRadius = markerRadiusPc(null, "star_cluster");
    const withSize = markerRadiusPc(11.6, "star_cluster"); // catalog's one nonnull star_cluster size_pc
    expect(withSize).toBeGreaterThanOrEqual(floorRadius);
    expect(withSize).toBeLessThan(markerRadiusPc(null, "molecular_cloud"));
  });

  it("null/zero/negative/non-finite size_pc all fall back to each tier's own floor", () => {
    for (const invalidSize of [null, 0, -5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(markerRadiusPc(invalidSize, "star")).toBe(markerRadiusPc(null, "star"));
      expect(markerRadiusPc(invalidSize, "star_cluster")).toBe(markerRadiusPc(null, "star_cluster"));
      expect(markerRadiusPc(invalidSize, "molecular_cloud")).toBe(markerRadiusPc(null, "molecular_cloud"));
    }
  });

  it("a very large size_pc is clamped at each tier's own ceiling, never crossing into the next tier", () => {
    const hugeSize = 1_000_000;
    expect(markerRadiusPc(hugeSize, "star")).toBe(markerRadiusPc(null, "star"));
    const clusterMax = markerRadiusPc(hugeSize, "star_cluster");
    const structureMax = markerRadiusPc(hugeSize, "molecular_cloud");
    expect(clusterMax).toBeLessThan(structureMax);
    // Clamped, not unbounded: a further increase in size_pc must not move it.
    expect(markerRadiusPc(hugeSize * 10, "star_cluster")).toBe(clusterMax);
    expect(markerRadiusPc(hugeSize * 10, "molecular_cloud")).toBe(structureMax);
  });
});

/**
 * Issue #115: type-aware marker opacity, mirroring #103's radius-tier test
 * shape above and deliberately reusing the exact same star/cluster/
 * "everything else" partition. Discrete stellar groupings (stars,
 * clusters, associations) must stay exactly as opaque as before #115;
 * extended, physically-diffuse structures (molecular clouds, HII regions,
 * bubbles, supernova remnants, star-forming regions, and any
 * unrecognized/future object_type) must render meaningfully more
 * translucent than that.
 */
describe("markerOpacityFor (issue #115 opacity tiers)", () => {
  const STAR_AND_CLUSTER_TYPES = ["star", "star_cluster", "stellar_association"];
  // Representative of "everything else": every real extended-structure type
  // named in the issue, plus star_forming_region (physically diffuse too,
  // even though not spelled out in the issue's own example list) and an
  // unrecognized/future object_type, which must all fall through to the
  // same catch-all translucent tier rather than erroring or staying opaque.
  const STRUCTURE_TYPES = [
    "molecular_cloud",
    "hii_region",
    "supernova_remnant",
    "bubble",
    "star_forming_region",
    "some_future_object_type",
  ];

  it("stars, clusters, and associations all share one fully-opaque tier", () => {
    const opacities = new Set(STAR_AND_CLUSTER_TYPES.map((type) => markerOpacityFor(type)));
    expect(opacities.size).toBe(1);
    expect([...opacities][0]).toBe(0.85);
  });

  it("every extended-structure type (plus an unrecognized/future type) shares one translucent tier", () => {
    const opacities = new Set(STRUCTURE_TYPES.map((type) => markerOpacityFor(type)));
    expect(opacities.size).toBe(1);
  });

  it("the structure tier is meaningfully more translucent than the star/cluster tier", () => {
    const opaqueOpacity = markerOpacityFor("star");
    for (const structureType of STRUCTURE_TYPES) {
      const structureOpacity = markerOpacityFor(structureType);
      expect(structureOpacity).toBeLessThan(opaqueOpacity);
      // "Meaningfully" translucent, not just a hair lower.
      expect(opaqueOpacity - structureOpacity).toBeGreaterThanOrEqual(0.3);
    }
  });

  it("a non-Sun reference_point (the catch-all's only currently-plausible real-world member) renders translucent, not erroring", () => {
    expect(markerOpacityFor("reference_point")).toBe(markerOpacityFor("molecular_cloud"));
  });

  it("createCatalogObjectGroup bakes the type-appropriate opacity into each bucket's material", () => {
    const cluster = makeObject({ id: "cluster-a", object_type: "star_cluster" });
    const { buckets } = createCatalogObjectGroup([CLOUD_A, cluster, STAR_A]);

    const structureBucket = buckets.find((b) => b.objectType === "molecular_cloud") as CatalogBucket;
    const clusterBucket = buckets.find((b) => b.objectType === "star_cluster") as CatalogBucket;
    const starBucket = buckets.find((b) => b.objectType === "star") as CatalogBucket;

    const opacityOf = (bucket: CatalogBucket): number =>
      (bucket.mesh.material as MeshBasicMaterial).opacity;

    expect(opacityOf(structureBucket)).toBe(markerOpacityFor("molecular_cloud"));
    expect(opacityOf(clusterBucket)).toBe(markerOpacityFor("star_cluster"));
    expect(opacityOf(starBucket)).toBe(markerOpacityFor("star"));
    expect(opacityOf(structureBucket)).toBeLessThan(opacityOf(clusterBucket));
    expect(opacityOf(starBucket)).toBe(opacityOf(clusterBucket));
  });
});

describe("excludeDedicatedMarkerObjects", () => {
  it("drops the Sun's own catalog entry by id", () => {
    const filtered = excludeDedicatedMarkerObjects([SUN_ENTRY, CLOUD_A, CLOUD_B]);
    expect(filtered.map((o) => o.id)).toEqual(["cloud-a", "cloud-b"]);
    expect(filtered.some((o) => o.id === SUN_OBJECT_ID)).toBe(false);
  });

  it("keeps a non-Sun reference_point object (type is not Sun-exclusive)", () => {
    const otherReferencePoint = makeObject({
      id: "some-other-reference-point",
      object_type: "reference_point",
      position_pc: [50, 50, 50],
    });
    const filtered = excludeDedicatedMarkerObjects([SUN_ENTRY, otherReferencePoint]);
    expect(filtered.map((o) => o.id)).toEqual(["some-other-reference-point"]);
  });

  it("is a no-op when the Sun entry is absent", () => {
    const filtered = excludeDedicatedMarkerObjects([CLOUD_A, CLOUD_B]);
    expect(filtered).toHaveLength(2);
  });

  // Issue #101 regression: the Local Bubble's catalog centroid already has
  // its own dedicated visual (the structure-layer ellipsoid), so it must be
  // dropped from the generic marker-sphere/label loop the same way the Sun
  // is - otherwise the two disagreeing representations (15pc generic marker
  // vs. true-scale ellipsoid) both render at once.
  it("drops the Local Bubble's own catalog entry by id", () => {
    const filtered = excludeDedicatedMarkerObjects([LOCAL_BUBBLE_ENTRY, CLOUD_A, CLOUD_B]);
    expect(filtered.map((o) => o.id)).toEqual(["cloud-a", "cloud-b"]);
    expect(filtered.some((o) => o.id === LOCAL_BUBBLE_OBJECT_ID)).toBe(false);
  });

  it("drops both the Sun and the Local Bubble together, keeping everything else", () => {
    const filtered = excludeDedicatedMarkerObjects([
      SUN_ENTRY,
      LOCAL_BUBBLE_ENTRY,
      CLOUD_A,
      CLOUD_B,
    ]);
    expect(filtered.map((o) => o.id).sort()).toEqual(["cloud-a", "cloud-b"]);
  });
});

describe("catalogObjectTypes", () => {
  it("returns distinct, sorted object_type values, excluding the Sun", () => {
    const clusterA = makeObject({ id: "cluster-a", object_type: "star_cluster" });
    const clusterB = makeObject({ id: "cluster-b", object_type: "star_cluster" });
    const snr = makeObject({ id: "snr-a", object_type: "supernova_remnant" });
    const types = catalogObjectTypes([SUN_ENTRY, CLOUD_A, clusterA, clusterB, snr]);
    expect(types).toEqual(["molecular_cloud", "star_cluster", "supernova_remnant"]);
  });

  it("is empty for an all-Sun (or empty) input", () => {
    expect(catalogObjectTypes([SUN_ENTRY])).toEqual([]);
    expect(catalogObjectTypes([])).toEqual([]);
  });

  // Issue #101: "bubble" is not currently offered as a layer-toggle category
  // because the Local Bubble's only catalog member is the excluded centroid
  // entry - the structure-layer checkbox (main.ts's separate "Local Bubble"
  // toggle) is what controls its visibility instead.
  it("omits 'bubble' when the Local Bubble centroid is the only such entry", () => {
    const types = catalogObjectTypes([SUN_ENTRY, LOCAL_BUBBLE_ENTRY, CLOUD_A]);
    expect(types).toEqual(["molecular_cloud"]);
  });
});

describe("createCatalogObjectGroup (InstancedMesh buckets)", () => {
  it("builds one InstancedMesh bucket per object_type, excluding the Sun", () => {
    const { group, buckets } = createCatalogObjectGroup([SUN_ENTRY, CLOUD_A, CLOUD_B, STAR_A, STAR_B]);

    expect(buckets.map((b) => b.objectType).sort()).toEqual(["molecular_cloud", "star"]);
    expect(group.children).toHaveLength(2);
    // Every child of the group is one of the buckets' InstancedMesh.
    expect(group.children.every((child) => buckets.some((b) => b.mesh === child))).toBe(true);
  });

  it("sizes each bucket's instance count to the objects actually in it", () => {
    const { buckets } = createCatalogObjectGroup([SUN_ENTRY, CLOUD_A, CLOUD_B, STAR_A, STAR_B]);
    const moleculeBucket = buckets.find((b) => b.objectType === "molecular_cloud") as CatalogBucket;
    const starBucket = buckets.find((b) => b.objectType === "star") as CatalogBucket;

    expect(moleculeBucket.objects.map((o) => o.id).sort()).toEqual(["cloud-a", "cloud-b"]);
    expect(moleculeBucket.mesh.count).toBe(2);
    expect(starBucket.objects.map((o) => o.id).sort()).toEqual(["star-a", "star-b"]);
    expect(starBucket.mesh.count).toBe(2);
  });

  it("never creates an instance for the Sun's own catalog entry", () => {
    const { buckets } = createCatalogObjectGroup([SUN_ENTRY, CLOUD_A]);
    for (const bucket of buckets) {
      expect(bucket.objects.some((o) => o.id === SUN_OBJECT_ID)).toBe(false);
    }
  });

  // Issue #101 regression: no InstancedMesh bucket, and therefore no
  // pickable/raycastable marker sphere, should ever be created for the
  // Local Bubble's catalog centroid - `scene/structures.ts`'s
  // `createLocalBubbleLayer` is the sole visual for it.
  it("never creates an instance or a 'bubble' bucket for the Local Bubble centroid", () => {
    const { buckets } = createCatalogObjectGroup([LOCAL_BUBBLE_ENTRY, CLOUD_A]);
    expect(buckets.some((b) => b.objectType === "bubble")).toBe(false);
    for (const bucket of buckets) {
      expect(bucket.objects.some((o) => o.id === LOCAL_BUBBLE_OBJECT_ID)).toBe(false);
    }
  });

  it("encodes each instance's transform as its real position with a radius-derived scale", () => {
    const { buckets } = createCatalogObjectGroup([CLOUD_A, CLOUD_B]);
    const bucket = buckets[0];

    bucket.objects.forEach((obj, i) => {
      const { position, scale } = decomposeInstanceMatrix(bucket, i);
      expect(position.toArray()).toEqual(obj.position_pc);
      const expectedRadius = markerRadiusPc(obj.size_pc, obj.object_type);
      expect(scale.x).toBeCloseTo(expectedRadius, 6);
      expect(scale.y).toBeCloseTo(expectedRadius, 6);
      expect(scale.z).toBeCloseTo(expectedRadius, 6);
    });
  });
});

describe("setInstanceVisibility (zero-scale hide mechanism)", () => {
  it("collapses a hidden instance's transform to zero scale without touching its position", () => {
    const { buckets } = createCatalogObjectGroup([CLOUD_A, CLOUD_B]);
    const bucket = buckets[0];

    setInstanceVisibility(bucket, 0, false);

    const { position, scale } = decomposeInstanceMatrix(bucket, 0);
    expect(scale.x).toBe(0);
    expect(scale.y).toBe(0);
    expect(scale.z).toBe(0);
    expect(position.toArray()).toEqual(bucket.objects[0].position_pc);
  });

  it("restores the real radius scale when shown again, without shifting instance indices", () => {
    const { buckets } = createCatalogObjectGroup([CLOUD_A, CLOUD_B]);
    const bucket = buckets[0];

    setInstanceVisibility(bucket, 0, false);
    setInstanceVisibility(bucket, 0, true);

    const { scale } = decomposeInstanceMatrix(bucket, 0);
    expect(scale.x).toBeCloseTo(bucket.radiiPc[0], 6);
    // Instance count/order is unchanged - index 1 still maps to the same object.
    expect(bucket.objects[1].id).toBe("cloud-b");
    expect(bucket.mesh.count).toBe(2);
  });
});

describe("isCatalogObjectVisible / updateCatalogVisibility / visibleCatalogObjects", () => {
  const categoryVisibility = new Map<string, boolean>([
    ["molecular_cloud", true],
    ["star", false],
  ]);

  it("is false when the object's category is toggled off", () => {
    expect(isCatalogObjectVisible(STAR_A, categoryVisibility, null)).toBe(false);
  });

  it("is false when the object is outside the radius filter", () => {
    expect(isCatalogObjectVisible(CLOUD_B, categoryVisibility, 100)).toBe(false);
  });

  it("is true when the category is on and the object is within radius", () => {
    expect(isCatalogObjectVisible(CLOUD_A, categoryVisibility, 100)).toBe(true);
  });

  it("updateCatalogVisibility hides category-off and out-of-radius instances via zero scale", () => {
    const { buckets } = createCatalogObjectGroup([CLOUD_A, CLOUD_B, STAR_A, STAR_B]);
    updateCatalogVisibility(buckets, categoryVisibility, 150);

    const moleculeBucket = buckets.find((b) => b.objectType === "molecular_cloud") as CatalogBucket;
    const starBucket = buckets.find((b) => b.objectType === "star") as CatalogBucket;

    const scaleOf = (bucket: CatalogBucket, index: number): number =>
      decomposeInstanceMatrix(bucket, index).scale.x;

    const cloudAIndex = moleculeBucket.objects.findIndex((o) => o.id === "cloud-a");
    const cloudBIndex = moleculeBucket.objects.findIndex((o) => o.id === "cloud-b");
    expect(scaleOf(moleculeBucket, cloudAIndex)).toBeGreaterThan(0); // within 150pc, category on
    expect(scaleOf(moleculeBucket, cloudBIndex)).toBe(0); // 200.25pc > 150pc radius filter

    // Whole "star" category is off - both instances zero-scaled regardless of radius.
    for (let i = 0; i < starBucket.objects.length; i++) {
      expect(scaleOf(starBucket, i)).toBe(0);
    }
  });

  it("visibleCatalogObjects agrees exactly with the per-instance visibility updateCatalogVisibility applies", () => {
    const { buckets } = createCatalogObjectGroup([CLOUD_A, CLOUD_B, STAR_A, STAR_B]);
    const visible = visibleCatalogObjects(buckets, categoryVisibility, 150);
    expect(visible.map((o) => o.id)).toEqual(["cloud-a"]);
  });
});

/**
 * Issue #95: selecting an object and then filtering it out (radius slider,
 * object-type toggle) previously left the Inspector showing stale data for
 * a now-invisible/unpickable object, because nothing re-checked
 * `selectedObjectId`'s own visibility when a filter changed.
 * `isSelectedObjectVisible` is the single check `main.ts`'s
 * `applyCatalogVisibility()` now runs on every filter change to decide
 * whether to keep showing the Inspector or hide it - it deliberately reuses
 * `isCatalogObjectVisible` (already exercised above) so the two can never
 * disagree about what's actually visible on screen.
 */
describe("isSelectedObjectVisible", () => {
  const categoryVisibility = new Map<string, boolean>([
    ["molecular_cloud", true],
    ["star", false],
  ]);
  const objects = [CLOUD_A, CLOUD_B, STAR_A, STAR_B];

  it("is false when nothing is selected", () => {
    expect(isSelectedObjectVisible(objects, null, categoryVisibility, null)).toBe(false);
  });

  it("is false when the selected id no longer exists in the catalog", () => {
    expect(isSelectedObjectVisible(objects, "no-such-id", categoryVisibility, null)).toBe(false);
  });

  it("is true when the selected object's category is on and it is within radius", () => {
    expect(isSelectedObjectVisible(objects, "cloud-a", categoryVisibility, 150)).toBe(true);
  });

  it("is false when the selected object's category has been toggled off", () => {
    // star-a's category ('star') is off in categoryVisibility above.
    expect(isSelectedObjectVisible(objects, "star-a", categoryVisibility, null)).toBe(false);
  });

  it("is false when the selected object has been filtered out by radius", () => {
    // cloud-b is 200.25pc away, outside a 150pc radius filter.
    expect(isSelectedObjectVisible(objects, "cloud-b", categoryVisibility, 150)).toBe(false);
  });

  it("agrees with isCatalogObjectVisible for the same object/filter state", () => {
    for (const obj of objects) {
      expect(isSelectedObjectVisible(objects, obj.id, categoryVisibility, 150)).toBe(
        isCatalogObjectVisible(obj, categoryVisibility, 150),
      );
    }
  });
});

describe("updateCatalogSizeScale", () => {
  it("scales the InstancedMesh container itself, not the per-instance matrices", () => {
    const { buckets } = createCatalogObjectGroup([CLOUD_A]);
    updateCatalogSizeScale(buckets, 2.5);
    for (const bucket of buckets) {
      expect(bucket.mesh.scale.x).toBe(2.5);
      expect(bucket.mesh.scale.y).toBe(2.5);
      expect(bucket.mesh.scale.z).toBe(2.5);
    }
  });
});

/**
 * Issue #104: camera-distance-gated (LOD) marker visibility for the dense
 * RECONS batch. `lod.ts`'s own predicate/radius-derivation logic is
 * covered in `lod.test.ts`; these tests cover how `objects.ts` composes
 * that with the pre-existing category/radius-filter visibility rules, and
 * the per-frame-only `updateDenseBatchLod` update path.
 */
describe("dense-batch LOD (isCatalogObjectVisible / updateDenseBatchLod)", () => {
  const NEARBY_STAR = makeObject({
    id: "proxima",
    object_type: "star",
    position_pc: [0.9, -0.9, -0.04],
    distance_pc: 1.3,
    group: { primary: null, secondary: [DENSE_BATCH_GROUP_TAG] },
  });
  const ALL_ON = new Map<string, boolean>([["star", true]]);
  const collectionRadiusPc = 11.26;

  it("isCatalogObjectVisible defaults to no LOD gating when the extra params are omitted", () => {
    // Unaffected, pre-existing 3-arg call sites (see the describe block
    // above) must keep working exactly as before, even for a dense-batch
    // member - this is what makes the added parameters backward compatible.
    expect(isCatalogObjectVisible(NEARBY_STAR, ALL_ON, null)).toBe(true);
  });

  it("isCatalogObjectVisible hides a dense-batch member when the camera is far from the origin", () => {
    expect(
      isCatalogObjectVisible(NEARBY_STAR, ALL_ON, null, 1087, collectionRadiusPc),
    ).toBe(false);
  });

  it("isCatalogObjectVisible shows a dense-batch member once the camera is close enough in", () => {
    expect(isCatalogObjectVisible(NEARBY_STAR, ALL_ON, null, 5, collectionRadiusPc)).toBe(true);
  });

  it("isCatalogObjectVisible still applies category/radius filters on top of LOD", () => {
    const starOff = new Map<string, boolean>([["star", false]]);
    expect(isCatalogObjectVisible(NEARBY_STAR, starOff, null, 5, collectionRadiusPc)).toBe(false);
    expect(isCatalogObjectVisible(NEARBY_STAR, ALL_ON, 1, 5, collectionRadiusPc)).toBe(false); // 1.3pc > 1pc radius
  });

  it("isCatalogObjectVisible never LOD-gates an object outside the dense batch", () => {
    expect(isCatalogObjectVisible(STAR_A, ALL_ON, null, 1087, collectionRadiusPc)).toBe(true);
  });

  it("updateDenseBatchLod hides the dense-batch instance when the camera is far, without touching non-member instances", () => {
    const { buckets } = createCatalogObjectGroup([NEARBY_STAR, STAR_A]);
    const bucket = buckets.find((b) => b.objectType === "star") as CatalogBucket;
    const nearbyIndex = bucket.objects.findIndex((o) => o.id === "proxima");
    const otherIndex = bucket.objects.findIndex((o) => o.id === "star-a");

    updateDenseBatchLod(buckets, ALL_ON, null, 1087, collectionRadiusPc);

    expect(decomposeInstanceMatrix(bucket, nearbyIndex).scale.x).toBe(0);
    // STAR_A is not a dense-batch member - its own radius-derived scale
    // must be left exactly as `createCatalogObjectGroup` set it.
    expect(decomposeInstanceMatrix(bucket, otherIndex).scale.x).toBeCloseTo(
      bucket.radiiPc[otherIndex],
      6,
    );
  });

  it("updateDenseBatchLod shows the dense-batch instance again once the camera moves close enough in", () => {
    const { buckets } = createCatalogObjectGroup([NEARBY_STAR]);
    const bucket = buckets[0];

    updateDenseBatchLod(buckets, ALL_ON, null, 1087, collectionRadiusPc);
    expect(decomposeInstanceMatrix(bucket, 0).scale.x).toBe(0);

    updateDenseBatchLod(buckets, ALL_ON, null, 5, collectionRadiusPc);
    expect(decomposeInstanceMatrix(bucket, 0).scale.x).toBeCloseTo(bucket.radiiPc[0], 6);
  });

  it("updateDenseBatchLod still respects a category toggle turned off for the dense-batch member", () => {
    const { buckets } = createCatalogObjectGroup([NEARBY_STAR]);
    const bucket = buckets[0];
    const starOff = new Map<string, boolean>([["star", false]]);

    updateDenseBatchLod(buckets, starOff, null, 5, collectionRadiusPc);

    expect(decomposeInstanceMatrix(bucket, 0).scale.x).toBe(0);
  });

  it("visibleCatalogObjects excludes dense-batch members that fail the LOD check", () => {
    const { buckets } = createCatalogObjectGroup([NEARBY_STAR, STAR_A]);
    const visibleFar = visibleCatalogObjects(buckets, ALL_ON, null, 1087, collectionRadiusPc);
    expect(visibleFar.map((o) => o.id).sort()).toEqual(["star-a"]);

    const visibleClose = visibleCatalogObjects(buckets, ALL_ON, null, 5, collectionRadiusPc);
    expect(visibleClose.map((o) => o.id).sort()).toEqual(["proxima", "star-a"]);
  });

  it("isSelectedObjectVisible respects the LOD gate for a selected dense-batch member", () => {
    const objects = [NEARBY_STAR, STAR_A];
    expect(
      isSelectedObjectVisible(objects, "proxima", ALL_ON, null, 1087, collectionRadiusPc),
    ).toBe(false);
    expect(
      isSelectedObjectVisible(objects, "proxima", ALL_ON, null, 5, collectionRadiusPc),
    ).toBe(true);
  });
});
