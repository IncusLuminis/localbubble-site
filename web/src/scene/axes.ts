import { AxesHelper } from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";

/**
 * Optional coordinate axes (spec Idea.md §27): "+X -> Galactic Center,
 * +Y -> Galactic rotation, +Z -> North Galactic Pole". Included here since
 * it is cheap and helps visually validate orientation (per Story #64's
 * brief) - not made toggleable, since UI toggles are #65's scope.
 *
 * `THREE.AxesHelper` draws lines along the object's own local +X (red),
 * +Y (green), +Z (blue) axes from the origin - which line up with the
 * Galactic frame's axes exactly as defined, with no permutation needed,
 * since scene object positions are placed with an identity mapping (see
 * `scene/sceneData.ts`). Verified directly against
 * `node_modules/three/src/helpers/AxesHelper.js` rather than assumed: its
 * constructor draws vertices `(0,0,0) -> (size,0,0)` colored `(1,0,0)`
 * (red) for the X axis, `(0,0,0) -> (0,size,0)` colored `(0,1,0)` (green)
 * for Y, and `(0,0,0) -> (0,0,size)` colored `(0,0,1)` (blue) for Z - so
 * the red line drawn from the origin out to local `(size,0,0)` is
 * genuinely the +X/Galactic-Center direction this file's docstring claims.
 */
export function createAxes(sizePc: number): AxesHelper {
  const axes = new AxesHelper(sizePc);
  axes.name = "coordinate-axes";
  return axes;
}

/**
 * Fixed distance (pc) along the +X axis for the "Galactic Center" label
 * (issue #146), rather than scaling with `sizePc`. Verified live (this
 * issue's PR description) that placing the label all the way out at
 * `sizePc` (`WORLD_EXTENT_PC` = 2000pc, the largest radius preset) puts it
 * *behind* the default "Perspective" camera pose (`scene/camera.ts`:
 * position `(700,-700,450)` looking at the origin) - a point that far out
 * along +X sits further from the origin than the camera itself along that
 * same direction, so it falls outside the view frustum entirely at the
 * app's default zoom, exactly the failure mode this issue's own acceptance
 * criteria warned about ("might place it off-screen at typical zoom
 * levels"). 300pc keeps the label comfortably in front of the camera and
 * within its field of view at that default pose (confirmed via live
 * browser screenshot) while still reading as clearly "out along the axis"
 * rather than crowded in with the dense near-Sun star field.
 */
const GALACTIC_CENTER_LABEL_DISTANCE_PC = 300;

/**
 * The point along the +X axis (Galactic Center direction, see this file's
 * top docstring and the `createAxes` verification note above) used to
 * place the axis's optional "Galactic Center" label (issue #146) - a fixed
 * `GALACTIC_CENTER_LABEL_DISTANCE_PC` out along +X, clamped to `sizePc` so
 * the label never sits beyond the axis's own drawn endpoint if `sizePc` is
 * ever smaller than that fixed distance. Kept as its own pure function (no
 * `document`/DOM touch) so the position math stays unit-testable without a
 * DOM environment, mirroring `scene/structures.ts`'s
 * `gouldBeltLabelPosition`/`radcliffeWaveLabelPosition` split from their
 * own DOM-touching label builders.
 */
export function galacticCenterLabelPosition(sizePc: number): [number, number, number] {
  return [Math.min(sizePc, GALACTIC_CENTER_LABEL_DISTANCE_PC), 0, 0];
}

/**
 * A small, unobtrusive `CSS2DObject` label reading "Galactic Center" (issue
 * #146) - the human owner wants the +X axis's real-world meaning legible
 * directly in the visualization rather than left to documentation (spec
 * Idea.md §6/§27). Only the +X axis gets a label: it is the one axis with
 * a name-worthy, clearly-stated astronomical meaning callable out by name;
 * Y (Galactic rotation direction) and Z (North Galactic Pole) stay
 * unlabeled, out of this issue's scope.
 *
 * Reuses the `structure-label` CSS class (`style.css`, issue #124) rather
 * than inventing a new visual language for "a small scene annotation, not
 * a catalog object" - that class is already tuned to read as a subtle,
 * lower-contrast annotation that doesn't compete with catalog-object
 * labels (`.object-label`) or the Sun's label for visual attention, which
 * is exactly the effect this label wants too.
 *
 * Deliberately NOT built inside `createAxes` itself - same reasoning as
 * `scene/structures.ts`'s `structureLabel`/`createGouldBeltLabel` split:
 * `document.createElement` isn't available under this repo's
 * `vitest.config.ts` (`environment: "node"`), so folding DOM construction
 * into `createAxes` would make it untestable the same way. `main.ts` calls
 * this separately and parents the result under `createAxes`'s own
 * `AxesHelper`, mirroring how it already parents `createGouldBeltLabel`'s
 * result under `createGouldBeltLayer`'s group.
 */
export function createGalacticCenterLabel(sizePc: number): CSS2DObject {
  const element = document.createElement("div");
  element.className = "structure-label";
  element.textContent = "Galactic Center";

  const css2dObject = new CSS2DObject(element);
  const [x, y, z] = galacticCenterLabelPosition(sizePc);
  css2dObject.position.set(x, y, z);
  return css2dObject;
}
