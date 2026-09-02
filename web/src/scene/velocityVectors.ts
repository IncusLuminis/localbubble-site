import {
  BufferGeometry,
  ConeGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  LineDashedMaterial,
  Mesh,
  MeshBasicMaterial,
  Object3D,
  Vector3,
} from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import { selectNearestLabels, type LabelRankCandidate } from "./labels";
import type { SceneObject } from "./sceneTypes";

/**
 * Story #231: directional velocity-vector arrows for the stars that carry
 * Story #230's/#286's `velocity` field (`vx_kms`/`vy_kms`/`vz_kms`,
 * heliocentric Galactic Cartesian - the SAME axes as `SceneObject.
 * position_pc`, so an arrow anchored at a star's own position and pointing
 * along its normalized velocity needs no extra coordinate transform).
 * Purely additive: a standalone `THREE.Group` added directly to the scene,
 * entirely independent of the InstancedMesh catalog buckets (`objects.ts`)
 * and picking (`picking.ts`), so selecting a star (Inspector) is unaffected
 * (issue #231 AC).
 *
 * Story #287: originally scoped to the ~127 stars within the RECONS-dense-
 * batch sphere (~11.26pc), widened to the full Local Bubble (~60pc,
 * `bubbleOuterRadiusPc`) - now ~156 stars (127 + Story #286's 29-star
 * backfill). See `starsWithVelocityInLocalBubble` below.
 *
 * At most ~156 arrows - nowhere near the main catalog's draw-call budget
 * concern that justifies `objects.ts`'s InstancedMesh-per-type
 * architecture (issue #89). Each arrow here is a small, individually-
 * built `THREE.Line` (shaft) + `THREE.Mesh` (cone head) pair, matching
 * this issue's own explicit guidance not to force this into the
 * instanced-bucket pattern.
 */

/** Full 3D vector color: a vivid green, deliberately distinct from every
 * existing structure/boundary color in this app (Gould Belt orange
 * 0xffa64d, Radcliffe Wave cyan 0x4dd2ff, Local Bubble violet 0xb18cff,
 * dense-batch boundary blue-grey 0x8899aa - `structures.ts`/
 * `denseBatchBoundary.ts`) and from the OBAFGKM spectral-class star colors
 * (`spectralColor.ts`, all blue/white/yellow/orange/red) so an arrow never
 * reads as "just another star color". */
const FULL_VECTOR_COLOR = 0x39ff6a;

/** Tangential-only (no radial-velocity component) vector color: a warm
 * coral-red, chosen to read as "caution / incomplete" - paired with the
 * dashed line below so a tangential-only vector is distinguishable on BOTH
 * color and line style, per issue #231 AC #5 ("never mistaken for a true
 * 3D one"). */
const TANGENTIAL_VECTOR_COLOR = 0xff5c3d;

const FULL_VECTOR_OPACITY = 0.9;
/** Deliberately lower than `FULL_VECTOR_OPACITY` - a second, independent
 * visual cue (alongside color + dashing) that this vector is an
 * approximation, not a measurement. */
const TANGENTIAL_VECTOR_OPACITY = 0.55;

/** Dash pattern (pc) for tangential-only vectors - sized relative to this
 * module's own arrow-length range below so a couple of dashes are visible
 * even on the shortest (slow-mover) arrows. */
const DASH_SIZE_PC = 0.12;
const GAP_SIZE_PC = 0.08;

/**
 * Artistic (NOT physical km/s-to-pc 1:1, which would be unreadably tiny at
 * this scale - issue #231's explicit out-of-scope) length scale: speed in
 * km/s times this constant gives a raw arrow length in pc, then clamped to
 * `[MIN_ARROW_LENGTH_PC, MAX_ARROW_LENGTH_PC]` below.
 *
 * Tuned against this Story's actual 127-star dataset (`public/data/
 * scene.json`, checked 2026-08-31): derived 3D speeds range from ~13 km/s
 * to a single ~6825 km/s outlier (`V* EZ Aqr` - almost certainly a bad
 * SIMBAD radial-velocity association from Story #230's pipeline, well
 * outside any real nearby star's physical space velocity; out of THIS
 * Story's scope to fix, flagged in the PR), with the bulk of the
 * population between ~13-160 km/s (median ~40 km/s, 95th percentile ~128
 * km/s) and Barnard's Star (a known fast mover, ~142 km/s) near the top of
 * that main cluster. `0.015` maps that main cluster across a visually
 * distinct range (median ~0.6pc, Barnard's Star ~2.1pc) relative to the
 * sphere's own ~11.26pc radius - clearly readable as "arrows", clearly
 * differentiating slow vs. fast movers, without any single arrow
 * approaching the sphere's own scale. The clamp below (not a raw linear
 * scale) is what keeps the one extreme outlier - or any future one - from
 * drawing an absurdly long arrow across the whole scene. */
const ARROW_LENGTH_SCALE_PC_PER_KMS = 0.015;

/** Floor: even the slowest mover in range (~13 km/s) still gets a visibly
 * present, "is this even an arrow" - readable arrow rather than a near-
 * invisible sliver. */
const MIN_ARROW_LENGTH_PC = 0.3;

/** Ceiling: keeps the fastest real movers - and the one known bad-data
 * outlier above - from overwhelming the ~11.26pc sphere's own scale or
 * competing visually with the dense-batch boundary shell
 * (`denseBatchBoundary.ts`) itself. */
const MAX_ARROW_LENGTH_PC = 2.2;

/** Arrowhead (cone) length as a fraction of the total arrow length.
 *
 * Issue #236 (live-tuned at "Fit to nearest-stars sphere" zoom, per the
 * human owner's follow-up on #231): the original `THREE.ArrowHelper`-
 * matching `0.25` read as a big, chunky cone that competed visually with
 * star markers and the dense-batch boundary shell. Shrunk to `0.08` -
 * combined with the narrower `HEAD_WIDTH_FRACTION` and the low-poly
 * `ConeGeometry` segment count below, this reads as a small, subtle
 * triangular tip (closer to `axes.ts`'s flat "▲" Galactic Center indicator
 * silhouette, referenced only as a visual-weight target) rather than a
 * rounded cone, without changing the shaft length itself (out of this
 * issue's scope - `ARROW_LENGTH_SCALE_PC_PER_KMS`/`MIN_ARROW_LENGTH_PC`/
 * `MAX_ARROW_LENGTH_PC` above are untouched). */
const HEAD_LENGTH_FRACTION = 0.08;
/** Arrowhead base radius as a fraction of its own length.
 *
 * Issue #236: shrunk from `0.4` to `0.3` alongside `HEAD_LENGTH_FRACTION`
 * above - a narrower base-to-length ratio reads as a more angular, pointed
 * triangle rather than a squat blob once the head is already this small. */
const HEAD_WIDTH_FRACTION = 0.3;

/** `ConeGeometry`'s radial segment count for the arrowhead.
 *
 * Issue #236: shrunk from `10` (a smooth, rounded cone) to `4` - low enough
 * that the head reads as a simple angular pyramid/triangle from most
 * viewing angles (matching the "small triangular tip" look this issue asks
 * for), while staying even (not `3`) so the silhouette is symmetric rather
 * than showing a single flat face head-on from roughly half of all camera
 * angles. */
const HEAD_RADIAL_SEGMENTS = 4;

const HALF_UP = new Vector3(0, 1, 0);

/** 3D speed magnitude (km/s) from a raw `[vx, vy, vz]` triple. Pure, no
 * Three.js dependency - directly unit-testable. */
export function velocitySpeedKms(vx: number, vy: number, vz: number): number {
  return Math.sqrt(vx * vx + vy * vy + vz * vz);
}

/** Normalized `[x, y, z]` direction from a raw velocity triple, or `null`
 * for a (degenerate) zero vector - there is no meaningful direction to
 * draw an arrow along in that case, and `createVelocityVectorsLayer` below
 * skips such an object entirely rather than drawing a zero-length/NaN
 * arrow. Pure, no Three.js dependency. */
export function velocityDirection(
  vx: number,
  vy: number,
  vz: number,
): [number, number, number] | null {
  const speed = velocitySpeedKms(vx, vy, vz);
  if (!Number.isFinite(speed) || speed <= 0) {
    return null;
  }
  return [vx / speed, vy / speed, vz / speed];
}

/**
 * The artistic length-scale function (pc) described in
 * `ARROW_LENGTH_SCALE_PC_PER_KMS`'s docstring above: linear in speed, then
 * clamped to `[MIN_ARROW_LENGTH_PC, MAX_ARROW_LENGTH_PC]`. Pure, no
 * Three.js dependency - directly unit-testable against the documented
 * reference points (Barnard's Star, the dataset's min/median/outlier).
 */
export function velocityArrowLengthPc(speedKms: number): number {
  const clampedSpeed = Math.max(speedKms, 0);
  const raw = clampedSpeed * ARROW_LENGTH_SCALE_PC_PER_KMS;
  return Math.min(Math.max(raw, MIN_ARROW_LENGTH_PC), MAX_ARROW_LENGTH_PC);
}

/**
 * The in-Local-Bubble stars a velocity arrow should be drawn for: a
 * non-null `velocity` block (Story #230/#286 already scoped data
 * acquisition to exactly the in-bubble stars, so this alone is normally
 * sufficient) AND, defensively, a real `distance_pc <= bubbleOuterRadiusPc`
 * check - mirroring Epic #229's own explicit "use the REAL-DISTANCE check,
 * not a group tag" principle (`lod.ts`'s `isStarMarkerShrinkEligible`/
 * `passesDenseBatchLod` precedent) rather than trusting the upstream
 * pipeline's scoping alone.
 *
 * Story #287: widened from the RECONS dense-batch sphere
 * (`denseBatchRadiusPc`, ~11.26pc) to the full Local Bubble
 * (`bubbleOuterRadiusPc`, ~60pc, `objects.ts`'s `bubbleOuterRadiusPcFrom` -
 * the SAME derivation `main.ts` already uses elsewhere), per Epic #285 -
 * this is what carries `createVelocityVectorsLayer`/
 * `createVelocitySpeedLabelsLayer`/`main.ts`'s motion-player population
 * (`animatedStars`, `motionTrail.ts`'s trails) all along with it, since
 * every one of those reuses this same function's result rather than
 * re-selecting independently. `bubbleOuterRadiusPc === null` or `<= 0`
 * (scene not loaded yet, or no Local Bubble layer in this scene) skips the
 * distance check entirely, matching `lod.ts`'s `isCameraInsideLocalBubble`'s
 * own "nothing to be inside of yet" convention for that sentinel - renamed
 * from this function's original `starsWithVelocityInSphere`
 * (denseBatchRadiusPc-keyed) name now that "sphere" no longer describes the
 * gating volume.
 */
export function starsWithVelocityInLocalBubble(
  objects: readonly SceneObject[],
  bubbleOuterRadiusPc: number | null,
): SceneObject[] {
  return objects.filter((obj) => {
    if (!obj.velocity) {
      return false;
    }
    if (bubbleOuterRadiusPc === null || bubbleOuterRadiusPc <= 0) {
      return true;
    }
    return obj.distance_pc <= bubbleOuterRadiusPc;
  });
}

/**
 * Builds one arrow (shaft `Line` + cone-head `Mesh`) from `origin` along
 * unit `direction`, `length` pc long, in `color`. `dashed` selects a
 * `LineDashedMaterial` shaft (tangential-only vectors, issue #231 AC #5)
 * over a plain `LineBasicMaterial` one (full 3D vectors) - `Line.
 * computeLineDistances()` is called for the dashed case, required for
 * `LineDashedMaterial` to render its dash pattern at all (undocumented
 * three.js gotcha: without it, a dashed line renders fully solid).
 *
 * Deliberately NOT `THREE.ArrowHelper` - that built-in always uses a plain
 * (non-dashed) `LineBasicMaterial` shaft with no per-instance opacity/color
 * split between shaft and head, which can't produce the dashed, distinctly-
 * colored tangential-only style this Story's AC #5 requires. Hand-built
 * here instead, matching this app's existing convention
 * (`structures.ts`/`denseBatchBoundary.ts`) of small, purpose-built
 * geometry over library shortcuts once the built-in stops fitting.
 */
function buildArrow(
  origin: Vector3,
  direction: Vector3,
  length: number,
  color: number,
  dashed: boolean,
  opacity: number,
): Group {
  const group = new Group();

  const headLength = length * HEAD_LENGTH_FRACTION;
  const headRadius = headLength * HEAD_WIDTH_FRACTION;
  const shaftLength = Math.max(length - headLength, 0);

  const shaftEnd = origin.clone().addScaledVector(direction, shaftLength);

  const shaftGeometry = new BufferGeometry();
  shaftGeometry.setAttribute(
    "position",
    new Float32BufferAttribute(
      [origin.x, origin.y, origin.z, shaftEnd.x, shaftEnd.y, shaftEnd.z],
      3,
    ),
  );
  const shaftMaterial = dashed
    ? new LineDashedMaterial({
        color,
        transparent: true,
        opacity,
        dashSize: DASH_SIZE_PC,
        gapSize: GAP_SIZE_PC,
      })
    : new LineBasicMaterial({ color, transparent: true, opacity });
  const shaft = new Line(shaftGeometry, shaftMaterial);
  if (dashed) {
    // Required for LineDashedMaterial to actually render dashed rather
    // than solid - see this function's docstring.
    shaft.computeLineDistances();
  }
  group.add(shaft);

  if (headLength > 0) {
    const headGeometry = new ConeGeometry(headRadius, headLength, HEAD_RADIAL_SEGMENTS);
    const headMaterial = new MeshBasicMaterial({ color, transparent: true, opacity });
    const head = new Mesh(headGeometry, headMaterial);
    // ConeGeometry is centered at the origin along local +Y, apex up -
    // `setFromUnitVectors` rotates that local +Y to point along `direction`,
    // so the apex ends up pointing the way the star is moving (matching
    // `THREE.ArrowHelper`'s own cone-orientation convention).
    head.quaternion.setFromUnitVectors(HALF_UP, direction);
    head.position.copy(shaftEnd).addScaledVector(direction, headLength / 2);
    group.add(head);
  }

  return group;
}

/**
 * Builds the full velocity-vectors layer: one arrow per
 * `starsWithVelocityInLocalBubble` result, anchored at the star's own
 * `position_pc` and pointing along its normalized velocity. Stars with
 * `radial_velocity_known: false` (tangential-only) render as dashed,
 * lower-opacity, distinctly-colored arrows (issue #231 AC #5); every other
 * in-bubble star with velocity data gets a solid full-3D arrow.
 *
 * Always returns a `Group` (never `null`, unlike the optional `structures.*`
 * layers in `structures.ts`) - an empty scene/no in-bubble velocity data
 * still yields a valid, empty group, since `main.ts` needs a stable
 * reference to toggle `.visible` on regardless. Starts `visible = false`;
 * `main.ts`'s Local-Bubble-gated toggle (Story #287; mirrors
 * `isDenseBatchBoundaryVisible`'s own camera-driven show/hide) is what turns
 * it on.
 */
export function createVelocityVectorsLayer(
  objects: readonly SceneObject[],
  bubbleOuterRadiusPc: number | null,
): Group {
  const group = new Group();
  group.name = "velocity-vectors";
  group.visible = false;

  for (const obj of starsWithVelocityInLocalBubble(objects, bubbleOuterRadiusPc)) {
    const velocity = obj.velocity;
    if (!velocity) {
      continue;
    }
    const direction = velocityDirection(velocity.vx_kms, velocity.vy_kms, velocity.vz_kms);
    if (!direction) {
      // Degenerate zero-vector case (issue #231's defensive handling, see
      // `velocityDirection`'s docstring) - no meaningful direction to draw.
      continue;
    }
    const speedKms = velocitySpeedKms(velocity.vx_kms, velocity.vy_kms, velocity.vz_kms);
    const length = velocityArrowLengthPc(speedKms);
    const origin = new Vector3(...obj.position_pc);
    const dir = new Vector3(...direction);

    const arrow = velocity.radial_velocity_known
      ? buildArrow(origin, dir, length, FULL_VECTOR_COLOR, false, FULL_VECTOR_OPACITY)
      : buildArrow(origin, dir, length, TANGENTIAL_VECTOR_COLOR, true, TANGENTIAL_VECTOR_OPACITY);
    arrow.name = `velocity-vector-${obj.id}`;
    group.add(arrow);
  }

  return group;
}

/**
 * Issue #231's exit-hides-vectors rule (AC #3), as a pure decision: the
 * toggle's next ON/OFF state given its current state and whether the camera
 * is inside the gating volume RIGHT NOW - if the camera has just left it,
 * the toggle is forced OFF regardless of its prior state (no stale display
 * the user can't currently turn off); otherwise the toggle's own state is
 * left untouched (a click, handled separately in `main.ts`, is the only
 * other thing that can change it). Pure so this specific business rule -
 * not just plain enable/disable - is directly unit-testable without a DOM/
 * `main.ts` harness.
 *
 * Story #287: the gating volume `main.ts` now passes is the Local Bubble
 * (`lod.ts`'s `isCameraInsideLocalBubble`), widened from the original
 * RECONS dense-batch sphere - this function's own logic is unchanged, only
 * what its caller feeds it as `insideLocalBubbleNow`.
 */
export function nextVelocityVectorsToggleOn(currentlyOn: boolean, insideLocalBubbleNow: boolean): boolean {
  if (!insideLocalBubbleNow) {
    return false;
  }
  return currentlyOn;
}

/** Whether the vectors layer itself should be visible: the toggle must be
 * ON AND the camera must currently be inside the gating volume (issue #231
 * AC: exiting it hides the vectors immediately, even before any further
 * click - see `nextVelocityVectorsToggleOn` above for the companion rule
 * that also forces the toggle itself back OFF in that same case). Story
 * #287: that volume is now the Local Bubble, not the RECONS sphere - see
 * `nextVelocityVectorsToggleOn`'s docstring. */
export function velocityVectorsVisible(toggleOn: boolean, insideLocalBubble: boolean): boolean {
  return toggleOn && insideLocalBubble;
}

/**
 * Issue #236, part 2: per-arrow speed labels ("31.5 km/s"), density-
 * controlled the SAME way `scene/labels.ts`'s star NAME labels are - via
 * that module's generic, already object-agnostic `selectNearestLabels`/
 * `LabelRankCandidate` nearest-camera-distance-ranked cap - but through a
 * NEW, independent, FINITE cap constant (`VELOCITY_SPEED_LABEL_MAX_VISIBLE`
 * below), never `labels.ts`'s own `DENSE_BATCH_MAX_VISIBLE_LABELS` (issue
 * #159 deliberately set that to `Number.POSITIVE_INFINITY` for star NAME
 * labels specifically - reusing it here would show all ~127 speed labels
 * simultaneously, exactly the "не захламлять вьюпорт" clutter the human
 * owner explicitly asked this Story to avoid).
 */

/** Hard cap on how many arrow speed labels render simultaneously - the
 * density control this whole section exists for. Deliberately its own
 * constant, not `labels.ts`'s `MAX_VISIBLE_LABELS` (60, tuned for the ~605-
 * object general catalog) or `DENSE_BATCH_MAX_VISIBLE_LABELS` (uncapped,
 * issue #159 - see this section's docstring above for why that one in
 * particular would be wrong here): this pool is a different, much smaller
 * population (Story #287: ~156 in-Local-Bubble velocity arrows, up from the
 * original ~127-star RECONS-sphere-only pool) with a different readability
 * target (a handful of speed numbers near the camera, not "every arrow
 * labeled"). Live-tuned at "Fit to nearest-stars sphere" zoom with vectors
 * toggled on: `20` keeps the label set legible - readable at a glance,
 * doesn't overlap into an unreadable wall of numbers - while still showing
 * enough of the nearest arrows that the density control itself is obviously
 * working (not so tight it reads as "almost no labels"). */
export const VELOCITY_SPEED_LABEL_MAX_VISIBLE = 20;

/** Formats a 3D speed (km/s) for on-screen display, e.g. `"31.5 km/s"` -
 * one decimal place, matching this issue's own example text. Pure, no
 * Three.js/DOM dependency - directly unit-testable. */
export function formatSpeedKms(speedKms: number): string {
  return `${speedKms.toFixed(1)} km/s`;
}

/** One speed-label's ranking input for `selectVisibleVelocitySpeedLabelIds`
 * below - deliberately NOT `labels.ts`'s `LabelRankCandidate` itself (no
 * `isSelected` field): there is no "selected arrow" concept for velocity
 * vectors, so every candidate ranks purely by camera distance. */
export interface VelocitySpeedLabelCandidate {
  objectId: string;
  cameraDistancePc: number;
}

/**
 * The pure candidate/cap-selection decision behind this Story's density
 * control: given every in-bubble arrow's speed-label candidate and whether
 * the arrows themselves are currently visible (`velocityVectorsVisible`'s
 * own result - the same toggle-ON-AND-inside-Local-Bubble gate the arrows
 * use, so a speed label can never be visible while its arrow isn't),
 * returns the ids that should actually render.
 *
 * `arrowsVisible: false` short-circuits to an empty set without even
 * touching `selectNearestLabels` - the density cap below is irrelevant if
 * nothing should be visible at all (arrows off, or camera outside the
 * Local Bubble), and this guarantees "no orphaned speed labels"
 * structurally rather than by relying on every caller to remember the gate.
 *
 * `arrowsVisible: true` delegates to `scene/labels.ts`'s exported, generic
 * `selectNearestLabels` - reused directly, per issue #236's brief, rather
 * than reimplemented - through `maxVisible` (defaulting to this module's own
 * `VELOCITY_SPEED_LABEL_MAX_VISIBLE`, NEVER `labels.ts`'s
 * `DENSE_BATCH_MAX_VISIBLE_LABELS` - see that constant's docstring for why).
 * Every candidate is passed through with `isSelected: false` - pure nearest-
 * camera-distance ranking, no exemption.
 *
 * Pure and DOM-free (unlike `createVelocitySpeedLabelsLayer` below, which
 * touches `document`/`CSS2DObject` and so - mirroring `labels.ts`'s own
 * `createLabelsLayer`/`createSunLabel` convention - isn't itself unit-
 * tested under this repo's `environment: "node"` vitest config): this is
 * the actual "speed-label candidate/cap selection logic" `main.ts`'s
 * `updateLabelVisibility` calls every frame, directly unit-testable without
 * a DOM harness.
 */
export function selectVisibleVelocitySpeedLabelIds(
  candidates: readonly VelocitySpeedLabelCandidate[],
  arrowsVisible: boolean,
  maxVisible: number = VELOCITY_SPEED_LABEL_MAX_VISIBLE,
): Set<string> {
  if (!arrowsVisible) {
    return new Set();
  }
  const rankCandidates: LabelRankCandidate[] = candidates.map((c) => ({
    id: c.objectId,
    cameraDistancePc: c.cameraDistancePc,
    isSelected: false,
  }));
  return selectNearestLabels(rankCandidates, maxVisible);
}

/** One arrow's speed label: mirrors `scene/labels.ts`'s `CatalogLabel`
 * shape (the object it belongs to to identify it, the `CSS2DObject` added
 * to the scene graph, and the underlying DOM element) so `main.ts` can
 * drive this pool's visibility through the exact same
 * `selectNearestLabels`-based pattern already used for star name labels. */
export interface VelocitySpeedLabel {
  /** The `SceneObject.id` this speed label belongs to - matches the
   * corresponding arrow's `velocity-vector-${id}` group name, though the
   * two are never cross-referenced directly (each is independently derived
   * from the same `starsWithVelocityInLocalBubble` pool). */
  objectId: string;
  css2dObject: CSS2DObject;
  element: HTMLDivElement;
}

/**
 * Builds one `CSS2DObject` speed label per in-bubble velocity arrow
 * (`starsWithVelocityInLocalBubble`, the SAME pool `createVelocityVectorsLayer`
 * draws arrows for), anchored at that arrow's own tip (`origin +
 * direction * length` - the same point `buildArrow` above positions its
 * cone head at) so the label reads as "belonging to" that specific arrow
 * rather than floating at the star's own marker position (already occupied
 * by that star's name label, `labels.ts`'s `createLabelsLayer`).
 *
 * A separate function/layer from `createVelocityVectorsLayer` rather than
 * building labels into that same pass: the two are independently toggled
 * from different call sites in `main.ts` (arrows via
 * `velocityVectorsGroup.visible`, labels via the density-capped
 * `selectNearestLabels` pool driven from `updateLabelVisibility`), so
 * keeping them as separate `Object3D` trees - like `labels.ts`'s
 * `createLabelsLayer` is already separate from `objects.ts`'s catalog
 * marker layer - keeps each concern simple to reason about and test in
 * isolation, at the cost of one small, cheap second pass over the same
 * (~127-object) pool.
 *
 * Always returns a real (possibly empty) group/labels pair, same
 * "never null" convention as `createVelocityVectorsLayer` above - `main.ts`
 * needs a stable reference regardless of whether the loaded scene has any
 * in-bubble velocity data.
 */
export function createVelocitySpeedLabelsLayer(
  objects: readonly SceneObject[],
  bubbleOuterRadiusPc: number | null,
): { group: Object3D; labels: VelocitySpeedLabel[] } {
  const group = new Object3D();
  group.name = "velocity-speed-labels";

  const labels: VelocitySpeedLabel[] = [];

  for (const obj of starsWithVelocityInLocalBubble(objects, bubbleOuterRadiusPc)) {
    const velocity = obj.velocity;
    if (!velocity) {
      continue;
    }
    const direction = velocityDirection(velocity.vx_kms, velocity.vy_kms, velocity.vz_kms);
    if (!direction) {
      // Same degenerate zero-vector skip as `createVelocityVectorsLayer` -
      // no arrow is drawn for this star, so no speed label either.
      continue;
    }
    const speedKms = velocitySpeedKms(velocity.vx_kms, velocity.vy_kms, velocity.vz_kms);
    const length = velocityArrowLengthPc(speedKms);
    const origin = new Vector3(...obj.position_pc);
    const dir = new Vector3(...direction);
    const tip = origin.clone().addScaledVector(dir, length);

    const element = document.createElement("div");
    // Issue #236 AC: a visually distinct class from star NAME labels
    // (`.object-label`/`.selected` in `style.css`) so the two are never
    // confused, even when both are visible near the same star.
    element.className = "velocity-speed-label";
    element.textContent = formatSpeedKms(speedKms);

    const css2dObject = new CSS2DObject(element);
    css2dObject.position.copy(tip);
    group.add(css2dObject);

    labels.push({ objectId: obj.id, css2dObject, element });
  }

  return { group, labels };
}
