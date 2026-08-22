import { describe, expect, it } from "vitest";
import { Matrix4, Quaternion, Vector3 } from "three";
import type { InstancedMesh, MeshBasicMaterial } from "three";
import {
  backgroundBucketOpacity,
  catalogObjectTypes,
  CLUSTER_OBJECT_TYPES,
  createCatalogObjectGroup,
  excludeDedicatedMarkerObjects,
  isCatalogObjectVisible,
  isSelectedObjectVisible,
  LOCAL_BUBBLE_OBJECT_ID,
  markerOpacityFor,
  markerRadiusPc,
  selectedMarkerRadiusPc,
  setInstanceVisibility,
  shouldDimBackground,
  STAR_MARKER_MIN_RADIUS_PC,
  STAR_MARKER_SHRINK_START_MULTIPLIER,
  starMarkerRadiusPc,
  STAR_OBJECT_TYPES,
  SUN_OBJECT_ID,
  updateBackgroundDimming,
  updateCatalogSizeScale,
  updateCatalogVisibility,
  updateDenseBatchLod,
  visibleCatalogObjects,
  type CatalogBucket,
} from "../src/scene/objects";
import { sunCoreRadiusPc } from "../src/scene/sun";
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
 * Issue #119: the star marker's camera-distance-dependent radius. Before
 * this issue, `STAR_MARKER_RADIUS_PC` (2pc) was fixed regardless of camera
 * distance - bigger than the real distance between the Sun and its nearest
 * neighbors (Proxima Centauri, 1.302pc; Alpha Centauri A/B, ~1.347pc,
 * ~0.068pc from Proxima itself - see `starMarkerRadiusPc`'s own docstring
 * for how these were computed from `scene.json`), so at solar-neighborhood
 * zoom those markers visually overlapped/engulfed the Sun and each other.
 * Mirrors `sun.test.ts`'s coverage style for `sunCoreRadiusPc` exactly:
 * boundary values at both clamped ends, the interpolated region in between,
 * and a real-world sanity check against the Sun's nearest neighbors.
 */
describe("starMarkerRadiusPc (issue #119)", () => {
  // Same realistic dense-batch collection radius `sun.test.ts` uses
  // (`lod.test.ts`'s DENSE_MEMBER_FAR), so these tests exercise the same
  // values `main.ts` would see at runtime.
  const REALISTIC_DENSE_BATCH_RADIUS_PC = 11.26;

  it("is the fixed overview radius at the default ~1087pc 'Perspective' camera distance", () => {
    expect(starMarkerRadiusPc(1087, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(markerRadiusPc(null, "star"));
  });

  it("is the fixed overview radius at the ~800pc overview radius-filter preset", () => {
    expect(starMarkerRadiusPc(800, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(markerRadiusPc(null, "star"));
  });

  it("is the fixed overview radius at any distance at or beyond the shrink-start threshold", () => {
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * STAR_MARKER_SHRINK_START_MULTIPLIER;
    expect(starMarkerRadiusPc(shrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(markerRadiusPc(null, "star"));
    expect(starMarkerRadiusPc(shrinkStartPc + 1000, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(
      markerRadiusPc(null, "star"),
    );
  });

  it("is the min (point-like) radius once the camera is at the dense batch's own collection radius", () => {
    expect(
      starMarkerRadiusPc(REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC),
    ).toBe(STAR_MARKER_MIN_RADIUS_PC);
  });

  it("is the min radius for any distance inside the dense batch's own collection radius", () => {
    expect(starMarkerRadiusPc(1.3, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(STAR_MARKER_MIN_RADIUS_PC);
    expect(starMarkerRadiusPc(0, REALISTIC_DENSE_BATCH_RADIUS_PC)).toBe(STAR_MARKER_MIN_RADIUS_PC);
  });

  it("interpolates continuously and monotonically between the shrink-start threshold and the collection radius", () => {
    const shrinkStartPc = REALISTIC_DENSE_BATCH_RADIUS_PC * STAR_MARKER_SHRINK_START_MULTIPLIER;
    const midpointPc = (shrinkStartPc + REALISTIC_DENSE_BATCH_RADIUS_PC) / 2;

    const atStart = starMarkerRadiusPc(shrinkStartPc, REALISTIC_DENSE_BATCH_RADIUS_PC);
    const atMidpoint = starMarkerRadiusPc(midpointPc, REALISTIC_DENSE_BATCH_RADIUS_PC);
    const atFloor = starMarkerRadiusPc(REALISTIC_DENSE_BATCH_RADIUS_PC, REALISTIC_DENSE_BATCH_RADIUS_PC);

    expect(atStart).toBe(markerRadiusPc(null, "star"));
    expect(atFloor).toBe(STAR_MARKER_MIN_RADIUS_PC);
    expect(atMidpoint).toBeLessThan(atStart);
    expect(atMidpoint).toBeGreaterThan(atFloor);
    expect(atMidpoint).toBeCloseTo((markerRadiusPc(null, "star") + STAR_MARKER_MIN_RADIUS_PC) / 2, 5);

    const samples = Array.from({ length: 11 }, (_, i) =>
      starMarkerRadiusPc(
        REALISTIC_DENSE_BATCH_RADIUS_PC + (i / 10) * (shrinkStartPc - REALISTIC_DENSE_BATCH_RADIUS_PC),
        REALISTIC_DENSE_BATCH_RADIUS_PC,
      ),
    );
    for (let i = 1; i < samples.length; i++) {
      expect(samples[i]).toBeGreaterThanOrEqual(samples[i - 1]);
    }
  });

  it("stays at the overview radius regardless of camera distance when denseBatchRadiusPc is 0 (not loaded yet)", () => {
    expect(starMarkerRadiusPc(0, 0)).toBe(markerRadiusPc(null, "star"));
    expect(starMarkerRadiusPc(1087, 0)).toBe(markerRadiusPc(null, "star"));
  });

  /**
   * The actual numerical verification issue #119 asks for: at the shrunk
   * (close-zoom) radius, two RECONS-batch stars separated by their real
   * distance must not overlap - `2 * radius < separation`. Positions read
   * from `web/public/data/scene.json` (2026-08-19):
   *   - Proxima Centauri: [0.90293..., -0.93698..., -0.04378...] pc
   *   - Alpha Centauri A: [0.96488..., -0.94047..., -0.01598...] pc
   *   - Alpha Centauri B: [0.96482..., -0.94054..., -0.01603...] pc
   *   - Sun (origin): [0, 0, 0] pc
   * giving Proxima-to-Sun = 1.302pc, Proxima-to-Alpha-Centauri-A/B =
   * ~0.068pc (both A and B, to 3 significant figures - the AB pair itself
   * is only ~0.0001pc apart, a real, genuinely-unresolvable-at-this-scale
   * binary that is expected to stay a single coincident point).
   */
  it("the shrunk radius leaves Proxima Centauri and Alpha Centauri A/B visually distinct (issue #119's own numerical check)", () => {
    const shrunkRadius = starMarkerRadiusPc(0, REALISTIC_DENSE_BATCH_RADIUS_PC);
    expect(shrunkRadius).toBe(STAR_MARKER_MIN_RADIUS_PC);

    const proximaToSunPc = 1.302;
    const proximaToAlphaCenPc = 0.068;

    // Two shrunk star markers, placed at their real separation, must not
    // touch/overlap: the sum of their radii must be strictly less than the
    // distance between them.
    expect(2 * shrunkRadius).toBeLessThan(proximaToAlphaCenPc);
    // The Sun's own shrunk core (0.15pc, issue #113's SUN_CORE_MIN_RADIUS_PC)
    // plus Proxima's shrunk marker must likewise stay well under the
    // 1.302pc Sun-Proxima gap.
    const sunCoreMinRadiusPc = 0.15;
    expect(sunCoreMinRadiusPc + shrunkRadius).toBeLessThan(proximaToSunPc);
  });
});

describe("STAR_OBJECT_TYPES / CLUSTER_OBJECT_TYPES (issue #130 exports)", () => {
  it("STAR_OBJECT_TYPES contains exactly 'star'", () => {
    expect(STAR_OBJECT_TYPES.has("star")).toBe(true);
    expect(STAR_OBJECT_TYPES.has("star_cluster")).toBe(false);
  });

  it("CLUSTER_OBJECT_TYPES contains exactly 'star_cluster' and 'stellar_association'", () => {
    expect(CLUSTER_OBJECT_TYPES.has("star_cluster")).toBe(true);
    expect(CLUSTER_OBJECT_TYPES.has("stellar_association")).toBe(true);
    expect(CLUSTER_OBJECT_TYPES.has("star")).toBe(false);
  });
});

/**
 * Issue #130: `selectedMarkerRadiusPc` is the extracted, pure version of
 * (former) `main.ts`-private `selectedObjectMarkerRadiusPc` (issue #123) -
 * the selection reticle's radius resolution. Must mirror
 * `setInstanceVisibility`'s own priority order exactly: Sun -> dense-batch
 * star -> generic `markerRadiusPc`. `main.ts`'s own camera/`denseBatchRadiusPc`
 * module state is replaced here by explicit parameters, so these branches
 * get real unit coverage without needing a real `THREE.PerspectiveCamera`.
 */
describe("selectedMarkerRadiusPc (issue #130 extraction of issue #123 logic)", () => {
  const collectionRadiusPc = 11.26;
  // Issue #136: a realistic minZoomDistancePc (~Proxima's 1.302pc + the
  // Sun core's SUN_CORE_MID_RADIUS_PC margin, matching camera.ts's
  // deriveMinZoomDistancePc derivation), passed through to sunCoreRadiusPc.
  const minZoomDistancePc = 1.452;

  const sunEntry = makeObject({
    id: "sun",
    name: "Sun",
    object_type: "reference_point",
    position_pc: [0, 0, 0],
    distance_pc: 0,
  });

  const denseBatchStar = makeObject({
    id: "proxima",
    object_type: "star",
    position_pc: [0.9, -0.9, -0.04],
    distance_pc: 1.3,
    group: { primary: null, secondary: [DENSE_BATCH_GROUP_TAG] },
  });

  const nonDenseBatchStar = makeObject({
    id: "far-star",
    object_type: "star",
    position_pc: [500, 0, 0],
    distance_pc: 500,
    // No DENSE_BATCH_GROUP_TAG - a real, non-dense-batch star.
  });

  const genericObject = makeObject({
    id: "cloud-generic",
    object_type: "molecular_cloud",
    position_pc: [10, 20, 30],
    distance_pc: 37.4,
    size_pc: 20,
  });

  it("branch (a) the Sun: matches sunCoreRadiusPc exactly, regardless of object_type", () => {
    const cameraDistancePc = 5;
    const expected = sunCoreRadiusPc(cameraDistancePc, collectionRadiusPc, minZoomDistancePc);
    expect(
      selectedMarkerRadiusPc(
        sunEntry,
        SUN_OBJECT_ID,
        cameraDistancePc,
        collectionRadiusPc,
        minZoomDistancePc,
      ),
    ).toBe(expected);
  });

  it("branch (a) the Sun: id match takes priority even far from origin (shrink not yet triggered)", () => {
    const cameraDistancePc = 1087;
    expect(
      selectedMarkerRadiusPc(
        sunEntry,
        SUN_OBJECT_ID,
        cameraDistancePc,
        collectionRadiusPc,
        minZoomDistancePc,
      ),
    ).toBe(sunCoreRadiusPc(cameraDistancePc, collectionRadiusPc, minZoomDistancePc));
  });

  it("branch (a) the Sun: issue #136 - still matches sunCoreRadiusPc's extended floor deep inside the sphere", () => {
    const cameraDistancePc = 2; // Between minZoomDistancePc and collectionRadiusPc.
    expect(
      selectedMarkerRadiusPc(
        sunEntry,
        SUN_OBJECT_ID,
        cameraDistancePc,
        collectionRadiusPc,
        minZoomDistancePc,
      ),
    ).toBe(sunCoreRadiusPc(cameraDistancePc, collectionRadiusPc, minZoomDistancePc));
  });

  it("branch (b) a dense-batch star: matches starMarkerRadiusPc exactly when the camera is close in", () => {
    const cameraDistancePc = 0;
    const expected = starMarkerRadiusPc(cameraDistancePc, collectionRadiusPc);
    expect(expected).toBe(STAR_MARKER_MIN_RADIUS_PC);
    expect(
      selectedMarkerRadiusPc(
        denseBatchStar,
        SUN_OBJECT_ID,
        cameraDistancePc,
        collectionRadiusPc,
        minZoomDistancePc,
      ),
    ).toBe(expected);
  });

  it("branch (b) a dense-batch star: still tracks starMarkerRadiusPc at the un-shrunk overview distance", () => {
    const cameraDistancePc = 1087;
    expect(
      selectedMarkerRadiusPc(
        denseBatchStar,
        SUN_OBJECT_ID,
        cameraDistancePc,
        collectionRadiusPc,
        minZoomDistancePc,
      ),
    ).toBe(starMarkerRadiusPc(cameraDistancePc, collectionRadiusPc));
  });

  it("branch (c) generic: a star NOT tagged as a dense-batch member falls through to markerRadiusPc, not the dense-batch branch", () => {
    const cameraDistancePc = 0; // Would trigger the shrink floor if this were mis-routed to branch (b).
    const result = selectedMarkerRadiusPc(
      nonDenseBatchStar,
      SUN_OBJECT_ID,
      cameraDistancePc,
      collectionRadiusPc,
      minZoomDistancePc,
    );
    expect(result).toBe(markerRadiusPc(nonDenseBatchStar.size_pc, nonDenseBatchStar.object_type));
    expect(result).not.toBe(STAR_MARKER_MIN_RADIUS_PC);
  });

  it("branch (c) generic: a non-star, non-Sun object always uses markerRadiusPc, regardless of camera distance", () => {
    const expected = markerRadiusPc(genericObject.size_pc, genericObject.object_type);
    expect(
      selectedMarkerRadiusPc(genericObject, SUN_OBJECT_ID, 0, collectionRadiusPc, minZoomDistancePc),
    ).toBe(expected);
    expect(
      selectedMarkerRadiusPc(genericObject, SUN_OBJECT_ID, 1087, collectionRadiusPc, minZoomDistancePc),
    ).toBe(expected);
  });

  it("priority order: id === sunObjectId wins even if object_type were somehow star-like", () => {
    const sunLikeStar = makeObject({
      id: SUN_OBJECT_ID,
      object_type: "star",
      position_pc: [0, 0, 0],
      distance_pc: 0,
      group: { primary: null, secondary: [DENSE_BATCH_GROUP_TAG] },
    });
    const cameraDistancePc = 5;
    expect(
      selectedMarkerRadiusPc(
        sunLikeStar,
        SUN_OBJECT_ID,
        cameraDistancePc,
        collectionRadiusPc,
        minZoomDistancePc,
      ),
    ).toBe(sunCoreRadiusPc(cameraDistancePc, collectionRadiusPc, minZoomDistancePc));
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

/**
 * Issue #137: dims the "background" (non-star catalog buckets) once the
 * camera is inside the RECONS dense batch's collection sphere, so the
 * spotlighted nearby stars read as the visual focus. Covers the pure
 * decision logic (`shouldDimBackground`/`backgroundBucketOpacity`) plus a
 * real-`InstancedMesh` integration check that the star bucket's material is
 * genuinely untouched while other buckets' materials do change.
 */
describe("shouldDimBackground (issue #137)", () => {
  it("is false for the star bucket - never dimmed, this is what's being spotlighted", () => {
    expect(shouldDimBackground("star")).toBe(false);
  });

  it("is true for cluster/association types", () => {
    for (const type of CLUSTER_OBJECT_TYPES) {
      expect(shouldDimBackground(type)).toBe(true);
    }
  });

  it("is true for extended-structure types and any unrecognized/future type", () => {
    for (const type of [
      "molecular_cloud",
      "hii_region",
      "supernova_remnant",
      "bubble",
      "star_forming_region",
      "reference_point",
      "some_future_object_type",
    ]) {
      expect(shouldDimBackground(type)).toBe(true);
    }
  });
});

describe("backgroundBucketOpacity (issue #137)", () => {
  it("returns the normal, undimmed opacity when the camera is outside the sphere", () => {
    expect(backgroundBucketOpacity("star_cluster", false)).toBe(markerOpacityFor("star_cluster"));
    expect(backgroundBucketOpacity("molecular_cloud", false)).toBe(
      markerOpacityFor("molecular_cloud"),
    );
  });

  it("never dims the star bucket, even when the camera is inside the sphere", () => {
    expect(backgroundBucketOpacity("star", true)).toBe(markerOpacityFor("star"));
  });

  it("dims a cluster/association bucket's opacity when the camera is inside the sphere", () => {
    const dimmed = backgroundBucketOpacity("star_cluster", true);
    expect(dimmed).toBeLessThan(markerOpacityFor("star_cluster"));
    expect(dimmed).toBeGreaterThan(0);
  });

  it("dims an extended-structure bucket's opacity when the camera is inside the sphere", () => {
    const dimmed = backgroundBucketOpacity("molecular_cloud", true);
    expect(dimmed).toBeLessThan(markerOpacityFor("molecular_cloud"));
    expect(dimmed).toBeGreaterThan(0);
  });

  it("dims proportionally: the discrete (cluster) tier stays more visible than the diffuse (structure) tier while both are dimmed", () => {
    const dimmedCluster = backgroundBucketOpacity("star_cluster", true);
    const dimmedStructure = backgroundBucketOpacity("molecular_cloud", true);
    expect(dimmedCluster).toBeGreaterThan(dimmedStructure);
  });

  it("dims to roughly 15% of normal opacity (issue #156: strengthened from #137's original 40%)", () => {
    const clusterRatio =
      backgroundBucketOpacity("star_cluster", true) / markerOpacityFor("star_cluster");
    const structureRatio =
      backgroundBucketOpacity("molecular_cloud", true) / markerOpacityFor("molecular_cloud");
    expect(clusterRatio).toBeCloseTo(0.15, 5);
    expect(structureRatio).toBeCloseTo(0.15, 5);
    // Well below #137's original 0.4 factor - the whole point of #156.
    expect(clusterRatio).toBeLessThan(0.2);
    expect(structureRatio).toBeLessThan(0.2);
  });

  it("restoring (camera outside again) returns exactly the original opacity, no drift", () => {
    const original = markerOpacityFor("star_cluster");
    // Simulate several dim/restore cycles.
    backgroundBucketOpacity("star_cluster", true);
    backgroundBucketOpacity("star_cluster", false);
    backgroundBucketOpacity("star_cluster", true);
    expect(backgroundBucketOpacity("star_cluster", false)).toBe(original);
  });
});

describe("updateBackgroundDimming (issue #137 integration)", () => {
  it("dims non-star bucket materials but leaves the star bucket's material completely untouched", () => {
    const cluster = makeObject({ id: "cluster-a", object_type: "star_cluster" });
    const { buckets } = createCatalogObjectGroup([CLOUD_A, cluster, STAR_A]);

    const structureBucket = buckets.find((b) => b.objectType === "molecular_cloud") as CatalogBucket;
    const clusterBucket = buckets.find((b) => b.objectType === "star_cluster") as CatalogBucket;
    const starBucket = buckets.find((b) => b.objectType === "star") as CatalogBucket;

    const starMaterialBefore = starBucket.mesh.material;
    const starOpacityBefore = (starMaterialBefore as MeshBasicMaterial).opacity;

    updateBackgroundDimming(buckets, true);

    // The star bucket's material reference AND opacity must be exactly
    // unchanged - this is the issue's hard constraint that the spotlighted
    // nearby stars are never altered by this change.
    expect(starBucket.mesh.material).toBe(starMaterialBefore);
    expect((starBucket.mesh.material as MeshBasicMaterial).opacity).toBe(starOpacityBefore);

    expect((structureBucket.mesh.material as MeshBasicMaterial).opacity).toBeLessThan(
      markerOpacityFor("molecular_cloud"),
    );
    expect((clusterBucket.mesh.material as MeshBasicMaterial).opacity).toBeLessThan(
      markerOpacityFor("star_cluster"),
    );
  });

  it("restores every non-star bucket's original opacity once the camera exits the sphere", () => {
    const cluster = makeObject({ id: "cluster-a", object_type: "star_cluster" });
    const { buckets } = createCatalogObjectGroup([CLOUD_A, cluster, STAR_A]);

    const structureBucket = buckets.find((b) => b.objectType === "molecular_cloud") as CatalogBucket;
    const clusterBucket = buckets.find((b) => b.objectType === "star_cluster") as CatalogBucket;

    updateBackgroundDimming(buckets, true);
    updateBackgroundDimming(buckets, false);

    expect((structureBucket.mesh.material as MeshBasicMaterial).opacity).toBe(
      markerOpacityFor("molecular_cloud"),
    );
    expect((clusterBucket.mesh.material as MeshBasicMaterial).opacity).toBe(
      markerOpacityFor("star_cluster"),
    );
  });

  it("is a safe no-op on an empty bucket list (scene not loaded yet)", () => {
    expect(() => updateBackgroundDimming([], true)).not.toThrow();
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

  /**
   * Issue #119: `setInstanceVisibility`'s two new optional parameters
   * (`cameraDistanceFromOriginPc`/`denseBatchRadiusPc`) are the mechanism
   * `updateCatalogVisibility`/`updateDenseBatchLod` both funnel through to
   * apply the LOD-dependent star radius - these tests exercise it directly,
   * independent of either caller.
   */
  describe("issue #119 dense-batch star radius override", () => {
    const collectionRadiusPc = 11.26;
    const nearbyStar = makeObject({
      id: "proxima",
      object_type: "star",
      position_pc: [0.9, -0.9, -0.04],
      distance_pc: 1.3,
      group: { primary: null, secondary: [DENSE_BATCH_GROUP_TAG] },
    });

    it("defaults to the static baked-in radius when the LOD params are omitted (backward compatible)", () => {
      const { buckets } = createCatalogObjectGroup([nearbyStar]);
      const bucket = buckets[0];

      setInstanceVisibility(bucket, 0, true);

      expect(decomposeInstanceMatrix(bucket, 0).scale.x).toBeCloseTo(bucket.radiiPc[0], 6);
    });

    it("uses the LOD-shrunk radius for a dense-batch star instance once the camera is close in", () => {
      const { buckets } = createCatalogObjectGroup([nearbyStar]);
      const bucket = buckets[0];

      setInstanceVisibility(bucket, 0, true, 0, collectionRadiusPc);

      expect(decomposeInstanceMatrix(bucket, 0).scale.x).toBeCloseTo(STAR_MARKER_MIN_RADIUS_PC, 6);
    });

    it("never applies the shrink to a hidden instance (stays exactly zero-scale)", () => {
      const { buckets } = createCatalogObjectGroup([nearbyStar]);
      const bucket = buckets[0];

      setInstanceVisibility(bucket, 0, false, 0, collectionRadiusPc);

      expect(decomposeInstanceMatrix(bucket, 0).scale.x).toBe(0);
    });

    it("does not apply the star-radius shrink to a non-star dense-batch-tagged instance", () => {
      const denseBatchCloud = makeObject({
        id: "dense-cloud",
        object_type: "molecular_cloud",
        position_pc: [1, 1, 1],
        distance_pc: 1.7,
        group: { primary: null, secondary: [DENSE_BATCH_GROUP_TAG] },
      });
      const { buckets } = createCatalogObjectGroup([denseBatchCloud]);
      const bucket = buckets[0];

      setInstanceVisibility(bucket, 0, true, 0, collectionRadiusPc);

      // Not a `star`-type object, so the type-aware clamp still applies -
      // this instance keeps its static structure-tier radius even though it
      // carries the dense-batch tag (not the case in today's real data, see
      // `starMarkerRadiusPc`'s docstring, but must not silently mis-shrink
      // a hypothetical future non-star dense-batch member).
      expect(decomposeInstanceMatrix(bucket, 0).scale.x).toBeCloseTo(bucket.radiiPc[0], 6);
    });
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

  // Issue #119: the full-recompute `updateCatalogVisibility` path (called on
  // every category/radius-filter change) must apply the same LOD-dependent
  // star radius `updateDenseBatchLod`'s own per-frame path does, so a filter
  // change doesn't visibly "pop" a close-zoomed dense-batch star back to its
  // full overview radius for a frame before the next `applyDenseBatchLod()`
  // call corrects it.
  it("updateCatalogVisibility also applies the LOD-shrunk radius to a visible dense-batch star", () => {
    const nearbyStar = makeObject({
      id: "proxima",
      object_type: "star",
      position_pc: [0.9, -0.9, -0.04],
      distance_pc: 1.3,
      group: { primary: null, secondary: [DENSE_BATCH_GROUP_TAG] },
    });
    const starsOn = new Map<string, boolean>([["star", true]]);
    const collectionRadiusPc = 11.26;
    const { buckets } = createCatalogObjectGroup([nearbyStar]);
    const bucket = buckets[0];

    updateCatalogVisibility(buckets, starsOn, null, 0, collectionRadiusPc);

    expect(decomposeInstanceMatrix(bucket, 0).scale.x).toBeCloseTo(STAR_MARKER_MIN_RADIUS_PC, 6);
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

  it("updateDenseBatchLod shows the dense-batch instance again once the camera moves close enough in, at its LOD-shrunk radius", () => {
    const { buckets } = createCatalogObjectGroup([NEARBY_STAR]);
    const bucket = buckets[0];

    updateDenseBatchLod(buckets, ALL_ON, null, 1087, collectionRadiusPc);
    expect(decomposeInstanceMatrix(bucket, 0).scale.x).toBe(0);

    // Issue #119: once shown again, a dense-batch *star* no longer jumps
    // back to its static baked-in radius (`bucket.radiiPc[0]`, the fixed
    // overview 2pc) - it uses `starMarkerRadiusPc`'s camera-distance-
    // dependent value instead, which at this close a distance (well inside
    // the collection radius) is the shrunk `STAR_MARKER_MIN_RADIUS_PC`
    // floor, strictly smaller than the static radius.
    updateDenseBatchLod(buckets, ALL_ON, null, 5, collectionRadiusPc);
    const shownScale = decomposeInstanceMatrix(bucket, 0).scale.x;
    expect(shownScale).toBeCloseTo(starMarkerRadiusPc(5, collectionRadiusPc), 6);
    expect(shownScale).toBeLessThan(bucket.radiiPc[0]);
  });

  it("updateDenseBatchLod never touches a non-dense-batch star's radius, even at a close camera distance where the shrink would otherwise apply", () => {
    const { buckets } = createCatalogObjectGroup([NEARBY_STAR, STAR_A]);
    const bucket = buckets.find((b) => b.objectType === "star") as CatalogBucket;
    const otherIndex = bucket.objects.findIndex((o) => o.id === "star-a");

    // Camera close enough in that the dense-batch member (proxima) would
    // shrink to its LOD floor - STAR_A is not a dense-batch member, so its
    // radius must stay exactly as `createCatalogObjectGroup` baked it,
    // regardless of camera distance (this function only ever touches
    // dense-batch instances at all - see the `isDenseBatchMember` guard).
    updateDenseBatchLod(buckets, ALL_ON, null, 5, collectionRadiusPc);
    expect(decomposeInstanceMatrix(bucket, otherIndex).scale.x).toBeCloseTo(
      bucket.radiiPc[otherIndex],
      6,
    );
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
