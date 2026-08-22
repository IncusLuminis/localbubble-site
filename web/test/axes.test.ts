import { describe, expect, it } from "vitest";
import { AxesHelper } from "three";
import { createAxes, galacticCenterLabelPosition } from "../src/scene/axes";

describe("createAxes", () => {
  it("returns an AxesHelper sized to the given extent", () => {
    const axes = createAxes(2000);
    expect(axes).toBeInstanceOf(AxesHelper);
    expect(axes.name).toBe("coordinate-axes");
  });
});

describe("galacticCenterLabelPosition", () => {
  it("places the label 300pc out along the +X axis (not at the axis's full extent) when sizePc is larger", () => {
    // At the app's real WORLD_EXTENT_PC (2000pc), placing the label at the
    // axis's full endpoint (2000,0,0) sits behind the default camera pose
    // (verified live - see axes.ts's own docstring), so a fixed, closer
    // distance is used instead.
    expect(galacticCenterLabelPosition(2000)).toEqual([300, 0, 0]);
    expect(galacticCenterLabelPosition(800)).toEqual([300, 0, 0]);
  });

  it("clamps to sizePc when the axis itself is shorter than the fixed label distance", () => {
    expect(galacticCenterLabelPosition(100)).toEqual([100, 0, 0]);
    expect(galacticCenterLabelPosition(1)).toEqual([1, 0, 0]);
  });

  it("always stays on the X axis (y=z=0)", () => {
    for (const sizePc of [1, 100, 300, 800, 2000]) {
      const [, y, z] = galacticCenterLabelPosition(sizePc);
      expect(y).toBe(0);
      expect(z).toBe(0);
    }
  });
});
