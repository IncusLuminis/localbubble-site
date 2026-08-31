import { describe, expect, it } from "vitest";
import { Group, Line, LineBasicMaterial, LineDashedMaterial, Mesh } from "three";
import {
  createVelocityVectorsLayer,
  nextVelocityVectorsToggleOn,
  starsWithVelocityInSphere,
  velocityArrowLengthPc,
  velocityDirection,
  velocitySpeedKms,
  velocityVectorsVisible,
} from "../src/scene/velocityVectors";
import type { SceneObject, SceneVelocity } from "../src/scene/sceneTypes";

/**
 * Story #231: velocity-vector arrows for the RECONS-dense-batch sphere's
 * in-sphere stars, gated behind a toggle whose own enabled state depends on
 * the camera being inside that same sphere. Covers the pure geometry/
 * direction/length math, the in-sphere filtering, the toggle-state business
 * rule (issue #231 AC #3's "exiting the sphere forces the toggle off"), and
 * the layer construction itself (arrow count, tangential-only styling).
 */

function makeVelocity(overrides: Partial<SceneVelocity> = {}): SceneVelocity {
  return {
    vx_kms: 10,
    vy_kms: 0,
    vz_kms: 0,
    radial_velocity_known: true,
    source: { reference: "test fixture", url: null, catalog: null },
    ...overrides,
  };
}

function makeObject(overrides: Partial<SceneObject> = {}): SceneObject {
  return {
    id: "test-object",
    name: "Test Object",
    aliases: [],
    object_type: "star",
    position_pc: [1, 0, 0],
    distance_pc: 1,
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

describe("velocitySpeedKms", () => {
  it("computes the 3D magnitude of a velocity triple", () => {
    expect(velocitySpeedKms(3, 4, 0)).toBeCloseTo(5, 10);
    expect(velocitySpeedKms(0, 0, 0)).toBe(0);
  });

  it("matches Barnard's Star's real derived speed (~142 km/s, spot-checked against Story #230's PR)", () => {
    expect(velocitySpeedKms(-140.95084255119036, 5.138856219169754, 18.556319857067027)).toBeCloseTo(
      142.26,
      1,
    );
  });
});

describe("velocityDirection", () => {
  it("returns a unit vector along the input direction", () => {
    const dir = velocityDirection(3, 4, 0)!;
    expect(dir[0]).toBeCloseTo(0.6, 10);
    expect(dir[1]).toBeCloseTo(0.8, 10);
    expect(dir[2]).toBeCloseTo(0, 10);
    const mag = Math.sqrt(dir[0] ** 2 + dir[1] ** 2 + dir[2] ** 2);
    expect(mag).toBeCloseTo(1, 10);
  });

  it("returns null for a degenerate zero vector - no meaningful direction to draw", () => {
    expect(velocityDirection(0, 0, 0)).toBeNull();
  });
});

describe("velocityArrowLengthPc", () => {
  it("scales linearly with speed within the un-clamped middle range", () => {
    const short = velocityArrowLengthPc(40);
    const long = velocityArrowLengthPc(80);
    // Doubling speed should double the raw (pre-clamp) length, and both
    // fall within the clamp range at these speeds.
    expect(long).toBeCloseTo(short * 2, 5);
  });

  it("clamps to a minimum for very slow movers", () => {
    expect(velocityArrowLengthPc(0)).toBeGreaterThan(0);
    expect(velocityArrowLengthPc(1)).toBe(velocityArrowLengthPc(0.001));
  });

  it("clamps to a maximum for extreme speeds - protects against bad data outliers", () => {
    const atFastEnd = velocityArrowLengthPc(300);
    const wayOutlier = velocityArrowLengthPc(6825); // real V* EZ Aqr outlier in the dataset
    expect(wayOutlier).toBe(atFastEnd);
  });

  it("gives Barnard's Star (~142 km/s, a known fast mover) a visibly longer arrow than a slow mover (~13 km/s)", () => {
    const barnard = velocityArrowLengthPc(142.26);
    const slow = velocityArrowLengthPc(13);
    expect(barnard).toBeGreaterThan(slow * 1.5);
  });

  it("never returns a negative length for a negative/invalid input", () => {
    expect(velocityArrowLengthPc(-50)).toBe(velocityArrowLengthPc(0));
  });
});

describe("starsWithVelocityInSphere", () => {
  const IN_SPHERE = makeObject({
    id: "in-sphere",
    distance_pc: 5,
    velocity: makeVelocity(),
  });
  const NO_VELOCITY = makeObject({ id: "no-velocity", distance_pc: 3, velocity: null });
  // Defensive case: has a velocity block but its real distance exceeds the
  // sphere radius (shouldn't happen given Story #230's own scoping, but
  // Epic #229 explicitly asks for a real-distance check rather than trusting
  // upstream scoping alone).
  const OUT_OF_SPHERE_WITH_VELOCITY = makeObject({
    id: "out-of-sphere",
    distance_pc: 50,
    velocity: makeVelocity(),
  });

  it("includes only objects with a non-null velocity within the real sphere radius", () => {
    const result = starsWithVelocityInSphere(
      [IN_SPHERE, NO_VELOCITY, OUT_OF_SPHERE_WITH_VELOCITY],
      11.26,
    );
    expect(result.map((o) => o.id)).toEqual(["in-sphere"]);
  });

  it("skips the distance check entirely when the sphere radius is not yet known (0)", () => {
    const result = starsWithVelocityInSphere([IN_SPHERE, OUT_OF_SPHERE_WITH_VELOCITY], 0);
    expect(result.map((o) => o.id).sort()).toEqual(["in-sphere", "out-of-sphere"]);
  });
});

describe("createVelocityVectorsLayer", () => {
  it("builds one arrow group per in-sphere star with velocity data", () => {
    const objects = [
      makeObject({ id: "a", distance_pc: 2, velocity: makeVelocity() }),
      makeObject({ id: "b", distance_pc: 4, velocity: makeVelocity() }),
      makeObject({ id: "c", distance_pc: 4, velocity: null }),
    ];
    const layer = createVelocityVectorsLayer(objects, 11.26);
    expect(layer).toBeInstanceOf(Group);
    expect(layer.children).toHaveLength(2);
  });

  it("starts hidden - main.ts's sphere-gated toggle turns it on", () => {
    const layer = createVelocityVectorsLayer([], 11.26);
    expect(layer.visible).toBe(false);
  });

  it("anchors each arrow's shaft at the star's own position_pc", () => {
    const objects = [
      makeObject({
        id: "anchored",
        position_pc: [2.5, -1.5, 0.75],
        velocity: makeVelocity({ vx_kms: 1, vy_kms: 0, vz_kms: 0 }),
      }),
    ];
    const layer = createVelocityVectorsLayer(objects, 0);
    const arrowGroup = layer.children[0] as Group;
    const shaft = arrowGroup.children.find((c): c is Line => c instanceof Line)!;
    const position = shaft.geometry.getAttribute("position");
    expect(position.getX(0)).toBeCloseTo(2.5, 10);
    expect(position.getY(0)).toBeCloseTo(-1.5, 10);
    expect(position.getZ(0)).toBeCloseTo(0.75, 10);
  });

  it("renders a full 3D vector (radial_velocity_known: true) as a plain (non-dashed) solid line", () => {
    const objects = [
      makeObject({ id: "full", velocity: makeVelocity({ radial_velocity_known: true }) }),
    ];
    const layer = createVelocityVectorsLayer(objects, 0);
    const arrowGroup = layer.children[0] as Group;
    const shaft = arrowGroup.children.find((c): c is Line => c instanceof Line)!;
    expect(shaft.material).toBeInstanceOf(LineBasicMaterial);
    expect(shaft.material).not.toBeInstanceOf(LineDashedMaterial);
    // A cone arrowhead should also be present.
    expect(arrowGroup.children.some((c) => c instanceof Mesh)).toBe(true);
  });

  it("renders a tangential-only vector (radial_velocity_known: false) as a dashed line, visually distinguishable from a full 3D one", () => {
    const objects = [
      makeObject({ id: "tangential", velocity: makeVelocity({ radial_velocity_known: false }) }),
      makeObject({
        id: "full",
        distance_pc: 2,
        velocity: makeVelocity({ radial_velocity_known: true }),
      }),
    ];
    const layer = createVelocityVectorsLayer(objects, 0);
    const tangentialGroup = layer.children.find((c) => c.name === "velocity-vector-tangential") as Group;
    const fullGroup = layer.children.find((c) => c.name === "velocity-vector-full") as Group;
    const tangentialShaft = tangentialGroup.children.find((c): c is Line => c instanceof Line)!;
    const fullShaft = fullGroup.children.find((c): c is Line => c instanceof Line)!;

    expect(tangentialShaft.material).toBeInstanceOf(LineDashedMaterial);
    expect(fullShaft.material).not.toBeInstanceOf(LineDashedMaterial);

    const tangentialMaterial = tangentialShaft.material as LineDashedMaterial;
    const fullMaterial = fullShaft.material as LineBasicMaterial;
    // Distinct color AND distinct opacity - two independent visual cues,
    // not just one, per issue #231 AC #5.
    expect(tangentialMaterial.color.getHex()).not.toBe(fullMaterial.color.getHex());
    expect(tangentialMaterial.opacity).toBeLessThan(fullMaterial.opacity);
  });

  it("skips a star whose velocity is a degenerate zero vector rather than drawing a directionless arrow", () => {
    const objects = [
      makeObject({ id: "zero", velocity: makeVelocity({ vx_kms: 0, vy_kms: 0, vz_kms: 0 }) }),
    ];
    const layer = createVelocityVectorsLayer(objects, 0);
    expect(layer.children).toHaveLength(0);
  });
});

describe("nextVelocityVectorsToggleOn", () => {
  it("forces the toggle off when the camera has just left the sphere, regardless of prior state", () => {
    expect(nextVelocityVectorsToggleOn(true, false)).toBe(false);
    expect(nextVelocityVectorsToggleOn(false, false)).toBe(false);
  });

  it("leaves the toggle's own state untouched while inside the sphere", () => {
    expect(nextVelocityVectorsToggleOn(true, true)).toBe(true);
    expect(nextVelocityVectorsToggleOn(false, true)).toBe(false);
  });
});

describe("velocityVectorsVisible", () => {
  it("is visible only when the toggle is on AND the camera is inside the sphere", () => {
    expect(velocityVectorsVisible(true, true)).toBe(true);
    expect(velocityVectorsVisible(true, false)).toBe(false);
    expect(velocityVectorsVisible(false, true)).toBe(false);
    expect(velocityVectorsVisible(false, false)).toBe(false);
  });
});
