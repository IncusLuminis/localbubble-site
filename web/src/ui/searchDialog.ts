import { isEscapeKey, isScrimClick } from "./infoDialog";

/** Re-exported so `test/searchDialog.test.ts` can verify (per #164/#203's
 * shared-pattern requirement) that this dialog's close behavior is driven
 * by literally the same predicates as `InfoDialog`'s, not a separately
 * reimplemented pair that could drift out of sync - without needing a DOM
 * (this repo's `vitest.config.ts` runs `environment: "node"`, so
 * `SearchDialog` itself, which calls `document.createElement`, isn't
 * directly instantiable in tests - same limitation `InfoDialog` already
 * has, see that class's own docstring). */
export { isEscapeKey, isScrimClick };

/**
 * The Search button's modal (issue #203): pulls `ui/search.ts`'s
 * `createSearchBox` (issue #106) out of the shared, always-docked
 * `#menu-panels` container (issue #143) into its own centered modal,
 * mirroring `infoDialog.ts`'s scrim/close/Escape/scrim-click pattern
 * (issue #164) exactly - including reusing that module's own
 * `isEscapeKey`/`isScrimClick` predicates directly (they're already pure,
 * DOM-free, and generic over any scrim/dialog pair, so duplicating them
 * here would just be drift risk for zero benefit).
 *
 * Two differences from `InfoDialog`, both required by #203's acceptance
 * criteria:
 *   - This class doesn't build its own content in the constructor -
 *     `createSearchBox`'s element isn't available until `main.ts`'s
 *     `loadScene()` promise resolves (the button/dialog shell, like
 *     `#menu-toggle`, exists from startup), so `appendContent` lets the
 *     caller mount it once it exists.
 *   - There is no `onCommit`/auto-close hook inside this class itself:
 *     `goToObject`'s camera move happens in `main.ts`, which already knows
 *     about both the search box's `onSelect` callback and this dialog's
 *     `hide()` - the auto-close-on-commit behavior is just that call site
 *     also calling `hide()`, not a change to `createSearchBox`'s own
 *     commit logic (out of scope per #203).
 *
 * Design choice (documented per #203's "implementer's call" on this
 * point): re-opening the button does NOT clear the previous query - the
 * same `createSearchBox` instance/element is shown and hidden in place
 * (never rebuilt), so whatever the user last typed/selected is still
 * there. This mirrors `InfoDialog`, which likewise never resets its own
 * scroll position/state between opens.
 */
export class SearchDialog {
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
    this.element.id = "search-dialog-scrim";
    this.element.className = "search-dialog-scrim";
    this.element.style.display = "none";
    this.element.addEventListener("click", (event) => {
      if (isScrimClick(event, this.element)) {
        this.hide();
      }
    });

    this.dialog = document.createElement("div");
    this.dialog.className = "panel search-dialog";
    this.dialog.setAttribute("role", "dialog");
    this.dialog.setAttribute("aria-modal", "true");
    this.dialog.setAttribute("aria-label", "Search objects");
    this.element.appendChild(this.dialog);

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.className = "search-dialog-close";
    closeButton.textContent = "×";
    closeButton.setAttribute("aria-label", "Close dialog");
    closeButton.addEventListener("click", () => this.hide());
    this.dialog.appendChild(closeButton);
  }

  /** Mounts `createSearchBox`'s (or any) element inside the dialog panel,
   * after the close button - called once, as soon as the search box exists
   * (see this class's own docstring for why that's later than
   * construction). */
  appendContent(content: HTMLElement): void {
    this.dialog.appendChild(content);
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
