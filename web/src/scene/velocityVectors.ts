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
  Vector3,
} from "three";
import type { SceneObject } from "./sceneTypes";

/**
 * Story #231: directional velocity-vector arrows for the ~127 stars within
 * the RECONS-dense-batch sphere that carry Story #230's `velocity` field
 * (`vx_kms`/`vy_kms`/`vz_kms`, heliocentric Galactic Cartesian - the SAME
 * axes as `SceneObject.position_pc`, so an arrow anchored at a star's own
 * position and pointing along its normalized velocity needs no extra
 * coordinate transform). Purely additive: a standalone `THREE.Group` added
 * directly to the scene, entirely independent of the InstancedMesh catalog
 * buckets (`objects.ts`) and picking (`picking.ts`), so selecting a star
 * (Inspector) is unaffected (issue #231 AC).
 *
 * At most ~127 arrows - nowhere near the main catalog's draw-call budget
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

/** Arrowhead (cone) length as a fraction of the total arrow length -
 * matches `THREE.ArrowHelper`'s own default proportion, kept here since
 * this module builds its head/shaft manually (to support the dashed-line
 * tangential-only style `ArrowHelper` itself can't produce). */
const HEAD_LENGTH_FRACTION = 0.25;
/** Arrowhead base radius as a fraction of its own length - same
 * `ArrowHelper`-matching proportion (its default `headWidth` is `0.2 *
 * headLength`, doubled here for a slightly more visible cone at this small
 * scale). */
const HEAD_WIDTH_FRACTION = 0.4;

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
 * The in-sphere stars a velocity arrow should be drawn for: a non-null
 * `velocity` block (Story #230 already scoped data acquisition to exactly
 * the 127 in-sphere stars, so this alone is normally sufficient) AND,
 * defensively, a real `distance_pc <= denseBatchRadiusPc` check - mirroring
 * Epic #229's own explicit "use the REAL-DISTANCE check, not a group tag"
 * principle (`lod.ts`'s `isStarMarkerShrinkEligible`/
 * `passesDenseBatchLod` precedent) rather than trusting the upstream
 * pipeline's scoping alone. `denseBatchRadiusPc <= 0` (scene not loaded
 * yet) skips the distance check entirely, matching `lod.ts`'s own "nothing
 * to be inside of yet" convention for that sentinel.
 */
export function starsWithVelocityInSphere(
  objects: readonly SceneObject[],
  denseBatchRadiusPc: number,
): SceneObject[] {
  return objects.filter((obj) => {
    if (!obj.velocity) {
      return false;
    }
    if (denseBatchRadiusPc <= 0) {
      return true;
    }
    return obj.distance_pc <= denseBatchRadiusPc;
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
    const headGeometry = new ConeGeometry(headRadius, headLength, 10);
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
 * `starsWithVelocityInSphere` result, anchored at the star's own
 * `position_pc` and pointing along its normalized velocity. Stars with
 * `radial_velocity_known: false` (tangential-only, ~9 of the 127) render as
 * dashed, lower-opacity, distinctly-colored arrows (issue #231 AC #5); every
 * other in-sphere star with velocity data gets a solid full-3D arrow.
 *
 * Always returns a `Group` (never `null`, unlike the optional `structures.*`
 * layers in `structures.ts`) - an empty scene/no in-sphere velocity data
 * still yields a valid, empty group, since `main.ts` needs a stable
 * reference to toggle `.visible` on regardless. Starts `visible = false`;
 * `main.ts`'s sphere-gated toggle (mirroring `isDenseBatchBoundaryVisible`'s
 * own camera-driven show/hide) is what turns it on.
 */
export function createVelocityVectorsLayer(
  objects: readonly SceneObject[],
  denseBatchRadiusPc: number,
): Group {
  const group = new Group();
  group.name = "velocity-vectors";
  group.visible = false;

  for (const obj of starsWithVelocityInSphere(objects, denseBatchRadiusPc)) {
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
 * is inside the sphere RIGHT NOW - if the camera has just left the sphere,
 * the toggle is forced OFF regardless of its prior state (no stale display
 * the user can't currently turn off); otherwise the toggle's own state is
 * left untouched (a click, handled separately in `main.ts`, is the only
 * other thing that can change it). Pure so this specific business rule -
 * not just plain enable/disable - is directly unit-testable without a DOM/
 * `main.ts` harness.
 */
export function nextVelocityVectorsToggleOn(currentlyOn: boolean, insideSphereNow: boolean): boolean {
  if (!insideSphereNow) {
    return false;
  }
  return currentlyOn;
}

/** Whether the vectors layer itself should be visible: the toggle must be
 * ON AND the camera must currently be inside the sphere (issue #231 AC:
 * exiting the sphere hides the vectors immediately, even before any further
 * click - see `nextVelocityVectorsToggleOn` above for the companion rule
 * that also forces the toggle itself back OFF in that same case). */
export function velocityVectorsVisible(toggleOn: boolean, insideSphere: boolean): boolean {
  return toggleOn && insideSphere;
}
