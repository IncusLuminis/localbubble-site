import { describe, expect, it } from "vitest";
import {
  createCatalogObjectGroup,
  excludeDedicatedMarkerObjects,
  SUN_OBJECT_ID,
} from "../src/scene/objects";
import type { SceneObject } from "../src/scene/sceneTypes";

/**
 * Regression coverage for PR #79 review: the Sun was being drawn twice -
 * once via its dedicated marker (`scene/sun.ts`) and again as a generic
 * grey sphere from the catalog-object render loop, because `scene.json`'s
 * `objects` array legitimately includes the Sun itself (`id: "sun"`,
 * `object_type: "reference_point"`) as a real catalog entry. These tests
 * don't need a WebGL context - `THREE.Group`/`Mesh`/`Geometry`/`Material`
 * are plain data objects constructible under Node (spec §38).
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

const CLOUD_A = makeObject({ id: "cloud-a", position_pc: [100, 0, 0] });
const CLOUD_B = makeObject({ id: "cloud-b", position_pc: [0, 200, -10] });

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

describe("createCatalogObjectGroup", () => {
  it("does not create a mesh for the Sun (avoids double-rendering it)", () => {
    const group = createCatalogObjectGroup([SUN_ENTRY, CLOUD_A, CLOUD_B]);
    expect(group.children).toHaveLength(2);
    expect(group.children.some((child) => child.name === SUN_OBJECT_ID)).toBe(false);
    expect(group.children.map((child) => child.name).sort()).toEqual([
      "cloud-a",
      "cloud-b",
    ]);
  });

  it("places no mesh at the exact origin when only the Sun is at (0,0,0)", () => {
    const group = createCatalogObjectGroup([SUN_ENTRY, CLOUD_A]);
    const atOrigin = group.children.filter(
      (child) => child.position.x === 0 && child.position.y === 0 && child.position.z === 0,
    );
    expect(atOrigin).toHaveLength(0);
  });
});
