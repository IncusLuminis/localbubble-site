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
  buildStarCatalogBucket,
  catalogObjectTypes,
  CLUSTER_OBJECT_TYPES,
  createCatalogObjectGroup,
  excludeDedicatedMarkerObjects,
  isCatalogObjectVisible,
  isSelectedObjectVisible,
  markerRadiusPc,
  selectedMarkerRadiusPc,
  setInstanceVisibility,
  STAR_OBJECT_TYPES,
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
  buildRealworldStarLayer,
  disposeRealworldStarLayer,
  updateRealworldStarSizeScale,
  updateRealworldStarVisibility,
  visibleRealworldStarObjects,
  type RealworldStarLayer,
} from "./scene/realworldStars";
import { loadStarRenderStyle, saveStarRenderStyle, type StarRenderStyle } from "./scene/starRenderStyle";
import { redrawStarTwinkleAtlas, getTunableStarTwinkleAtlasTexture } from "./scene/starTwinkle"; // PROTOTYPE: live spike length/width tuning
import {
  denseBatchCollectionRadiusPc,
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
  currentArrowScaleFactor,
  selectVisibleVelocitySpeedLabelIds,
  starsWithVelocity,
  updateVelocitySpeedLabelPositions,
  updateVelocityVectorsScale,
  VELOCITY_SPEED_LABEL_MAX_VISIBLE,
  velocityVectorsVisible,
} from "./scene/velocityVectors";
import {
  advancePlayerTimeYears,
  clampPlayerTimeYears,
  isUiLockedForPlayerTime,
  logSpeedSliderToYearsPerSecond,
  nudgeRateSliderValue,
  starPositionAtTime,
  type PlayerDirection,
} from "./scene/motionPlayer";
import {
  createMotionTrailsLayer,
  currentTrailWindowYears,
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
  clusterOrAssociationShapeRadiusPc,
  createDiffuseStructureLayer,
  DIFFUSE_STRUCTURE_OBJECT_TYPES,
  updateDiffuseStructureDimming,
  updateDiffuseStructureVisibility,
  visibleDiffuseStructureObjects,
  type DiffuseStructureLayer,
} from "./scene/diffuseStructures";
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
import { SimplificationsDialog } from "./ui/simplificationsDialog";
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

// PROTOTYPE (not for merge): SELECTIVE bloom - only objects placed on
// BLOOM_SCENE layer (just the REALWORLD star Points layer, see
// `rebuildStarRenderLayer`'s two build sites below) feed the bloom pass.
// Everything else (nebulae/clusters sprites, Gould Belt/Radcliffe Wave tubes,
// RECONS-sphere/Local-Bubble wireframes) is darkened during the bloom-source
// render, so bloom can't wash them out - they render at their existing,
// already-tuned brightness in the final composite untouched.
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/examples/jsm/postprocessing/ShaderPass.js";
import { Vector2, Layers, ShaderMaterial, MeshBasicMaterial, SpriteMaterial, LineBasicMaterial } from "three";
import type { Object3D, Material } from "three";

const BLOOM_SCENE = 1;
const bloomLayer = new Layers();
bloomLayer.set(BLOOM_SCENE);
const darkMeshMaterial = new MeshBasicMaterial({ color: 0x000000 });
const darkSpriteMaterial = new SpriteMaterial({ color: 0x000000, opacity: 0, transparent: true });
const darkLineMaterial = new LineBasicMaterial({ color: 0x000000 });
const bloomMaterialCache = new Map<string, Material | Material[]>();

function darkenNonBloomed(obj: Object3D): void {
  const o = obj as unknown as {
    isMesh?: boolean;
    isSprite?: boolean;
    isLine?: boolean;
    material?: Material | Material[];
    uuid: string;
  };
  if (!o.material || bloomLayer.test(obj.layers)) {
    return;
  }
  bloomMaterialCache.set(o.uuid, o.material);
  if (o.isSprite) {
    o.material = darkSpriteMaterial;
  } else if (o.isLine) {
    o.material = darkLineMaterial;
  } else if (o.isMesh) {
    o.material = darkMeshMaterial;
  }
}
function restoreMaterial(obj: Object3D): void {
  const o = obj as unknown as { material?: Material | Material[]; uuid: string };
  const cached = bloomMaterialCache.get(o.uuid);
  if (cached) {
    o.material = cached;
    bloomMaterialCache.delete(o.uuid);
  }
}

const bloomPass = new UnrealBloomPass(
  new Vector2(window.innerWidth, window.innerHeight),
  1.5, // strength
  0.7, // radius
  0.25, // threshold
);
const camera = createCamera();
const bloomComposer = new EffectComposer(renderer);
bloomComposer.renderToScreen = false;
bloomComposer.addPass(new RenderPass(scene, camera));
bloomComposer.addPass(bloomPass);

const bloomCompositePass = new ShaderPass(
  new ShaderMaterial({
    uniforms: {
      baseTexture: { value: null },
      bloomTexture: { value: bloomComposer.renderTarget2.texture },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D baseTexture;
      uniform sampler2D bloomTexture;
      varying vec2 vUv;
      void main() {
        gl_FragColor = texture2D(baseTexture, vUv) + vec4(1.0) * texture2D(bloomTexture, vUv);
      }
    `,
  }),
  "baseTexture",
);
bloomCompositePass.needsSwap = true;
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
composer.addPass(bloomCompositePass);

(window as unknown as { __bloom: unknown }).__bloom = { bloomPass, BLOOM_SCENE };
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
// Story #330: Issue #292's toolbar-button lock/escape-hatch mechanism is
// removed - this button (like every other toolbar button) is always fully
// active and performs its normal action on every click, regardless of the
// motion player's time/play state.
searchToggle.addEventListener("click", () => searchDialog.show());

// Issue #164 introduced the "i" (Info) button in the old top-left row.
// Issue #201 moved the button itself (and its click wiring) down into the
// bottom-left toolbar (built alongside the other `createToolbarButton`
// calls below, Story #256: now `#left-toolbar`) - only the dialog
// instance/container stay created here, since nothing else in this row
// depends on it.
const infoDialog = new InfoDialog();
app.appendChild(infoDialog.element);

// The "S" (Simplifications and Sources) button's dialog - same pattern as
// `infoDialog` immediately above (container/instance created here, button
// itself built alongside the other `createToolbarButton` calls below).
const simplificationsDialog = new SimplificationsDialog();
app.appendChild(simplificationsDialog.element);

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

// The "S" (Simplifications and Sources) button - placed immediately after
// Info at the bottom of the toolbar, same `createToolbarButton` sizing as
// its neighbors, same non-icon single-glyph styling as Info's "i".
const simplificationsToggleButton = createToolbarButton(
  "simplifications-toggle",
  "S",
  "Simplifications and Sources",
);

// Story #275: the toolbar Play button (Story #239's `player-toggle`,
// Epic #255's item #13) is removed entirely - the motion player is now
// opened via the new "TIME CONTROLS" collapsed indicator
// (`playerCollapsedIndicator`, built alongside `playerPanelHandle` below)
// instead of a `#left-toolbar` icon. Story #308 removed that indicator's
// former Local-Bubble camera gating too - see `syncPlayerCollapsedIndicatorVisibility`'s
// own docstring.

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
/** Issue #10 (Epic #7): the `Group` `createCatalogObjectGroup` parents every
 * bucket's `InstancedMesh` under - kept as its own module binding (mirroring
 * every other layer group below) so `rebuildStarRenderLayer`'s live Settings-panel
 * toggle handler can remove/re-add just the star bucket's mesh from/to it,
 * without needing to rebuild (or re-`scene.add`) the whole catalog group. */
let catalogGroup: ReturnType<typeof createCatalogObjectGroup>["group"] | null = null;
let catalogObjects: SceneObject[] = [];
/** Issue #11 (Epic #7, Story 2/4): the currently-active REALWORLD star layer
 * (`scene/realworldStars.ts`), or `null` whenever `starRenderStyle` is
 * `MODEL` (REALWORLD's own `star`-type objects then have no on-screen
 * representation via THIS layer - `catalogBuckets`' own `star` `CatalogBucket`
 * entry, built by `buildStarCatalogBucket`, covers MODEL instead. The two are
 * mutually exclusive by construction - `rebuildStarRenderLayer` below always
 * tears down whichever one is currently active before building the other. */
let realworldStarLayer: RealworldStarLayer | null = null;
/** Issue #11: every `object_type === "star"` `SceneObject`, captured once at
 * scene-load time - the stable input BOTH `buildStarCatalogBucket` (MODEL)
 * and `buildRealworldStarLayer` (REALWORLD) build from on every style toggle.
 * Needed as its own binding (rather than reading `oldBucket.objects` the way
 * issue #10's original version of this rebuild function - then named
 * `rebuildStarBucket` - did) because a `CatalogBucket` for `star` doesn't
 * exist at all while REALWORLD is active - toggling FROM REALWORLD back TO
 * MODEL has no bucket to read the object list back out of. */
let starCatalogObjects: SceneObject[] = [];
let labelsInfo: ReturnType<typeof createLabelsLayer> | null = null;
let gouldBeltGroup: ReturnType<typeof createGouldBeltLayer> | null = null;
let radcliffeWaveGroup: ReturnType<typeof createRadcliffeWaveLayer> | null = null;
let localBubbleGroup: ReturnType<typeof createLocalBubbleLayer> | null = null;
/** Story #315: the four diffuse types' (`molecular_cloud`/`hii_region`/
 * `planetary_nebula`/`supernova_remnant`) extended-volume mesh layer - built
 * once, right alongside `catalogBuckets`, once the scene loads. `null` only
 * means "scene hasn't loaded yet" (unlike `gouldBeltGroup`/etc.'s `| null`,
 * which can also mean "this scene had no such structure" - every scene has
 * *some* catalog, so once loaded this is always a real, possibly-empty
 * layer, mirroring `velocityVectorsGroup`'s own convention). */
let diffuseStructureLayer: DiffuseStructureLayer | null = null;
/** Issue #138: the dense-batch collection-radius boundary shell - built
 * once, right after `denseBatchRadiusPc` below is computed from the loaded
 * scene data (see `denseBatchBoundary.ts`'s `createDenseBatchBoundaryLayer`
 * docstring for why this doesn't need per-frame geometry rebuilding the
 * way `sunMarker.core` does). `null` until the scene loads, and stays
 * `null` thereafter if no dense-batch member was present (radius 0). */
let denseBatchBoundaryMesh: ReturnType<typeof createDenseBatchBoundaryLayer> | null = null;

/** Issue #231: the velocity-vectors layer - built once, right alongside
 * `denseBatchBoundaryMesh` above, once the scene has loaded. Always a real
 * (possibly empty) `{ group, handles }` once built (see
 * `createVelocityVectorsLayer`'s docstring for why this differs from the
 * optional `structures.*` layers' `| null` convention) - `null` here only
 * means "scene hasn't loaded yet". Story #301: `.handles` is what
 * `applyVelocityVectorScale` (called every frame from `animate()`) re-scales
 * as the camera moves; `.group` is what gets added to the scene/toggled
 * `.visible`, same as before. */
let velocityVectorsGroup: ReturnType<typeof createVelocityVectorsLayer> | null = null;

/** Issue #236: the density-controlled per-arrow speed labels ("31.5 km/s")
 * - built once, right alongside `velocityVectorsGroup` above, once the
 * scene has loaded. `null` only means "scene hasn't loaded yet"; once built,
 * `updateLabelVisibility` drives which subset (if any) is actually visible
 * each frame - see that function's own new speed-label block. */
let velocitySpeedLabelsInfo: ReturnType<typeof createVelocitySpeedLabelsLayer> | null = null;

/** Issue #231: the user's own ON/OFF intent for the velocity-vectors toggle.
 * Story #308 (Epic #306): the toggle is no longer gated by camera position at
 * all (`velocityVectorsButton` is never `disabled` for that reason, and this
 * is never force-reset by camera movement) - vectors work anywhere in the
 * scene with velocity data, so this plain ON/OFF flag, driven only by the
 * button's own click handler, is now the whole story. */
let velocityVectorsOn = false;

/** Story #239: the motion player's own state - `main.ts` is the single
 * source of truth for all of it; `playerPanelHandle` (built just below) is
 * a stateless view pushed into via `.update()`/`.setVisible()` each frame
 * or on a relevant event, never read from directly (see `ui/playerPanel.ts`'s
 * own docstring). `playerTimeYears` is always kept within Epic #238's
 * settled `+/-1,000,000`-year range via `clampPlayerTimeYears`/
 * `advancePlayerTimeYears` - every one of this module's own write sites
 * below routes through one of those two. */
let playerTimeYears = 0;
let playerPlaying = false;
let playerPanelOpen = false;

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
 * `starsWithVelocity` - Story #287: renamed from `starsWithVelocityInSphere`
 * to `starsWithVelocityInLocalBubble` and widened from the ~127-star RECONS
 * sphere to the ~156-star Local Bubble; Story #308: renamed again and
 * widened further to every star with velocity data anywhere in the scene -
 * reused directly, never reimplemented), their `id -> (bucket, index)`
 * lookup (`objects.ts`'s
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
 * pre-#257 `panelHandle` this replaces). `getSidePanelHandle` below guards
 * every use with a null check. */
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
  // further below, but hoisted) as the single source of truth for "reset to
  // Today". Story #330: the toolbar-button escape hatch that used to also
  // call this is removed - this panel's own Today button is now the only
  // caller.
  onToday: () => resetPlayerToToday(),
  // Story #275: overrides #267's original choice (which reused the toolbar
  // Play button's own close+reset-to-Today action). The human owner's
  // described flow requires the collapse chevron to be a genuine MINIMIZE
  // now - it hides the expanded panel and reveals the "TIME CONTROLS"
  // collapsed indicator again, but leaves `playerTimeYears`/`playerPlaying`/
  // `playerRateSliderValue` completely untouched. Story #308: nothing else
  // resets those anymore either - the former Local-Bubble-exit force-reset
  // is removed, so only the panel's own explicit controls (Today, a scrub,
  // Play reaching Today) ever change that state now.
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
 * below - Story #308 (Epic #306) removed the Local-Bubble camera gating this
 * used to also require, so it's now visible anywhere in the scene, mutually
 * exclusive with the expanded panel via `playerPanelOpen` alone - never
 * toggled directly at any other call site. */
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

/** Issue #10 (Epic #7): `window.localStorage` guarded by a `try/catch` at
 * the single point this app touches it - accessing the property itself (not
 * just calling a method on it) can throw in some restrictive browser privacy
 * configurations. `null` degrades every persistence call below to "use the
 * in-memory default only, don't persist" per this codebase's existing
 * "missing optional capability degrades gracefully" convention (spec §38). */
function browserLocalStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

/** Issue #10 (Epic #7): the active MODEL/REALWORLD star-rendering style -
 * loaded once, up front, from whatever was previously persisted (or the
 * `MODEL` default on a first visit / failed read). `settingsPanelHandle`'s
 * "Star Rendering" `<select>` (built once the scene loads, like the rest of
 * that panel) is preselected from this same value, and its `onChange`
 * handler below is what reassigns this binding afterward. */
let starRenderStyle: StarRenderStyle = loadStarRenderStyle(browserLocalStorage());

/** Issue #10 (Epic #7), rewritten by issue #11: rebuilds JUST the star
 * rendering layer in place, using the CURRENT `starRenderStyle` - the
 * Settings-panel toggle's live-switch mechanism, no full page reload needed.
 *
 * Issue #11 widened this from issue #10's original "swap the `star`
 * `CatalogBucket`'s `InstancedMesh`" (both styles used one) to "tear down
 * whichever of the two mutually-exclusive star systems is currently active,
 * then build whichever the new style calls for" - REALWORLD is no longer an
 * `InstancedMesh`/`CatalogBucket` at all (see `objects.ts`'s
 * `buildStarCatalogBucket` docstring and `realworldStars.ts`'s own module
 * docstring for why). Reads the stable `starCatalogObjects` list (captured
 * once at scene-load time) rather than an existing bucket's own `.objects` -
 * unlike issue #10's original version, this must work even when NEITHER a
 * `CatalogBucket` nor a `RealworldStarLayer` currently exists for stars
 * (toggling FROM REALWORLD back TO MODEL has no bucket to read the object
 * list back out of).
 *
 * Deliberately does NOT rebuild the whole catalog group (i.e. does not call
 * `createCatalogObjectGroup` again from scratch): every OTHER bucket's
 * material may currently be in a dimmed state
 * (`applyBackgroundDimming`'s change-detected `updateBackgroundDimming`
 * call, driven by `cameraWasInsideDenseBatchSphere`/
 * `cameraWasInsideLocalBubbleRaw`, which only fire on a camera-position
 * *transition* - not on every frame) - a full rebuild would silently reset
 * every non-star bucket back to its undimmed default material until the
 * camera next crosses a dimming boundary. Rebuilding only the star layer
 * (which `updateBackgroundDimming` never dims in the first place - see
 * `objects.ts`'s `shouldDimBackground`) sidesteps that risk entirely.
 *
 * No-op if the scene hasn't finished loading yet (`catalogGroup === null`)
 * or the catalog has no stars at all (shouldn't happen for a real scene, but
 * mirrors `buildStarCatalogBucket`'s/`buildRealworldStarLayer`'s own
 * empty-input guards returning `null`). */
function rebuildStarRenderLayer(): void {
  if (!catalogGroup) return;
  if (starCatalogObjects.length === 0) return;

  // Tear down whichever of the two mutually-exclusive systems is currently
  // active - see this function's own docstring on why both must be handled
  // (either could be the "old" one being switched away from).
  const starBucketIndex = catalogBuckets.findIndex((bucket) => bucket.objectType === "star");
  if (starBucketIndex !== -1) {
    catalogGroup.remove(catalogBuckets[starBucketIndex].mesh);
    catalogBuckets = [
      ...catalogBuckets.slice(0, starBucketIndex),
      ...catalogBuckets.slice(starBucketIndex + 1),
    ];
  }
  if (realworldStarLayer) {
    catalogGroup.remove(realworldStarLayer.points);
    disposeRealworldStarLayer(realworldStarLayer);
    realworldStarLayer = null;
  }

  if (starRenderStyle === "REALWORLD") {
    const newLayer = buildRealworldStarLayer(starCatalogObjects);
    if (newLayer) {
      newLayer.points.layers.enable(BLOOM_SCENE); // PROTOTYPE: selective bloom
      catalogGroup.add(newLayer.points);
      realworldStarLayer = newLayer;
    }
  } else {
    const newBucket = buildStarCatalogBucket(
      starCatalogObjects,
      denseBatchRadiusPc,
      bubbleOuterRadiusPc,
      starRenderStyle,
    );
    if (newBucket) {
      catalogGroup.add(newBucket.mesh);
      catalogBuckets = [...catalogBuckets, newBucket];
    }
  }

  // Story #239's id -> (bucket, index) lookup holds direct bucket
  // references, which just changed for every star id under MODEL - rebuilt
  // wholesale here (cheap, well under a thousand entries, and only on this
  // rare user-triggered toggle, never per frame) rather than patched in
  // place. Under REALWORLD this simply has no `star` entries at all (see
  // `realworldStarLayer`'s own docstring on the resulting motion-player
  // limitation).
  objectIndexLookup = buildObjectIndexLookup(catalogBuckets);

  // Reapplies category-visibility/radius-filter/size-scale/camera-distance
  // LOD-radius state to the freshly-built instances (a brand new
  // `InstancedMesh`/`RealworldStarLayer` starts with every star at its raw
  // baked-in size, not yet filtered) - the same chokepoint every other
  // filter change already runs through, so this can never disagree with
  // what's currently supposed to be on screen.
  applyCatalogVisibility();
}

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
  // Story #315: the diffuse-structure layer isn't a `CatalogBucket` (no
  // `InstancedMesh`, so `updateCatalogVisibility`/`updateCatalogSizeScale`
  // above never touch it) - its own category-toggle/radius-filter
  // visibility and "Object size" slider scaling are applied here instead,
  // from the exact same chokepoint every other catalog-visibility change
  // already runs through, so the two mechanisms can never disagree. The
  // "Object size" slider is applied at the whole-group level (matching
  // `updateCatalogSizeScale`'s own per-bucket-`Object3D.scale` approach)
  // rather than per-mesh, since every diffuse-structure mesh shares one
  // parent group.
  if (diffuseStructureLayer) {
    updateDiffuseStructureVisibility(diffuseStructureLayer, categoryVisibility, radiusPc);
    diffuseStructureLayer.group.scale.setScalar(sizeScale);
  }
  // Issue #11 (Epic #7): REALWORLD's star layer is likewise not a
  // `CatalogBucket` - its own category-toggle/radius-filter visibility and
  // "Object size" slider scaling are applied from this same chokepoint,
  // mirroring the diffuse-structure layer immediately above. Only ever
  // non-null while `starRenderStyle === "REALWORLD"` (see its own
  // docstring), so this is a no-op under MODEL.
  if (realworldStarLayer) {
    updateRealworldStarVisibility(realworldStarLayer, categoryVisibility, radiusPc);
    updateRealworldStarSizeScale(realworldStarLayer, sizeScale);
  }
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
 * zoom limit to feed into.
 *
 * Issue #300: also passes `bubbleOuterRadiusPc` (`null` until the scene
 * loads, same as everywhere else this module threads it through) so the
 * Sun's own curve picks up the widened Local-Bubble-relative shrink-start
 * threshold exactly like every star's does - see `sunCoreRadiusPc`'s own
 * docstring. */
function applySunCoreScale(): void {
  sunMarker.core.scale.setScalar(sunCoreRadiusPc(camera.position.length(), denseBatchRadiusPc, bubbleOuterRadiusPc));
}

/** Story #301: the last camera-scale-relative arrow factor
 * (`velocityVectors.ts`'s `currentArrowScaleFactor`) actually applied to the
 * velocity-vector arrows/speed labels - change-detection for
 * `applyVelocityVectorScale` below, mirroring `applyBackgroundDimming`'s own
 * crossing-detection philosophy just below it. `-1` is never a real
 * `currentArrowScaleFactor` result (always `>= 0`), so the very first call
 * always applies regardless of the camera's starting distance. */
let lastAppliedArrowScaleFactor = -1;

/** Story #301: re-scales every velocity-vector arrow's length (and its
 * matching speed label's tip position) to the camera's CURRENT distance
 * each frame - reuses the exact same `denseBatchRadiusPc`/
 * `bubbleOuterRadiusPc` pair `applyDenseBatchLod`/`applySunCoreScale` above
 * already benchmark against every frame, rather than recomputing either
 * independently, per this Story's own explicit instruction.
 *
 * Change-detected against `lastAppliedArrowScaleFactor`: `currentArrowScaleFactor`
 * is flat (unchanging) both at/inside the RECONS sphere and beyond the
 * Local Bubble's open-space ceiling (`currentViewScalePc`'s own segment 1/
 * flat-ceiling shape - see that function's docstring), so a stationary or
 * RECONS-sphere-confined camera skips this entirely most frames rather than
 * re-touching all ~156 arrows' geometry unconditionally - cheap either way
 * at this population size, but this keeps the cost proportional to actual
 * camera movement through the scale-relevant zone, matching this file's
 * existing "only touch geometry on frames that actually changed something"
 * convention (`applyBackgroundDimming`'s own crossing-detection). */
function applyVelocityVectorScale(): void {
  if (!velocityVectorsGroup) return;
  const cameraDistancePc = camera.position.length();
  const scaleFactor = currentArrowScaleFactor(cameraDistancePc, denseBatchRadiusPc, bubbleOuterRadiusPc);
  if (scaleFactor === lastAppliedArrowScaleFactor) return;
  lastAppliedArrowScaleFactor = scaleFactor;

  updateVelocityVectorsScale(velocityVectorsGroup.handles, cameraDistancePc, denseBatchRadiusPc, bubbleOuterRadiusPc);
  if (velocitySpeedLabelsInfo) {
    updateVelocitySpeedLabelPositions(
      velocitySpeedLabelsInfo.labels,
      cameraDistancePc,
      denseBatchRadiusPc,
      bubbleOuterRadiusPc,
    );
  }
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
 * Issue #227: `cameraWasInsideLocalBubbleRaw` alongside it tracks the same
 * thing for the new, larger Local Bubble boundary - both are checked so a
 * crossing of EITHER boundary (not just the sphere's) triggers a re-apply
 * below. */
let cameraWasInsideDenseBatchSphere = false;
/** Real (raw), un-widened, camera-distance "inside the Local Bubble" value
 * as of the last frame `applyBackgroundDimming` actually ran its
 * dimming-tier calls (`updateBackgroundDimming`/`setGouldBeltDimmed`/
 * `setRadcliffeWaveDimmed`/`setLocalBubbleDimmed`) - the sole
 * change-detection value guarding those calls, so they only re-run on an
 * actual real-camera-distance boundary crossing. Written ONLY inside
 * `applyBackgroundDimming` below, immediately before the dimming-tier calls
 * it guards.
 *
 * Story #308 (Epic #306): this binding, and the dimming-tier calls it
 * guards, are UNCHANGED by this Story - only the separate Vectors/player
 * gating mechanism this used to be paired with (issue #290's EFFECTIVE,
 * override-widened `cameraWasInsideLocalBubble` counterpart, and everything
 * that fed it: `bubbleViewOverrideActive`, `applyLocalBubbleGateState`,
 * `clearBubbleViewOverride`, `applyVelocityVectorsButtonState`,
 * `applyPlayerSphereState`) is removed, since vectors/player are no longer
 * gated to the Local Bubble at all. This is exactly the split PR #291's own
 * bug fix established: the dimming tiers stay keyed to the real, un-widened
 * camera distance regardless of anything else in this file. */
let cameraWasInsideLocalBubbleRaw = false;

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

/** Story #239 (panel's own Today button): resets the player to Today - the
 * exact previous inline body of the panel's `onToday` callback
 * (`setPlayerPlaying(false); playerTimeYears = 0`), extracted here as the
 * single shared implementation, matching this codebase's established
 * single-source-of-truth convention (e.g. `setPlayerPlaying` itself).
 * Story #330: Issue #292's locked-toolbar-button escape hatch, the other
 * former caller, is removed - this panel's own Today button is now the only
 * caller. */
function resetPlayerToToday(): void {
  setPlayerPlaying(false);
  playerTimeYears = 0;
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
 * exactly when the expanded panel is NOT open - the "only one of {collapsed
 * indicator, expanded panel} is ever visible at a time" requirement. Story
 * #308 (Epic #306): no longer also gated on camera position (the indicator
 * used to be sphere-gated via a since-removed `playerInsideSphere` flag) -
 * Time Controls are available anywhere in the scene now, so `playerPanelOpen`
 * alone decides which of the two is showing. Called from every site that
 * changes `playerPanelOpen` (the indicator's own click handler above,
 * `collapsePlayerPanel` below) rather than being folded into any one of
 * them, since more than one of those sites needs to trigger this same
 * recomputation. */
function syncPlayerCollapsedIndicatorVisibility(): void {
  playerCollapsedIndicator.classList.toggle("visible", !playerPanelOpen);
}

/** Story #275: the player panel's own collapse chevron handler - a genuine
 * MINIMIZE, overriding #267's original "reuse the toolbar button's own
 * close+reset-to-Today action" choice (that action, `closePlayerPanelAndResetToToday`,
 * is removed - nothing else called it once the toolbar button itself was
 * removed). Hides the expanded panel and reveals the collapsed indicator
 * again, WITHOUT touching `playerTimeYears`/`playerPlaying`/
 * `playerRateSliderValue` at all. Story #308 (Epic #306): this is now the
 * ONLY way the panel closes on its own - the former sphere-exit force-reset
 * (`applyPlayerSphereState`) that also used to close/reset it on leaving the
 * Local Bubble is removed; Time Controls now stay exactly as the user left
 * them regardless of camera position. */
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
    velocityVectorsGroup.group.visible = false;
  }
}

/** Story #330: removes Issue #292/Story #247's entire toolbar-button
 * lock/escape-hatch mechanism (`syncUiLock`, `setToolbarButtonLocked`,
 * `withLockedButtonEscapeHatch`, `TOOLBAR_BUTTON_DEFAULT_LABEL`,
 * `LOCKED_BUTTON_ESCAPE_HATCH_LABEL`, the `layersPanelHandle.setLocked`/
 * `settingsPanelHandle.setLocked` calls, and the `.toolbar-button--locked`
 * CSS treatment) - confirmed decision: all `#left-toolbar` buttons and the
 * Layers/Settings side-panel controls are now always fully active and
 * perform their normal action immediately, regardless of the motion
 * player's current time or play/pause state. `ControlPanel`'s `setLocked`
 * method (`ui/controls.ts`) is removed too, since this was its only caller.
 *
 * The one SEPARATE, still-active consumer of the underlying
 * `isUiLockedForPlayerTime` condition is the canvas star-click/
 * Inspector-select gate (Story #239 AC #9, explicitly out of scope for this
 * Story per its own text) - see the `renderer.domElement` `click` listener
 * further below, which now recomputes `isUiLockedForPlayerTime(playerTimeYears)`
 * inline rather than reading a shared `uiLocked` flag maintained by this
 * function, since that flag has no other remaining reason to exist. */

/** Story #239 AC #8's original "sync the player's gated visibility state and
 * force-reset it on leaving the gating volume" behavior
 * (`applyPlayerSphereState`, mirroring `applyVelocityVectorsButtonState`)
 * is removed as of Story #308 (Epic #306): the player is no longer gated to
 * the Local Bubble, so there is no camera-driven force-reset left - Time
 * Controls stay exactly as the user left them (open/closed, playing/paused,
 * whatever time they scrubbed to) as the camera moves anywhere in the
 * scene. Only the panel's own controls (Today, a scrub, Play reaching
 * Today, the collapse chevron) change that state now - see
 * `collapsePlayerPanel`'s own docstring above. */

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
  // `motionTrail.ts`'s `starTrailPositionsPc` still wants the current
  // playback direction as its own `PlayerDirection` sign - derived here from
  // the signed rate value rather than tracked as separate state.
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
  // Story #302 (Epic #299's final Story): the trail's fixed simulated-time
  // window (`motionTrail.ts`'s `TRAIL_WINDOW_YEARS`), scaled by the SAME
  // `denseBatchRadiusPc`/`bubbleOuterRadiusPc` pair every other per-frame LOD
  // effect in this file already benchmarks against (`applyDenseBatchLod`/
  // `applySunCoreScale`/`applyVelocityVectorScale`) - exactly
  // `TRAIL_WINDOW_YEARS` at/inside the RECONS sphere (today's exact trail
  // length, reproduced bit-for-bit - see `currentTrailWindowYears`'s own
  // docstring and this Story's RECONS-exact-reproduction test), growing
  // smoothly beyond it so trails read as longer, clearly visible tails at
  // Local Bubble zoom. Computed once per frame here (not change-detected
  // like `applyVelocityVectorScale`'s `lastAppliedArrowScaleFactor`): unlike
  // that function's per-arrow `ConeGeometry` rebuild, this loop's own
  // `updateStarTrail` call already fully rewrites every visible trail's
  // position buffer every frame regardless (driven by `playerTimeYears`
  // advancing during playback), so this is one cheap extra scalar
  // computation riding along on work that already happens, not a new
  // per-frame cost class.
  const trailWindowYears = currentTrailWindowYears(cameraDistancePc, denseBatchRadiusPc, bubbleOuterRadiusPc);
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
          starTrailPositionsPc(
            obj.position_pc,
            obj.velocity,
            playerTimeYears,
            playerRateDirection,
            trailWindowYears,
          ),
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
 * `cameraWasInsideLocalBubbleRaw` above), so this is cheap enough to call
 * unconditionally every frame alongside `applyDenseBatchLod`/
 * `applySunCoreScale`.
 *
 * Deliberately never touches the star bucket (`updateBackgroundDimming`'s
 * own `shouldDimBackground` excludes it) or any dense-batch star instance -
 * the RECONS nearby stars this issue spotlights are completely unaffected by
 * this function, satisfying #137's explicit constraint against any
 * per-instance star-opacity change.
 *
 * Story #308 (Epic #306): this function used to ALSO be the per-frame
 * chokepoint for the Vectors/player Local-Bubble gate (issue #290's
 * EFFECTIVE, override-widened `cameraWasInsideLocalBubble` branch, routed
 * through `applyLocalBubbleGateState`) - removed entirely now that vectors/
 * player are no longer gated to the Local Bubble. This function's dimming-
 * tier logic below is otherwise completely unchanged, per this Story's
 * explicit "do not touch the dimming-tier visuals" scope. */
function applyBackgroundDimming(): void {
  const cameraDistancePc = camera.position.length();
  const insideSphere = isCameraInsideDenseBatchSphere(cameraDistancePc, denseBatchRadiusPc);
  const insideBubble = isCameraInsideLocalBubble(cameraDistancePc, bubbleOuterRadiusPc);

  if (insideSphere !== cameraWasInsideDenseBatchSphere || insideBubble !== cameraWasInsideLocalBubbleRaw) {
    cameraWasInsideDenseBatchSphere = insideSphere;
    cameraWasInsideLocalBubbleRaw = insideBubble;

    updateBackgroundDimming(catalogBuckets, insideSphere, insideBubble);
    setGouldBeltDimmed(gouldBeltGroup, insideSphere, insideBubble);
    setRadcliffeWaveDimmed(radcliffeWaveGroup, insideSphere, insideBubble);
    setLocalBubbleDimmed(localBubbleGroup, insideSphere);
    // Story #315: the diffuse-structure meshes get the exact same
    // three-tier treatment every other non-star catalog bucket already
    // gets (see `diffuseStructures.ts`'s `updateDiffuseStructureDimming`
    // docstring for why reusing `backgroundBucketOpacity` verbatim here
    // keeps their dimming behavior visually unchanged across this Story's
    // rendering-mode switch).
    if (diffuseStructureLayer) {
      updateDiffuseStructureDimming(diffuseStructureLayer, insideSphere, insideBubble);
    }
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
 * depends on it, see that function's docstring.
 *
 * PR #321 Validator-found regression fix: `star_cluster`/`stellar_association`
 * (`objects.ts`'s `CLUSTER_OBJECT_TYPES`) are special-cased here, BEFORE
 * falling through to `selectedMarkerRadiusPc`, because Story #320 moved
 * their actual rendering out of the generic `InstancedMesh` point-marker
 * buckets `selectedMarkerRadiusPc`/`markerRadiusPc` describe and into
 * `diffuseStructureLayer`'s own shapes instead (see
 * `DIFFUSE_STRUCTURE_OBJECT_TYPES`) - but never updated the reticle's own
 * radius source to match, leaving it stuck on the stale pre-#320 point-marker
 * tier formula. `clusterOrAssociationShapeRadiusPc` (`diffuseStructures.ts`)
 * is the exact same radius computation `createDiffuseStructureLayer` uses to
 * build these two types' actual proxy/shape, so the reticle can no longer
 * drift out of sync with what's really on screen. Every other object type
 * (including every other `DIFFUSE_STRUCTURE_OBJECT_TYPES` member -
 * `molecular_cloud`/`hii_region`/`supernova_remnant`/`planetary_nebula`,
 * none of which changed radius source in Story #320) is unaffected, still
 * falling straight through to `selectedMarkerRadiusPc` exactly as before. */
function selectedObjectMarkerRadiusPc(obj: SceneObject): number {
  if (CLUSTER_OBJECT_TYPES.has(obj.object_type)) {
    return clusterOrAssociationShapeRadiusPc(obj);
  }
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
  // own gate is `velocityVectorsGroup.visible` itself - Story #308: now
  // simply the toggle's own ON/OFF state, via `velocityVectorsVisible` -
  // reusing that live boolean directly here guarantees speed labels can
  // never be visible while their arrows aren't (no orphans) and always
  // recompute on this same per-frame `animate()` cadence the arrows' own
  // visibility already does, with no second RAF hook).
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
    // toggle-ON gate the arrows use, reused directly so speed labels can
    // never be visible while their arrows aren't).
    const speedLabelCandidates = velocitySpeedLabelsInfo.labels.map((label) => ({
      objectId: label.objectId,
      cameraDistancePc: camera.position.distanceTo(label.css2dObject.position),
    }));
    const visibleSpeedLabelIds = selectVisibleVelocitySpeedLabelIds(
      speedLabelCandidates,
      velocityVectorsGroup?.group.visible ?? false,
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
  const bucketPositions = visibleCatalogObjects(
    catalogBuckets,
    categoryVisibility,
    radiusPc,
    camera.position.length(),
    denseBatchRadiusPc,
  ).map((obj): [number, number, number] => obj.position_pc);
  // Story #315: the four diffuse types no longer live in `catalogBuckets`
  // (they're `diffuseStructureLayer`'s individual meshes now), so
  // `visibleCatalogObjects` above can no longer see them - without this,
  // "Fit all"/"Show all" framing would silently stop accounting for ~19
  // catalog objects it used to include. `visibleDiffuseStructureObjects`
  // applies the exact same category/radius-filter visibility rule.
  const diffusePositions = diffuseStructureLayer
    ? visibleDiffuseStructureObjects(diffuseStructureLayer, categoryVisibility, radiusPc).map(
        (obj): [number, number, number] => obj.position_pc,
      )
    : [];
  // Issue #11 (Epic #7): mirrors the diffuse-structure union just above -
  // REALWORLD's stars likewise aren't in `catalogBuckets`, so without this
  // "Fit all"/"Show all" framing would silently exclude every star (~707 of
  // them) the moment REALWORLD is active. Only ever non-empty under
  // REALWORLD (see `realworldStarLayer`'s own docstring).
  const realworldStarPositions = realworldStarLayer
    ? visibleRealworldStarObjects(realworldStarLayer, categoryVisibility, radiusPc).map(
        (obj): [number, number, number] => obj.position_pc,
      )
    : [];
  return [...bucketPositions, ...diffusePositions, ...realworldStarPositions];
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
}

/** Issue #197: keeps `fitLocalBubbleButton` disabled whenever the loaded
 * scene has no Local Bubble layer (`localBubbleStructure === null`, either
 * because the scene hasn't loaded yet or because that optional layer was
 * absent/malformed - spec §38) rather than leaving it clickable into a
 * no-op or, worse, an error. This is a structural/gating condition, unrelated
 * to the motion player's time - Story #330 removed the other, player-time-
 * driven reason this button used to also go visually "locked" (Issue #292's
 * toolbar lock mechanism), so this is now the only condition affecting this
 * button's state. */
function applyLocalBubbleButtonState(): void {
  fitLocalBubbleButton.disabled = localBubbleStructure === null;
}

applyLocalBubbleButtonState();
// Story #308: the velocity-vectors toggle and the motion player's own
// controls used to also need an explicit startup call here
// (`applyVelocityVectorsButtonState(false)`/`applyPlayerSphereState(false)`,
// Issue #231/Story #239) to seed their camera-gated `disabled`/visibility
// state before the first real frame. `velocityVectorsButton` needs no
// replacement - it's never `disabled` for a camera-position reason anymore,
// so its own initial DOM state (not disabled) is already correct. The
// player's collapsed indicator still needs an explicit seed call, now just
// for `playerPanelOpen` (`false` at startup) rather than a camera check.
syncPlayerCollapsedIndicatorVisibility();

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

// Story #330: Issue #292's `withLockedButtonEscapeHatch` wrapping (which
// used to reset the player to Today on the first click instead of performing
// the button's normal action, whenever `syncUiLock`'s lock was active) is
// removed from all of the following, plus `velocityVectorsButton`'s own
// handler further below - every click now calls its normal action directly
// and unconditionally, regardless of the motion player's time/play state.
zoomInButton.addEventListener("click", () => zoomBy(ZOOM_IN_STEP_FACTOR));
zoomOutButton.addEventListener("click", () => zoomBy(ZOOM_OUT_STEP_FACTOR));
showAllButton.addEventListener("click", () => applyCameraPreset("fit-all"));
// Issue #290's persistent `bubbleViewOverrideActive` override (set here,
// after the pose above, so Vectors/TIME CONTROLS would activate right away
// from this button's ~317pc whole-bubble framing rather than waiting on a
// real per-frame distance check that would never trip from that pose) is
// removed as of Story #308: there is no Vectors/player gate left for this
// button to override, so its click handler is now just the camera framing
// itself.
fitLocalBubbleButton.addEventListener("click", applyFitLocalBubblePose);
fitNearestStarsButton.addEventListener("click", applyFitNearestStarsPose);
// Story #308: this button is no longer ever `disabled` for a camera-position
// reason (Issue #231's original `cameraWasInsideLocalBubble`-gated
// `disabled` check is removed), so a click always just toggles the layer's
// visibility directly.
velocityVectorsButton.addEventListener("click", () => {
  velocityVectorsOn = !velocityVectorsOn;
  velocityVectorsButton.setAttribute("aria-pressed", String(velocityVectorsOn));
  velocityVectorsButton.classList.toggle("active", velocityVectorsOn);
  if (velocityVectorsGroup) {
    velocityVectorsGroup.group.visible = velocityVectorsVisible(velocityVectorsOn);
  }
});
// Story #275: the toolbar Play button's own click handler (Story #239's
// original open/close toggle, Story #245's "first press only reveals,
// never auto-starts" refinement, Story #249's "second press closes and
// resets" behavior) is removed along with the button itself -
// `playerCollapsedIndicator`'s own click handler (built alongside
// `playerPanelHandle` above) now owns the "reveal, never auto-start" first
// action, and `collapsePlayerPanel` (the panel's own collapse chevron, per
// Part 2's behavior change) owns minimizing back to the indicator. Story
// #308: leaving the Local Bubble no longer resets/closes it either - see
// `collapsePlayerPanel`'s own docstring.
infoToggleButton.addEventListener("click", () => infoDialog.show());
simplificationsToggleButton.addEventListener("click", () => simplificationsDialog.show());

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
    // `velocityVectorsButton`'s own click handler is what turns it on/off
    // from here on (Story #308 removed the former Local-Bubble camera gate
    // that also used to drive this). Its POPULATION is every star with
    // velocity data (`starsWithVelocity`, Story #308) - `bubbleOuterRadiusPc`
    // is still passed through here, but now purely for the arrows'
    // camera-scale-relative LENGTH (`currentArrowScaleFactor`), unrelated to
    // which stars get an arrow at all.
    //
    // Story #301: also passes `camera.position.length()`/`denseBatchRadiusPc`
    // now, so each arrow's initial length is already camera-scale-relative
    // as of this exact moment - `applyVelocityVectorScale()` (called from
    // `animate()`, alongside `applySunCoreScale()`) keeps every arrow's
    // length current as the camera moves from here on, via the `handles`
    // this now returns alongside `group`.
    velocityVectorsGroup = createVelocityVectorsLayer(
      sceneData.objects,
      camera.position.length(),
      denseBatchRadiusPc,
      bubbleOuterRadiusPc,
    );
    scene.add(velocityVectorsGroup.group);

    // Issue #236: the speed-label pool for those same arrows - built once
    // here too. Every label starts life un-toggled either way (visibility
    // is driven entirely by `updateLabelVisibility`'s new speed-label block,
    // called right after this `.then()` finishes below, before the first
    // real frame renders). Story #287: widened alongside the arrows layer
    // above.
    //
    // Story #301: also passes `camera.position.length()`/`denseBatchRadiusPc`
    // - see `velocityVectorsGroup`'s own construction just above for why;
    // `applyVelocityVectorScale()` keeps each label's tip position current
    // alongside its arrow's length from here on.
    velocitySpeedLabelsInfo = createVelocitySpeedLabelsLayer(
      sceneData.objects,
      camera.position.length(),
      denseBatchRadiusPc,
      bubbleOuterRadiusPc,
    );
    scene.add(velocitySpeedLabelsInfo.group);

    // Story #315 (extended to Story #320): every
    // `DIFFUSE_STRUCTURE_OBJECT_TYPES` record is excluded from the objects
    // handed to `createCatalogObjectGroup` here - each gets its own
    // extended-volume treatment (`diffuseStructureLayer` below) instead of a
    // point-marker `InstancedMesh` bucket, and rendering both at once would
    // double-draw the same real object. `createCatalogObjectGroup` itself
    // stays completely generic/unmodified (still fully exercised by its own
    // existing tests against arbitrary object types) - the exclusion
    // happens here at the call site, the same place
    // `excludeDedicatedMarkerObjects` already filters out the Sun/
    // Local-Bubble-centroid before this same call. Story #320 grew
    // `DIFFUSE_STRUCTURE_OBJECT_TYPES` to also cover `star_cluster`/
    // `stellar_association` (previously point markers under Epic #313's
    // original scope, now rendered exclusively through
    // `diffuseStructures.ts`'s own shapes) - since this filter is driven by
    // that one shared set, no second exclusion list needed updating here.
    const pointMarkerObjects = sceneData.objects.filter(
      (obj) => !DIFFUSE_STRUCTURE_OBJECT_TYPES.has(obj.object_type),
    );
    const catalogLayer = createCatalogObjectGroup(
      pointMarkerObjects,
      denseBatchRadiusPc,
      bubbleOuterRadiusPc,
      starRenderStyle,
    );
    catalogBuckets = catalogLayer.buckets;
    // Issue #10 (Epic #7): kept as its own module binding (see its
    // declaration) so `rebuildStarRenderLayer`'s live Settings-panel toggle
    // handler can add/remove just the star bucket's mesh from it later.
    catalogGroup = catalogLayer.group;
    scene.add(catalogGroup);

    // Issue #11 (Epic #7): the stable star-object list `rebuildStarRenderLayer`
    // reuses on every future style toggle - see its own declaration's
    // docstring for why this can't just be read back out of a `CatalogBucket`
    // (REALWORLD has none).
    starCatalogObjects = pointMarkerObjects.filter((obj) => STAR_OBJECT_TYPES.has(obj.object_type));
    // Issue #11: `createCatalogObjectGroup`/`buildStarCatalogBucket` above
    // already skip building a `star` `CatalogBucket` at all when
    // `starRenderStyle === "REALWORLD"` (see that function's docstring) -
    // this is the initial build of REALWORLD's own separate `Points` layer
    // for that case, mirroring `rebuildStarRenderLayer`'s own REALWORLD
    // branch exactly (kept in sync deliberately, not by sharing code, since
    // this one-time initial build has no "old layer to tear down first" step
    // that function needs).
    if (starRenderStyle === "REALWORLD") {
      const initialRealworldLayer = buildRealworldStarLayer(starCatalogObjects);
      if (initialRealworldLayer) {
        initialRealworldLayer.points.layers.enable(BLOOM_SCENE); // PROTOTYPE: selective bloom
        catalogGroup.add(initialRealworldLayer.points);
        realworldStarLayer = initialRealworldLayer;
      }
    }

    // Story #315 (extended to Story #320): the extended-volume layer for
    // every `DIFFUSE_STRUCTURE_OBJECT_TYPES` type - built from the FULL,
    // unfiltered `sceneData.objects` (it does its own type filtering
    // internally, see `createDiffuseStructureLayer`).
    diffuseStructureLayer = createDiffuseStructureLayer(sceneData.objects);
    scene.add(diffuseStructureLayer.group);

    // Story #239: the id -> (bucket, index) lookup the motion player's
    // per-frame animation loop needs, built ONCE here (well before any
    // player session starts) rather than scanned per animated star per
    // frame - see `objects.ts`'s `buildObjectIndexLookup` docstring.
    objectIndexLookup = buildObjectIndexLookup(catalogBuckets);
    // The animated population itself - Epic #229's/#231's own
    // `starsWithVelocity` (Story #287: renamed from `starsWithVelocityInSphere`
    // and widened from `denseBatchRadiusPc` to `bubbleOuterRadiusPc`; Story
    // #308: renamed again and widened to every star with velocity data
    // anywhere in the scene), reused directly rather than reimplemented, per
    // this Story's explicit instruction.
    animatedStars = starsWithVelocity(sceneData.objects);

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
      categories: categories.map((type) => ({
        key: type,
        label: pluralizeCategoryLabel(humanizeCategory(type)),
      })),
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
      starRenderStyle,
      onStarRenderStyleChange: (style) => {
        starRenderStyle = style;
        saveStarRenderStyle(style, browserLocalStorage());
        rebuildStarRenderLayer();
      },
    });

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
      onExportPng: () => {
        // Render both the WebGL canvas and re-sync the label layer just
        // before capture so the exported PNG reflects the current view
        // (label text itself is DOM/CSS2D, outside the canvas, and is not
        // part of the PNG - spec §39 asks for "at minimum" a WebGL PNG
        // screenshot, which this provides). Issue #20: moved here from the
        // Settings panel wiring above - callback itself is unchanged.
        exportSceneAsPng(renderer, scene, camera);
      },
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

/**
 * Issue #21: the Layers panel's per-`object_type` checkboxes each control a
 * whole category of objects ("Star" really means "every star"), so their
 * labels should read as plural - unlike `humanizeCategory` output shown for
 * a single object elsewhere (`ui/inspector.ts`'s own separate, deliberately
 * NOT reused, `humanizeType`), which stays singular. Only called on this
 * one `categories.map` call site above, so it's fine to bake pluralization
 * in here rather than parameterizing `humanizeCategory` itself.
 *
 * Handles today's one irregular case in the catalog's object types - the
 * Latin "-a" -> "-ae" plural ("Planetary Nebula" -> "Planetary Nebulae") -
 * and falls back to a plain trailing "s" for every other type (also correct
 * for any future object type this simple catalog doesn't have yet).
 */
function pluralizeCategoryLabel(label: string): string {
  return label.endsWith("a") ? `${label}e` : `${label}s`;
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
  // Story #239 AC #9: star-click selection/Inspector-opening is disabled
  // whenever the player's time is away from Today - the canvas itself has no
  // `disabled` DOM property to toggle, so this is guarded directly here via
  // the same `isUiLockedForPlayerTime` condition Issue #292's now-removed
  // toolbar-button lock (Story #330) used to also share via a maintained
  // `uiLocked` flag; this is the one remaining consumer, per Story #330's
  // explicit "leave this specific gate unchanged" scope boundary, so it's
  // recomputed inline here rather than keeping that shared mutable flag
  // alive for a single reader. Camera navigation (`OrbitControls`, which also
  // listens on this same element) is a completely separate listener and is
  // untouched by this check, per that AC.
  if (isUiLockedForPlayerTime(playerTimeYears)) return;
  if (pointerDownClientPos) {
    const dx = event.clientX - pointerDownClientPos.x;
    const dy = event.clientY - pointerDownClientPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > CLICK_DRAG_THRESHOLD_PX) {
      return;
    }
  }
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = toNdc(event.clientX, event.clientY, rect);
  // Story #315: also raycasts against the diffuse-structure layer's
  // individual meshes - those four types are no longer part of
  // `catalogBuckets` at all, so without this, clicking one of them would
  // silently stop opening the Inspector (see `picking.ts`'s
  // `pickSceneObject` docstring).
  //
  // Issue #5: also passes the canvas's own CSS-pixel dimensions as a
  // `tapTolerance` - when the exact raycast above finds nothing, this lets
  // `pickSceneObject` fall back to `findTapFallbackObject`'s screen-space
  // near-miss scan, so an already-tiny RECONS-sphere-floor star marker (#1/
  // #4) stays tappable even when a fingertip (or an imprecise mouse click)
  // lands a few pixels off its actual, tiny geometry. Passed unconditionally
  // for both mouse and touch input (not gated on `PointerEvent.pointerType`)
  // - see `findTapFallbackObject`'s own docstring for why this stays scoped
  // to small/shrunk markers regardless of input device, so this doesn't
  // loosen precision for any marker already comfortably sized to click
  // exactly.
  const hit = pickSceneObject(raycaster, camera, ndc, catalogBuckets, diffuseStructureLayer?.meshes ?? [], {
    canvasWidthPx: rect.width,
    canvasHeightPx: rect.height,
  });
  selectObject(hit);
});

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  bloomComposer.setSize(window.innerWidth, window.innerHeight);
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
  applyVelocityVectorScale();
  applyDenseBatchBoundaryVisibility();
  // Story #308: this used to also drive a possible player time/playing/panel
  // reset on a Local-Bubble-exit crossing frame (`applyPlayerSphereState`,
  // called from within this) - removed, since the player is no longer gated
  // to the Local Bubble. `applyBackgroundDimming` now only handles the
  // dimming-tier visuals; still called before `applyPlayerAnimation` to keep
  // that ordering unchanged from before.
  applyBackgroundDimming();
  applyPlayerAnimation(deltaSeconds);
  // Runs after `applyPlayerAnimation` so the density/rank cap's own
  // camera-distance ranking (`updateLabelVisibility`) sees each animated
  // star's label at its freshly-updated (this frame's) position, not last
  // frame's.
  updateLabelVisibility();
  applyFovReadout();
  applyGalacticCenterLabelPosition();
  scene.traverse(darkenNonBloomed);
  bloomComposer.render();
  scene.traverse(restoreMaterial);
  composer.render();
  labelRenderer.render(scene, camera);
}
animate();

// PROTOTYPE (not for merge): live tuning HUD so the values above can be
// dialed in by hand before they get baked into real Settings-panel defaults.
(function createBloomTuningHud(): void {
  const panel = document.createElement("div");
  panel.style.cssText =
    "position:fixed;bottom:12px;right:12px;z-index:9999;background:rgba(10,12,20,0.85);" +
    "color:#dfe6f5;font:12px/1.4 monospace;padding:10px 12px;border-radius:6px;width:220px;" +
    "border:1px solid rgba(255,255,255,0.15)";
  document.body.appendChild(panel);

  const title = document.createElement("div");
  title.textContent = "Bloom tuning (prototype)";
  title.style.cssText = "font-weight:bold;margin-bottom:6px;";
  panel.appendChild(title);

  function addSectionHeader(label: string): void {
    const header = document.createElement("div");
    header.textContent = label;
    header.style.cssText =
      "font-weight:bold;margin:10px 0 4px;padding-top:6px;border-top:1px solid rgba(255,255,255,0.15);" +
      "letter-spacing:0.05em;font-size:11px;color:#9db4e0;";
    panel.appendChild(header);
  }

  function addSlider(
    label: string,
    min: number,
    max: number,
    step: number,
    initial: number,
    onChange: (value: number) => void,
  ): void {
    const row = document.createElement("div");
    row.style.cssText = "margin-bottom:6px;";
    const labelEl = document.createElement("div");
    labelEl.textContent = `${label}: ${initial}`;
    row.appendChild(labelEl);
    const input = document.createElement("input");
    input.type = "range";
    input.min = String(min);
    input.max = String(max);
    input.step = String(step);
    input.value = String(initial);
    input.style.cssText = "width:100%;";
    input.addEventListener("input", () => {
      const value = Number(input.value);
      labelEl.textContent = `${label}: ${value}`;
      onChange(value);
    });
    row.appendChild(input);
    panel.appendChild(row);
    // PROTOTYPE: realworldStarLayer isn't built yet at this synchronous
    // setup point (found live - uAttenStartPc stayed stuck at the shader's
    // own 1e9 default despite this slider's initial value of 2000, because
    // the layer-dependent onChange callbacks all silently no-op on a null
    // layer) - retry across a few animation frames instead of applying once
    // immediately, so the starting value actually lands once the layer
    // exists rather than only ever taking effect after the user's first
    // manual drag.
    // PROTOTYPE: realworldStarLayer isn't built synchronously (a
    // requestAnimationFrame retry chain here never fired a second time -
    // this tab's rAF appears throttled/coalesced under browser automation,
    // unlike the app's own animate() loop which is already running) -
    // setInterval sidesteps that. Applies the initial value the first time
    // the layer exists, then stops.
    let attemptsLeft = 100;
    const timer = setInterval(() => {
      attemptsLeft -= 1;
      if (realworldStarLayer || attemptsLeft <= 0) {
        clearInterval(timer);
        onChange(initial);
      }
    }, 100);
  }

  // PROTOTYPE: regenerates the twinkle sprite atlas (spike length/width are
  // baked into the canvas texture, not a shader uniform) - all three
  // sliders trigger the same rebuild since a fresh texture needs all
  // current values together. Declared up top since the BLOOM/STARS groups
  // below don't need it, but SPIKES does.
  let spikeLength = 1;
  let brilliantSpikeLength = 1;
  let spikeWidth = 1;
  function regenerateTwinkleTexture(): void {
    if (!realworldStarLayer) {
      return;
    }
    const texture = getTunableStarTwinkleAtlasTexture();
    if (!texture) {
      return;
    }
    redrawStarTwinkleAtlas(spikeLength, spikeWidth, brilliantSpikeLength);
    realworldStarLayer.material.uniforms.uMap.value = texture;
  }

  addSectionHeader("BLOOM");
  addSlider("Bloom strength", 0, 3, 0.05, bloomPass.strength, (v) => {
    bloomPass.strength = v;
  });
  addSlider("Bloom radius", 0, 1, 0.02, bloomPass.radius, (v) => {
    bloomPass.radius = v;
  });
  addSlider("Bloom threshold", 0, 1, 0.02, bloomPass.threshold, (v) => {
    bloomPass.threshold = v;
  });
  addSlider("Color bloom compensation", 0, 1, 0.05, 0.7, (v) => {
    if (realworldStarLayer) {
      realworldStarLayer.material.uniforms.uColorBloomCompensation.value = v;
    }
  });

  addSectionHeader("STARS");
  addSlider("Normal-tier size boost", 0.5, 6, 0.1, 1, (v) => {
    if (realworldStarLayer) {
      realworldStarLayer.material.uniforms.uNormalBoost.value = v;
    }
  });
  addSlider("Brilliant-tier boost", 1, 3, 0.05, 1, (v) => {
    if (realworldStarLayer) {
      realworldStarLayer.material.uniforms.uBrilliantBoost.value = v;
    }
  });
  addSlider("Faint-star minimum size (px)", 0, 80, 1, 9, (v) => {
    if (realworldStarLayer) {
      realworldStarLayer.material.uniforms.uMinSizePx.value = v;
    }
  });

  addSectionHeader("SPIKES");
  addSlider("Spike length (all stars)", 0.5, 3, 0.05, 1.8, (v) => {
    spikeLength = v;
    regenerateTwinkleTexture();
  });
  addSlider("Spike length (brightest)", 0.5, 4, 0.05, 2.6, (v) => {
    brilliantSpikeLength = v;
    regenerateTwinkleTexture();
  });
  addSlider("Spike width", 0.5, 3, 0.05, 1, (v) => {
    spikeWidth = v;
    regenerateTwinkleTexture();
  });
  addSlider("Intensity (all stars)", 0.2, 4, 0.05, 1, (v) => {
    if (realworldStarLayer) {
      realworldStarLayer.material.uniforms.uIntensity.value = v;
    }
  });

  addSectionHeader("DISTANCE");
  addSlider("Distance falloff start (pc)", 20, 2000, 10, 2000, (v) => {
    if (realworldStarLayer) {
      realworldStarLayer.material.uniforms.uAttenStartPc.value = v;
    }
  });
  addSlider("Distance falloff strength", 0, 1.5, 0.05, 0, (v) => {
    if (realworldStarLayer) {
      realworldStarLayer.material.uniforms.uAttenStrength.value = v;
    }
  });
  (window as unknown as { __getRealworldLayer: () => RealworldStarLayer | null }).__getRealworldLayer = () =>
    realworldStarLayer;
})();
