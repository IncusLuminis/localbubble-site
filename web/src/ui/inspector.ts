import type { SceneExoplanetSummary, SceneObject, ScenePlanetSummary } from "../scene/sceneTypes";
import { cartesianToGalacticLB } from "../scene/galacticCoords";
import { displayName } from "../scene/labels";
import { STAR_OBJECT_TYPES } from "../scene/objects";
import { createOrbitDiagramElement } from "./orbitDiagram";

/**
 * The object inspector panel (spec Idea.md §24): "Clicking or selecting an
 * object should display its metadata" - name, type, distance, Galactic l/b,
 * Cartesian XYZ, source, per the spec's own worked example (Pleiades). Story
 * #172 adds three more rows - spectral type, absolute magnitude, and known
 * exoplanets - shown only for `star`-type objects (clusters/structures don't
 * carry these fields), using `STAR_OBJECT_TYPES` as the single source of
 * truth for "is this star-like" per issue #130.
 *
 * Plain DOM, no framework (spec §31), consistent with the rest of the app.
 * This module's `format*` helpers are exported and unit-tested directly
 * (see `test/inspector.test.ts`); `Inspector` itself isn't, since
 * `vitest.config.ts` runs with `environment: "node"` and `document` isn't
 * available there (same constraint noted in `infoDialog.ts`).
 *
 * Story #182 appends a visual orbit schematic (`ui/orbitDiagram.ts`) below
 * the row list above, for stars with `exoplanets.count > 0` - purely
 * additive, the existing text-based "Exoplanets" row above is unchanged.
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

/** Story #172: SIMBAD's raw spectral-type string, verbatim, or "Unknown"
 * when SIMBAD has none on record (per issue #172's acceptance criteria -
 * unlike `distance_error_pc` in `show()` below, this field gets an explicit
 * fallback label rather than a silently reshaped row, since there's no
 * "with error"/"without error" variant to fall back between). */
export function formatSpectralType(spectralType: string | null): string {
  return spectralType ?? "Unknown";
}

/** Story #172: absolute magnitude to one decimal place with a brief label
 * so a lone number (which could otherwise read as almost anything) is
 * legible as what it is, or "Unknown" when not available. */
export function formatAbsoluteMagnitude(absoluteMagnitude: number | null): string {
  return absoluteMagnitude !== null ? `M = ${formatNumber(absoluteMagnitude, 1)}` : "Unknown";
}

function formatPlanetSummary(planet: ScenePlanetSummary): string {
  return planet.orbital_period_days !== null
    ? `${planet.name} (${formatNumber(planet.orbital_period_days, 1)} d)`
    : planet.name;
}

/** Story #172: renders the known-exoplanets summary as a single "N known:
 * list" value, or `null` when there is nothing to show (no `exoplanets`
 * block, i.e. none on record for this star - the overwhelming majority, per
 * issue #172 - or a present-but-empty `planets` list) - the Inspector omits
 * the whole row in that case rather than adding a "None known" row to every
 * star, since exoplanets are the exception rather than the rule here. */
export function formatExoplanets(exoplanets: SceneExoplanetSummary | null): string | null {
  if (exoplanets === null || exoplanets.count === 0 || exoplanets.planets.length === 0) {
    return null;
  }
  const list = exoplanets.planets.map(formatPlanetSummary).join(", ");
  return `${exoplanets.count} known: ${list}`;
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
      ["Name", displayName(obj.name)],
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

    if (STAR_OBJECT_TYPES.has(obj.object_type)) {
      rows.push(["Spectral Type", formatSpectralType(obj.spectral_type)]);
      rows.push(["Absolute Magnitude", formatAbsoluteMagnitude(obj.absolute_magnitude)]);
      const exoplanets = formatExoplanets(obj.exoplanets);
      if (exoplanets !== null) {
        rows.push(["Exoplanets", exoplanets]);
      }
    }

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

    // Story #182: the orbit schematic, appended after the row list above
    // rather than folded into it (it's a diagram, not a label/value row).
    // Only for stars with at least one known exoplanet - `obj.exoplanets`
    // is non-null for ~5% of stars (Story #171) and never set on
    // non-star object types, matching the same `STAR_OBJECT_TYPES` gate
    // used for the Spectral Type/Absolute Magnitude/Exoplanets rows above.
    if (STAR_OBJECT_TYPES.has(obj.object_type) && obj.exoplanets !== null && obj.exoplanets.count > 0) {
      const diagram = createOrbitDiagramElement(obj.exoplanets, obj.spectral_type);
      if (diagram !== null) {
        this.content.appendChild(diagram);
      }
    }

    this.element.style.display = "block";
  }

  hide(): void {
    this.element.style.display = "none";
  }
}
