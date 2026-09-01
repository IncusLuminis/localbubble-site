import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatAbsoluteMagnitude,
  formatDistance,
  formatExoplanets,
  formatSpectralType,
  formatVisualMagnitude,
  Inspector,
} from "../src/ui/inspector";
import type { SceneExoplanetSummary, ScenePlanetSummary } from "../src/scene/sceneTypes";

/**
 * Issue #172: the Inspector's new star-only rows (spectral type, absolute
 * magnitude, exoplanets). As `infoDialog.test.ts` notes, `vitest.config.ts`
 * runs with `environment: "node"`, so `Inspector` itself (which builds real
 * DOM via `document.createElement`) can't be exercised here for its full
 * `show()` behavior (which also reaches into `ui/skyView.ts`/
 * `ui/orbitDiagram.ts`) - these tests cover the exported pure formatting
 * functions `Inspector.show()` uses, which carry all of this Story's actual
 * display logic/decisions.
 *
 * Issue #98's regression test below is a narrow exception: it only needs
 * the constructor and the close button, not `show()`, so a minimal
 * hand-rolled DOM stub (`FakeElement`/`FakeDocument` - just enough surface
 * for `createElement`/`appendChild`/`addEventListener`/`style`/etc., no
 * jsdom dependency) is enough to exercise the real close-button wiring
 * end-to-end and catch a regression of this exact bug.
 */

class FakeElement {
  readonly tag: string;
  readonly children: FakeElement[] = [];
  readonly style: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  private readonly listeners = new Map<string, Array<() => void>>();
  className = "";
  id = "";
  textContent = "";
  type = "";

  constructor(tag: string) {
    this.tag = tag;
  }

  appendChild(child: FakeElement): void {
    this.children.push(child);
  }

  setAttribute(name: string, value: string): void {
    this.attributes[name] = value;
  }

  addEventListener(event: string, handler: () => void): void {
    const existing = this.listeners.get(event) ?? [];
    existing.push(handler);
    this.listeners.set(event, existing);
  }

  dispatch(event: string): void {
    for (const handler of this.listeners.get(event) ?? []) handler();
  }

  /** Depth-first search for a descendant by className, used below to find
   * the close button without relying on child-index ordering. */
  findByClassName(name: string): FakeElement | null {
    for (const child of this.children) {
      if (child.className === name) return child;
      const found = child.findByClassName(name);
      if (found) return found;
    }
    return null;
  }
}

function withFakeDocument<T>(run: () => T): T {
  const previous = (globalThis as { document?: unknown }).document;
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => new FakeElement(tag),
  };
  try {
    return run();
  } finally {
    (globalThis as { document?: unknown }).document = previous;
  }
}

describe("Inspector close button (issue #98)", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls onClose (in addition to hiding itself) when the × button is clicked", () => {
    withFakeDocument(() => {
      const onClose = vi.fn();
      const inspector = new Inspector(onClose);
      const element = inspector.element as unknown as FakeElement;

      const closeButton = element.findByClassName("inspector-close");
      expect(closeButton).not.toBeNull();

      closeButton!.dispatch("click");

      expect(onClose).toHaveBeenCalledTimes(1);
      expect(element.style.display).toBe("none");
    });
  });

  it("does not throw when constructed without an onClose callback, and clicking × is a no-op beyond hiding", () => {
    withFakeDocument(() => {
      const inspector = new Inspector();
      const element = inspector.element as unknown as FakeElement;
      const closeButton = element.findByClassName("inspector-close");

      expect(() => closeButton!.dispatch("click")).not.toThrow();
      expect(element.style.display).toBe("none");
    });
  });
});

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
