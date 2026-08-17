import "./style.css";
import { createCamera, createControls } from "./scene/camera";
import { createRenderer, createScene } from "./scene/createScene";
import { createSunMarker } from "./scene/sun";
import { createGalacticPlane } from "./scene/galacticPlane";
import { createAxes } from "./scene/axes";
import { createCatalogObjectGroup, excludeDedicatedMarkerObjects } from "./scene/objects";
import { loadScene } from "./scene/sceneData";

/**
 * Application entry point (spec Idea.md §22, Story #64). Wires together
 * the renderer/scene/camera scaffolding, loads the scene export, and
 * builds the Sun / Galactic Plane / axes / catalog object layers. No UI
 * controls (toggles, inspector, radius filter, presets) are built here -
 * those are Story #65's scope; this establishes the base 3D scene only.
 */

const RADIUS_PC = 800; // matches the radius the checked-in scene.json was exported with

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

scene.add(createSunMarker());
scene.add(createGalacticPlane(RADIUS_PC));
scene.add(createAxes(RADIUS_PC));

loadScene()
  .then((sceneData) => {
    scene.add(createCatalogObjectGroup(sceneData.objects));
    // Count only what this loop actually draws (excludes the Sun, which
    // has its own dedicated marker added separately above) - the status
    // text should describe the generic catalog markers on screen, not the
    // raw scene.json object count, which would silently include the Sun a
    // second time (see objects.ts / PR #79 review).
    const catalogCount = excludeDedicatedMarkerObjects(sceneData.objects).length;
    status.textContent = `${catalogCount} catalog objects + Sun - ${sceneData.metadata.coordinate_system}`;
  })
  .catch((error: unknown) => {
    // Per spec §38 ("missing optional layers do not break the
    // application") the base scene (Sun/plane/axes) still renders even if
    // the catalog fails to load.
    console.error("Failed to load scene data", error);
    status.textContent = "Failed to load scene data - see console.";
  });

function onResize(): void {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}
window.addEventListener("resize", onResize);

function animate(): void {
  requestAnimationFrame(animate);
  controls.update();
  renderer.render(scene, camera);
}
animate();
