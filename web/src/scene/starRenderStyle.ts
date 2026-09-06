/**
 * Issue #10 (Epic #7, Story 1/4): the MODEL vs REALWORLD star-rendering
 * style's type/default/validation.
 *
 * Kept in `scene/` (not `ui/`) because `StarRenderStyle` is a scene-rendering
 * concept - `scene/objects.ts`'s star-bucket construction dispatches on it
 * directly (`buildStarCatalogBucket`) - even though the only callers of the
 * exports below are `main.ts` and `ui/controls.ts` (imports the type +
 * `STAR_RENDER_STYLES` for its Settings-panel control). This mirrors
 * `ui/controls.ts`'s existing convention of importing scene-owned constants
 * directly (see its `RADIUS_PRESETS_PC`/`DEFAULT_RADIUS_PC` import from
 * `scene/radiusFilter`).
 *
 * `MODEL` is today's exact, unchanged star-rendering code path - issue #10's
 * own explicit requirement was that that Story must not alter `MODEL`'s
 * behavior/appearance/performance in any way, and issue #11 (Epic #7, Story
 * 2/4) preserves that constraint. `REALWORLD` was, for issue #10 only, a stub
 * alias of `MODEL`; issue #11 replaced that stub with its own real
 * `THREE.Points`-based twinkle-sprite/magnitude-driven-size system (see
 * `scene/realworldStars.ts`).
 *
 * Issue #19 (Epic #7): this style's own dedicated, always-on
 * `localStorage` persistence (`loadStarRenderStyle`/`saveStarRenderStyle`,
 * a `STAR_RENDER_STYLE_STORAGE_KEY` of its own) is retired - it's now just
 * one field of `ui/settingsPersistence.ts`'s unified, consent-gated
 * `PersistedSettings` blob, alongside every other Settings-panel control.
 * `parseStarRenderStyle` below stays here (and stays exported) since that
 * module reuses it to validate that one field the same way it always has -
 * only the storage-key/load/save plumbing moved, not the validation logic.
 */
export type StarRenderStyle = "MODEL" | "VISUAL";

export const DEFAULT_STAR_RENDER_STYLE: StarRenderStyle = "MODEL";

/** The complete, ordered set of valid `StarRenderStyle` values - single
 * source of truth for `parseStarRenderStyle`'s validation below AND for
 * `ui/controls.ts`'s Settings-panel `<select>` options, so the two can never
 * silently drift apart (e.g. a third style added to the type but forgotten
 * in one of the two places). */
export const STAR_RENDER_STYLES: readonly StarRenderStyle[] = ["MODEL", "VISUAL"];

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
