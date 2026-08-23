/**
 * Camera preset target/position computation (spec Idea.md §29: "Perspective,
 * Top view, Galactic Plane / face-on, Edge-on, Sun-centered, Fit all").
 *
 * Kept as pure functions over plain number tuples (no `THREE` import) so the
 * geometry can be unit-tested without a WebGL context (spec §38) - the
 * caller (`ui/cameraPresetControls.ts`) is responsible for applying a
 * `CameraPose` to the actual `THREE.PerspectiveCamera`/`OrbitControls`.
 *
 * The scene's camera convention (`scene/camera.ts`) is Z-up (`camera.up =
 * (0,0,1)`), matching spec §6's Galactic frame (+Z -> North Galactic Pole)
 * directly - so these poses are expressed in the same XYZ pc coordinates as
 * `scene.json`'s `position_pc`, with no axis remapping.
 *
 * Judgment call: spec §29 lists "Top view" and "Galactic Plane / face-on" as
 * two separate presets, but its own elaboration describes only one distinct
 * behavior ("View approximately along Galactic Z. Useful for XY
 * structure.") - it never says how a plain "Top view" should differ from
 * that. Rather than invent an unstated distinction, both presets here
 * compute the same top-down-along-Z pose (see `topViewPose`/`faceOnPose`
 * below, which intentionally share their implementation); they are exposed
 * as two separate UI buttons/entries for spec-completeness. Flagged in the
 * PR description as a judgment call.
 */

export interface CameraPose {
  position: [number, number, number];
  target: [number, number, number];
}

/** Default "Perspective" view - matches `scene/camera.ts`'s original
 * default framing (off-axis and elevated so the Galactic Plane, the Sun,
 * and objects above/below the plane are all visible at once, spec §30). */
export function perspectivePose(): CameraPose {
  return { position: [700, -700, 450], target: [0, 0, 0] };
}

/** Looking straight down the +Z axis at the origin. See the module-level
 * judgment-call note: computed identically to `faceOnPose`. */
export function topViewPose(radiusPc: number): CameraPose {
  const height = Math.max(radiusPc * 1.6, 50);
  return { position: [0, 0, height], target: [0, 0, 0] };
}

/** "Galactic Plane / face-on" (spec §29): "View approximately along
 * Galactic Z. Useful for XY structure." See the module-level judgment-call
 * note: computed identically to `topViewPose`. */
export function faceOnPose(radiusPc: number): CameraPose {
  return topViewPose(radiusPc);
}

/** "Edge-on" (spec §29): "View approximately parallel to the Galactic
 * Plane. Useful for showing vertical displacement and the Radcliffe Wave."
 * Camera sits in the Z=0 plane looking toward the origin along -Y, with Z
 * still "up" on screen (camera.up stays (0,0,1) - see `scene/camera.ts`) so
 * any Z displacement (e.g. the Radcliffe Wave's vertical wave shape) reads
 * as vertical screen displacement rather than being foreshortened. */
export function edgeOnPose(radiusPc: number): CameraPose {
  const distance = Math.max(radiusPc * 1.6, 50);
  return { position: [0, -distance, 0], target: [0, 0, 0] };
}

/** "Sun-centered" (spec §29): centered on the Sun (origin, by definition of
 * the heliocentric frame, spec §6) but zoomed in close - distinct from the
 * default "Perspective" overview, which is deliberately zoomed out to show
 * the whole 800pc-scale neighborhood. */
export function sunCenteredPose(): CameraPose {
  return { position: [60, -60, 40], target: [0, 0, 0] };
}

/** Same viewing direction as `sunCenteredPose` (deliberately, for visual
 * consistency between the two "zoomed in on one point" presets) - just
 * re-centered on an arbitrary object and distance-scaled by that object's
 * own marker radius instead of Sun-centered's fixed distance. */
const OBJECT_FRAME_DIRECTION: [number, number, number] = [60, -60, 40];

/** Framing-distance floor (pc) so a point-like object (a star, marker
 * radius at `MIN_MARKER_RADIUS_PC` in `scene/objects.ts`) still gets a
 * sane, non-claustrophobic close-up rather than a near-zero-distance
 * camera sitting almost inside its marker. */
const OBJECT_FRAME_MIN_DISTANCE_PC = 25;

/** Distance grows with the object's own marker radius (issue #106's
 * "distance proportional to the object's own marker radius" acceptance
 * criterion) so a large extended object (e.g. a molecular cloud, up to
 * `MAX_MARKER_RADIUS_PC` = 45pc) is framed wide enough to see its full
 * marker, while a compact one (a star) stays close, at
 * `OBJECT_FRAME_MIN_DISTANCE_PC`. Chosen so the max marker radius (45pc)
 * still produces a "close-up" (270pc) well inside the default Perspective
 * view's ~950pc distance. */
const OBJECT_FRAME_RADIUS_MULTIPLIER = 6;

function normalizedDirection(v: readonly [number, number, number]): [number, number, number] {
  const length = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / length, v[1] / length, v[2] / length];
}

/**
 * "Object-centered" (issue #106, generalizing `sunCenteredPose`): frames an
 * arbitrary catalog object closely, for the search/go-to-object feature
 * (spec §2.6). `markerRadiusPc` is the object's own rendered marker radius
 * (`scene/objects.ts`'s `markerRadiusPc(obj.size_pc)`) - passed in rather
 * than computed here so this module keeps its no-`THREE`,
 * rendering-independent purity (see the module docstring); the caller
 * (`main.ts`) already has that value at hand from the catalog bucket/scene
 * object.
 */
export function objectCenteredPose(
  positionPc: readonly [number, number, number],
  markerRadiusPc: number,
): CameraPose {
  const [ux, uy, uz] = normalizedDirection(OBJECT_FRAME_DIRECTION);
  const distance = Math.max(markerRadiusPc * OBJECT_FRAME_RADIUS_MULTIPLIER, OBJECT_FRAME_MIN_DISTANCE_PC);
  const [tx, ty, tz] = positionPc;
  return {
    position: [tx + ux * distance, ty + uy * distance, tz + uz * distance],
    target: [tx, ty, tz],
  };
}

const DEFAULT_FIT_ALL_POSE = perspectivePose();

/**
 * Issue #197: generalizes `fitAllPose`'s own bounding-sphere-fit math (below)
 * to an arbitrary, caller-supplied sphere (`center`/`radius`) rather than one
 * derived from a list of positions - the shared building block for the
 * bottom-left toolbar's "Fit to Local Bubble" (the Local Bubble's real
 * `center_pc`/`max(semi_axes_pc)` extent) and "Fit to Nearest-Stars Sphere"
 * (origin-centered, `denseBatchRadiusPc`) buttons, neither of which starts
 * from a list of object positions the way "Fit all"/"Show All" does.
 *
 * Places the camera back along the same default "Perspective" viewing
 * direction `fitAllPose` uses (for visual consistency between every
 * bounding-sphere-style fit in the app), scaled so `radius` fits within the
 * camera's vertical field of view, with the same non-zero-radius floor
 * `fitAllPose` applies for a single/point-like target.
 */
export function fitSpherePose(
  center: readonly [number, number, number],
  radius: number,
  verticalFovDeg = 50,
  paddingFactor = 1.35,
): CameraPose {
  const [cx, cy, cz] = center;
  // A point-like sphere (radius 0, or very small) still needs a sane,
  // non-zero viewing distance.
  const effectiveRadius = Math.max(radius, 10);

  const halfFovRad = (verticalFovDeg / 2) * (Math.PI / 180);
  const distance = (effectiveRadius / Math.sin(halfFovRad)) * paddingFactor;

  // Reuse the default perspective's viewing direction (normalized), just
  // rescaled to the fit distance and re-centered on the given center.
  const [px, py, pz] = DEFAULT_FIT_ALL_POSE.position;
  const dirLength = Math.sqrt(px * px + py * py + pz * pz);
  const [dx, dy, dz] = [px / dirLength, py / dirLength, pz / dirLength];

  return {
    position: [cx + dx * distance, cy + dy * distance, cz + dz * distance],
    target: [cx, cy, cz],
  };
}

/**
 * "Fit all" (spec §29): frame the given set of currently-visible object
 * positions (already radius/layer-filtered by the caller). Computes an
 * axis-aligned bounding-sphere-ish radius (max distance from the centroid
 * to any point, which is a valid - if not minimal - bounding radius) around
 * that centroid, then delegates to `fitSpherePose` above for the actual
 * camera placement (issue #197 refactor - signature/observable behavior
 * unchanged from before that refactor).
 *
 * Falls back to the default Perspective pose when `positions` is empty
 * (e.g. every layer toggled off / radius filtered to nothing) rather than
 * computing a degenerate zero-size fit.
 */
export function fitAllPose(
  positions: ReadonlyArray<readonly [number, number, number]>,
  verticalFovDeg = 50,
  paddingFactor = 1.35,
): CameraPose {
  if (positions.length === 0) {
    return DEFAULT_FIT_ALL_POSE;
  }

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (const [x, y, z] of positions) {
    cx += x;
    cy += y;
    cz += z;
  }
  cx /= positions.length;
  cy /= positions.length;
  cz /= positions.length;

  let boundingRadius = 0;
  for (const [x, y, z] of positions) {
    const dx = x - cx;
    const dy = y - cy;
    const dz = z - cz;
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (dist > boundingRadius) {
      boundingRadius = dist;
    }
  }

  return fitSpherePose([cx, cy, cz], boundingRadius, verticalFovDeg, paddingFactor);
}
