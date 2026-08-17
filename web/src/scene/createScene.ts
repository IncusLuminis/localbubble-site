import { Color, Scene, WebGLRenderer } from "three";

/**
 * Base renderer + scene setup (spec Idea.md §22, §30). Dark background,
 * restrained aesthetic - no photorealistic lighting model is attempted
 * (spec §30 explicitly rules that out for the MVP), so every mesh in this
 * app uses an unlit `MeshBasicMaterial`; no lights are added here.
 */

const BACKGROUND_COLOR = 0x05070d;

export function createRenderer(container: HTMLElement): WebGLRenderer {
  const renderer = new WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.setSize(window.innerWidth, window.innerHeight);
  container.appendChild(renderer.domElement);
  return renderer;
}

export function createScene(): Scene {
  const scene = new Scene();
  scene.background = new Color(BACKGROUND_COLOR);
  return scene;
}
