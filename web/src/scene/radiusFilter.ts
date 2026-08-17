/**
 * Client-side radius filtering (spec Idea.md §28: "The visualizer should
 * support filtering by heliocentric distance ... The architecture must not
 * hard-code 800 pc as a permanent limit").
 *
 * `web/public/data/scene.json` is now generated with
 * `--no-radius-filter` (see Story #65) so it carries the FULL, unfiltered
 * catalog (20 objects, out to ~1009 pc for the Cepheus OB associations) -
 * filtering happens here, entirely client-side, against that full dataset.
 * Presets are just UI convenience; `isWithinRadius` itself accepts any
 * finite radius, so nothing here re-introduces an 800pc ceiling.
 */

/** Spec §28's initial preset list, in pc. `2000` covers every object in the
 * current catalog (max ~1009 pc); presets are illustrative starting points,
 * not an exhaustive/hard limit on what radius the UI could support. */
export const RADIUS_PRESETS_PC: readonly number[] = [100, 250, 500, 800, 1000, 2000];

/** Default preset, matching the conceptual UI sketch in spec §2
 * ("Radius: 800 pc"). */
export const DEFAULT_RADIUS_PC = 800;

/**
 * True if `distancePc` should be visible under a `radiusPc` filter.
 * `radiusPc === null` means "no filter" (show everything) - kept as an
 * explicit option so a future "All" preset doesn't need a magic-number
 * sentinel radius.
 */
export function isWithinRadius(distancePc: number, radiusPc: number | null): boolean {
  if (radiusPc === null) {
    return true;
  }
  return distancePc <= radiusPc;
}
