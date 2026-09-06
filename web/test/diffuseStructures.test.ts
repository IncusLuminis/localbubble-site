import { describe, expect, it } from "vitest";
import { Group, Mesh, MeshBasicMaterial, Sprite, SpriteMaterial } from "three";
import {
  ASSOCIATION_DEFAULT_RADIUS_PC,
  ASSOCIATION_SPARK_COUNT,
  buildAssociationGroup,
  buildClusterGroup,
  buildMistyCloudGroup,
  CLUSTER_DEFAULT_RADIUS_PC,
  CLUSTER_MAX_RADIUS_PC,
  CLUSTER_STAR_COUNT,
  clusterOrAssociationShapeRadiusPc,
  createDiffuseStructureLayer,
  diffuseStructureRadiusPc,
  DIFFUSE_STRUCTURE_OBJECT_TYPES,
  getMistySpriteTexture,
  MISTY_CLOUD_SPRITE_COUNT,
  randomPointStrictlyInsideUnitSphere,
  updateDiffuseStructureDimming,
  updateDiffuseStructureSizeScale,
  updateDiffuseStructureVisibility,
  visibleDiffuseStructureObjects,
} from "../src/scene/diffuseStructures";
import {
  backgroundBucketOpacity,
  markerOpacityFor,
  markerRadiusPc,
  OBJECT_TYPE_COLORS,
  STRUCTURE_MIN_RADIUS_PC,
} from "../src/scene/objects";
import type { SceneObject } from "../src/scene/sceneTypes";

/**
 * Story #315 (extended by Story #320): extended-volume rendering for
 * catalog object types that no longer render as generic point markers.
 * Coverage focus:
 *  - the size_pc DIAMETER -> mesh-radius RADIUS conversion for the
 *    misty-cloud-eligible types (the Story's own explicit "getting this
 *    backwards renders everything 2x too big" warning, verified numerically
 *    against Orion Nebula M42's real value);
 *  - the fallback for a still-missing size_pc (M8/Lagoon Nebula today);
 *  - the generic factory only ever picks up the in-scope types;
 *  - visibility/dimming reuse `objects.ts`'s existing predicates exactly;
 *  - Story #320's new shapes (misty cloud / association haze+sparks /
 *    cluster sphere+sparks), their confirmed colors/radii/counts, the
 *    strictly-in-sphere rejection sampling clusters rely on, and the
 *    generalized Sprite-or-Mesh dimming loop the cluster shape's gray
 *    sphere needs;
 *  - the picking-proxy-radius-cap bug fix (Story #320's single most
 *    important correctness property - see also `test/picking.test.ts`'s own
 *    "picking-proxy radius cap" describe block for the end-to-end raycast
 *    regression test).
 *
 * This repo's `vite.config.ts` runs Vitest with `environment: "node"` (no
 * DOM) - `getMistySpriteTexture()` is guarded to return `null` rather than
 * throw in that environment (see its own docstring), so every shape builder
 * below is exercised here with a real, though textureless, `SpriteMaterial`.
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
  it("contains exactly the six Story #315/#320 in-scope types", () => {
    expect(Array.from(DIFFUSE_STRUCTURE_OBJECT_TYPES).sort()).toEqual([
      "hii_region",
      "molecular_cloud",
      "planetary_nebula",
      "star_cluster",
      "stellar_association",
      "supernova_remnant",
    ]);
  });

  it("includes star_cluster/stellar_association (Story #320: moved off the point-marker path)", () => {
    expect(DIFFUSE_STRUCTURE_OBJECT_TYPES.has("star_cluster")).toBe(true);
    expect(DIFFUSE_STRUCTURE_OBJECT_TYPES.has("stellar_association")).toBe(true);
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

describe("createDiffuseStructureLayer - overall dispatch", () => {
  const nebula = makeObject({ id: "ring-nebula", object_type: "planetary_nebula", size_pc: 6 });
  const cloud = makeObject({ id: "m42_orion", object_type: "hii_region", size_pc: 8.313003227248993 });
  const association = makeObject({ id: "sco-cen", object_type: "stellar_association", size_pc: 30 });
  const cluster = makeObject({ id: "pleiades", object_type: "star_cluster", size_pc: 8 });
  const star = makeObject({ id: "some-star", object_type: "star" });

  it("builds one layer entry per in-scope object, excluding only star", () => {
    const layer = createDiffuseStructureLayer([nebula, cloud, association, cluster, star]);
    expect(layer.group.name).toBe("diffuse-structures");
    expect(layer.meshes.map((m) => m.object.id).sort()).toEqual([
      "m42_orion",
      "pleiades",
      "ring-nebula",
      "sco-cen",
    ]);
  });

  it("excludes star entirely (still a point-marker/InstancedMesh type)", () => {
    const layer = createDiffuseStructureLayer([star]);
    expect(layer.meshes).toHaveLength(0);
    expect(layer.group.children).toHaveLength(0);
  });

  it("returns an empty (but valid) layer for an empty/all-out-of-scope catalog", () => {
    const layer = createDiffuseStructureLayer([]);
    expect(layer.meshes).toHaveLength(0);
    expect(layer.group.children).toHaveLength(0);

    const layer2 = createDiffuseStructureLayer([star]);
    expect(layer2.meshes).toHaveLength(0);
  });

  it("planetary_nebula gets exactly one group child (its own plain-sphere mesh, no proxy/spriteGroup split)", () => {
    const layer = createDiffuseStructureLayer([nebula]);
    expect(layer.group.children).toHaveLength(1);
    expect(layer.meshes[0].spriteGroup).toBeUndefined();
    expect(layer.meshes[0].mesh.visible).toBe(true);
  });

  it("misty-cloud/association/cluster types each get two group children (invisible proxy + decorative shape)", () => {
    for (const obj of [cloud, association, cluster]) {
      const layer = createDiffuseStructureLayer([obj]);
      expect(layer.group.children).toHaveLength(2);
      expect(layer.meshes[0].spriteGroup).toBeInstanceOf(Group);
      expect(layer.group.children).toContain(layer.meshes[0].mesh);
      expect(layer.group.children).toContain(layer.meshes[0].spriteGroup);
    }
  });

  it("returns real Mesh-backed layer entries only (never a bucket-style object)", () => {
    const layer = createDiffuseStructureLayer([nebula, cloud]);
    for (const entry of layer.meshes) {
      expect(entry.mesh).toBeInstanceOf(Mesh);
    }
  });
});

describe("createDiffuseStructureLayer - planetary_nebula (unchanged plain-sphere path)", () => {
  const nebula = makeObject({
    id: "ring-nebula",
    object_type: "planetary_nebula",
    position_pc: [-357.2153955583126, -198.08499414943006, -143.6958463872156],
    size_pc: 8.313003227248993,
  });
  const sizeless = makeObject({ id: "sizeless-nebula", object_type: "planetary_nebula", size_pc: null });

  it("positions the mesh at the object's own position_pc", () => {
    const layer = createDiffuseStructureLayer([nebula]);
    const mesh = layer.meshes[0].mesh;
    expect(mesh.position.x).toBeCloseTo(nebula.position_pc[0], 10);
    expect(mesh.position.y).toBeCloseTo(nebula.position_pc[1], 10);
    expect(mesh.position.z).toBeCloseTo(nebula.position_pc[2], 10);
  });

  it("scales the mesh (a unit sphere) to the object's real radius (size_pc / 2)", () => {
    const layer = createDiffuseStructureLayer([nebula]);
    const mesh = layer.meshes[0].mesh;
    expect(mesh.scale.x).toBeCloseTo(4.156501613624497, 10);
    expect(mesh.scale.y).toBeCloseTo(mesh.scale.x, 10);
    expect(mesh.scale.z).toBeCloseTo(mesh.scale.x, 10);
  });

  it("colors the mesh from OBJECT_TYPE_COLORS for its own object_type", () => {
    const layer = createDiffuseStructureLayer([nebula]);
    const mesh = layer.meshes[0].mesh;
    expect((mesh.material as MeshBasicMaterial).color.getHex()).toBe(OBJECT_TYPE_COLORS.planetary_nebula);
  });

  it("builds the mesh translucent, at the existing extended-structure opacity tier, non-depth-writing", () => {
    const layer = createDiffuseStructureLayer([nebula]);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.transparent).toBe(true);
    expect(material.opacity).toBe(markerOpacityFor("planetary_nebula"));
    expect(material.depthWrite).toBe(false);
  });

  it("gives a still-sizeless record a sensible, nonzero fallback radius rather than crashing or rendering zero-sized", () => {
    const layer = createDiffuseStructureLayer([sizeless]);
    const mesh = layer.meshes[0].mesh;
    expect(mesh.scale.x).toBe(STRUCTURE_MIN_RADIUS_PC);
    expect(Number.isFinite(mesh.scale.x)).toBe(true);
    expect(mesh.scale.x).toBeGreaterThan(0);
  });
});

describe("createDiffuseStructureLayer - misty cloud shape (molecular_cloud/hii_region/supernova_remnant)", () => {
  const m42 = makeObject({
    id: "m42_orion",
    object_type: "hii_region",
    position_pc: [-357.2153955583126, -198.08499414943006, -143.6958463872156],
    size_pc: 8.313003227248993,
  });
  const molecularCloud = makeObject({ id: "cloud-a", object_type: "molecular_cloud", size_pc: 20 });
  const snr = makeObject({ id: "vela-snr", object_type: "supernova_remnant", size_pc: 160 });

  it("registers an invisible (opacity 0) proxy mesh, positioned/scaled to the real diffuse-structure radius, capped at the pick-proxy cap", () => {
    const layer = createDiffuseStructureLayer([m42]);
    const proxy = layer.meshes[0].mesh;
    expect(proxy.visible).toBe(true);
    expect((proxy.material as MeshBasicMaterial).opacity).toBe(0);
    expect(proxy.position.x).toBeCloseTo(m42.position_pc[0], 10);
    expect(proxy.position.y).toBeCloseTo(m42.position_pc[1], 10);
    expect(proxy.position.z).toBeCloseTo(m42.position_pc[2], 10);
    // M42's real radius (~4.16pc) is well under the pick-proxy cap, so the
    // proxy is NOT clamped here - the clamp-in-action case is covered by the
    // Vela SNR test below and by the dedicated "picking-proxy radius cap"
    // describe block.
    expect(proxy.scale.x).toBeCloseTo(4.156501613624497, 10);
  });

  it("caps the proxy mesh's radius independent of a much larger visual radius (Vela SNR repro)", () => {
    const layer = createDiffuseStructureLayer([snr]);
    const proxy = layer.meshes[0].mesh;
    const visualRadiusPc = diffuseStructureRadiusPc(snr.size_pc); // 80pc
    expect(visualRadiusPc).toBeGreaterThan(8);
    expect(proxy.scale.x).toBe(8);
    expect(proxy.scale.x).toBeLessThan(visualRadiusPc);
  });

  it("builds a spriteGroup with exactly MISTY_CLOUD_SPRITE_COUNT sprite children, tinted the object type's own color", () => {
    const layer = createDiffuseStructureLayer([molecularCloud]);
    const group = layer.meshes[0].spriteGroup!;
    expect(group.children).toHaveLength(MISTY_CLOUD_SPRITE_COUNT);
    for (const child of group.children) {
      expect(child).toBeInstanceOf(Sprite);
      const material = (child as Sprite).material as SpriteMaterial;
      expect(material.color.getHex()).toBe(OBJECT_TYPE_COLORS.molecular_cloud);
      expect(material.transparent).toBe(true);
      expect(material.depthWrite).toBe(false);
    }
  });

  it("positions the spriteGroup at the object's own position_pc", () => {
    const layer = createDiffuseStructureLayer([m42]);
    const group = layer.meshes[0].spriteGroup!;
    expect(group.position.x).toBeCloseTo(m42.position_pc[0], 10);
    expect(group.position.y).toBeCloseTo(m42.position_pc[1], 10);
    expect(group.position.z).toBeCloseTo(m42.position_pc[2], 10);
  });

  it("keeps the supernova_remnant's own OBJECT_TYPE_COLORS red for its misty-cloud sprites (no new color requested)", () => {
    const layer = createDiffuseStructureLayer([snr]);
    const group = layer.meshes[0].spriteGroup!;
    const material = (group.children[0] as Sprite).material as SpriteMaterial;
    expect(material.color.getHex()).toBe(OBJECT_TYPE_COLORS.supernova_remnant);
  });

  it("does not include planetary_nebula in the misty-cloud treatment", () => {
    const nebula = makeObject({ id: "ring-nebula", object_type: "planetary_nebula", size_pc: 6 });
    const layer = createDiffuseStructureLayer([nebula]);
    expect(layer.meshes[0].spriteGroup).toBeUndefined();
  });
});

describe("createDiffuseStructureLayer - stellar_association shape", () => {
  it("uses real size_pc directly as the RADIUS (Story #314 convention), not halved", () => {
    const association = makeObject({ id: "sco-cen", object_type: "stellar_association", size_pc: 30 });
    const layer = createDiffuseStructureLayer([association]);
    const proxy = layer.meshes[0].mesh;
    // Proxy is capped at PICK_PROXY_RADIUS_CAP_PC (8), so its own scale
    // doesn't directly reveal the uncapped radius - assert via the haze
    // sprite's scale instead (radiusPc * 2, per buildAssociationGroup).
    const haze = layer.meshes[0].spriteGroup!.children[0] as Sprite;
    expect(haze.scale.x).toBeCloseTo(60, 10); // 30 * 2
    expect(proxy.scale.x).toBe(8); // capped, independent of the real 30pc radius
  });

  it("falls back to ASSOCIATION_DEFAULT_RADIUS_PC when size_pc is null/non-finite/non-positive", () => {
    for (const sizePc of [null, 0, -5, Number.NaN]) {
      const association = makeObject({ id: "no-size-assoc", object_type: "stellar_association", size_pc: sizePc });
      const layer = createDiffuseStructureLayer([association]);
      const haze = layer.meshes[0].spriteGroup!.children[0] as Sprite;
      expect(haze.scale.x).toBeCloseTo(ASSOCIATION_DEFAULT_RADIUS_PC * 2, 10);
    }
  });

  it("is never capped, even for a very large real size_pc (no cap requested for this type)", () => {
    const association = makeObject({ id: "huge-assoc", object_type: "stellar_association", size_pc: 500 });
    const layer = createDiffuseStructureLayer([association]);
    const haze = layer.meshes[0].spriteGroup!.children[0] as Sprite;
    expect(haze.scale.x).toBeCloseTo(1000, 10); // 500 * 2, uncapped
  });

  it("builds exactly one haze sprite plus ASSOCIATION_SPARK_COUNT spark sprites", () => {
    const association = makeObject({ id: "sco-cen", object_type: "stellar_association", size_pc: 30 });
    const layer = createDiffuseStructureLayer([association]);
    const group = layer.meshes[0].spriteGroup!;
    expect(group.children).toHaveLength(1 + ASSOCIATION_SPARK_COUNT);
    for (const child of group.children) {
      expect(child).toBeInstanceOf(Sprite);
    }
  });

  it("tints the haze sprite the association's own OBJECT_TYPE_COLORS color", () => {
    const association = makeObject({ id: "sco-cen", object_type: "stellar_association", size_pc: 30 });
    const layer = createDiffuseStructureLayer([association]);
    const haze = layer.meshes[0].spriteGroup!.children[0] as Sprite;
    expect((haze.material as SpriteMaterial).color.getHex()).toBe(OBJECT_TYPE_COLORS.stellar_association);
  });
});

describe("createDiffuseStructureLayer - star_cluster shape", () => {
  it("uses real size_pc directly as the RADIUS (Story #314 convention), not halved", () => {
    const cluster = makeObject({ id: "pleiades", object_type: "star_cluster", size_pc: 6 });
    const layer = createDiffuseStructureLayer([cluster]);
    const sphere = layer.meshes[0].spriteGroup!.children[0] as Mesh;
    expect(sphere.scale.x).toBeCloseTo(6, 10);
  });

  it("falls back to CLUSTER_DEFAULT_RADIUS_PC when size_pc is null/non-finite/non-positive", () => {
    for (const sizePc of [null, 0, -5, Number.NaN]) {
      const cluster = makeObject({ id: "no-size-cluster", object_type: "star_cluster", size_pc: sizePc });
      const layer = createDiffuseStructureLayer([cluster]);
      const sphere = layer.meshes[0].spriteGroup!.children[0] as Mesh;
      expect(sphere.scale.x).toBeCloseTo(CLUSTER_DEFAULT_RADIUS_PC, 10);
    }
  });

  it("caps the rendered (visual) radius at CLUSTER_MAX_RADIUS_PC for the catalog's real long-tail outliers", () => {
    const cluster = makeObject({ id: "loose-group", object_type: "star_cluster", size_pc: 99 });
    const layer = createDiffuseStructureLayer([cluster]);
    const sphere = layer.meshes[0].spriteGroup!.children[0] as Mesh;
    expect(sphere.scale.x).toBe(CLUSTER_MAX_RADIUS_PC);
  });

  it("does not touch the underlying object's own size_pc data (render-size clamp only)", () => {
    const cluster = makeObject({ id: "loose-group", object_type: "star_cluster", size_pc: 99 });
    const layer = createDiffuseStructureLayer([cluster]);
    expect(layer.meshes[0].object.size_pc).toBe(99);
  });

  it("builds exactly one gray bounding-sphere Mesh plus CLUSTER_STAR_COUNT spark sprites", () => {
    const cluster = makeObject({ id: "pleiades", object_type: "star_cluster", size_pc: 6 });
    const layer = createDiffuseStructureLayer([cluster]);
    const group = layer.meshes[0].spriteGroup!;
    expect(group.children).toHaveLength(1 + CLUSTER_STAR_COUNT);
    expect(group.children[0]).toBeInstanceOf(Mesh);
    for (const child of group.children.slice(1)) {
      expect(child).toBeInstanceOf(Sprite);
    }
  });

  it("colors the bounding sphere very-light-gray, deliberately NOT the cluster's own OBJECT_TYPE_COLORS yellow", () => {
    const cluster = makeObject({ id: "pleiades", object_type: "star_cluster", size_pc: 6 });
    const layer = createDiffuseStructureLayer([cluster]);
    const sphere = layer.meshes[0].spriteGroup!.children[0] as Mesh;
    const color = (sphere.material as MeshBasicMaterial).color.getHex();
    expect(color).not.toBe(OBJECT_TYPE_COLORS.star_cluster);
    expect(color).toBe(0xd8dde6);
  });

  it("every spark sprite sits strictly inside the bounding sphere's true radius", () => {
    const cluster = makeObject({ id: "pleiades", object_type: "star_cluster", size_pc: 6 });
    const layer = createDiffuseStructureLayer([cluster]);
    const group = layer.meshes[0].spriteGroup!;
    const radiusPc = (group.children[0] as Mesh).scale.x;
    for (const spark of group.children.slice(1)) {
      const distanceFromCenter = spark.position.length();
      expect(distanceFromCenter).toBeLessThan(radiusPc);
    }
  });
});

/**
 * PR #321 Validator-found regression: the selection reticle for
 * `star_cluster`/`stellar_association` kept sourcing its radius from
 * `objects.ts`'s OLD point-marker tier formula (`markerRadiusPc`'s
 * `CLUSTER_OBJECT_TYPES` branch) even after Story #320 moved these two
 * types' actual rendering into this module's own shapes - so the reticle no
 * longer matched what was actually on screen, most visibly for a
 * `size_pc`-less `stellar_association` (the common case, per Story #314's
 * own documented honest-failure rate), where the reticle showed the old
 * 5-9pc tier while the haze actually rendered at
 * `ASSOCIATION_DEFAULT_RADIUS_PC` (22pc). The Validator confirmed this live
 * against "Vela OB2", a real `size_pc`-less `stellar_association` record.
 *
 * `clusterOrAssociationShapeRadiusPc` (the fix: `main.ts`'s
 * `selectedObjectMarkerRadiusPc` now calls this directly for these two
 * types, instead of `objects.ts`'s `selectedMarkerRadiusPc`) is exercised
 * here against the REAL radius baked into `createDiffuseStructureLayer`'s
 * own built shape (read off the actual `Sprite`/`Mesh` scale, not merely
 * re-calling the same function under test), so this is a genuine
 * integration check, not a tautology.
 */
describe("clusterOrAssociationShapeRadiusPc (PR #321 reticle-radius regression fix)", () => {
  it("star_cluster, real size_pc: matches the real bounding-sphere shape radius exactly", () => {
    const cluster = makeObject({ id: "pleiades", object_type: "star_cluster", size_pc: 6 });
    const layer = createDiffuseStructureLayer([cluster]);
    const sphere = layer.meshes[0].spriteGroup!.children[0] as Mesh;
    expect(clusterOrAssociationShapeRadiusPc(cluster)).toBeCloseTo(sphere.scale.x, 10);
    expect(clusterOrAssociationShapeRadiusPc(cluster)).toBe(6);
  });

  it("star_cluster, no size_pc (default): matches the real bounding-sphere shape radius exactly", () => {
    const cluster = makeObject({ id: "no-size-cluster", object_type: "star_cluster", size_pc: null });
    const layer = createDiffuseStructureLayer([cluster]);
    const sphere = layer.meshes[0].spriteGroup!.children[0] as Mesh;
    expect(clusterOrAssociationShapeRadiusPc(cluster)).toBeCloseTo(sphere.scale.x, 10);
    expect(clusterOrAssociationShapeRadiusPc(cluster)).toBe(CLUSTER_DEFAULT_RADIUS_PC);
  });

  it("star_cluster, oversized real size_pc: matches the real (capped) bounding-sphere shape radius exactly", () => {
    const cluster = makeObject({ id: "loose-group", object_type: "star_cluster", size_pc: 99 });
    const layer = createDiffuseStructureLayer([cluster]);
    const sphere = layer.meshes[0].spriteGroup!.children[0] as Mesh;
    expect(clusterOrAssociationShapeRadiusPc(cluster)).toBe(sphere.scale.x);
    expect(clusterOrAssociationShapeRadiusPc(cluster)).toBe(CLUSTER_MAX_RADIUS_PC);
  });

  it("stellar_association, real size_pc: matches the real haze-sprite shape radius exactly", () => {
    const association = makeObject({ id: "sco-cen", object_type: "stellar_association", size_pc: 30 });
    const layer = createDiffuseStructureLayer([association]);
    const haze = layer.meshes[0].spriteGroup!.children[0] as Sprite;
    const realShapeRadiusPc = haze.scale.x / 2; // buildAssociationGroup: haze.scale.setScalar(radiusPc * 2)
    expect(clusterOrAssociationShapeRadiusPc(association)).toBeCloseTo(realShapeRadiusPc, 10);
    expect(clusterOrAssociationShapeRadiusPc(association)).toBe(30);
  });

  it("stellar_association, no size_pc (default, the 'Vela OB2' scenario): matches the real haze-sprite shape radius, and NOT the stale point-marker formula", () => {
    const association = makeObject({ id: "vela-ob2", object_type: "stellar_association", size_pc: null });
    const layer = createDiffuseStructureLayer([association]);
    const haze = layer.meshes[0].spriteGroup!.children[0] as Sprite;
    const realShapeRadiusPc = haze.scale.x / 2;

    // The fix: the reticle's actual radius source now matches the real shape.
    expect(clusterOrAssociationShapeRadiusPc(association)).toBeCloseTo(realShapeRadiusPc, 10);
    expect(clusterOrAssociationShapeRadiusPc(association)).toBe(ASSOCIATION_DEFAULT_RADIUS_PC);
    expect(realShapeRadiusPc).toBe(22);

    // The regression, made concrete: `objects.ts`'s OLD point-marker tier
    // formula - what the reticle used to source its radius from, and what
    // it would go straight back to sourcing from if this special-case were
    // ever reverted/dropped - gives a completely different, wrong answer for
    // this exact "no size_pc" case. This is the divergence the Validator
    // found live on "Vela OB2"; asserting it here means this test would
    // fail again if the bug ever came back.
    const staleReticleRadiusPc = markerRadiusPc(association.size_pc, association.object_type);
    expect(staleReticleRadiusPc).toBe(5); // old CLUSTER_MIN_RADIUS_PC floor
    expect(staleReticleRadiusPc).not.toBeCloseTo(realShapeRadiusPc, 5);
  });

  it("throws for any object_type other than star_cluster/stellar_association - asking it for a type it doesn't own is a bug, not a silent fallback", () => {
    const notACluster = makeObject({ id: "cloud", object_type: "molecular_cloud" });
    expect(() => clusterOrAssociationShapeRadiusPc(notACluster)).toThrow();
  });
});

describe("picking-proxy radius cap (Story #320 bug fix)", () => {
  it("caps every shaped type's proxy at 8pc regardless of a much larger visual radius", () => {
    const hugeCloud = makeObject({ id: "huge-cloud", object_type: "molecular_cloud", size_pc: 400 }); // 200pc radius
    const hugeSnr = makeObject({ id: "huge-snr", object_type: "supernova_remnant", size_pc: 160 }); // 80pc radius
    const hugeAssociation = makeObject({ id: "huge-assoc", object_type: "stellar_association", size_pc: 500 });
    const looseCluster = makeObject({ id: "loose-cluster", object_type: "star_cluster", size_pc: 99 });

    for (const obj of [hugeCloud, hugeSnr, hugeAssociation, looseCluster]) {
      const layer = createDiffuseStructureLayer([obj]);
      expect(layer.meshes[0].mesh.scale.x).toBe(8);
    }
  });

  it("never caps a genuinely small object's proxy below its own real radius", () => {
    const smallCluster = makeObject({ id: "small-cluster", object_type: "star_cluster", size_pc: 3 });
    const layer = createDiffuseStructureLayer([smallCluster]);
    expect(layer.meshes[0].mesh.scale.x).toBeCloseTo(3, 10);
  });
});

describe("updateDiffuseStructureVisibility", () => {
  const near = makeObject({ id: "near", object_type: "molecular_cloud", distance_pc: 50 });
  const far = makeObject({ id: "far", object_type: "hii_region", distance_pc: 500 });
  const cluster = makeObject({ id: "cluster-a", object_type: "star_cluster", distance_pc: 20 });

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

  it("Story #320: also toggles the decorative spriteGroup's own visibility in lockstep with its proxy mesh", () => {
    const layer = createDiffuseStructureLayer([cluster]);
    const off = new Map<string, boolean>([["star_cluster", false]]);
    updateDiffuseStructureVisibility(layer, off, null);
    expect(layer.meshes[0].mesh.visible).toBe(false);
    expect(layer.meshes[0].spriteGroup!.visible).toBe(false);

    const on = new Map<string, boolean>([["star_cluster", true]]);
    updateDiffuseStructureVisibility(layer, on, null);
    expect(layer.meshes[0].mesh.visible).toBe(true);
    expect(layer.meshes[0].spriteGroup!.visible).toBe(true);
  });
});

/**
 * Issue #26: the "Object size" slider must resize each structure WITHOUT
 * moving it. It used to scale `layer.group` itself (the shared top-level
 * container every structure's real position lives inside, sitting at the
 * Sun) - since Three.js composes a child's world position as
 * `parent.matrixWorld * child.matrix`, that multiplied every structure's
 * baked-in `position_pc` too, moving it radially. `updateDiffuseStructureSizeScale`
 * instead scales each structure's own `mesh`/`spriteGroup`, leaving
 * `layer.group` (and thus every child's position) untouched.
 */
describe("updateDiffuseStructureSizeScale", () => {
  it("never touches the shared layer.group's own scale", () => {
    const nebula = makeObject({ id: "ring-nebula", object_type: "planetary_nebula", size_pc: 6 });
    const layer = createDiffuseStructureLayer([nebula]);
    updateDiffuseStructureSizeScale(layer, 2.5);
    expect(layer.group.scale.x).toBe(1);
    expect(layer.group.scale.y).toBe(1);
    expect(layer.group.scale.z).toBe(1);
  });

  it("planetary_nebula: resizes the visible mesh in place, position unchanged", () => {
    const nebula = makeObject({
      id: "ring-nebula",
      object_type: "planetary_nebula",
      size_pc: 6, // diffuseStructureRadiusPc(6) === 3pc radius
      position_pc: [12, -34, 56],
    });
    const layer = createDiffuseStructureLayer([nebula]);
    const mesh = layer.meshes[0].mesh;
    const originalScale = mesh.scale.x;

    updateDiffuseStructureSizeScale(layer, 2);

    expect(mesh.position.x).toBe(12);
    expect(mesh.position.y).toBe(-34);
    expect(mesh.position.z).toBe(56);
    expect(mesh.scale.x).toBeCloseTo(originalScale * 2, 10);
  });

  it("star_cluster: resizes both the invisible proxy and the decorative spriteGroup, position unchanged", () => {
    const cluster = makeObject({
      id: "pleiades",
      object_type: "star_cluster",
      size_pc: 6, // well under the 8pc proxy cap
      position_pc: [1, 2, 3],
    });
    const layer = createDiffuseStructureLayer([cluster]);
    const { mesh, spriteGroup } = layer.meshes[0];
    const originalProxyScale = mesh.scale.x;

    updateDiffuseStructureSizeScale(layer, 2);

    // Proxy mesh: position untouched, scale doubled from its own baked radius.
    expect(mesh.position.x).toBe(1);
    expect(mesh.position.y).toBe(2);
    expect(mesh.position.z).toBe(3);
    expect(mesh.scale.x).toBeCloseTo(originalProxyScale * 2, 10);

    // spriteGroup: position (the structure's own real coordinates) untouched;
    // its own scale is set directly to sizeScale, resizing every child sprite
    // around the group's own center without moving the group itself.
    expect(spriteGroup!.position.x).toBe(1);
    expect(spriteGroup!.position.y).toBe(2);
    expect(spriteGroup!.position.z).toBe(3);
    expect(spriteGroup!.scale.x).toBe(2);
    expect(spriteGroup!.scale.y).toBe(2);
    expect(spriteGroup!.scale.z).toBe(2);
  });

  it("caps the picking proxy's scaled radius relative to its OWN capped base, not the shape's uncapped visual radius", () => {
    // Same huge-cloud fixture the picking-proxy-cap regression test above
    // uses: 200pc visual radius, but the proxy itself is built capped at 8pc
    // (Story #320). The size slider must scale from that 8pc base, not from
    // the shape's real 200pc radius.
    const hugeCloud = makeObject({ id: "huge-cloud", object_type: "molecular_cloud", size_pc: 400 });
    const layer = createDiffuseStructureLayer([hugeCloud]);
    const mesh = layer.meshes[0].mesh;
    expect(mesh.scale.x).toBe(8);

    updateDiffuseStructureSizeScale(layer, 2);

    expect(mesh.scale.x).toBe(16); // 8 * 2, not 200 * 2
  });

  it("repeated calls with different scales don't compound - each call recomputes fresh from the base radius", () => {
    const nebula = makeObject({ id: "ring-nebula", object_type: "planetary_nebula", size_pc: 6 });
    const layer = createDiffuseStructureLayer([nebula]);
    const mesh = layer.meshes[0].mesh;
    const baseRadiusPc = mesh.scale.x;

    updateDiffuseStructureSizeScale(layer, 3);
    updateDiffuseStructureSizeScale(layer, 0.5);

    expect(mesh.scale.x).toBeCloseTo(baseRadiusPc * 0.5, 10);
  });

  it("does not move a structure whose real position is far from the origin (regression for the exact reported bug)", () => {
    const farAssociation = makeObject({
      id: "far-assoc",
      object_type: "stellar_association",
      size_pc: 30,
      position_pc: [500, -200, 75],
    });
    const layer = createDiffuseStructureLayer([farAssociation]);
    const { mesh, spriteGroup } = layer.meshes[0];

    for (const sizeScale of [0.5, 1, 2, 3]) {
      updateDiffuseStructureSizeScale(layer, sizeScale);
      expect(mesh.position.x).toBe(500);
      expect(mesh.position.y).toBe(-200);
      expect(mesh.position.z).toBe(75);
      expect(spriteGroup!.position.x).toBe(500);
      expect(spriteGroup!.position.y).toBe(-200);
      expect(spriteGroup!.position.z).toBe(75);
    }
  });
});

describe("updateDiffuseStructureDimming - planetary_nebula (unchanged plain-material path)", () => {
  const obj = makeObject({ id: "ring-nebula", object_type: "planetary_nebula" });

  it("normal (undimmed) opacity outside both boundaries equals markerOpacityFor", () => {
    const layer = createDiffuseStructureLayer([obj]);
    updateDiffuseStructureDimming(layer, false, false);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.opacity).toBe(markerOpacityFor("planetary_nebula"));
  });

  it("dims to the RECONS-sphere tier when inside the dense-batch sphere", () => {
    const layer = createDiffuseStructureLayer([obj]);
    updateDiffuseStructureDimming(layer, true, false);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.opacity).toBe(backgroundBucketOpacity("planetary_nebula", true, false));
    expect(material.opacity).toBeLessThan(markerOpacityFor("planetary_nebula"));
  });

  it("dims to the gentler Local-Bubble tier when inside the bubble but outside the sphere", () => {
    const layer = createDiffuseStructureLayer([obj]);
    updateDiffuseStructureDimming(layer, false, true);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.opacity).toBe(backgroundBucketOpacity("planetary_nebula", false, true));
  });

  it("the sphere tier wins when both booleans are true, exactly matching backgroundBucketOpacity's own priority", () => {
    const layer = createDiffuseStructureLayer([obj]);
    updateDiffuseStructureDimming(layer, true, true);
    const material = layer.meshes[0].mesh.material as MeshBasicMaterial;
    expect(material.opacity).toBe(backgroundBucketOpacity("planetary_nebula", true, true));
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
    const other = makeObject({ id: "other-nebula", object_type: "planetary_nebula" });
    const layer = createDiffuseStructureLayer([obj, other]);
    updateDiffuseStructureDimming(layer, true, false);
    const a = layer.meshes.find((m) => m.object.id === "ring-nebula")!.mesh.material as MeshBasicMaterial;
    const b = layer.meshes.find((m) => m.object.id === "other-nebula")!.mesh.material as MeshBasicMaterial;
    expect(a).not.toBe(b);
  });
});

describe("updateDiffuseStructureDimming - Story #320 generalized Sprite-or-Mesh loop", () => {
  it("the proxy mesh stays permanently at opacity 0 regardless of dimming state", () => {
    const cloud = makeObject({ id: "cloud-a", object_type: "molecular_cloud" });
    const layer = createDiffuseStructureLayer([cloud]);
    updateDiffuseStructureDimming(layer, false, false);
    expect((layer.meshes[0].mesh.material as MeshBasicMaterial).opacity).toBe(0);
    updateDiffuseStructureDimming(layer, true, false);
    expect((layer.meshes[0].mesh.material as MeshBasicMaterial).opacity).toBe(0);
  });

  it("dims every Sprite child of a misty-cloud spriteGroup proportionally to its own base opacity", () => {
    const cloud = makeObject({ id: "cloud-a", object_type: "molecular_cloud" });
    const layer = createDiffuseStructureLayer([cloud]);
    const group = layer.meshes[0].spriteGroup!;
    const baseOpacities = group.children.map((c) => (c as Sprite).material.opacity);

    updateDiffuseStructureDimming(layer, true, false);
    const fullOpacity = markerOpacityFor("molecular_cloud");
    const dimmedOpacity = backgroundBucketOpacity("molecular_cloud", true, false);
    const dimRatio = dimmedOpacity / fullOpacity;

    group.children.forEach((child, i) => {
      const opacity = (child as Sprite).material.opacity;
      expect(opacity).toBeCloseTo(baseOpacities[i] * dimRatio, 10);
    });
  });

  it("dims the cluster shape's gray Mesh sphere alongside its Sprite sparks, proportionally, via duck-typing (not instanceof Sprite alone)", () => {
    const cluster = makeObject({ id: "pleiades", object_type: "star_cluster", size_pc: 6 });
    const layer = createDiffuseStructureLayer([cluster]);
    const group = layer.meshes[0].spriteGroup!;
    const sphere = group.children[0] as Mesh;
    const baseSphereOpacity = (sphere.material as MeshBasicMaterial).opacity;
    expect(baseSphereOpacity).toBeGreaterThan(0);

    updateDiffuseStructureDimming(layer, true, false);
    const fullOpacity = markerOpacityFor("star_cluster");
    const dimmedOpacity = backgroundBucketOpacity("star_cluster", true, false);
    const dimRatio = dimmedOpacity / fullOpacity;

    expect((sphere.material as MeshBasicMaterial).opacity).toBeCloseTo(baseSphereOpacity * dimRatio, 10);
    // The sphere must actually have been touched (not left at full/base
    // opacity) - this is the regression the Sprite-only #315 loop would fail:
    // a dimmed cluster showing its still-full-opacity gray sphere.
    expect((sphere.material as MeshBasicMaterial).opacity).not.toBe(baseSphereOpacity);

    for (const spark of group.children.slice(1)) {
      const sparkMaterial = (spark as Sprite).material as SpriteMaterial;
      expect(sparkMaterial.opacity).toBeLessThan(1);
      expect(sparkMaterial.opacity).toBeGreaterThan(0);
    }
  });

  it("restores exactly to each child's own original opacity after a dim/restore cycle (no drift, no cross-child leakage)", () => {
    const cluster = makeObject({ id: "pleiades", object_type: "star_cluster", size_pc: 6 });
    const layer = createDiffuseStructureLayer([cluster]);
    const group = layer.meshes[0].spriteGroup!;
    const originalOpacities = group.children.map(
      (c) => ((c as Mesh | Sprite).material as MeshBasicMaterial | SpriteMaterial).opacity,
    );

    updateDiffuseStructureDimming(layer, true, true);
    updateDiffuseStructureDimming(layer, false, false);

    group.children.forEach((child, i) => {
      const opacity = ((child as Mesh | Sprite).material as MeshBasicMaterial | SpriteMaterial).opacity;
      expect(opacity).toBeCloseTo(originalOpacities[i], 10);
    });
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
});

describe("randomPointStrictlyInsideUnitSphere", () => {
  it("every sample (across many trials, many seeds) has length <= 1 - the precise, testable claim clusters depend on", () => {
    let sampleCount = 0;
    for (let seed = 1; seed <= 25; seed++) {
      let s = seed * 2654435761; // arbitrary spread across seeds
      const rand = () => {
        s = (s * 1103515245 + 12345) & 0x7fffffff;
        return s / 0x7fffffff;
      };
      for (let i = 0; i < 500; i++) {
        const [x, y, z] = randomPointStrictlyInsideUnitSphere(rand);
        const length = Math.sqrt(x * x + y * y + z * z);
        expect(length).toBeLessThanOrEqual(1);
        sampleCount++;
      }
    }
    expect(sampleCount).toBe(25 * 500);
  });

  it("samples are not degenerately clustered at the origin (sanity: real spread, not all zero)", () => {
    let s = 42;
    const rand = () => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    const lengths: number[] = [];
    for (let i = 0; i < 200; i++) {
      const [x, y, z] = randomPointStrictlyInsideUnitSphere(rand);
      lengths.push(Math.sqrt(x * x + y * y + z * z));
    }
    const maxLength = Math.max(...lengths);
    expect(maxLength).toBeGreaterThan(0.5);
  });

  it("with Math.random directly (the real, non-seeded generator), still never exceeds radius 1", () => {
    for (let i = 0; i < 500; i++) {
      const [x, y, z] = randomPointStrictlyInsideUnitSphere(Math.random);
      expect(Math.sqrt(x * x + y * y + z * z)).toBeLessThanOrEqual(1);
    }
  });
});

describe("buildMistyCloudGroup / buildAssociationGroup / buildClusterGroup - direct unit coverage", () => {
  it("buildMistyCloudGroup is deterministic given the same seed (reload-stable rendering)", () => {
    const a = buildMistyCloudGroup([1, 2, 3], 10, 0xff6f9f, 7);
    const b = buildMistyCloudGroup([1, 2, 3], 10, 0xff6f9f, 7);
    expect(a.children.length).toBe(b.children.length);
    a.children.forEach((child, i) => {
      const other = b.children[i];
      expect((child as Sprite).position.x).toBeCloseTo((other as Sprite).position.x, 10);
      expect((child as Sprite).scale.x).toBeCloseTo((other as Sprite).scale.x, 10);
    });
  });

  it("buildMistyCloudGroup respects an explicit spriteCount override", () => {
    const group = buildMistyCloudGroup([0, 0, 0], 10, 0xff6f9f, 3, 4);
    expect(group.children).toHaveLength(4);
  });

  it("buildAssociationGroup respects an explicit sparkCount override", () => {
    const group = buildAssociationGroup([0, 0, 0], 20, 0xff9f6b, 3, 5);
    expect(group.children).toHaveLength(1 + 5);
  });

  it("buildClusterGroup respects an explicit starCount override", () => {
    const group = buildClusterGroup([0, 0, 0], 8, 3, 5);
    expect(group.children).toHaveLength(1 + 5);
  });

  it("different seeds produce different sprite scatter (not accidentally identical)", () => {
    const a = buildMistyCloudGroup([0, 0, 0], 10, 0xff6f9f, 1);
    const b = buildMistyCloudGroup([0, 0, 0], 10, 0xff6f9f, 999);
    const anyDifferent = a.children.some((child, i) => {
      const other = b.children[i] as Sprite;
      return Math.abs((child as Sprite).position.x - other.position.x) > 1e-9;
    });
    expect(anyDifferent).toBe(true);
  });
});

describe("getMistySpriteTexture", () => {
  it("returns null (rather than throwing) in this repo's DOM-less test environment", () => {
    expect(() => getMistySpriteTexture()).not.toThrow();
    expect(getMistySpriteTexture()).toBeNull();
  });

  it("is memoized - repeated calls return the same (null) reference without re-attempting canvas creation", () => {
    const first = getMistySpriteTexture();
    const second = getMistySpriteTexture();
    expect(first).toBe(second);
  });
});
