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
 * (2026-08-22, 707 stars, 703 with a non-null `spectral_type`): alongside the
 * expected "G2V"/"M5.5Ve"-style OBAFGKM strings, real values in this catalog
 * include white-dwarf ("DA3", 12 stars), carbon-star ("C-N5", 30), S-type
 * ("S5,5", 4), Wolf-Rayet ("WN...", 1), and brown-dwarf ("T...", 6) notations
 * that don't start with an OBAFGKM letter at all, plus 4 stars with a null
 * `spectral_type`. All of these - not just the null ones - correctly fall
 * back to `SpectralClass.UNKNOWN` below: they're real spectral
 * classifications, just not on the main sequence's OBAFGKM ladder this Story
 * scopes to, and forcing e.g. a carbon star into "M" (reddest bucket) just
 * because both are cool stars would misrepresent data this module has no
 * real basis to classify. That leaves 650 of 707 stars (92%) resolving to a
 * real OBAFGKM color and 57 (8%) - the 4 null plus 53 non-OBAFGKM-letter
 * strings - falling back to unknown.
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

/** Exported for tests - parses a raw SIMBAD `spectral_type` string down to
 * one of the 7 OBAFGKM classes, or `UNKNOWN` for null/empty/anything whose
 * leading letter isn't one of the 7 (white dwarfs, carbon stars, S-type,
 * Wolf-Rayet, brown dwarfs, and genuinely malformed strings alike - see this
 * module's docstring). Only the leading letter matters: subclass digits,
 * luminosity class suffixes, decimals, etc. ("G2V", "M5.5Ve", "B2IV") are all
 * irrelevant to which of the 8 marker colors is used. */
export function classifySpectralType(spectralType: string | null): SpectralClass {
  if (spectralType === null) {
    return SpectralClass.UNKNOWN;
  }
  const match = spectralType.trim().match(/^[A-Za-z]/);
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
