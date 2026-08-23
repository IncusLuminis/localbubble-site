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

interface BrightnessBucket {
  /** Inclusive lower bound (mag). `-Infinity` for the brightest bucket. */
  minMagnitude: number;
  multiplier: number;
}

/** Order doesn't matter for correctness (`absoluteMagnitudeToBrightness` scans
 * for the greatest `minMagnitude` that still qualifies), but listed
 * faintest-first here to read top-to-bottom alongside the docstring table
 * above. */
const BRIGHTNESS_BUCKETS: readonly BrightnessBucket[] = [
  { minMagnitude: 14, multiplier: 0.3 },
  { minMagnitude: 10, multiplier: 0.4 },
  { minMagnitude: 6, multiplier: 0.45 },
  { minMagnitude: 0, multiplier: 0.5 },
  { minMagnitude: -2, multiplier: 0.6 },
  { minMagnitude: -4, multiplier: 0.75 },
  { minMagnitude: -6, multiplier: 0.9 },
  { minMagnitude: -Infinity, multiplier: 1.0 },
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
