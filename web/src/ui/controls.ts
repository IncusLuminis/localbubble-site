import { RADIUS_PRESETS_PC, DEFAULT_RADIUS_PC } from "../scene/radiusFilter";
import { STAR_RENDER_STYLES, type StarRenderStyle } from "../scene/starRenderStyle";
import type { RealworldStarTuning } from "../scene/realworldStars";
import type { MarkerOpacityTuning } from "../scene/objects";

/** Issue #18: whether the REALWORLD tuning groups (Bloom/Stars/Spikes/
 * Distance) should be visible for a given Star Rendering style - pulled out
 * as its own pure function (rather than inlined into the `.classList.toggle`
 * call site below) so it's unit-testable without a real DOM, mirroring
 * `ui/fullscreenToggle.ts`'s `fullscreenButtonState` (this repo's
 * `environment: "node"` Vitest config has no jsdom - see that function's own
 * docstring for the same split elsewhere in this codebase). */
export function shouldShowRealworldTuning(style: StarRenderStyle): boolean {
  return style === "REALWORLD";
}

/** Issue #18 follow-up: the MODEL-only mirror of `shouldShowRealworldTuning`
 * above, gating the new "Model" tuning section's (Marker opacity/Diffuse
 * structure opacity) visibility. Kept as its own named predicate rather than
 * just calling `!shouldShowRealworldTuning(style)` at the two show/hide call
 * sites - reads as "should this section show" at a glance, same as its
 * REALWORLD counterpart, and stays correct on its own terms even though
 * `StarRenderStyle` only has two members today. */
export function shouldShowModelTuning(style: StarRenderStyle): boolean {
  return style === "MODEL";
}

/**
 * Story #257 (Epic #255): the old single combined `#controls` panel
 * (Object categories + Layers checkboxes + Radius + Object size + Camera
 * presets + Save PNG, opened via the retired `#menu-toggle` hamburger) is
 * split into three separate non-modal panels built by this module - Layers,
 * Settings, Camera - each opened/closed independently via its own new
 * `#left-toolbar` trigger icon (`main.ts`, toolbar positions #2/#3/#4).
 * Plain DOM, no framework (spec §31), same convention as the single panel
 * this replaces. All underlying category/structure/labels/radius/size/
 * camera-preset/export callback wiring is unchanged from that panel - only
 * presentation and entry points are reorganized here.
 *
 * Issue #20: Save PNG export subsequently moved from the Settings panel to
 * the Camera panel (a camera/view-export concern, not a settings one) -
 * `onExportPng` wiring itself is unchanged, only which panel renders it.
 */

export interface ToggleItem {
  key: string;
  label: string;
  defaultChecked?: boolean;
}

export interface CameraPresetItem {
  key: string;
  label: string;
}

function makeSection(titleText: string): { section: HTMLDivElement; body: HTMLDivElement } {
  const section = document.createElement("div");
  section.className = "panel-section";
  const title = document.createElement("div");
  title.className = "panel-section-title";
  title.textContent = titleText;
  section.appendChild(title);
  const body = document.createElement("div");
  body.className = "panel-section-body";
  section.appendChild(body);
  return { section, body };
}

function makeCheckbox(
  item: ToggleItem,
  onChange: (key: string, checked: boolean) => void,
): { row: HTMLLabelElement; input: HTMLInputElement } {
  const label = document.createElement("label");
  label.className = "toggle-row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = item.defaultChecked ?? true;
  input.addEventListener("change", () => onChange(item.key, input.checked));
  const text = document.createElement("span");
  text.textContent = item.label;
  label.append(input, text);
  return { row: label, input };
}

/** Shared open/close shape for all three of this Story's new side panels -
 * `.open` class toggle, mirroring `ui/playerPanel.ts`'s `setVisible`/
 * `#player-panel.open` convention (and the retired `#menu-panels.open`
 * before it) rather than inventing a new show/hide mechanism. */
export interface SidePanelHandle {
  element: HTMLDivElement;
  setOpen: (open: boolean) => void;
}

function createSidePanel(id: string, titleText: string): { panel: HTMLDivElement } {
  const panel = document.createElement("div");
  panel.id = id;
  panel.className = "panel side-panel";
  const title = document.createElement("div");
  title.className = "panel-title";
  title.textContent = titleText;
  panel.appendChild(title);
  return { panel };
}

// --- Layers panel (toolbar position #2): merges the old panel's "Object
// categories" and "Layers" (Galactic Plane/Gould Belt/Radcliffe Wave/Local
// Bubble/Labels) sections under one trigger. ---

export interface LayersPanelOptions {
  categories: ToggleItem[];
  structureLayers: ToggleItem[];
  onCategoryToggle: (key: string, visible: boolean) => void;
  onStructureToggle: (key: string, visible: boolean) => void;
  onLabelsToggle: (visible: boolean) => void;
  labelsDefaultChecked?: boolean;
}

/**
 * Story #239's UI lock (Epic #238: category/structure checkboxes disabled
 * whenever the motion player's time is away from Today) used to carry over
 * onto this panel via `setLocked` below. Story #330 removed that mechanism
 * entirely (confirmed decision: these controls, like the toolbar buttons,
 * are now always fully active regardless of player time/play state), so
 * this handle no longer has a lock capability.
 */
export type LayersPanelHandle = SidePanelHandle;

export function createLayersPanel(options: LayersPanelOptions): LayersPanelHandle {
  const { panel } = createSidePanel("layers-panel", "Layers");

  // --- Object categories (spec §23: stars/clusters/associations/etc) ---
  const categoriesSection = makeSection("Object categories");
  for (const item of options.categories) {
    const { row } = makeCheckbox(item, options.onCategoryToggle);
    categoriesSection.body.appendChild(row);
  }
  panel.appendChild(categoriesSection.section);

  // --- Structure/model layers (Galactic Plane, Gould Belt, Radcliffe
  // Wave, Local Bubble - spec §23) plus Labels. Section retitled
  // "Structures" (was "Layers" in the old combined panel) so it doesn't
  // read as a duplicate of this panel's own "Layers" title above. ---
  const structuresSection = makeSection("Structures");
  for (const item of options.structureLayers) {
    const { row } = makeCheckbox(item, options.onStructureToggle);
    structuresSection.body.appendChild(row);
  }
  const { row: labelsRow } = makeCheckbox(
    { key: "labels", label: "Labels", defaultChecked: options.labelsDefaultChecked ?? true },
    (_key, checked) => options.onLabelsToggle(checked),
  );
  structuresSection.body.appendChild(labelsRow);
  panel.appendChild(structuresSection.section);

  return {
    element: panel,
    setOpen(open: boolean) {
      panel.classList.toggle("open", open);
    },
  };
}

// --- Settings panel (toolbar position #3): Radius + Object size - confirmed
// placement with the human owner (Story #257 brief). Save PNG export moved
// out to the Camera panel (issue #20) since it's a camera/view-export
// concern, not a settings one. ---

/** `main.ts`'s `UnrealBloomPass` config (strength/radius/threshold) - not a
 * type this module owns any deeper meaning for, just the shape
 * `onBloomTuningChange` below patches. Kept separate from
 * `RealworldStarTuning` (`scene/realworldStars.ts`) since it's a render-pass
 * concern `main.ts` applies directly to its own `bloomPass`, not a
 * `RealworldStarLayer` uniform. */
export interface BloomTuning {
  strength: number;
  radius: number;
  threshold: number;
}

export interface SettingsPanelOptions {
  onRadiusChange: (radiusPc: number) => void;
  onSizeScaleChange: (scale: number) => void;
  /** Issue #10 (Epic #7): the persisted style to preselect this panel's new
   * "Star Rendering" control with at build time - `main.ts` passes whatever
   * `loadStarRenderStyle` already resolved (from `localStorage`, or the
   * default) before this panel is built, so a page reload's initial
   * `<select>` state correctly reflects the previously-chosen style instead
   * of always visually resetting to `MODEL`. */
  starRenderStyle: StarRenderStyle;
  onStarRenderStyleChange: (style: StarRenderStyle) => void;
  /** Issue #18 (Epic #7): current values to seed the REALWORLD tuning
   * sliders below with - `main.ts` passes its own live `bloomPass`
   * strength/radius/threshold and `realworldStarTuning` state (starting at
   * `DEFAULT_REALWORLD_STAR_TUNING`, issue #16's final tuned defaults) so a
   * panel rebuild (there isn't one today, but nothing here assumes a single
   * page-load call) would reflect the current values, not the sliders'
   * historical prototype defaults. */
  bloomTuning: BloomTuning;
  onBloomTuningChange: (patch: Partial<BloomTuning>) => void;
  realworldStarTuning: RealworldStarTuning;
  onRealworldStarTuningChange: (patch: Partial<RealworldStarTuning>) => void;
  /** Issue #18 follow-up: current values to seed the new MODEL-only "Model"
   * tuning section's sliders with - `main.ts` passes its own
   * `DEFAULT_MARKER_OPACITY_TUNING` copy (no persistence yet, same as
   * `bloomTuning` above). */
  modelMarkerOpacityTuning: MarkerOpacityTuning;
  onModelMarkerOpacityChange: (patch: Partial<MarkerOpacityTuning>) => void;
}

/** Shared slider-row builder for the REALWORLD tuning controls (issue #18,
 * promoted from #16's debug HUD `addSlider`) - a label showing the current
 * value plus a `<input type=range>`, styled via `.tuning-slider-row`
 * (`style.css`) rather than the HUD's own inline styles. */
function makeSlider(
  label: string,
  min: number,
  max: number,
  step: number,
  initial: number,
  onInput: (value: number) => void,
): HTMLDivElement {
  const row = document.createElement("div");
  row.className = "tuning-slider-row";

  const labelEl = document.createElement("div");
  labelEl.className = "tuning-slider-label";
  labelEl.textContent = `${label}: ${initial}`;
  row.appendChild(labelEl);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(initial);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    labelEl.textContent = `${label}: ${value}`;
    onInput(value);
  });
  row.appendChild(input);

  return row;
}

/** Human-readable labels for the "Star Rendering" toggle below - kept as its
 * own small table (rather than showing the raw `StarRenderStyle` value
 * verbatim) so the underlying dispatch-key casing/wording is never a UI
 * concern. Issue #18 follow-up: shortened from the old `<select>`'s
 * "Model (default)"/"Real World (experimental)" option text - a compact
 * two-segment toggle has no room for the parenthetical, and the segment
 * that's currently active already reads as "the current choice" without
 * needing "(default)" spelled out. */
const STAR_RENDER_STYLE_LABELS: Record<StarRenderStyle, string> = {
  MODEL: "Model",
  REALWORLD: "Real World",
};

/**
 * Issue #18 follow-up: replaces the old plain `<select>` (human owner
 * feedback: "чудовищно"/hideous) with a compact pill-shaped two-segment
 * toggle - one `<button>` per `StarRenderStyle`, the active one highlighted
 * via the same `.active` background-fill convention `#left-toolbar`'s own
 * toggle-style buttons already use for "which of two states is active"
 * (`style.css`'s `.toolbar-button.active`/`.player-transport.active`),
 * rather than inventing a new visual language for the same idea. Native
 * `<button>`s (not styled `<div>`s) so the control stays keyboard/
 * screen-reader accessible for free, same reasoning as every other clickable
 * control in this panel.
 *
 * Fires `onChange` only on an actual style change (clicking the
 * already-active segment is a no-op) - mirrors the old `<select>`'s
 * `change` event, which likewise never fired for reselecting the current
 * option. */
function createStarRenderStyleToggle(
  initialStyle: StarRenderStyle,
  onChange: (style: StarRenderStyle) => void,
): HTMLDivElement {
  const toggle = document.createElement("div");
  toggle.className = "star-render-toggle";
  toggle.setAttribute("role", "group");

  let currentStyle = initialStyle;
  const buttons = new Map<StarRenderStyle, HTMLButtonElement>();

  function setActive(style: StarRenderStyle): void {
    currentStyle = style;
    for (const [candidateStyle, button] of buttons) {
      button.classList.toggle("active", candidateStyle === style);
    }
  }

  for (const style of STAR_RENDER_STYLES) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "star-render-toggle-option";
    button.textContent = STAR_RENDER_STYLE_LABELS[style];
    button.addEventListener("click", () => {
      if (style === currentStyle) {
        return;
      }
      setActive(style);
      onChange(style);
    });
    buttons.set(style, button);
    toggle.appendChild(button);
  }

  setActive(initialStyle);
  return toggle;
}

/** Same UI-lock removal as `LayersPanelHandle` (Story #330) - the Radius
 * `<select>` used to be the one lockable control here; it's always live now,
 * like every other control in this panel. */
export type SettingsPanelHandle = SidePanelHandle;

export function createSettingsPanel(options: SettingsPanelOptions): SettingsPanelHandle {
  const { panel } = createSidePanel("settings-panel", "Settings");

  // --- Radius filter (spec §28) ---
  const radiusSection = makeSection("Max Distance from Sun");
  const radiusSelect = document.createElement("select");
  radiusSelect.className = "radius-select";
  for (const radiusPc of RADIUS_PRESETS_PC) {
    const option = document.createElement("option");
    option.value = String(radiusPc);
    option.textContent = radiusPc >= 1000 ? `${radiusPc / 1000} kpc` : `${radiusPc} pc`;
    if (radiusPc === DEFAULT_RADIUS_PC) {
      option.selected = true;
    }
    radiusSelect.appendChild(option);
  }
  radiusSelect.addEventListener("change", () => {
    options.onRadiusChange(Number(radiusSelect.value));
  });
  radiusSection.body.appendChild(radiusSelect);
  panel.appendChild(radiusSection.section);

  // --- Star rendering style (issue #10, Epic #7): MODEL (today's exact,
  // unchanged rendering, default) vs REALWORLD (issue #11's own
  // `THREE.Points`-based twinkle-sprite/magnitude-driven-size system, see
  // `scene/realworldStars.ts`). Issue #18 follow-up: a compact two-segment
  // toggle (`createStarRenderStyleToggle` above) instead of the original
  // `<select>` - same underlying wiring (`onStarRenderStyleChange` plus this
  // panel's own tuning-section visibility toggles below), just a different
  // DOM element/interaction responding to it. ---
  const starRenderStyleSection = makeSection("Star Rendering");
  const starRenderStyleToggle = createStarRenderStyleToggle(options.starRenderStyle, (style) => {
    setModelTuningVisible(shouldShowModelTuning(style));
    setRealworldTuningVisible(shouldShowRealworldTuning(style));
    options.onStarRenderStyleChange(style);
  });
  starRenderStyleSection.body.appendChild(starRenderStyleToggle);
  panel.appendChild(starRenderStyleSection.section);

  // --- Object size scale (spec §23: "opacity / size ... where relevant") -
  // applies uniformly to BOTH styles (see this option's own docstring in
  // `main.ts`), so unlike the REALWORLD-only groups below it's never hidden. ---
  const sizeSection = makeSection("Object size");
  const sizeSlider = document.createElement("input");
  sizeSlider.type = "range";
  sizeSlider.min = "0.5";
  sizeSlider.max = "3";
  sizeSlider.step = "0.1";
  sizeSlider.value = "1";
  sizeSlider.className = "size-slider";
  sizeSlider.addEventListener("input", () => {
    options.onSizeScaleChange(Number(sizeSlider.value));
  });
  sizeSection.body.appendChild(sizeSlider);
  panel.appendChild(sizeSection.section);

  // --- MODEL tuning (issue #18 follow-up): the human owner pushed back on
  // this panel's original MODEL audit (which stopped at "Object size" -
  // marker radius/`markerRadiusPc` - as MODEL's only exposable knob) and
  // asked specifically for opacity controls. `objects.ts`'s `markerOpacityFor`
  // already tiers every marker's opacity by type (stars/clusters/
  // associations opaque, diffuse structures translucent - see that
  // function's own docstring) off two now-configurable values
  // (`MarkerOpacityTuning`), so both tiers are exposed here as their own
  // slider rather than one shared control that would conflate two visually
  // distinct object kinds. Shown only while Star Rendering is MODEL
  // (`.visible` toggled below and on every toggle-click above), mirroring
  // the REALWORLD tuning container's own show/hide mechanism exactly - no
  // second visibility convention invented for this section. Per this
  // issue's explicit scope, MODEL's per-magnitude color-darkening table
  // (`magnitudeBrightness.ts`'s `BRIGHTNESS_BUCKETS`, a fitted 8-bucket
  // lookup, not a single scalar a slider could sensibly represent) is left
  // untouched - these two opacity sliders are the full scope, not a
  // springboard for a bigger MODEL feature. ---
  const modelTuningContainer = document.createElement("div");
  modelTuningContainer.className = "model-tuning";

  const modelOpacitySection = makeSection("Model");
  modelOpacitySection.body.appendChild(
    makeSlider(
      "Marker opacity",
      0,
      1,
      0.05,
      options.modelMarkerOpacityTuning.opaqueMarkerOpacity,
      (v) => options.onModelMarkerOpacityChange({ opaqueMarkerOpacity: v }),
    ),
  );
  modelOpacitySection.body.appendChild(
    makeSlider(
      "Diffuse structure opacity",
      0,
      1,
      0.05,
      options.modelMarkerOpacityTuning.extendedStructureOpacity,
      (v) => options.onModelMarkerOpacityChange({ extendedStructureOpacity: v }),
    ),
  );
  modelTuningContainer.appendChild(modelOpacitySection.section);

  panel.appendChild(modelTuningContainer);

  function setModelTuningVisible(visible: boolean): void {
    modelTuningContainer.classList.toggle("visible", visible);
  }
  setModelTuningVisible(shouldShowModelTuning(options.starRenderStyle));

  // --- REALWORLD tuning (issue #18, promoted from #16's debug HUD): bloom/
  // brightness/spike/distance-falloff controls. Shown only while Star
  // Rendering is REALWORLD (`.visible` toggled below and on every toggle-
  // click above) since none of them affect MODEL's rendering. ---
  const realworldTuningContainer = document.createElement("div");
  realworldTuningContainer.className = "realworld-tuning";

  const bloomSection = makeSection("Bloom");
  bloomSection.body.appendChild(
    makeSlider("Bloom strength", 0, 3, 0.05, options.bloomTuning.strength, (v) =>
      options.onBloomTuningChange({ strength: v }),
    ),
  );
  bloomSection.body.appendChild(
    makeSlider("Bloom radius", 0, 1, 0.02, options.bloomTuning.radius, (v) =>
      options.onBloomTuningChange({ radius: v }),
    ),
  );
  bloomSection.body.appendChild(
    makeSlider("Bloom threshold", 0, 1, 0.02, options.bloomTuning.threshold, (v) =>
      options.onBloomTuningChange({ threshold: v }),
    ),
  );
  bloomSection.body.appendChild(
    makeSlider(
      "Color bloom compensation",
      0,
      1,
      0.05,
      options.realworldStarTuning.colorBloomCompensation,
      (v) => options.onRealworldStarTuningChange({ colorBloomCompensation: v }),
    ),
  );
  realworldTuningContainer.appendChild(bloomSection.section);

  const starsSection = makeSection("Stars");
  starsSection.body.appendChild(
    makeSlider(
      "Normal-tier size boost",
      0.5,
      6,
      0.1,
      options.realworldStarTuning.normalBoost,
      (v) => options.onRealworldStarTuningChange({ normalBoost: v }),
    ),
  );
  starsSection.body.appendChild(
    makeSlider(
      "Brilliant-tier boost",
      1,
      3,
      0.05,
      options.realworldStarTuning.brilliantBoost,
      (v) => options.onRealworldStarTuningChange({ brilliantBoost: v }),
    ),
  );
  starsSection.body.appendChild(
    makeSlider(
      "Faint-star minimum size (px)",
      0,
      80,
      1,
      options.realworldStarTuning.minSizePx,
      (v) => options.onRealworldStarTuningChange({ minSizePx: v }),
    ),
  );
  realworldTuningContainer.appendChild(starsSection.section);

  const spikesSection = makeSection("Spikes");
  spikesSection.body.appendChild(
    makeSlider(
      "Spike length (all stars)",
      0.5,
      3,
      0.05,
      options.realworldStarTuning.spikeLength,
      (v) => options.onRealworldStarTuningChange({ spikeLength: v }),
    ),
  );
  spikesSection.body.appendChild(
    makeSlider(
      "Spike length (brightest)",
      0.5,
      4,
      0.05,
      options.realworldStarTuning.brilliantSpikeLength,
      (v) => options.onRealworldStarTuningChange({ brilliantSpikeLength: v }),
    ),
  );
  spikesSection.body.appendChild(
    makeSlider("Spike width", 0.5, 3, 0.05, options.realworldStarTuning.spikeWidth, (v) =>
      options.onRealworldStarTuningChange({ spikeWidth: v }),
    ),
  );
  spikesSection.body.appendChild(
    makeSlider(
      "Intensity (all stars)",
      0.2,
      4,
      0.05,
      options.realworldStarTuning.intensity,
      (v) => options.onRealworldStarTuningChange({ intensity: v }),
    ),
  );
  realworldTuningContainer.appendChild(spikesSection.section);

  const distanceSection = makeSection("Distance");
  distanceSection.body.appendChild(
    makeSlider(
      "Distance falloff start (pc)",
      20,
      2000,
      10,
      options.realworldStarTuning.attenStartPc,
      (v) => options.onRealworldStarTuningChange({ attenStartPc: v }),
    ),
  );
  distanceSection.body.appendChild(
    makeSlider(
      "Distance falloff strength",
      0,
      1.5,
      0.05,
      options.realworldStarTuning.attenStrength,
      (v) => options.onRealworldStarTuningChange({ attenStrength: v }),
    ),
  );
  realworldTuningContainer.appendChild(distanceSection.section);

  panel.appendChild(realworldTuningContainer);

  function setRealworldTuningVisible(visible: boolean): void {
    realworldTuningContainer.classList.toggle("visible", visible);
  }
  setRealworldTuningVisible(shouldShowRealworldTuning(options.starRenderStyle));

  return {
    element: panel,
    setOpen(open: boolean) {
      panel.classList.toggle("open", open);
    },
  };
}

// --- Camera panel (toolbar position #4): the camera pose presets, MINUS
// "Fit all" (already its own dedicated toolbar icon, position #8, via
// `showAllButton`/`applyCameraPreset("fit-all")` - `main.ts` filters it out
// of the `cameraPresets` list passed in here rather than this module
// special-casing the key). Not lockable - camera navigation stays live
// throughout the UI lock per Epic #238's AC, same as before this Story. ---

export interface CameraPanelOptions {
  cameraPresets: CameraPresetItem[];
  onCameraPreset: (key: string) => void;
  onExportPng: () => void;
}

export function createCameraPanel(options: CameraPanelOptions): SidePanelHandle {
  const { panel } = createSidePanel("camera-panel", "Camera");

  const cameraSection = makeSection("Views");
  const cameraButtonRow = document.createElement("div");
  cameraButtonRow.className = "camera-preset-row";
  for (const preset of options.cameraPresets) {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = preset.label;
    button.addEventListener("click", () => options.onCameraPreset(preset.key));
    cameraButtonRow.appendChild(button);
  }
  cameraSection.body.appendChild(cameraButtonRow);
  panel.appendChild(cameraSection.section);

  // --- Export (spec §39) - moved here from the Settings panel (issue #20):
  // framing/presets/view export are all camera-adjacent concerns. ---
  const exportSection = makeSection("Export");
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Save PNG";
  exportButton.addEventListener("click", () => options.onExportPng());
  exportSection.body.appendChild(exportButton);
  panel.appendChild(exportSection.section);

  return {
    element: panel,
    setOpen(open: boolean) {
      panel.classList.toggle("open", open);
    },
  };
}
