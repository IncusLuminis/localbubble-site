import { RADIUS_PRESETS_PC, DEFAULT_RADIUS_PC } from "../scene/radiusFilter";

/**
 * The main control panel (spec Idea.md §2's conceptual UI sketch: category
 * toggles, structure-layer checkboxes, a radius control, plus this Story's
 * additions - camera presets and PNG export). Plain DOM, no framework (spec
 * §31).
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

export interface ControlPanelOptions {
  categories: ToggleItem[];
  structureLayers: ToggleItem[];
  onCategoryToggle: (key: string, visible: boolean) => void;
  onStructureToggle: (key: string, visible: boolean) => void;
  onLabelsToggle: (visible: boolean) => void;
  labelsDefaultChecked?: boolean;
  onRadiusChange: (radiusPc: number) => void;
  cameraPresets: CameraPresetItem[];
  onCameraPreset: (key: string) => void;
  onExportPng: () => void;
  onSizeScaleChange: (scale: number) => void;
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
): HTMLLabelElement {
  const label = document.createElement("label");
  label.className = "toggle-row";
  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = item.defaultChecked ?? true;
  input.addEventListener("change", () => onChange(item.key, input.checked));
  const text = document.createElement("span");
  text.textContent = item.label;
  label.append(input, text);
  return label;
}

export function createControlPanel(options: ControlPanelOptions): HTMLDivElement {
  const panel = document.createElement("div");
  panel.id = "controls";
  panel.className = "panel";

  const title = document.createElement("div");
  title.className = "panel-title";
  title.textContent = "Local Galactic Structures";
  panel.appendChild(title);

  // --- Object categories (spec §23: stars/clusters/associations/etc) ---
  const categoriesSection = makeSection("Object categories");
  for (const item of options.categories) {
    categoriesSection.body.appendChild(
      makeCheckbox(item, options.onCategoryToggle),
    );
  }
  panel.appendChild(categoriesSection.section);

  // --- Structure/model layers (Galactic Plane, Gould Belt, Radcliffe
  // Wave, Local Bubble - spec §23) ---
  const structuresSection = makeSection("Layers");
  for (const item of options.structureLayers) {
    structuresSection.body.appendChild(
      makeCheckbox(item, options.onStructureToggle),
    );
  }
  const labelsRow = makeCheckbox(
    { key: "labels", label: "Labels", defaultChecked: options.labelsDefaultChecked ?? true },
    (_key, checked) => options.onLabelsToggle(checked),
  );
  structuresSection.body.appendChild(labelsRow);
  panel.appendChild(structuresSection.section);

  // --- Radius filter (spec §28) ---
  const radiusSection = makeSection("Radius");
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

  // --- Object size scale (spec §23: "opacity / size ... where relevant")
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

  // --- Camera presets (spec §29) ---
  const cameraSection = makeSection("Camera");
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

  // --- Export (spec §39) ---
  const exportSection = makeSection("Export");
  const exportButton = document.createElement("button");
  exportButton.type = "button";
  exportButton.textContent = "Save PNG";
  exportButton.addEventListener("click", () => options.onExportPng());
  exportSection.body.appendChild(exportButton);
  panel.appendChild(exportSection.section);

  return panel;
}
