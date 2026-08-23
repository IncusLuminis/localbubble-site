import { describe, expect, it } from "vitest";
import { isEscapeKey, isScrimClick } from "../src/ui/searchDialog";

/**
 * The Search modal (issue #203)'s open/close logic - the extent of this
 * dialog that's unit-testable in this repo, mirroring `test/infoDialog.
 * test.ts`'s own approach exactly (`vitest.config.ts` runs with
 * `environment: "node"`, so `SearchDialog`'s own DOM construction isn't
 * testable here - see `searchDialog.ts`'s top docstring).
 *
 * `isEscapeKey`/`isScrimClick` are imported into `searchDialog.ts` directly
 * from `infoDialog.ts` (not reimplemented) and re-exported from there, so
 * these assertions double as confirmation that the search modal's close
 * triggers are, structurally, the exact same predicates governing the Info
 * dialog (issue #164) - not a second, potentially-diverging copy. Full
 * coverage of those predicates' own behavior already lives in
 * `infoDialog.test.ts`; this file only checks the re-export wires through
 * correctly for the search modal's own scrim/dialog pairing.
 *
 * The other two acceptance-criteria behaviors - the modal closing
 * automatically on commit (click or Enter on a search result), and the
 * camera actually moving - are call-site wiring in `main.ts` (`onSelect`
 * calling `searchDialog.hide()` after `goToObject`), not pure logic this
 * module exposes, and are verified live per this issue's Definition of
 * Done rather than by a DOM-free unit test here.
 */

describe("isEscapeKey (re-exported for the search modal)", () => {
  it("is true for the Escape key", () => {
    expect(isEscapeKey({ key: "Escape" })).toBe(true);
  });

  it("is false for any other key", () => {
    expect(isEscapeKey({ key: "Enter" })).toBe(false);
    expect(isEscapeKey({ key: "a" })).toBe(false);
    expect(isEscapeKey({ key: "" })).toBe(false);
  });
});

describe("isScrimClick (re-exported for the search modal)", () => {
  const scrim = {} as EventTarget;
  const dialogPanel = {} as EventTarget;

  it("is true when the click target is the scrim itself", () => {
    expect(isScrimClick({ target: scrim }, scrim)).toBe(true);
  });

  it("is false when the click target is something nested inside the scrim (the search box, a result row, etc.)", () => {
    expect(isScrimClick({ target: dialogPanel }, scrim)).toBe(false);
  });

  it("is false when the click target is null", () => {
    expect(isScrimClick({ target: null }, scrim)).toBe(false);
  });
});
