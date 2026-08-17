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

const DEFAULT_FIT_ALL_POSE = perspectivePose();

/**
 * "Fit all" (spec §29): frame the given set of currently-visible object
 * positions (already radius/layer-filtered by the caller). Computes an
 * axis-aligned bounding-sphere-ish radius (max distance from the centroid
 * to any point, which is a valid - if not minimal - bounding radius) and
 * places the camera back along the default "Perspective" viewing direction,
 * scaled so the bounding radius fits within the camera's vertical field of
 * view.
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
  // A single object (boundingRadius === 0) still needs a sane, non-zero
  // viewing distance.
  const effectiveRadius = Math.max(boundingRadius, 10);

  const halfFovRad = (verticalFovDeg / 2) * (Math.PI / 180);
  const distance = (effectiveRadius / Math.sin(halfFovRad)) * paddingFactor;

  // Reuse the default perspective's viewing direction (normalized), just
  // rescaled to the fit distance and re-centered on the target centroid.
  const [px, py, pz] = DEFAULT_FIT_ALL_POSE.position;
  const dirLength = Math.sqrt(px * px + py * py + pz * pz);
  const [dx, dy, dz] = [px / dirLength, py / dirLength, pz / dirLength];

  return {
    position: [cx + dx * distance, cy + dy * distance, cz + dz * distance],
    target: [cx, cy, cz],
  };
}
