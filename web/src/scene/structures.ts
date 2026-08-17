import {
  BufferGeometry,
  Float32BufferAttribute,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
} from "three";
import type {
  GouldBeltStructure,
  LocalBubbleStructure,
  RadcliffeWaveStructure,
} from "./sceneTypes";

/**
 * Model-layer geometry for the three structures `scene.json`'s `structures`
 * block carries (spec Idea.md §16-§18, §21, §23). Story #64 never rendered
 * these at all - this is new geometry built from scratch for Story #65, not
 * a toggle bolted onto pre-existing meshes.
 */

const POINTS_PER_DEG_RATIO_HINT = 200; // matches the notebook's default `n`

/**
 * Gould Belt annulus points (spec §16), parametrized EXACTLY the way
 * `notebooks/local_neighborhood.ipynb`'s `gould_belt_ellipse_points`
 * function does, to stay numerically consistent with the diagnostic plot
 * already validated there:
 *
 *   1. an ellipse in its own (major/minor radius) plane;
 *   2. rotated by `inclination_deg` about the x-axis;
 *   3. then rotated by `orientation_deg` about the z-axis;
 *   4. then translated by `center`.
 *
 * `t` runs 0..2*pi inclusive over `n` samples (`numpy.linspace(0, 2*pi,
 * n)` semantics: `n-1` equal steps, both endpoints included) so the first
 * and last returned points coincide - the annulus closes on itself, which
 * is what makes a plain (non-loop) `THREE.Line` through these points render
 * as a closed ring with no extra "closing" logic needed.
 *
 * Pure/no-Three.js-dependency so it's unit-testable (spec §38) against
 * known reference points without a WebGL context.
 */
export function gouldBeltEllipsePoints(
  model: GouldBeltStructure,
  n = POINTS_PER_DEG_RATIO_HINT,
): [number, number, number][] {
  const inclinationRad = (model.inclination_deg * Math.PI) / 180;
  const orientationRad = (model.orientation_deg * Math.PI) / 180;
  const cosIncl = Math.cos(inclinationRad);
  const sinIncl = Math.sin(inclinationRad);
  const cosOrient = Math.cos(orientationRad);
  const sinOrient = Math.sin(orientationRad);

  const points: [number, number, number][] = [];
  for (let i = 0; i < n; i++) {
    const t = (2 * Math.PI * i) / (n - 1);
    const x0 = model.major_radius_pc * Math.cos(t);
    const y0 = model.minor_radius_pc * Math.sin(t);

    // Step 2: rotate about x-axis by inclination.
    const x1 = x0;
    const y1 = y0 * cosIncl;
    const z1 = y0 * sinIncl;

    // Step 3: rotate about z-axis by orientation.
    const x2 = x1 * cosOrient - y1 * sinOrient;
    const y2 = x1 * sinOrient + y1 * cosOrient;
    const z2 = z1;

    // Step 4: translate by center.
    points.push([x2 + model.center.x_pc, y2 + model.center.y_pc, z2 + model.center.z_pc]);
  }
  return points;
}

function lineFromPoints(points: ReadonlyArray<readonly [number, number, number]>, color: number): Line {
  const geometry = new BufferGeometry();
  const flat = new Float32Array(points.length * 3);
  points.forEach(([x, y, z], i) => {
    flat[i * 3] = x;
    flat[i * 3 + 1] = y;
    flat[i * 3 + 2] = z;
  });
  geometry.setAttribute("position", new Float32BufferAttribute(flat, 3));
  const material = new LineBasicMaterial({ color, transparent: true, opacity: 0.85 });
  return new Line(geometry, material);
}

/** Gould Belt color: warm orange, matching the notebook's diagnostic plot
 * (spec §30: "distinct object-category markers ... clear scientific model
 * overlays"). Visual-only choice (spec §19), not a scientific value. */
const GOULD_BELT_COLOR = 0xffa64d;
/** Radcliffe Wave color: cyan, matching the notebook's diagnostic plot. */
const RADCLIFFE_WAVE_COLOR = 0x4dd2ff;
/** Local Bubble color: pale violet, matching the notebook's diagnostic
 * plot's "mediumpurple". */
const LOCAL_BUBBLE_COLOR = 0xb18cff;

/**
 * Build the Gould Belt ring as a `THREE.Line`. Returns `null` if `model` is
 * missing or structurally incomplete (spec §38: "missing optional layers
 * do not break the application") rather than throwing.
 */
export function createGouldBeltLayer(model: GouldBeltStructure | undefined): Group | null {
  if (!model || !model.center || !Number.isFinite(model.major_radius_pc)) {
    return null;
  }
  const group = new Group();
  group.name = "gould-belt";
  const points = gouldBeltEllipsePoints(model);
  group.add(lineFromPoints(points, GOULD_BELT_COLOR));
  return group;
}

/**
 * Build the Radcliffe Wave spine as a `THREE.Line` directly through
 * `structures.radcliffe_wave.points` (spec §17: already a literal list of
 * `{s_pc, x_pc, y_pc, z_pc}` - no fitting/interpolation needed client-side,
 * the Python pipeline already produced the fitted curve).
 */
export function createRadcliffeWaveLayer(
  model: RadcliffeWaveStructure | undefined,
): Group | null {
  if (!model || !Array.isArray(model.points) || model.points.length < 2) {
    return null;
  }
  const group = new Group();
  group.name = "radcliffe-wave";
  const points: [number, number, number][] = model.points.map((p) => [p.x_pc, p.y_pc, p.z_pc]);
  group.add(lineFromPoints(points, RADCLIFFE_WAVE_COLOR));
  return group;
}

/**
 * Build the Local Bubble as a coarse translucent wireframe ellipsoid (spec
 * §18: "For MVP, a simplified volume is acceptable if backed by a
 * source... sphere / ellipsoid / mesh / point cloud boundary").
 *
 * Implementation shortcut (explicitly flagged, matching Story #65's brief
 * and the notebook's own documented precedent): a `THREE.SphereGeometry`
 * non-uniformly scaled by `semi_axes_pc.{a_pc,b_pc,c_pc}` along the mesh's
 * own local X/Y/Z, positioned at `center_pc`. The model's `orientation`
 * Euler angles (`long_axis_l_deg`/`long_axis_b_deg`/`theta_ell_deg`/etc.)
 * are NOT applied - `notebooks/local_neighborhood.ipynb` explicitly treats
 * the full orientation as out of scope for what it calls a "diagnostic
 * approximation" (see the cell producing `local_bubble_wireframe_points`),
 * and this Story takes the same shortcut for the same reason: an
 * axis-aligned ellipsoid is still a reasonable MVP visual for "roughly
 * where and how big the Local Bubble is", and adding the Euler-angle
 * rotation is a well-scoped follow-up rather than something this
 * interaction-layer Story needs to solve.
 */
export function createLocalBubbleLayer(model: LocalBubbleStructure | undefined): Group | null {
  if (!model || !model.center_pc || !model.semi_axes_pc) {
    return null;
  }
  const { a_pc, b_pc, c_pc } = model.semi_axes_pc;
  if (![a_pc, b_pc, c_pc].every((v) => Number.isFinite(v) && v > 0)) {
    return null;
  }

  const group = new Group();
  group.name = "local-bubble";

  const geometry = new SphereGeometry(1, 24, 16);
  const material = new MeshBasicMaterial({
    color: LOCAL_BUBBLE_COLOR,
    wireframe: true,
    transparent: true,
    opacity: 0.35,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.scale.set(a_pc, b_pc, c_pc);
  mesh.position.set(model.center_pc.x_pc, model.center_pc.y_pc, model.center_pc.z_pc);
  group.add(mesh);

  return group;
}
