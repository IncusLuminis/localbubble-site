import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  assertIsScene,
  InvalidSceneError,
  loadScene,
  positionToVector3,
} from "../src/scene/sceneData";
import type { Scene } from "../src/scene/sceneTypes";

/**
 * Unit tests for the pure scene-loading/coordinate-mapping logic (spec
 * Idea.md §38, issue #64). No WebGL context is needed - `positionToVector3`
 * returns a plain `THREE.Vector3` math value, and `loadScene`/
 * `assertIsScene` only touch `fetch`/JSON, not the renderer.
 */

const VALID_SCENE: Scene = {
  metadata: { coordinate_system: "heliocentric_galactic_cartesian", distance_unit: "pc" },
  objects: [
    {
      id: "sun-test",
      name: "Test Object",
      aliases: [],
      object_type: "molecular_cloud",
      position_pc: [120.4, -35.2, -18.7],
      distance_pc: 125.8,
      distance_error_pc: 2.1,
      size_pc: 25.0,
      color_class: null,
      spectral_type: null,
      absolute_magnitude: null,
      apparent_magnitude: null,
      exoplanets: null,
      velocity: null,
      group: { primary: null, secondary: [] },
      source: { reference: "test fixture", url: null, catalog: null },
      notes: null,
    },
  ],
  structures: {},
};

describe("positionToVector3", () => {
  it("maps position_pc components onto Vector3 x/y/z with no reordering", () => {
    const v = positionToVector3([120.4, -35.2, -18.7]);
    expect(v.x).toBe(120.4);
    expect(v.y).toBe(-35.2);
    expect(v.z).toBe(-18.7);
  });

  it("does not rescale coordinates (identity mapping, spec §3/§45)", () => {
    const position: [number, number, number] = [1, 2, 3];
    const v = positionToVector3(position);
    expect([v.x, v.y, v.z]).toEqual(position);
  });

  it("preserves heliocentric distance (spec §37 'Distance Preservation')", () => {
    const position: [number, number, number] = [120.4, -35.2, -18.7];
    const expectedDistance = Math.sqrt(
      position[0] ** 2 + position[1] ** 2 + position[2] ** 2,
    );
    const v = positionToVector3(position);
    expect(v.length()).toBeCloseTo(expectedDistance, 9);
  });

  it("maps the Sun's origin position to the zero vector", () => {
    const v = positionToVector3([0, 0, 0]);
    expect(v.x).toBe(0);
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
  });
});

describe("assertIsScene", () => {
  it("accepts a well-formed scene", () => {
    expect(() => assertIsScene(VALID_SCENE)).not.toThrow();
  });

  it("rejects a non-object payload", () => {
    expect(() => assertIsScene(null)).toThrow(InvalidSceneError);
    expect(() => assertIsScene("scene")).toThrow(InvalidSceneError);
  });

  it("rejects a payload missing 'objects'", () => {
    const { objects: _objects, ...withoutObjects } = VALID_SCENE;
    expect(() => assertIsScene(withoutObjects)).toThrow(InvalidSceneError);
  });

  it("rejects a payload missing 'metadata'", () => {
    const { metadata: _metadata, ...withoutMetadata } = VALID_SCENE;
    expect(() => assertIsScene(withoutMetadata)).toThrow(InvalidSceneError);
  });

  it("rejects an object with a malformed position_pc", () => {
    const broken: unknown = {
      ...VALID_SCENE,
      objects: [{ ...VALID_SCENE.objects[0], position_pc: [1, 2] }],
    };
    expect(() => assertIsScene(broken)).toThrow(InvalidSceneError);
  });
});

describe("loadScene", () => {
  const originalFetch = globalThis.fetch;

  beforeEach(() => {
    globalThis.fetch = vi.fn();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("fetches, parses, and validates a scene", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => VALID_SCENE,
    });
    const scene = await loadScene("/data/scene.json");
    expect(scene.objects).toHaveLength(1);
    expect(scene.objects[0]?.position_pc).toEqual([120.4, -35.2, -18.7]);
  });

  it("throws InvalidSceneError on a non-ok response", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: false,
      status: 404,
      statusText: "Not Found",
      json: async () => ({}),
    });
    await expect(loadScene("/data/missing.json")).rejects.toThrow(InvalidSceneError);
  });

  it("throws InvalidSceneError on a malformed payload", async () => {
    (globalThis.fetch as ReturnType<typeof vi.fn>).mockResolvedValue({
      ok: true,
      json: async () => ({ not: "a scene" }),
    });
    await expect(loadScene("/data/scene.json")).rejects.toThrow(InvalidSceneError);
  });
});
