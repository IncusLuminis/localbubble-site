import { describe, expect, it } from "vitest";
import { INFO_DIALOG_LINKS, isEscapeKey, isScrimClick } from "../src/ui/infoDialog";

/**
 * The Info dialog (issue #164)'s open/close logic and link content, the
 * extent of this dialog that's unit-testable in this repo: its `vitest.
 * config.ts` runs with `environment: "node"`, so `document.createElement`
 * (used throughout `InfoDialog`'s own DOM construction, same as
 * `Inspector`/`ControlPanel`/`createSearchBox`) isn't available here - see
 * `infoDialog.ts`'s top docstring. `isEscapeKey`/`isScrimClick` are the two
 * "should this close the dialog?" predicates, expressed as plain functions
 * over structural types so they can be exercised without a real DOM.
 */

describe("isEscapeKey", () => {
  it("is true for the Escape key", () => {
    expect(isEscapeKey({ key: "Escape" })).toBe(true);
  });

  it("is false for any other key", () => {
    expect(isEscapeKey({ key: "Enter" })).toBe(false);
    expect(isEscapeKey({ key: "a" })).toBe(false);
    expect(isEscapeKey({ key: "" })).toBe(false);
  });
});

describe("isScrimClick", () => {
  const scrim = {} as EventTarget;
  const dialogPanel = {} as EventTarget;

  it("is true when the click target is the scrim itself", () => {
    expect(isScrimClick({ target: scrim }, scrim)).toBe(true);
  });

  it("is false when the click target is something nested inside the scrim (the dialog panel, a link, etc.)", () => {
    expect(isScrimClick({ target: dialogPanel }, scrim)).toBe(false);
  });

  it("is false when the click target is null", () => {
    expect(isScrimClick({ target: null }, scrim)).toBe(false);
  });
});

describe("INFO_DIALOG_LINKS", () => {
  it("has exactly the five links from issue #164's Links section, in order", () => {
    expect(INFO_DIALOG_LINKS.map((link) => link.href)).toEqual([
      "https://github.com/IncusLuminis/visualization-studio-tools",
      "https://doi.org/10.1051/0004-6361:20030477",
      "https://doi.org/10.1038/s41586-024-07127-3",
      "https://doi.org/10.1051/0004-6361/201832637",
      "https://www.astro.gsu.edu/RECONS/TOP100.posted.htm",
    ]);
  });

  it("gives every link a non-empty label", () => {
    for (const link of INFO_DIALOG_LINKS) {
      expect(link.label.length).toBeGreaterThan(0);
    }
  });

  it("uses only https URLs (suitable for target=_blank external links)", () => {
    for (const link of INFO_DIALOG_LINKS) {
      expect(link.href.startsWith("https://")).toBe(true);
    }
  });
});
