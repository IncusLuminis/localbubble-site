/**
 * Expand/Collapse fullscreen toggle button (issue #163), sitting immediately
 * right of the hamburger menu button (`#menu-toggle`, `main.ts`, issue
 * #143/#145) in the top-left button row. Reuses `#menu-toggle`'s existing
 * 68x68px button styling (`style.css`'s shared `#menu-toggle,
 * #fullscreen-toggle` rule) rather than inventing new visual language, and
 * is positioned to leave room for a further button (Info, a separate
 * parallel Story) to its right later.
 *
 * Uses the standard Fullscreen API (`element.requestFullscreen()` /
 * `document.exitFullscreen()`) on the app's root container - not a
 * custom/CSS-only emulation. The button's glyph is driven by the browser's
 * own `fullscreenchange` event rather than a locally-toggled boolean, so it
 * stays correct even when fullscreen is exited via a non-button path (e.g.
 * Escape, or browser chrome) - see `fullscreenButtonState` below, which is
 * the one piece of this pure enough to unit-test given this repo's DOM-free
 * (`environment: "node"`) vitest config (see `structures.test.ts`'s
 * docstring on `createGouldBeltLayer` for the precedent of splitting
 * DOM-touching construction from testable pure logic).
 */

export const EXPAND_GLYPH = "⤢";
export const COLLAPSE_GLYPH = "⤡";

export interface FullscreenButtonState {
  textContent: string;
  ariaLabel: string;
  ariaPressed: "true" | "false";
}

/** Pure mapping from "is the target element currently the fullscreen
 * element" to the button's glyph/label - the state-sync logic the issue's
 * Definition of Done asks to be unit-tested. Deliberately free of
 * `document`/DOM so it's testable in this repo's Node (non-DOM) vitest
 * environment. */
export function fullscreenButtonState(isFullscreen: boolean): FullscreenButtonState {
  return isFullscreen
    ? { textContent: COLLAPSE_GLYPH, ariaLabel: "Exit fullscreen", ariaPressed: "true" }
    : { textContent: EXPAND_GLYPH, ariaLabel: "Enter fullscreen", ariaPressed: "false" };
}

export interface FullscreenToggle {
  element: HTMLButtonElement;
  /** Removes the `document`-level `fullscreenchange` listener. Not called
   * anywhere yet (the button lives for the app's whole lifetime, same as
   * `menuToggle`), provided for symmetry/future teardown paths. */
  destroy: () => void;
}

/** Builds the button and wires it to the real Fullscreen API on `target`
 * (the app's root container - the same element `menuToggle`/`menuPanels`
 * are appended to in `main.ts`). Click toggles fullscreen; a
 * `fullscreenchange` listener on `document` re-syncs the glyph regardless of
 * how fullscreen was entered/exited, per the issue's acceptance criteria.
 * A rejected `requestFullscreen()`/`exitFullscreen()` promise (e.g. an
 * iframe without `allowfullscreen`, or a browser that denies the request)
 * is caught and logged rather than left as an uncaught rejection, so the
 * app doesn't crash when the Fullscreen API isn't available/permitted. */
export function createFullscreenToggle(target: HTMLElement): FullscreenToggle {
  const element = document.createElement("button");
  element.id = "fullscreen-toggle";
  element.type = "button";

  function isTargetFullscreen(): boolean {
    return document.fullscreenElement === target;
  }

  function sync(): void {
    const state = fullscreenButtonState(isTargetFullscreen());
    element.textContent = state.textContent;
    element.setAttribute("aria-label", state.ariaLabel);
    element.setAttribute("aria-pressed", state.ariaPressed);
  }

  function handleFullscreenChange(): void {
    sync();
  }

  element.addEventListener("click", () => {
    if (isTargetFullscreen()) {
      document.exitFullscreen().catch((error: unknown) => {
        console.error("Failed to exit fullscreen:", error);
      });
      return;
    }
    if (!target.requestFullscreen) {
      console.error("Fullscreen API is not available in this browsing context.");
      return;
    }
    target.requestFullscreen().catch((error: unknown) => {
      console.error("Failed to enter fullscreen:", error);
    });
  });

  document.addEventListener("fullscreenchange", handleFullscreenChange);

  sync();

  return {
    element,
    destroy: () => {
      document.removeEventListener("fullscreenchange", handleFullscreenChange);
    },
  };
}
