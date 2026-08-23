import type { ScenePlanetSummary, SceneExoplanetSummary } from "../scene/sceneTypes";
import { spectralColorFor } from "../scene/spectralColor";

/**
 * Exoplanet orbit schematic (Story #182, issue #172's Inspector follow-up),
 * appended below the Inspector's existing "Exoplanets" text summary row for
 * stars with `exoplanets.count > 0`. Deliberately NOT to true physical
 * scale (spec parity with issue #103's marker-radius tiers, which are
 * explicitly documented the same way): real systems span 2-3 orders of
 * magnitude in semi-major axis (e.g. GJ 876's planets range ~0.02-0.33 AU),
 * so a linear scale would either collapse the inner planets to a single
 * point or push the outer ones off the panel. A log scale keeps every
 * orbit visibly distinguishable in the ~200px panel this renders into.
 *
 * Module split, matching this codebase's existing convention (e.g.
 * `scene/labels.ts`'s `shouldShowLabel`/`selectNearestLabels` vs.
 * `createLabelsLayer`): the geometry/formatting logic below
 * (`orbitRadiusPx`, `planetDesignation`, `formatOrbitLabel`,
 * `buildOrbitLayout`) is pure and unit-tested directly
 * (`test/orbitDiagram.test.ts`); `createOrbitDiagramElement` at the bottom
 * builds real DOM/SVG and isn't unit-tested, since `vitest.config.ts` runs
 * with `environment: "node"` (same constraint noted in `ui/inspector.ts`
 * and `scene/labels.ts`).
 */

/** Default on-screen radius bounds (px) for the innermost/outermost drawn
 * orbit ring, tuned to fit inside the Inspector panel's ~212px content
 * width (`.panel` is 240px wide minus 2x14px padding, see `style.css`)
 * alongside a small margin for the star marker and outermost ring's label
 * number. */
export const DEFAULT_MIN_ORBIT_RADIUS_PX = 16;
export const DEFAULT_MAX_ORBIT_RADIUS_PX = 92;

/** Eccentricity below this is drawn as a plain circle rather than an
 * ellipse - real fitted eccentricities below ~0.05 are visually
 * indistinguishable from circular at this panel's small scale, so drawing
 * an ellipse would just add visual noise (and SVG rendering cost) for no
 * perceptible payoff. */
const ECCENTRICITY_ELLIPSE_THRESHOLD = 0.05;

/**
 * Maps a semi-major axis (AU) to an on-screen orbit ring radius (px) via a
 * **log** scale from `[minAu, maxAu]` to `[minRadiusPx, maxRadiusPx]` - the
 * per-star (not global-catalog) min/max of that star's own *positioned*
 * planets (`buildOrbitLayout` below computes these), so every system's
 * diagram uses its own full available radius range regardless of how
 * close together or far apart its planets happen to sit in absolute AU
 * terms. This is what actually satisfies the acceptance criteria's "both
 * very-close and more-distant planets are visibly distinguishable in a
 * small panel" - a single fixed global AU range would have compressed a
 * tightly-packed system (e.g. Barnard's Star: all four planets within
 * 0.02-0.04 AU) into a few indistinguishable pixels, defeating the point
 * of using a log scale at all.
 *
 * `minAu === maxAu` (a single positioned planet, or - in principle -
 * multiple planets sharing an identical semi-major axis) is a degenerate
 * case for a log-ratio scale: there's no meaningful "spread" to map across,
 * so it places the orbit at `maxRadiusPx` rather than dividing by zero.
 *
 * Values outside `[minAu, maxAu]` are clamped first (defensive: by
 * construction, callers only ever ask this for values within the range
 * they themselves computed the bounds from, but clamping keeps this
 * function's contract self-contained regardless of caller).
 */
export function orbitRadiusPx(
  semiMajorAxisAu: number,
  minAu: number,
  maxAu: number,
  minRadiusPx: number = DEFAULT_MIN_ORBIT_RADIUS_PX,
  maxRadiusPx: number = DEFAULT_MAX_ORBIT_RADIUS_PX,
): number {
  if (maxAu <= minAu) {
    return maxRadiusPx;
  }
  const clampedAu = Math.min(Math.max(semiMajorAxisAu, minAu), maxAu);
  const logMin = Math.log10(minAu);
  const logMax = Math.log10(maxAu);
  const t = (Math.log10(clampedAu) - logMin) / (logMax - logMin);
  return minRadiusPx + t * (maxRadiusPx - minRadiusPx);
}

/**
 * Extracts a compact orbit label's leading designation (e.g. "b", "d")
 * from a planet's full catalog name (e.g. "GJ 876 b", "Barnard d",
 * "Proxima Cen d"). NASA Exoplanet Archive planet names are, without
 * exception in this catalog, "<host star name> <lowercase letter>" - but
 * the host star's name here doesn't always match the *scene object's* own
 * `name`/`displayName` verbatim (e.g. "Proxima Cen" vs. the star's own
 * "NAME Proxima Centauri"), so stripping a known star-name prefix isn't
 * reliable. Instead this just takes the trailing whitespace-separated
 * token when it looks like a designation letter (starts with a lowercase
 * letter) - true of every planet name actually in the catalog (verified:
 * GJ 876 b/c/d/e, Barnard b/c/d/e, Proxima Cen b/d, GJ 1002 b/c, etc.).
 * Falls back to the full name for anything that doesn't match, so a future
 * catalog addition with an unexpected naming convention degrades to "show
 * the whole name" rather than silently mangling it.
 */
export function planetDesignation(name: string): string {
  const tokens = name.trim().split(/\s+/);
  const last = tokens[tokens.length - 1] ?? "";
  return /^[a-z][a-z0-9]*$/.test(last) ? last : name;
}

/** Compact "<designation> · <period> d" orbit label (e.g. "b · 61.1 d"),
 * or just the designation when `orbital_period_days` is null (mirroring
 * `formatPlanetSummary` in `ui/inspector.ts`'s existing text-row
 * convention of omitting the period rather than showing a fake one). */
export function formatOrbitLabel(planet: ScenePlanetSummary): string {
  const designation = planetDesignation(planet.name);
  return planet.orbital_period_days !== null
    ? `${designation} · ${planet.orbital_period_days.toFixed(1)} d`
    : designation;
}

/** One planet placed on the diagram: its ring radius (and, when
 * meaningfully eccentric, ellipse minor-radius), draw order (innermost
 * first), and compact label. */
export interface PositionedOrbit {
  planet: ScenePlanetSummary;
  label: string;
  /** Ring radius (px) - the ellipse's semi-major radius when `ryPx` is
   * set, otherwise a plain circle's radius. */
  rxPx: number;
  /** Ellipse semi-minor radius (px), only set when `orbital_eccentricity`
   * is meaningfully nonzero (see `ECCENTRICITY_ELLIPSE_THRESHOLD`). */
  ryPx: number | null;
}

/** Pure layout result for `createOrbitDiagramElement` - everything it
 * needs to draw, with no DOM/SVG concerns. */
export interface OrbitDiagramLayout {
  /** Positioned planets, ordered innermost-orbit-first. */
  orbits: PositionedOrbit[];
  /** Total known planets for this star (`exoplanets.count`), for the
   * "N of M shown" note when it exceeds `orbits.length`. */
  totalCount: number;
}

/**
 * Builds the pure layout for a star's orbit diagram, or `null` when there
 * is nothing drawable (no planets, or every planet lacks
 * `semi_major_axis_au`).
 *
 * Planets with a null `semi_major_axis_au` (older RV discoveries without a
 * fitted semi-major axis, per Story #181) are **omitted** from the
 * diagram rather than placed at a fabricated fallback position - the
 * current catalog has zero such planets (verified against `scene.json`),
 * but the exoplanet archive can and does have unmeasured semi-major axes
 * in general, so this stays defensive. Omitting (rather than inventing an
 * period-ordered placeholder radius) avoids drawing an orbit ring whose
 * position implies precision the source data doesn't have; the resulting
 * `totalCount` vs. `orbits.length` mismatch is surfaced by the caller as a
 * small "N of M shown" note per the acceptance criteria, so the omission
 * is visible rather than silent.
 */
export function buildOrbitLayout(exoplanets: SceneExoplanetSummary): OrbitDiagramLayout | null {
  const positionable = exoplanets.planets.filter(
    (planet): planet is ScenePlanetSummary & { semi_major_axis_au: number } =>
      planet.semi_major_axis_au !== null,
  );
  if (positionable.length === 0) {
    return null;
  }

  const sorted = [...positionable].sort((a, b) => a.semi_major_axis_au - b.semi_major_axis_au);
  const minAu = sorted[0].semi_major_axis_au;
  const maxAu = sorted[sorted.length - 1].semi_major_axis_au;

  const orbits: PositionedOrbit[] = sorted.map((planet) => {
    const rxPx = orbitRadiusPx(planet.semi_major_axis_au, minAu, maxAu);
    const eccentricity = planet.orbital_eccentricity;
    const ryPx =
      eccentricity !== null && eccentricity >= ECCENTRICITY_ELLIPSE_THRESHOLD
        ? rxPx * Math.sqrt(1 - eccentricity * eccentricity)
        : null;
    return { planet, label: formatOrbitLabel(planet), rxPx, ryPx };
  });

  return { orbits, totalCount: exoplanets.count };
}

const SVG_NS = "http://www.w3.org/2000/svg";
/** Square SVG viewBox side (px); the diagram is centered within it. */
const DIAGRAM_SIZE_PX = 2 * DEFAULT_MAX_ORBIT_RADIUS_PX + 24;
const CENTER_PX = DIAGRAM_SIZE_PX / 2;
const STAR_MARKER_RADIUS_PX = 5;

function toCssColor(hexColor: number): string {
  return `#${hexColor.toString(16).padStart(6, "0")}`;
}

/**
 * Builds the full orbit diagram DOM element (SVG schematic + text legend +
 * schematic/illustrative caption) for a star with `exoplanets.count > 0`,
 * or `null` when `buildOrbitLayout` finds nothing drawable (all planets
 * lack a semi-major axis) - callers should skip appending anything in that
 * case rather than show an empty diagram.
 *
 * Design choice: rather than placing each planet's name+period as SVG
 * text directly on/next to its ring (crowds badly when orbits sit only a
 * few px apart, e.g. Barnard's Star's four sub-0.04 AU planets), each ring
 * gets a small numbered marker at a distinct angle (fanned out by index so
 * numbers never overlap each other even when radii are close), and the
 * full "<designation> · <period>" text lives in a legend list below the
 * SVG, in the same innermost-first order. This keeps the panel legible at
 * its small (~212px) width while still satisfying "each orbit labeled
 * with its planet's name and orbital period" - just via a numbered
 * legend rather than crowded inline text.
 */
export function createOrbitDiagramElement(
  exoplanets: SceneExoplanetSummary,
  spectralType: string | null,
): HTMLElement | null {
  const layout = buildOrbitLayout(exoplanets);
  if (layout === null) {
    return null;
  }
  const { orbits, totalCount } = layout;

  const wrapper = document.createElement("div");
  wrapper.className = "orbit-diagram";

  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${DIAGRAM_SIZE_PX} ${DIAGRAM_SIZE_PX}`);
  svg.setAttribute("width", String(DIAGRAM_SIZE_PX));
  svg.setAttribute("height", String(DIAGRAM_SIZE_PX));
  svg.setAttribute("class", "orbit-diagram-svg");
  svg.setAttribute("role", "img");
  const svgTitle = document.createElementNS(SVG_NS, "title");
  svgTitle.textContent = "Schematic orbit diagram - relative order only, not to true scale.";
  svg.appendChild(svgTitle);

  orbits.forEach((orbit, index) => {
    const ring = document.createElementNS(SVG_NS, "ellipse");
    ring.setAttribute("cx", String(CENTER_PX));
    ring.setAttribute("cy", String(CENTER_PX));
    ring.setAttribute("rx", String(orbit.rxPx));
    ring.setAttribute("ry", String(orbit.ryPx ?? orbit.rxPx));
    ring.setAttribute("class", "orbit-diagram-ring");
    svg.appendChild(ring);

    const angleDeg = -90 + (360 / orbits.length) * index;
    const angleRad = (angleDeg * Math.PI) / 180;
    const markerX = CENTER_PX + orbit.rxPx * Math.cos(angleRad);
    const markerY = CENTER_PX + (orbit.ryPx ?? orbit.rxPx) * Math.sin(angleRad);

    const marker = document.createElementNS(SVG_NS, "circle");
    marker.setAttribute("cx", String(markerX));
    marker.setAttribute("cy", String(markerY));
    marker.setAttribute("r", "7");
    marker.setAttribute("class", "orbit-diagram-marker");
    svg.appendChild(marker);

    const markerLabel = document.createElementNS(SVG_NS, "text");
    markerLabel.setAttribute("x", String(markerX));
    markerLabel.setAttribute("y", String(markerY));
    markerLabel.setAttribute("class", "orbit-diagram-marker-label");
    markerLabel.setAttribute("text-anchor", "middle");
    markerLabel.setAttribute("dominant-baseline", "central");
    markerLabel.textContent = String(index + 1);
    svg.appendChild(markerLabel);
  });

  const star = document.createElementNS(SVG_NS, "circle");
  star.setAttribute("cx", String(CENTER_PX));
  star.setAttribute("cy", String(CENTER_PX));
  star.setAttribute("r", String(STAR_MARKER_RADIUS_PX));
  star.setAttribute("fill", toCssColor(spectralColorFor(spectralType)));
  star.setAttribute("class", "orbit-diagram-star");
  svg.appendChild(star);

  wrapper.appendChild(svg);

  const legend = document.createElement("div");
  legend.className = "orbit-diagram-legend";
  orbits.forEach((orbit, index) => {
    const row = document.createElement("div");
    row.className = "orbit-diagram-legend-row";
    row.textContent = `${index + 1}. ${orbit.label}`;
    legend.appendChild(row);
  });
  wrapper.appendChild(legend);

  if (orbits.length < totalCount) {
    const note = document.createElement("div");
    note.className = "orbit-diagram-note";
    note.textContent = `${orbits.length} of ${totalCount} planets shown - some lack orbit data.`;
    wrapper.appendChild(note);
  }

  const caption = document.createElement("div");
  caption.className = "orbit-diagram-caption";
  caption.textContent = "Schematic - relative order only, not to true scale.";
  caption.title = "Orbit radii are log-scaled for legibility, not physically to scale.";
  wrapper.appendChild(caption);

  return wrapper;
}
