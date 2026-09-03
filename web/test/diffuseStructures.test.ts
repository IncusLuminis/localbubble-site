import { describe, expect, it } from "vitest";
import { Mesh, MeshBasicMaterial } from "three";
import {
  createDiffuseStructureLayer,
  diffuseStructureRadiusPc,
  DIFFUSE_STRUCTURE_OBJECT_TYPES,
  updateDiffuseStructureDimming,
  updateDiffuseStructureVisibility,
  visibleDiffuseStructureObjects,
} from "../src/scene/diffuseStructures";
import {
  backgroundBucketOpacity,
  markerOpacityFor,
  OBJECT_TYPE_COLORS,
  STRUCTURE_MIN_RADIUS_PC,
} from "../src/scene/objects";
import type { SceneObject } from "../src/scene/sceneTypes";

/**
 * Story #315: extended-volume rendering for the four diffuse catalog
 * object types (molecular_cloud/hii_region/planetary_nebula/
 * supernova_remnant). Coverage focus:
 *  - the size_pc DIAMETER -> mesh-radius RADIUS conversion (the Story's own
 *    explicit "getting this backwards renders everything 2x too big"
 *    warning, verified numerically against Orion Nebula M42's real value);
 *  - the fallback for a still-missing size_pc (M8/Lagoon Nebula today);
 *  - the generic factory only ever picks up the four in-scope types;
 *  - visibility/dimming reuse `objects.ts`'s existing predicates exactly.
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

describe("DIFFUSE_STRUCTURE_OBJECT_TYPES", () => {
  it("contains exactly the four Story #315 in-scope types", () => {
    expect(Array.from(DIFFUSE_STRUCTURE_OBJECT_TYPES).sort()).toEqual([
      "hii_region",
      "molecular_cloud",
      "planetary_nebula",
      "supernova_remnant",
    ]);
  });

  it("does not include star_cluster/stellar_association (Epic #313: explicitly out of scope)", () => {
    expect(DIFFUSE_STRUCTURE_OBJECT_TYPES.has("star_cluster")).toBe(false);
    expect(DIFFUSE_STRUCTURE_OBJECT_TYPES.has("stellar_association")).toBe(false);
  });

  it("does not include star", () => {
    expect(DIFFUSE_STRUCTURE_OBJECT_TYPES.has("star")).toBe(false);
  });
});

describe("diffuseStructureRadiusPc (size_pc DIAMETER -> mesh RADIUS)", () => {
  it("halves a real size_pc (diameter) to get the mesh's radius", () => {
    expect(diffuseStructureRadiusPc(10)).toBe(5);
    expect(diffuseStructureRadiusPc(100)).toBe(50);
  });

  it("matches Orion Nebula M42's own real value: ~8.31pc diameter -> ~4.155pc radius, not ~8.31pc", () => {
    // Story #314's PR backfilled M42's size_pc to ~8.313003227248993 (a
    // DIAMETER, per that Story's verified mixed convention). M42's real
    // angular size (~65 arcmin at ~400pc) computes to a few pc across, so a
    // ~4.15pc RADIUS sphere is the physically correct rendering - a ~8.31pc
    // RADIUS sphere (i.e. forgetting to halve) would be exactly 2x too big.
    const m42SizePc = 8.313003227248993;
    const radiusPc = diffuseStructureRadiusPc(m42SizePc);
    expect(radiusPc).toBeCloseTo(4.156501613624497, 10);
    expect(radiusPc).toBeLessThan(5); // sanity: "a few pc across" territory
    expect(radiusPc).not.toBeCloseTo(m42SizePc, 1); // not the un-halved diameter
  });

  it("falls back to STRUCTURE_MIN_RADIUS_PC for null size_pc (M8/Lagoon Nebula today)", () => {
    expect(diffuseStructureRadiusPc(null)).toBe(STRUCTURE_MIN_RADIUS_PC);
  });

  it("falls back to STRUCTURE_MIN_RADIUS_PC for zero/negative/non-finite size_pc", () => {
    expect(diffuseStructureRadiusPc(0)).toBe(STRUCTURE_MIN_RADIUS_PC);
    expect(diffuseStructureRadiusPc(-5)).toBe(STRUCTURE_MIN_RADIUS_PC);
    expect(diffuseStructureRadiusPc(Number.NaN)).toBe(STRUCTURE_MIN_RADIUS_PC);
    expect(diffuseStructureRadiusPc(Number.POSITIVE_INFINITY)).toBe(STRUCTURE_MIN_RADIUS_PC);
  });

  it("never returns a zero/NaN radius, for any input", () => {
    for (const sizePc of [null, 0, -1, Number.NaN, 0.0001, 1e6]) {
      const radius = diffuseStructureRadiusPc(sizePc);
      expect(Number.isFinite(radius)).toBe(true);
      expect(radius).toBeGreaterThan(0);
    }
  });
});

describe("createDiffuseStructureLayer", () => {
  const m42 = makeObject({
    id: "m42_orion",
    name: "M 42",
    object_type: "hii_region",
    position_pc: [-357.2153955583126, -198.08499414943006, -143.6958463872156],
    size_pc: 8.313003227248993,
  });
  const cluster = makeObject({ id: "pleiades", object_type: "star_cluster", size_pc: 8 });
  const star = makeObject({ id: "some-star", object_type: "star" });
  const sizeless = makeObject({ id: "m8_lagoon", object_type: "hii_region", size_pc: null });

  it("builds one mesh per in-scope diffuse-structure object, in a named group", () => {
    const layer = createDiffuseStructureLayer([m42, cluster, star, sizeless]);
    expect(layer.group.name).toBe("diffuse-structures");
    expect(layer.meshes.map((m) => m.object.id).sort()).toEqual(["m42_orion", "m8_lagoon"]);
    expect(layer.group.children.length).toBe(2);
  });

  it("excludes star_cluster/stellar_association and star entirely", () => {
    const layer = createDiffuseStructureLayer([cluster, star]);
    expect(layer.meshes).toHaveLength(0);
    expect(layer.group.children).toHaveLength(0);
  });

  it("positions each mesh at the object's own position_pc", () => {
    const layer = createDiffuseStructureLayer([m42]);
    const mesh = layer.meshes[0].mesh;
    expect(mesh.position.x).toBeCloseTo(m42.position_pc[0], 10);
    expect(mesh.position.y).toBeCloseTo(m42.position_pc[1], 10);
    expect(mesh.position.z).toBeCloseTo(m42.position_pc[2], 10);
  });

  it("scales each mesh (a unit sphere) to the object's real radius (size_pc / 2)", () => {
    const layer = createDiffuseStructureLayer([m42]);
    const mesh = layer.meshes[0].mesh;
    expect(mesh.scale.x).toBeCloseTo(4.156501613624497, 10);
    expect(mesh.scale.y).toBeCloseTo(mesh.scale.x, 10);
    expect(mesh.scale.z).toBeCloseTo(mesh.scale.x, 10);
  });

  it("colors each mesh from OBJECT_TYPE_COLORS for its own object_type", () => {
    const molecularCloud = makeObject({ id: "cloud-a", object_type: "molecular_cloud", size_pc: 20 });
    const layer = createDiffuseStructureLayer([m42, molecularCloud]);
    const m42Mesh = layer.meshes.find((m) => m.object.id === "m42_orion")!.mesh;
    const cloudMesh = layer.meshes.find((m) => m.object.id === "cloud-a")!.mesh;
    expect((m42Mesh.material as MeshBasicMaterial).color.getHex()).toBe(OBJECT_TYPE_COLORS.hii_region);
    expect((cloudMesh.material as MeshBasicMaterial).color.getHex()).toBe(OBJECT_TYPE_COLORS.molecular_cloud);
  });

  it("builds each mesh translucent, at the existing extended-structure opacity tier, non-depth-writing", () => {
    const layer = createDiffuseStructureLayer([m42]);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(markerOpacityFor("hii_region"));
    expect(material.depthWrite).toBe(false);
  });

  it("gives a still-sizeless record (M8) a sensible, nonzero fallback radius rather than crashing or rendering zero-sized", () => {
    const layer = createDiffuseStructureLayer([sizeless]);
    const mesh = layer.meshes[0].mesh;
    expect(mesh.scale.x).toBe(STRUCTURE_MIN_RADIUS_PC);
    expect(Number.isFinite(mesh.scale.x)).toBe(true);
    expect(mesh.scale.x).toBeGreaterThan(0);
  });

  it("returns an empty (but valid) layer for an empty/all-out-of-scope catalog", () => {
    const layer = createDiffuseStructureLayer([]);
    expect(layer.meshes).toHaveLength(0);
    expect(layer.group.children).toHaveLength(0);

    const layer2 = createDiffuseStructureLayer([star, cluster]);
    expect(layer2.meshes).toHaveLength(0);
  });
});

describe("updateDiffuseStructureVisibility", () => {
  const near = makeObject({ id: "near", object_type: "molecular_cloud", distance_pc: 50 });
  const far = makeObject({ id: "far", object_type: "hii_region", distance_pc: 500 });

  it("hides a mesh whose category toggle is off", () => {
    const layer = createDiffuseStructureLayer([near, far]);
    const categoryVisibility = new Map<string, boolean>([
      ["molecular_cloud", false],
      ["hii_region", true],
    ]);
    updateDiffuseStructureVisibility(layer, categoryVisibility, null);
    const nearMesh = layer.meshes.find((m) => m.object.id === "near")!.mesh;
    const farMesh = layer.meshes.find((m) => m.object.id === "far")!.mesh;
    expect(nearMesh.visible).toBe(false);
    expect(farMesh.visible).toBe(true);
  });

  it("hides a mesh outside the current radius filter", () => {
    const layer = createDiffuseStructureLayer([near, far]);
    const categoryVisibility = new Map<string, boolean>([
      ["molecular_cloud", true],
      ["hii_region", true],
    ]);
    updateDiffuseStructureVisibility(layer, categoryVisibility, 100);
    const nearMesh = layer.meshes.find((m) => m.object.id === "near")!.mesh;
    const farMesh = layer.meshes.find((m) => m.object.id === "far")!.mesh;
    expect(nearMesh.visible).toBe(true);
    expect(farMesh.visible).toBe(false);
  });

  it("shows a mesh again once its category is re-toggled on", () => {
    const layer = createDiffuseStructureLayer([near]);
    const off = new Map<string, boolean>([["molecular_cloud", false]]);
    const on = new Map<string, boolean>([["molecular_cloud", true]]);
    updateDiffuseStructureVisibility(layer, off, null);
    expect(layer.meshes[0].mesh.visible).toBe(false);
    updateDiffuseStructureVisibility(layer, on, null);
    expect(layer.meshes[0].mesh.visible).toBe(true);
  });

  it("defaults a type with no explicit categoryVisibility entry to visible (matches isCatalogObjectVisible's own default)", () => {
    const layer = createDiffuseStructureLayer([near]);
    updateDiffuseStructureVisibility(layer, new Map(), null);
    expect(layer.meshes[0].mesh.visible).toBe(true);
  });
});

describe("updateDiffuseStructureDimming", () => {
  const obj = makeObject({ id: "cloud-a", object_type: "molecular_cloud" });

  it("normal (undimmed) opacity outside both boundaries equals markerOpacityFor", () => {
    const layer = createDiffuseStructureLayer([obj]);
    updateDiffuseStructureDimming(layer, false, false);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.opacity).toBe(markerOpacityFor("molecular_cloud"));
  });

  it("dims to the RECONS-sphere tier when inside the dense-batch sphere", () => {
    const layer = createDiffuseStructureLayer([obj]);
    updateDiffuseStructureDimming(layer, true, false);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.opacity).toBe(backgroundBucketOpacity("molecular_cloud", true, false));
    expect(material.opacity).toBeLessThan(markerOpacityFor("molecular_cloud"));
  });

  it("dims to the gentler Local-Bubble tier when inside the bubble but outside the sphere", () => {
    const layer = createDiffuseStructureLayer([obj]);
    updateDiffuseStructureDimming(layer, false, true);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.opacity).toBe(backgroundBucketOpacity("molecular_cloud", false, true));
  });

  it("the sphere tier wins when both booleans are true, exactly matching backgroundBucketOpacity's own priority", () => {
    const layer = createDiffuseStructureLayer([obj]);
    updateDiffuseStructureDimming(layer, true, true);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.opacity).toBe(backgroundBucketOpacity("molecular_cloud", true, true));
  });

  it("restores exactly to the original opacity after a dim/restore cycle (no drift)", () => {
    const layer = createDiffuseStructureLayer([obj]);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    const original = material.opacity;
    updateDiffuseStructureDimming(layer, true, false);
    expect(material.opacity).not.toBe(original);
    updateDiffuseStructureDimming(layer, false, false);
    expect(material.opacity).toBe(original);
  });

  it("each mesh owns its own material - dimming one object's mesh never touches another's", () => {
    const other = makeObject({ id: "cloud-b", object_type: "supernova_remnant" });
    const layer = createDiffuseStructureLayer([obj, other]);
    updateDiffuseStructureDimming(layer, true, false);
    const cloudMaterial = layer.meshes.find((m) => m.object.id === "cloud-a")!.mesh.material as MeshBasicMaterial;
    const snrMaterial = layer.meshes.find((m) => m.object.id === "cloud-b")!.mesh.material as MeshBasicMaterial;
    expect(cloudMaterial).not.toBe(snrMaterial);
    expect(snrMaterial.opacity).toBe(backgroundBucketOpacity("supernova_remnant", true, false));
  });
});

describe("visibleDiffuseStructureObjects", () => {
  const near = makeObject({ id: "near", object_type: "molecular_cloud", distance_pc: 50 });
  const far = makeObject({ id: "far", object_type: "hii_region", distance_pc: 500 });

  it("returns only objects that pass the category/radius-filter rule, mirroring updateDiffuseStructureVisibility", () => {
    const layer = createDiffuseStructureLayer([near, far]);
    const categoryVisibility = new Map<string, boolean>([
      ["molecular_cloud", true],
      ["hii_region", true],
    ]);
    const visible = visibleDiffuseStructureObjects(layer, categoryVisibility, 100);
    expect(visible.map((o) => o.id)).toEqual(["near"]);
  });

  it("returns an empty array when nothing passes", () => {
    const layer = createDiffuseStructureLayer([near, far]);
    const categoryVisibility = new Map<string, boolean>([
      ["molecular_cloud", false],
      ["hii_region", false],
    ]);
    expect(visibleDiffuseStructureObjects(layer, categoryVisibility, null)).toEqual([]);
  });

  it("returns real Mesh-backed layer entries only (never a bucket-style object)", () => {
    const layer = createDiffuseStructureLayer([near]);
    expect(layer.meshes[0].mesh).toBeInstanceOf(Mesh);
  });
});
