import "./style.css";
import { Raycaster, Vector3 } from "three";
import {
  createCamera,
  createControls,
  deriveMinZoomDistancePc,
  dollyPosition,
  dollyPositionSteps,
} from "./scene/camera";
import { createRenderer, createScene } from "./scene/createScene";
import { createSunMarker, sunCoreRadiusPc } from "./scene/sun";
import { createGalacticPlane } from "./scene/galacticPlane";
import {
  createAxes,
  createGalacticCenterEdgeIndicator,
  createGalacticCenterLabel,
  galacticCenterIndicatorPlacement,
  galacticCenterLabelPosition,
  galacticCenterOnScreenArrowAngleDeg,
  projectToNdc,
} from "./scene/axes";
import {
  bubbleOuterRadiusPcFrom,
  buildObjectIndexLookup,
  catalogObjectTypes,
  createCatalogObjectGroup,
  excludeDedicatedMarkerObjects,
  isCatalogObjectVisible,
  isSelectedObjectVisible,
  markerRadiusPc,
  selectedMarkerRadiusPc,
  setInstanceVisibility,
  SUN_OBJECT_ID,
  updateBackgroundDimming,
  updateCatalogSizeScale,
  updateCatalogVisibility,
  updateDenseBatchLod,
  visibleCatalogObjects,
  type CatalogBucket,
  type CatalogObjectRef,
} from "./scene/objects";
import {
  denseBatchCollectionRadiusPc,
  effectiveInsideLocalBubble,
  isCameraInsideDenseBatchSphere,
  isCameraInsideLocalBubble,
  isDenseBatchMember,
  passesDenseBatchLod,
} from "./scene/lod";
import { createDenseBatchBoundaryLayer, isDenseBatchBoundaryVisible } from "./scene/denseBatchBoundary";
import { createSelectionIndicator } from "./scene/selectionIndicator";
import { loadScene } from "./scene/sceneData";
import {
  createVelocitySpeedLabelsLayer,
  createVelocityVectorsLayer,
  nextVelocityVectorsToggleOn,
  selectVisibleVelocitySpeedLabelIds,
  starsWithVelocityInLocalBubble,
  VELOCITY_SPEED_LABEL_MAX_VISIBLE,
  velocityVectorsVisible,
} from "./scene/velocityVectors";
import {
  advancePlayerTimeYears,
  clampPlayerTimeYears,
  isUiLockedForPlayerTime,
  logSpeedSliderToYearsPerSecond,
  nextPlayerStateForSphere,
  nudgeRateSliderValue,
  starPositionAtTime,
  type PlayerDirection,
  type PlayerState,
} from "./scene/motionPlayer";
import {
  createMotionTrailsLayer,
  isTrailVisible,
  starTrailPositionsPc,
  updateStarTrail,
  type StarTrail,
} from "./scene/motionTrail";
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
  type CatalogLabel,
  type DenseBatchLabelRankCandidate,
  type LabelRankCandidate,
} from "./scene/labels";
import { DEFAULT_RADIUS_PC, RADIUS_PRESETS_PC, isWithinRadius } from "./scene/radiusFilter";
import {
  denseBatchObjectFrameMaxDistancePc,
  edgeOnPose,
  fitAllPose,
  fitSpherePose,
  objectCenteredPose,
  perspectivePose,
  sunCenteredPose,
  topViewPose,
  type CameraPose,
} from "./scene/cameraPresets";
import { pickSceneObject, toNdc } from "./scene/picking";
import { exportSceneAsPng } from "./scene/pngExport";
import {
  createLayersPanel,
  createSettingsPanel,
  createCameraPanel,
  type LayersPanelHandle,
  type SettingsPanelHandle,
  type SidePanelHandle,
} from "./ui/controls";
import { Inspector } from "./ui/inspector";
import { InfoDialog } from "./ui/infoDialog";
import { SearchDialog } from "./ui/searchDialog";
import { createSearchBox } from "./ui/search";
import { createPlayerPanel } from "./ui/playerPanel";
import { createFovReadout } from "./ui/fovReadout";
import { createFullscreenToggle } from "./ui/fullscreenToggle";
import { fovExtentPc } from "./scene/fov";
import type { LocalBubbleStructure, SceneObject } from "./scene/sceneTypes";

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
// Issue #155: destructured out (not just the `CSS2DObject`) so
// `applyGalacticCenterLabelPosition` below can also rotate the label's own
// direction-arrow child element every frame - see `createGalacticCenterLabel`'s
// updated docstring in `scene/axes.ts` for why that arrow is a plain nested
// `<span>` rather than a second `CSS2DObject`.
const { css2dObject: galacticCenterLabel, arrow: galacticCenterLabelArrow } =
  createGalacticCenterLabel(WORLD_EXTENT_PC);
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

// Issue #98: the Inspector's own `×` button is wired to `selectObject(null)`
// (rather than just closing the panel) so an explicit close is treated as a
// full deselection - clearing `selectedObjectId` so a later filter change
// doesn't resurrect the panel via `refreshSelectionVisibility`'s #95
// re-show behavior, and (as a consequence of going through the same
// `selectObject` chokepoint used elsewhere) also hiding the selection
// reticle/line-to-Sun and clearing the selected label highlight. `hide()`
// itself is still called directly by `refreshSelectionVisibility`'s
// filter-hide case below, which must NOT clear the selection - see that
// function's docstring.
const inspector = new Inspector(() => selectObject(null));
app.appendChild(inspector.element);

// Issue #125: field-of-view extent readout, bottom-right.
const fovReadout = createFovReadout();
app.appendChild(fovReadout.element);

/** Issue #203's magnifying-glass inline SVG for the Search button
 * (`stroke="currentColor"`, so it inherits the button's own `color` for
 * free, same as the toolbar's other icons below). Story #256: shrunk from
 * 30x30 (sized for the old 68x68px top-left button) to 18x18, matching the
 * new compact `#left-toolbar` button size. */
const SEARCH_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="10.5" cy="10.5" r="6.5" />
    <path d="M15.5 15.5 L21 21" />
  </svg>
`;

/** Story #257: inline SVG glyphs for the three new `#left-toolbar` trigger
 * icons (positions #2/#3/#4) that open the Layers/Settings/Camera panels
 * below - same `stroke="currentColor"` convention as `SEARCH_ICON_SVG`
 * above and the other toolbar icons further down, sized 20x20 to match
 * `SHOW_ALL_ICON_SVG`/`FIT_LOCAL_BUBBLE_ICON_SVG`/etc.
 *
 * `LAYERS_ICON_SVG`: the classic stacked-layers glyph (a diamond plus two
 * chevrons beneath it) - reads as "toggle what's shown", matching this
 * panel's Object-categories/Structures checkbox content.
 * `SETTINGS_ICON_SVG`: a plain gear - Radius/Object size/Save PNG.
 * `CAMERA_ICON_SVG`: a camera body + lens - the camera pose presets. */
const LAYERS_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 3 L21 8 L12 13 L3 8 Z" />
    <path d="M3 12 L12 17 L21 12" />
    <path d="M3 16 L12 21 L21 16" />
  </svg>
`;

const SETTINGS_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="12" cy="12" r="3.2" />
    <path d="M12 2.5 V5.5 M12 18.5 V21.5 M2.5 12 H5.5 M18.5 12 H21.5
              M5.1 5.1 L7.2 7.2 M16.8 16.8 L18.9 18.9 M5.1 18.9 L7.2 16.8 M16.8 7.2 L18.9 5.1" />
  </svg>
`;

const CAMERA_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M3 8 H8 L9.5 6 H14.5 L16 8 H21 V18 H3 Z" />
    <circle cx="12" cy="13" r="3.4" />
  </svg>
`;

// Issue #203: dedicated Search button, opens `searchDialog` (built just
// below) - entirely independent of the Story #257 side panels' own
// open/closed state (`openSidePanel`/`closeSidePanel` further below only
// ever touch the Layers/Settings/Camera panels, never this modal).
// Story #256: relocated from its own standalone 68x68px top-left button
// into the new `#left-toolbar` (below) as item #1, sharing the toolbar's
// compact `.toolbar-button`/`.toolbar-button--icon` sizing/styling with
// every other relocated button rather than its own dedicated CSS rule.
const searchToggle = document.createElement("button");
searchToggle.id = "search-toggle";
searchToggle.type = "button";
searchToggle.className = "toolbar-button toolbar-button--icon";
searchToggle.innerHTML = SEARCH_ICON_SVG;
searchToggle.title = "Search objects";
searchToggle.setAttribute("aria-label", "Search objects");

// Issue #203: the modal shell (scrim + panel + close button) is built here,
// at top-level startup like `infoDialog` below, so the button is clickable
// immediately - `createSearchBox`'s own element (built once the scene loads,
// inside `loadScene().then(...)` below, since it needs the live catalog) is
// mounted into it later via `searchDialog.appendContent(...)`.
const searchDialog = new SearchDialog();
app.appendChild(searchDialog.element);
// Issue #292: wrapped via `withLockedButtonEscapeHatch` (defined further
// below, but hoisted - see that function's own docstring) like every other
// button in `syncUiLock`'s 8-button locked set, so a click while locked
// resets to Today instead of opening the dialog.
searchToggle.addEventListener("click", withLockedButtonEscapeHatch(() => searchDialog.show()));

// Issue #164 introduced the "i" (Info) button in the old top-left row.
// Issue #201 moved the button itself (and its click wiring) down into the
// bottom-left toolbar (built alongside the other `createToolbarButton`
// calls below, Story #256: now `#left-toolbar`) - only the dialog
// instance/container stay created here, since nothing else in this row
// depends on it.
const infoDialog = new InfoDialog();
app.appendChild(infoDialog.element);

// Story #256: the new unified vertical, left-edge-docked toolbar (Epic
// #255, styled after NASA "Eyes on the Solar System"'s own left toolbar)
// replaces BOTH the old top-left row (`#menu-toggle`+`#search-toggle`) AND
// the old horizontal `#bottom-left-toolbar` - every button below (Search,
// Layers, Settings, Camera, Expand/Collapse, Zoom In/Out, Show All, Fit to
// Local Bubble, Fit to Nearest-Stars Sphere, Vectors, Info, Play) sits here,
// in the Epic's exact 13-item order. Story #257 fills in items #2-#4
// (Layers/Settings/Camera, the `createToolbarButton` calls just below,
// hoisted-function-declared further down in this file so it's already
// callable here) - every other button here is an existing one relocated by
// Story #256, unchanged click handlers/gating logic, only container/
// position/size having changed there.
const leftToolbar = document.createElement("div");
leftToolbar.id = "left-toolbar";
app.appendChild(leftToolbar);

leftToolbar.appendChild(searchToggle);

// Story #257: Layers/Settings/Camera trigger icons (positions #2/#3/#4) -
// `openSidePanel`/`closeSidePanel`/`toggleSidePanel` (further below) wire
// their click behavior and mutual-exclusivity once the panel content itself
// exists (`layersPanelHandle`/`settingsPanelHandle`/`cameraPanelHandle`,
// built once the scene loads).
const layersToggle = createToolbarButton("layers-toggle", LAYERS_ICON_SVG, "Layers", true);
const settingsToggle = createToolbarButton("settings-toggle", SETTINGS_ICON_SVG, "Settings", true);
const cameraToggle = createToolbarButton("camera-toggle", CAMERA_ICON_SVG, "Camera", true);

const fullscreenToggle = createFullscreenToggle(app);
leftToolbar.appendChild(fullscreenToggle.element);

/** Issue #199: inline SVG replacements for the "All"/"LB"/"NS" text-
 * abbreviation glyphs #197 originally shipped (no obvious single Unicode
 * character existed for any of the three). All three share the existing
 * toolbar glyph styling (`stroke="currentColor"`, so they pick up
 * `#left-toolbar .toolbar-button`'s `color: #dfe6f3` for free, same
 * as the other glyphs) and a 24x24 viewBox at a smaller-than-button render
 * size so they sit comfortably inside the compact `#left-toolbar` buttons alongside the
 * existing `⤢`/`⤡`/`+`/`−` glyphs.
 *
 * `SHOW_ALL_ICON_SVG`: four separate cardinal-direction (up/down/left/right)
 * arrows radiating outward from a deliberately empty center - reads as "fit
 * everything into view" - and stays visually distinct from
 * `fullscreenToggle.ts`'s diagonal-corner `⤢`/`⤡` glyphs, which point along
 * the other two (NE/SW-ish) axes entirely.
 *
 * `FIT_LOCAL_BUBBLE_ICON_SVG`/`FIT_NEAREST_STARS_ICON_SVG`: both a circle
 * outline plus horizontal ellipses (lines of latitude) and vertical
 * ellipses (lines of longitude) crossing through the center - the classic
 * simple "globe" icon. The Local Bubble icon draws exactly one of each
 * (the equator + one meridian), matching its plain single-layer fit
 * behavior; the Nearest-Stars icon draws three of each at varying
 * rx/ry - a denser wireframe - so the two read as clearly related (same
 * icon family) but distinguishable at a glance, per the issue's explicit
 * "not so subtle they look identical" requirement. */
const SHOW_ALL_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M12 11 V3 M9 6 L12 3 L15 6" />
    <path d="M12 13 V21 M9 18 L12 21 L15 18" />
    <path d="M11 12 H3 M6 9 L3 12 L6 15" />
    <path d="M13 12 H21 M18 9 L21 12 L18 15" />
  </svg>
`;

const FIT_LOCAL_BUBBLE_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="1.4" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <ellipse cx="12" cy="12" rx="9" ry="3" />
    <ellipse cx="12" cy="12" rx="3" ry="9" />
  </svg>
`;

const FIT_NEAREST_STARS_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="1.1" aria-hidden="true">
    <circle cx="12" cy="12" r="9" />
    <ellipse cx="12" cy="12" rx="9" ry="2.5" />
    <ellipse cx="12" cy="12" rx="9" ry="5.5" />
    <ellipse cx="12" cy="12" rx="9" ry="8" />
    <ellipse cx="12" cy="12" rx="2.5" ry="9" />
    <ellipse cx="12" cy="12" rx="5.5" ry="9" />
    <ellipse cx="12" cy="12" rx="8" ry="9" />
  </svg>
`;

/** Issue #231: "Show velocity vectors" toggle glyph - a dot (the star's own
 * marker position) with a diagonal shaft and small chevron head (the
 * velocity arrow itself), reading as a distinct "vector" icon alongside the
 * toolbar's other glyphs above. `stroke`/`fill="currentColor"` throughout so
 * it inherits the button's own color like every other toolbar icon here. */
const VELOCITY_VECTORS_ICON_SVG = `
  <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor"
       stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <circle cx="5" cy="19" r="1.6" fill="currentColor" stroke="none" />
    <path d="M5 19 L18 6" />
    <path d="M18 6 L11.5 6.5 M18 6 L17.5 12.5" />
  </svg>
`;

/** `content` is treated as trusted inline SVG markup (rather than escaped
 * text) whenever `isIcon` is `true` - safe here since every caller passes
 * one of this module's own `*_ICON_SVG` constants above, never
 * user-supplied data. */
function createToolbarButton(
  id: string,
  content: string,
  ariaLabel: string,
  isIcon = false,
): HTMLButtonElement {
  const button = document.createElement("button");
  button.id = id;
  button.type = "button";
  button.className = isIcon ? "toolbar-button toolbar-button--icon" : "toolbar-button";
  if (isIcon) {
    button.innerHTML = content;
  } else {
    button.textContent = content;
  }
  button.title = ariaLabel;
  button.setAttribute("aria-label", ariaLabel);
  leftToolbar.appendChild(button);
  return button;
}

const zoomInButton = createToolbarButton("zoom-in-toggle", "+", "Zoom in");
const zoomOutButton = createToolbarButton("zoom-out-toggle", "−", "Zoom out");
const showAllButton = createToolbarButton("show-all-toggle", SHOW_ALL_ICON_SVG, "Show all objects", true);
const fitLocalBubbleButton = createToolbarButton(
  "fit-local-bubble-toggle",
  FIT_LOCAL_BUBBLE_ICON_SVG,
  "Fit to Local Bubble",
  true,
);
const fitNearestStarsButton = createToolbarButton(
  "fit-nearest-stars-toggle",
  FIT_NEAREST_STARS_ICON_SVG,
  "Fit to nearest-stars sphere",
  true,
);

/** Issue #231: "Show velocity vectors" toggle - grouped right after the
 * nearest-stars-sphere button above since both concern the same RECONS
 * dense-batch sphere. Unlike its toolbar neighbors (all momentary actions -
 * zoom, fit, show-all), this one is a persistent ON/OFF toggle, so it also
 * carries `aria-pressed` (mirroring `fullscreenToggle.ts`'s own
 * `aria-pressed` convention) and an `.active` CSS class for a visible
 * pressed state - see `style.css`'s `#velocity-vectors-toggle[aria-pressed=
 * "true"]` rule. */
const velocityVectorsButton = createToolbarButton(
  "velocity-vectors-toggle",
  VELOCITY_VECTORS_ICON_SVG,
  "Show velocity vectors",
  true,
);
velocityVectorsButton.setAttribute("aria-pressed", "false");

// Issue #201: the Info ("i") button, relocated here (from the old top-left
// row, #164). Story #256: Epic #255's settled 13-item order places this
// (#12) immediately after Vectors (#11) and immediately before Play (#13) -
// note this is now BEFORE Play in DOM/creation order, unlike the old
// bottom-left toolbar where Info was last - same `createToolbarButton`
// sizing as its neighbors, rather than the old top-left row's standalone
// 68x68px `#info-toggle` styling (removed from `style.css`). Glyph,
// aria-label, and click behavior (`infoDialog.show()`) are unchanged from
// #164 - only its container/position/size moved.
const infoToggleButton = createToolbarButton("info-toggle", "i", "About Local Galactic Structures");

// Story #275: the toolbar Play button (Story #239's `player-toggle`,
// Epic #255's item #13) is removed entirely - the motion player is now
// opened via the new sphere-gated "TIME CONTROLS" collapsed indicator
// (`playerCollapsedIndicator`, built alongside `playerPanelHandle` below)
// instead of a `#left-toolbar` icon. `applyPlayerSphereState`/
// `applyVelocityVectorsButtonState` further below still key off the same
// camera-inside-the-RECONS-dense-batch-sphere check for the indicator's own
// visibility, unchanged from how they gated this button before.

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

/** Issue #231: the velocity-vectors layer - built once, right alongside
 * `denseBatchBoundaryMesh` above, once the scene has loaded. Always a real
 * (possibly empty) `Group` once built (see `createVelocityVectorsLayer`'s
 * docstring for why this differs from the optional `structures.*` layers'
 * `| null` convention) - `null` here only means "scene hasn't loaded yet". */
let velocityVectorsGroup: ReturnType<typeof createVelocityVectorsLayer> | null = null;

/** Issue #236: the density-controlled per-arrow speed labels ("31.5 km/s")
 * - built once, right alongside `velocityVectorsGroup` above, once the
 * scene has loaded. `null` only means "scene hasn't loaded yet"; once built,
 * `updateLabelVisibility` drives which subset (if any) is actually visible
 * each frame - see that function's own new speed-label block. */
let velocitySpeedLabelsInfo: ReturnType<typeof createVelocitySpeedLabelsLayer> | null = null;

/** Issue #231: the user's own ON/OFF intent for the velocity-vectors toggle
 * - distinct from whether the toggle is currently *enabled* (that's the
 * camera-position-driven `velocityVectorsButton.disabled`, applied by
 * `applyVelocityVectorsButtonState` below). Forced back to `false` whenever
 * the camera leaves the sphere while `true` (AC #3 - see
 * `nextVelocityVectorsToggleOn`'s docstring), so this can never be `true`
 * while the button is disabled. */
let velocityVectorsOn = false;

/** Story #239: the motion player's own state - `main.ts` is the single
 * source of truth for all of it; `playerPanelHandle` (built just below) is
 * a stateless view pushed into via `.update()`/`.setVisible()` each frame
 * or on a relevant event, never read from directly (see `ui/playerPanel.ts`'s
 * own docstring). `playerTimeYears` is always kept within Epic #238's
 * settled `+/-1,000,000`-year range via `clampPlayerTimeYears`/
 * `advancePlayerTimeYears`/`nextPlayerStateForSphere` - every one of this
 * module's own write sites below routes through one of those three. */
let playerTimeYears = 0;
let playerPlaying = false;
let playerPanelOpen = false;

/** Story #275: whether the camera is currently inside the player's gating
 * volume, as of the last `applyPlayerSphereState` call (mirrors
 * `cameraWasInsideLocalBubble`'s own crossing-detection value, but scoped to
 * this module's own player-indicator visibility need rather than reused
 * directly, since that flag lives above `applyBackgroundDimming` and is
 * updated on the same crossing frames `applyPlayerSphereState` already runs
 * on). Story #287: that gating volume is now the Local Bubble
 * (`isCameraInsideLocalBubble`), widened from the original RECONS
 * dense-batch sphere - the name (`...InsideSphere`) is unchanged, mirroring
 * `nextPlayerStateForSphere`'s own docstring note on keeping this Story's
 * "sphere-exit-reset" shorthand even though the actual volume moved.
 * Drives `playerCollapsedIndicator`'s visibility together with
 * `playerPanelOpen` via `syncPlayerCollapsedIndicatorVisibility` below - the
 * indicator shows exactly when inside the Local Bubble AND the expanded
 * panel is NOT open, so the two are always mutually exclusive. */
let playerInsideSphere = false;

/** Story #266: the player's single signed `[-1, 1]` rate value - drives both
 * direction (sign) and speed (magnitude) together via
 * `logSpeedSliderToYearsPerSecond`, NASA "Eyes on the Solar System" style
 * (the confirmed design reference). Replaces #243's separately-tracked
 * `playerDirection` (`PlayerDirection`) + magnitude-only
 * `playerSpeedMagnitude` pair - there is exactly ONE rate/direction value
 * now, not two that could disagree. Persists across pause/resume exactly
 * like the old `playerDirection` did: every write site is either a direct
 * slider drag (`onRateChange` below) or `nudgeRateSliderValue` (the `<<`/`>>`
 * buttons) - pause/scrub/Today/reaching-Today-while-playing never touch it,
 * only whether/where the player is playing. */
const DEFAULT_PLAYER_RATE_SLIDER_VALUE = 0.55;
let playerRateSliderValue = DEFAULT_PLAYER_RATE_SLIDER_VALUE;

/** Story #239: the animated stars with velocity data (Epic #229's
 * `starsWithVelocityInLocalBubble` - Story #287: renamed from
 * `starsWithVelocityInSphere` and widened from the ~127-star RECONS sphere
 * to the ~156-star Local Bubble - reused directly, never reimplemented),
 * their `id -> (bucket, index)` lookup (`objects.ts`'s
 * `buildObjectIndexLookup`, built ONCE per player session - here, once per
 * scene load, well before any player session starts, see that function's
 * own docstring), and a same-shape `id -> CatalogLabel` lookup so the
 * per-frame animation loop (`applyPlayerAnimation`) never scans
 * `labelsInfo.labels` linearly either. All three are populated once inside
 * `loadScene().then(...)` below, once `catalogBuckets`/`labelsInfo` exist;
 * empty here so `applyPlayerAnimation` is a correct no-op before the scene
 * has loaded. */
let animatedStars: SceneObject[] = [];
let objectIndexLookup: Map<string, CatalogObjectRef> = new Map();
let labelById: Map<string, CatalogLabel> = new Map();

/** Story #240: the motion-trails layer built once alongside `animatedStars`
 * above, once the scene loads (`createMotionTrailsLayer`'s own docstring) -
 * `motionTrailsGroup` stays `null` until then, mirroring every other
 * scene-load-gated `let ... | null` binding in this file (e.g.
 * `velocityVectorsGroup`). `trailByObjectId` is the same-shape `id ->
 * StarTrail` lookup `applyPlayerAnimation` below uses so it never scans the
 * ~127-entry pool linearly, matching `labelById`'s own precedent. */
let motionTrailsGroup: ReturnType<typeof createMotionTrailsLayer>["group"] | null = null;
let trailByObjectId: Map<string, StarTrail> = new Map();

/** Story #257: the three new side panels' (Layers/Settings/Camera) own
 * handles (`ui/controls.ts`'s `createLayersPanel`/`createSettingsPanel`/
 * `createCameraPanel` return values) - `null` until the scene loads and
 * each panel is actually built (mirrors every other scene-load-gated
 * `let ... | null` binding in this file, e.g. `labelsInfo`, and the single
 * pre-#257 `panelHandle` this replaces). `syncUiLock`/`getSidePanelHandle`
 * below guard every use with a null check. */
let layersPanelHandle: LayersPanelHandle | null = null;
let settingsPanelHandle: SettingsPanelHandle | null = null;
let cameraPanelHandle: SidePanelHandle | null = null;

/** Story #257: which of the three new side panels (if any) is currently
 * open. Design decision (documented in the PR): the three panels are
 * mutually exclusive, tab-like - `openSidePanel` below always closes
 * whichever of the other two was open before revealing the requested one,
 * rather than allowing more than one open at once. All three panels share
 * the exact same toolbar-adjacent screen position (`style.css`'s
 * `.side-panel`), so stacking more than one open there would overlap
 * rather than tile side by side - and the toolbar itself is deliberately
 * compact (Story #256), leaving no clean place to lay three panels out
 * next to each other instead. */
type SidePanelName = "layers" | "settings" | "camera";
let openSidePanelName: SidePanelName | null = null;

function getSidePanelHandle(name: SidePanelName): SidePanelHandle | null {
  switch (name) {
    case "layers":
      return layersPanelHandle;
    case "settings":
      return settingsPanelHandle;
    case "camera":
      return cameraPanelHandle;
  }
}

function getSidePanelToggleButton(name: SidePanelName): HTMLButtonElement {
  switch (name) {
    case "layers":
      return layersToggle;
    case "settings":
      return settingsToggle;
    case "camera":
      return cameraToggle;
  }
}

/** Closes one side panel (a no-op if its content isn't built yet, or if
 * it's already closed) and clears its toolbar button's pressed styling -
 * the same `aria-pressed`/`.active` convention `velocityVectorsButton`
 * already uses for its own toggle state. */
function closeSidePanel(name: SidePanelName): void {
  getSidePanelHandle(name)?.setOpen(false);
  const button = getSidePanelToggleButton(name);
  button.setAttribute("aria-pressed", "false");
  button.classList.remove("active");
  if (openSidePanelName === name) {
    openSidePanelName = null;
  }
}

/** Opens one side panel, first closing the other two (mutual exclusivity -
 * see `openSidePanelName`'s docstring above). A no-op (beyond closing the
 * others) if the requested panel's content isn't built yet - i.e. a click
 * that lands in the brief window before the scene has finished loading. */
function openSidePanel(name: SidePanelName): void {
  for (const other of ["layers", "settings", "camera"] as const) {
    if (other !== name) closeSidePanel(other);
  }
  const handle = getSidePanelHandle(name);
  if (!handle) return;
  handle.setOpen(true);
  const button = getSidePanelToggleButton(name);
  button.setAttribute("aria-pressed", "true");
  button.classList.add("active");
  openSidePanelName = name;
}

function toggleSidePanel(name: SidePanelName): void {
  if (openSidePanelName === name) {
    closeSidePanel(name);
  } else {
    openSidePanel(name);
  }
}

/** Story #239: whether the app's other scene-state-changing controls are
 * currently locked (Epic #238 AC: true whenever `playerTimeYears !== 0`,
 * including while paused away from Today) - change-detected the same way
 * `cameraWasInsideDenseBatchSphere` above is, so `syncUiLock` only touches
 * the DOM on an actual transition rather than every single frame. The
 * click-to-select handler (further below) reads this directly, since the
 * canvas itself has no `disabled` DOM property to toggle. */
let uiLocked = false;

/** Story #239: the player's own control panel (`ui/playerPanel.ts`) - built
 * once here at top-level startup (it needs no scene data, unlike the
 * Structures panel), mirroring `inspector`/`searchDialog`/`infoDialog`'s own
 * "always exists, shown/hidden via a method call" convention. */
const playerPanelHandle = createPlayerPanel({
  onNudge: (deltaSign) => handlePlayerRateNudge(deltaSign),
  onPlayPauseToggle: () => handlePlayerPlayPauseToggle(),
  onScrub: (tYears) => {
    setPlayerPlaying(false);
    playerTimeYears = clampPlayerTimeYears(tYears);
  },
  onRateChange: (sliderValue) => {
    playerRateSliderValue = sliderValue;
  },
  // Issue #292: extracted to the shared `resetPlayerToToday` (defined
  // further below, but hoisted) so this panel button and the locked-toolbar-
  // button escape hatch can never drift out of sync with each other.
  onToday: () => resetPlayerToToday(),
  // Story #275: overrides #267's original choice (which reused the toolbar
  // Play button's own close+reset-to-Today action). The human owner's
  // described flow requires the collapse chevron to be a genuine MINIMIZE
  // now - it hides the expanded panel and reveals the "TIME CONTROLS"
  // collapsed indicator again, but leaves `playerTimeYears`/`playerPlaying`/
  // `playerRateSliderValue` completely untouched. Only leaving the sphere
  // (`applyPlayerSphereState` below) still resets those.
  onCollapse: () => collapsePlayerPanel(),
  defaultRateSliderValue: DEFAULT_PLAYER_RATE_SLIDER_VALUE,
});
app.appendChild(playerPanelHandle.element);

/** Story #275: the small up-chevron SVG glyph shown above the "TIME
 * CONTROLS" text label in `playerCollapsedIndicator` below - a plain thin
 * stroke chevron (matching the human owner's reference screenshot), sized
 * small since the text label itself carries most of the indicator's visual
 * weight, unlike the toolbar's own bigger 20x20 icons. */
const TIME_CONTROLS_CHEVRON_SVG = `
  <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor"
       stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
    <path d="M5 15 L12 8 L19 15" />
  </svg>
`;

/** Story #275: the new persistent bottom-center "TIME CONTROLS" collapsed
 * indicator (reference screenshot: a small up-chevron above the text
 * "TIME CONTROLS") that replaces the old toolbar Play button as the way to
 * open the player panel. Built once here, alongside `playerPanelHandle`
 * itself, mirroring every other "always exists, shown/hidden via a method
 * call" element in this file (`inspector`/`searchDialog`/`playerPanelHandle`
 * above). Visibility is driven entirely by `syncPlayerCollapsedIndicatorVisibility`
 * below (sphere-gated via `playerInsideSphere`, and mutually exclusive with
 * the expanded panel via `playerPanelOpen`) - never toggled directly at any
 * other call site. */
const playerCollapsedIndicator = document.createElement("button");
playerCollapsedIndicator.id = "player-collapsed-indicator";
playerCollapsedIndicator.type = "button";
playerCollapsedIndicator.className = "player-collapsed-indicator";
playerCollapsedIndicator.innerHTML = `${TIME_CONTROLS_CHEVRON_SVG}<span>TIME CONTROLS</span>`;
playerCollapsedIndicator.setAttribute("aria-label", "Open time controls");
app.appendChild(playerCollapsedIndicator);

/** Story #275: clicking the collapsed indicator reveals the expanded panel -
 * same "just reveal, never auto-start playback" behavior as the old toolbar
 * Play button's first-click (#245); nothing about `playerTimeYears`/
 * `playerPlaying`/`playerRateSliderValue` changes here. Only reachable while
 * the indicator is actually visible (`display: none` otherwise - see
 * `style.css`), which itself only happens while inside the sphere, so no
 * extra sphere check is needed here. */
playerCollapsedIndicator.addEventListener("click", () => {
  playerPanelOpen = true;
  playerPanelHandle.setVisible(true);
  syncPlayerCollapsedIndicatorVisibility();
});

/** Issue #104: the dense RECONS batch's own collection radius (pc),
 * derived once from the loaded scene data (`lod.ts`'s
 * `denseBatchCollectionRadiusPc`) rather than hard-coded - `0` (its
 * initial value, before the scene has loaded) makes `passesDenseBatchLod`
 * hide every dense-batch member until the real radius is known, which is
 * the correct "not loaded yet" state anyway. */
let denseBatchRadiusPc = 0;

/** Issue #197: the loaded scene's `structures.local_bubble` (if present),
 * kept as its own module binding (mirroring `denseBatchRadiusPc` above) so
 * the "Fit to Local Bubble" toolbar button's click handler - wired below,
 * well before `loadScene()`'s own `.then()` resolves - can read whatever is
 * current at click time rather than capturing a value up front. Stays
 * `null` before the scene loads, and stays `null` thereafter if the scene
 * has no Local Bubble layer (spec §38: an optional structure layer being
 * absent must not error) - either way, `fitLocalBubbleButton` is disabled
 * whenever this is `null` (see `applyLocalBubbleButtonState` below). */
let localBubbleStructure: LocalBubbleStructure | null = null;

/** Issue #215: the Local Bubble's representative outer radius (pc) for the
 * per-star baseline-size gradient (`objects.ts`'s `starBaselineRadiusPc`),
 * derived from `localBubbleStructure` above (see `bubbleOuterRadiusPcFrom`)
 * rather than duplicated as a separate hardcoded value. Recomputed once
 * alongside `localBubbleStructure` when the scene loads; stays `null` before
 * that (or thereafter if the scene has no Local Bubble layer), which is
 * exactly the sentinel every `objects.ts` function taking this parameter
 * already treats as "fall back to the flat, unchanged `STAR_MARKER_RADIUS_PC`
 * behavior" (spec §38: an absent optional structure must not error). */
let bubbleOuterRadiusPc: number | null = null;

function applyCatalogVisibility(): void {
  updateCatalogVisibility(
    catalogBuckets,
    categoryVisibility,
    radiusPc,
    camera.position.length(),
    denseBatchRadiusPc,
    bubbleOuterRadiusPc,
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
    bubbleOuterRadiusPc,
  );
}

/** Issue #113 (simplified by #217's scope expansion, removing #136's extra
 * breakpoint): rescales the Sun's opaque core each frame/camera-move so it
 * doesn't visually engulf the RECONS dense batch's own nearby markers once
 * the camera approaches solar-neighborhood scale - see `scene/sun.ts`'s
 * `sunCoreRadiusPc` docstring for the actual distance->radius curve. Reuses
 * the same `denseBatchRadiusPc` (populated once the scene loads, `0` until
 * then) that `applyDenseBatchLod` above already benchmarks against, so the
 * two LOD effects stay consistent with each other.
 *
 * Issue #217: no longer passes `controls.minDistance` - `sunCoreRadiusPc`'s
 * curve is now flat at its single floor for the entire range at or inside
 * `denseBatchRadiusPc` (mirroring `starMarkerRadiusPc` exactly), so there is
 * no longer a third, closer inner anchor for the camera's actual enforced
 * zoom limit to feed into. */
function applySunCoreScale(): void {
  sunMarker.core.scale.setScalar(sunCoreRadiusPc(camera.position.length(), denseBatchRadiusPc));
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
 * camera actually crosses either boundary (in either direction) rather than
 * redundantly reassigning the same material reference every single frame.
 *
 * Issue #227: `cameraWasInsideLocalBubble` alongside it tracks the same
 * thing for the new, larger Local Bubble boundary - both are checked so a
 * crossing of EITHER boundary (not just the sphere's) triggers a re-apply
 * below. */
let cameraWasInsideDenseBatchSphere = false;
/** Issue #290: this tracks the EFFECTIVE "inside the Local Bubble" value
 * (`scene/lod.ts`'s `effectiveInsideLocalBubble` - the real camera-distance
 * check widened by `bubbleViewOverrideActive` below), not the raw
 * camera-distance check - every OTHER call site in this file that reads this
 * flag (`syncUiLock`, `velocityVectorsButton`'s own click handler) should see
 * the widened value too, so they never disagree with
 * `applyVelocityVectorsButtonState`/`applyPlayerSphereState` about whether
 * the Local-Bubble-gated controls are currently active. Written ONLY by
 * `applyLocalBubbleGateState` (see that function's docstring), which is also
 * what `applyBackgroundDimming` below uses to change-detect whether the
 * Vectors/player gate itself needs a re-apply this frame.
 *
 * Bug fix (Validator review on PR #291, post-#290): this used to ALSO be the
 * sole change-detection value guarding whether `applyBackgroundDimming`'s
 * dimming-tier calls (`updateBackgroundDimming`/`setGouldBeltDimmed`/
 * `setRadcliffeWaveDimmed`/`setLocalBubbleDimmed`) ran at all. Once the
 * override pins the EFFECTIVE value at `true`, that guard matched on every
 * subsequent frame regardless of the REAL camera distance, so the raw-valued
 * dimming calls silently stopped re-running the moment the override
 * activated - e.g. framing "Fit to Local Bubble" (317pc, correctly
 * undimmed) then manually zooming to a real ~34.6pc (inside the 60pc
 * bubble) left Gould Belt/Radcliffe Wave stuck fully bright instead of
 * dimming to the #227 tier, directly violating #290's "dimming tiers stay
 * completely unaffected by the override" scope. Fixed by giving the
 * dimming-tier branch its own, separately-tracked RAW change-detection
 * value - `cameraWasInsideLocalBubbleRaw` just below - so the two branches
 * (dimming-tier calls vs. the Vectors/player gate) can no longer share a
 * single boolean that only one of them is allowed to see the override-widened
 * version of. */
let cameraWasInsideLocalBubble = false;
/** Bug fix (Validator review on PR #291, post-#290): the RAW (un-widened by
 * `bubbleViewOverrideActive`), real-camera-distance "inside the Local
 * Bubble" value as of the last frame `applyBackgroundDimming` actually ran
 * its dimming-tier calls - tracked separately from `cameraWasInsideLocalBubble`
 * above (which tracks the EFFECTIVE/override-widened value for the
 * Vectors/player gate) so the dimming-tier calls' own change-detection keeps
 * firing on every REAL boundary crossing regardless of whether the override
 * is active. See `cameraWasInsideLocalBubble`'s own docstring above for the
 * full bug writeup this fixes. Written ONLY inside `applyBackgroundDimming`
 * below, immediately before the dimming-tier calls it guards. */
let cameraWasInsideLocalBubbleRaw = false;

/** Issue #290: persistent override set by `fitLocalBubbleButton`'s click
 * handler - `false` by default. While `true`, Vectors/TIME CONTROLS stay
 * active regardless of the real camera distance (the button's own framing,
 * `applyFitLocalBubblePose`, deliberately shows the WHOLE bubble from
 * ~317pc, farther out than the bubble's own ~60pc radius, so the normal
 * distance check alone would never activate them from that pose). Cleared
 * only by `clearBubbleViewOverride` below - manual camera navigation
 * (orbit/pan/zoom) never touches this, only the explicit
 * camera-repositioning actions that call that function. */
let bubbleViewOverrideActive = false;

/** Issue #290: the single place that applies "the camera is now
 * (effectively) inside the Local Bubble" to the Vectors toggle and the
 * motion player - shared by `applyBackgroundDimming`'s own per-frame
 * boundary-crossing detection below AND `fitLocalBubbleButton`'s click
 * handler (which needs to apply this SAME activation immediately, not wait
 * for the next animation frame - this dev environment has a known issue
 * where the rAF loop can stall while the tab isn't focused, so an explicit
 * synchronous call here is load-bearing, not just a minor optimization).
 * Also updates `cameraWasInsideLocalBubble` itself (see that binding's own
 * docstring above for why it now stores the EFFECTIVE value) so the
 * per-frame guard in `applyBackgroundDimming` and every other reader of
 * that flag stay in sync with whatever this function was just called
 * with. */
function applyLocalBubbleGateState(effectiveInsideBubble: boolean): void {
  cameraWasInsideLocalBubble = effectiveInsideBubble;
  applyVelocityVectorsButtonState(effectiveInsideBubble);
  applyPlayerSphereState(effectiveInsideBubble);
}

/** Issue #290: clears `bubbleViewOverrideActive` (a no-op if it's already
 * `false`) and immediately re-applies the gate state from the REAL current
 * camera distance, via the exact same `applyLocalBubbleGateState` chokepoint
 * above - so Vectors/TIME CONTROLS correctly reflect wherever the camera
 * actually ended up right after the repositioning action that called this,
 * rather than staying stuck on (or off) until the next frame's
 * `applyBackgroundDimming` call happens to run. Called from every OTHER
 * camera-repositioning control's own click handler (the four Camera-panel
 * presets, "Fit all", "Fit to nearest-stars sphere", and Search's "go to
 * object") AFTER that handler has already moved the camera, so
 * `camera.position` here is always the POST-move position. Deliberately
 * NOT called from `fitLocalBubbleButton`'s own handler (that's the button
 * that SETS the override, not one of the ones that clears it) or from any
 * mouse-driven `OrbitControls` navigation (manual orbit/pan/zoom must never
 * clear this, per #290's explicit acceptance criteria). */
function clearBubbleViewOverride(): void {
  if (!bubbleViewOverrideActive) return;
  bubbleViewOverrideActive = false;
  const insideBubbleNow = isCameraInsideLocalBubble(camera.position.length(), bubbleOuterRadiusPc);
  applyLocalBubbleGateState(insideBubbleNow);
}

/** Issue #231: syncs the velocity-vectors toggle button's enabled/disabled
 * state (and, per AC #3, forces the toggle itself - and so the layer's
 * visibility - back OFF if the camera has just left the gating volume) to
 * `insideLocalBubble`. Called ONLY from `applyBackgroundDimming` below, on
 * the same actual-boundary-crossing frames that function already isolates
 * via `cameraWasInsideLocalBubble` change-detection - per this issue's own
 * explicit instruction, this hooks into that existing per-frame call site
 * rather than duplicating a second independent RAF-driven check. Safe to
 * call before the scene has loaded (`velocityVectorsGroup` still `null`) or
 * before `velocityVectorsButton` exists in that ordering - in practice
 * `applyBackgroundDimming` itself is only ever invoked from `animate()`,
 * well after both are constructed at module-init time.
 *
 * Story #287: widened from the RECONS dense-batch sphere
 * (`cameraWasInsideDenseBatchSphere`) to the Local Bubble
 * (`cameraWasInsideLocalBubble`) - this function's own logic is unchanged,
 * only what `applyBackgroundDimming` feeds it.
 *
 * Issue #292: the gating-volume condition (`!insideLocalBubble`) is the ONE
 * out-of-scope reason this button stays genuinely `disabled` (native
 * attribute - clicking it while outside the Local Bubble was never governed
 * by this issue). The player-time lock (`uiLocked`) component of the old
 * combined formula moved to `setToolbarButtonLocked`'s VISUAL-only class
 * instead, matching `syncUiLock`'s own write to this same button so the two
 * chokepoints can't disagree. */
function applyVelocityVectorsButtonState(insideLocalBubble: boolean): void {
  velocityVectorsOn = nextVelocityVectorsToggleOn(velocityVectorsOn, insideLocalBubble);
  velocityVectorsButton.disabled = !insideLocalBubble;
  setToolbarButtonLocked(velocityVectorsButton, uiLocked);
  velocityVectorsButton.setAttribute("aria-pressed", String(velocityVectorsOn));
  velocityVectorsButton.classList.toggle("active", velocityVectorsOn);
  if (velocityVectorsGroup) {
    velocityVectorsGroup.visible = velocityVectorsVisible(velocityVectorsOn, insideLocalBubble);
  }
}

/** Story #239: the single writer for the player's play/pause state -
 * (Story #266) shared by the panel's own center Play/Pause button and every
 * other call site that pauses/resumes (a nudge, a scrub, Today, reaching
 * Today while playing), so all of them can never disagree about whether the
 * player is currently playing. Story #275: the toolbar Play button this used
 * to also update (`aria-pressed`/`.active`) is gone - `playerPlaying` itself
 * is still pushed into `ui/playerPanel.ts`'s own Play/Pause glyph every
 * frame via `applyPlayerAnimation`'s `playerPanelHandle.update()` call,
 * unchanged. Never writes `playerRateSliderValue` itself - Story #266's whole
 * point is that the two are fully independent: pausing/resuming via this
 * function alone must never silently change the configured rate/direction
 * the player would next play at. */
function setPlayerPlaying(next: boolean): void {
  playerPlaying = next;
}

/** Story #239 (panel's own Today button) + Issue #292 (locked-toolbar-button
 * escape hatch): resets the player to Today - the exact previous inline body
 * of the panel's `onToday` callback (`setPlayerPlaying(false); playerTimeYears
 * = 0`), extracted here as the single shared implementation so the panel's
 * Today button and `withLockedButtonEscapeHatch` below can never drift out
 * of sync with each other, matching this codebase's established
 * single-source-of-truth convention (e.g. `setPlayerPlaying` itself). */
function resetPlayerToToday(): void {
  setPlayerPlaying(false);
  playerTimeYears = 0;
}

/** Issue #292: wraps one of `syncUiLock`'s 8 locked toolbar buttons' own
 * click handler so that, at the moment of the click, if the toolbar is
 * currently locked (the same `isUiLockedForPlayerTime(playerTimeYears)`
 * condition `syncUiLock` itself uses), the button's normal `action` is
 * skipped entirely and the click instead resets the player to Today via the
 * shared `resetPlayerToToday` above - one click, one action (the issue's
 * explicit "don't also perform the button's original action in the same
 * click" requirement). `syncUiLock` naturally re-runs on the next
 * `animate()` frame and unlocks the toolbar (existing mechanism, unchanged),
 * so a SUBSEQUENT click on the same button performs `action` normally, now
 * that it's genuinely unlocked. A plain function declaration (hoisted), so
 * it's safe to call from `searchToggle`'s click wiring far above this point
 * in the file. */
function withLockedButtonEscapeHatch(action: () => void): () => void {
  return () => {
    if (isUiLockedForPlayerTime(playerTimeYears)) {
      resetPlayerToToday();
      return;
    }
    action();
  };
}

/** Story #266: the panel's center Play/Pause button handler - a PLAIN
 * toggle, completely independent of `playerRateSliderValue`'s sign or
 * magnitude (replaces #243's `handlePlayerDirectionButton`, which coupled
 * play/pause to which direction button was pressed - that coupling is gone
 * now that direction lives entirely in the signed rate value). */
function handlePlayerPlayPauseToggle(): void {
  setPlayerPlaying(!playerPlaying);
}

/** Story #266: the panel's `<<`/`>>` nudge-button handler - moves
 * `playerRateSliderValue` via the pure `nudgeRateSliderValue`, touching
 * nothing else (AC: nudging must never change `playing`) - replaces #243's
 * `handlePlayerStepButton`, which paused first then applied a fixed
 * `stepPlayerTimeYears` time jump; nudging now changes the configured RATE,
 * not the current time, and leaves `playing` exactly as it was. */
function handlePlayerRateNudge(deltaSign: PlayerDirection): void {
  playerRateSliderValue = nudgeRateSliderValue(playerRateSliderValue, deltaSign);
}

/** Story #275: shows/hides `playerCollapsedIndicator` so it's visible
 * exactly when the camera is inside the RECONS sphere AND the expanded panel
 * is NOT open - the "only one of {collapsed indicator, expanded panel} is
 * ever visible at a time" requirement. Called from every site that changes
 * either `playerInsideSphere` or `playerPanelOpen` (the indicator's own click
 * handler above, `collapsePlayerPanel` below, and `applyPlayerResetState`
 * below on every sphere-crossing reset) rather than being folded into any one
 * of them, since more than one of those sites needs to trigger this same
 * recomputation. */
function syncPlayerCollapsedIndicatorVisibility(): void {
  playerCollapsedIndicator.classList.toggle("visible", playerInsideSphere && !playerPanelOpen);
}

/** Story #249: applies a `PlayerState` (as produced by `nextPlayerStateForSphere`)
 * to the live module/DOM state - the single application point for the
 * sphere-exit force-reset (`applyPlayerSphereState` below), so that reset
 * logic lives in exactly one place. Story #275: also re-syncs the collapsed
 * indicator's own visibility here (rather than duplicating that sync at
 * `applyPlayerSphereState` itself) since every caller of this function is
 * exactly a point where `playerPanelOpen` (and possibly `playerInsideSphere`,
 * set by the caller first) may have just changed. Uses `setPlayerPlaying`
 * (not a direct assignment) for consistency with every other play/pause
 * write site, and re-syncs the UI lock since `playerTimeYears` may have just
 * changed to/from exactly `0`. */
function applyPlayerResetState(next: PlayerState): void {
  playerTimeYears = next.timeYears;
  setPlayerPlaying(next.playing);
  playerPanelOpen = next.panelOpen;
  playerPanelHandle.setVisible(playerPanelOpen);
  syncPlayerCollapsedIndicatorVisibility();
  syncUiLock();
}

/** Story #275: the player panel's own collapse chevron handler - a genuine
 * MINIMIZE, overriding #267's original "reuse the toolbar button's own
 * close+reset-to-Today action" choice (that action, `closePlayerPanelAndResetToToday`,
 * is removed - nothing else called it once the toolbar button itself was
 * removed). Hides the expanded panel and reveals the collapsed indicator
 * again, WITHOUT touching `playerTimeYears`/`playerPlaying`/
 * `playerRateSliderValue` at all - only leaving the sphere
 * (`applyPlayerSphereState` below) still resets those. */
function collapsePlayerPanel(): void {
  playerPanelOpen = false;
  playerPanelHandle.setVisible(false);
  syncPlayerCollapsedIndicatorVisibility();
}

/** Story #239 AC #7: forces "Show velocity vectors" off (arrows + speed
 * labels hidden, button un-pressed) for as long as the player's time is
 * away from Today - the two are visually incompatible per Epic #238. Called
 * every frame from `applyPlayerAnimation` (not just once when Play is first
 * pressed) since the AC explicitly requires this to hold continuously while
 * PAUSED away from Today too, not only while actively playing. Guarded on
 * `velocityVectorsOn` already being `true` so this is a cheap no-op on every
 * frame except the one where it actually needs to act - no auto-restore
 * afterward, matching #231's own precedent (re-enabling the vectors toggle
 * once back at Today works exactly like an ordinary click, nothing here
 * remembers or restores the pre-Play state). */
function forceVelocityVectorsOffIfAwayFromToday(): void {
  if (playerTimeYears === 0 || !velocityVectorsOn) return;
  velocityVectorsOn = false;
  velocityVectorsButton.setAttribute("aria-pressed", "false");
  velocityVectorsButton.classList.remove("active");
  if (velocityVectorsGroup) {
    velocityVectorsGroup.visible = false;
  }
}

/** Issue #292: original title/aria-label text for each of `syncUiLock`'s 8
 * locked toolbar buttons, captured once here (module init, before
 * `syncUiLock` ever runs) so `setToolbarButtonLocked` below can restore each
 * button's own label exactly on unlock, after swapping it for the escape
 * hatch's discoverability cue while locked. */
const TOOLBAR_BUTTON_DEFAULT_LABEL: ReadonlyMap<HTMLButtonElement, string> = new Map(
  [
    searchToggle,
    zoomInButton,
    zoomOutButton,
    showAllButton,
    fitLocalBubbleButton,
    fitNearestStarsButton,
    velocityVectorsButton,
    infoToggleButton,
  ].map((button) => [button, button.title] as const),
);

const LOCKED_BUTTON_ESCAPE_HATCH_LABEL = "Click to return to Today";

/** Issue #292: applies (or clears) the visual-only locked look to one of
 * `syncUiLock`'s 8 toolbar buttons - the exact same grayed-out appearance
 * the native `:disabled` styling already gave (`style.css`'s
 * `.toolbar-button--locked` rule, sharing its declaration block with
 * `:disabled` so the two can never visually drift apart), but WITHOUT the
 * native `disabled` attribute, so the button keeps receiving click events -
 * `withLockedButtonEscapeHatch` above is what turns a click while locked
 * into the "reset to Today" escape hatch instead of the button's normal
 * action. Also swaps the button's title/aria-label for a discoverability cue
 * while locked ("Click to return to Today"), restoring its normal label on
 * unlock via `TOOLBAR_BUTTON_DEFAULT_LABEL` above. */
function setToolbarButtonLocked(button: HTMLButtonElement, locked: boolean): void {
  button.classList.toggle("toolbar-button--locked", locked);
  const label = locked
    ? LOCKED_BUTTON_ESCAPE_HATCH_LABEL
    : (TOOLBAR_BUTTON_DEFAULT_LABEL.get(button) ?? button.title);
  button.title = label;
  button.setAttribute("aria-label", label);
}

/** Story #239 AC #9 (Story #247 AC #4 extends this to the left toolbar):
 * applies the UI lock - disabling category/structure checkboxes and the
 * radius filter (Story #257: now `layersPanelHandle.setLocked`/
 * `settingsPanelHandle.setLocked`, split from the single pre-#257
 * `panelHandle.setLocked`), search (`searchToggle`,
 * and closing an already-open search dialog so a newly-locked session can't
 * leave it open), and now every OTHER `#left-toolbar` button (Zoom
 * In/Out, Show All, Fit to Local Bubble, Fit to nearest-stars sphere, Show
 * velocity vectors, Info) - whenever the player's time is not exactly Today,
 * unlocking the instant it returns to exactly `0` via any path (play
 * reaching it, a manual scrub, or the "Today" button all funnel through the
 * shared `playerTimeYears` state this reads). Deliberately reuses this SAME
 * `isUiLockedForPlayerTime` condition (not a narrower "only while actively
 * playing" one) for the toolbar buttons too, per Story #247's explicit
 * "stay consistent with every other locked control" instruction - so Fit/
 * Zoom read the same locked/unlocked whether paused mid-scrub or actively
 * playing, matching every other control this function already locks the
 * same way. The player's own controls (the collapsed indicator, the
 * expanded panel - Story #275, previously the toolbar `playerButton`) are
 * deliberately EXCLUDED (stay enabled throughout, gated only by their own
 * existing sphere check in `applyPlayerSphereState` below) - locking them
 * would trap the user with no way to reopen/interact with the player.
 * Camera navigation
 * (`OrbitControls`) is never touched here, per that same AC - this only
 * disables discrete toolbar buttons, not mouse-driven camera control.
 * Star-click selection is guarded directly in the click handler via the
 * `uiLocked` flag this function maintains (the canvas itself has no
 * `disabled` DOM property). Change-detected like
 * `cameraWasInsideDenseBatchSphere` above, so this only touches the DOM on
 * an actual lock/unlock transition, not every single frame.
 *
 * Issue #292: the native `disabled` attribute this used to set directly on
 * all 8 buttons is now `setToolbarButtonLocked`'s VISUAL-only class instead,
 * for every button EXCEPT two structural/gating conditions that stay
 * genuinely non-clickable (unrelated to the player-time lock, so out of this
 * issue's scope, per its own "which buttons get locked" exclusion):
 * `fitLocalBubbleButton` when there's no Local Bubble layer to fit to at all
 * (`applyLocalBubbleButtonState`, the single writer for that button's native
 * `disabled`), and `velocityVectorsButton` when the camera isn't inside the
 * Local Bubble (also written here, mirroring `applyVelocityVectorsButtonState`'s
 * own combined formula so the two chokepoints can't disagree). */
function syncUiLock(): void {
  const locked = isUiLockedForPlayerTime(playerTimeYears);
  if (locked === uiLocked) return;
  uiLocked = locked;
  if (layersPanelHandle) layersPanelHandle.setLocked(uiLocked);
  if (settingsPanelHandle) settingsPanelHandle.setLocked(uiLocked);
  setToolbarButtonLocked(searchToggle, uiLocked);
  if (uiLocked) searchDialog.hide();
  setToolbarButtonLocked(zoomInButton, uiLocked);
  setToolbarButtonLocked(zoomOutButton, uiLocked);
  setToolbarButtonLocked(showAllButton, uiLocked);
  applyLocalBubbleButtonState();
  setToolbarButtonLocked(fitNearestStarsButton, uiLocked);
  // Story #287: gated on the Local Bubble now, not the RECONS dense-batch
  // sphere - `cameraWasInsideLocalBubble` is kept in sync by
  // `applyBackgroundDimming`'s own crossing-detection, same as
  // `cameraWasInsideDenseBatchSphere` was before.
  velocityVectorsButton.disabled = !cameraWasInsideLocalBubble;
  setToolbarButtonLocked(velocityVectorsButton, uiLocked);
  setToolbarButtonLocked(infoToggleButton, uiLocked);
}

/** Story #239 AC #8 (mirrors `applyVelocityVectorsButtonState` above
 * exactly): syncs the player's gated visibility state to
 * `insideLocalBubble`, and - via `motionPlayer.ts`'s pure `nextPlayerStateForSphere`
 * - force-resets the whole player (time back to Today, paused, panel
 * hidden) the instant the camera leaves the gating volume, mirroring #231
 * AC #3's "no stale display the user can't currently turn off" reasoning:
 * leaving it mid-animation snaps back to Today FIRST (never leaves stars
 * mid-flight while forcibly closing the player) rather than merely hiding
 * the panel over whatever position happened to be showing. Called ONLY from
 * `applyBackgroundDimming`'s own boundary-crossing detection, alongside
 * `applyVelocityVectorsButtonState`, per this Story's explicit instruction
 * to reuse that existing per-frame hook rather than adding a third
 * independent RAF-driven check.
 *
 * Story #287: widened from the RECONS dense-batch sphere
 * (`cameraWasInsideDenseBatchSphere`) to the Local Bubble
 * (`cameraWasInsideLocalBubble`) - `applyBackgroundDimming` now passes
 * `insideBubble` here instead of `insideSphere`; this function's own logic
 * is otherwise unchanged.
 *
 * Story #275: `playerInsideSphere` is set FIRST, before `applyPlayerResetState`
 * runs - that call's own `syncPlayerCollapsedIndicatorVisibility` reads the
 * new value, so the collapsed indicator's visibility (extends this same
 * "outside" reset to also hide it, per the issue, rather than a second
 * independent hook) is always resolved from the up-to-date gating state. On
 * exit this drives the indicator to hidden (via `panelOpen: false` AND
 * `playerInsideSphere = false`, both true at once - "hides BOTH the
 * collapsed indicator AND the expanded panel"); on entry it leaves
 * `panelOpen` at its existing `false` value (the reset from the PREVIOUS
 * exit), so re-entering always shows the collapsed indicator, never the
 * expanded panel, matching the human owner's own described flow. */
function applyPlayerSphereState(insideLocalBubble: boolean): void {
  playerInsideSphere = insideLocalBubble;
  const next = nextPlayerStateForSphere(
    { timeYears: playerTimeYears, playing: playerPlaying, panelOpen: playerPanelOpen },
    insideLocalBubble,
  );
  applyPlayerResetState(next);
  // Story #266 (was #243's `playerDirection` reset): `PlayerState` (the pure
  // `nextPlayerStateForSphere` above) doesn't carry the rate/direction
  // value, so reset it here alongside the other three force-reset fields -
  // a fresh session re-entering the Local Bubble should always default back
  // to the same starting rate, not silently resume whichever rate/direction
  // happened to be configured when a PREVIOUS session left it.
  if (!insideLocalBubble) {
    playerRateSliderValue = DEFAULT_PLAYER_RATE_SLIDER_VALUE;
  }
}

/**
 * Story #239: per-frame motion-player tick, called every animation frame
 * from `animate()` below UNCONDITIONALLY (mirrors `applyDenseBatchLod`'s own
 * "walk the small animated subset every frame regardless of state" pattern)
 * rather than only while actively playing - this is deliberate: it's what
 * makes "restore to Today" the exact same code path as "animate away from
 * Today", never a special case, since `starPositionAtTime` recomputes fresh
 * from each star's real `position_pc` every call (see that function's own
 * docstring on why this can't drift). At `playerTimeYears === 0` (the
 * overwhelmingly common case - the app at rest) this loop is a correct,
 * cheap (~127 objects) no-op that reproduces exactly what
 * `updateCatalogVisibility`/`updateDenseBatchLod` already render.
 *
 * `deltaSeconds` is the real (wall-clock) time elapsed since the previous
 * frame - `animate()` derives it from `performance.now()`, since no other
 * per-frame effect in this file previously needed a delta (everything else
 * here is a function of absolute camera/time state, not a rate).
 */
function applyPlayerAnimation(deltaSeconds: number): void {
  // Story #266: `playerRateSliderValue` is already SIGNED (sign = direction,
  // magnitude = speed), so `logSpeedSliderToYearsPerSecond` maps it directly
  // to the signed rate `advancePlayerTimeYears` wants - no separate
  // direction multiply anymore (that was #243's shape, now removed).
  const yearsPerRealSecond = logSpeedSliderToYearsPerSecond(playerRateSliderValue);
  // `motionTrail.ts`'s `starTrailPositionsPc` (unchanged by this Story)
  // still wants the current playback direction as its own `PlayerDirection`
  // sign - derived here from the signed rate value rather than tracked as
  // separate state.
  const playerRateDirection: PlayerDirection = playerRateSliderValue < 0 ? -1 : 1;

  if (playerPlaying) {
    const result = advancePlayerTimeYears(playerTimeYears, deltaSeconds, yearsPerRealSecond);
    playerTimeYears = result.timeYears;
    if (result.reachedToday) {
      // Mirrors the "Today" button's own pause-on-arrival (see
      // `advancePlayerTimeYears`'s docstring) - otherwise a still-`playing`
      // player sitting exactly on Today would step away again next frame.
      // Story #266 AC: does NOT reset `playerRateSliderValue` - the
      // configured rate/direction persists across this auto-pause.
      setPlayerPlaying(false);
    }
  }

  forceVelocityVectorsOffIfAwayFromToday();

  // Story #240: the whole trails group's visibility is gated on
  // `isTrailVisible` (exactly `playerTimeYears !== 0`) BEFORE the per-star
  // loop below - this alone already guarantees "return to Today fully
  // clears all trails" (AC), independent of anything the loop does per
  // star; the loop's own per-line visibility check further below is a
  // belt-and-suspenders match to each star's actual catalog visibility.
  const trailsVisible = motionTrailsGroup ? isTrailVisible(playerTimeYears) : false;
  if (motionTrailsGroup) {
    motionTrailsGroup.visible = trailsVisible;
  }

  // Move the ~127 animated stars' markers (and, per this Story's chosen
  // label-tracking approach - see the PR description - their name labels)
  // to their time-extrapolated position. `isCatalogObjectVisible` is the
  // SAME predicate `updateCatalogVisibility`/`updateDenseBatchLod` already
  // use, so a star currently hidden by the category/radius filters stays
  // hidden here too rather than being forced visible by the player.
  const cameraDistancePc = camera.position.length();
  for (const obj of animatedStars) {
    const ref = objectIndexLookup.get(obj.id);
    if (!ref || !obj.velocity) continue;
    const positionPc = starPositionAtTime(obj.position_pc, obj.velocity, playerTimeYears);
    const visible = isCatalogObjectVisible(
      obj,
      categoryVisibility,
      radiusPc,
      cameraDistancePc,
      denseBatchRadiusPc,
    );
    setInstanceVisibility(
      ref.bucket,
      ref.index,
      visible,
      cameraDistancePc,
      denseBatchRadiusPc,
      bubbleOuterRadiusPc,
      positionPc,
    );
    const label = labelById.get(obj.id);
    if (label) {
      label.css2dObject.position.set(positionPc[0], positionPc[1], positionPc[2]);
    }

    // Story #240: rebuild this star's trail fresh from its real
    // `position_pc`/`velocity` every frame (never a frame-by-frame history
    // buffer) - the SAME `starPositionAtTime` calls, via
    // `starTrailPositionsPc`, that just positioned the marker above, so a
    // manual scrub jump rebuilds the trail correctly for the new time
    // rather than showing positions never actually animated through.
    const trail = trailByObjectId.get(obj.id);
    if (trail) {
      trail.mesh.visible = trailsVisible && visible;
      if (trailsVisible) {
        updateStarTrail(
          trail,
          starTrailPositionsPc(obj.position_pc, obj.velocity, playerTimeYears, playerRateDirection),
          camera.position,
        );
      }
    }
  }

  playerPanelHandle.update({
    tYears: playerTimeYears,
    playing: playerPlaying,
    rateSliderValue: playerRateSliderValue,
  });
  syncUiLock();
}

/**
 * Issue #137: dims the "background" - every non-star catalog bucket
 * (clusters, associations, extended structures - `objects.ts`'s
 * `updateBackgroundDimming`) plus the three structure-layer overlays (Gould
 * Belt, Radcliffe Wave, Local Bubble - `structures.ts`'s `set*Dimmed`) -
 * once the camera is inside the dense batch's own collection sphere, and
 * restores normal opacity once it exits, so the RECONS nearby-star
 * neighborhood reads as clearly spotlighted against everything else.
 *
 * Issue #227: now also computes `insideBubble` (`lod.ts`'s
 * `isCameraInsideLocalBubble`, the much larger ~60pc Local Bubble radius)
 * alongside the original `insideSphere`, and passes BOTH through to
 * `updateBackgroundDimming`/`setGouldBeltDimmed`/`setRadcliffeWaveDimmed` so
 * those can each resolve their own three-tier opacity. `setLocalBubbleDimmed`
 * still only ever receives `insideSphere`, unchanged - the Local Bubble's own
 * overlay stays tied only to the sphere trigger (see that function's
 * docstring for why).
 *
 * Threshold-snap, not a smooth per-frame ramp: `lod.ts`'s own dense-batch
 * visibility gate (`passesDenseBatchLod`/`isDenseBatchMember`) already snaps
 * hard at this exact same radius, so a matching hard snap here (for both
 * boundaries) keeps every "inside" effect in this app agreeing on where its
 * boundary is, and keeps this a small set of boolean decisions to test/
 * reason about rather than a second continuous curve alongside
 * `sunCoreRadiusPc`'s/`starMarkerRadiusPc`'s existing ramps (which shrink
 * *radius*, a different concern, for a different reason - see those
 * functions' own docstrings). Only does any work on the frame either
 * boolean actually flips (see `cameraWasInsideDenseBatchSphere`/
 * `cameraWasInsideLocalBubble` above), so this is cheap enough to call
 * unconditionally every frame alongside `applyDenseBatchLod`/
 * `applySunCoreScale`.
 *
 * Deliberately never touches the star bucket (`updateBackgroundDimming`'s
 * own `shouldDimBackground` excludes it) or any dense-batch star instance -
 * the RECONS nearby stars this issue spotlights are completely unaffected by
 * this function, satisfying #137's explicit constraint against any
 * per-instance star-opacity change. */
function applyBackgroundDimming(): void {
  const cameraDistancePc = camera.position.length();
  const insideSphere = isCameraInsideDenseBatchSphere(cameraDistancePc, denseBatchRadiusPc);
  const insideBubble = isCameraInsideLocalBubble(cameraDistancePc, bubbleOuterRadiusPc);
  // Issue #290: the EFFECTIVE value fed into `applyLocalBubbleGateState`
  // below (and so into that call's own change-detection, via
  // `cameraWasInsideLocalBubble`) - widened by `bubbleViewOverrideActive`
  // so a crossing-detection frame also fires on the frame that flag flips,
  // not only on a real camera-distance crossing. `insideBubble` itself
  // (the RAW, un-widened value) is still what's passed to the dimming-tier
  // calls below, completely unaffected by the override.
  const effectiveInsideBubble = effectiveInsideLocalBubble(insideBubble, bubbleViewOverrideActive);

  // Bug fix (Validator review on PR #291, post-#290): the dimming-tier
  // calls below get their OWN change-detection, gated on the RAW
  // `insideSphere`/`insideBubble` values (`cameraWasInsideDenseBatchSphere`/
  // `cameraWasInsideLocalBubbleRaw`) - deliberately NOT the same guard as
  // the Vectors/player gate just below, which uses the EFFECTIVE,
  // override-widened value instead. Reusing a single guard for both used to
  // mean that once `bubbleViewOverrideActive` pinned `effectiveInsideBubble`
  // at `true`, the shared guard matched on every subsequent frame regardless
  // of the real camera distance, so the raw-valued dimming calls silently
  // stopped re-running - see `cameraWasInsideLocalBubble`'s own docstring
  // above for the full writeup. Splitting the two guards means each branch
  // fires exactly on the frames it actually cares about, independent of the
  // other.
  if (insideSphere !== cameraWasInsideDenseBatchSphere || insideBubble !== cameraWasInsideLocalBubbleRaw) {
    cameraWasInsideDenseBatchSphere = insideSphere;
    cameraWasInsideLocalBubbleRaw = insideBubble;

    updateBackgroundDimming(catalogBuckets, insideSphere, insideBubble);
    setGouldBeltDimmed(gouldBeltGroup, insideSphere, insideBubble);
    setRadcliffeWaveDimmed(radcliffeWaveGroup, insideSphere, insideBubble);
    setLocalBubbleDimmed(localBubbleGroup, insideSphere);
  }

  // Story #287: the velocity-vectors toggle's enabled/disabled (and
  // forced-off-on-exit) state, and the player's own enabled/disabled +
  // force-reset state, are now gated on the Local Bubble boundary
  // (`insideBubble`) rather than the RECONS dense-batch sphere boundary
  // (`insideSphere`) - widened from issue #231's/Story #239's original
  // sphere-only gating, per Epic #285. Every OTHER effect above this
  // comment (background dimming's own dense-batch tier, the Gould
  // Belt/Radcliffe Wave/Local Bubble overlay dimming, `insideSphere`
  // itself) is unchanged and stays keyed to the RECONS sphere - out of this
  // Story's scope.
  //
  // Issue #290: routed through `applyLocalBubbleGateState` (which also
  // writes `cameraWasInsideLocalBubble`, the EFFECTIVE-valued change-
  // detection for this branch specifically) rather than calling
  // `applyVelocityVectorsButtonState`/`applyPlayerSphereState` directly, so
  // this is the exact same chokepoint `fitLocalBubbleButton`'s click
  // handler and `clearBubbleViewOverride` reuse - never duplicated. Guarded
  // by its own change-detection here (rather than unconditionally
  // re-applying every frame) so it only touches the DOM/group visibility on
  // an actual transition, matching the dimming-tier branch's own guard
  // above in spirit even though the two now track different values.
  if (effectiveInsideBubble !== cameraWasInsideLocalBubble) {
    applyLocalBubbleGateState(effectiveInsideBubble);
  }
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
 * `denseBatchRadiusPc`) that function can't see on its own. Issue #217's
 * scope expansion dropped the `controls.minDistance` argument this used to
 * pass through - `sunCoreRadiusPc`'s curve no longer has a segment that
 * depends on it, see that function's docstring. */
function selectedObjectMarkerRadiusPc(obj: SceneObject): number {
  return selectedMarkerRadiusPc(
    obj,
    SUN_OBJECT_ID,
    camera.position.length(),
    denseBatchRadiusPc,
    bubbleOuterRadiusPc,
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

  // Issue #236: velocity-arrow speed labels ("31.5 km/s") - a completely
  // independent pool from the catalog/Sun labels above/below, so this block
  // runs regardless of `labelsInfo`'s own null-check just below (speed
  // labels have nothing to do with the general "labels" toggle/pool; their
  // own gate is `velocityVectorsGroup.visible` itself, which already
  // implements issue #231's exact "toggle ON AND camera inside sphere" rule
  // via `velocityVectorsVisible` - reusing that live boolean directly here,
  // rather than re-deriving `insideSphere` a second time, guarantees speed
  // labels can never be visible while their arrows aren't (no orphans) and
  // always recompute on this same per-frame `animate()` cadence the arrows'
  // own visibility already does, with no second RAF hook).
  if (velocitySpeedLabelsInfo) {
    // The actual candidate/cap-selection decision is the pure, independently
    // unit-tested `selectVisibleVelocitySpeedLabelIds` (`velocityVectors.ts`)
    // - itself built on `labels.ts`'s reused `selectNearestLabels`, through
    // the NEW, independent, FINITE `VELOCITY_SPEED_LABEL_MAX_VISIBLE` cap
    // (NOT `DENSE_BATCH_MAX_VISIBLE_LABELS`, which issue #159 deliberately
    // set to `Number.POSITIVE_INFINITY` for star NAME labels specifically -
    // see that function's docstring for why reusing it here would show all
    // ~127 speed labels at once). This call site only supplies the two
    // things that function can't see on its own: each label's current
    // camera distance, and whether the arrows themselves are visible right
    // now (`velocityVectorsGroup.visible` - the same `velocityVectorsVisible`
    // toggle-ON-AND-inside-sphere gate the arrows use, reused directly so
    // speed labels can never be visible while their arrows aren't).
    const speedLabelCandidates = velocitySpeedLabelsInfo.labels.map((label) => ({
      objectId: label.objectId,
      cameraDistancePc: camera.position.distanceTo(label.css2dObject.position),
    }));
    const visibleSpeedLabelIds = selectVisibleVelocitySpeedLabelIds(
      speedLabelCandidates,
      velocityVectorsGroup?.visible ?? false,
      VELOCITY_SPEED_LABEL_MAX_VISIBLE,
    );
    for (const label of velocitySpeedLabelsInfo.labels) {
      label.css2dObject.visible = visibleSpeedLabelIds.has(label.objectId);
    }
  }

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

  // Issue #114 introduced a much smaller dense-batch-only cap here; issue
  // #159 set `DENSE_BATCH_MAX_VISIBLE_LABELS` to `Number.POSITIVE_INFINITY`
  // so every dense-batch candidate that reaches this call is shown - see
  // that constant's docstring. Still routed through `selectDenseBatchLabels`
  // (rather than skipping the call) so the "selected candidate always
  // included" bookkeeping stays in one place, unioned with the general
  // result above. Outside the dense LOD volume `denseBatchCandidates` is
  // always empty (nothing passes the `passesDenseBatchLod` gate above), so
  // this is a no-op there and general-scale label behavior is exactly as
  // before.
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

/** Issue #197: fixed dolly step factor for the Zoom In/Out toolbar buttons -
 * ~20% closer per Zoom In click, and its exact reciprocal for Zoom Out, so a
 * Zoom In followed immediately by a Zoom Out returns to (approximately) the
 * same camera distance rather than drifting. Actual clamping to
 * `controls.minDistance`/`maxDistance` lives in the pure, unit-tested
 * `dollyPosition` (`scene/camera.ts`) - this is just the factor constant. */
const ZOOM_IN_STEP_FACTOR = 0.8;
const ZOOM_OUT_STEP_FACTOR = 1 / ZOOM_IN_STEP_FACTOR;

/** Issue #197: shared dolly-toward/away-from-target handler for the Zoom
 * In (+) / Zoom Out (-) toolbar buttons - thin wrapper around the pure
 * `dollyPosition` supplying the live `camera.position`/`controls.target`/
 * `controls.minDistance`/`controls.maxDistance` that function can't see on
 * its own (same split as `selectedObjectMarkerRadiusPc` above), then writes
 * the clamped result back onto the real camera and calls `controls.update()`
 * per the issue's acceptance criteria. */
function zoomBy(factor: number): void {
  const newPosition = dollyPosition(
    [camera.position.x, camera.position.y, camera.position.z],
    [controls.target.x, controls.target.y, controls.target.z],
    factor,
    controls.minDistance,
    controls.maxDistance,
  );
  camera.position.set(...newPosition);
  controls.update();
}

/** Issue #205 (fixing #201/#202's regression): applies `steps` applications
 * of the same zoom-IN step the toolbar's own Zoom In ("+") button uses
 * (`ZOOM_IN_STEP_FACTOR` + `dollyPosition`, via the pure `dollyPositionSteps`
 * in `scene/camera.ts`) to a computed `CameraPose`'s position, before calling
 * `applyCameraPose` - the "fit" buttons' extra zoom-in padding (acceptance
 * criterion #1). #201/#202 originally wired this to `ZOOM_OUT_STEP_FACTOR`,
 * which was backwards: "+N zoom levels" means zoom IN (closer), not out - the
 * human owner confirmed live that the buttons ended up more zoomed OUT than
 * before when they should end up more zoomed IN. Thin wrapper supplying the
 * live `controls.minDistance`/`maxDistance` `dollyPositionSteps` can't see on
 * its own, same read-live-state/write-back split as `zoomBy` above (this only
 * reads, `applyCameraPose` does the writing). `pose.target` is left untouched
 * - only the distance from it changes, exactly as a live "+" click would
 * leave `controls.target` alone. */
function applyCameraPoseWithExtraZoomIn(pose: CameraPose, steps: number): void {
  const position = dollyPositionSteps(
    pose.position,
    pose.target,
    ZOOM_IN_STEP_FACTOR,
    controls.minDistance,
    controls.maxDistance,
    steps,
  );
  applyCameraPose({ position, target: pose.target });
}

/** Number of extra zoom-in-button-equivalent steps (`ZOOM_IN_STEP_FACTOR`
 * applications, via `applyCameraPoseWithExtraZoomIn`) each "fit" button
 * applies beyond its own pose-computation function's (`fitAllPose`/
 * `fitSpherePose`) plain framing, per issue #201's acceptance criteria as
 * corrected by #205 - the human owner tested live and wanted each pulled in
 * closer by exactly this many "+" clicks' worth of padding (same step
 * counts as #201/#202, just the opposite direction). */
const SHOW_ALL_EXTRA_ZOOM_IN_STEPS = 3;
const FIT_LOCAL_BUBBLE_EXTRA_ZOOM_IN_STEPS = 2;
const FIT_NEAREST_STARS_EXTRA_ZOOM_IN_STEPS = 6;

/** Issue #197: "Fit to Local Bubble" - frames the Local Bubble's real
 * ellipsoid extent (`local_bubble.center_pc`, and `max(semi_axes_pc)` as a
 * conservative bounding-sphere radius covering the whole ellipsoid,
 * including its longest axis) via the new `fitSpherePose`. No-op if the
 * scene has no Local Bubble layer - `fitLocalBubbleButton` is also disabled
 * in that case (see `applyLocalBubbleButtonState` below) so this path
 * shouldn't normally be reachable, but stays a safe no-op rather than
 * erroring either way (spec §38). Issue #201/#205: the resulting pose gets
 * `FIT_LOCAL_BUBBLE_EXTRA_ZOOM_IN_STEPS` (2) extra zoom-in steps applied
 * as post-processing, not a change to `fitSpherePose`'s own math. */
function applyFitLocalBubblePose(): void {
  if (!localBubbleStructure) return;
  const { x_pc, y_pc, z_pc } = localBubbleStructure.center_pc;
  const { a_pc, b_pc, c_pc } = localBubbleStructure.semi_axes_pc;
  applyCameraPoseWithExtraZoomIn(
    fitSpherePose([x_pc, y_pc, z_pc], Math.max(a_pc, b_pc, c_pc)),
    FIT_LOCAL_BUBBLE_EXTRA_ZOOM_IN_STEPS,
  );
}

/** Issue #197: "Fit to Nearest-Stars Sphere" - frames the RECONS dense-LOD
 * collection sphere (`denseBatchRadiusPc`, already computed from the loaded
 * scene per issue #104), centered on the Sun/origin. Issue #201/#205: the
 * resulting pose gets `FIT_NEAREST_STARS_EXTRA_ZOOM_IN_STEPS` (6) extra
 * zoom-in steps applied as post-processing. */
function applyFitNearestStarsPose(): void {
  applyCameraPoseWithExtraZoomIn(
    fitSpherePose([0, 0, 0], denseBatchRadiusPc),
    FIT_NEAREST_STARS_EXTRA_ZOOM_IN_STEPS,
  );
  // Issue #290: one of the explicit camera-repositioning actions that
  // clears `bubbleViewOverrideActive` - called AFTER the pose above so
  // `clearBubbleViewOverride` recomputes the gate from the camera's real
  // POST-move distance (which, for this particular button, is normally
  // still inside the Local Bubble anyway, so Vectors/TIME CONTROLS should
  // stay active here too - just now via the ordinary real-distance path,
  // not the override).
  clearBubbleViewOverride();
}

/** Issue #197: keeps `fitLocalBubbleButton` disabled whenever the loaded
 * scene has no Local Bubble layer (`localBubbleStructure === null`, either
 * because the scene hasn't loaded yet or because that optional layer was
 * absent/malformed - spec §38) rather than leaving it clickable into a
 * no-op or, worse, an error.
 *
 * Issue #292: `localBubbleStructure === null` is the ONE out-of-scope reason
 * this button stays genuinely `disabled` (native attribute - there's nothing
 * sensible to fit to, unrelated to the player-time lock this issue covers).
 * The player-time lock (`uiLocked`) component of the old combined formula
 * moved to `setToolbarButtonLocked`'s VISUAL-only class instead, matching
 * `syncUiLock`'s own write to this same button so the two chokepoints can't
 * disagree. */
function applyLocalBubbleButtonState(): void {
  fitLocalBubbleButton.disabled = localBubbleStructure === null;
  setToolbarButtonLocked(fitLocalBubbleButton, uiLocked);
}

applyLocalBubbleButtonState();
// Issue #231: disabled until the scene loads and the camera is confirmed
// inside the Local Bubble (Story #287: widened from the RECONS sphere -
// `bubbleOuterRadiusPc` is still `null` here, so `isCameraInsideLocalBubble`
// would report `false` regardless - passed explicitly rather than computed,
// mirroring `applyLocalBubbleButtonState`'s own startup call just above).
applyVelocityVectorsButtonState(false);
// Story #239: same reasoning, same startup timing, for the player toggle.
applyPlayerSphereState(false);

// Story #257: the three new side-panel triggers - see `toggleSidePanel`'s
// docstring above for the mutual-exclusivity behavior these share.
layersToggle.addEventListener("click", () => toggleSidePanel("layers"));
settingsToggle.addEventListener("click", () => toggleSidePanel("settings"));
cameraToggle.addEventListener("click", () => toggleSidePanel("camera"));

/**
 * Issue #262: close whichever of the three Story #257 side panels
 * (Layers/Settings/Camera) is open on ANY click that lands outside both its
 * own DOM subtree and its own toolbar trigger button - including a click on
 * the 3D viewport itself (star selection, the start of an orbit/pan drag).
 * Deliberately a single passive `document`-level listener rather than a
 * modal scrim/overlay: it never calls `preventDefault`/`stopPropagation`, so
 * every other click handler on the page (the trigger buttons' own toggle
 * logic, the canvas's click-to-select handler, `OrbitControls`' own
 * pointer listeners) keeps firing exactly as before - this only ever adds
 * an "also close the panel" side effect on top, never swallows the click.
 *
 * Explicitly scoped to the three #257 panels ONLY, per the issue - the
 * Player panel (Epic #238) keeps its own deliberately-different close/reset
 * semantics (toolbar-button-only, no click-outside) and is untouched here.
 *
 * Ordering/double-handling: this listener only ever acts when
 * `openSidePanelName` is still non-null by the time the click bubbles to
 * `document`. A click on a trigger button already resolves synchronously in
 * that button's own listener (target phase, before bubbling) via
 * `toggleSidePanel`/`openSidePanel`/`closeSidePanel` above - by the time
 * this listener runs, `openSidePanelName` (and `getSidePanelToggleButton`)
 * already reflect the post-click state, so checking "is this click inside
 * the NOW-open panel's own trigger button" correctly excludes both
 * re-clicking a panel's own icon to close it (already closed, name is
 * `null`, early return) and clicking a different panel's icon to switch to
 * it (that panel is now the open one, and the click target is its own
 * button) - neither case gets stuck open or immediately re-closed.
 */
document.addEventListener(
  "click",
  (event) => {
    if (openSidePanelName === null) return;
    const handle = getSidePanelHandle(openSidePanelName);
    if (!handle) return;
    const target = event.target as Node | null;
    const button = getSidePanelToggleButton(openSidePanelName);
    if (target && (handle.element.contains(target) || button.contains(target))) {
      return;
    }
    closeSidePanel(openSidePanelName);
  },
  { passive: true },
);

// Issue #292: all 6 of the following, plus `velocityVectorsButton`'s own
// handler further below, are wrapped via `withLockedButtonEscapeHatch` -
// while `syncUiLock`'s lock is active, a click resets to Today instead of
// performing the button's normal action below.
zoomInButton.addEventListener("click", withLockedButtonEscapeHatch(() => zoomBy(ZOOM_IN_STEP_FACTOR)));
zoomOutButton.addEventListener("click", withLockedButtonEscapeHatch(() => zoomBy(ZOOM_OUT_STEP_FACTOR)));
showAllButton.addEventListener("click", withLockedButtonEscapeHatch(() => applyCameraPreset("fit-all")));
// Issue #290: after the existing framing (unchanged - still shows the WHOLE
// bubble from ~317pc, per this button's own confirmed-correct #219/#220
// behavior), explicitly sets the persistent override and immediately
// applies the same activation `applyBackgroundDimming`'s crossing-detection
// calls, via the shared `applyLocalBubbleGateState` chokepoint - so Vectors/
// TIME CONTROLS activate right away rather than waiting on the real
// (never-true-from-this-pose) per-frame distance check. Re-clicking while
// already active is a harmless no-op re-set: `bubbleViewOverrideActive` is
// just set to `true` again, and `applyLocalBubbleGateState(true)` is
// idempotent (see `nextVelocityVectorsToggleOn`/`nextPlayerStateForSphere`'s
// own "state unchanged when already inside" branches).
fitLocalBubbleButton.addEventListener(
  "click",
  withLockedButtonEscapeHatch(() => {
    applyFitLocalBubblePose();
    bubbleViewOverrideActive = true;
    applyLocalBubbleGateState(true);
  }),
);
fitNearestStarsButton.addEventListener("click", withLockedButtonEscapeHatch(applyFitNearestStarsPose));
// Issue #231: the button is only ever clickable (native `disabled`) while
// `cameraWasInsideLocalBubble` is `true` (Story #287: widened from
// `cameraWasInsideDenseBatchSphere`) - already kept in sync with this exact
// click-time camera state by `applyBackgroundDimming`'s crossing-detection,
// called every frame - so it's reused directly here rather than
// recomputing `isCameraInsideLocalBubble` again.
velocityVectorsButton.addEventListener(
  "click",
  withLockedButtonEscapeHatch(() => {
    velocityVectorsOn = !velocityVectorsOn;
    velocityVectorsButton.setAttribute("aria-pressed", String(velocityVectorsOn));
    velocityVectorsButton.classList.toggle("active", velocityVectorsOn);
    if (velocityVectorsGroup) {
      velocityVectorsGroup.visible = velocityVectorsVisible(
        velocityVectorsOn,
        cameraWasInsideLocalBubble,
      );
    }
  }),
);
// Story #275: the toolbar Play button's own click handler (Story #239's
// original open/close toggle, Story #245's "first press only reveals,
// never auto-starts" refinement, Story #249's "second press closes and
// resets" behavior) is removed along with the button itself -
// `playerCollapsedIndicator`'s own click handler (built alongside
// `playerPanelHandle` above) now owns the "reveal, never auto-start" first
// action, and `collapsePlayerPanel` (the panel's own collapse chevron, per
// Part 2's behavior change) owns minimizing back to the indicator. Only
// leaving the sphere (`applyPlayerSphereState`) still resets/closes fully.
infoToggleButton.addEventListener("click", withLockedButtonEscapeHatch(() => infoDialog.show()));

/** Search / go-to-object (issue #106, spec §2.6): frames the camera closely
 * on `obj` (via `objectCenteredPose`, distance proportional to the
 * object's own marker radius) and selects it - reusing `selectObject`
 * directly so the Inspector/label-selection highlighting stays exactly as
 * consistent as a manual click-to-select.
 *
 * Issue #207: for a RECONS dense-batch member specifically
 * (`isDenseBatchMember`), the generic `objectCenteredPose` framing distance
 * is additionally capped via `denseBatchObjectFrameMaxDistancePc` so the
 * camera lands within (or very close to) the dense-LOD sphere's own
 * `denseBatchRadiusPc` of the origin - see that function's docstring for
 * the full root-cause writeup (confirmed live) of why the un-capped generic
 * distance produced an oversized selection reticle for a dense-batch star
 * selected from outside the sphere. Every other object type is completely
 * unaffected - `maxDistancePc` stays `undefined`, `objectCenteredPose`'s
 * behavior for them is unchanged. */
function goToObject(obj: SceneObject): void {
  const maxDistancePc =
    isDenseBatchMember(obj) && denseBatchRadiusPc > 0
      ? denseBatchObjectFrameMaxDistancePc(obj.position_pc, denseBatchRadiusPc)
      : undefined;
  applyCameraPose(
    objectCenteredPose(
      obj.position_pc,
      markerRadiusPc(obj.size_pc, obj.object_type, obj.distance_pc, denseBatchRadiusPc, bubbleOuterRadiusPc),
      maxDistancePc,
    ),
  );
  selectObject(obj);
  // Issue #290: Search's "go to object" is a deliberate extension of the
  // literal acceptance criteria (scoped there to "Fit/Camera buttons") -
  // included here too so `bubbleViewOverrideActive` doesn't linger active
  // after jumping to an unrelated, possibly-distant object via search; see
  // the PR description for the full rationale. Called AFTER the pose above,
  // same ordering as every other clearing call site.
  clearBubbleViewOverride();
}

// Issue #262: the former "Face-on" preset was merged into "Top view" (they
// computed an identical pose - see `scene/cameraPresets.ts`'s module
// docstring for the original judgment call, and its `topViewPose`
// docstring for the merge itself) - only one entry survives here.
const CAMERA_PRESETS: { key: string; label: string }[] = [
  { key: "perspective", label: "Perspective" },
  { key: "top", label: "Top view" },
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
    case "edge-on":
      applyCameraPose(edgeOnPose(radiusPc));
      break;
    case "sun-centered":
      applyCameraPose(sunCenteredPose());
      break;
    case "fit-all":
      // Issue #201/#205: +3 extra zoom-in steps beyond `fitAllPose`'s own
      // framing (see `SHOW_ALL_EXTRA_ZOOM_IN_STEPS`).
      applyCameraPoseWithExtraZoomIn(
        fitAllPose(currentlyVisiblePositions()),
        SHOW_ALL_EXTRA_ZOOM_IN_STEPS,
      );
      break;
    default:
      console.warn(`Unknown camera preset '${key}'`);
      return;
  }
  // Issue #290: every real preset above (the four Camera-panel presets AND
  // "Fit all"/`showAllButton`, which also routes through this same
  // function with key `"fit-all"`) is one of the explicit
  // camera-repositioning actions that clears `bubbleViewOverrideActive` -
  // called AFTER the pose above so it recomputes the gate from the
  // camera's real POST-move distance. The unknown-key `default` case
  // returns early instead of falling through here, since it never actually
  // moved the camera.
  clearBubbleViewOverride();
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

    // Issue #215: `localBubbleStructure`/`bubbleOuterRadiusPc` are populated
    // here, before `createCatalogObjectGroup` below, rather than at their
    // pre-#215 spot further down (right before the Local Bubble structure
    // layer itself) - `createCatalogObjectGroup` needs `bubbleOuterRadiusPc`
    // to bake each star's graduated baseline radius into its instance matrix
    // at scene-load time, so it must be known by the time that call runs.
    // `?? null` since `SceneStructures.local_bubble` is `undefined` (not
    // `null`) when absent.
    //
    // Story #287: also moved ahead of the velocity-vectors/speed-labels
    // construction just below - those now need `bubbleOuterRadiusPc`
    // themselves (widened from `denseBatchRadiusPc`), so it must be known
    // before they're built too, not just before `createCatalogObjectGroup`.
    localBubbleStructure = sceneData.structures.local_bubble ?? null;
    bubbleOuterRadiusPc = bubbleOuterRadiusPcFrom(localBubbleStructure);

    // Issue #231: the velocity-vectors layer - built once here (like
    // `denseBatchBoundaryMesh` above) now that both `sceneData.objects` and
    // the real `bubbleOuterRadiusPc` are known. Starts hidden
    // (`createVelocityVectorsLayer`'s own `visible = false` default);
    // `applyVelocityVectorsButtonState`, called from `applyBackgroundDimming`
    // in `animate()`, is what turns it on/off from here on. Story #287:
    // widened from `denseBatchRadiusPc` (the RECONS sphere) to
    // `bubbleOuterRadiusPc` (the Local Bubble), per Epic #285.
    velocityVectorsGroup = createVelocityVectorsLayer(sceneData.objects, bubbleOuterRadiusPc);
    scene.add(velocityVectorsGroup);

    // Issue #236: the speed-label pool for those same arrows - built once
    // here too. Every label starts life un-toggled either way (visibility
    // is driven entirely by `updateLabelVisibility`'s new speed-label block,
    // called right after this `.then()` finishes below, before the first
    // real frame renders). Story #287: widened alongside the arrows layer
    // above.
    velocitySpeedLabelsInfo = createVelocitySpeedLabelsLayer(sceneData.objects, bubbleOuterRadiusPc);
    scene.add(velocitySpeedLabelsInfo.group);

    const catalogLayer = createCatalogObjectGroup(
      sceneData.objects,
      denseBatchRadiusPc,
      bubbleOuterRadiusPc,
    );
    catalogBuckets = catalogLayer.buckets;
    scene.add(catalogLayer.group);

    // Story #239: the id -> (bucket, index) lookup the motion player's
    // per-frame animation loop needs, built ONCE here (well before any
    // player session starts) rather than scanned per animated star per
    // frame - see `objects.ts`'s `buildObjectIndexLookup` docstring.
    objectIndexLookup = buildObjectIndexLookup(catalogBuckets);
    // The animated population itself - Epic #229's/#231's own
    // `starsWithVelocityInLocalBubble` (Story #287: renamed from
    // `starsWithVelocityInSphere` and widened from `denseBatchRadiusPc` to
    // `bubbleOuterRadiusPc`), reused directly rather than reimplemented, per
    // this Story's explicit instruction.
    animatedStars = starsWithVelocityInLocalBubble(sceneData.objects, bubbleOuterRadiusPc);

    // Story #240: one trail `Line` per animated star, built once now that
    // `animatedStars` (the SAME pool, never reimplemented) is known. Starts
    // hidden (`createMotionTrailsLayer`'s own `visible = false` default);
    // `applyPlayerAnimation`'s own per-frame hook is what shows/updates it
    // from here on - no second RAF hook, per this Story's explicit
    // instruction to reuse Story #239's existing one.
    const motionTrailsLayer = createMotionTrailsLayer(animatedStars);
    motionTrailsGroup = motionTrailsLayer.group;
    trailByObjectId = motionTrailsLayer.trails;
    scene.add(motionTrailsGroup);

    labelsInfo = createLabelsLayer(catalogObjects);
    scene.add(labelsInfo.group);
    // Story #239: same id -> label lookup, for the label-position-tracking
    // half of the per-frame animation loop (see this Story's PR description
    // for why label tracking, rather than hiding, was the chosen approach).
    labelById = new Map(labelsInfo.labels.map((label) => [label.object.id, label]));

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

    // Issue #197: (re)apply the "Fit to Local Bubble" toolbar button's
    // enabled/disabled state now that the scene's actual
    // `structures.local_bubble` presence is known - `localBubbleStructure`
    // itself is already populated further up (issue #215, before
    // `createCatalogObjectGroup` needed it).
    applyLocalBubbleButtonState();

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

    // Story #257: the old single combined panel is now three separate side
    // panels - Layers needs the live catalog's category set (`categories`,
    // just computed above) and so, like the old combined panel, can only be
    // built here once the scene has loaded. Settings and Camera don't
    // themselves depend on scene data, but are built here too rather than
    // at top-level startup (unlike e.g. `playerPanelHandle`) so all three
    // panels share one lifecycle and appear together - simpler to reason
    // about than two different "when do these toolbar buttons start
    // working" timings.
    layersPanelHandle = createLayersPanel({
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
    });
    // Story #239: the panel is built fresh here, well after startup - sync
    // it to whatever the UI-lock state already is (normally `false`, since
    // the scene loads before any player interaction is possible, but this
    // keeps the invariant airtight rather than assumed).
    layersPanelHandle.setLocked(uiLocked);

    settingsPanelHandle = createSettingsPanel({
      onRadiusChange: (newRadiusPc) => {
        radiusPc = newRadiusPc;
        applyCatalogVisibility();
        updateLabelVisibility();
      },
      onSizeScaleChange: (scale) => {
        sizeScale = scale;
        applyCatalogVisibility();
      },
      onExportPng: () => {
        // Render both the WebGL canvas and re-sync the label layer just
        // before capture so the exported PNG reflects the current view
        // (label text itself is DOM/CSS2D, outside the canvas, and is not
        // part of the PNG - spec §39 asks for "at minimum" a WebGL PNG
        // screenshot, which this provides).
        exportSceneAsPng(renderer, scene, camera);
      },
    });
    settingsPanelHandle.setLocked(uiLocked);

    // Story #257 AC: the Camera panel omits "Fit all" - that preset is
    // already its own dedicated toolbar icon (`showAllButton`, position #8)
    // wired to the exact same `applyCameraPreset("fit-all")` action just
    // above, so including it here too would duplicate it. Live-verified the
    // remaining four presets (Perspective/Top view/Edge-on/Sun-centered -
    // issue #262 merged the former "Face-on" duplicate into "Top view")
    // still wrap cleanly in `.camera-preset-row`'s flex-wrap layout without
    // "Fit all" - omitting it reads as strictly cleaner here, not a layout
    // compromise.
    cameraPanelHandle = createCameraPanel({
      cameraPresets: CAMERA_PRESETS.filter((preset) => preset.key !== "fit-all"),
      onCameraPreset: applyCameraPreset,
    });

    // Issue #203: `onSelect` now also closes the search modal after
    // `goToObject` moves the camera, so the user immediately sees the 3D
    // result instead of the result staying hidden behind the still-open
    // dialog (unlike the Info dialog, which has no "action" to complete and
    // so stays open until explicitly dismissed). `createSearchBox`'s own
    // commit logic (click/Enter-to-commit) is unchanged - this is purely
    // the call site's own callback, same as `goToObject` itself already was.
    const searchBox = createSearchBox({
      getObjects: () => catalogObjects,
      onSelect: (obj) => {
        goToObject(obj);
        searchDialog.hide();
      },
    });
    searchDialog.appendContent(searchBox.element);

    // Story #257: mounted directly under `#app`, like `playerPanelHandle`'s
    // own element - each panel's own `.side-panel` CSS positions/hides it
    // (`style.css`), so no shared wrapper container (the retired
    // `#menu-panels`) is needed any more.
    app.appendChild(layersPanelHandle.element);
    app.appendChild(settingsPanelHandle.element);
    app.appendChild(cameraPanelHandle.element);

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
  // Story #239 AC #9: star-click selection/Inspector-opening is one of the
  // controls the UI lock disables whenever the player's time is away from
  // Today - the canvas itself has no `disabled` DOM property to toggle, so
  // this is guarded directly here via the same `uiLocked` flag
  // `syncUiLock` maintains. Camera navigation (`OrbitControls`, which also
  // listens on this same element) is a completely separate listener and is
  // untouched by this check, per that AC.
  if (uiLocked) return;
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

/** Issue #155: the origin end of the +X axis, projected every frame
 * alongside the label's own anchor point (`_galacticCenterPointScratch`
 * above) so `galacticCenterOnScreenArrowAngleDeg` has two genuinely
 * distinct points on the axis to derive its current on-screen direction
 * from. A plain constant (not reset/mutated per frame like the scratch
 * vector above): the origin never moves, and `projectToNdc` only reads its
 * `point` argument (copies it into its own internal scratch vectors - see
 * that function's own definition), so one shared instance is safe to reuse
 * indefinitely. */
const _galacticCenterOrigin = new Vector3(0, 0, 0);

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
 *
 * Issue #155: the on-screen case (`placement.onScreen`) also rotates
 * `galacticCenterLabelArrow` - the small direction glyph beside the label's
 * text - toward the +X axis's current on-screen direction, computed via
 * `galacticCenterOnScreenArrowAngleDeg` from this same anchor point's `ndc`
 * plus a fresh `projectToNdc` of the axis's origin end. Without this, the
 * anchored label read as "this is where the Galactic Center is" (a fixed
 * location marker) rather than "this way is the Galactic Center" (a
 * direction, which is what #149's whole distance-scaling point actually
 * conveys) - the off-screen fallback above already got its own rotating
 * arrow in #154; this closes the gap for the far more common on-screen case.
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
    // Issue #155: point the on-screen label's own direction arrow further
    // outward along the +X axis's current on-screen direction, derived from
    // the projected screen positions of two points already on that axis -
    // the origin and this same anchor point (`ndc`, computed above) - per
    // #155's explicit ask to reuse `projectToNdc` rather than a second
    // projection method.
    const originNdc = projectToNdc(_galacticCenterOrigin, camera);
    const arrowAngleDeg = galacticCenterOnScreenArrowAngleDeg(originNdc, ndc);
    galacticCenterLabelArrow.style.transform = `rotate(${arrowAngleDeg}deg)`;
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

/** Story #239: real (wall-clock) time of the previous `animate()` frame -
 * `applyPlayerAnimation` needs a per-frame delta (nothing else in this file
 * previously did; every other per-frame effect here is a function of
 * absolute camera/time state, not a rate) to convert the speed slider's
 * years-per-real-second rate into an actual time step. */
let lastFrameTimeMs = performance.now();

function animate(): void {
  requestAnimationFrame(animate);
  const nowMs = performance.now();
  const deltaSeconds = (nowMs - lastFrameTimeMs) / 1000;
  lastFrameTimeMs = nowMs;

  controls.update();
  // Story #239: `applyDenseBatchLod` (which resets every dense-batch star's
  // instance matrix to its real, static position every frame) must run
  // BEFORE `applyPlayerAnimation` (which then overrides just the ~127
  // animated stars' matrices with their time-extrapolated position) - the
  // reverse order would have this per-frame LOD pass immediately stomp the
  // player's own override right back to the static position every frame.
  applyDenseBatchLod();
  applySunCoreScale();
  applyDenseBatchBoundaryVisibility();
  // May reset the player's time/playing/panel state to Today/paused/hidden
  // on a sphere-exit crossing frame (`applyPlayerSphereState`, called from
  // within this) - must run before `applyPlayerAnimation` so that reset is
  // what the animation loop below actually acts on this same frame, rather
  // than animating for one more frame off the pre-reset state.
  applyBackgroundDimming();
  applyPlayerAnimation(deltaSeconds);
  // Runs after `applyPlayerAnimation` so the density/rank cap's own
  // camera-distance ranking (`updateLabelVisibility`) sees each animated
  // star's label at its freshly-updated (this frame's) position, not last
  // frame's.
  updateLabelVisibility();
  applyFovReadout();
  applyGalacticCenterLabelPosition();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
