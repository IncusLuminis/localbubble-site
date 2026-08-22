import { describe, expect, it } from "vitest";
import {
  COLLAPSE_GLYPH,
  EXPAND_GLYPH,
  fullscreenButtonState,
} from "../src/ui/fullscreenToggle";

/**
 * Coverage for the fullscreen toggle button's state-sync logic (issue
 * #163's "listen for the browser's own `fullscreenchange` event to keep the
 * glyph in sync ... not just a locally-toggled boolean that could drift out
 * of sync" acceptance criterion). `createFullscreenToggle` itself wires this
 * pure mapping up to real DOM/Fullscreen API calls, which this repo's
 * DOM-free (`environment: "node"`) vitest config can't exercise - see
 * `structures.test.ts`'s docstring on `createGouldBeltLayer` for the same
 * split elsewhere in this codebase. `fullscreenButtonState` is the piece
 * that's actually testable: given "is the target currently the fullscreen
 * element" (which is exactly what a `fullscreenchange` handler would read
 * off `document.fullscreenElement`), does it produce the right glyph/label.
 */

describe("fullscreenButtonState", () => {
  it("shows the expand glyph and label when not fullscreen", () => {
    const state = fullscreenButtonState(false);
    expect(state.textContent).toBe(EXPAND_GLYPH);
    expect(state.ariaLabel).toBe("Enter fullscreen");
    expect(state.ariaPressed).toBe("false");
  });

  it("shows the collapse glyph and label when fullscreen", () => {
    const state = fullscreenButtonState(true);
    expect(state.textContent).toBe(COLLAPSE_GLYPH);
    expect(state.ariaLabel).toBe("Exit fullscreen");
    expect(state.ariaPressed).toBe("true");
  });

  it("uses distinct glyphs for the two states", () => {
    expect(EXPAND_GLYPH).not.toBe(COLLAPSE_GLYPH);
  });
});
