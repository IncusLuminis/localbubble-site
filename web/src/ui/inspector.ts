import type { SceneObject } from "../scene/sceneTypes";
import { cartesianToGalacticLB } from "../scene/galacticCoords";

/**
 * The object inspector panel (spec Idea.md §24): "Clicking or selecting an
 * object should display its metadata" - name, type, distance, Galactic l/b,
 * Cartesian XYZ, source, per the spec's own worked example (Pleiades).
 *
 * Plain DOM, no framework (spec §31), consistent with the rest of the app.
 */

function formatNumber(value: number, digits = 2): string {
  return value.toFixed(digits);
}

function humanizeType(objectType: string): string {
  return objectType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

export class Inspector {
  readonly element: HTMLDivElement;
  private readonly content: HTMLDivElement;

  constructor() {
    this.element = document.createElement("div");
    this.element.id = "inspector";
    this.element.className = "panel";
    this.element.style.display = "none";

    const title = document.createElement("div");
    title.className = "panel-title";
    title.textContent = "Inspector";
    this.element.appendChild(title);

    this.content = document.createElement("div");
    this.content.className = "panel-content";
    this.element.appendChild(this.content);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "inspector-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close inspector");
    closeButton.addEventListener("click", () => this.hide());
    this.element.appendChild(closeButton);
  }

  show(obj: SceneObject): void {
    const [x, y, z] = obj.position_pc;
    const { l_deg, b_deg } = cartesianToGalacticLB(x, y, z);

    this.content.replaceChildren();
    const rows: [string, string][] = [
      ["Name", obj.name],
      ["Type", humanizeType(obj.object_type)],
      [
        "Distance",
        obj.distance_error_pc !== null
          ? `${formatNumber(obj.distance_pc, 1)} ± ${formatNumber(obj.distance_error_pc, 1)} pc`
          : `${formatNumber(obj.distance_pc, 1)} pc`,
      ],
      ["Galactic l, b", `l = ${formatNumber(l_deg, 1)}°, b = ${formatNumber(b_deg, 1)}°`],
      [
        "Cartesian X, Y, Z",
        `X = ${formatNumber(x)} pc, Y = ${formatNumber(y)} pc, Z = ${formatNumber(z)} pc`,
      ],
      ["Source", obj.source.reference],
    ];

    for (const [label, value] of rows) {
      const row = document.createElement("div");
      row.className = "inspector-row";
      const labelEl = document.createElement("span");
      labelEl.className = "inspector-label";
      labelEl.textContent = label;
      const valueEl = document.createElement("span");
      valueEl.className = "inspector-value";
      valueEl.textContent = value;
      row.append(labelEl, valueEl);
      this.content.appendChild(row);
    }

    this.element.style.display = "block";
  }

  hide(): void {
    this.element.style.display = "none";
  }
}
