import { describe, expect, it } from "vitest";
import { Camera, PerspectiveCamera, Raycaster, Vector2 } from "three";
import { createCatalogObjectGroup, setInstanceVisibility } from "../src/scene/objects";
import {
  createDiffuseStructureLayer,
  updateDiffuseStructureVisibility,
  type DiffuseStructureLayer,
} from "../src/scene/diffuseStructures";
import { pickSceneObject, toNdc } from "../src/scene/picking";
import type { SceneObject } from "../src/scene/sceneTypes";

/**
 * Issue #89: `Raycaster.intersectObject` against an `InstancedMesh`
 * returns `.instanceId` rather than the plain-`Mesh`-era
 * `userData.sceneObject`. These tests verify `pickSceneObject` correctly
 * resolves an instanced hit back to the real `SceneObject` via each
 * bucket's index mapping - the part of the conversion most likely to
 * silently break the inspector panel (#65).
 */

function makeObject(overrides: Partial<SceneObject>): SceneObject {
  return {
    id: "test-object",
    name: "Test Object",
    aliases: [],
    object_type: "star",
    position_pc: [0, 0, 0],
    distance_pc: 0,
    distance_error_pc: null,
    size_pc: null,
    color_class: null,
    spectral_type: null,
    absolute_magnitude: null,
    apparent_magnitude: null,
    exoplanets: null,
    velocity: null,
    group: { primary: null, secondary: [] },
    source: { reference: "test fixture", url: null, catalog: null },
    notes: null,
    ...overrides,
  };
}

/** A camera looking down -Z from some distance, straight at the origin -
 * clicking dead-center (NDC 0,0) rays straight down -Z through any object
 * placed at (0, 0, someZ < camera z). */
function makeLookDownZCamera(z = 100): Camera {
  const camera = new PerspectiveCamera(50, 1, 0.1, 10000);
  camera.position.set(0, 0, z);
  camera.lookAt(0, 0, 0);
  camera.updateMatrixWorld();
  return camera;
}

const CENTER_NDC = new Vector2(0, 0);

/** `Raycaster` reads each target's cached `matrixWorld` directly (see
 * `three`'s own `Mesh.raycast`), rather than recomputing it from
 * `position`/`scale` on the fly. In the real running app this is kept fresh
 * every frame by `WebGLRenderer.render()`'s own `scene.updateMatrixWorld()`
 * call, well before the user can ever click anything - but a mesh built
 * directly in a test and never added to an actually-rendered scene keeps
 * its default IDENTITY `matrixWorld` unless something explicitly
 * recomputes it, which silently collapses every such mesh to "a unit
 * sphere at the world origin" regardless of its real `position`/`scale`.
 *
 * Story #320's whole point is a TRUE-3D-DEPTH bug (an object's raycast hit
 * distance vs. another object's, at their real positions) - a test that
 * skips this would only coincidentally get the right answer (or the wrong
 * one) depending on how the identity-matrix collapse happens to compare,
 * not because the fix under test actually ran. Call this right after
 * building a `DiffuseStructureLayer` and before raycasting against it,
 * mirroring what the renderer already guarantees in production. */
function syncMatrixWorld(layer: DiffuseStructureLayer): void {
  layer.group.updateMatrixWorld(true);
}

describe("pickSceneObject", () => {
  it("resolves a hit on one bucket's instance back to the correct real SceneObject", () => {
    const star = makeObject({ id: "star-hit", object_type: "star", position_pc: [0, 0, 0], size_pc: null });
    const otherStar = makeObject({ id: "star-other", object_type: "star", position_pc: [500, 500, 0] });
    const cloud = makeObject({ id: "cloud-a", object_type: "molecular_cloud", position_pc: [1000, 0, 0] });

    const { buckets } = createCatalogObjectGroup([star, otherStar, cloud]);
    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();

    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, buckets);
    expect(hit?.id).toBe("star-hit");
  });

  it("picks the correct object among several in the same object_type bucket", () => {
    const starNear = makeObject({ id: "star-near", object_type: "star", position_pc: [0, 0, 0] });
    const starFar = makeObject({ id: "star-far", object_type: "star", position_pc: [300, 300, 0] });
    const starHit = makeObject({ id: "star-hit-2", object_type: "star", position_pc: [0, 0, -50] });

    const { buckets } = createCatalogObjectGroup([starNear, starHit, starFar]);
    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();

    // Both starNear and starHit lie on the ray from the camera through the
    // origin; the nearer one to the camera (starNear, at z=0) should win.
    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, buckets);
    expect(hit?.id).toBe("star-near");
  });

  it("returns null when the ray hits nothing", () => {
    const star = makeObject({ id: "star-off-axis", object_type: "star", position_pc: [1000, 1000, 0] });
    const { buckets } = createCatalogObjectGroup([star]);
    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();

    expect(pickSceneObject(raycaster, camera, CENTER_NDC, buckets)).toBeNull();
  });

  it("cannot pick an instance hidden via the zero-scale visibility mechanism", () => {
    const star = makeObject({ id: "star-hidden", object_type: "star", position_pc: [0, 0, 0] });
    const { buckets } = createCatalogObjectGroup([star]);
    const bucket = buckets[0];

    setInstanceVisibility(bucket, 0, false);

    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();
    expect(pickSceneObject(raycaster, camera, CENTER_NDC, buckets)).toBeNull();
  });

  it("resumes being pickable once shown again after being hidden", () => {
    const star = makeObject({ id: "star-toggle", object_type: "star", position_pc: [0, 0, 0] });
    const { buckets } = createCatalogObjectGroup([star]);
    const bucket = buckets[0];

    setInstanceVisibility(bucket, 0, false);
    setInstanceVisibility(bucket, 0, true);

    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();
    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, buckets);
    expect(hit?.id).toBe("star-toggle");
  });

  it("resolves correctly across multiple distinct object_type buckets", () => {
    const molecularCloud = makeObject({
      id: "cloud-hit",
      object_type: "molecular_cloud",
      position_pc: [0, 0, 0],
      size_pc: 40,
    });
    const star = makeObject({ id: "star-elsewhere", object_type: "star", position_pc: [500, 0, 0] });

    const { buckets } = createCatalogObjectGroup([molecularCloud, star]);
    expect(buckets.length).toBeGreaterThanOrEqual(2);

    const camera = makeLookDownZCamera(200);
    const raycaster = new Raycaster();
    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, buckets);
    expect(hit?.id).toBe("cloud-hit");
  });

  it("toNdc maps a click at the element's center to (0, 0)", () => {
    const rect = { left: 100, top: 50, width: 800, height: 600 } as DOMRect;
    const ndc = toNdc(100 + 400, 50 + 300, rect);
    expect(ndc.x).toBeCloseTo(0, 6);
    expect(ndc.y).toBeCloseTo(0, 6);
  });
});

/**
 * Story #315: the four diffuse-structure types moved out of `CatalogBucket`
 * `InstancedMesh` buckets into `scene/diffuseStructures.ts`'s individual
 * `Mesh`es - without a second raycast target list, clicking one of those
 * ~19 objects would silently stop opening the Inspector. These tests cover
 * `pickSceneObject`'s new `diffuseMeshes` parameter directly.
 */
describe("pickSceneObject with diffuse-structure meshes (Story #315)", () => {
  it("resolves a hit on a diffuse-structure mesh back to its real SceneObject", () => {
    const m42 = makeObject({
      id: "m42_orion",
      object_type: "hii_region",
      position_pc: [0, 0, 0],
      size_pc: 8,
    });
    const layer = createDiffuseStructureLayer([m42]);
    syncMatrixWorld(layer);
    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();

    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, [], layer.meshes);
    expect(hit?.id).toBe("m42_orion");
  });

  it("picks the nearer of a bucket star and a diffuse-structure mesh both on the ray", () => {
    const star = makeObject({ id: "star-near", object_type: "star", position_pc: [0, 0, 0] });
    const cloud = makeObject({
      id: "cloud-far",
      object_type: "molecular_cloud",
      position_pc: [0, 0, -200],
      size_pc: 40,
    });
    const { buckets } = createCatalogObjectGroup([star]);
    const layer = createDiffuseStructureLayer([cloud]);
    syncMatrixWorld(layer);
    const camera = makeLookDownZCamera(300);
    const raycaster = new Raycaster();

    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, buckets, layer.meshes);
    expect(hit?.id).toBe("star-near");
  });

  it("returns null when a diffuse-structure mesh is hidden (category toggled off)", () => {
    const cloud = makeObject({ id: "cloud-hidden", object_type: "molecular_cloud", position_pc: [0, 0, 0], size_pc: 20 });
    const layer = createDiffuseStructureLayer([cloud]);
    syncMatrixWorld(layer);
    updateDiffuseStructureVisibility(layer, new Map([["molecular_cloud", false]]), null);

    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();
    expect(pickSceneObject(raycaster, camera, CENTER_NDC, [], layer.meshes)).toBeNull();
  });

  it("is pickable again once its category is toggled back on", () => {
    const cloud = makeObject({ id: "cloud-toggle", object_type: "molecular_cloud", position_pc: [0, 0, 0], size_pc: 20 });
    const layer = createDiffuseStructureLayer([cloud]);
    syncMatrixWorld(layer);
    const off = new Map([["molecular_cloud", false]]);
    const on = new Map([["molecular_cloud", true]]);
    updateDiffuseStructureVisibility(layer, off, null);
    updateDiffuseStructureVisibility(layer, on, null);

    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();
    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, [], layer.meshes);
    expect(hit?.id).toBe("cloud-toggle");
  });

  it("defaults diffuseMeshes to an empty list - pre-#315 callers passing only buckets are unaffected", () => {
    const star = makeObject({ id: "star-only", object_type: "star", position_pc: [0, 0, 0] });
    const { buckets } = createCatalogObjectGroup([star]);
    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();
    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, buckets);
    expect(hit?.id).toBe("star-only");
  });
});

/**
 * Story #320: the single most important correctness property of this
 * Story. The human owner found and reported a real bug during live
 * testing: sizing a diffuse-structure's invisible picking proxy to its full
 * VISUAL radius (e.g. Vela Supernova Remnant's real ~80pc extent) creates a
 * raycast hit-target large enough to win the "nearest intersection along
 * the ray" contest against a small nearby object's own proxy, even though
 * that small object is what the user is actually clicking on. Confirmed
 * live: clicking a small cluster's own visible marker, sitting inside/near
 * Vela SNR's big misty patch, opened the Inspector for Vela SNR instead of
 * the cluster.
 *
 * The fix (`diffuseStructures.ts`'s `PICK_PROXY_RADIUS_CAP_PC`) caps every
 * shaped type's invisible proxy at a small fixed radius (8pc), completely
 * decoupled from the shape's own visual radius. These tests build a
 * geometric repro of the exact reported scenario directly against
 * `pickSceneObject` (the same function `main.ts`'s click handler calls) and
 * assert the small, nearby object wins - mirroring how the tests just above
 * already cover bucket-vs-diffuse-structure nearest-hit precedence for
 * Story #315.
 */
describe("pickSceneObject: picking-proxy radius cap (Story #320 bug fix)", () => {
  /** A big supernova remnant whose UNCAPPED visual radius would extend far
   * enough toward the camera to physically enclose the small cluster's own
   * click point below - the exact shape of the human owner's reported bug.
   * `size_pc` is a DIAMETER for `supernova_remnant` (Story #314's mixed
   * convention, see `diffuseStructures.ts`'s `diffuseStructureRadiusPc`),
   * so `size_pc: 120` -> a 60pc real radius. */
  const velaSnr = makeObject({
    id: "vela-snr",
    name: "Vela Supernova Remnant",
    object_type: "supernova_remnant",
    position_pc: [0, 0, -40],
    size_pc: 120,
  });

  /** A small cluster sitting closer to the camera than Vela's own center,
   * directly on the click ray - exactly the "small object rendering on top
   * of the big structure's haze" scenario. Real radius 5pc (well under the
   * 8pc pick-proxy cap, so its own proxy is never itself clamped here). */
  const smallCluster = makeObject({
    id: "small-cluster",
    name: "Small Nearby Cluster",
    object_type: "star_cluster",
    position_pc: [0, 0, 0],
    size_pc: 5,
  });

  it("without the cap, Vela's own uncapped visual radius WOULD reach past the cluster's surface (sanity check the repro geometry is real)", () => {
    // Camera at z=100 looking down -Z. Vela's real (uncapped) radius is 60pc
    // centered at z=-40, so its near surface sits at z = -40 + 60 = 20 -
    // camera distance 80. The cluster's own surface (radius 5, centered at
    // z=0) sits at z=5 - camera distance 95. 80 < 95: an uncapped proxy's
    // near surface would be hit FIRST, closer to the camera than the small
    // cluster's own surface, along this exact ray - confirming this
    // geometry genuinely reproduces the reported bug shape rather than
    // testing something the cap was never needed for.
    const cameraZ = 100;
    const uncappedVelaNearSurfaceDistance = cameraZ - (velaSnr.position_pc[2] + 60);
    const clusterOwnSurfaceDistance = cameraZ - (smallCluster.position_pc[2] + 5);
    expect(uncappedVelaNearSurfaceDistance).toBeLessThan(clusterOwnSurfaceDistance);
  });

  it("clicking the small cluster's own marker selects IT, not the large structure sitting behind/around it", () => {
    const layer = createDiffuseStructureLayer([velaSnr, smallCluster]);
    syncMatrixWorld(layer);
    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();

    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, [], layer.meshes);
    expect(hit?.id).toBe("small-cluster");
  });

  it("every shaped type's proxy is capped, not just star_cluster's - a big molecular_cloud/hii_region/association can't shadow a small cluster either", () => {
    const bigTypes: Array<{ id: string; object_type: string; size_pc: number }> = [
      { id: "big-cloud", object_type: "molecular_cloud", size_pc: 160 }, // 80pc radius (DIAMETER convention)
      { id: "big-hii", object_type: "hii_region", size_pc: 160 },
      { id: "big-association", object_type: "stellar_association", size_pc: 80 }, // RADIUS convention
    ];
    for (const big of bigTypes) {
      const bigObject = makeObject({ ...big, position_pc: [0, 0, -40] });
      const layer = createDiffuseStructureLayer([bigObject, smallCluster]);
      syncMatrixWorld(layer);
      const camera = makeLookDownZCamera(100);
      const raycaster = new Raycaster();
      const hit = pickSceneObject(raycaster, camera, CENTER_NDC, [], layer.meshes);
      expect(hit?.id).toBe("small-cluster");
    }
  });

  it("regression guard: the proxy mesh registered for Vela is scaled to the 8pc cap, not its real ~60pc visual radius", () => {
    const layer = createDiffuseStructureLayer([velaSnr]);
    const proxy = layer.meshes[0].mesh;
    expect(proxy.scale.x).toBe(8);
    expect(proxy.scale.x).toBeLessThan(60);
  });

  it("without any large structure present, the small cluster is still picked normally (no false negative introduced by the cap)", () => {
    const layer = createDiffuseStructureLayer([smallCluster]);
    syncMatrixWorld(layer);
    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();
    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, [], layer.meshes);
    expect(hit?.id).toBe("small-cluster");
  });

  it("clicking a point on the large structure that is NOT near the small object still correctly selects the large structure", () => {
    // Off to the side (x=30), far from the small cluster at the origin -
    // the large structure's own (capped) proxy still needs to be hittable
    // for a click genuinely aimed at it, just not one aimed at a smaller
    // object nested near/inside its visual haze.
    const offCenterCamera = new PerspectiveCamera(50, 1, 0.1, 10000);
    offCenterCamera.position.set(30, 0, 100);
    offCenterCamera.lookAt(30, 0, -40); // straight down -Z through Vela's own center at x=30
    offCenterCamera.updateMatrixWorld();
    const velaAtX30 = makeObject({
      id: "vela-snr-x30",
      object_type: "supernova_remnant",
      position_pc: [30, 0, -40],
      size_pc: 120,
    });
    const layer = createDiffuseStructureLayer([velaAtX30, smallCluster]);
    syncMatrixWorld(layer);
    const raycaster = new Raycaster();
    const hit = pickSceneObject(raycaster, offCenterCamera, CENTER_NDC, [], layer.meshes);
    expect(hit?.id).toBe("vela-snr-x30");
  });
});
