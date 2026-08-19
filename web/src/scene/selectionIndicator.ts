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
 * only `updateForObject` (called on selection change, on selection-
 * visibility refresh, and once per frame while something is selected - see
 * `main.ts`'s `updateSelectionIndicatorScale` - to track #113/#119's own
 * per-frame LOD marker-radius shrink) ever touches its transform.
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
   * endpoint to match. Called on selection change, on selection-visibility
   * refresh (#95/#97's mechanism), and once per frame while a selection is
   * active so a LOD-driven marker-radius change (#113/#119) keeps the
   * reticle in proportion as the camera moves - cheap either way, this only
   * ever touches two small `Object3D` transforms plus a 2-point line's
   * buffer attribute, never per-catalog-object work. */
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
  group.add(lineToSun);

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
