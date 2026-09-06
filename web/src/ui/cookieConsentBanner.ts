import type { ConsentDecision } from "./settingsPersistence";

/**
 * Issue #19 (Epic #7): the first-visit cookie-consent banner - a standard
 * bottom bar with "Decline"/"Accept" buttons, shown before any non-essential
 * `localStorage` write happens (`main.ts` never touches
 * `ui/settingsPersistence.ts`'s persisted-settings blob until the user
 * clicks Accept). Recording the decision itself (which of the two buttons
 * was clicked, or neither yet) is NOT gated by consent - that's the one
 * "minimal, non-consent-requiring mechanism" a banner like this needs so it
 * doesn't re-prompt on every single page load; see
 * `settingsPersistence.ts`'s `saveConsentDecision`, which is always safe to
 * call regardless of what the user chooses.
 *
 * Plain DOM, no framework, reusing `.panel`'s existing dark-panel box
 * styling (`style.css`) - `.cookie-consent-banner` overrides just the
 * positioning (fixed to the viewport bottom, full width) the same way
 * `.side-panel`/`.info-dialog` already override `.panel`'s own top-left
 * anchored positioning for their own different placements.
 */

export interface CookieConsentBannerOptions {
  onAccept: () => void;
  onDecline: () => void;
}

/** Pure predicate for whether the banner should be shown at all - `true`
 * only while the user hasn't yet answered. Pulled out of the DOM-building
 * code below so it's unit-testable in this repo's DOM-free (`environment:
 * "node"`) Vitest config, mirroring `ui/controls.ts`'s
 * `shouldShowRealworldTuning`/`ui/fullscreenToggle.ts`'s
 * `fullscreenButtonState` - see either's own docstring for why this split
 * exists throughout this codebase. */
export function shouldShowConsentBanner(decision: ConsentDecision): boolean {
  return decision === "undecided";
}

/** Builds the banner element. The caller is expected to only call this when
 * `shouldShowConsentBanner` says to, and to append the result to `#app`
 * immediately (not gated behind scene load, which can take a few seconds) -
 * this function itself has no opinion on either. Clicking either button
 * fires the matching callback (recording the decision, and - Accept only -
 * persisting the current settings state, both `main.ts`'s job) and then
 * removes the banner from the DOM; there's no other dismissal path (no
 * scrim/Escape-to-close - this is a banner, not a modal, and per this
 * issue's own scope isn't meant to be dismissible without answering). */
export function createCookieConsentBanner(options: CookieConsentBannerOptions): HTMLDivElement {
  const banner = document.createElement("div");
  banner.id = "cookie-consent-banner";
  banner.className = "panel cookie-consent-banner";
  banner.setAttribute("role", "region");
  banner.setAttribute("aria-label", "Cookie consent");

  const message = document.createElement("p");
  message.textContent =
    "This site can remember your Settings choices (star rendering style, radius, and the tuning sliders) in your browser's local storage so they're still set the next time you visit. Accept to enable that, or decline to keep using the defaults every visit.";
  banner.appendChild(message);

  const actions = document.createElement("div");
  actions.className = "cookie-consent-banner-actions";

  const declineButton = document.createElement("button");
  declineButton.type = "button";
  declineButton.textContent = "Decline";
  declineButton.addEventListener("click", () => {
    options.onDecline();
    banner.remove();
  });

  const acceptButton = document.createElement("button");
  acceptButton.type = "button";
  acceptButton.textContent = "Accept";
  acceptButton.addEventListener("click", () => {
    options.onAccept();
    banner.remove();
  });

  actions.append(declineButton, acceptButton);
  banner.appendChild(actions);

  return banner;
}
