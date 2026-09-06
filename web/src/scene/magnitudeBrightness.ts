/**
 * Absolute-magnitude-to-brightness lookup (Story #173, issue #170's
 * `absolute_magnitude` field). Buckets `absolute_magnitude` into a small set
 * of discrete brightness multipliers so `scene/objects.ts`'s star bucket can
 * scale each instance's `spectralColor.ts` color by "how intrinsically
 * bright is this star" - remember magnitude is inverted (more negative =
 * brighter), so lower/more-negative magnitude must map to a HIGHER
 * multiplier.
 *
 * Boundaries below are fit to this catalog's own real distribution, not
 * generic astronomy-textbook magnitude bins - pulled directly from the
 * actual current `scene.json` (2026-08-22, 707 stars, 680 with a non-null
 * `absolute_magnitude`):
 *
 *   min -6.98, max 26.28, mean -0.74, median -2.59
 *   percentiles: p5 -4.73, p10 -3.98, p20 -3.42, p50 -2.59, p80 -1.11,
 *                p90 +10.06, p95 +13.06
 *   histogram (2-mag bins): the catalog is heavily bimodal - 402 of 680
 *   stars (59%) sit in a single dense [-4, -2) bin (bright naked-eye-visible
 *   giants/supergiants pulled from the Galaxy Map poster source, see
 *   `objects.ts`'s module docstring), then a sharp cliff: only ~10% of
 *   stars are fainter than -1.1, but that remaining 10% spreads all the way
 *   out to +26 (the RECONS-batch's faint nearby red/brown dwarfs and white
 *   dwarfs). A boundary scheme built on generic textbook magnitude ranges
 *   (tuned for a roughly-normal, Sun-centered sample) would put almost every
 *   star in this catalog in one or two buckets; the boundaries below instead
 *   split the dense bright core finely (where nearly all the data actually
 *   is) and the sparse faint tail coarsely (where it isn't).
 *
 * 8 buckets total (within the requested 7-9 range), multipliers spanning the
 * requested ~0.3-1.0 range, brightest-to-faintest:
 *
 *   mag < -6        (n=8,   ~1%)  -> 1.00  exceptionally bright supergiants
 *   -6 <= mag < -4   (n=56,  ~8%)  -> 0.90  bright giants
 *   -4 <= mag < -2   (n=402, ~59%) -> 0.75  the catalog's dense typical core
 *   -2 <= mag < 0    (n=105, ~15%) -> 0.60  ordinary main-sequence stars
 *    0 <= mag < 6    (n=22,  ~3%)  -> 0.50  sub-solar dwarfs
 *    6 <= mag < 10   (n=19,  ~3%)  -> 0.45  faint red dwarfs
 *   10 <= mag < 14   (n=44,  ~7%)  -> 0.40  very faint red/white dwarfs
 *   mag >= 14        (n=24,  ~4%)  -> 0.30  faintest (white/brown dwarfs)
 *
 * Null `absolute_magnitude` (27 of 707 stars) gets `DEFAULT_BRIGHTNESS`
 * (0.65) - a value deliberately BETWEEN the "typical core" bucket (0.75, the
 * bucket the catalog's own median (-2.59) falls into) and the next bucket
 * down (0.60), i.e. a genuinely mid-range/"ordinary star" appearance - never
 * the dimmest (0.30) or brightest (1.00) bucket, per the Story's explicit
 * requirement that missing data must not read as an extreme.
 */

/** Issue #11 (Epic #7, Story 2/4): the two `THREE.Points` sprite-atlas
 * variants `starTwinkle.ts` draws (see that module's own docstring for the
 * actual canvas drawing) - `"normal"` is the plain 4-spike twinkle every
 * bucket gets by default, `"brilliant"` is the visually distinct, more
 * heavily-spiked/haloed variant reserved for the catalog's genuinely
 * exceptional top tier(s) (see `BRIGHTNESS_BUCKETS`' own docstring below for
 * exactly which buckets get it and why). */
export type RealworldSpriteVariant = "normal" | "brilliant";

/** REALWORLD's per-bucket visual style: a size multiplier (applied on top of
 * `realworldStars.ts`'s own fixed base sprite pixel size) plus which sprite
 * atlas cell to draw. Kept as one combined object (rather than two parallel
 * lookups) since the two are always decided together per bucket - see
 * `BRIGHTNESS_BUCKETS` below. */
export interface RealworldStarStyle {
  sizeMultiplier: number;
  spriteVariant: RealworldSpriteVariant;
}

interface BrightnessBucket {
  /** Inclusive lower bound (mag). `-Infinity` for the brightest bucket. */
  minMagnitude: number;
  multiplier: number;
  /** Issue #11: REALWORLD's own size/variant style for this exact same
   * bucket - see this module's docstring above (MODEL's color-darkening
   * table) and the docstring further below (REALWORLD's size table) for how
   * the two axes were chosen independently for the same 8 boundaries. */
  realworld: RealworldStarStyle;
}

/**
 * Issue #11 (Epic #7, Story 2/4): REALWORLD's own per-bucket SIZE
 * multiplier, reusing the exact same 8 magnitude boundaries as MODEL's
 * `multiplier` (color-darkening) column above - deliberately NOT a
 * re-derived boundary set, so a star can never fall into a different
 * brightness "tier" under one style than the other, even though what each
 * style DOES with that tier differs completely.
 *
 * The human owner's own explicit ask (issue #11/#7): "the brightest 3-4
 * tiers in particular should read as dramatically, unmistakably brighter
 * ('ослепляющие иголки' / blinding needles), not a subtle tint difference."
 * MODEL's own color table only ever spans a gentle 0.3-1.0 range (a ~3.3x
 * ratio) since it's darkening a shared white base color, not resizing
 * anything. REALWORLD instead spans a deliberately dramatic ~15x ratio
 * (0.4 faintest -> 6.0 brightest) - chosen, not derived from the catalog
 * distribution the way the magnitude boundaries themselves were (issue
 * #173's own histogram, still authoritative - see above), because "how
 * dramatic should a twinkle sprite's size jump read visually" has no
 * physical formula to fit; it's a live-tuned visual-design constant like
 * this file's sibling `starMarkerScale.ts`/`diffuseStructures.ts` constants.
 *
 * The multiplier curve is deliberately front-loaded: the TOP four tiers
 * (mag < 0) step up much faster (x1.5, x1.67, x1.5 between consecutive
 * tiers) than the bottom four (mag >= 0, x1.33, x1.36, x1.375) - so the
 * catalog's brightest ~24% of stars (mag < 0, the four brightest buckets)
 * carry almost the entire size range's drama, while the faint tail (mag >=
 * 0, the bulk of the RECONS-batch's faint nearby dwarfs) shrinks gently and
 * predictably, matching the human owner's explicit "brightest 3-4 tiers"
 * framing rather than spreading the drama evenly across all 8.
 *
 * `spriteVariant` is `"brilliant"` (see `starTwinkle.ts`) only for the top
 * TWO tiers (mag < -4, ~9% of the catalog: 8 exceptional supergiants + 56
 * bright giants) - deliberately NOT the -4<=mag<-2 tier too, even though
 * that tier's own size multiplier is already a big step up (2.4x): that
 * tier alone is 59% of the whole catalog (issue #173's own histogram), and
 * giving the MAJORITY of stars the special, more-elaborate sprite shape
 * would dilute exactly the "unmistakably, dramatically brighter" contrast
 * the human owner asked for - a shape reserved for a genuinely small,
 * exceptional minority reads as special; a shape most stars share does not.
 * The -4<=mag<-2 tier still reads as clearly brighter than anything below
 * it purely through its own size jump (2.4x vs. 1.6x/1.0x/0.75x below),
 * without also needing the more elaborate shape.
 */
const REALWORLD_STYLE_BY_MAGNITUDE: Record<number, RealworldStarStyle> = {
  14: { sizeMultiplier: 0.4, spriteVariant: "normal" },
  10: { sizeMultiplier: 0.55, spriteVariant: "normal" },
  6: { sizeMultiplier: 0.75, spriteVariant: "normal" },
  0: { sizeMultiplier: 1.0, spriteVariant: "normal" },
  [-2]: { sizeMultiplier: 1.6, spriteVariant: "normal" },
  [-4]: { sizeMultiplier: 2.4, spriteVariant: "normal" },
  [-6]: { sizeMultiplier: 4.0, spriteVariant: "brilliant" },
  [-Infinity]: { sizeMultiplier: 6.0, spriteVariant: "brilliant" },
};

/** Order doesn't matter for correctness (`absoluteMagnitudeToBrightness` scans
 * for the greatest `minMagnitude` that still qualifies), but listed
 * faintest-first here to read top-to-bottom alongside the docstring table
 * above. */
const BRIGHTNESS_BUCKETS: readonly BrightnessBucket[] = [
  { minMagnitude: 14, multiplier: 0.3, realworld: REALWORLD_STYLE_BY_MAGNITUDE[14] },
  { minMagnitude: 10, multiplier: 0.4, realworld: REALWORLD_STYLE_BY_MAGNITUDE[10] },
  { minMagnitude: 6, multiplier: 0.45, realworld: REALWORLD_STYLE_BY_MAGNITUDE[6] },
  { minMagnitude: 0, multiplier: 0.5, realworld: REALWORLD_STYLE_BY_MAGNITUDE[0] },
  { minMagnitude: -2, multiplier: 0.6, realworld: REALWORLD_STYLE_BY_MAGNITUDE[-2] },
  { minMagnitude: -4, multiplier: 0.75, realworld: REALWORLD_STYLE_BY_MAGNITUDE[-4] },
  { minMagnitude: -6, multiplier: 0.9, realworld: REALWORLD_STYLE_BY_MAGNITUDE[-6] },
  { minMagnitude: -Infinity, multiplier: 1.0, realworld: REALWORLD_STYLE_BY_MAGNITUDE[-Infinity] },
];

/** Mid-range brightness multiplier used for stars with a null/missing
 * `absolute_magnitude` - see this module's docstring for why 0.65 (between
 * the two buckets straddling the catalog's real median) rather than the
 * dimmest or brightest bucket. */
export const DEFAULT_BRIGHTNESS = 0.65;

/** Exported for tests/`objects.ts` - the brightness multiplier for a given
 * `absolute_magnitude` value (or `DEFAULT_BRIGHTNESS` for `null`): the
 * bucket whose `minMagnitude` is the greatest value that is still
 * `<= magnitude`. */
export function absoluteMagnitudeToBrightness(magnitude: number | null): number {
  if (magnitude === null || !Number.isFinite(magnitude)) {
    return DEFAULT_BRIGHTNESS;
  }
  let best = BRIGHTNESS_BUCKETS[BRIGHTNESS_BUCKETS.length - 1];
  for (const bucket of BRIGHTNESS_BUCKETS) {
    if (magnitude >= bucket.minMagnitude && bucket.minMagnitude > best.minMagnitude) {
      best = bucket;
    }
  }
  return best.multiplier;
}

/** Issue #11: REALWORLD's own mid-range style for a null/missing
 * `absolute_magnitude` (27 of 707 stars) - mirrors `DEFAULT_BRIGHTNESS`'s own
 * reasoning exactly, just on the REALWORLD size axis: a value strictly
 * between the two buckets straddling the catalog's real median (-2<=mag<0's
 * 1.6 and -4<=mag<-2's 2.4, i.e. 2.0), `"normal"` sprite variant - a
 * genuinely mid-range/"ordinary star" appearance, never the dimmest or the
 * showcased-brilliant extreme, so missing data still can't read as an
 * accidental visual outlier under REALWORLD either. */
export const DEFAULT_REALWORLD_STYLE: RealworldStarStyle = {
  sizeMultiplier: 2.0,
  spriteVariant: "normal",
};

/** Exported for tests/`realworldStars.ts` - the REALWORLD size multiplier +
 * sprite variant for a given `absolute_magnitude` value (or
 * `DEFAULT_REALWORLD_STYLE` for `null`/non-finite), sharing
 * `absoluteMagnitudeToBrightness`'s exact same bucket-boundary lookup logic
 * (see `REALWORLD_STYLE_BY_MAGNITUDE`'s own docstring for why the boundaries
 * themselves are reused verbatim from MODEL's table rather than re-derived). */
export function absoluteMagnitudeToRealworldStyle(magnitude: number | null): RealworldStarStyle {
  if (magnitude === null || !Number.isFinite(magnitude)) {
    return DEFAULT_REALWORLD_STYLE;
  }
  let best = BRIGHTNESS_BUCKETS[BRIGHTNESS_BUCKETS.length - 1];
  for (const bucket of BRIGHTNESS_BUCKETS) {
    if (magnitude >= bucket.minMagnitude && bucket.minMagnitude > best.minMagnitude) {
      best = bucket;
    }
  }
  return best.realworld;
}
