import "./style.css";
import { Raycaster } from "three";
import { createCamera, createControls } from "./scene/camera";
import { createRenderer, createScene } from "./scene/createScene";
import { createSunMarker, sunCoreRadiusPc } from "./scene/sun";
import { createGalacticPlane } from "./scene/galacticPlane";
import { createAxes } from "./scene/axes";
import {
  catalogObjectTypes,
  createCatalogObjectGroup,
  excludeDedicatedMarkerObjects,
  isSelectedObjectVisible,
  markerRadiusPc,
  updateCatalogSizeScale,
  updateCatalogVisibility,
  updateDenseBatchLod,
  visibleCatalogObjects,
  type CatalogBucket,
} from "./scene/objects";
import { denseBatchCollectionRadiusPc, isDenseBatchMember, passesDenseBatchLod } from "./scene/lod";
import { loadScene } from "./scene/sceneData";
import { createGouldBeltLayer, createLocalBubbleLayer, createRadcliffeWaveLayer } from "./scene/structures";
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
scene.add(createAxes(WORLD_EXTENT_PC));

const inspector = new Inspector();
app.appendChild(inspector.element);

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

/** Issue #113: rescales the Sun's opaque core each frame/camera-move so it
 * doesn't visually engulf the RECONS dense batch's own nearby markers once
 * the camera approaches solar-neighborhood scale - see `scene/sun.ts`'s
 * `sunCoreRadiusPc` docstring for the actual distance->radius curve. Reuses
 * the same `denseBatchRadiusPc` (populated once the scene loads, `0` until
 * then) that `applyDenseBatchLod` above already benchmarks against, so the
 * two LOD effects stay consistent with each other. */
function applySunCoreScale(): void {
  sunMarker.core.scale.setScalar(sunCoreRadiusPc(camera.position.length(), denseBatchRadiusPc));
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
 * `shouldShowLabel`), so no label-side change was needed for this issue. */
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
    return;
  }
  const obj = catalogObjects.find((o) => o.id === selectedObjectId);
  if (obj) {
    inspector.show(obj);
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
  } else {
    inspector.hide();
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

    const catalogLayer = createCatalogObjectGroup(sceneData.objects);
    catalogBuckets = catalogLayer.buckets;
    scene.add(catalogLayer.group);

    labelsInfo = createLabelsLayer(catalogObjects);
    scene.add(labelsInfo.group);

    gouldBeltGroup = createGouldBeltLayer(sceneData.structures.gould_belt);
    if (gouldBeltGroup) scene.add(gouldBeltGroup);

    radcliffeWaveGroup = createRadcliffeWaveLayer(sceneData.structures.radcliffe_wave);
    if (radcliffeWaveGroup) scene.add(radcliffeWaveGroup);

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
    app.appendChild(panel);

    const searchBox = createSearchBox({
      getObjects: () => catalogObjects,
      onSelect: goToObject,
    });
    app.appendChild(searchBox.element);

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

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  updateLabelVisibility();
  applyDenseBatchLod();
  applySunCoreScale();
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
