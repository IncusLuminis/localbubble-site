import { Mesh, MeshBasicMaterial, SphereGeometry } from "three";

/**
 * Issue #138: a visible boundary marker for the dense RECONS-batch's own
 * "collection radius" (`lod.ts`'s `denseBatchCollectionRadiusPc`, issue
 * #104) - a wireframe sphere shell centered on the Sun (the coordinate
 * origin, spec §6) at exactly that radius, shown only once the camera has
 * crossed inside it, so the user has a visible sense of "I'm now inside
 * the immediate solar neighborhood volume" rather than the LOD gate being
 * an invisible boundary.
 *
 * Deliberately its own file rather than another `structures.ts` layer:
 * `structures.ts`'s existing layers (Gould Belt / Radcliffe Wave / Local
 * Bubble) are all backed by a `scene.json` `structures.*` scientific-model
 * field (spec §16-§18) with their own source/reference - this shell has no
 * such backing data of its own, it's a pure rendering aid over an
 * already-derived UI/LOD threshold (`lod.ts`'s
 * `denseBatchCollectionRadiusPc`), conceptually closer to `sun.ts`'s Sun
 * marker (a fixed rendering convenience at the origin) than to a
 * "scientific structure model" layer.
 *
 * Styled to match `structures.ts`'s `createLocalBubbleLayer` (issue #102)
 * for visual consistency: wireframe, translucent, `depthWrite: false` so
 * it doesn't occlude anything, and reads as a boundary marker rather than
 * competing with the RECONS stars it encloses - a thin wireframe grid, not
 * a solid surface, out of the same "should not interfere with
 * picking/selecting the stars inside it" concern (issue #138's acceptance
 * criteria) as those existing translucent structure meshes' own
 * `depthWrite: false` choice already satisfies.
 */

/** Color: a cool, neutral blue-grey - deliberately distinct from every
 * existing structure color (`structures.ts`'s Gould Belt orange, Radcliffe
 * Wave cyan, Local Bubble violet; `sun.ts`'s warm yellow-white core) so
 * this reads as its own thing (a LOD/UI boundary marker) rather than being
 * mistaken for another scientific structure overlay. */
const DENSE_BATCH_BOUNDARY_COLOR = 0x8899aa;

/** Sphere segment counts - same as `createLocalBubbleLayer`'s (24 wide, 16
 * high), enough to read as a smooth wireframe grid at this radius without
 * needless extra geometry. */
const WIDTH_SEGMENTS = 24;
const HEIGHT_SEGMENTS = 16;

/** Wireframe opacity - matches `createLocalBubbleLayer`'s own 0.35
 * translucent-structure convention (see that function's docstring) so this
 * reads as consistently "translucent boundary" alongside the app's other
 * structure meshes, just via a plain sphere rather than an oriented
 * ellipsoid. */
const BOUNDARY_OPACITY = 0.35;

/**
 * Builds the dense-batch collection-radius boundary shell (issue #138): a
 * wireframe `THREE.SphereGeometry` of exactly `radiusPc`, centered at the
 * origin (the Sun - spec §6, `sun.ts`'s own comment on why (0,0,0) is the
 * one legitimate hard-coded position in this app). Returns `null` for
 * `radiusPc <= 0` (the "not loaded yet"/"no dense-batch member present"
 * state - see `lod.ts`'s `denseBatchCollectionRadiusPc` docstring) since
 * there's no meaningful boundary to draw yet, mirroring every other
 * optional structure layer's (`structures.ts`) "missing/invalid data
 * returns null rather than throwing" convention (spec §38).
 *
 * `main.ts` calls this once, right after computing `denseBatchRadiusPc`
 * from the freshly-loaded scene data - unlike `sun.ts`'s core (which is
 * rescaled every frame because its *radius itself* is camera-distance-
 * dependent, issue #113), this shell's radius is fixed for the whole
 * session once the scene has loaded, so there's no per-frame geometry
 * rebuild here - only this shell's `.visible` flag changes per frame (see
 * `isDenseBatchBoundaryVisible` below), toggled by `main.ts`'s own small
 * per-frame call.
 */
export function createDenseBatchBoundaryLayer(radiusPc: number): Mesh | null {
  if (!Number.isFinite(radiusPc) || radiusPc <= 0) {
    return null;
  }
  const geometry = new SphereGeometry(radiusPc, WIDTH_SEGMENTS, HEIGHT_SEGMENTS);
  const material = new MeshBasicMaterial({
    color: DENSE_BATCH_BOUNDARY_COLOR,
    wireframe: true,
    transparent: true,
    opacity: BOUNDARY_OPACITY,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.name = "dense-batch-boundary";
  mesh.position.set(0, 0, 0);
  return mesh;
}

/**
 * The pure show/hide decision (issue #138's "visible only when the camera
 * is inside the sphere" acceptance criterion): `true` once the camera's
 * distance from the origin is at or within `radiusPc`, matching `lod.ts`'s
 * `passesDenseBatchLod` own inclusive (`<=`) boundary convention exactly,
 * so the shell and the dense-batch markers/labels it encloses cross their
 * shared boundary at exactly the same camera distance rather than
 * disagreeing by an epsilon at the edge. `radiusPc <= 0` (not loaded / no
 * dense-batch member present) is never visible, regardless of camera
 * distance - there is no real boundary to show yet (mirrors
 * `createDenseBatchBoundaryLayer`'s own null-return guard above; kept here
 * too since this function is called independently, every frame, and must
 * not assume the mesh even exists).
 *
 * Pure/no-Three.js-scene dependency, so it's directly unit-testable
 * without a WebGL context (spec §38) - `main.ts` supplies the two
 * closure-only numbers (`camera.position.length()`, `denseBatchRadiusPc`)
 * each frame.
 */
export function isDenseBatchBoundaryVisible(
  cameraDistanceFromOriginPc: number,
  radiusPc: number,
): boolean {
  if (radiusPc <= 0) {
    return false;
  }
  return cameraDistanceFromOriginPc <= radiusPc;
}
