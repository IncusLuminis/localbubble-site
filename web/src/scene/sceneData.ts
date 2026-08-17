import { Vector3 } from "three";
import type { Scene, SceneObject } from "./sceneTypes";

/**
 * Loading and coordinate-mapping logic for the scene export (spec Idea.md
 * §21, §22). Deliberately free of any WebGL/rendering-context dependency
 * (nothing here touches a `THREE.Scene`, camera, or canvas) so it can be
 * unit-tested without a real WebGL context (spec §38, Story #64's test
 * scope) - only `THREE.Vector3`, a plain math value type, is used.
 */

export class InvalidSceneError extends Error {}

/**
 * Minimal structural validation of a parsed scene JSON payload. Not a full
 * schema validator (the Python pipeline already validated/typed this data
 * via Pydantic before export, spec §7) - just enough to fail loudly if the
 * fetched file isn't shaped like a scene export at all, rather than
 * rendering silently with `undefined` positions.
 */
export function assertIsScene(value: unknown): asserts value is Scene {
  if (typeof value !== "object" || value === null) {
    throw new InvalidSceneError("scene.json did not parse to an object");
  }
  const candidate = value as Record<string, unknown>;
  if (!Array.isArray(candidate.objects)) {
    throw new InvalidSceneError("scene.json is missing an 'objects' array");
  }
  if (
    typeof candidate.metadata !== "object" ||
    candidate.metadata === null
  ) {
    throw new InvalidSceneError("scene.json is missing a 'metadata' object");
  }
  for (const obj of candidate.objects as unknown[]) {
    if (typeof obj !== "object" || obj === null) {
      throw new InvalidSceneError("scene.json contains a non-object entry in 'objects'");
    }
    const position = (obj as Record<string, unknown>).position_pc;
    if (
      !Array.isArray(position) ||
      position.length !== 3 ||
      position.some((n) => typeof n !== "number" || !Number.isFinite(n))
    ) {
      throw new InvalidSceneError(
        `scene object '${(obj as Record<string, unknown>).id ?? "?"}' has an invalid position_pc`,
      );
    }
  }
}

/**
 * Fetch and parse `url` (default: the static asset served at
 * `/data/scene.json`, spec §22's "should work locally without requiring a
 * backend once the scene dataset has been built") into a typed `Scene`.
 *
 * Throws `InvalidSceneError` if the response isn't shaped like a scene
 * export. Does not catch network errors - callers decide how to surface
 * those.
 */
export async function loadScene(url = "/data/scene.json"): Promise<Scene> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new InvalidSceneError(
      `failed to fetch ${url}: ${response.status} ${response.statusText}`,
    );
  }
  const parsed: unknown = await response.json();
  assertIsScene(parsed);
  return parsed;
}

/**
 * Map a scene object's `position_pc` (heliocentric Galactic Cartesian
 * [x_pc, y_pc, z_pc], spec §6) directly onto a `THREE.Vector3`, component
 * for component, with no rescaling, reordering, or unit conversion.
 *
 * This is the one place scientific coordinates cross into the renderer's
 * value space (spec §3/§45: the renderer must not alter scientific data),
 * so it is kept intentionally trivial and covered by a unit test asserting
 * the identity mapping and distance preservation. Axis *orientation* in
 * the rendered scene (making +Z, the North Galactic Pole, feel "up") is
 * handled separately by setting the camera's `up` vector (see
 * `scene/camera.ts`) - never by permuting or negating these values.
 */
export function positionToVector3(position_pc: SceneObject["position_pc"]): Vector3 {
  const [x, y, z] = position_pc;
  return new Vector3(x, y, z);
}
