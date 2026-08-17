import { Camera, Scene, WebGLRenderer } from "three";

/**
 * PNG screenshot export (spec Idea.md §39: "The web visualizer should
 * support at minimum: PNG screenshot").
 *
 * Approach: force one synchronous render immediately before capturing
 * (rather than flipping on `preserveDrawingBuffer` for the whole app, which
 * has a performance cost every frame) - `WebGLRenderer.domElement.toBlob()`
 * called right after `renderer.render(...)`, in the same synchronous tick,
 * reliably captures that frame's contents before the browser has a chance
 * to clear/swap the drawing buffer on the next `render()` call. This is the
 * standard Three.js pattern for on-demand screenshot capture.
 */
export function exportSceneAsPng(
  renderer: WebGLRenderer,
  scene: Scene,
  camera: Camera,
  filename = "local-galactic-structures.png",
): void {
  renderer.render(scene, camera);
  renderer.domElement.toBlob((blob) => {
    if (!blob) {
      console.error("PNG export failed: canvas.toBlob returned null");
      return;
    }
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    document.body.removeChild(anchor);
    URL.revokeObjectURL(url);
  }, "image/png");
}
