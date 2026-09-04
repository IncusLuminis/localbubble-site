/**
 * The "S" (Simplifications and Sources) button's modal: a centered overlay
 * listing the deliberate simplifications/abstractions this visualization
 * makes, and the literature/data sources behind each. Mirrors
 * `infoDialog.ts`'s exact structure/behavior (same scrim/close/Escape
 * pattern, same CSS classes reused so no new styling is needed) - see that
 * file's own docstring for why DOM construction here isn't unit-tested
 * while the open/close *logic* (`isEscapeKey`/`isScrimClick`, imported from
 * `infoDialog.ts` rather than duplicated) is.
 */

import { appendHeading, appendParagraph, appendSourceList, isEscapeKey, isScrimClick } from "./infoDialog";

function appendLinkedSourceList(parent: HTMLElement, items: readonly { text: string; href: string }[]): void {
  const ul = document.createElement("ul");
  for (const { text, href } of items) {
    const li = document.createElement("li");
    const a = document.createElement("a");
    a.href = href;
    a.textContent = text;
    a.target = "_blank";
    a.rel = "noopener";
    li.appendChild(a);
    ul.appendChild(li);
  }
  parent.appendChild(ul);
}

function buildContent(): HTMLDivElement {
  const content = document.createElement("div");
  content.className = "info-dialog-content";

  appendHeading(content, "h2", "Simplifications & Sources");
  appendParagraph(
    content,
    "This visualization is built from real, cited measurements wherever possible - but " +
      "turning a scattered, messy, three-dimensional reality into a navigable scene " +
      "requires deliberate simplifications. This page lists the ones that matter most, so " +
      "the picture doesn't get mistaken for more precise or more complete than it is.",
  );

  appendHeading(content, "h3", "1. The large-scale structures are abstractions, not hard boundaries");
  appendParagraph(
    content,
    "The <strong>Gould Belt</strong>, <strong>Local Bubble</strong>, <strong>Radcliffe " +
      "Wave</strong>, and the nearby-stars sphere are each a researcher's fitted MODEL of a " +
      "real but fuzzy, gradual structure in the interstellar medium - not a wall with a " +
      "sharp edge. Gas density, stellar membership, and the associated structures all " +
      "fade in and out gradually; different research groups have proposed different shapes " +
      "and extents for the same real structure, and the boundary you see here is one " +
      "specific model's best fit, not a physical surface.",
  );
  appendSourceList(content, [
    "<strong>Gould Belt</strong> — Perrot &amp; Grenier (2003), <em>A&amp;A</em> 404, 519–531, " +
      '<a href="https://doi.org/10.1051/0004-6361:20030477" target="_blank" rel="noopener">doi.org/10.1051/0004-6361:20030477</a>',
    "<strong>Radcliffe Wave</strong> — Konietzka et al. (2024), " +
      '"The Radcliffe Wave is oscillating," <em>Nature</em> 626, 63–68, ' +
      '<a href="https://doi.org/10.1038/s41586-024-07127-3" target="_blank" rel="noopener">doi.org/10.1038/s41586-024-07127-3</a>',
    "<strong>Local Bubble</strong> — Alves et al. (2018), " +
      '"The Local Bubble: a magnetic veil to our Galaxy," <em>A&amp;A</em> 611, L5, ' +
      '<a href="https://doi.org/10.1051/0004-6361/201832637" target="_blank" rel="noopener">doi.org/10.1051/0004-6361/201832637</a>',
    "<strong>Nearby-stars sphere (~11.26 pc)</strong> — RECONS, " +
      '"The 100 Nearest Star Systems," ' +
      '<a href="https://www.astro.gsu.edu/RECONS/TOP100.posted.htm" target="_blank" rel="noopener">astro.gsu.edu/RECONS/TOP100.posted.htm</a>',
  ]);
  appendParagraph(
    content,
    "These three structure overlays also come from independent research groups using " +
      "different methods and, in places, disagree with each other about the region's true " +
      "shape - they're shown together for comparison, not because they're known to be " +
      "jointly consistent. And all of them evolve over millions of years; what's shown is a " +
      "single fitted snapshot, not a live or time-evolving model.",
  );

  appendHeading(content, "h3", "2. We show a curated selection, not every known object");
  appendParagraph(
    content,
    "The catalog favors the most characteristic, well-known, or historically notable " +
      "objects in each category (bright named stars, famous star clusters and nebulae, " +
      "well-studied molecular clouds) - it is nowhere close to a complete census of every " +
      "star, cluster, or cloud within its ~800 pc radius. Real all-sky surveys like Gaia " +
      "catalog many millions of stars in this same volume; what you see here is a curated, " +
      "human-legible sample of it, not the full population.",
  );

  appendHeading(content, "h3", "3. Velocity vectors and motion trails are simplified");
  appendParagraph(
    content,
    "Every velocity shown is measured <strong>relative to the Sun</strong> - and the Sun " +
      "itself is moving, orbiting the Galactic Center at roughly 220 km/s. What you see is " +
      "each star's motion relative to that already-moving reference frame, not its true " +
      "motion through the Galaxy.",
  );
  appendParagraph(
    content,
    "The motion player also extrapolates every trajectory as a straight line at each " +
      "star's current measured velocity. Over the short timescales shown near \"Today,\" " +
      "that's an excellent approximation - but real stellar orbits curve under the combined " +
      "gravity of the Galaxy (dominated at these scales by the Galactic Center, plus the " +
      "disk and any nearby massive structures), and over the longer timescales reachable " +
      "with Time Controls, real paths would bend away from the straight lines drawn here.",
  );

  appendHeading(content, "h3", "4. Nothing is shown at true physical scale");
  appendParagraph(
    content,
    "Stars, clusters, and clouds are all drawn many orders of magnitude larger than their " +
      "true size relative to the distances between them - at true scale, every object " +
      "would be an invisible point (or smaller than one screen pixel) against the vast " +
      "empty space separating them. Marker sizes are chosen for visibility and to convey " +
      "relative scale between categories, not as a literal-scale model.",
  );

  appendHeading(content, "h3", "5. Colors and \"cloudy\" shapes are illustrative, not measured");
  appendParagraph(
    content,
    "Star colors are a stylized approximation of spectral type, not a calibrated " +
      "blackbody rendering. The soft, wispy shapes used for molecular clouds, nebulae, and " +
      "supernova remnants are a deliberately cheap, non-photorealistic stand-in for their " +
      "real appearance - real astrophotographs would show these objects with rich, " +
      "irregular internal structure this scene does not attempt to reproduce. The \"star " +
      "spark\" points scattered inside cluster and association markers are decorative, not " +
      "real individual member-star positions.",
  );

  appendHeading(content, "h3", "6. Positions for extended objects are single points, with real uncertainty");
  appendParagraph(
    content,
    "Every position - including the center of a molecular cloud or nebula that may " +
      "genuinely span tens of parsecs - is placed at a single best-estimate point, usually " +
      "from an identification-only catalog cross-match, not a measured 3D centroid. " +
      "Distances (and therefore positions) carry real, sometimes substantial, measurement " +
      "uncertainty that isn't visualized here; where a record's own uncertainty is known it " +
      "is recorded in its data, but not drawn on screen.",
  );

  appendHeading(content, "h3", "Data sources");
  appendParagraph(
    content,
    "Every position, distance, and velocity shown is a live-resolved lookup against real " +
      "astronomical databases and cited literature, via Python/Astropy and astroquery - " +
      "never sketched or hand-placed:",
  );
  appendLinkedSourceList(content, [
    { text: "SIMBAD Astronomical Database (CDS, Strasbourg)", href: "https://simbad.cds.unistra.fr/simbad/" },
    { text: "Gaia (ESA) — DR2/DR3 astrometry", href: "https://www.cosmos.esa.int/web/gaia" },
    { text: "VizieR Catalogue Service (CDS, Strasbourg)", href: "https://vizier.cds.unistra.fr/" },
    { text: "Harvard Dataverse", href: "https://dataverse.harvard.edu/" },
    {
      text: 'RECONS, "The 100 Nearest Star Systems"',
      href: "https://www.astro.gsu.edu/RECONS/TOP100.posted.htm",
    },
  ]);

  return content;
}

/**
 * The Simplifications & Sources dialog - a dimmed full-viewport scrim
 * (`.info-dialog-scrim`) wrapping a centered `.panel`-styled dialog box
 * (`.info-dialog`), reusing `infoDialog.ts`'s exact CSS classes so no new
 * styling is needed and the two dialogs stay visually consistent. Same
 * three close triggers as the Info dialog: the "×" button, clicking the
 * scrim, and Escape.
 */
export class SimplificationsDialog {
  readonly element: HTMLDivElement;
  private readonly dialog: HTMLDivElement;
  private open = false;
  private readonly onKeydown = (event: KeyboardEvent): void => {
    if (this.open && isEscapeKey(event)) {
      this.hide();
    }
  };

  constructor() {
    this.element = document.createElement("div");
    this.element.id = "simplifications-dialog-scrim";
    this.element.className = "info-dialog-scrim";
    this.element.style.display = "none";
    this.element.addEventListener("click", (event) => {
      if (isScrimClick(event, this.element)) {
        this.hide();
      }
    });

    this.dialog = document.createElement("div");
    this.dialog.className = "panel info-dialog";
    this.dialog.setAttribute("role", "dialog");
    this.dialog.setAttribute("aria-modal", "true");
    this.dialog.setAttribute("aria-label", "Simplifications and Sources");
    this.element.appendChild(this.dialog);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "info-dialog-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close dialog");
    closeButton.addEventListener("click", () => this.hide());
    this.dialog.appendChild(closeButton);

    this.dialog.appendChild(buildContent());
  }

  isOpen(): boolean {
    return this.open;
  }

  show(): void {
    this.open = true;
    this.element.style.display = "flex";
    document.addEventListener("keydown", this.onKeydown);
  }

  hide(): void {
    this.open = false;
    this.element.style.display = "none";
    document.removeEventListener("keydown", this.onKeydown);
  }
}
