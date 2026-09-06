import { describe, expect, it } from "vitest";
import {
  CONSENT_DECISION_STORAGE_KEY,
  DEFAULT_PERSISTED_SETTINGS,
  loadConsentDecision,
  loadPersistedSettings,
  parsePersistedSettings,
  PERSISTED_SETTINGS_STORAGE_KEY,
  saveConsentDecision,
  savePersistedSettings,
} from "../src/ui/settingsPersistence";
import { DEFAULT_MARKER_OPACITY_TUNING } from "../src/scene/objects";
import { DEFAULT_REALWORLD_STAR_TUNING } from "../src/scene/realworldStars";
import { DEFAULT_BLOOM_TUNING } from "../src/ui/controls";

/**
 * Issue #19 (Epic #7): the unified, consent-gated persistence for every
 * Settings-panel control - see `settingsPersistence.ts`'s own docstring.
 * This repo's vitest config runs in a DOM-free `node` environment (see
 * `vite.config.ts`), so - same reasoning as `test/starRenderStyle.test.ts`,
 * whose old `loadStarRenderStyle`/`saveStarRenderStyle` tests this
 * supersedes - `loadPersistedSettings`/`savePersistedSettings`/
 * `loadConsentDecision`/`saveConsentDecision` are all written to take a
 * minimal `Storage`-shaped object as a parameter rather than reaching for a
 * global, specifically so they're directly testable here with a small fake.
 */

/** Same minimal in-memory fake as `test/starRenderStyle.test.ts`'s own -
 * only the `getItem`/`setItem` shape these functions actually depend on. */
function makeFakeStorage(initial: Record<string, string> = {}): {
  getItem: (key: string) => string | null;
  setItem: (key: string, value: string) => void;
  data: Record<string, string>;
} {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem: (key: string) => (key in data ? data[key] : null),
    setItem: (key: string, value: string) => {
      data[key] = value;
    },
  };
}

describe("DEFAULT_PERSISTED_SETTINGS", () => {
  it("matches every field's own pre-#19 hardcoded default", () => {
    expect(DEFAULT_PERSISTED_SETTINGS).toEqual({
      starRenderStyle: "MODEL",
      radiusPc: 800,
      sizeScale: 1,
      modelMarkerOpacityTuning: DEFAULT_MARKER_OPACITY_TUNING,
      bloomTuning: DEFAULT_BLOOM_TUNING,
      realworldStarTuning: DEFAULT_REALWORLD_STAR_TUNING,
    });
  });
});

describe("parsePersistedSettings", () => {
  it("returns all defaults for an empty object", () => {
    expect(parsePersistedSettings({})).toEqual(DEFAULT_PERSISTED_SETTINGS);
  });

  it("returns all defaults for null/undefined/a non-object", () => {
    expect(parsePersistedSettings(null)).toEqual(DEFAULT_PERSISTED_SETTINGS);
    expect(parsePersistedSettings(undefined)).toEqual(DEFAULT_PERSISTED_SETTINGS);
    expect(parsePersistedSettings("not an object")).toEqual(DEFAULT_PERSISTED_SETTINGS);
    expect(parsePersistedSettings(42)).toEqual(DEFAULT_PERSISTED_SETTINGS);
  });

  it("round-trips a fully-populated, valid blob unchanged", () => {
    const settings = {
      starRenderStyle: "VISUAL",
      radiusPc: 250,
      sizeScale: 2.1,
      modelMarkerOpacityTuning: { opaqueMarkerOpacity: 0.5, extendedStructureOpacity: 0.2 },
      bloomTuning: { strength: 2, radius: 0.6, threshold: 0.1 },
      realworldStarTuning: { ...DEFAULT_REALWORLD_STAR_TUNING, normalBoost: 4.5, intensity: 2.2 },
    };
    expect(parsePersistedSettings(settings)).toEqual(settings);
  });

  it("falls back to the default starRenderStyle for a corrupt/stale value, independent of every other field", () => {
    const result = parsePersistedSettings({ starRenderStyle: "not-a-real-style", radiusPc: 250 });
    expect(result.starRenderStyle).toBe(DEFAULT_PERSISTED_SETTINGS.starRenderStyle);
    expect(result.radiusPc).toBe(250);
  });

  it("falls back to the default radiusPc for a value outside RADIUS_PRESETS_PC", () => {
    expect(parsePersistedSettings({ radiusPc: 12345 }).radiusPc).toBe(DEFAULT_PERSISTED_SETTINGS.radiusPc);
    expect(parsePersistedSettings({ radiusPc: "800" }).radiusPc).toBe(DEFAULT_PERSISTED_SETTINGS.radiusPc);
  });

  it("falls back to the default sizeScale for a non-finite-number value", () => {
    expect(parsePersistedSettings({ sizeScale: "2" }).sizeScale).toBe(DEFAULT_PERSISTED_SETTINGS.sizeScale);
    expect(parsePersistedSettings({ sizeScale: Number.NaN }).sizeScale).toBe(DEFAULT_PERSISTED_SETTINGS.sizeScale);
    expect(parsePersistedSettings({ sizeScale: null }).sizeScale).toBe(DEFAULT_PERSISTED_SETTINGS.sizeScale);
  });

  it("falls back per-field within a nested tuning object rather than discarding the whole object", () => {
    const result = parsePersistedSettings({
      modelMarkerOpacityTuning: { opaqueMarkerOpacity: 0.4, extendedStructureOpacity: "garbage" },
    });
    expect(result.modelMarkerOpacityTuning).toEqual({
      opaqueMarkerOpacity: 0.4,
      extendedStructureOpacity: DEFAULT_MARKER_OPACITY_TUNING.extendedStructureOpacity,
    });
  });

  it("falls back to every default field for a missing/non-object nested tuning value", () => {
    expect(parsePersistedSettings({ bloomTuning: "not an object" }).bloomTuning).toEqual(DEFAULT_BLOOM_TUNING);
    expect(parsePersistedSettings({}).realworldStarTuning).toEqual(DEFAULT_REALWORLD_STAR_TUNING);
  });

  it("ignores unrecognized extra fields (a hypothetical future/older build's differently-shaped blob)", () => {
    expect(parsePersistedSettings({ someFutureField: true })).toEqual(DEFAULT_PERSISTED_SETTINGS);
  });
});

describe("loadPersistedSettings", () => {
  it("returns the defaults when storage is null (e.g. localStorage access itself threw)", () => {
    expect(loadPersistedSettings(null)).toEqual(DEFAULT_PERSISTED_SETTINGS);
  });

  it("returns the defaults when the key was never set", () => {
    expect(loadPersistedSettings(makeFakeStorage())).toEqual(DEFAULT_PERSISTED_SETTINGS);
  });

  it("returns the defaults (never throws) for a corrupt (non-JSON) stored value", () => {
    const storage = makeFakeStorage({ [PERSISTED_SETTINGS_STORAGE_KEY]: "{not valid json" });
    expect(loadPersistedSettings(storage)).toEqual(DEFAULT_PERSISTED_SETTINGS);
  });

  it("degrades to the defaults (never throws) when getItem itself throws", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("simulated private-browsing failure");
      },
    };
    expect(loadPersistedSettings(throwingStorage)).toEqual(DEFAULT_PERSISTED_SETTINGS);
  });

  it("returns a previously-saved value", () => {
    const storage = makeFakeStorage();
    const settings = { ...DEFAULT_PERSISTED_SETTINGS, radiusPc: 250, sizeScale: 1.5 };
    savePersistedSettings(settings, storage);
    expect(loadPersistedSettings(storage)).toEqual(settings);
  });
});

describe("savePersistedSettings", () => {
  it("does nothing (never throws) when storage is null", () => {
    expect(() => savePersistedSettings(DEFAULT_PERSISTED_SETTINGS, null)).not.toThrow();
  });

  it("writes the settings as JSON under PERSISTED_SETTINGS_STORAGE_KEY", () => {
    const storage = makeFakeStorage();
    savePersistedSettings(DEFAULT_PERSISTED_SETTINGS, storage);
    expect(JSON.parse(storage.data[PERSISTED_SETTINGS_STORAGE_KEY])).toEqual(DEFAULT_PERSISTED_SETTINGS);
  });

  it("never throws even when setItem itself throws (e.g. quota exceeded)", () => {
    const throwingStorage = {
      setItem: () => {
        throw new Error("simulated quota-exceeded failure");
      },
    };
    expect(() => savePersistedSettings(DEFAULT_PERSISTED_SETTINGS, throwingStorage)).not.toThrow();
  });
});

describe("loadConsentDecision", () => {
  it("returns 'undecided' when storage is null", () => {
    expect(loadConsentDecision(null)).toBe("undecided");
  });

  it("returns 'undecided' when the key was never set", () => {
    expect(loadConsentDecision(makeFakeStorage())).toBe("undecided");
  });

  it("returns the persisted 'accepted'/'declined' decision when present", () => {
    expect(loadConsentDecision(makeFakeStorage({ [CONSENT_DECISION_STORAGE_KEY]: "accepted" }))).toBe("accepted");
    expect(loadConsentDecision(makeFakeStorage({ [CONSENT_DECISION_STORAGE_KEY]: "declined" }))).toBe("declined");
  });

  it("degrades to 'undecided' for a corrupt/unrecognized stored value", () => {
    expect(loadConsentDecision(makeFakeStorage({ [CONSENT_DECISION_STORAGE_KEY]: "garbage" }))).toBe("undecided");
  });

  it("degrades to 'undecided' (never throws) when getItem itself throws", () => {
    const throwingStorage = {
      getItem: () => {
        throw new Error("simulated private-browsing failure");
      },
    };
    expect(loadConsentDecision(throwingStorage)).toBe("undecided");
  });
});

describe("saveConsentDecision", () => {
  it("does nothing (never throws) when storage is null", () => {
    expect(() => saveConsentDecision("accepted", null)).not.toThrow();
  });

  it("round-trips through loadConsentDecision", () => {
    const storage = makeFakeStorage();
    saveConsentDecision("accepted", storage);
    expect(loadConsentDecision(storage)).toBe("accepted");
    saveConsentDecision("declined", storage);
    expect(loadConsentDecision(storage)).toBe("declined");
  });

  it("never throws even when setItem itself throws", () => {
    const throwingStorage = {
      setItem: () => {
        throw new Error("simulated quota-exceeded failure");
      },
    };
    expect(() => saveConsentDecision("declined", throwingStorage)).not.toThrow();
  });
});
