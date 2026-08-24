import type { SceneObject } from "./sceneTypes";
import { SUN_OBJECT_ID } from "./objects";

/**
 * Name/alias search matching (issue #106, spec §2.6). Spec §22's required
 * web-visualizer capabilities list has no search - a reasonable omission at
 * the original ~20-object catalog, a real gap once Story #88 grew it to
 * 834 objects. This gives "type a name, jump to the matching object" a
 * pure, DOM/THREE-free matching function that the search UI component
 * (`ui/search.ts`) and its tests can both call directly.
 *
 * Case-insensitive substring match against `SceneObject.name` and each of
 * its `aliases` entries - the acceptance criteria's stated minimum (fuzzy/
 * typo-tolerant matching is explicitly out of scope for this issue).
 *
 * Whitespace normalization (issue #223): SIMBAD's `main_id`/alias fields use
 * fixed-width padding for some designations - multiple internal spaces,
 * e.g. `"M  27"` for M27, `"HD  95735"` - so a naturally-typed query like
 * `"M27"` or `"M 27"` wouldn't otherwise substring-match the stored
 * `"M  27"`. This is handled in two tiers, deliberately NOT by just
 * stripping whitespace out of both sides entirely and substring-matching
 * the result: that approach was tried and reverted (see PR discussion) once
 * live-verification showed queries like `"M1"`/`"M8"` matching hundreds of
 * unrelated aliases across the catalog - e.g. `"UBV M  11645"` and
 * `"PPM 106829"` both contain a bare "m" immediately followed by digits
 * once every space is removed, which buried the actual Messier object past
 * the search UI's visible result cap.
 *
 * 1. Both the query and the compared text have whitespace RUNS collapsed to
 *    a single space (`normalizeSpacing`) before a plain substring check.
 *    This alone makes a single-space query (`"M 27"`) match a
 *    double/triple-space stored designation (`"M  27"`/`"M   1"`), with no
 *    new false-positive risk: it's the same substring semantics as before,
 *    just insensitive to *how many* spaces the padding used.
 * 2. A query with NO internal space at all that looks like a bare
 *    designation - a letter-prefix immediately followed by digits, e.g.
 *    `"M27"` - additionally tries a start-anchored, token-aware pattern
 *    (`buildFusedDesignationPattern`): the letter-prefix must be its own
 *    leading token, immediately followed by one space then the digits, with
 *    no further digit immediately after (a negative lookahead, `(?!\d)`).
 *    That's what excludes `"UBV M  11645"` (the leading token there is
 *    `"UBV"`, not `"M"`) while still matching a stored `"M  27"` (whose
 *    *entire* designation - name or alias - starts with that "M" token). The
 *    trailing lookahead is what additionally excludes same-prefix,
 *    longer-number collisions like `"M  16"`/`"M  17"` from a `"M1"` query -
 *    without it, the digit group only matched as a PREFIX of the stored
 *    number, not the whole thing (found live during review: `"M1"` matched
 *    `"M  16"` and `"M  17"` because both start with "1").
 *
 * The Sun's own dedicated-marker catalog entry (`SUN_OBJECT_ID`, see
 * `scene/objects.ts`) is excluded from results: it isn't part of the
 * generic catalog `InstancedMesh` buckets or the labels layer (both built
 * from `excludeDedicatedMarkerObjects`), so `objectCenteredPose`/
 * `selectObject` would otherwise be asked to frame/select an object with no
 * corresponding on-screen marker or label. The existing "Sun-centered"
 * camera preset already covers navigating to the Sun.
 */
export function searchObjects(objects: readonly SceneObject[], query: string): SceneObject[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return [];
  }
  const normalizedQuery = normalizeSpacing(trimmed);
  const fusedDesignation = buildFusedDesignationPattern(normalizedQuery);
  return objects.filter(
    (obj) => obj.id !== SUN_OBJECT_ID && matchesQuery(obj, normalizedQuery, fusedDesignation),
  );
}

/** Collapses any run of whitespace down to a single space - SIMBAD's
 * fixed-width padding uses two-or-more spaces for some designations (see
 * this module's docstring), and this makes matching insensitive to exactly
 * how many. */
function normalizeSpacing(value: string): string {
  return value.replace(/\s+/g, " ");
}

/**
 * Builds the narrow, no-space-query fallback pattern described in this
 * module's docstring (tier 2). Only fires for a query that, once
 * space-normalized, is ENTIRELY a letters-then-digits token with no space
 * of its own (e.g. `"M27"`, not `"M 27"` - that case is already handled by
 * the plain substring check in tier 1). Returns `null` for every other
 * query shape, since there's nothing extra to try.
 */
function buildFusedDesignationPattern(normalizedQuery: string): RegExp | null {
  const match = /^([a-z]+)(\d+)$/.exec(normalizedQuery);
  if (!match) {
    return null;
  }
  const [, prefix, digits] = match;
  return new RegExp(`^${escapeRegExp(prefix)} ${escapeRegExp(digits)}(?!\\d)`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matchesQuery(obj: SceneObject, normalizedQuery: string, fusedDesignation: RegExp | null): boolean {
  const texts = [obj.name, ...obj.aliases];
  return texts.some((text) => textMatches(text, normalizedQuery, fusedDesignation));
}

function textMatches(text: string, normalizedQuery: string, fusedDesignation: RegExp | null): boolean {
  const normalizedText = normalizeSpacing(text.toLowerCase());
  if (normalizedText.includes(normalizedQuery)) {
    return true;
  }
  return fusedDesignation !== null && fusedDesignation.test(normalizedText);
}
