import { describe, expect, it } from "vitest";
import { shouldShowConsentBanner } from "../src/ui/cookieConsentBanner";

/**
 * Issue #19 (Epic #7): `createCookieConsentBanner` itself builds real DOM
 * (`document.createElement`), which this repo's DOM-free
 * `environment: "node"` Vitest config can't construct - see
 * `ui/fullscreenToggle.ts`'s own docstring for the same DOM-wiring/pure-
 * predicate split used throughout this codebase (`ui/controls.ts`'s
 * `shouldShowRealworldTuning`/`shouldShowModelTuning`/`shouldShowSizeSlider`
 * are the closest analog for a Settings-panel-adjacent example). This covers
 * the one pure piece of banner-visibility logic at the level this test
 * environment can actually reach; the DOM wiring around it (mounting the
 * banner, wiring its two buttons, removing it on click) is straightforward
 * enough to verify live.
 */
describe("shouldShowConsentBanner", () => {
  it("is true when the user hasn't yet answered", () => {
    expect(shouldShowConsentBanner("undecided")).toBe(true);
  });

  it("is false once the user has accepted", () => {
    expect(shouldShowConsentBanner("accepted")).toBe(false);
  });

  it("is false once the user has declined", () => {
    expect(shouldShowConsentBanner("declined")).toBe(false);
  });
});
