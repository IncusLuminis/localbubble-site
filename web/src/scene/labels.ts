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
 * Clutter-avoidance choice (documented per Story #65's brief): a label is
 * shown only when ALL of:
 *   - the global "labels" toggle is on;
 *   - the object's own category layer is visible;
 *   - the object passes the current radius filter;
 *   - EITHER the object is the currently selected/hovered object, OR the
 *     camera is within `maxCameraDistancePc` of it.
 * i.e. labels for distant/unselected objects fade out as you zoom out, but
 * the selected object's label always stays visible regardless of distance
 * (spec §25's "remain legible while navigating" - you should never lose the
 * label of the thing you're actively inspecting). This is the "distance
 * threshold" option spec §25 calls out ("optionally hide at large
 * distances"), combined with always-show-selected so clicking an object is
 * never undone by its own label vanishing.
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
 * scene's center - and the app's default "Perspective" camera pose
 * (`scene/cameraPresets.ts`'s `perspectivePose`) deliberately sits well
 * outside the ~800pc-scale neighborhood it frames (distance from origin
 * ~1087pc, per spec §30's "prioritize spatial clarity" - you should see the
 * whole neighborhood at once by default). This threshold is set generously
 * enough (2000pc) that the default view still shows labels for everything
 * currently visible; it only starts culling labels once the user zooms/pans
 * noticeably farther out than the default framing - e.g. after switching to
 * a "Fit all" or "Top view" preset over a wide radius, or scrolling out
 * manually. Purely a visual/display parameter (spec §19), not a scientific
 * value. */
export const DEFAULT_MAX_LABEL_DISTANCE_PC = 2000;

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
