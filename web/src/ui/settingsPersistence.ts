import {
  DEFAULT_STAR_RENDER_STYLE,
  parseStarRenderStyle,
  type StarRenderStyle,
} from "../scene/starRenderStyle";
import { DEFAULT_RADIUS_PC, RADIUS_PRESETS_PC } from "../scene/radiusFilter";
import { DEFAULT_MARKER_OPACITY_TUNING, type MarkerOpacityTuning } from "../scene/objects";
import { DEFAULT_REALWORLD_STAR_TUNING, type RealworldStarTuning } from "../scene/realworldStars";
import { DEFAULT_BLOOM_TUNING, type BloomTuning } from "./controls";

/**
 * Issue #19 (Epic #7): cookie-consent gate + the unified, consent-gated
 * persistence for every Settings-panel control - Star Rendering style
 * (folded in from issue #10's originally separate, ungated
 * `scene/starRenderStyle.ts` mechanism - see that file's own docstring),
 * Radius, Object size, MODEL's marker/diffuse-structure opacity, and
 * VISUAL's bloom/star/spike/distance tuning. One JSON blob under one
 * `localStorage` key, rather than one key per control, so a returning
 * visitor's whole configuration loads/saves as a single read/write.
 *
 * `loadPersistedSettings`/`savePersistedSettings` mirror
 * `scene/starRenderStyle.ts`'s old `Pick<Storage, "getItem"|"setItem">` /
 * try-catch / graceful-degradation conventions exactly - `getItem`/`setItem`
 * can throw in some restrictive browser privacy configurations, and a
 * missing/corrupt/stale blob (or an individual field within an otherwise
 * valid one) degrades to `DEFAULT_PERSISTED_SETTINGS` rather than breaking
 * scene load. Never called at all unless the caller (`main.ts`) has already
 * confirmed consent was accepted - see `loadConsentDecision`/
 * `saveConsentDecision` below for the one thing that's always safe to
 * read/write regardless of consent.
 */

export interface PersistedSettings {
  starRenderStyle: StarRenderStyle;
  radiusPc: number;
  sizeScale: number;
  modelMarkerOpacityTuning: MarkerOpacityTuning;
  bloomTuning: BloomTuning;
  realworldStarTuning: RealworldStarTuning;
}

/** What every fresh (or consent-declined/undecided) session starts from -
 * exactly today's pre-#19 hardcoded defaults for every field, gathered from
 * whichever module already owns each one as its own single source of truth,
 * rather than re-hardcoding any of them a second time here. */
export const DEFAULT_PERSISTED_SETTINGS: PersistedSettings = {
  starRenderStyle: DEFAULT_STAR_RENDER_STYLE,
  radiusPc: DEFAULT_RADIUS_PC,
  sizeScale: 1, // `ui/controls.ts`'s "Object size" slider's own pre-#19 hardcoded default.
  modelMarkerOpacityTuning: { ...DEFAULT_MARKER_OPACITY_TUNING },
  bloomTuning: { ...DEFAULT_BLOOM_TUNING },
  realworldStarTuning: { ...DEFAULT_REALWORLD_STAR_TUNING },
};

export const PERSISTED_SETTINGS_STORAGE_KEY = "lb-persisted-settings";

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

/** Merges `raw`'s own fields onto `defaults` field-by-field, keeping only
 * the ones that are finite numbers - covers `bloomTuning`/
 * `realworldStarTuning`/`modelMarkerOpacityTuning`, whose every field is
 * itself just a plain number, without hand-listing each field name in both
 * this function and its caller. A missing/corrupt/wrong-type field falls
 * back to that one field's own default rather than discarding the whole
 * nested object, per this module's per-field graceful-degradation
 * philosophy (`scene/starRenderStyle.ts`'s `parseStarRenderStyle` does the
 * same for its own single-field case). */
function numericObjectOr<T extends object>(raw: unknown, defaults: T): T {
  const result: Record<string, number> = { ...(defaults as unknown as Record<string, number>) };
  if (raw && typeof raw === "object") {
    for (const key of Object.keys(defaults)) {
      const value = (raw as Record<string, unknown>)[key];
      if (isFiniteNumber(value)) {
        result[key] = value;
      }
    }
  }
  return result as unknown as T;
}

/** Validates a raw parsed-JSON value (typically straight off
 * `JSON.parse(storage.getItem(...))`) against `PersistedSettings`' shape,
 * falling back to `DEFAULT_PERSISTED_SETTINGS` per-field for anything
 * missing, corrupt, or from a differently-shaped blob (an older/future
 * build, or hand-edited storage) - never throws. Exported and pure so it's
 * directly unit-testable without any real or fake `Storage` at all, same
 * reasoning as `parseStarRenderStyle`. */
export function parsePersistedSettings(raw: unknown): PersistedSettings {
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    starRenderStyle: parseStarRenderStyle(typeof value.starRenderStyle === "string" ? value.starRenderStyle : null),
    radiusPc:
      isFiniteNumber(value.radiusPc) && (RADIUS_PRESETS_PC as readonly number[]).includes(value.radiusPc)
        ? value.radiusPc
        : DEFAULT_PERSISTED_SETTINGS.radiusPc,
    sizeScale: isFiniteNumber(value.sizeScale) ? value.sizeScale : DEFAULT_PERSISTED_SETTINGS.sizeScale,
    modelMarkerOpacityTuning: numericObjectOr(value.modelMarkerOpacityTuning, DEFAULT_MARKER_OPACITY_TUNING),
    bloomTuning: numericObjectOr(value.bloomTuning, DEFAULT_BLOOM_TUNING),
    realworldStarTuning: numericObjectOr(value.realworldStarTuning, DEFAULT_REALWORLD_STAR_TUNING),
  };
}

/** Reads the persisted settings blob from `storage` (real callers pass
 * `window.localStorage`, or `null` when even accessing that property isn't
 * safe - see `main.ts`'s `browserLocalStorage`; tests pass a minimal fake
 * implementing just `getItem`). The caller is responsible for only calling
 * this when consent has actually been accepted - this function itself has
 * no opinion on consent, same division of responsibility as
 * `scene/starRenderStyle.ts`'s old `loadStarRenderStyle` had between "can
 * this be read" (its own concern) and "should it be read" (the caller's). */
export function loadPersistedSettings(storage: Pick<Storage, "getItem"> | null): PersistedSettings {
  if (!storage) {
    return DEFAULT_PERSISTED_SETTINGS;
  }
  try {
    const raw = storage.getItem(PERSISTED_SETTINGS_STORAGE_KEY);
    if (raw === null) {
      return DEFAULT_PERSISTED_SETTINGS;
    }
    return parsePersistedSettings(JSON.parse(raw));
  } catch {
    // Covers both a thrown `getItem` (private-browsing configs) and a
    // `JSON.parse` failure on a corrupt/hand-edited value.
    return DEFAULT_PERSISTED_SETTINGS;
  }
}

/** Persists `settings` to `storage` as one JSON blob (or does nothing if
 * `storage` is `null`). Same defensive `try/catch` as `loadPersistedSettings`
 * - a failed write (quota exceeded, private browsing, etc.) should never
 * break the live control it's backing; the value simply won't survive a
 * reload in that case. Like `loadPersistedSettings`, has no opinion on
 * consent - the caller only calls this once consent is accepted. */
export function savePersistedSettings(settings: PersistedSettings, storage: Pick<Storage, "setItem"> | null): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(PERSISTED_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore - see docstring above.
  }
}

// --- Cookie-consent decision itself: independent of whether the user has
// actually changed any settings yet. Recording "the user already answered"
// is the one non-consent-requiring mechanism a consent banner needs in
// order to not re-prompt on every page load - it's not itself subject to
// consent (see `ui/cookieConsentBanner.ts`'s own docstring). ---

export type ConsentDecision = "accepted" | "declined" | "undecided";

export const CONSENT_DECISION_STORAGE_KEY = "lb-cookie-consent";

function parseConsentDecision(value: string | null): ConsentDecision {
  return value === "accepted" || value === "declined" ? value : "undecided";
}

/** Same shape/graceful-degradation conventions as `loadPersistedSettings`
 * above, but always safe to call regardless of consent - this IS the
 * mechanism that determines whether consent was ever given. */
export function loadConsentDecision(storage: Pick<Storage, "getItem"> | null): ConsentDecision {
  if (!storage) {
    return "undecided";
  }
  try {
    return parseConsentDecision(storage.getItem(CONSENT_DECISION_STORAGE_KEY));
  } catch {
    return "undecided";
  }
}

export function saveConsentDecision(decision: ConsentDecision, storage: Pick<Storage, "setItem"> | null): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(CONSENT_DECISION_STORAGE_KEY, decision);
  } catch {
    // Ignore - see loadPersistedSettings/savePersistedSettings docstrings.
  }
}
