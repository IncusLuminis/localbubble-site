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
function drawNormalTwinkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, cellSize: number): void {
  drawHalo(ctx, cx, cy, cellSize * 0.3, 0.5);
  ctx.translate(cx, cy);
  drawSpikeCross(ctx, 4, cellSize * 0.42, cellSize * 0.028);
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
function drawBrilliantTwinkle(ctx: CanvasRenderingContext2D, cx: number, cy: number, cellSize: number): void {
  drawHalo(ctx, cx, cy, cellSize * 0.46, 0.65);
  ctx.translate(cx, cy);
  drawSpikeCross(ctx, 4, cellSize * 0.48, cellSize * 0.032);
  ctx.rotate(Math.PI / 4);
  drawSpikeCross(ctx, 4, cellSize * 0.3, cellSize * 0.02);
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
