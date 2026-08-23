import { describe, expect, it } from "vitest";
import {
  formatAbsoluteMagnitude,
  formatDistance,
  formatExoplanets,
  formatSpectralType,
  formatVisualMagnitude,
} from "../src/ui/inspector";
import type { SceneExoplanetSummary, ScenePlanetSummary } from "../src/scene/sceneTypes";

/**
 * Issue #172: the Inspector's new star-only rows (spectral type, absolute
 * magnitude, exoplanets). As `infoDialog.test.ts` notes, `vitest.config.ts`
 * runs with `environment: "node"`, so `Inspector` itself (which builds real
 * DOM via `document.createElement`) can't be exercised here - these tests
 * cover the exported pure formatting functions `Inspector.show()` uses,
 * which carry all of this Story's actual display logic/decisions.
 */

describe("formatDistance", () => {
  it("shows a bare figure when there is no error bar", () => {
    expect(formatDistance({ distance_pc: 6.0, distance_error_pc: null })).toBe("6.0 pc");
  });

  it("shows the error bar when present", () => {
    expect(formatDistance({ distance_pc: 37.42, distance_error_pc: 0.26 })).toBe(
      "37.4 ± 0.3 pc",
    );
  });
});

describe("formatSpectralType", () => {
  it("returns the raw SIMBAD string verbatim", () => {
    expect(formatSpectralType("K3II-III")).toBe("K3II-III");
    expect(formatSpectralType("M5.5Ve")).toBe("M5.5Ve");
  });

  it("falls back to 'Unknown' for null (not 'null'/blank)", () => {
    expect(formatSpectralType(null)).toBe("Unknown");
  });
});

describe("formatAbsoluteMagnitude", () => {
  it("formats to one decimal place with a brief label", () => {
    expect(formatAbsoluteMagnitude(-3.165630667)).toBe("M = -3.2");
    expect(formatAbsoluteMagnitude(4.83)).toBe("M = 4.8");
  });

  it("falls back to 'Unknown' for null (not 'null'/blank)", () => {
    expect(formatAbsoluteMagnitude(null)).toBe("Unknown");
  });
});

describe("formatVisualMagnitude", () => {
  it("formats to one decimal place with a brief 'V =' label", () => {
    expect(formatVisualMagnitude(1.64)).toBe("V = 1.6");
    expect(formatVisualMagnitude(-1.46)).toBe("V = -1.5");
  });

  it("falls back to 'Unknown' for null (not 'null'/blank)", () => {
    expect(formatVisualMagnitude(null)).toBe("Unknown");
  });
});

function makePlanet(overrides: Partial<ScenePlanetSummary> = {}): ScenePlanetSummary {
  return {
    name: "Test b",
    orbital_period_days: null,
    minimum_mass_earth: null,
    radius_earth: null,
    discovery_method: null,
    discovery_year: null,
    discovery_facility: null,
    semi_major_axis_au: null,
    orbital_eccentricity: null,
    ...overrides,
  };
}

function makeExoplanets(planets: ScenePlanetSummary[], countOverride?: number): SceneExoplanetSummary {
  return {
    count: countOverride ?? planets.length,
    planets,
    source_reference: "test source",
    source_url: null,
  };
}

describe("formatExoplanets", () => {
  it("returns null (omit the row) when there is no exoplanets block", () => {
    expect(formatExoplanets(null)).toBeNull();
  });

  it("returns null (omit the row) when count is 0", () => {
    expect(formatExoplanets(makeExoplanets([], 0))).toBeNull();
  });

  it("returns null (omit the row) when the planets list is empty even if count is nonzero", () => {
    expect(formatExoplanets(makeExoplanets([], 3))).toBeNull();
  });

  it("shows the count and each planet's name with orbital period, for a two-planet system (HD 81817)", () => {
    const exoplanets = makeExoplanets([
      makePlanet({ name: "HD 81817 b", orbital_period_days: 1021.20159 }),
      makePlanet({ name: "HD 81817 c", orbital_period_days: 622.97802 }),
    ]);
    expect(formatExoplanets(exoplanets)).toBe(
      "2 known: HD 81817 b (1021.2 d), HD 81817 c (623.0 d)",
    );
  });

  it("omits the orbital period for a single planet when it is null, but still lists the name", () => {
    const exoplanets = makeExoplanets([makePlanet({ name: "Lonely b", orbital_period_days: null })]);
    expect(formatExoplanets(exoplanets)).toBe("1 known: Lonely b");
  });
});
