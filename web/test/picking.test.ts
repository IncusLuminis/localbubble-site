import { describe, expect, it } from "vitest";
import { Camera, PerspectiveCamera, Raycaster, Vector2 } from "three";
import { createCatalogObjectGroup, setInstanceVisibility } from "../src/scene/objects";
import { createDiffuseStructureLayer, updateDiffuseStructureVisibility } from "../src/scene/diffuseStructures";
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
    const camera = makeLookDownZCamera(300);
    const raycaster = new Raycaster();

    const hit = pickSceneObject(raycaster, camera, CENTER_NDC, buckets, layer.meshes);
    expect(hit?.id).toBe("star-near");
  });

  it("returns null when a diffuse-structure mesh is hidden (category toggled off)", () => {
    const cloud = makeObject({ id: "cloud-hidden", object_type: "molecular_cloud", position_pc: [0, 0, 0], size_pc: 20 });
    const layer = createDiffuseStructureLayer([cloud]);
    updateDiffuseStructureVisibility(layer, new Map([["molecular_cloud", false]]), null);

    const camera = makeLookDownZCamera(100);
    const raycaster = new Raycaster();
    expect(pickSceneObject(raycaster, camera, CENTER_NDC, [], layer.meshes)).toBeNull();
  });

  it("is pickable again once its category is toggled back on", () => {
    const cloud = makeObject({ id: "cloud-toggle", object_type: "molecular_cloud", position_pc: [0, 0, 0], size_pc: 20 });
    const layer = createDiffuseStructureLayer([cloud]);
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
