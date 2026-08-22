import "./style.css";
import { Raycaster, Vector3 } from "three";
import { createCamera, createControls, deriveMinZoomDistancePc } from "./scene/camera";
import { createRenderer, createScene } from "./scene/createScene";
import { createSunMarker, sunCoreRadiusPc } from "./scene/sun";
import { createGalacticPlane } from "./scene/galacticPlane";
import {
  createAxes,
  createGalacticCenterEdgeIndicator,
  createGalacticCenterLabel,
  galacticCenterIndicatorPlacement,
  galacticCenterLabelPosition,
  projectToNdc,
} from "./scene/axes";
import {
  catalogObjectTypes,
  createCatalogObjectGroup,
  excludeDedicatedMarkerObjects,
  isSelectedObjectVisible,
  markerRadiusPc,
  selectedMarkerRadiusPc,
  SUN_OBJECT_ID,
  updateBackgroundDimming,
  updateCatalogSizeScale,
  updateCatalogVisibility,
  updateDenseBatchLod,
  visibleCatalogObjects,
  type CatalogBucket,
} from "./scene/objects";
import {
  denseBatchCollectionRadiusPc,
  isCameraInsideDenseBatchSphere,
  isDenseBatchMember,
  passesDenseBatchLod,
} from "./scene/lod";
import { createDenseBatchBoundaryLayer, isDenseBatchBoundaryVisible } from "./scene/denseBatchBoundary";
import { createSelectionIndicator } from "./scene/selectionIndicator";
import { loadScene } from "./scene/sceneData";
import {
  createGouldBeltLabel,
  createGouldBeltLayer,
  createLocalBubbleLayer,
  createRadcliffeWaveLabel,
  createRadcliffeWaveLayer,
  setGouldBeltDimmed,
  setLocalBubbleDimmed,
  setRadcliffeWaveDimmed,
} from "./scene/structures";
import {
  createLabelRenderer,
  createLabelsLayer,
  createSunLabel,
  DENSE_BATCH_MAX_VISIBLE_LABELS,
  effectiveMaxLabelDistancePc,
  hasProperName,
  MAX_VISIBLE_LABELS,
  selectDenseBatchLabels,
  selectNearestLabels,
  shouldShowLabel,
  shouldShowSunLabel,
  type DenseBatchLabelRankCandidate,
  type LabelRankCandidate,
} from "./scene/labels";
import { DEFAULT_RADIUS_PC, RADIUS_PRESETS_PC, isWithinRadius } from "./scene/radiusFilter";
import {
  edgeOnPose,
  faceOnPose,
  fitAllPose,
  objectCenteredPose,
  perspectivePose,
  sunCenteredPose,
  topViewPose,
  type CameraPose,
} from "./scene/cameraPresets";
import { pickSceneObject, toNdc } from "./scene/picking";
import { exportSceneAsPng } from "./scene/pngExport";
import { createControlPanel } from "./ui/controls";
import { Inspector } from "./ui/inspector";
import { createSearchBox } from "./ui/search";
import { createFovReadout } from "./ui/fovReadout";
import { fovExtentPc } from "./scene/fov";
import type { SceneObject } from "./scene/sceneTypes";

/**
 * Application entry point (spec Idea.md §22, Story #65). Extends Story
 * #64's base scene scaffolding (Sun / Galactic Plane / axes / catalog
 * objects) with the full interaction layer: layer toggles, labels, the
 * inspector, radius filtering, camera presets, and PNG export (issue #65's
 * six acceptance-criteria items).
 */

// The reference plane/axes are sized to cover the largest radius preset so
// switching the radius filter never needs to resize them - only catalog
// object *visibility* is radius-filtered (spec §28: structures/reference
// geometry are not radius-filtered, consistent with the Python
// `build_scene()` behavior per Story #63).
const WORLD_EXTENT_PC = Math.max(...RADIUS_PRESETS_PC);

const app = document.getElementById("app");
if (!app) {
  throw new Error("missing #app container element");
}

const status = document.createElement("div");
status.id = "status";
status.textContent = "Loading scene...";
app.appendChild(status);

const renderer = createRenderer(app);
const scene = createScene();
const camera = createCamera();
const controls = createControls(camera, renderer.domElement);
const labelRenderer = createLabelRenderer(app);

const sunMarker = createSunMarker();
scene.add(sunMarker.group);
// The Sun's dedicated label (issue #105, spec §2.5) - parented to the Sun's
// own marker group (both live at the coordinate origin) rather than the
// catalog `labelsInfo.group` below, since the Sun isn't a catalog object
// that flows through `createLabelsLayer` (see `createSunLabel`'s
// docstring). Visibility is driven solely by `updateLabelVisibility`.
const sunLabel = createSunLabel();
sunMarker.group.add(sunLabel);
const galacticPlaneGroup = createGalacticPlane(WORLD_EXTENT_PC);
scene.add(galacticPlaneGroup);
const axes = createAxes(WORLD_EXTENT_PC);
scene.add(axes);
// Issue #146: mark the +X axis's real-world meaning (Galactic Center
// direction, spec §6/§27) directly in the scene rather than leaving it to
// documentation - parented under `axes` itself (like `createGouldBeltLabel`
// parented under its own structure group) so it travels with the axis line
// it annotates. Issue #149: kept as its own named binding (not inlined into
// `axes.add(...)`) so `applyGalacticCenterLabelPosition` below can reposition
// it every frame.
const galacticCenterLabel = createGalacticCenterLabel(WORLD_EXTENT_PC);
axes.add(galacticCenterLabel);
// Issue #154: the Validator found #149's dynamic label still silently
// vanishes when the camera orbits far from the origin (e.g. searching a
// distant catalog object like `* 55 Cyg` via "go to object", issue #106) -
// the +X axis line the label rides can fall entirely outside the frustum,
// which no distance-along-that-line fix can address. This plain-DOM
// element (NOT a `CSS2DObject` - see `createGalacticCenterEdgeIndicator`'s
// docstring for why) is the fallback: an edge-clamped "compass arrow"
// indicator shown instead of `galacticCenterLabel` whenever the real 3D
// point isn't on-screen. Appended directly to `app` (mirroring
// `createLabelRenderer`'s own `container.appendChild`), independent of
// `labelRenderer`'s DOM subtree, so `CSS2DRenderer` never touches it.
const galacticCenterEdgeIndicator = createGalacticCenterEdgeIndicator();
app.appendChild(galacticCenterEdgeIndicator.element);

// Issue #123: the selection reticle + line-to-Sun indicator, a persistent
// scene object (like `sunMarker` above) that `selectObject`/
// `refreshSelectionVisibility` below reposition, rescale, and show/hide as
// the selection changes, rather than being created/destroyed per click.
// Issue #150: this pair is the ONLY two call sites that touch its
// transform - there is deliberately no per-frame call any more (see
// `showSelectionIndicatorFor`'s docstring below for why).
const selectionIndicator = createSelectionIndicator();
scene.add(selectionIndicator.group);

const inspector = new Inspector();
app.appendChild(inspector.element);

// Issue #125: field-of-view extent readout, bottom-right.
const fovReadout = createFovReadout();
app.appendChild(fovReadout.element);

// Issue #143: a single hamburger button, always present (created here at
// top-level startup, not inside `loadScene().then(...)` below, so it's
// visible even before scene data loads), toggling a shared container that
// holds both the Search box (#106) and the Structures control panel
// (`createControlPanel`, previously always-visible top-left). Both panels
// are appended into `menuPanels` once they're created below (they're built
// asynchronously, after the scene data loads) - `menuPanels` itself starts
// empty and hidden, so toggling before the scene has loaded is a harmless
// no-op (nothing inside it yet).
const menuPanels = document.createElement("div");
menuPanels.id = "menu-panels";
app.appendChild(menuPanels);

const menuToggle = document.createElement("button");
menuToggle.id = "menu-toggle";
menuToggle.type = "button";
menuToggle.textContent = "☰";
menuToggle.setAttribute("aria-label", "Toggle Search and Structures panels");
menuToggle.setAttribute("aria-expanded", "false");
menuToggle.addEventListener("click", () => {
  const open = menuPanels.classList.toggle("open");
  menuToggle.setAttribute("aria-expanded", String(open));
});
app.appendChild(menuToggle);

const raycaster = new Raycaster();

let radiusPc = DEFAULT_RADIUS_PC;
let sizeScale = 1;
let labelsEnabled = true;
let selectedObjectId: string | null = null;

const categoryVisibility = new Map<string, boolean>();
const structureVisibility = new Map<string, boolean>([
  ["galactic-plane", true],
  ["gould-belt", true],
  ["radcliffe-wave", true],
  ["local-bubble", true],
]);

// Populated once the scene loads.
let catalogBuckets: CatalogBucket[] = [];
let catalogObjects: SceneObject[] = [];
let labelsInfo: ReturnType<typeof createLabelsLayer> | null = null;
let gouldBeltGroup: ReturnType<typeof createGouldBeltLayer> | null = null;
let radcliffeWaveGroup: ReturnType<typeof createRadcliffeWaveLayer> | null = null;
let localBubbleGroup: ReturnType<typeof createLocalBubbleLayer> | null = null;
/** Issue #138: the dense-batch collection-radius boundary shell - built
 * once, right after `denseBatchRadiusPc` below is computed from the loaded
 * scene data (see `denseBatchBoundary.ts`'s `createDenseBatchBoundaryLayer`
 * docstring for why this doesn't need per-frame geometry rebuilding the
 * way `sunMarker.core` does). `null` until the scene loads, and stays
 * `null` thereafter if no dense-batch member was present (radius 0). */
let denseBatchBoundaryMesh: ReturnType<typeof createDenseBatchBoundaryLayer> | null = null;

/** Issue #104: the dense RECONS batch's own collection radius (pc),
 * derived once from the loaded scene data (`lod.ts`'s
 * `denseBatchCollectionRadiusPc`) rather than hard-coded - `0` (its
 * initial value, before the scene has loaded) makes `passesDenseBatchLod`
 * hide every dense-batch member until the real radius is known, which is
 * the correct "not loaded yet" state anyway. */
let denseBatchRadiusPc = 0;

function applyCatalogVisibility(): void {
  updateCatalogVisibility(
    catalogBuckets,
    categoryVisibility,
    radiusPc,
    camera.position.length(),
    denseBatchRadiusPc,
  );
  updateCatalogSizeScale(catalogBuckets, sizeScale);
  refreshSelectionVisibility();
}

/** Issue #104: re-applies just the camera-distance-gated (LOD) visibility
 * rule for the dense RECONS batch, cheaply, every frame (see
 * `objects.ts`'s `updateDenseBatchLod` docstring for why this is split out
 * from the full `applyCatalogVisibility()` above rather than calling that
 * every frame - it would needlessly re-touch every one of the ~956
 * catalog objects' instance matrices instead of just the ~122 gated
 * ones). Category/radius-filter changes still go through the full
 * `applyCatalogVisibility()` path above, so the two mechanisms never
 * disagree about what's currently visible.
 *
 * Issue #119: this same call now also carries the dense batch's `star`
 * instances' camera-distance-dependent marker radius (`objects.ts`'s
 * `starMarkerRadiusPc`, applied inside `updateDenseBatchLod` itself) - no
 * separate per-frame call needed, since both LOD effects (visibility,
 * radius) only ever apply to the same dense-batch subset. */
function applyDenseBatchLod(): void {
  updateDenseBatchLod(
    catalogBuckets,
    categoryVisibility,
    radiusPc,
    camera.position.length(),
    denseBatchRadiusPc,
  );
}

/** Issue #113 (extended by #136): rescales the Sun's opaque core each
 * frame/camera-move so it doesn't visually engulf the RECONS dense batch's
 * own nearby markers once the camera approaches solar-neighborhood scale -
 * see `scene/sun.ts`'s `sunCoreRadiusPc` docstring for the actual
 * distance->radius curve. Reuses the same `denseBatchRadiusPc` (populated
 * once the scene loads, `0` until then) that `applyDenseBatchLod` above
 * already benchmarks against, so the two LOD effects stay consistent with
 * each other.
 *
 * Issue #136: also passes `controls.minDistance` - #134's data-derived
 * close-zoom floor, updated in place once the scene loads (see
 * `loadScene().then(...)` below) - as the curve's new inner anchor, so the
 * core keeps shrinking all the way to the camera's actual enforced zoom
 * limit instead of freezing at the dense-batch boundary. `controls` is the
 * literal enforced limit itself, so this can never drift out of sync with
 * it the way a separately-hardcoded guess could. */
function applySunCoreScale(): void {
  sunMarker.core.scale.setScalar(
    sunCoreRadiusPc(camera.position.length(), denseBatchRadiusPc, controls.minDistance),
  );
}

/** Issue #138: toggles the dense-batch collection-radius boundary shell's
 * visibility each frame, "as soon as we enter this sphere" per the human
 * owner's request - reuses the same `denseBatchRadiusPc` that
 * `applyDenseBatchLod`/`applySunCoreScale` above already benchmark against,
 * so all three LOD-adjacent effects agree on exactly where that boundary
 * is. Kept as its own tiny, separate function (not folded into either of
 * those) since this issue's change is deliberately small and self-
 * contained. No-op if the shell was never built (`denseBatchBoundaryMesh`
 * stays `null` when `denseBatchRadiusPc` was 0 at scene-load time - see
 * `denseBatchBoundary.ts`'s `createDenseBatchBoundaryLayer` docstring). */
function applyDenseBatchBoundaryVisibility(): void {
  if (!denseBatchBoundaryMesh) return;
  denseBatchBoundaryMesh.visible = isDenseBatchBoundaryVisible(
    camera.position.length(),
    denseBatchRadiusPc,
  );
}

/** Issue #137: tracks whether the camera was inside the RECONS dense
 * batch's own collection sphere as of the last frame this ran, so
 * `applyBackgroundDimming` below only touches materials on the frame the
 * camera actually crosses the boundary (in either direction) rather than
 * redundantly reassigning the same material reference every single frame. */
let cameraWasInsideDenseBatchSphere = false;

/**
 * Issue #137: dims the "background" - every non-star catalog bucket
 * (clusters, associations, extended structures - `objects.ts`'s
 * `updateBackgroundDimming`) plus the three structure-layer overlays (Gould
 * Belt, Radcliffe Wave, Local Bubble - `structures.ts`'s `set*Dimmed`) -
 * once the camera is inside the dense batch's own collection sphere, and
 * restores normal opacity once it exits, so the RECONS nearby-star
 * neighborhood reads as clearly spotlighted against everything else.
 *
 * Threshold-snap, not a smooth per-frame ramp: `lod.ts`'s own dense-batch
 * visibility gate (`passesDenseBatchLod`/`isDenseBatchMember`) already snaps
 * hard at this exact same radius, so a matching hard snap here keeps every
 * "inside the sphere" effect in this app agreeing on where the boundary is,
 * and keeps this a single boolean decision to test/reason about rather than
 * a second continuous curve alongside `sunCoreRadiusPc`'s/
 * `starMarkerRadiusPc`'s existing ramps (which shrink *radius*, a different
 * concern, for a different reason - see those functions' own docstrings).
 * Only does any work on the frame the boolean actually flips (see
 * `cameraWasInsideDenseBatchSphere` above), so this is cheap enough to call
 * unconditionally every frame alongside `applyDenseBatchLod`/
 * `applySunCoreScale`.
 *
 * Deliberately never touches the star bucket (`updateBackgroundDimming`'s
 * own `shouldDimBackground` excludes it) or any dense-batch star instance -
 * the RECONS nearby stars this issue spotlights are completely unaffected by
 * this function, satisfying #137's explicit constraint against any
 * per-instance star-opacity change. */
function applyBackgroundDimming(): void {
  const insideSphere = isCameraInsideDenseBatchSphere(camera.position.length(), denseBatchRadiusPc);
  if (insideSphere === cameraWasInsideDenseBatchSphere) return;
  cameraWasInsideDenseBatchSphere = insideSphere;

  updateBackgroundDimming(catalogBuckets, insideSphere);
  setGouldBeltDimmed(gouldBeltGroup, insideSphere);
  setRadcliffeWaveDimmed(radcliffeWaveGroup, insideSphere);
  setLocalBubbleDimmed(localBubbleGroup, insideSphere);
}

/** Issue #123: the selection reticle's scale should track the *same*
 * effective marker radius the object's own catalog instance is currently
 * rendered at - including the Sun's own #113 LOD-shrunk core radius, and
 * RECONS dense-batch stars' #119 LOD-shrunk radius - not the fixed,
 * un-shrunk `markerRadiusPc` tier alone. Mirrors `objects.ts`'s
 * `setInstanceVisibility`'s own radius resolution (same conditions, same
 * fallback order) so the reticle can never disagree with the marker it's
 * drawn around. The Sun is excluded from `catalogObjects`
 * (`excludeDedicatedMarkerObjects`) and so never actually reaches
 * `selectObject` today (out of scope: the picking mechanism itself, issue
 * #123's "if ever selectable" caveat) - handled here anyway so this stays
 * correct if that ever changes.
 *
 * Issue #130: the actual branch logic now lives in `objects.ts`'s exported,
 * pure `selectedMarkerRadiusPc` (real unit test coverage there) - this stays
 * a thin wrapper that just supplies the closure-only values (`camera`,
 * `denseBatchRadiusPc`, and #136's `controls.minDistance`) that function
 * can't see on its own. */
function selectedObjectMarkerRadiusPc(obj: SceneObject): number {
  return selectedMarkerRadiusPc(
    obj,
    SUN_OBJECT_ID,
    camera.position.length(),
    denseBatchRadiusPc,
    controls.minDistance,
  );
}

/** Issue #123: pushes the selection indicator (reticle + line-to-Sun) to
 * match `obj`'s current position/effective marker radius and shows it - the
 * single chokepoint `selectObject` and `refreshSelectionVisibility` below
 * both call, so the indicator can never diverge from what those two call
 * sites each independently know about the current selection.
 *
 * Issue #150: this used to ALSO be called once per animation frame (a
 * since-removed `updateSelectionIndicatorScale`), which meant a selected
 * object's reticle radius - for camera-distance-dependent markers, i.e. a
 * dense-LOD-batch star (#119) or the Sun (#113/#136) - was recomputed from
 * the live camera distance on every rendered frame. Selecting such an
 * object deep inside the dense-LOD sphere (small effective radius) and
 * then zooming out made the reticle's world-space size balloon back
 * toward the object's un-shrunk cap over a relatively short zoom range,
 * before perspective had shrunk it back down - visibly wrong ("the marker
 * scales infinitely large" on zoom-out). The fix is for the reticle's
 * radius to be captured ONCE per actual selection-relevant event (a new
 * selection via `selectObject`, or a visibility re-check via
 * `refreshSelectionVisibility`) and stay fixed at that value regardless of
 * subsequent camera movement - never re-derived merely because a new
 * frame rendered. This function's position-update half is unaffected and
 * unconditionally correct either way: no current object type's
 * `position_pc` ever changes after catalog load, so re-supplying it here
 * on each of those two event-driven calls is a correct no-op today and
 * the right place to pick up a future moving object, should one ever
 * exist. */
function showSelectionIndicatorFor(obj: SceneObject): void {
  selectionIndicator.updateForObject(obj.position_pc, selectedObjectMarkerRadiusPc(obj));
  selectionIndicator.setVisible(true);
}

/** Issue #125: recomputes and redisplays the field-of-view extent readout
 * each frame from the camera's *current* `fov`/`aspect` (rather than
 * caching them) and its distance to `controls.target` - the same point the
 * camera presets (`applyCameraPose`) orbit/frame around - so the readout
 * stays correct across zoom, orbit, pan, and window resize (`onResize`
 * below mutates `camera.aspect` in place) without needing its own resize
 * listener. */
function applyFovReadout(): void {
  const distancePc = camera.position.distanceTo(controls.target);
  const { horizontalPc, verticalPc } = fovExtentPc(camera.fov, camera.aspect, distancePc);
  fovReadout.update(horizontalPc, verticalPc);
}

/** Issue #95: keeps the Inspector honest whenever a filter change
 * (category toggle, radius change) may have hidden the object it's
 * currently showing. Deliberately does NOT clear `selectedObjectId` - it
 * just hides the Inspector panel while the object is filtered out, so that
 * undoing the filter (this function running again on the next
 * `applyCatalogVisibility()` call) restores the Inspector automatically
 * without the user needing to re-click the object (spec-equivalent
 * behavior to re-selection, per issue #95's "if feasible" acceptance
 * criterion). `updateLabelVisibility`'s own `withinRadius`/`layerVisible`
 * checks already independently hide a filtered-out object's label
 * regardless of `selectedObjectId` (see `scene/labels.ts`'s
 * `shouldShowLabel`), so no label-side change was needed for this issue.
 *
 * Issue #150 design choice: when a previously-hidden selected object
 * becomes visible again here, the reticle's frozen marker radius IS
 * recomputed fresh (via `showSelectionIndicatorFor`, from whatever the
 * camera distance is at that moment) rather than reusing whatever value
 * was frozen at the original selection, long before. This function only
 * runs on discrete, user-driven filter events (a category checkbox, the
 * radius slider - see `applyCatalogVisibility`'s call sites), never on a
 * per-animation-frame timer the way the now-removed per-frame recompute
 * did, so recomputing here does not reintroduce #150's "grows continuously
 * while just zooming" bug. Recomputing on re-show also reads more
 * consistently to the user - "the reticle reflects this object as it looks
 * right now that I can see it again" - than resurrecting a radius frozen
 * at a possibly very different camera distance from before the object was
 * hidden. */
function refreshSelectionVisibility(): void {
  if (selectedObjectId === null) return;
  const stillVisible = isSelectedObjectVisible(
    catalogObjects,
    selectedObjectId,
    categoryVisibility,
    radiusPc,
    camera.position.length(),
    denseBatchRadiusPc,
  );
  if (!stillVisible) {
    inspector.hide();
    // Issue #123: the reticle/line-to-Sun hide together with the Inspector,
    // driven by this same `isSelectedObjectVisible` check - never a
    // separate, potentially-out-of-sync mechanism.
    selectionIndicator.setVisible(false);
    return;
  }
  const obj = catalogObjects.find((o) => o.id === selectedObjectId);
  if (obj) {
    inspector.show(obj);
    showSelectionIndicatorFor(obj);
  }
}

function applyStructureVisibility(): void {
  galacticPlaneGroup.visible = structureVisibility.get("galactic-plane") ?? true;
  if (gouldBeltGroup) gouldBeltGroup.visible = structureVisibility.get("gould-belt") ?? true;
  if (radcliffeWaveGroup) radcliffeWaveGroup.visible = structureVisibility.get("radcliffe-wave") ?? true;
  if (localBubbleGroup) localBubbleGroup.visible = structureVisibility.get("local-bubble") ?? true;
}

function updateLabelVisibility(): void {
  // The Sun's label (issue #105) is a permanent exemption from the
  // distance/rank filtering below - wired to nothing but the global
  // labels-enabled toggle, independent of whether the catalog has finished
  // loading (`labelsInfo`, checked just below).
  sunLabel.visible = shouldShowSunLabel(labelsEnabled);

  if (!labelsInfo) return;

  // Pass 1: everything that passes the existing toggle/layer/radius/
  // distance-threshold rule (`shouldShowLabel`, unchanged from Story #65).
  // At 605 objects this alone is not enough to bound the simultaneously-
  // visible count (issue #89) - pass 2 below applies the actual cap.
  //
  // The distance threshold itself is camera-relative (issue #94): computed
  // once per call from the camera's current distance to the origin, so the
  // default zoomed-out "Perspective" pose still surfaces a reasonable set
  // of labels instead of the fixed 250pc threshold excluding literally
  // everything (see `effectiveMaxLabelDistancePc`'s docstring).
  const maxCameraDistancePc = effectiveMaxLabelDistancePc(camera.position.length());

  // Issue #114: dense RECONS-batch members (#104's LOD-gated nearby-star
  // batch, `lod.ts`'s `isDenseBatchMember`) are routed to their own pool
  // (`denseBatchCandidates`) and ranked/capped separately below, instead of
  // competing in the general `rankCandidates` pool - see the dedicated
  // block right after this loop. Everything else about this loop (the
  // base toggle/layer/radius/distance-threshold rule itself) is untouched
  // from Story #65/#89/#94.
  const rankCandidates: LabelRankCandidate[] = [];
  const denseBatchCandidates: DenseBatchLabelRankCandidate[] = [];
  for (const label of labelsInfo.labels) {
    const obj = label.object;
    const categoryOn = categoryVisibility.get(obj.object_type) ?? true;
    const withinRadius = isWithinRadius(obj.distance_pc, radiusPc);
    const cameraDistancePc = camera.position.distanceTo(label.css2dObject.position);
    const isSelected = obj.id === selectedObjectId;
    const passesBaseRule = shouldShowLabel({
      labelsEnabled,
      layerVisible: categoryOn,
      withinRadius,
      isSelected,
      cameraDistancePc,
      maxCameraDistancePc,
    });
    if (!passesBaseRule) {
      continue;
    }
    if (isDenseBatchMember(obj)) {
      // Also gated on the same LOD check that already governs this
      // object's *marker* visibility (`objects.ts`'s `updateDenseBatchLod`)
      // - reused rather than re-derived, per issue #114's brief - so a
      // dense-batch label never floats visible while its marker is hidden
      // by the LOD gate (i.e. this cap only ever engages "once the camera
      // is close enough that the #104 batch is visible").
      if (passesDenseBatchLod(obj, camera.position.length(), denseBatchRadiusPc)) {
        denseBatchCandidates.push({ id: obj.id, cameraDistancePc, isSelected, hasProperName: hasProperName(obj) });
      }
    } else {
      rankCandidates.push({ id: obj.id, cameraDistancePc, isSelected });
    }
  }

  // Pass 2: nearest-N cap (issue #89's `MAX_VISIBLE_LABELS`) among the
  // general (non-dense-batch) candidates that passed pass 1, so the
  // selected object's label always survives regardless of rank. Unchanged
  // by issue #114 - dense-batch candidates never reach this pool.
  const generalVisibleIds = selectNearestLabels(rankCandidates, MAX_VISIBLE_LABELS);

  // Issue #114: the dense batch's own, much smaller cap - proper-name
  // priority first, nearest-camera-distance as the tiebreaker (see
  // `selectDenseBatchLabels`'s docstring) - unioned with the general result
  // above. Outside the dense LOD volume `denseBatchCandidates` is always
  // empty (nothing passes the `passesDenseBatchLod` gate above), so this is
  // a no-op there and general-scale label behavior is exactly as before.
  const denseBatchVisibleIds = selectDenseBatchLabels(denseBatchCandidates, DENSE_BATCH_MAX_VISIBLE_LABELS);

  const visibleIds = new Set([...generalVisibleIds, ...denseBatchVisibleIds]);

  for (const label of labelsInfo.labels) {
    const obj = label.object;
    // `CSS2DRenderer.render()` (see node_modules/three/examples/jsm/
    // renderers/CSS2DRenderer.js) overwrites `element.style.display` every
    // frame based on its own frustum-z test (resetting it to '' whenever
    // the object is within the camera's near/far range) - so setting
    // `style.display` directly here would get silently clobbered on the
    // very next `labelRenderer.render()` call. `Object3D.visible = false`
    // is the mechanism the renderer itself respects (its `hideObject()`
    // path short-circuits before touching `display` again), so that's what
    // drives actual show/hide; `element.style.display` is left alone.
    label.css2dObject.visible = visibleIds.has(obj.id);
    label.element.classList.toggle("selected", obj.id === selectedObjectId);
  }
}

function selectObject(obj: SceneObject | null): void {
  selectedObjectId = obj ? obj.id : null;
  if (obj) {
    inspector.show(obj);
    showSelectionIndicatorFor(obj);
  } else {
    inspector.hide();
    selectionIndicator.setVisible(false);
  }
  updateLabelVisibility();
}

function currentlyVisiblePositions(): [number, number, number][] {
  return visibleCatalogObjects(
    catalogBuckets,
    categoryVisibility,
    radiusPc,
    camera.position.length(),
    denseBatchRadiusPc,
  ).map((obj): [number, number, number] => obj.position_pc);
}

function applyCameraPose(pose: CameraPose): void {
  camera.position.set(...pose.position);
  controls.target.set(...pose.target);
  controls.update();
}

/** Search / go-to-object (issue #106, spec §2.6): frames the camera closely
 * on `obj` (via `objectCenteredPose`, distance proportional to the
 * object's own marker radius) and selects it - reusing `selectObject`
 * directly so the Inspector/label-selection highlighting stays exactly as
 * consistent as a manual click-to-select. */
function goToObject(obj: SceneObject): void {
  applyCameraPose(objectCenteredPose(obj.position_pc, markerRadiusPc(obj.size_pc, obj.object_type)));
  selectObject(obj);
}

const CAMERA_PRESETS: { key: string; label: string }[] = [
  { key: "perspective", label: "Perspective" },
  { key: "top", label: "Top view" },
  { key: "face-on", label: "Face-on" },
  { key: "edge-on", label: "Edge-on" },
  { key: "sun-centered", label: "Sun-centered" },
  { key: "fit-all", label: "Fit all" },
];

function applyCameraPreset(key: string): void {
  switch (key) {
    case "perspective":
      applyCameraPose(perspectivePose());
      break;
    case "top":
      applyCameraPose(topViewPose(radiusPc));
      break;
    case "face-on":
      applyCameraPose(faceOnPose(radiusPc));
      break;
    case "edge-on":
      applyCameraPose(edgeOnPose(radiusPc));
      break;
    case "sun-centered":
      applyCameraPose(sunCenteredPose());
      break;
    case "fit-all":
      applyCameraPose(fitAllPose(currentlyVisiblePositions()));
      break;
    default:
      console.warn(`Unknown camera preset '${key}'`);
  }
}

loadScene()
  .then((sceneData) => {
    catalogObjects = excludeDedicatedMarkerObjects(sceneData.objects);
    denseBatchRadiusPc = denseBatchCollectionRadiusPc(sceneData.objects);
    // Issue #134: replace the pre-load fallback close-zoom floor
    // (`camera.ts`'s `FALLBACK_MIN_DISTANCE_PC`) with the real data-derived
    // one, now that the catalog's actual object distances are known.
    controls.minDistance = deriveMinZoomDistancePc(sceneData.objects);

    // Issue #138: the dense-batch boundary shell's radius is fixed for the
    // session once `denseBatchRadiusPc` is known - built once here rather
    // than per frame (see `createDenseBatchBoundaryLayer`'s docstring).
    // `applyDenseBatchBoundaryVisibility` (called from `animate()`) toggles
    // its `.visible` flag every frame; this is a no-op (stays `null`) if no
    // dense-batch member was present.
    denseBatchBoundaryMesh = createDenseBatchBoundaryLayer(denseBatchRadiusPc);
    if (denseBatchBoundaryMesh) scene.add(denseBatchBoundaryMesh);

    const catalogLayer = createCatalogObjectGroup(sceneData.objects);
    catalogBuckets = catalogLayer.buckets;
    scene.add(catalogLayer.group);

    labelsInfo = createLabelsLayer(catalogObjects);
    scene.add(labelsInfo.group);

    gouldBeltGroup = createGouldBeltLayer(sceneData.structures.gould_belt);
    if (gouldBeltGroup) {
      scene.add(gouldBeltGroup);
      // Issue #124's optional label: built separately from the group itself
      // (see `structures.ts`'s `structureLabel` docstring for why) and
      // parented under the SAME group, so it inherits `gouldBeltGroup`'s
      // existing `visible` flag - already driven by the "Gould Belt"
      // checkbox below via `applyStructureVisibility` - without a new
      // toggle. `gouldBeltGroup !== null` already implies
      // `sceneData.structures.gould_belt` is defined and valid.
      if (sceneData.structures.gould_belt) {
        gouldBeltGroup.add(createGouldBeltLabel(sceneData.structures.gould_belt));
      }
    }

    radcliffeWaveGroup = createRadcliffeWaveLayer(sceneData.structures.radcliffe_wave);
    if (radcliffeWaveGroup) {
      scene.add(radcliffeWaveGroup);
      // Same pattern as the Gould Belt label above.
      if (sceneData.structures.radcliffe_wave) {
        radcliffeWaveGroup.add(createRadcliffeWaveLabel(sceneData.structures.radcliffe_wave));
      }
    }

    localBubbleGroup = createLocalBubbleLayer(sceneData.structures.local_bubble);
    if (localBubbleGroup) scene.add(localBubbleGroup);

    const categories = catalogObjectTypes(sceneData.objects);
    for (const category of categories) {
      categoryVisibility.set(category, true);
    }

    // Checkboxes are always offered per issue #65's acceptance criteria
    // (Galactic Plane / Gould Belt / Radcliffe Wave / Local Bubble), even
    // if a given structure failed to build from malformed/missing data -
    // toggling a checkbox for a structure that isn't present is a no-op
    // (see applyStructureVisibility's `if (xGroup) ...` guards), not an
    // error (spec §38: missing optional layers must not break the app).
    const structureLayerItems = [
      { key: "galactic-plane", label: "Galactic Plane", defaultChecked: true },
      { key: "gould-belt", label: "Gould Belt", defaultChecked: gouldBeltGroup !== null },
      { key: "radcliffe-wave", label: "Radcliffe Wave", defaultChecked: radcliffeWaveGroup !== null },
      { key: "local-bubble", label: "Local Bubble", defaultChecked: localBubbleGroup !== null },
    ];

    const panel = createControlPanel({
      categories: categories.map((type) => ({ key: type, label: humanizeCategory(type) })),
      structureLayers: structureLayerItems,
      onCategoryToggle: (key, visible) => {
        categoryVisibility.set(key, visible);
        applyCatalogVisibility();
        updateLabelVisibility();
      },
      onStructureToggle: (key, visible) => {
        structureVisibility.set(key, visible);
        applyStructureVisibility();
      },
      onLabelsToggle: (visible) => {
        labelsEnabled = visible;
        updateLabelVisibility();
      },
      onRadiusChange: (newRadiusPc) => {
        radiusPc = newRadiusPc;
        applyCatalogVisibility();
        updateLabelVisibility();
      },
      cameraPresets: CAMERA_PRESETS,
      onCameraPreset: applyCameraPreset,
      onExportPng: () => {
        // Render both the WebGL canvas and re-sync the label layer just
        // before capture so the exported PNG reflects the current view
        // (label text itself is DOM/CSS2D, outside the canvas, and is not
        // part of the PNG - spec §39 asks for "at minimum" a WebGL PNG
        // screenshot, which this provides).
        exportSceneAsPng(renderer, scene, camera);
      },
      onSizeScaleChange: (scale) => {
        sizeScale = scale;
        applyCatalogVisibility();
      },
    });

    const searchBox = createSearchBox({
      getObjects: () => catalogObjects,
      onSelect: goToObject,
    });

    // Issue #143: both panels live inside the shared `menuPanels` toggle
    // container (top-left) instead of directly in `#app` - Search first
    // (top), Structures panel below it (bottom), per the human owner's
    // requested stacking order. Neither panel's own internal
    // content/behavior changes - only where it's mounted.
    menuPanels.appendChild(searchBox.element);
    menuPanels.appendChild(panel);

    applyCatalogVisibility();
    applyStructureVisibility();
    updateLabelVisibility();

    const catalogCount = catalogObjects.length;
    status.textContent = `${catalogCount} catalog objects + Sun - ${sceneData.metadata.coordinate_system}`;
  })
  .catch((error: unknown) => {
    // Per spec §38 ("missing optional layers do not break the
    // application") the base scene (Sun/plane/axes) still renders even if
    // the catalog fails to load.
    console.error("Failed to load scene data", error);
    status.textContent = "Failed to load scene data - see console.";
  });

function humanizeCategory(objectType: string): string {
  return objectType
    .split("_")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

// `OrbitControls` also listens for pointer drags on this same element - a
// plain `click` handler alone would misfire a selection at the drag's end
// position after an orbit/pan gesture. Track the pointerdown position and
// only treat it as an object-picking click if the pointer barely moved
// (spec §24's "clicking ... an object" implies a deliberate click on that
// object, not the incidental mouseup at the end of a camera drag).
const CLICK_DRAG_THRESHOLD_PX = 5;
let pointerDownClientPos: { x: number; y: number } | null = null;

renderer.domElement.addEventListener("pointerdown", (event) => {
  pointerDownClientPos = { x: event.clientX, y: event.clientY };
});

renderer.domElement.addEventListener("click", (event) => {
  if (catalogBuckets.length === 0) return;
  if (pointerDownClientPos) {
    const dx = event.clientX - pointerDownClientPos.x;
    const dy = event.clientY - pointerDownClientPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > CLICK_DRAG_THRESHOLD_PX) {
      return;
    }
  }
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = toNdc(event.clientX, event.clientY, rect);
  const hit = pickSceneObject(raycaster, camera, ndc, catalogBuckets);
  selectObject(hit);
});

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", onResize);

// Issue #150: there used to be an `updateSelectionIndicatorScale()` here,
// called once per animation frame from `animate()` below, which re-ran
// `showSelectionIndicatorFor` (and so recomputed `selectedObjectMarkerRadiusPc`
// from the CURRENT camera distance) on every single rendered frame while
// something was selected. That was the actual bug (#123/#130 follow-up):
// for camera-distance-dependent markers (a dense-LOD-batch star, #119, or
// the Sun, #113/#136), continuously re-tracking the live radius made the
// reticle's world-space size balloon back up as the user zoomed OUT from
// inside the dense-LOD sphere, well before perspective had shrunk it back
// down - see `showSelectionIndicatorFor`'s docstring above for the full
// writeup. The fix is to delete this per-frame call entirely: the reticle's
// radius is now captured only at the two actual selection-relevant events
// (`selectObject`, `refreshSelectionVisibility`), and nothing else needs a
// per-frame check here today - no current object type's position ever
// changes after catalog load, so there is no remaining per-frame work for
// this function to do (verified: `refreshSelectionVisibility`'s own
// visibility-toggle behavior is untouched, since it doesn't depend on this
// removed function at all).

/** Scratch vector for `applyGalacticCenterLabelPosition`'s per-frame
 * `projectToNdc` call - reused rather than allocated fresh every frame,
 * mirroring `scene/axes.ts`'s own module-level scratch vectors. */
const _galacticCenterPointScratch = new Vector3();

/**
 * Issue #149: repositions the "Galactic Center" label along +X every frame
 * from the camera's *current* distance from the origin
 * (`camera.position.length()`), replacing #146's single static world-space
 * point - mirrors this file's other per-frame adaptive patterns
 * (`applyFovReadout` #125, `applySunCoreScale` #113) rather than computing
 * the position once at scene-build time. The actual formula/clamping lives
 * in `scene/axes.ts`'s pure, unit-tested `galacticCenterLabelPosition`; this
 * is just the thin wrapper supplying the closure-only `camera`/
 * `galacticCenterLabel` values that function can't see on its own (same
 * split as `selectedObjectMarkerRadiusPc` above, for the same reason).
 *
 * Issue #154 (Validator-flagged gap in #149): #149's fix above only ever
 * moves the label *along the +X axis line itself*, which stays in the
 * frustum only while the camera orbits near the origin - true for every
 * built-in preset, but false once "go to object" search (issue #106)
 * recenters `controls.target` on a real, distant catalog object (e.g.
 * `* 55 Cyg`, ~1840pc, mostly along +Y): the whole +X axis line, label
 * point included, can fall completely outside the frustum, silently
 * dropping the label exactly like #146's original bug. Fixed here by
 * checking, every frame, whether the real 3D point is actually on-screen
 * (`projectToNdc` + `galacticCenterIndicatorPlacement`, both in
 * `scene/axes.ts`): when it is, behavior is unchanged from #149 (the
 * anchored `CSS2DObject` shows, positioned/visibility-driven exactly as
 * before); when it isn't, that `CSS2DObject` is hidden and
 * `galacticCenterEdgeIndicator` (a plain DOM element, NOT a `CSS2DObject` -
 * see its own docstring for why) is shown instead, clamped to the edge of
 * the viewport in the correct on-screen direction - the standard
 * off-screen compass/radar-arrow pattern, so the label never fully
 * disappears regardless of where the camera is looking.
 */
function applyGalacticCenterLabelPosition(): void {
  const [x, y, z] = galacticCenterLabelPosition(camera.position.length(), WORLD_EXTENT_PC);
  galacticCenterLabel.position.set(x, y, z);

  _galacticCenterPointScratch.set(x, y, z);
  const ndc = projectToNdc(_galacticCenterPointScratch, camera);
  const placement = galacticCenterIndicatorPlacement(ndc);

  galacticCenterLabel.visible = placement.onScreen;

  if (placement.onScreen) {
    galacticCenterEdgeIndicator.element.style.display = "none";
    return;
  }

  const widthHalf = window.innerWidth / 2;
  const heightHalf = window.innerHeight / 2;
  // Same NDC->pixel conversion `CSS2DRenderer.render()` itself uses (see
  // `node_modules/three/examples/jsm/renderers/CSS2DRenderer.js`), so this
  // fallback indicator lines up with where the anchored label would have
  // rendered had it been on-screen.
  const pixelX = placement.edgeX * widthHalf + widthHalf;
  const pixelY = -placement.edgeY * heightHalf + heightHalf;

  galacticCenterEdgeIndicator.element.style.display = "";
  galacticCenterEdgeIndicator.element.style.left = `${pixelX}px`;
  galacticCenterEdgeIndicator.element.style.top = `${pixelY}px`;
  // Screen-space angle measured clockwise from "up" (`atan2(x, y)`, not the
  // usual `atan2(y, x)` from "right") - matches CSS `rotate()`'s clockwise-
  // positive convention directly against the arrow glyph's own upward
  // resting orientation ("▲"), with NDC's +y-is-up requiring no pixel-space
  // flip here (unlike the position conversion above).
  const angleDeg = Math.atan2(placement.edgeX, placement.edgeY) * (180 / Math.PI);
  galacticCenterEdgeIndicator.arrow.style.transform = `rotate(${angleDeg}deg)`;
}

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  updateLabelVisibility();
  applyDenseBatchLod();
  applySunCoreScale();
  applyDenseBatchBoundaryVisibility();
  applyBackgroundDimming();
  applyFovReadout();
  applyGalacticCenterLabelPosition();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
