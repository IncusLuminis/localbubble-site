import { describe, expect, it } from "vitest";
import type { BufferAttribute } from "three";
import {
  buildRealworldStarLayer,
  disposeRealworldStarLayer,
  REALWORLD_BASE_SPRITE_PX,
  updateRealworldStarSizeScale,
  updateRealworldStarVisibility,
  visibleRealworldStarObjects,
} from "../src/scene/realworldStars";
import { absoluteMagnitudeToRealworldStyle } from "../src/scene/magnitudeBrightness";
import { spectralColorFor } from "../src/scene/spectralColor";
import type { SceneObject } from "../src/scene/sceneTypes";
import { Color } from "three";

/**
 * Issue #11 (Epic #7, Story 2/4): REALWORLD's own `THREE.Points`-based star
 * layer. Unlike `objects.ts`'s `InstancedMesh` buckets, geometry/attribute
 * construction here needs no real WebGL context - `THREE.BufferGeometry`/
 * `BufferAttribute`/`ShaderMaterial`/`Points` are plain data/math types,
 * constructible under this repo's `environment: "node"` Vitest suite (spec
 * §38), exactly like `objects.ts`'s own `InstancedMesh` tests. Only the
 * actual GPU texture upload (`starTwinkle.ts`'s canvas-drawn atlas) is
 * unavailable here - `getStarTwinkleAtlasTexture()` degrades to `null` under
 * Node (see that module's own docstring), which every consumer here already
 * treats as "no texture, just don't crash."
 */

function makeStar(overrides: Partial<SceneObject>): SceneObject {
  return {
    id: "test-star",
    name: "Test Star",
    aliases: [],
    object_type: "star",
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

const BRIGHT_STAR = makeStar({
  id: "bright-star",
  position_pc: [1, 2, 3],
  spectral_type: "B2V",
  absolute_magnitude: -7,
});
const FAINT_STAR = makeStar({
  id: "faint-star",
  position_pc: [4, 5, 6],
  spectral_type: "M5V",
  absolute_magnitude: 18,
});

describe("buildRealworldStarLayer", () => {
  it("returns null for an empty star list", () => {
    expect(buildRealworldStarLayer([])).toBeNull();
  });

  it("builds one vertex per star, in the same order as the input", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR, FAINT_STAR]);
    expect(layer).not.toBeNull();
    expect(layer?.objects).toEqual([BRIGHT_STAR, FAINT_STAR]);
    const position = layer?.geometry.getAttribute("position") as BufferAttribute;
    expect(position.count).toBe(2);
    expect([position.getX(0), position.getY(0), position.getZ(0)]).toEqual([1, 2, 3]);
    expect([position.getX(1), position.getY(1), position.getZ(1)]).toEqual([4, 5, 6]);
  });

  it("bakes each star's own OBAFGKM color (spectralColor.ts, unmodified) into the per-vertex aColor attribute", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR]);
    const colorAttr = layer?.geometry.getAttribute("aColor") as BufferAttribute;
    const expected = new Color(spectralColorFor(BRIGHT_STAR.spectral_type));
    expect(colorAttr.getX(0)).toBeCloseTo(expected.r, 6);
    expect(colorAttr.getY(0)).toBeCloseTo(expected.g, 6);
    expect(colorAttr.getZ(0)).toBeCloseTo(expected.b, 6);
  });

  it("bakes REALWORLD's magnitude-driven size (REALWORLD_BASE_SPRITE_PX * sizeMultiplier) as the initial aSize/baseSizesPx", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR, FAINT_STAR]);
    const sizeAttr = layer?.geometry.getAttribute("aSize") as BufferAttribute;
    const brightStyle = absoluteMagnitudeToRealworldStyle(BRIGHT_STAR.absolute_magnitude);
    const faintStyle = absoluteMagnitudeToRealworldStyle(FAINT_STAR.absolute_magnitude);

    expect(sizeAttr.getX(0)).toBeCloseTo(REALWORLD_BASE_SPRITE_PX * brightStyle.sizeMultiplier, 6);
    expect(sizeAttr.getX(1)).toBeCloseTo(REALWORLD_BASE_SPRITE_PX * faintStyle.sizeMultiplier, 6);
    expect(layer?.baseSizesPx[0]).toBeCloseTo(REALWORLD_BASE_SPRITE_PX * brightStyle.sizeMultiplier, 6);
    expect(layer?.baseSizesPx[1]).toBeCloseTo(REALWORLD_BASE_SPRITE_PX * faintStyle.sizeMultiplier, 6);
  });

  it("gives an exceptionally bright star a dramatically bigger baked-in size than a faint one", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR, FAINT_STAR]);
    const sizeAttr = layer?.geometry.getAttribute("aSize") as BufferAttribute;
    expect(sizeAttr.getX(0)).toBeGreaterThan(sizeAttr.getX(1) * 5);
  });

  it("flags the brilliant-tier star's aVariant as 1 and the normal-tier star's as 0", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR, FAINT_STAR]);
    const variantAttr = layer?.geometry.getAttribute("aVariant") as BufferAttribute;
    expect(variantAttr.getX(0)).toBe(1); // mag -7 < -6: brilliant
    expect(variantAttr.getX(1)).toBe(0); // mag 18 >= 14: normal
  });

  it("does not crash without a real DOM (uMap uniform degrades to null, matching getMistySpriteTexture's own convention)", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR]);
    expect(layer?.material.uniforms.uMap.value).toBeNull();
  });
});

describe("updateRealworldStarVisibility", () => {
  it("zeroes aSize for a category-toggled-off star, restoring its baked-in size once toggled back on", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR])!;
    const sizeAttr = layer.geometry.getAttribute("aSize") as BufferAttribute;
    const baseSize = layer.baseSizesPx[0];

    updateRealworldStarVisibility(layer, new Map([["star", false]]), null);
    expect(sizeAttr.getX(0)).toBe(0);

    updateRealworldStarVisibility(layer, new Map([["star", true]]), null);
    expect(sizeAttr.getX(0)).toBeCloseTo(baseSize, 6);
  });

  it("zeroes aSize for a star filtered out by radius", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR])!; // distance_pc: 37.4
    const sizeAttr = layer.geometry.getAttribute("aSize") as BufferAttribute;

    updateRealworldStarVisibility(layer, new Map([["star", true]]), 10);
    expect(sizeAttr.getX(0)).toBe(0);

    updateRealworldStarVisibility(layer, new Map([["star", true]]), 100);
    expect(sizeAttr.getX(0)).toBeCloseTo(layer.baseSizesPx[0], 6);
  });

  it("only hides the star that actually fails the radius filter, leaving a nearer one untouched", () => {
    const near = makeStar({ id: "near", distance_pc: 5, position_pc: [1, 0, 0] });
    const far = makeStar({ id: "far", distance_pc: 500, position_pc: [500, 0, 0] });
    const layer = buildRealworldStarLayer([near, far])!;
    const sizeAttr = layer.geometry.getAttribute("aSize") as BufferAttribute;

    updateRealworldStarVisibility(layer, new Map([["star", true]]), 50);
    expect(sizeAttr.getX(0)).toBeGreaterThan(0);
    expect(sizeAttr.getX(1)).toBe(0);
  });
});

describe("updateRealworldStarSizeScale", () => {
  it("sets the uSizeScale uniform without touching any star's real position", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR])!;
    const position = layer.geometry.getAttribute("position") as BufferAttribute;
    const before = [position.getX(0), position.getY(0), position.getZ(0)];

    updateRealworldStarSizeScale(layer, 2.5);
    expect(layer.material.uniforms.uSizeScale.value).toBe(2.5);
    expect([position.getX(0), position.getY(0), position.getZ(0)]).toEqual(before);
  });
});

describe("visibleRealworldStarObjects", () => {
  it("agrees with updateRealworldStarVisibility about which stars are visible", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR, FAINT_STAR])!;
    const categoryVisibility = new Map([["star", true]]);
    expect(visibleRealworldStarObjects(layer, categoryVisibility, null)).toEqual([BRIGHT_STAR, FAINT_STAR]);
    expect(visibleRealworldStarObjects(layer, new Map([["star", false]]), null)).toEqual([]);
  });
});

describe("disposeRealworldStarLayer", () => {
  it("disposes geometry and material without throwing", () => {
    const layer = buildRealworldStarLayer([BRIGHT_STAR])!;
    expect(() => disposeRealworldStarLayer(layer)).not.toThrow();
  });
});
