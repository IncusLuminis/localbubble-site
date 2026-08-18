import type { SceneObject } from "../scene/sceneTypes";
import { searchObjects } from "../scene/search";

/**
 * The search / go-to-object control (issue #106, spec §2.6): "type a name
 * ... the view centers/frames on the matching object". Plain DOM, no
 * framework (spec §31), mirroring `ui/controls.ts`/`ui/inspector.ts`'s
 * style.
 *
 * UX (the acceptance criteria's three defined outcomes):
 * - Zero matches: a visible "No matching objects." status line, no crash.
 * - Ambiguous (multiple) matches: a clickable dropdown list of every match
 *   (capped at `MAX_RESULTS` so a broad query like "a" against 834 objects
 *   doesn't render an unbounded list) - click any row to go to it.
 * - Unique match: same dropdown, but with exactly one row, AND pressing
 *   Enter commits it directly without needing to click - typing a precise
 *   name and hitting Enter is the fast path. Deliberately does NOT
 *   auto-navigate on every keystroke purely because the in-progress query
 *   happens to currently resolve to one match - that would move the camera
 *   out from under a user who is still typing, before they've finished
 *   expressing what they meant.
 */

const MAX_RESULTS = 20;

export interface SearchBoxOptions {
  /** Read lazily on every keystroke (rather than snapshotted once) since
   * the catalog is only populated after `main.ts`'s `loadScene()` promise
   * resolves, and may itself be re-filtered by other UI state over the
   * app's lifetime. */
  getObjects: () => readonly SceneObject[];
  onSelect: (obj: SceneObject) => void;
}

export interface SearchBox {
  element: HTMLDivElement;
}

export function createSearchBox(options: SearchBoxOptions): SearchBox {
  const container = document.createElement("div");
  container.id = "search";
  container.className = "panel";

  const title = document.createElement("div");
  title.className = "panel-title";
  title.textContent = "Search";
  container.appendChild(title);

  const input = document.createElement("input");
  input.type = "text";
  input.className = "search-input";
  input.placeholder = "Object name...";
  input.setAttribute("aria-label", "Search objects by name");
  container.appendChild(input);

  const resultsList = document.createElement("ul");
  resultsList.className = "search-results";
  container.appendChild(resultsList);

  const status = document.createElement("div");
  status.className = "search-status";
  container.appendChild(status);

  let currentMatches: SceneObject[] = [];

  function clearResults(): void {
    currentMatches = [];
    resultsList.replaceChildren();
    status.textContent = "";
  }

  function commit(obj: SceneObject): void {
    options.onSelect(obj);
    input.value = obj.name;
    clearResults();
  }

  function renderResults(): void {
    resultsList.replaceChildren();
    for (const obj of currentMatches.slice(0, MAX_RESULTS)) {
      const item = document.createElement("li");
      item.className = "search-result-row";
      item.textContent = obj.name;
      item.addEventListener("click", () => commit(obj));
      resultsList.appendChild(item);
    }
    if (currentMatches.length > MAX_RESULTS) {
      const more = document.createElement("li");
      more.className = "search-result-more";
      more.textContent = `+ ${currentMatches.length - MAX_RESULTS} more - refine your search`;
      resultsList.appendChild(more);
    }
  }

  input.addEventListener("input", () => {
    const query = input.value;
    if (query.trim().length === 0) {
      clearResults();
      return;
    }
    currentMatches = searchObjects(options.getObjects(), query);
    status.textContent = currentMatches.length === 0 ? "No matching objects." : "";
    renderResults();
  });

  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && currentMatches.length === 1) {
      commit(currentMatches[0]);
    }
  });

  return { element: container };
}
