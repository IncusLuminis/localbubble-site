import "./style.css";
import { Raycaster } from "three";
import { createCamera, createControls } from "./scene/camera";
import { createRenderer, createScene } from "./scene/createScene";
import { createSunMarker } from "./scene/sun";
import { createGalacticPlane } from "./scene/galacticPlane";
import { createAxes } from "./scene/axes";
import {
  catalogObjectTypes,
  createCatalogObjectGroup,
  excludeDedicatedMarkerObjects,
} from "./scene/objects";
import { loadScene } from "./scene/sceneData";
import { createGouldBeltLayer, createLocalBubbleLayer, createRadcliffeWaveLayer } from "./scene/structures";
import { createLabelRenderer, createLabelsLayer, DEFAULT_MAX_LABEL_DISTANCE_PC, shouldShowLabel } from "./scene/labels";
import { DEFAULT_RADIUS_PC, RADIUS_PRESETS_PC, isWithinRadius } from "./scene/radiusFilter";
import {
  edgeOnPose,
  faceOnPose,
  fitAllPose,
  perspectivePose,
  sunCenteredPose,
  topViewPose,
  type CameraPose,
} from "./scene/cameraPresets";
import { pickSceneObject, toNdc } from "./scene/picking";
import { exportSceneAsPng } from "./scene/pngExport";
import { createControlPanel } from "./ui/controls";
import { Inspector } from "./ui/inspector";
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

scene.add(createSunMarker());
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
let catalogGroup: ReturnType<typeof createCatalogObjectGroup> | null = null;
let catalogObjects: SceneObject[] = [];
let labelsInfo: ReturnType<typeof createLabelsLayer> | null = null;
let gouldBeltGroup: ReturnType<typeof createGouldBeltLayer> | null = null;
let radcliffeWaveGroup: ReturnType<typeof createRadcliffeWaveLayer> | null = null;
let localBubbleGroup: ReturnType<typeof createLocalBubbleLayer> | null = null;

function applyCatalogVisibility(): void {
  if (!catalogGroup) return;
  for (const child of catalogGroup.children) {
    const obj = child.userData.sceneObject as SceneObject | undefined;
    if (!obj) continue;
    const categoryOn = categoryVisibility.get(obj.object_type) ?? true;
    child.visible = categoryOn && isWithinRadius(obj.distance_pc, radiusPc);
    child.scale.setScalar(sizeScale);
  }
}

function applyStructureVisibility(): void {
  galacticPlaneGroup.visible = structureVisibility.get("galactic-plane") ?? true;
  if (gouldBeltGroup) gouldBeltGroup.visible = structureVisibility.get("gould-belt") ?? true;
  if (radcliffeWaveGroup) radcliffeWaveGroup.visible = structureVisibility.get("radcliffe-wave") ?? true;
  if (localBubbleGroup) localBubbleGroup.visible = structureVisibility.get("local-bubble") ?? true;
}

function updateLabelVisibility(): void {
  if (!labelsInfo) return;
  for (const label of labelsInfo.labels) {
    const obj = label.object;
    const categoryOn = categoryVisibility.get(obj.object_type) ?? true;
    const withinRadius = isWithinRadius(obj.distance_pc, radiusPc);
    const cameraDistancePc = camera.position.distanceTo(label.css2dObject.position);
    const visible = shouldShowLabel({
      labelsEnabled,
      layerVisible: categoryOn,
      withinRadius,
      isSelected: obj.id === selectedObjectId,
      cameraDistancePc,
      maxCameraDistancePc: DEFAULT_MAX_LABEL_DISTANCE_PC,
    });
    // `CSS2DRenderer.render()` (see node_modules/three/examples/jsm/
    // renderers/CSS2DRenderer.js) overwrites `element.style.display` every
    // frame based on its own frustum-z test (resetting it to '' whenever
    // the object is within the camera's near/far range) - so setting
    // `style.display` directly here would get silently clobbered on the
    // very next `labelRenderer.render()` call. `Object3D.visible = false`
    // is the mechanism the renderer itself respects (its `hideObject()`
    // path short-circuits before touching `display` again), so that's what
    // drives actual show/hide; `element.style.display` is left alone.
    label.css2dObject.visible = visible;
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
  if (!catalogGroup) return [];
  return catalogGroup.children
    .filter((child) => child.visible)
    .map((child): [number, number, number] => [child.position.x, child.position.y, child.position.z]);
}

function applyCameraPose(pose: CameraPose): void {
  camera.position.set(...pose.position);
  controls.target.set(...pose.target);
  controls.update();
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

    catalogGroup = createCatalogObjectGroup(sceneData.objects);
    scene.add(catalogGroup);

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
  if (!catalogGroup) return;
  if (pointerDownClientPos) {
    const dx = event.clientX - pointerDownClientPos.x;
    const dy = event.clientY - pointerDownClientPos.y;
    if (Math.sqrt(dx * dx + dy * dy) > CLICK_DRAG_THRESHOLD_PX) {
      return;
    }
  }
  const rect = renderer.domElement.getBoundingClientRect();
  const ndc = toNdc(event.clientX, event.clientY, rect);
  const hit = pickSceneObject(raycaster, camera, ndc, catalogGroup);
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
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
animate();
