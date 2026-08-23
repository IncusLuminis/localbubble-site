import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_ORBIT_RADIUS_PX,
  DEFAULT_MIN_ORBIT_RADIUS_PX,
  buildOrbitLayout,
  formatOrbitLabel,
  orbitRadiusPx,
  planetDesignation,
} from "../src/ui/orbitDiagram";
import type { ScenePlanetSummary, SceneExoplanetSummary } from "../src/scene/sceneTypes";

/**
 * Story #182: unit tests for the orbit diagram's pure geometry/formatting
 * logic. `createOrbitDiagramElement` itself builds real SVG/DOM and isn't
 * covered here - `vitest.config.ts` runs with `environment: "node"`, same
 * constraint as `ui/inspector.ts`'s own `Inspector` class (see
 * `test/inspector.test.ts`'s docstring).
 */

describe("orbitRadiusPx", () => {
  it("maps the min/max AU bounds to the min/max radius bounds", () => {
    expect(orbitRadiusPx(0.02, 0.02, 0.33)).toBeCloseTo(DEFAULT_MIN_ORBIT_RADIUS_PX, 5);
    expect(orbitRadiusPx(0.33, 0.02, 0.33)).toBeCloseTo(DEFAULT_MAX_ORBIT_RADIUS_PX, 5);
  });

  it("is monotonically increasing with semi-major axis (log scale, not linear collapse)", () => {
    // GJ 876's actual planets: d, c, b, e (ascending AU).
    const d = orbitRadiusPx(0.0208, 0.0208, 0.3343);
    const c = orbitRadiusPx(0.12959, 0.0208, 0.3343);
    const b = orbitRadiusPx(0.208317, 0.0208, 0.3343);
    const e = orbitRadiusPx(0.3343, 0.0208, 0.3343);
    expect(d).toBeLessThan(c);
    expect(c).toBeLessThan(b);
    expect(b).toBeLessThan(e);
  });

  it("uses a log (not linear) scale - the midpoint AU maps well past the midpoint radius", () => {
    // Linear scale would put the geometric midpoint of [0.01, 1] (~0.5 AU)
    // near radius 54 (halfway from 16 to 92); log scale puts it much
    // closer to the outer edge, since log10(0.5) is most of the way from
    // log10(0.01)=-2 to log10(1)=0.
    const radius = orbitRadiusPx(0.5, 0.01, 1);
    const linearMidpoint = (DEFAULT_MIN_ORBIT_RADIUS_PX + DEFAULT_MAX_ORBIT_RADIUS_PX) / 2;
    expect(radius).toBeGreaterThan(linearMidpoint);
  });

  it("clamps values outside [minAu, maxAu]", () => {
    expect(orbitRadiusPx(0.001, 0.02, 0.33)).toBeCloseTo(DEFAULT_MIN_ORBIT_RADIUS_PX, 5);
    expect(orbitRadiusPx(10, 0.02, 0.33)).toBeCloseTo(DEFAULT_MAX_ORBIT_RADIUS_PX, 5);
  });

  it("places a single/degenerate value (minAu === maxAu) at the outer radius rather than dividing by zero", () => {
    expect(orbitRadiusPx(0.048, 0.048, 0.048)).toBe(DEFAULT_MAX_ORBIT_RADIUS_PX);
  });

  it("respects custom radius bounds", () => {
    expect(orbitRadiusPx(0.1, 0.01, 1, 10, 50)).toBeCloseTo(30, 5);
  });
});

describe("planetDesignation", () => {
  it("extracts the trailing lowercase-letter designation from real catalog names", () => {
    expect(planetDesignation("GJ 876 b")).toBe("b");
    expect(planetDesignation("GJ 876 c")).toBe("c");
    expect(planetDesignation("Barnard d")).toBe("d");
    expect(planetDesignation("Proxima Cen d")).toBe("d");
    expect(planetDesignation("GJ 1002 b")).toBe("b");
  });

  it("falls back to the full name when the trailing token isn't a lowercase designation", () => {
    expect(planetDesignation("KOI-4878")).toBe("KOI-4878");
    expect(planetDesignation("TOI 1234")).toBe("TOI 1234");
  });
});

describe("formatOrbitLabel", () => {
  function makePlanet(overrides: Partial<ScenePlanetSummary> = {}): ScenePlanetSummary {
    return {
      name: "GJ 876 b",
      orbital_period_days: 61.1166,
      minimum_mass_earth: null,
      radius_earth: null,
      discovery_method: null,
      discovery_year: null,
      discovery_facility: null,
      semi_major_axis_au: 0.208317,
      orbital_eccentricity: 0.0324,
      ...overrides,
    };
  }

  it('formats "<designation> · <period> d"', () => {
    expect(formatOrbitLabel(makePlanet())).toBe("b · 61.1 d");
  });

  it("omits the period when null, keeping just the designation", () => {
    expect(formatOrbitLabel(makePlanet({ orbital_period_days: null }))).toBe("b");
  });
});

describe("buildOrbitLayout", () => {
  function makePlanet(overrides: Partial<ScenePlanetSummary> = {}): ScenePlanetSummary {
    return {
      name: "Test b",
      orbital_period_days: 10,
      minimum_mass_earth: null,
      radius_earth: null,
      discovery_method: null,
      discovery_year: null,
      discovery_facility: null,
      semi_major_axis_au: 0.1,
      orbital_eccentricity: null,
      ...overrides,
    };
  }

  function makeExoplanets(planets: ScenePlanetSummary[]): SceneExoplanetSummary {
    return { count: planets.length, planets, source_reference: "test", source_url: null };
  }

  it("returns null when no planets have a semi-major axis", () => {
    const exoplanets = makeExoplanets([
      makePlanet({ name: "No Orbit b", semi_major_axis_au: null }),
    ]);
    expect(buildOrbitLayout(exoplanets)).toBeNull();
  });

  it("orders planets innermost-first by semi_major_axis_au", () => {
    const exoplanets = makeExoplanets([
      makePlanet({ name: "GJ 876 e", semi_major_axis_au: 0.3343 }),
      makePlanet({ name: "GJ 876 d", semi_major_axis_au: 0.0208 }),
      makePlanet({ name: "GJ 876 c", semi_major_axis_au: 0.12959 }),
      makePlanet({ name: "GJ 876 b", semi_major_axis_au: 0.208317 }),
    ]);
    const layout = buildOrbitLayout(exoplanets);
    expect(layout?.orbits.map((o) => o.planet.name)).toEqual([
      "GJ 876 d",
      "GJ 876 c",
      "GJ 876 b",
      "GJ 876 e",
    ]);
  });

  it("reports totalCount from exoplanets.count even when some planets are omitted for lacking an axis", () => {
    const exoplanets = makeExoplanets([
      makePlanet({ name: "Has Orbit b", semi_major_axis_au: 0.05 }),
      makePlanet({ name: "No Orbit c", semi_major_axis_au: null }),
    ]);
    const layout = buildOrbitLayout(exoplanets);
    expect(layout?.orbits).toHaveLength(1);
    expect(layout?.totalCount).toBe(2);
  });

  it("draws a plain circle (ryPx null) when eccentricity is null or near-zero", () => {
    const exoplanets = makeExoplanets([
      makePlanet({ orbital_eccentricity: null }),
      makePlanet({ name: "Test c", semi_major_axis_au: 0.2, orbital_eccentricity: 0.01 }),
    ]);
    const layout = buildOrbitLayout(exoplanets);
    expect(layout?.orbits.every((o) => o.ryPx === null)).toBe(true);
  });

  it("draws an ellipse (ryPx < rxPx) when eccentricity is meaningfully nonzero", () => {
    const exoplanets = makeExoplanets([makePlanet({ orbital_eccentricity: 0.25591 })]);
    const layout = buildOrbitLayout(exoplanets);
    const orbit = layout?.orbits[0];
    expect(orbit?.ryPx).not.toBeNull();
    expect(orbit?.ryPx as number).toBeLessThan(orbit!.rxPx);
    // ry = rx * sqrt(1 - e^2)
    expect(orbit?.ryPx).toBeCloseTo(orbit!.rxPx * Math.sqrt(1 - 0.25591 ** 2), 5);
  });

  it("includes a compact label for each positioned planet", () => {
    const exoplanets = makeExoplanets([makePlanet({ name: "GJ 876 b", orbital_period_days: 61.1166 })]);
    const layout = buildOrbitLayout(exoplanets);
    expect(layout?.orbits[0].label).toBe("b · 61.1 d");
  });
});
