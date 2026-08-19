/**
 * Field-of-view extent readout (issue #125, spotted during live testing on
 * Epic #121): a small, unobtrusive bottom-right readout showing the current
 * view's real-world horizontal/vertical extent in pc, alongside the radius
 * filter/camera presets as spatial-scale context.
 *
 * Deliberately mirrors `#status`'s (bottom-left, `main.ts`) minimal-chrome
 * style - plain text, no panel chrome/border/background box like
 * `.panel` (`#controls`/`#inspector`/`#search`) - rather than those
 * interactive panels, since this is a passive, non-interactive readout.
 * Plain DOM, no framework, consistent with the rest of `ui/` (see
 * `ui/search.ts`'s docstring).
 */

const KPC_THRESHOLD_PC = 1000;

/** Adaptive precision/unit so the readout stays readable across the app's
 * full zoom range (spec: a few pc close-up up to 800pc+ overviews, star
 * markers as small as ~0.02pc per issue #119) - plain decimals close in,
 * fewer decimals as the value grows, and a coarser "kpc" unit once the
 * number would otherwise need 4+ integer digits. */
export function formatExtentPc(valuePc: number): string {
  if (!Number.isFinite(valuePc)) {
    return "-";
  }
  const abs = Math.abs(valuePc);
  if (abs >= KPC_THRESHOLD_PC) {
    return `${(valuePc / 1000).toFixed(2)} kpc`;
  }
  if (abs < 1) {
    return `${valuePc.toFixed(3)} pc`;
  }
  if (abs < 10) {
    return `${valuePc.toFixed(2)} pc`;
  }
  if (abs < 100) {
    return `${valuePc.toFixed(1)} pc`;
  }
  return `${Math.round(valuePc)} pc`;
}

export interface FovReadout {
  element: HTMLDivElement;
  /** Updates the displayed text. Called each frame from `main.ts`'s
   * `animate()` loop, following the same per-frame-update pattern as
   * `applySunCoreScale`/`updateLabelVisibility`. */
  update: (horizontalPc: number, verticalPc: number) => void;
}

export function createFovReadout(): FovReadout {
  const element = document.createElement("div");
  element.id = "fov-readout";

  function update(horizontalPc: number, verticalPc: number): void {
    element.textContent = `View: ${formatExtentPc(horizontalPc)} × ${formatExtentPc(verticalPc)}`;
  }

  update(0, 0);

  return { element, update };
}
