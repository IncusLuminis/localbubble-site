/**
 * Spectral-class-to-color lookup (Story #173, issue #170's `spectral_type`
 * field). Maps a star's leading spectral-class letter - the real,
 * physically-meaningful OBAFGKM blue-to-red temperature sequence (O hottest/
 * bluest, M coolest/reddest) - to a fixed marker color, so
 * `scene/objects.ts`'s star bucket can give each `InstancedMesh` instance its
 * own color via `setColorAt` instead of the flat white every star shares
 * today (`OBJECT_TYPE_COLORS['star']`).
 *
 * SIMBAD's `spectral_type` strings are messy free text, not a clean
 * enumeration - confirmed against the actual current `scene.json`
 * (2026-08-23, 707 stars, 703 with a non-null `spectral_type`): alongside the
 * expected "G2V"/"M5.5Ve"-style OBAFGKM strings, real values in this catalog
 * include white-dwarf ("DA3", 12 stars), carbon-star ("C-N5", 30), S-type
 * ("S5,5", 4), Wolf-Rayet ("WN...", 1), and brown-dwarf ("T...", 6) notations
 * that don't start with an OBAFGKM letter at all, plus 4 stars with a null
 * `spectral_type`. All of these - not just the null ones - correctly fall
 * back to `SpectralClass.UNKNOWN` below: they're real spectral
 * classifications, just not on the main sequence's OBAFGKM ladder this Story
 * scopes to, and forcing e.g. a carbon star into "M" (reddest bucket) just
 * because both are cool stars would misrepresent data this module has no
 * real basis to classify.
 *
 * Story #177 follow-up (Validator review of #173): two more real patterns in
 * this catalog needed handling before the leading-letter match, checked
 * against all 703 non-null values:
 *  - 5 stars (Wolf 359, Ross 128, Teegarden's Star, AD Leo, BR Psc) use
 *    SIMBAD's lowercase dwarf-notation prefix ("dM6", "dM3", "dM4", "dM1") -
 *    stripped below so they resolve to their real `M` class instead of
 *    falling to unknown. `sd`/`esd` (subdwarf/extreme subdwarf) are the same
 *    convention and are stripped too, though no current catalog value uses
 *    them.
 *  - nu Herculis's "kA9hF2mF2(IV)" (a composite Am-type peculiar notation -
 *    not related to spectral class K) was a genuine *false positive*: its
 *    leading lowercase "k" case-insensitively matched class K. Detected and
 *    excluded below as `UNKNOWN` rather than any real class.
 *
 * That leaves 654 of 707 stars (92.5%) resolving to a real OBAFGKM color and
 * 53 (7.5%) - the 4 null plus 49 non-OBAFGKM strings (including nu Herculis)
 * - falling back to unknown.
 */

export enum SpectralClass {
  O = "O",
  B = "B",
  A = "A",
  F = "F",
  G = "G",
  K = "K",
  M = "M",
  UNKNOWN = "unknown",
}

/** Approximate blackbody-tinted colors for each OBAFGKM class (hottest/
 * bluest O through coolest/reddest M), in the same vein as the commonly
 * cited Mitchell Charity stellar-color-index approximations - close enough
 * for a schematic marker color, not a photometrically exact render. M is
 * pushed a bit more saturated/orange-red than a literal blackbody tint so it
 * reads unambiguously "reddish" next to G's whitish-yellow at marker scale
 * (Definition of Done: "a real M dwarf reads distinctly reddish/orange vs. a
 * real G-type star reading whiteish-yellow").
 *
 * `UNKNOWN` is a light neutral gray deliberately close to the pre-#173 flat
 * white every star used to render as (`OBJECT_TYPE_COLORS['star'] =
 * 0xffffff`), so a star with no/unparseable `spectral_type` still looks like
 * "an ordinary, unclassified star" rather than looking broken or singled
 * out. */
const SPECTRAL_CLASS_COLORS: Record<SpectralClass, number> = {
  [SpectralClass.O]: 0x9bb0ff,
  [SpectralClass.B]: 0xaabfff,
  [SpectralClass.A]: 0xcad7ff,
  [SpectralClass.F]: 0xf8f7ff,
  [SpectralClass.G]: 0xfff4ea,
  [SpectralClass.K]: 0xffcc99,
  [SpectralClass.M]: 0xff7a4d,
  [SpectralClass.UNKNOWN]: 0xc7ccd6,
};

const LETTER_TO_SPECTRAL_CLASS: Record<string, SpectralClass> = {
  O: SpectralClass.O,
  B: SpectralClass.B,
  A: SpectralClass.A,
  F: SpectralClass.F,
  G: SpectralClass.G,
  K: SpectralClass.K,
  M: SpectralClass.M,
};

/** SIMBAD's lowercase dwarf/subdwarf MK luminosity-class prefixes ("d",
 * "sd", "esd") ahead of the real class letter, e.g. "dM6", "sdB". Matched
 * case-SENSITIVELY on purpose and only when immediately followed by an
 * actual OBAFGKM letter: an uppercase leading "D" is a wholly different
 * thing - the white-dwarf spectral class ("DA3", "DQ", "DZ7.5", ...) - and
 * must NOT be stripped as if it were this dwarf prefix, or a white dwarf
 * would be wrongly repainted as e.g. class A. */
const DWARF_PREFIX_PATTERN = /^(esd|sd|d)(?=[OBAFGKM])/;

function stripDwarfPrefix(spectralType: string): string {
  return spectralType.replace(DWARF_PREFIX_PATTERN, "");
}

/** Composite/peculiar MK notations - chemically peculiar Am-type stars in
 * particular, like nu Herculis's "kA9hF2mF2(IV)" - encode multiple
 * line-based sub-classifications in one string: lowercase "k" (Ca II K-line
 * type), "h" (hydrogen-line type), "m" (metallic-line type), each followed
 * by its own class-letter-plus-subclass component. These lowercase letters
 * are component markers, not a case-insensitive spelling of a real OBAFGKM
 * class - naively matching the first character (as if "k" meant "K") is a
 * genuine wrong-class misclassification, not a safe "unknown" fallback.
 * Recognized by the repeating <lowercase-marker><UPPERCASE-letter><digit>
 * shape (at least two occurrences): a single stray lowercase letter, like a
 * hypothetically lowercase-typed "g2v", has only one such group and still
 * falls through to the normal case-insensitive match below. */
const PECULIAR_COMPOSITE_PATTERN = /^[a-z][A-Z]\d.*[a-z][A-Z]\d/;

/** Exported for tests - parses a raw SIMBAD `spectral_type` string down to
 * one of the 7 OBAFGKM classes, or `UNKNOWN` for null/empty/anything whose
 * leading letter isn't one of the 7 (white dwarfs, carbon stars, S-type,
 * Wolf-Rayet, brown dwarfs, composite/peculiar notations, and genuinely
 * malformed strings alike - see this module's docstring). Dwarf/subdwarf
 * prefixes ("d", "sd", "esd") are stripped before matching the leading
 * letter. Otherwise, only the leading letter matters: subclass digits,
 * luminosity class suffixes, decimals, etc. ("G2V", "M5.5Ve", "B2IV") are all
 * irrelevant to which of the 8 marker colors is used. */
export function classifySpectralType(spectralType: string | null): SpectralClass {
  if (spectralType === null) {
    return SpectralClass.UNKNOWN;
  }
  const trimmed = spectralType.trim();
  if (PECULIAR_COMPOSITE_PATTERN.test(trimmed)) {
    return SpectralClass.UNKNOWN;
  }
  const match = stripDwarfPrefix(trimmed).match(/^[A-Za-z]/);
  if (!match) {
    return SpectralClass.UNKNOWN;
  }
  return LETTER_TO_SPECTRAL_CLASS[match[0].toUpperCase()] ?? SpectralClass.UNKNOWN;
}

/** Exported for tests/`objects.ts` - the marker color (a `THREE.Color`-
 * constructor-compatible hex number) for a given raw `spectral_type` string,
 * composing `classifySpectralType` with the fixed per-class color table
 * above. */
export function spectralColorFor(spectralType: string | null): number {
  return SPECTRAL_CLASS_COLORS[classifySpectralType(spectralType)];
}
