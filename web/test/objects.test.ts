import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { InstancedMesh } from "three";
import {
  catalogObjectTypes,
  createCatalogObjectGroup,
  excludeDedicatedMarkerObjects,
  isCatalogObjectVisible,
  isSelectedObjectVisible,
  markerRadiusPc,
  setInstanceVisibility,
  SUN_OBJECT_ID,
  updateCatalogSizeScale,
  updateCatalogVisibility,
  visibleCatalogObjects,
  type CatalogBucket,
} from "../src/scene/objects";
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

  it("encodes each instance's transform as its real position with a radius-derived scale", () => {
    const { buckets } = createCatalogObjectGroup([CLOUD_A, CLOUD_B]);
    const bucket = buckets[0];

    bucket.objects.forEach((obj, i) => {
      const { position, scale } = decomposeInstanceMatrix(bucket, i);
      expect(position.toArray()).toEqual(obj.position_pc);
      const expectedRadius = markerRadiusPc(obj.size_pc);
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
