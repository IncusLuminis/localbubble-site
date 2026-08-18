import { Object3D } from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { SceneObject } from "./sceneTypes";
import { positionToVector3 } from "./sceneData";

/**
 * Object name labels (spec Idea.md §25): "remain legible while navigating;
 * optionally hide at large distances; avoid excessive clutter; be
 * toggleable." Implemented with `CSS2DRenderer` (the spec's own suggested
 * approach) rather than sprites/canvas textures - labels stay pixel-crisp
 * DOM text at any zoom level.
 *
 * Clutter-avoidance choice (documented per Story #65's brief, retuned for
 * scale by issue #89): a label is shown only when ALL of:
 *   - the global "labels" toggle is on;
 *   - the object's own category layer is visible;
 *   - the object passes the current radius filter;
 *   - EITHER the object is the currently selected/hovered object, OR the
 *     camera is within `maxCameraDistancePc` of it (`shouldShowLabel`);
 *   - AND (issue #89, added at 605-object scale) it ranks among the
 *     `MAX_VISIBLE_LABELS` nearest-to-camera objects that pass the above -
 *     see `selectNearestLabels`, applied by `main.ts` on top of
 *     `shouldShowLabel`.
 * i.e. labels for distant/unselected objects fade out as you zoom out, but
 * the selected object's label always stays visible regardless of distance
 * or rank (spec §25's "remain legible while navigating" - you should never
 * lose the label of the thing you're actively inspecting). The distance
 * threshold alone (spec §25's "optionally hide at large distances") was
 * sufficient at Story #65's ~20-object scale; at 605 objects it no longer
 * bounds the simultaneously-visible count on its own (hundreds can still
 * fall within a generous default-view threshold), so the nearest-N cap is
 * the actual mechanism keeping `CSS2DRenderer`'s DOM cost bounded now.
 */

export interface LabelVisibilityParams {
  labelsEnabled: boolean;
  layerVisible: boolean;
  withinRadius: boolean;
  isSelected: boolean;
  cameraDistancePc: number;
  maxCameraDistancePc: number;
}

export function shouldShowLabel(params: LabelVisibilityParams): boolean {
  if (!params.labelsEnabled || !params.layerVisible || !params.withinRadius) {
    return false;
  }
  if (params.isSelected) {
    return true;
  }
  return params.cameraDistancePc <= params.maxCameraDistancePc;
}

/** Default distance (pc) beyond which an unselected object's label is
 * hidden to reduce clutter (spec §25).
 *
 * `cameraDistancePc` here is measured from the camera itself, not from the
 * scene's center. Story #65 set this to 2000pc back when the catalog held
 * ~20 objects, reasoning that the default "Perspective" pose (distance from
 * origin ~1087pc) should show every object's label at once. Story #88 grew
 * the catalog to 605 objects (max ~1840pc), which made that same generous
 * threshold actively harmful: at the default 800pc radius-filter preset,
 * ~548 objects fall within it, and 2000pc was loose enough that essentially
 * all of them still passed the distance check too - hundreds of
 * simultaneously visible DOM labels, exactly the `CSS2DRenderer` bottleneck
 * issue #89 warns about, well before the WebGL geometry itself struggles.
 *
 * Retuned to 250pc (issue #89, verified interactively - see the PR
 * description): tight enough that only objects genuinely close to the
 * camera keep an always-on label at the default view, while
 * `MAX_VISIBLE_LABELS` below is the actual hard cap on DOM cost regardless
 * of how many objects happen to fall within this radius. Purely a
 * visual/display parameter (spec §19), not a scientific value. */
export const DEFAULT_MAX_LABEL_DISTANCE_PC = 250;

/** Hard cap on the number of labels rendered simultaneously (issue #89):
 * at 605 catalog objects, distance-threshold culling alone
 * (`DEFAULT_MAX_LABEL_DISTANCE_PC`) can still leave hundreds of objects
 * within range of a sufficiently zoomed-out camera - each one a live DOM
 * node `CSS2DRenderer` repositions every frame, which is the actual
 * performance bottleneck at this scale (a few hundred simultaneously
 * *visible* labels is where DOM-based label rendering typically starts
 * costing real frame time, well ahead of the InstancedMesh WebGL geometry
 * itself). Verified interactively to stay smooth and legible at this
 * catalog size - see the PR description. */
export const MAX_VISIBLE_LABELS = 60;

/** One label candidate for `selectNearestLabels`: an object that already
 * passes every non-distance-ranking visibility rule (`shouldShowLabel`'s
 * toggle/layer/radius/base-distance checks), plus what's needed to rank it
 * against the `MAX_VISIBLE_LABELS` cap. */
export interface LabelRankCandidate {
  id: string;
  cameraDistancePc: number;
  isSelected: boolean;
}

/**
 * Given the set of objects that already passed `shouldShowLabel`, returns
 * the ids that should actually render their label once `MAX_VISIBLE_LABELS`
 * is enforced: the selected object (if any) always included, plus the
 * nearest-to-camera remainder up to the cap. This is the density control
 * issue #89 calls for beyond a plain distance cutoff - at 605 objects, a
 * distance threshold alone doesn't bound the simultaneously-visible count,
 * but a nearest-N cap does regardless of catalog size.
 */
export function selectNearestLabels(
  candidates: readonly LabelRankCandidate[],
  maxVisible: number,
): Set<string> {
  if (candidates.length <= maxVisible) {
    return new Set(candidates.map((c) => c.id));
  }

  const selectedIds = candidates.filter((c) => c.isSelected).map((c) => c.id);
  const remainingBudget = Math.max(0, maxVisible - selectedIds.length);

  const nearest = candidates
    .filter((c) => !c.isSelected)
    .sort((a, b) => a.cameraDistancePc - b.cameraDistancePc)
    .slice(0, remainingBudget)
    .map((c) => c.id);

  return new Set([...selectedIds, ...nearest]);
}

export interface CatalogLabel {
  /** The scene object this label belongs to. */
  object: SceneObject;
  /** The CSS2DObject added to the scene graph (position mirrors the
   * object's own mesh position). */
  css2dObject: CSS2DObject;
  /** The underlying DOM element, exposed so callers can toggle a
   * "selected" CSS class etc. without re-querying the DOM. */
  element: HTMLDivElement;
}

/** Build one `CSS2DObject` label per (non-Sun) catalog object, all parented
 * under a returned `THREE.Object3D` group. Visibility of each individual
 * label is driven by the caller each frame/interaction via
 * `shouldShowLabel` + `element.style.display` (kept as plain DOM style
 * toggling rather than adding/removing from the scene graph every frame,
 * which would be needlessly expensive for ~20 objects but still avoids
 * `CSS2DRenderer` doing extra work for labels nobody can see). */
export function createLabelsLayer(objects: SceneObject[]): {
  group: Object3D;
  labels: CatalogLabel[];
} {
  const group = new Object3D();
  group.name = "labels";

  const labels: CatalogLabel[] = objects.map((obj) => {
    const element = document.createElement("div");
    element.className = "object-label";
    element.textContent = obj.name;

    const css2dObject = new CSS2DObject(element);
    css2dObject.position.copy(positionToVector3(obj.position_pc));
    group.add(css2dObject);

    return { object: obj, css2dObject, element };
  });

  return { group, labels };
}

/** Thin wrapper around `THREE.CSS2DRenderer` construction/sizing, kept here
 * so `main.ts` doesn't need its own import of the Three.js examples path. */
export function createLabelRenderer(container: HTMLElement): CSS2DRenderer {
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.left = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(labelRenderer.domElement);
  return labelRenderer;
}
