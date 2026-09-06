import { CanvasTexture } from "three";

/**
 * Issue #11 (Epic #7, Story 2/4): canvas-drawn "twinkle" sprite texture for
 * REALWORLD's `THREE.Points` star field - a bright core with thin radiating
 * diffraction spikes (the classic photographic/naked-eye look of a real
 * bright star or planet), NOT `diffuseStructures.ts`'s `getMistySpriteTexture`
 * soft circular nebula-blob (that function's own canvas-gradient TECHNIQUE -
 * build a small canvas once, draw radial gradients, wrap in a `CanvasTexture`,
 * cache the single result, guard on `typeof document === "undefined"` for
 * this repo's DOM-less `environment: "node"` test suite - is reused directly
 * below as this module's own starting pattern, per the issue's explicit
 * instruction).
 *
 * Two visually distinct variants are drawn once into a single 256x128 atlas
 * (left half / right half) rather than two separate textures, so
 * `realworldStars.ts`'s single `THREE.Points` draw call can select either
 * variant per-star (a custom `aVariant` vertex attribute offsetting the
 * fragment shader's `gl_PointCoord` sample into the left or right half) while
 * still only ever binding one texture:
 *
 *  - `"normal"` (left half): every ordinary star - a compact core plus a
 *    plain 4-point diffraction cross. Distinctly a "twinkle", not a soft dot,
 *    but understated.
 *  - `"brilliant"` (right half): reserved for the catalog's genuinely
 *    exceptional top brightness tier(s) (see `magnitudeBrightness.ts`'s
 *    `REALWORLD_STYLE_BY_MAGNITUDE` docstring for exactly which). A bigger,
 *    brighter core, a wider soft halo behind it, and 8 spikes (the same
 *    4-point cross plus a second, shorter 4-point cross rotated 45deg) - the
 *    human owner's own "ослепляющие иголки" (blinding needles) framing calls
 *    for something that reads as categorically more dramatic than a bigger
 *    copy of the same shape, not just a bigger copy of the same shape.
 *
 * Both variants are drawn in flat white with an alpha gradient (never tinted
 * here) - `realworldStars.ts`'s shader multiplies the sampled texture by each
 * star's own per-vertex OBAFGKM color, exactly mirroring how
 * `diffuseStructures.ts`'s sprites are drawn white-with-alpha once and tinted
 * per-instance via `SpriteMaterial.color` instead of baking color into the
 * texture itself.
 */

/** Canvas pixels per atlas cell (one variant). The atlas canvas itself is
 * `2 * STAR_TWINKLE_CELL_SIZE` wide, `STAR_TWINKLE_CELL_SIZE` tall. 128px is
 * plenty of resolution for a sprite that, even at REALWORLD's most dramatic
 * "brilliant" size multiplier, renders at well under 128 screen pixels (see
 * `realworldStars.ts`'s own base-pixel-size constant) - big enough to stay
 * crisp on a high-DPI display without wastefully oversampling. */
export const STAR_TWINKLE_CELL_SIZE = 128;

/** The `[uMin, uMax]` horizontal texture-coordinate range (within the full
 * 0-1 atlas width) that samples the `"normal"` variant's cell - exported so
 * `realworldStars.ts`'s fragment shader source and any test asserting on the
 * atlas layout share this one definition rather than a second hard-coded
 * `0.5`. */
export const STAR_TWINKLE_NORMAL_U_RANGE: readonly [number, number] = [0, 0.5];

/** The `"brilliant"` variant's cell, the atlas's right half - see
 * `STAR_TWINKLE_NORMAL_U_RANGE`'s own docstring. */
export const STAR_TWINKLE_BRILLIANT_U_RANGE: readonly [number, number] = [0.5, 1];

/** Draws one diffraction-spike cross (`spikeCount` blades, evenly spaced
 * around the full circle) centered at the canvas's current origin (callers
 * `ctx.translate` first) - each blade a thin triangle fading from opaque at
 * the center to transparent at its tip, via a linear gradient along its own
 * length. Reused for both the "normal" 4-blade cross and the "brilliant"
 * variant's two overlaid 4-blade crosses (8 spikes total, the second rotated
 * 45deg by the caller's own starting `ctx.rotate` offset). */
function drawSpikeCross(
  ctx: CanvasRenderingContext2D,
  spikeCount: number,
  spikeLength: number,
  spikeHalfWidth: number,
): void {
  ctx.save();
  const angleStep = (Math.PI * 2) / spikeCount;
  for (let i = 0; i < spikeCount; i++) {
    const gradient = ctx.createLinearGradient(0, 0, 0, -spikeLength);
    gradient.addColorStop(0, "rgba(255,255,255,0.95)");
    gradient.addColorStop(0.35, "rgba(255,255,255,0.35)");
    gradient.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = gradient;
    ctx.beginPath();
    ctx.moveTo(-spikeHalfWidth, 0);
    ctx.lineTo(spikeHalfWidth, 0);
    ctx.lineTo(0, -spikeLength);
    ctx.closePath();
    ctx.fill();
    ctx.rotate(angleStep);
  }
  ctx.restore();
}

/** Draws one soft, wide halo glow (a plain radial gradient, `getMistySpriteTexture`'s
 * own core technique) behind a star's spikes/core - used for both variants,
 * `haloRadius`/`peakAlpha` tuned per-variant by the caller so the "brilliant"
 * variant reads as having a visibly bigger, brighter glow, not just bigger
 * spikes. */
function drawHalo(ctx: CanvasRenderingContext2D, cx: number, cy: number, haloRadius: number, peakAlpha: number): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, haloRadius);
  gradient.addColorStop(0, `rgba(255,255,255,${peakAlpha})`);
  gradient.addColorStop(0.5, `rgba(255,255,255,${peakAlpha * 0.35})`);
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, haloRadius, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws the small, near-opaque core disc at a sprite's exact center - drawn
 * LAST (on top of the halo/spikes) for both variants, so the bright point
 * source itself never gets muddied by the softer glow/spike layers beneath
 * it. */
function drawCore(ctx: CanvasRenderingContext2D, cx: number, cy: number, coreRadius: number): void {
  const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, coreRadius);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.6, "rgba(255,255,255,0.9)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(cx, cy, coreRadius, 0, Math.PI * 2);
  ctx.fill();
}

/** Draws the `"normal"` twinkle into the cell centered at `(cx, cy)` of size
 * `cellSize` - a modest halo, a plain 4-spike diffraction cross, and a small
 * bright core. This is every ordinary REALWORLD star's sprite. */
function drawNormalTwinkle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  spikeLengthMultiplier = 1,
  spikeWidthMultiplier = 1,
): void {
  drawHalo(ctx, cx, cy, cellSize * 0.3, 0.5);
  ctx.translate(cx, cy);
  drawSpikeCross(ctx, 4, cellSize * 0.42 * spikeLengthMultiplier, cellSize * 0.028 * spikeWidthMultiplier);
  ctx.translate(-cx, -cy);
  drawCore(ctx, cx, cy, cellSize * 0.13);
}

/** Draws the `"brilliant"` twinkle into the cell centered at `(cx, cy)` of
 * size `cellSize` - a visibly bigger/brighter halo, TWO overlaid 4-spike
 * crosses (one rotated 45deg from the other, i.e. 8 spikes total) reaching
 * further than the normal variant's own spikes, and a bigger core. Reserved
 * for REALWORLD's top brightness tier(s) - see this module's own docstring
 * for why this is a categorically different shape, not just a scaled-up
 * normal twinkle. */
function drawBrilliantTwinkle(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  cellSize: number,
  spikeLengthMultiplier = 1,
  spikeWidthMultiplier = 1,
): void {
  drawHalo(ctx, cx, cy, cellSize * 0.46, 0.65);
  ctx.translate(cx, cy);
  drawSpikeCross(ctx, 4, cellSize * 0.48 * spikeLengthMultiplier, cellSize * 0.032 * spikeWidthMultiplier);
  ctx.rotate(Math.PI / 4);
  drawSpikeCross(ctx, 4, cellSize * 0.3 * spikeLengthMultiplier, cellSize * 0.02 * spikeWidthMultiplier);
  ctx.rotate(-Math.PI / 4);
  ctx.translate(-cx, -cy);
  drawCore(ctx, cx, cy, cellSize * 0.19);
}

/** Cached exactly like `diffuseStructures.ts`'s `getMistySpriteTexture` -
 * built once, `undefined` means "not yet resolved," `null` means "resolved,
 * no DOM available" (this repo's `environment: "node"` Vitest suite; see that
 * function's own docstring for the full reasoning, reused verbatim here). */
let starTwinkleAtlasTexture: CanvasTexture | null | undefined;

/** Builds (once) and returns the shared star-twinkle sprite atlas texture -
 * `"normal"` variant in the left half, `"brilliant"` in the right half (see
 * `STAR_TWINKLE_NORMAL_U_RANGE`/`STAR_TWINKLE_BRILLIANT_U_RANGE`). Returns
 * `null` in this repo's DOM-less test environment, exactly like
 * `getMistySpriteTexture` - every real caller (`realworldStars.ts`) already
 * treats a `null` map as "no texture, flat-shaded fallback," so the geometry/
 * attribute-building logic stays fully unit-testable without a real canvas. */
/** PROTOTYPE (not for merge): rebuilds the atlas fresh (no caching) with
 * adjustable spike length/width, for `main.ts`'s live tuning HUD.
 *
 * Deliberately keeps the DESIGN proportions (`designCellSize`, fed to
 * `drawNormalTwinkle`/`drawBrilliantTwinkle`) fixed at the same
 * `STAR_TWINKLE_CELL_SIZE` the cached production texture uses - so a 1x
 * multiplier reproduces the production look exactly - while placing each
 * cell's drawing inside a much bigger, otherwise-blank CANVAS footprint
 * (`canvasCellSize`). The baked spike-length constants above already reach
 * ~0.48-0.96 of the design cell's own half-width at 1x (by design, to fill
 * the frame), so scaling the design cell itself would clip almost
 * immediately - padding the CANVAS instead (not the design proportions)
 * gives real headroom: at `PADDING_FACTOR=4`, multipliers up to ~4x still
 * fit before the spike tip (already faded near-transparent by then anyway)
 * reaches the canvas edge. Normal and brilliant get independent length
 * multipliers (the human owner's own ask: crank the brightest tier's spikes
 * further than ordinary stars') but share one width multiplier. Caller owns
 * disposing the previous texture.
 *
 * REAL BUG FOUND LIVE (not just theoretical): an earlier version of this
 * function always padded the canvas by a FIXED 4x factor (enough headroom
 * for the "brightest" slider's max 4x length), regardless of the actual
 * multipliers in use. That fixed padding shrinks the drawn content's share
 * of the sprite's total footprint - invisible for a big/bright "brilliant"
 * star (plenty of pixels either way) but fatal for an ordinary faint star's
 * tiny few-pixel-diameter sprite: the visible shape shrinks below what a
 * few `gl_PointCoord` samples (or a coarse mip level) can resolve, so the
 * fragment shader's `texel.a < 0.02` discard drops it entirely - it just
 * vanishes. The human owner hit exactly this by touching "Spike width"
 * alone (which doesn't even need length headroom) - because ANY redraw
 * through the old fixed-4x path paid the same tax. Fix: size the canvas
 * padding to only what today's actual length multipliers need (see
 * `requiredCanvasCellSize` below) - at the 1x defaults this is now
 * IDENTICAL to the production ratio (zero degradation), and padding only
 * grows (degrading tiny-star legibility only as a deliberate, gradual
 * tradeoff) when the user actually pushes a length slider past 1x. */
let tunableCanvas: HTMLCanvasElement | null = null;
let tunableTexture: CanvasTexture | null = null;

/** Smallest canvas cell that still keeps a `spikeLengthMultiplier` from
 * clipping before its already-near-transparent gradient tail reaches the
 * cell edge (`drawSpikeCross`'s own baked constants reach ~0.48-0.96 of the
 * design cell's half-width at 1x) - a small 1.15x safety margin so even the
 * requested max multiplier doesn't hard-clip a still-visible portion. */
function requiredCanvasCellSize(maxSpikeLengthMultiplier: number): number {
  const factor = Math.max(1, maxSpikeLengthMultiplier * 1.15);
  return Math.ceil(STAR_TWINKLE_CELL_SIZE * factor);
}

export function getTunableStarTwinkleAtlasTexture(): CanvasTexture | null {
  if (typeof document === "undefined") {
    return null;
  }
  if (!tunableCanvas) {
    tunableCanvas = document.createElement("canvas");
    tunableCanvas.width = STAR_TWINKLE_CELL_SIZE * 2;
    tunableCanvas.height = STAR_TWINKLE_CELL_SIZE;
    tunableTexture = new CanvasTexture(tunableCanvas);
  }
  return tunableTexture;
}

export function redrawStarTwinkleAtlas(
  normalSpikeLengthMultiplier: number,
  spikeWidthMultiplier: number,
  brilliantSpikeLengthMultiplier: number,
): void {
  const texture = getTunableStarTwinkleAtlasTexture();
  if (!tunableCanvas || !texture) {
    return;
  }
  const ctx = tunableCanvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const designCellSize = STAR_TWINKLE_CELL_SIZE;
  const canvasCellSize = requiredCanvasCellSize(
    Math.max(normalSpikeLengthMultiplier, brilliantSpikeLengthMultiplier),
  );
  if (tunableCanvas.width !== canvasCellSize * 2 || tunableCanvas.height !== canvasCellSize) {
    tunableCanvas.width = canvasCellSize * 2;
    tunableCanvas.height = canvasCellSize;
  } else {
    ctx.clearRect(0, 0, tunableCanvas.width, tunableCanvas.height);
  }
  drawNormalTwinkle(
    ctx,
    canvasCellSize * 0.5,
    canvasCellSize * 0.5,
    designCellSize,
    normalSpikeLengthMultiplier,
    spikeWidthMultiplier,
  );
  drawBrilliantTwinkle(
    ctx,
    canvasCellSize * 1.5,
    canvasCellSize * 0.5,
    designCellSize,
    brilliantSpikeLengthMultiplier,
    spikeWidthMultiplier,
  );
  texture.needsUpdate = true;
}

export function getStarTwinkleAtlasTexture(): CanvasTexture | null {
  if (starTwinkleAtlasTexture !== undefined) {
    return starTwinkleAtlasTexture;
  }
  if (typeof document === "undefined") {
    starTwinkleAtlasTexture = null;
    return starTwinkleAtlasTexture;
  }
  const cellSize = STAR_TWINKLE_CELL_SIZE;
  const canvas = document.createElement("canvas");
  canvas.width = cellSize * 2;
  canvas.height = cellSize;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    starTwinkleAtlasTexture = null;
    return starTwinkleAtlasTexture;
  }

  drawNormalTwinkle(ctx, cellSize * 0.5, cellSize * 0.5, cellSize);
  drawBrilliantTwinkle(ctx, cellSize * 1.5, cellSize * 0.5, cellSize);

  starTwinkleAtlasTexture = new CanvasTexture(canvas);
  return starTwinkleAtlasTexture;
}
