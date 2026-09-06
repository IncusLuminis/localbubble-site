import { RADIUS_PRESETS_PC, DEFAULT_RADIUS_PC } from "../scene/radiusFilter";
import { STAR_RENDER_STYLES, type StarRenderStyle } from "../scene/starRenderStyle";

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

// --- Settings panel (toolbar position #3): Radius + Object size + Save
// PNG export - confirmed placement with the human owner (Story #257 brief). ---

export interface SettingsPanelOptions {
  onRadiusChange: (radiusPc: number) => void;
  onSizeScaleChange: (scale: number) => void;
  onExportPng: () => void;
  /** Issue #10 (Epic #7): the persisted style to preselect this panel's new
   * "Star Rendering" control with at build time - `main.ts` passes whatever
   * `loadStarRenderStyle` already resolved (from `localStorage`, or the
   * default) before this panel is built, so a page reload's initial
   * `<select>` state correctly reflects the previously-chosen style instead
   * of always visually resetting to `MODEL`. */
  starRenderStyle: StarRenderStyle;
  onStarRenderStyleChange: (style: StarRenderStyle) => void;
}

/** Human-readable labels for the "Star Rendering" `<select>` below - kept as
 * its own small table (rather than showing the raw `StarRenderStyle` value
 * verbatim) so the UI can read as a plain sentence ("Model (default)")
 * without the underlying dispatch-key casing/wording being a UI concern. */
const STAR_RENDER_STYLE_LABELS: Record<StarRenderStyle, string> = {
  MODEL: "Model (default)",
  REALWORLD: "Real World (experimental)",
};

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
  // `scene/realworldStars.ts`). Same `<select>` pattern as the Radius
  // control just above, for visual consistency with this panel's existing
  // controls. ---
  const starRenderStyleSection = makeSection("Star Rendering");
  const starRenderStyleSelect = document.createElement("select");
  starRenderStyleSelect.className = "star-render-style-select";
  for (const style of STAR_RENDER_STYLES) {
    const option = document.createElement("option");
    option.value = style;
    option.textContent = STAR_RENDER_STYLE_LABELS[style];
    if (style === options.starRenderStyle) {
      option.selected = true;
    }
    starRenderStyleSelect.appendChild(option);
  }
  starRenderStyleSelect.addEventListener("change", () => {
    options.onStarRenderStyleChange(starRenderStyleSelect.value as StarRenderStyle);
  });
  starRenderStyleSection.body.appendChild(starRenderStyleSelect);
  panel.appendChild(starRenderStyleSection.section);

  // --- Object size scale (spec §23: "opacity / size ... where relevant") ---
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

  // --- Export (spec §39) ---
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

// --- Camera panel (toolbar position #4): the camera pose presets, MINUS
// "Fit all" (already its own dedicated toolbar icon, position #8, via
// `showAllButton`/`applyCameraPreset("fit-all")` - `main.ts` filters it out
// of the `cameraPresets` list passed in here rather than this module
// special-casing the key). Not lockable - camera navigation stays live
// throughout the UI lock per Epic #238's AC, same as before this Story. ---

export interface CameraPanelOptions {
  cameraPresets: CameraPresetItem[];
  onCameraPreset: (key: string) => void;
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

  return {
    element: panel,
    setOpen(open: boolean) {
      panel.classList.toggle("open", open);
    },
  };
}
