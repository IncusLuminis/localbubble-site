import { Object3D } from "three";
import { CSS2DObject, CSS2DRenderer } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type { SceneObject } from "./sceneTypes";
import { positionToVector3 } from "./sceneData";

/**
 * Object name labels (spec Idea.md §25): "remain legible while navigating;
 * optionally hide at large distances; avoid excessive clutter; be
 * toggleable." Implemented with `CSS2DRenderer` (the spec's own suggested
 * approach) rather than sprites/canvas textures - labels stay pixel-crisp
 * DOM text at any zoom level.
 *
 * Clutter-avoidance choice (documented per Story #65's brief, retuned for
 * scale by issue #89): a label is shown only when ALL of:
 *   - the global "labels" toggle is on;
 *   - the object's own category layer is visible;
 *   - the object passes the current radius filter;
 *   - EITHER the object is the currently selected/hovered object, OR the
 *     camera is within `maxCameraDistancePc` of it (`shouldShowLabel`);
 *   - AND (issue #89, added at 605-object scale) it ranks among the
 *     `MAX_VISIBLE_LABELS` nearest-to-camera objects that pass the above -
 *     see `selectNearestLabels`, applied by `main.ts` on top of
 *     `shouldShowLabel`.
 * i.e. labels for distant/unselected objects fade out as you zoom out, but
 * the selected object's label always stays visible regardless of distance
 * or rank (spec §25's "remain legible while navigating" - you should never
 * lose the label of the thing you're actively inspecting). The distance
 * threshold alone (spec §25's "optionally hide at large distances") was
 * sufficient at Story #65's ~20-object scale; at 605 objects it no longer
 * bounds the simultaneously-visible count on its own (hundreds can still
 * fall within a generous default-view threshold), so the nearest-N cap is
 * the actual mechanism keeping `CSS2DRenderer`'s DOM cost bounded now.
 */

export interface LabelVisibilityParams {
  labelsEnabled: boolean;
  layerVisible: boolean;
  withinRadius: boolean;
  isSelected: boolean;
  cameraDistancePc: number;
  maxCameraDistancePc: number;
}

export function shouldShowLabel(params: LabelVisibilityParams): boolean {
  if (!params.labelsEnabled || !params.layerVisible || !params.withinRadius) {
    return false;
  }
  if (params.isSelected) {
    return true;
  }
  return params.cameraDistancePc <= params.maxCameraDistancePc;
}

/** Floor (pc) for the label-visibility distance threshold - see
 * `effectiveMaxLabelDistancePc` below for the value actually used at
 * runtime.
 *
 * `cameraDistancePc` here is measured from the camera itself, not from the
 * scene's center. Story #65 set this to 2000pc back when the catalog held
 * ~20 objects, reasoning that the default "Perspective" pose (distance from
 * origin ~1087pc) should show every object's label at once. Story #88 grew
 * the catalog to 605 objects (max ~1840pc), which made that same generous
 * threshold actively harmful: at the default 800pc radius-filter preset,
 * ~548 objects fall within it, and 2000pc was loose enough that essentially
 * all of them still passed the distance check too - hundreds of
 * simultaneously visible DOM labels, exactly the `CSS2DRenderer` bottleneck
 * issue #89 warns about, well before the WebGL geometry itself struggles.
 *
 * Retuned to 250pc (issue #89, verified interactively - see the PR
 * description): tight enough that only objects genuinely close to the
 * camera keep an always-on label when the camera itself is close in. But a
 * *fixed* 250pc threshold turned out to interact badly with the default
 * camera pose: `scene/camera.ts`'s default position is ~1087pc from the
 * origin, so at first load, with no user interaction, literally every
 * catalog object was >250pc from the camera and zero labels rendered
 * (issue #94) - a large, jarring regression from the pre-#89 "show
 * everything by default" behavior, even though `MAX_VISIBLE_LABELS` below
 * was already sitting there ready to cap the DOM cost regardless of how
 * generous the distance threshold is. `DEFAULT_MAX_LABEL_DISTANCE_PC` is
 * now a *floor* under `effectiveMaxLabelDistancePc`'s camera-relative
 * threshold rather than the threshold itself - see that function for the
 * reconciliation. Purely a visual/display parameter (spec §19), not a
 * scientific value. */
export const DEFAULT_MAX_LABEL_DISTANCE_PC = 250;

/** Multiplier applied to the camera's distance from the scene origin (the
 * Sun, spec §6) to derive the label-visibility threshold at the *current*
 * view (issue #94's fix). Chosen so that, at the default "Perspective" pose
 * (`scene/camera.ts`, camera ~1087pc from the origin), the effective
 * threshold (~1631pc) comfortably covers the near-Sun-concentrated bulk of
 * the catalog (spec `Idea-v1.2-individual-stars.md`: individual-star density
 * is highest close to the Sun) without needing to reach every object at the
 * default 800pc radius-filter edge in every direction - `MAX_VISIBLE_LABELS`
 * below still caps final DOM output regardless, so there is no performance
 * downside to a generous multiplier here (see that constant's docstring). */
export const LABEL_DISTANCE_CAMERA_SCALE_FACTOR = 1.5;

/**
 * The actual label-visibility distance threshold (pc) for the *current*
 * camera position, reconciling the two defaults issue #94 flagged as being
 * out of sync: it scales with `cameraDistanceFromOriginPc` (so the default,
 * zoomed-out "Perspective" pose still shows a reasonable set of labels)
 * while never dropping below `DEFAULT_MAX_LABEL_DISTANCE_PC` (so zooming in
 * close, e.g. the "Sun-centered" preset, doesn't tighten the threshold below
 * where it already worked fine pre-#94).
 *
 * Recomputed by `main.ts`'s `updateLabelVisibility` every frame from
 * `camera.position.length()` - a single cheap vector-length call, not the
 * per-frame DOM/CSS2DRenderer cost issue #89 was actually about (that
 * concern is addressed by `selectNearestLabels`'s hard cap below,
 * unaffected by how this threshold is computed).
 */
export function effectiveMaxLabelDistancePc(cameraDistanceFromOriginPc: number): number {
  return Math.max(
    DEFAULT_MAX_LABEL_DISTANCE_PC,
    cameraDistanceFromOriginPc * LABEL_DISTANCE_CAMERA_SCALE_FACTOR,
  );
}

/** Hard cap on the number of labels rendered simultaneously (issue #89):
 * at 605 catalog objects, distance-threshold culling alone
 * (`DEFAULT_MAX_LABEL_DISTANCE_PC`) can still leave hundreds of objects
 * within range of a sufficiently zoomed-out camera - each one a live DOM
 * node `CSS2DRenderer` repositions every frame, which is the actual
 * performance bottleneck at this scale (a few hundred simultaneously
 * *visible* labels is where DOM-based label rendering typically starts
 * costing real frame time, well ahead of the InstancedMesh WebGL geometry
 * itself). Verified interactively to stay smooth and legible at this
 * catalog size - see the PR description. */
export const MAX_VISIBLE_LABELS = 60;

/** One label candidate for `selectNearestLabels`: an object that already
 * passes every non-distance-ranking visibility rule (`shouldShowLabel`'s
 * toggle/layer/radius/base-distance checks), plus what's needed to rank it
 * against the `MAX_VISIBLE_LABELS` cap. */
export interface LabelRankCandidate {
  id: string;
  cameraDistancePc: number;
  isSelected: boolean;
}

/**
 * Given the set of objects that already passed `shouldShowLabel`, returns
 * the ids that should actually render their label once `MAX_VISIBLE_LABELS`
 * is enforced: the selected object (if any) always included, plus the
 * nearest-to-camera remainder up to the cap. This is the density control
 * issue #89 calls for beyond a plain distance cutoff - at 605 objects, a
 * distance threshold alone doesn't bound the simultaneously-visible count,
 * but a nearest-N cap does regardless of catalog size.
 */
export function selectNearestLabels(
  candidates: readonly LabelRankCandidate[],
  maxVisible: number,
): Set<string> {
  if (candidates.length <= maxVisible) {
    return new Set(candidates.map((c) => c.id));
  }

  const selectedIds = candidates.filter((c) => c.isSelected).map((c) => c.id);
  const remainingBudget = Math.max(0, maxVisible - selectedIds.length);

  const nearest = candidates
    .filter((c) => !c.isSelected)
    .sort((a, b) => a.cameraDistancePc - b.cameraDistancePc)
    .slice(0, remainingBudget)
    .map((c) => c.id);

  return new Set([...selectedIds, ...nearest]);
}

/**
 * True if `obj` carries at least one genuine, recognizable proper name -
 * either as its primary `name` or among its `aliases` - as opposed to a
 * bare catalog designation (e.g. "GJ 551", "HIP 70890", "LHS 292"). Added
 * for issue #114's dense-batch label prioritization (`selectDenseBatchLabels`
 * below), so "Alpha Centauri"/"Proxima Centauri"/"Barnard's Star"-style
 * labels win scarce cap slots over bare designations, not just whichever
 * happens to be nearest to the camera.
 *
 * Heuristic verified against the actual catalog data (`data/normalized/
 * initial_catalog_records.json` / the exported `scene.json`), not guessed:
 * SIMBAD's own "NAME " prefix convention marks a genuine proper name.
 * `name_proxima_centauri`'s `name` is literally "NAME Proxima Centauri", so
 * the primary-name check alone catches it. `alf_cen_a`/`alf_cen_b`'s `name`
 * is instead the bare Bayer designation "* alf Cen A"/"* alf Cen B", with
 * the recognizable common name only present as an alias - "NAME Rigil
 * Kentaurus"/"NAME Toliman" respectively - hence the alias fallback check.
 * Records with neither (e.g. `wolf_359`'s "Wolf  359", `hd_95735`'s
 * "HD  95735", `ross_128`'s "Ross  128") are treated as bare designations
 * even though some read as quasi-names colloquially - SIMBAD itself
 * doesn't mark them with "NAME ", so neither does this heuristic; it
 * tracks SIMBAD's own "is this a genuine proper name" judgment rather than
 * general astronomical familiarity.
 */
export function hasProperName(obj: Pick<SceneObject, "name" | "aliases">): boolean {
  if (obj.name.startsWith("NAME ")) {
    return true;
  }
  return obj.aliases.some((alias) => alias.startsWith("NAME "));
}

/**
 * Hard cap on simultaneously-visible labels specifically for the dense
 * RECONS "100 nearest stellar systems" LOD batch (issue #104's `lod.ts`
 * `DENSE_BATCH_GROUP_TAG`) - independent of, and much smaller than, the
 * general `MAX_VISIBLE_LABELS` cap above (issue #114).
 *
 * 122 real stars packed within the batch's own ~11pc collection radius
 * means the general 60-object cap - tuned for the ~800pc overview, where
 * 60 simultaneously-visible labels have a whole screen's worth of room to
 * spread out - produces overlapping/illegible labels once the camera is
 * close enough for the whole batch to occupy a tiny screen area. A
 * "handful" (the issue's own suggested 5-8) stays legible; 7 was chosen to
 * comfortably fit the Alpha Centauri system's all three catalog entries
 * (Proxima, A, and B - themselves the batch's three nearest members, so
 * they win the proper-name-first ranking outright) plus a few more named
 * neighbors (Barnard's Star, Sirius A/B, ...) without crowding back into
 * the clutter this issue exists to fix.
 */
export const DENSE_BATCH_MAX_VISIBLE_LABELS = 7;

/** `LabelRankCandidate` plus whether the candidate has a genuine proper
 * name (`hasProperName` above) - the dense batch's ranking criterion
 * (issue #114) prioritizes that ahead of raw camera distance, unlike the
 * general `selectNearestLabels` cap which ranks purely by distance. */
export interface DenseBatchLabelRankCandidate extends LabelRankCandidate {
  hasProperName: boolean;
}

/**
 * The dense-batch-specific counterpart to `selectNearestLabels` (issue
 * #114): same selected-always-included/remaining-budget structure, but
 * ranks the non-selected remainder by proper-name-first, then nearest-
 * camera-distance as the tiebreaker, rather than by pure camera distance -
 * so within the dense RECONS batch, "Alpha Centauri" beats a marginally
 * closer bare "GJ ####"-style designation for one of the small cap's
 * scarce slots.
 *
 * Deliberately a separate function from `selectNearestLabels` rather than
 * a generalized "ranking strategy" parameter on it: the two caps serve
 * different pools (general catalog vs. one specific LOD-gated batch) with
 * different budgets and different ranking criteria, and `main.ts` unions
 * their results rather than ever passing the same candidate through both -
 * keeping them separate keeps each one simple to read and test in
 * isolation, per this issue's "don't touch non-RECONS-batch label
 * behavior" scope boundary.
 */
export function selectDenseBatchLabels(
  candidates: readonly DenseBatchLabelRankCandidate[],
  maxVisible: number,
): Set<string> {
  if (candidates.length <= maxVisible) {
    return new Set(candidates.map((c) => c.id));
  }

  const selectedIds = candidates.filter((c) => c.isSelected).map((c) => c.id);
  const remainingBudget = Math.max(0, maxVisible - selectedIds.length);

  const ranked = candidates
    .filter((c) => !c.isSelected)
    .sort((a, b) => {
      if (a.hasProperName !== b.hasProperName) {
        return a.hasProperName ? -1 : 1;
      }
      return a.cameraDistancePc - b.cameraDistancePc;
    })
    .slice(0, remainingBudget)
    .map((c) => c.id);

  return new Set([...selectedIds, ...ranked]);
}

/**
 * Strips SIMBAD's own "NAME " proper-name prefix (see `hasProperName`
 * above) for on-screen DISPLAY purposes only (issue #122). SIMBAD marks
 * genuine proper names with a literal leading "NAME " in the raw
 * `name`/`aliases` strings (e.g. "NAME Proxima Centauri") - useful as
 * classification signal (`hasProperName`, issue #114's dense-LOD label
 * prioritization), but an internal-catalog artifact nobody should actually
 * see rendered in the 3D scene or the Inspector panel.
 *
 * Deliberately narrow: strips only a leading "NAME " (note the trailing
 * space, matching SIMBAD's own convention exactly) and leaves every other
 * string - including names with no such prefix, and the unrelated
 * "NAME-IAU " convention `hasProperName`'s own tests already distinguish -
 * completely untouched. Callers that need the classification signal
 * (`hasProperName`, `scene/search.ts`'s substring matching) must keep
 * reading the raw, unstripped `name`/`aliases` - this helper exists only
 * for the two places that put `name` on screen (`createLabelsLayer` below
 * and `ui/inspector.ts`'s "Name" row), never for logic.
 */
export function displayName(name: string): string {
  const prefix = "NAME ";
  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

export interface CatalogLabel {
  /** The scene object this label belongs to. */
  object: SceneObject;
  /** The CSS2DObject added to the scene graph (position mirrors the
   * object's own mesh position). */
  css2dObject: CSS2DObject;
  /** The underlying DOM element, exposed so callers can toggle a
   * "selected" CSS class etc. without re-querying the DOM. */
  element: HTMLDivElement;
}

/** Build one `CSS2DObject` label per (non-Sun) catalog object, all parented
 * under a returned `THREE.Object3D` group. Visibility of each individual
 * label is driven by the caller each frame/interaction via
 * `shouldShowLabel` + `element.style.display` (kept as plain DOM style
 * toggling rather than adding/removing from the scene graph every frame,
 * which would be needlessly expensive for ~20 objects but still avoids
 * `CSS2DRenderer` doing extra work for labels nobody can see). */
export function createLabelsLayer(objects: SceneObject[]): {
  group: Object3D;
  labels: CatalogLabel[];
} {
  const group = new Object3D();
  group.name = "labels";

  const labels: CatalogLabel[] = objects.map((obj) => {
    const element = document.createElement("div");
    element.className = "object-label";
    element.textContent = displayName(obj.name);

    const css2dObject = new CSS2DObject(element);
    css2dObject.position.copy(positionToVector3(obj.position_pc));
    group.add(css2dObject);

    return { object: obj, css2dObject, element };
  });

  return { group, labels };
}

/**
 * The Sun's own label ("Sun") - a separate, parallel path from
 * `createLabelsLayer` above because the Sun is not a catalog object that
 * flows through it: its catalog record is deliberately excluded from the
 * generic per-object label loop (`scene/objects.ts`'s `SUN_OBJECT_ID`
 * filter) to avoid a double marker/label for the same object, and nothing
 * ever filled in a replacement label for its dedicated marker
 * (`scene/sun.ts`) - issue #105.
 *
 * Per spec §2.5 (v1.3 addendum), this label must stay visible whenever the
 * global labels toggle is on, "regardless of zoom/rank" - a *permanent*
 * exemption from both the distance-based cutoff (`shouldShowLabel`) and
 * the `MAX_VISIBLE_LABELS` nearest-N cap (`selectNearestLabels`), mirroring
 * why the currently-selected object's label is exempted from those same
 * cutoffs (spec §25: "remain legible while navigating" - the coordinate
 * origin should never disappear). This is deliberately NOT built by
 * reusing that `isSelected` mechanism: `isSelected` is scoped to a single,
 * changeable "currently selected catalog object" id, threaded through
 * `selectNearestLabels`'s budget accounting and the `.selected` CSS class -
 * repurposing it for the Sun would make it compete for/consume
 * `MAX_VISIBLE_LABELS` budget bookkeeping and pick up selection styling it
 * doesn't need, for a label that isn't actually "selected" in that sense
 * and should never NOT be exempt. The caller (`main.ts`) instead gates
 * this label's visibility on nothing but the same global `labelsEnabled`
 * flag, bypassing `shouldShowLabel`/`selectNearestLabels` entirely - see
 * `shouldShowSunLabel` below, the pure policy `main.ts` calls each frame.
 */
export function createSunLabel(): CSS2DObject {
  const element = document.createElement("div");
  element.className = "object-label";
  element.textContent = "Sun";

  const css2dObject = new CSS2DObject(element);
  // The Sun is always exactly the coordinate-system origin (spec §6,
  // `scene/sun.ts`'s own docstring on this being a legitimate literal
  // constant rather than data read from `scene.json`).
  css2dObject.position.set(0, 0, 0);
  return css2dObject;
}

/**
 * The Sun label's visibility policy (issue #105, spec §2.5): gated on
 * nothing but the global labels toggle - no distance or rank parameters
 * exist on this signature at all, which is the point. Unlike
 * `shouldShowLabel` (which takes `cameraDistancePc`/`maxCameraDistancePc`
 * and an `isSelected` escape hatch) or `selectNearestLabels` (which caps
 * the visible set at `MAX_VISIBLE_LABELS`), this function structurally
 * cannot hide the Sun's label for being too far away or ranking outside a
 * cap, because those inputs are never wired to it. Kept as its own pure
 * function (rather than inlining `labelsEnabled` directly at the call
 * site) so the exemption itself - "the Sun label depends only on the
 * global toggle" - is independently unit-testable without a DOM
 * environment (this repo's `vitest.config.ts` runs with `environment:
 * "node"`, so `createSunLabel`'s `document.createElement` call above isn't
 * itself unit-tested, mirroring `createLabelsLayer`'s same DOM-touching
 * parts).
 */
export function shouldShowSunLabel(labelsEnabled: boolean): boolean {
  return labelsEnabled;
}

/** Thin wrapper around `THREE.CSS2DRenderer` construction/sizing, kept here
 * so `main.ts` doesn't need its own import of the Three.js examples path. */
export function createLabelRenderer(container: HTMLElement): CSS2DRenderer {
  const labelRenderer = new CSS2DRenderer();
  labelRenderer.setSize(window.innerWidth, window.innerHeight);
  labelRenderer.domElement.style.position = "absolute";
  labelRenderer.domElement.style.top = "0";
  labelRenderer.domElement.style.left = "0";
  labelRenderer.domElement.style.pointerEvents = "none";
  container.appendChild(labelRenderer.domElement);
  return labelRenderer;
}
