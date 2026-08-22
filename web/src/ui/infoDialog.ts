/**
 * The "i" (Info) button's About dialog (issue #164): a centered modal
 * overlay describing what the visualization shows and the data/methodology
 * behind it. The copy below is verbatim from the `Product_Owner`-authored
 * text in issue #164 - do not rewrite/invent different content here; any
 * change to the text itself is a follow-up Story, not this file's call.
 *
 * Unlike `Inspector`/`ControlPanel` (existing top-left/top-right panels,
 * neither unit-tested for their DOM construction - see `structures.test.ts`'s
 * docstring on `createGouldBeltLayer`/label construction for why: this
 * repo's `vitest.config.ts` runs with `environment: "node"`, so
 * `document.createElement` isn't available in tests), this module also
 * exports two small DOM-free pieces so the dialog's open/close *logic* -
 * as opposed to its DOM construction - has real test coverage per issue
 * #164's Definition of Done:
 *   - `INFO_DIALOG_LINKS`: the plain data backing the "Links" list, so the
 *     exact URLs/labels are checked without needing a real DOM.
 *   - `isEscapeKey` / `isScrimClick`: the two "should this close the
 *     dialog?" predicates, expressed as plain functions over small
 *     structural types (not real `KeyboardEvent`/`MouseEvent`) so they can
 *     be exercised with plain object literals in `test/infoDialog.test.ts`.
 */

export interface InfoDialogLink {
  readonly label: string;
  readonly href: string;
}

/** Verbatim from issue #164's "Links" section, in the given order. */
export const INFO_DIALOG_LINKS: readonly InfoDialogLink[] = [
  {
    label: "Source code (GitHub)",
    href: "https://github.com/IncusLuminis/visualization-studio-tools",
  },
  {
    label: "Gould Belt model source (Perrot & Grenier 2003)",
    href: "https://doi.org/10.1051/0004-6361:20030477",
  },
  {
    label: "Radcliffe Wave model source (Konietzka et al. 2024)",
    href: "https://doi.org/10.1038/s41586-024-07127-3",
  },
  {
    label: "Local Bubble model source (Alves et al. 2018)",
    href: "https://doi.org/10.1051/0004-6361/201832637",
  },
  {
    label: 'RECONS, "The 100 Nearest Star Systems"',
    href: "https://www.astro.gsu.edu/RECONS/TOP100.posted.htm",
  },
];

/** Structural subset of `KeyboardEvent` - lets tests pass plain objects. */
export interface KeyLike {
  readonly key: string;
}

/** True for the Escape key, the dialog's keyboard close trigger. */
export function isEscapeKey(event: KeyLike): boolean {
  return event.key === "Escape";
}

/** Structural subset of `MouseEvent` - lets tests pass plain objects. */
export interface ClickLike {
  readonly target: EventTarget | null;
}

/**
 * True only when the click landed directly on the scrim itself, not on (or
 * inside) the dialog panel it wraps. The scrim's own `click` listener fires
 * for clicks anywhere within it (including bubbled clicks from the dialog
 * panel nested inside), so `event.target === scrim` is what distinguishes
 * "clicked the dimmed background" from "clicked inside the dialog content" -
 * the same pattern used by most background-dismissable modals.
 */
export function isScrimClick(event: ClickLike, scrim: EventTarget): boolean {
  return event.target === scrim;
}

function appendParagraph(parent: HTMLElement, html: string): void {
  const p = document.createElement("p");
  p.innerHTML = html;
  parent.appendChild(p);
}

function appendHeading(parent: HTMLElement, level: "h2" | "h3", text: string): void {
  const heading = document.createElement(level);
  heading.textContent = text;
  parent.appendChild(heading);
}

function appendSourceList(parent: HTMLElement, items: string[]): void {
  const ul = document.createElement("ul");
  for (const item of items) {
    const li = document.createElement("li");
    li.innerHTML = item;
    ul.appendChild(li);
  }
  parent.appendChild(ul);
}

function appendLinksList(parent: HTMLElement, links: readonly InfoDialogLink[]): void {
  const ul = document.createElement("ul");
  for (const { label, href } of links) {
    const li = document.createElement("li");
    const strong = document.createElement("strong");
    strong.textContent = `${label}: `;
    li.appendChild(strong);
    const a = document.createElement("a");
    a.href = href;
    a.textContent = href;
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

  appendHeading(content, "h2", "About Local Galactic Structures");

  appendHeading(content, "h3", "What you're looking at");
  appendParagraph(
    content,
    "This is an interactive 3D map of the Solar neighborhood, showing real stars, star " +
      "clusters, stellar associations, and molecular clouds out to roughly 800 pc from the " +
      "Sun, each placed at its actual derived Galactic XYZ position — not sketched or " +
      "hand-placed. Three toggleable overlays let you compare competing large-scale " +
      "interpretations of the region's shape: the <strong>Gould Belt</strong>, the " +
      "<strong>Radcliffe Wave</strong>, and the <strong>Local Bubble</strong> — the cavity " +
      "of hot, rarefied gas the Sun itself sits inside.",
  );

  appendHeading(content, "h3", "Data & methodology");
  appendParagraph(
    content,
    "The catalog (956 objects) is built from live lookups against <strong>SIMBAD</strong>, " +
      "<strong>Gaia</strong>, and <strong>VizieR</strong> (via Astropy/astroquery), backed by " +
      "cited literature distances where a direct catalog match isn't available. Some " +
      'candidate names were first identified from a Galaxy Map "Gaia star density map" ' +
      'poster and from the RECONS "100 Nearest Star Systems" census, but only as a list of ' +
      "names to look up: every position and distance shown here comes from a live " +
      "SIMBAD/Gaia resolution, never read off an image or table.",
  );
  appendParagraph(
    content,
    "The three structure overlays are each a separate, literature-fitted scientific model, " +
      "not raw data:",
  );
  appendSourceList(content, [
    "<strong>Gould Belt</strong> — Perrot &amp; Grenier (2003), <em>A&amp;A</em> 404, 519–531",
    "<strong>Radcliffe Wave</strong> — Konietzka et al. (2024), " +
      '"The Radcliffe Wave is oscillating," <em>Nature</em> 626, 63–68',
    "<strong>Local Bubble</strong> — Alves et al. (2018), " +
      '"The Local Bubble: a magnetic veil to our Galaxy," <em>A&amp;A</em> 611, L5',
  ]);
  appendParagraph(
    content,
    "Coordinates use a heliocentric Galactic Cartesian frame, in parsecs: the Sun sits at " +
      "the origin, +X points toward the Galactic Center, +Y toward the direction of " +
      "Galactic rotation, and +Z toward the North Galactic Pole.",
  );
  appendParagraph(
    content,
    "The data pipeline is Python/Astropy; the scene you're navigating is rendered in the " +
      "browser with Three.js.",
  );

  appendHeading(content, "h3", "Links");
  appendLinksList(content, INFO_DIALOG_LINKS);

  return content;
}

/**
 * The Info dialog: a dimmed full-viewport scrim (`.info-dialog-scrim`)
 * wrapping a centered `.panel`-styled dialog box (`.info-dialog`), matching
 * the acceptance criteria's three close triggers - the "×" close button,
 * clicking the scrim, and Escape - and the app's existing dark panel theme.
 *
 * DOM construction here isn't unit-tested (consistent with `Inspector`/
 * `ControlPanel`/`createSearchBox` - see this file's top docstring); the
 * open/close *logic* it delegates to (`isEscapeKey`, `isScrimClick`) is
 * covered in `test/infoDialog.test.ts`.
 */
export class InfoDialog {
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
    this.element.id = "info-dialog-scrim";
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
    this.dialog.setAttribute("aria-label", "About Local Galactic Structures");
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
