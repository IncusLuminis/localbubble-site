/**
 * Embedded Aladin Lite v3 (CDS) sky viewer for star-type Inspector entries
 * (Story #187/issue #187). Shows real DSS2 imagery centered on the
 * selected star, targeted by plain object name via the Sesame name
 * resolver - no RA/Dec needed in our own catalog data.
 *
 * Loaded via the CDN script-tag approach (NOT an npm/bundled import) per
 * the issue's explicit choice: avoids WASM/bundler config in this Vite
 * app, and defers the (~2MB) script's load cost until a star is actually
 * selected for the first time (`loadAladinScript` below is invoked lazily,
 * from `updateSkyView`, and its Promise is cached so a second star
 * selection during/after the first never re-fetches or re-inits it).
 *
 * Performance-critical (issue #187): exactly ONE `A.aladin` instance is
 * ever created for the app's lifetime (`aladinInstance` below), reused
 * across every star selection via `aladin.gotoObject()` rather than
 * destroyed/recreated - recreating would re-init WebGL/WASM state on every
 * click, which is expensive and unnecessary. `wrapperEl`/`viewerEl` are
 * likewise created exactly once and cached; `Inspector.show()` calls
 * `createSkyViewElement()` on every star selection to get (the same)
 * element back and re-appends it to its `content` div (which it otherwise
 * `replaceChildren()`s on every call) - detaching and re-appending an
 * existing DOM node doesn't lose its WebGL context; recreating the node
 * would force Aladin to reinitialize against a new canvas.
 *
 * Graceful failure: `updateSkyView` tries the star's own `name` first via
 * `gotoObject`'s `success`/`error` callbacks, then falls through its
 * `aliases` in order (an HD/HIP-prefixed one is a good bet per the issue),
 * and shows a small "Sky image unavailable" placeholder - never a blank or
 * broken widget - if every candidate fails to resolve, or if the CDN
 * script itself fails to load (offline, CDS unreachable, etc).
 *
 * A monotonic `requestToken` guards against a slow/late resolution for a
 * previously-selected star clobbering the panel after the user has
 * already moved on to a different selection.
 *
 * `vitest.config.ts` runs with `environment: "node"` (no DOM, no WebGL) -
 * same constraint noted in `orbitDiagram.ts`/`infoDialog.ts`. The one
 * meaningful pure decision this module makes - the ordered list of
 * Sesame-resolvable target names to try for a star - is factored out as
 * `skyViewTargets` below and unit-tested directly
 * (`test/skyView.test.ts`); everything else here is DOM/network
 * orchestration around a third-party widget and isn't unit-testable in
 * this repo's `node`-environment test suite.
 */

import type { SceneObject } from "../scene/sceneTypes";

const ALADIN_SCRIPT_URL = "https://aladin.cds.unistra.fr/AladinLite/api/v3/latest/aladin.js";
const ALADIN_SURVEY = "P/DSS2/color";
/** Square viewer side (px), matching `#inspector`'s actual CSS content
 * width so the viewer fills the panel edge-to-edge without overflowing it.
 *
 * Story #189 correction: `.panel`'s `width: 240px` (`style.css`) is a
 * content-box width (no `box-sizing: border-box` override on `.panel`),
 * so it already IS the content width - the padding (`12px 14px`) is added
 * on top of it, not carved out of it. The pre-#189 value here (212 =
 * 240 - 2x14) double-subtracted the padding, leaving a visible ~28px gap
 * on the right edge and letting Aladin's own overlay chrome (coordinate
 * readout, target-name/FoV labels) overflow past the narrower box's right
 * and bottom edges - confirmed live via devtools (`getBoundingClientRect`)
 * against a real selection before fixing this. */
const SKY_VIEW_SIZE_PX = 240;
/** Degrees - a reasonably tight framing on a single star without being so
 * zoomed in that a small positional/resolution mismatch pushes it out of
 * frame. */
const INITIAL_FOV_DEG = 0.5;

interface AladinGotoOptions {
  success?: (coo: unknown) => void;
  error?: () => void;
}

interface AladinInstance {
  gotoObject: (target: string, options?: AladinGotoOptions) => void;
}

interface AladinNamespace {
  init: Promise<void>;
  aladin: (el: HTMLElement | string, options?: Record<string, unknown>) => AladinInstance;
}

declare global {
  interface Window {
    A?: AladinNamespace;
  }
}

/**
 * Ordered list of Sesame-resolvable target names to try for a star: its
 * own SIMBAD `name` first, then each of its `aliases` in catalog order as
 * fallbacks. Pure and exported for unit testing (see module doc above) -
 * everything downstream of this list (actually calling `gotoObject`,
 * handling success/error) is DOM/network orchestration, not decision
 * logic.
 */
export function skyViewTargets(obj: Pick<SceneObject, "name" | "aliases">): string[] {
  return [obj.name, ...obj.aliases];
}

let scriptLoadPromise: Promise<void> | null = null;

function loadAladinScript(): Promise<void> {
  if (scriptLoadPromise !== null) {
    return scriptLoadPromise;
  }
  scriptLoadPromise = new Promise<void>((resolve, reject) => {
    const onReady = () => {
      if (window.A?.init) {
        window.A.init.then(resolve, reject);
      } else {
        reject(new Error("Aladin Lite script loaded but window.A is missing"));
      }
    };
    const existing = document.querySelector<HTMLScriptElement>(`script[src="${ALADIN_SCRIPT_URL}"]`);
    if (existing !== null) {
      if (window.A?.init) {
        onReady();
      } else {
        existing.addEventListener("load", onReady, { once: true });
        existing.addEventListener(
          "error",
          () => reject(new Error("Aladin Lite script failed to load")),
          { once: true },
        );
      }
      return;
    }
    const script = document.createElement("script");
    script.src = ALADIN_SCRIPT_URL;
    script.async = true;
    script.addEventListener("load", onReady, { once: true });
    script.addEventListener(
      "error",
      () => reject(new Error("Aladin Lite script failed to load")),
      { once: true },
    );
    document.head.appendChild(script);
  });
  return scriptLoadPromise;
}

let wrapperEl: HTMLDivElement | null = null;
let viewerEl: HTMLDivElement | null = null;
let placeholderEl: HTMLDivElement | null = null;
let aladinInstance: AladinInstance | null = null;
let requestToken = 0;

/**
 * Returns the single, lazily-created sky-view DOM element (viewer +
 * fallback placeholder), creating it on first call and returning the exact
 * same node on every subsequent call. `Inspector.show()` appends this to
 * its content div on every star selection; since it's always the same
 * node, re-appending it doesn't disturb an already-initialized Aladin
 * instance mounted inside it.
 */
export function createSkyViewElement(): HTMLDivElement {
  if (wrapperEl !== null) {
    return wrapperEl;
  }

  wrapperEl = document.createElement("div");
  wrapperEl.className = "sky-view";

  viewerEl = document.createElement("div");
  viewerEl.className = "sky-view-viewer";
  viewerEl.style.width = `${SKY_VIEW_SIZE_PX}px`;
  viewerEl.style.height = `${SKY_VIEW_SIZE_PX}px`;
  wrapperEl.appendChild(viewerEl);

  placeholderEl = document.createElement("div");
  placeholderEl.className = "sky-view-placeholder";
  placeholderEl.style.width = `${SKY_VIEW_SIZE_PX}px`;
  placeholderEl.style.height = `${SKY_VIEW_SIZE_PX}px`;
  placeholderEl.style.display = "none";
  wrapperEl.appendChild(placeholderEl);

  return wrapperEl;
}

function showPlaceholder(message: string): void {
  if (viewerEl !== null) {
    viewerEl.style.display = "none";
  }
  if (placeholderEl !== null) {
    placeholderEl.textContent = message;
    placeholderEl.style.display = "flex";
  }
}

function showViewer(): void {
  if (viewerEl !== null) {
    viewerEl.style.display = "block";
  }
  if (placeholderEl !== null) {
    placeholderEl.style.display = "none";
  }
}

/** Tries each candidate target in order via `gotoObject`'s Sesame
 * resolution, resolving `true` on the first success or `false` once every
 * candidate has failed. */
function tryTargets(aladin: AladinInstance, targets: string[]): Promise<boolean> {
  if (targets.length === 0) {
    return Promise.resolve(false);
  }
  const [first, ...rest] = targets;
  return new Promise<boolean>((resolve) => {
    aladin.gotoObject(first, {
      success: () => resolve(true),
      error: () => {
        tryTargets(aladin, rest).then(resolve);
      },
    });
  });
}

function ensureInstance(): AladinInstance {
  if (aladinInstance === null) {
    aladinInstance = window.A!.aladin(viewerEl!, {
      survey: ALADIN_SURVEY,
      fov: INITIAL_FOV_DEG,
      showZoomControl: false,
      showFullscreenControl: false,
      showSimbadPointerControl: false,
      showShareControl: false,
      showCooGridControl: false,
      showProjectionControl: false,
      showContextMenu: false,
      // Issue #187: no custom survey-toggle UI is built - Aladin's own
      // built-in layer control already lets a curious user switch surveys.
      showLayersControl: true,
      // Issue #193: hides Aladin's coordinate-frame indicator - a small
      // "ICRS" dropdown in the top-left corner of the viewer for switching
      // the displayed coordinate reference frame (ICRS/Galactic/etc, i.e.
      // "coordinate system markings" covering the whole celestial sphere).
      // The human owner asked for this specific widget removed. Verified
      // live with a before/after screenshot (in the PR) that `showFrame:
      // false` removes exactly this dropdown and nothing else - the copy-
      // coordinates control, layers control, and DSS imagery are all still
      // present and working.
      showFrame: false,
    });
  }
  return aladinInstance;
}

/**
 * Retargets the single shared Aladin instance (creating it on first call)
 * to the given star, trying `name` then each of `aliases` in order until
 * one resolves via Sesame. Shows the viewer on success, or a "Sky image
 * unavailable" placeholder if every candidate fails or the CDN script
 * itself can't be loaded. Never throws - a resolution/network failure here
 * must not break the rest of the Inspector.
 *
 * Safe to call repeatedly in quick succession (e.g. clicking through
 * several stars before the first's Sesame lookup returns): a monotonic
 * token discards any in-flight resolution that finishes after a newer
 * call has already started.
 */
export function updateSkyView(obj: Pick<SceneObject, "name" | "aliases">): void {
  createSkyViewElement();
  const token = ++requestToken;
  showPlaceholder("Loading sky image…");

  loadAladinScript()
    .then(() => {
      if (token !== requestToken) {
        return;
      }
      const aladin = ensureInstance();
      return tryTargets(aladin, skyViewTargets(obj)).then((resolved) => {
        if (token !== requestToken) {
          return;
        }
        if (resolved) {
          showViewer();
        } else {
          showPlaceholder("Sky image unavailable");
        }
      });
    })
    .catch(() => {
      if (token === requestToken) {
        showPlaceholder("Sky image unavailable");
      }
    });
}
