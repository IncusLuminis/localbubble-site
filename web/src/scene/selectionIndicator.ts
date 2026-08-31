import { BufferGeometry, Float32BufferAttribute, Group, Line, LineBasicMaterial } from "three";
import type { SceneObject } from "./sceneTypes";
import { positionToVector3 } from "./sceneData";

/**
 * The on-scene selection indicator (issue #123, spec follow-up to #95/#97's
 * hide-on-filter Inspector mechanism). Before this issue the only feedback
 * for a selected object was the Inspector panel opening and the object's
 * label getting a color/weight change - the human owner wanted a clearer
 * on-scene marker: a targeting reticle around the selected object, plus a
 * line connecting it back to the Sun (origin) so its position relative to
 * "home" reads at a glance regardless of zoom level.
 *
 * Built once at startup (mirroring `scene/sun.ts`'s `createSunMarker` -
 * this codebase's established "persistent objects with mutated
 * transforms/visibility" pattern, not create/destroy-per-click) and added
 * to the scene once; `main.ts` repositions/rescales/shows/hides it as
 * selection changes via `updateForObject`/`setVisible` below, reusing the
 * same `isSelectedObjectVisible` (`objects.ts`, #95/#97) check that already
 * drives the Inspector's own show/hide, so the two never get out of sync.
 *
 * Design choice (an explicit "design call" per the issue): the reticle is
 * three mutually-orthogonal unit circles (one per coordinate plane) rather
 * than a single camera-facing ring/crosshair sprite. That reads clearly as
 * "a ring around this marker" from *any* camera angle with no per-frame
 * billboard/`lookAt` update needed, which keeps the whole indicator cheap:
 * only `updateForObject` ever touches its transform.
 *
 * Issue #150: `updateForObject` is deliberately called ONLY on the two
 * actual selection-relevant events in `main.ts` - a fresh `selectObject`,
 * or a `refreshSelectionVisibility` re-show after a filter hid/re-showed
 * the selected object - never once per animation frame. An earlier version
 * of this wiring called it every frame (to keep tracking #113/#119's own
 * live LOD marker-radius shrink), which meant the reticle's size grew
 * continuously as the user zoomed OUT from inside the dense-LOD sphere,
 * before perspective had a chance to shrink it back down - a visible bug
 * ("the marker scales infinitely large"). This module itself holds no
 * opinion on WHEN it's called - see `main.ts`'s `showSelectionIndicatorFor`
 * docstring for the full call-timing writeup - it just applies whatever
 * radius it's given.
 */

/** How much bigger than the selected object's own current effective marker
 * radius (`objects.ts`'s `markerRadiusPc`/`starMarkerRadiusPc`, or
 * `sun.ts`'s `sunCoreRadiusPc` for the Sun itself) the reticle should read -
 * a simple multiple (per the issue's own suggestion), so the reticle always
 * presents as "a ring around this specific marker" rather than a fixed
 * world-size ring that would look enormous around a 0.02pc LOD-shrunk star
 * or tiny around a 45pc structure. */
export const RETICLE_RADIUS_MULTIPLIER = 2.5;

/** The reticle's scale, given the selected object's current effective
 * marker radius (pc) - exported as a pure function so the "how big is the
 * reticle" logic is unit-testable without a scene/camera/WebGL context. */
export function reticleScaleFor(markerRadiusPcValue: number): number {
  return markerRadiusPcValue * RETICLE_RADIUS_MULTIPLIER;
}

/** Bright, UI-highlight green - deliberately distinct from every
 * `OBJECT_TYPE_COLORS` catalog color, every `structures.ts` model-layer
 * color, and the Sun's own warm-white (`scene/sun.ts`'s `0xfff3c4`), so the
 * selection indicator always reads as "interface chrome around the
 * selection" rather than being mistaken for another data layer. */
const SELECTION_COLOR = 0x39ff14;
const RETICLE_OPACITY = 0.85;
const LINE_TO_SUN_OPACITY = 0.55;

/** Segment count for the reticle's circles - high enough to read as smooth
 * rings rather than visible polygons at any of this app's camera poses,
 * without needing a curved-geometry primitive. */
const RETICLE_SEGMENTS = 48;

/**
 * Issue #253: the selection indicator's own `THREE.Object3D.renderOrder`
 * (the first use of this property anywhere in this codebase). Every
 * translucent structure/boundary overlay this indicator can visually
 * overlap - `structures.ts`'s Local Bubble ellipsoid and Gould Belt/
 * Radcliffe Wave tubes, `denseBatchBoundary.ts`'s boundary shell - uses
 * `depthWrite: false` (by design: none of them should occlude each other).
 * None of them write to the depth buffer, so among themselves, in
 * Three.js's transparent render pass, which one paints on top is decided
 * by `renderOrder` (ascending), not true 3D depth - and every one of those
 * overlays is left at the default `renderOrder` of `0`, same as this
 * indicator's line-to-Sun/reticle. That tie meant paint order fell back to
 * scene-graph traversal order, which happened to put the overlays on top,
 * making the selection line/reticle vanish wherever an overlay's
 * screen-space silhouette crossed them (issue #253's reported bug). A
 * `renderOrder` higher than those overlays' `0` makes this indicator always
 * paint AFTER (on top of) them in the transparent pass, with no effect on
 * its correct occlusion behind genuinely OPAQUE objects (the Sun marker,
 * star markers) - opaque depth-testing is a separate mechanism, untouched
 * by transparent-pass `renderOrder`.
 *
 * Applied to `reticle` and `lineToSun` individually below, not just the
 * outer `group` - verified against `WebGLRenderer.js`'s `projectObject`:
 * a `THREE.Group`'s `renderOrder` is inherited by its non-Group
 * descendants ONLY until the traversal hits another `Group`, which resets
 * the inherited value to that nested Group's OWN `renderOrder` (default
 * `0`). Since `reticle` is itself a `Group` nested inside `group`, setting
 * `group.renderOrder` alone would fix `lineToSun` (a direct `Line` child of
 * `group`) but silently leave the reticle's three circles back at `0`.
 */
const SELECTION_INDICATOR_RENDER_ORDER = 1;

/**
 * Unit-radius (radius 1) circle, in one of the three coordinate planes, as
 * a `THREE.Line` - the real reticle size is applied entirely via the
 * returned line's own `Object3D.scale` at `updateForObject`-time, matching
 * this codebase's established "shared unit geometry + per-object transform"
 * pattern (`scene/objects.ts`'s `UNIT_SPHERE_GEOMETRY`, `scene/sun.ts`'s
 * unit-sphere `core`) rather than rebuilding geometry per selection.
 */
function unitCircleLine(plane: "xy" | "xz" | "yz"): Line {
  const positions = new Float32Array((RETICLE_SEGMENTS + 1) * 3);
  for (let i = 0; i <= RETICLE_SEGMENTS; i++) {
    const t = (2 * Math.PI * i) / RETICLE_SEGMENTS;
    const c = Math.cos(t);
    const s = Math.sin(t);
    const idx = i * 3;
    if (plane === "xy") {
      positions[idx] = c;
      positions[idx + 1] = s;
      positions[idx + 2] = 0;
    } else if (plane === "xz") {
      positions[idx] = c;
      positions[idx + 1] = 0;
      positions[idx + 2] = s;
    } else {
      positions[idx] = 0;
      positions[idx + 1] = c;
      positions[idx + 2] = s;
    }
  }
  const geometry = new BufferGeometry();
  geometry.setAttribute("position", new Float32BufferAttribute(positions, 3));
  const material = new LineBasicMaterial({
    color: SELECTION_COLOR,
    transparent: true,
    opacity: RETICLE_OPACITY,
    depthWrite: false,
  });
  const line = new Line(geometry, material);
  line.name = `selection-reticle-${plane}`;
  return line;
}

export interface SelectionIndicator {
  /** Parent group - add this once to the scene (like `createSunMarker`'s
   * `group`). Contains both the reticle and the line-to-Sun; starts
   * hidden (nothing is selected on startup). */
  group: Group;
  /** Repositions the reticle onto `positionPc`, rescales it to
   * `reticleScaleFor(markerRadiusPcValue)`, and moves the line-to-Sun's far
   * endpoint to match. Called on selection change and on selection-
   * visibility refresh (#95/#97's mechanism) - deliberately NOT once per
   * frame (issue #150; see this file's top-of-module docstring) - cheap
   * either way, this only ever touches two small `Object3D` transforms plus
   * a 2-point line's buffer attribute, never per-catalog-object work. */
  updateForObject(positionPc: SceneObject["position_pc"], markerRadiusPcValue: number): void;
  /** Shows/hides the reticle and the line-to-Sun together, in lockstep -
   * they are never toggled independently, so they can't drift out of sync
   * with each other or with the Inspector (`main.ts`'s
   * `refreshSelectionVisibility`, #95/#97's mechanism). */
  setVisible(visible: boolean): void;
}

export function createSelectionIndicator(): SelectionIndicator {
  const group = new Group();
  group.name = "selection-indicator";
  group.visible = false;

  const reticle = new Group();
  reticle.name = "selection-reticle";
  reticle.add(unitCircleLine("xy"), unitCircleLine("xz"), unitCircleLine("yz"));
  // See `SELECTION_INDICATOR_RENDER_ORDER`'s docstring above - `reticle` is
  // its own `Group`, so it needs this set directly rather than relying on
  // inheriting it from the outer `group`.
  reticle.renderOrder = SELECTION_INDICATOR_RENDER_ORDER;
  group.add(reticle);

  const lineGeometry = new BufferGeometry();
  lineGeometry.setAttribute(
    "position",
    new Float32BufferAttribute(new Float32Array([0, 0, 0, 0, 0, 0]), 3),
  );
  const lineToSun = new Line(
    lineGeometry,
    new LineBasicMaterial({
      color: SELECTION_COLOR,
      transparent: true,
      opacity: LINE_TO_SUN_OPACITY,
      depthWrite: false,
    }),
  );
  lineToSun.name = "selection-line-to-sun";
  // See `SELECTION_INDICATOR_RENDER_ORDER`'s docstring above.
  lineToSun.renderOrder = SELECTION_INDICATOR_RENDER_ORDER;
  group.add(lineToSun);
  // Set on the outer group too (belt-and-suspenders, and correct should
  // any future child ever get added directly under `group` rather than
  // under `reticle`) - see the docstring above for why this alone would
  // not be sufficient for `reticle`'s own descendants.
  group.renderOrder = SELECTION_INDICATOR_RENDER_ORDER;

  function updateForObject(
    positionPc: SceneObject["position_pc"],
    markerRadiusPcValue: number,
  ): void {
    const position = positionToVector3(positionPc);
    reticle.position.copy(position);
    reticle.scale.setScalar(reticleScaleFor(markerRadiusPcValue));

    // The line always starts at the Sun (origin, spec §6) and ends at the
    // selected object's position - only the second point ever changes, so
    // this mutates the existing buffer attribute in place rather than
    // rebuilding the geometry (this codebase's established per-frame-safe
    // update pattern, e.g. `objects.ts`'s `setInstanceVisibility`).
    const posAttr = lineGeometry.attributes.position;
    posAttr.setXYZ(0, 0, 0, 0);
    posAttr.setXYZ(1, position.x, position.y, position.z);
    posAttr.needsUpdate = true;
  }

  function setVisible(visible: boolean): void {
    group.visible = visible;
  }

  return { group, updateForObject, setVisible };
}
