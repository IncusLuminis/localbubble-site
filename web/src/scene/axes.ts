import { AxesHelper, Vector3 } from "three";
import type { Camera } from "three";
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
 * Issue #149: fraction of the camera's *current* distance from the origin
 * used to place the "Galactic Center" label along +X, replacing #146's
 * fixed 300pc point. That fixed point worked only near the default
 * "Perspective" pose (camera distance ~1087pc) and fell out of a reasonable
 * view at the app's other zoom levels (~1.45pc close-in per #134, up to
 * `WORLD_EXTENT_PC` = 2000pc overview) - see this file's `git log` for
 * #146's own docstring/verification, now superseded.
 *
 * 0.3 was chosen by checking it against every camera preset
 * (`scene/cameraPresets.ts`) at its own default distance, not just the
 * default pose:
 * - Perspective (700,-700,450), distance ~1087pc: label lands at ~326pc,
 *   comfortably inside the ~300pc this codebase already verified live as
 *   in-frustum at that same pose (#146).
 * - Sun-centered (60,-60,40), distance ~94pc: label at ~28pc. The ratio of
 *   the camera's own X-coordinate to its distance from the origin is ~0.64
 *   for both this pose and Perspective - since 0.3 is well under that
 *   ratio, the label point's X-coordinate stays smaller than the camera's
 *   own X-coordinate at both poses, which keeps the label *between* the
 *   camera and the origin along the viewing ray (i.e. genuinely in front of
 *   the camera, not behind it) - exactly the failure mode #146 hit when it
 *   first tried placing the label at the axis's full 2000pc extent.
 * - Top view / Edge-on: these poses sit on the Y or Z axis
 *   (camera X-coordinate = 0), so the "behind the camera along +X" failure
 *   mode described above cannot occur regardless of factor - the label
 *   point is simply beside the viewing ray. At their default distance
 *   (~1280pc, `radiusPc` = 800 default), 0.3 places the label at ~384pc,
 *   well within the vertical half-extent (`tan(25°) * 1280` ≈ 596pc for the
 *   50° default FOV) those poses frame.
 * - Close zoom (down to #134's ~1.45pc minimum): scaling with the camera's
 *   *current* distance (not a fixed constant) is exactly what keeps the
 *   label from being left behind at this end of the range too - at 1.45pc
 *   the label sits at ~0.44pc, comfortably inside the few-pc-wide view the
 *   app's 50° FOV frames at that distance, rather than the fixed 300pc
 *   point which would have been wildly off-screen this close in.
 */
const GALACTIC_CENTER_LABEL_DISTANCE_FACTOR = 0.3;

/**
 * Floor (pc) under the computed label distance, so the pure function below
 * stays total (never collapses to the literal origin) even for a
 * theoretical `cameraDistanceFromOriginPc` of `0` - which the real app never
 * produces (`OrbitControls.minDistance` keeps the camera away from the
 * origin, #134), but a caller/test could still pass. Small enough to never
 * bind in practice: at the app's real minimum camera distance (~1.45pc,
 * #134), `1.45 * GALACTIC_CENTER_LABEL_DISTANCE_FACTOR` (~0.44pc) is already
 * well above this floor.
 */
const GALACTIC_CENTER_LABEL_MIN_DISTANCE_PC = 0.05;

/**
 * The point along the +X axis (Galactic Center direction, see this file's
 * top docstring and the `createAxes` verification note above) used to
 * place the axis's "Galactic Center" label (issue #146, made dynamic by
 * #149) - `GALACTIC_CENTER_LABEL_DISTANCE_FACTOR` of the camera's *current*
 * distance from the origin, floored at `GALACTIC_CENTER_LABEL_MIN_DISTANCE_PC`
 * and capped at `maxDistancePc` (the axis's own drawn extent, so the label
 * never sits beyond the axis's endpoint) - genuinely recomputed every frame
 * from live camera state, mirroring this codebase's established per-frame
 * adaptive patterns (`main.ts`'s `applyFovReadout` #125, `scene/labels.ts`'s
 * `effectiveMaxLabelDistancePc` #94, `applySunCoreScale` #113), rather than
 * a single static world-space point (#146's original, superseded approach -
 * see `GALACTIC_CENTER_LABEL_DISTANCE_FACTOR`'s docstring above for the
 * per-preset verification behind this factor).
 *
 * Kept as its own pure function (no `document`/DOM touch, no `camera`/THREE
 * import) so the position math stays unit-testable without a DOM
 * environment, mirroring `scene/structures.ts`'s
 * `gouldBeltLabelPosition`/`radcliffeWaveLabelPosition` split from their
 * own DOM-touching label builders. `main.ts`'s `applyGalacticCenterLabelPosition`
 * calls this every frame with the live `camera.position.length()`.
 */
export function galacticCenterLabelPosition(
  cameraDistanceFromOriginPc: number,
  maxDistancePc: number,
): [number, number, number] {
  const raw = cameraDistanceFromOriginPc * GALACTIC_CENTER_LABEL_DISTANCE_FACTOR;
  const x = Math.min(Math.max(raw, GALACTIC_CENTER_LABEL_MIN_DISTANCE_PC), maxDistancePc);
  return [x, 0, 0];
}

/**
 * A `CSS2DObject` label reading "Galactic Center" (issue #146) - the human
 * owner wants the +X axis's real-world meaning legible directly in the
 * visualization rather than left to documentation (spec Idea.md §6/§27).
 * Only the +X axis gets a label: it is the one axis with a name-worthy,
 * clearly-stated astronomical meaning callable out by name; Y (Galactic
 * rotation direction) and Z (North Galactic Pole) stay unlabeled, out of
 * this issue's scope (unchanged by #149).
 *
 * Issue #149: uses its own dedicated `galactic-center-label` CSS class
 * (`style.css`), not the shared `structure-label` class #146 originally
 * reused - `structure-label` is also used by the Gould Belt/Radcliffe Wave
 * overlay labels (`scene/structures.ts`), and the human owner asked for
 * *this* label specifically to be made more noticeable, not those. A
 * dedicated class keeps that change scoped to this label alone.
 *
 * Issue #149: the position set here (`maxDistancePc` itself, i.e. the
 * initial camera-distance-scaled value saturates at the cap) is only a
 * placeholder - `main.ts`'s `animate()` loop calls
 * `applyGalacticCenterLabelPosition` before every render (including the
 * very first one), which overwrites this `.position` from the *live*
 * `camera.position.length()` every frame via `galacticCenterLabelPosition`
 * above. No stale/unrendered frame ever shows this placeholder.
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
export interface GalacticCenterLabel {
  css2dObject: CSS2DObject;
  /** The direction glyph beside the text (issue #155) - `main.ts`'s
   * `applyGalacticCenterLabelPosition` rotates this every frame via
   * `galacticCenterOnScreenArrowAngleDeg` below, so it always points along
   * the +X axis's *current* on-screen direction rather than sitting at a
   * fixed orientation. A nested `<span>`, not the `css2dObject`'s own root
   * element: `CSS2DRenderer.render()` overwrites the root element's own
   * `style.transform` every frame to reposition it (see the `.object-label`
   * CSS comment this file's `createGalacticCenterLabel` docstring already
   * points at), which would fight a rotation set there directly - a
   * descendant element's `transform` is untouched by that render pass, so
   * rotating this nested span instead is the same escape hatch #154's edge
   * indicator already relies on for its own arrow. */
  arrow: HTMLSpanElement;
}

export function createGalacticCenterLabel(maxDistancePc: number): GalacticCenterLabel {
  const element = document.createElement("div");
  element.className = "galactic-center-label";

  // Issue #155: a small direction glyph beside the text, so the label reads
  // as "this way is the Galactic Center" (a direction) rather than "this is
  // the Galactic Center" (a location) - see issue #155 itself for the full
  // rationale. Resting
  // orientation is "point up" ("▲", matching #154's edge-indicator arrow's
  // own resting glyph/rotation convention); rotated per-frame by `main.ts`.
  const arrow = document.createElement("span");
  arrow.className = "galactic-center-label__arrow";
  arrow.textContent = "▲";
  element.appendChild(arrow);

  element.appendChild(document.createTextNode("Galactic Center"));

  const css2dObject = new CSS2DObject(element);
  const [x, y, z] = galacticCenterLabelPosition(maxDistancePc, maxDistancePc);
  css2dObject.position.set(x, y, z);
  return { css2dObject, arrow };
}

/**
 * Issue #155: the screen-space rotation angle (degrees, clockwise from
 * "up") for the on-screen "Galactic Center" label's direction arrow
 * (`GalacticCenterLabel.arrow` above), so it visually points further
 * outward along the +X axis's *current* on-screen projected direction -
 * parallel to the visible red axis line, pointing away from the origin -
 * rather than sitting at a fixed orientation (the axis's on-screen angle
 * changes with every camera pose, per #149's whole premise).
 *
 * Takes the already-computed `NdcProjection` of two points genuinely on the
 * +X axis - the origin and the label's own anchor point are what `main.ts`
 * passes, both already available there every frame - rather than a `camera`
 * + raw `Vector3` pair, so this stays a pure, DOM/camera-free function
 * unit-testable the same way as `galacticCenterLabelPosition` above (see
 * that function's docstring for why that split matters in this codebase).
 * Callers are expected to have produced both via this file's own
 * `projectToNdc` (per issue #155's explicit ask to reuse it rather than
 * invent a second projection method), not some other projection method.
 *
 * `edgeClampedDirection` (already defined above for #154's off-screen
 * fallback) is reused to un-mirror each point's raw NDC x/y individually
 * before taking their difference - guards against the same behind-camera
 * sign flip #154 already had to handle, for the (structurally possible,
 * even if the origin is never actually behind the camera for any built-in
 * preset) case where the axis's near end sits behind the camera plane while
 * the far/anchor end - which `galacticCenterIndicatorPlacement`'s caller
 * has already confirmed is on-screen - does not.
 *
 * The `atan2(dx, dy)` argument order (not the more usual `atan2(dy, dx)`)
 * and the lack of any pixel-space y-flip mirror `main.ts`'s existing
 * off-screen arrow angle calculation for #154's edge indicator exactly -
 * both measure clockwise-from-"up" directly in NDC's +y-is-up space, which
 * already matches CSS `rotate()`'s clockwise-positive convention against an
 * arrow glyph resting in the "point up" orientation with no separate
 * pixel-space correction needed (see that call site's own comment for the
 * fuller reasoning, which applies unchanged here).
 *
 * Total even for the degenerate zero-length direction (the two points
 * project to the same on-screen location - only possible in the limit as
 * the anchor point's distance-from-origin floor, `GALACTIC_CENTER_LABEL_MIN_DISTANCE_PC`,
 * shrinks toward `0`, which the real app never reaches): defaults to `0`
 * (the arrow's own resting "point up" orientation), an arbitrary but
 * harmless choice for a direction that isn't well-defined anyway.
 */
export function galacticCenterOnScreenArrowAngleDeg(
  originNdc: NdcProjection,
  anchorNdc: NdcProjection,
): number {
  const origin = edgeClampedDirection(originNdc);
  const anchor = edgeClampedDirection(anchorNdc);
  const dx = anchor.x - origin.x;
  const dy = anchor.y - origin.y;
  if (dx === 0 && dy === 0) {
    return 0;
  }
  return Math.atan2(dx, dy) * (180 / Math.PI);
}

/**
 * Issue #154 (Validator-flagged gap in #149): the Validator found that
 * `galacticCenterLabelPosition` above - while it does fix #149's original
 * complaint (the label going stale at non-default zoom levels) - only ever
 * moves the label point *along the +X axis line itself*. That line passes
 * through the origin, so it stays within the camera's frustum only when the
 * camera orbits *around* (or near) the origin, which is true for every
 * built-in preset (`scene/cameraPresets.ts`) but false for `objectCenteredPose`
 * ("go to object" search, issue #106): searching a real catalog object far
 * from the origin (e.g. `* 55 Cyg` at ~1840pc, mostly along +Y) re-centers
 * `controls.target` on that object, and the entire +X axis line - the label
 * point included - can fall completely outside the frustum. No distance-
 * along-that-line fixes this: the point isn't "too far/too close", it's
 * "off in a direction the camera isn't looking at all". This is exactly
 * #146's original silent-failure signature (label vanishes with zero console
 * errors), reopened by ordinary use of a feature (search) #149 never
 * exercised.
 *
 * The fix is the standard "off-screen compass/radar arrow" pattern: every
 * frame, check whether the real 3D-anchored point
 * (`galacticCenterLabelPosition`'s output) actually projects on-screen right
 * now; if so, keep doing exactly what #149 already does (anchored
 * `CSS2DObject`, unchanged, already validated correct for that case); if
 * not, fall back to a screen-space indicator clamped to the edge of the
 * viewport in the correct on-screen direction, so the label never fully
 * disappears regardless of where the camera is looking.
 *
 * This type/`projectToNdc` below is the "is it on-screen, and if not, which
 * way is it" primitive that fallback needs, built on `Vector3.project`
 * (which internally does what `CSS2DRenderer.render()` itself does - see
 * `node_modules/three/examples/jsm/renderers/CSS2DRenderer.js`'s own
 * `_vector.applyMatrix4(_viewProjectionMatrix)` - i.e. this is the same
 * frustum math the renderer already uses, not a reimplementation) rather
 * than manual dot-product/FOV-angle math: simpler, and it's the standard
 * library entry point for exactly this question.
 *
 * `behindCamera` is tracked as its own field, separate from the NDC
 * x/y/z range check (`isNdcOnScreen` below), because `Vector3.project`'s
 * perspective divide (`Vector3.applyMatrix4`: `w = 1 / (...)`, see
 * `node_modules/three/src/math/Vector3.js`) flips the sign of the
 * projected x/y whenever the point is behind the camera (negative `w`) -
 * so a point that is physically to the camera's right but behind it
 * projects to a *negative* (left-side) NDC x. Left uncorrected, that sign
 * flip would make `edgeClampedDirection` below point the fallback
 * indicator the wrong way whenever the target is behind the camera - not
 * just fail to hide it (this file's `isNdcOnScreen` still correctly detects
 * "not on screen" either way, since - see this constant's derivation - the
 * projection matrix's z-row makes NDC z fall outside `[-1, 1]` for every
 * behind-camera point, independent of x/y - but direction needs the
 * explicit flag to un-mirror x/y for a sensible arrow direction).
 * `viewSpace.z >= 0` (three.js cameras look down their own local -Z) is
 * the direct, no-sign-ambiguity way to ask "is this point behind the
 * camera plane" - computed via `camera.matrixWorldInverse` alone, before
 * the projection matrix's perspective divide can flip anything.
 */
export interface NdcProjection {
  x: number;
  y: number;
  z: number;
  behindCamera: boolean;
}

const _viewSpaceScratch = new Vector3();
const _ndcScratch = new Vector3();

/** Projects a world-space `point` through `camera` into normalized device
 * coordinates (`[-1, 1]` on every axis when on-screen and in front), plus
 * a `behindCamera` flag computed independently (see this section's
 * docstring above for why that can't be inferred from NDC x/y alone).
 * Takes a `Camera` (not the app's concrete `PerspectiveCamera`) since
 * nothing here needs anything beyond `matrixWorldInverse`/
 * `projectionMatrix`, both on the base class - keeps this callable from
 * tests with any camera instance. */
export function projectToNdc(point: Vector3, camera: Camera): NdcProjection {
  const viewSpace = _viewSpaceScratch.copy(point).applyMatrix4(camera.matrixWorldInverse);
  const ndc = _ndcScratch.copy(point).project(camera);
  return { x: ndc.x, y: ndc.y, z: ndc.z, behindCamera: viewSpace.z >= 0 };
}

/** True when `ndc` is genuinely visible on-screen right now: in front of
 * the camera (not `behindCamera`) and within the `[-1, 1]` NDC cube on all
 * three axes - the same test `CSS2DRenderer.render()` itself applies for
 * its `z` component (see this section's top docstring), extended to `x`/
 * `y` too since (unlike `CSS2DRenderer`) this drive a genuine "keep the
 * label element or fall back to the edge indicator" decision, and a point
 * can be in front of the camera (valid `z`) while still well outside the
 * horizontal/vertical field of view (invalid `x`/`y`) - exactly the #154
 * "off to the side" half of the reported failure mode, distinct from the
 * "fully behind" half. */
export function isNdcOnScreen(ndc: NdcProjection): boolean {
  return (
    !ndc.behindCamera &&
    ndc.x >= -1 &&
    ndc.x <= 1 &&
    ndc.y >= -1 &&
    ndc.y <= 1 &&
    ndc.z >= -1 &&
    ndc.z <= 1
  );
}

/** The on-screen 2D direction (not yet clamped/normalized to any particular
 * length) toward where `ndc`'s source point would appear, correcting for
 * the behind-camera sign flip described in this section's top docstring:
 * un-mirrored (negated) whenever `ndc.behindCamera`, passed through
 * unchanged otherwise (a point that's in front but simply outside the
 * horizontal/vertical FOV needs no correction - its raw NDC x/y already
 * point the right way, just beyond `[-1, 1]`). */
export function edgeClampedDirection(ndc: NdcProjection): { x: number; y: number } {
  return {
    x: ndc.behindCamera ? -ndc.x : ndc.x,
    y: ndc.behindCamera ? -ndc.y : ndc.y,
  };
}

/** How close to the true viewport edge (NDC `[-1, 1]`) the fallback
 * indicator is allowed to sit - `0.95` rather than `1.0` keeps a small
 * margin so the indicator's own text/glyph never gets clipped by the
 * viewport boundary itself. */
export const GALACTIC_CENTER_EDGE_MARGIN = 0.95;

/** Scales `direction` (from `edgeClampedDirection`) so its largest-magnitude
 * axis lands exactly at `margin`, preserving direction - i.e. projects the
 * direction outward onto the edge of an axis-aligned `[-margin, margin]`
 * square, the standard "clamp a ray to a screen-edge box" construction
 * behind every off-screen compass/radar-arrow UI. Total even for the
 * degenerate zero vector (the target point sits exactly behind the camera
 * along its own view axis, so it has no well-defined on-screen direction);
 * defaults to straight up in that case, an arbitrary but harmless choice
 * since the app's camera can only line up with the Galactic Center point's
 * exact antipode from a measure-zero set of poses. */
export function clampDirectionToEdge(
  direction: { x: number; y: number },
  margin: number = GALACTIC_CENTER_EDGE_MARGIN,
): { x: number; y: number } {
  const scale = Math.max(Math.abs(direction.x), Math.abs(direction.y));
  if (scale === 0) {
    return { x: 0, y: margin };
  }
  const factor = margin / scale;
  return { x: direction.x * factor, y: direction.y * factor };
}

/** Where the "Galactic Center" indicator should render this frame: either
 * the real 3D-anchored `CSS2DObject` position (`onScreen: true`, #149's
 * existing behavior, left untouched) or edge-clamped NDC coordinates for
 * the plain-DOM fallback indicator (`onScreen: false`) - `main.ts`'s
 * `applyGalacticCenterLabelPosition` calls this once per frame (after
 * `projectToNdc`) and drives both the `CSS2DObject`'s `.visible` and the
 * fallback element's on-screen position from the result, so exactly one of
 * the two is ever showing. */
export interface GalacticCenterIndicatorPlacement {
  onScreen: boolean;
  /** NDC x/y for the edge-clamped fallback indicator; `0` (meaningless,
   * not consulted) when `onScreen` is `true`. */
  edgeX: number;
  edgeY: number;
}

export function galacticCenterIndicatorPlacement(
  ndc: NdcProjection,
  margin: number = GALACTIC_CENTER_EDGE_MARGIN,
): GalacticCenterIndicatorPlacement {
  if (isNdcOnScreen(ndc)) {
    return { onScreen: true, edgeX: 0, edgeY: 0 };
  }
  const clamped = clampDirectionToEdge(edgeClampedDirection(ndc), margin);
  return { onScreen: false, edgeX: clamped.x, edgeY: clamped.y };
}

/**
 * Builds the plain-DOM fallback indicator element (issue #154) shown in
 * place of the anchored `galactic-center-label` `CSS2DObject` whenever
 * `galacticCenterIndicatorPlacement` reports `onScreen: false`. Deliberately
 * NOT a `CSS2DObject`/parented under `axes` like `createGalacticCenterLabel`
 * above: `CSS2DRenderer.render()` (see this file's top-of-section docstring)
 * recomputes and overwrites every `CSS2DObject`'s `style.transform`/
 * `style.display` from its own *3D* position every frame, which is exactly
 * the mechanism this fallback needs to escape - its whole point is to sit
 * at a screen-space position with no single well-defined 3D point behind
 * it. Appended directly under the app container (by `main.ts`, mirroring
 * `createLabelRenderer`'s own `container.appendChild`) rather than under
 * `labelRenderer.domElement`, so `CSS2DRenderer` never touches it at all;
 * `main.ts`'s `applyGalacticCenterLabelPosition` sets its `style.left`/
 * `style.top`/`style.display` and the arrow's `style.transform` directly,
 * every frame, from `galacticCenterIndicatorPlacement`'s result.
 *
 * Split from `document.createElement` the same way `createGalacticCenterLabel`
 * is (see that function's docstring) - this only builds/returns the
 * elements; nothing here depends on a live camera or per-frame state, so
 * it stays a one-time construction call from `main.ts`.
 */
export interface GalacticCenterEdgeIndicator {
  element: HTMLDivElement;
  arrow: HTMLSpanElement;
}

export function createGalacticCenterEdgeIndicator(): GalacticCenterEdgeIndicator {
  const element = document.createElement("div");
  element.className = "galactic-center-edge-indicator";
  element.style.display = "none";

  const arrow = document.createElement("span");
  arrow.className = "galactic-center-edge-indicator__arrow";
  arrow.textContent = "▲"; // "▲" - rotated per-frame to point toward the real direction.
  element.appendChild(arrow);

  const label = document.createElement("span");
  label.className = "galactic-center-edge-indicator__label";
  label.textContent = "Galactic Center";
  element.appendChild(label);

  return { element, arrow };
}
