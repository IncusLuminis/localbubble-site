/**
 * Issue #10 (Epic #7, Story 1/4): the MODEL vs REALWORLD star-rendering
 * style's type, default, and persisted-choice plumbing.
 *
 * Kept in `scene/` (not `ui/`) because `StarRenderStyle` is a scene-rendering
 * concept - `scene/objects.ts`'s star-bucket construction dispatches on it
 * directly (`buildStarCatalogBucket`) - even though the only callers of the
 * load/save functions below are `main.ts` (reads/writes `localStorage`) and
 * `ui/controls.ts` (imports the type + `STAR_RENDER_STYLES` for its new
 * Settings-panel control). This mirrors `ui/controls.ts`'s existing
 * convention of importing scene-owned constants directly (see its
 * `RADIUS_PRESETS_PC`/`DEFAULT_RADIUS_PC` import from `scene/radiusFilter`).
 *
 * `MODEL` is today's exact, unchanged star-rendering code path - issue #10's
 * own explicit requirement was that that Story must not alter `MODEL`'s
 * behavior/appearance/performance in any way, and issue #11 (Epic #7, Story
 * 2/4) preserves that constraint. `REALWORLD` was, for issue #10 only, a stub
 * alias of `MODEL`; issue #11 replaced that stub with its own real
 * `THREE.Points`-based twinkle-sprite/magnitude-driven-size system (see
 * `scene/realworldStars.ts`).
 */
export type StarRenderStyle = "MODEL" | "REALWORLD";

export const DEFAULT_STAR_RENDER_STYLE: StarRenderStyle = "MODEL";

/** The complete, ordered set of valid `StarRenderStyle` values - single
 * source of truth for `parseStarRenderStyle`'s validation below AND for
 * `ui/controls.ts`'s Settings-panel `<select>` options, so the two can never
 * silently drift apart (e.g. a third style added to the type but forgotten
 * in one of the two places). */
export const STAR_RENDER_STYLES: readonly StarRenderStyle[] = ["MODEL", "REALWORLD"];

/** `localStorage` key for the persisted choice. Namespaced with an `lb-`
 * prefix: a repo-wide search turned up no prior `localStorage` usage
 * anywhere in this app, so there's no existing key-naming convention to
 * match yet - this establishes one plain, clearly-named key rather than
 * inventing a broader scheme this one Story has no need for. */
export const STAR_RENDER_STYLE_STORAGE_KEY = "lb-star-render-style";

/** Validates a raw value (typically straight off `localStorage.getItem`,
 * hence `string | null` - `null` when the key was never set) against
 * `STAR_RENDER_STYLES`, falling back to `DEFAULT_STAR_RENDER_STYLE` for
 * anything else (missing, hand-edited, or a stale value from some future
 * style this build doesn't know about). Never throws. Exported and pure so
 * it's directly unit-testable without any real or fake `Storage` at all. */
export function parseStarRenderStyle(value: string | null): StarRenderStyle {
  return (STAR_RENDER_STYLES as readonly string[]).includes(value ?? "")
    ? (value as StarRenderStyle)
    : DEFAULT_STAR_RENDER_STYLE;
}

/** Reads the persisted style from `storage` (real callers pass
 * `window.localStorage`, or `null` when even accessing that property isn't
 * safe - see `main.ts`'s `browserLocalStorage`; tests pass a minimal fake
 * implementing just `getItem`). Wrapped in `try/catch` since `getItem`
 * itself can throw in some restrictive browser privacy configurations - per
 * this codebase's existing "missing optional data degrades gracefully"
 * convention (e.g. `scene/objects.ts`'s `bubbleOuterRadiusPcFrom`), a
 * storage failure degrades to the default style rather than breaking scene
 * load. */
export function loadStarRenderStyle(storage: Pick<Storage, "getItem"> | null): StarRenderStyle {
  if (!storage) {
    return DEFAULT_STAR_RENDER_STYLE;
  }
  try {
    return parseStarRenderStyle(storage.getItem(STAR_RENDER_STYLE_STORAGE_KEY));
  } catch {
    return DEFAULT_STAR_RENDER_STYLE;
  }
}

/** Persists `style` to `storage` (or does nothing if `storage` is `null`).
 * Same defensive `try/catch` as `loadStarRenderStyle` - a failed write (quota
 * exceeded, private browsing, etc.) should never break the live toggle it's
 * backing; the choice simply won't survive a reload in that case. */
export function saveStarRenderStyle(style: StarRenderStyle, storage: Pick<Storage, "setItem"> | null): void {
  if (!storage) {
    return;
  }
  try {
    storage.setItem(STAR_RENDER_STYLE_STORAGE_KEY, style);
  } catch {
    // Ignore - see docstring above.
  }
}
