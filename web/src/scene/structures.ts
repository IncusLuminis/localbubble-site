import {
  CatmullRomCurve3,
  Group,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  SphereGeometry,
  TubeGeometry,
  Vector3,
} from "three";
import { CSS2DObject } from "three/examples/jsm/renderers/CSS2DRenderer.js";
import type {
  GouldBeltStructure,
  LocalBubbleOrientation,
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

/**
 * Issue #124: both model-layer overlays (Gould Belt, Radcliffe Wave) used to
 * render via a shared `lineFromPoints` helper (`THREE.Line` +
 * `LineBasicMaterial`) - a hairline, effectively 1px and non-configurable in
 * WebGL. The human owner wants these two to read as thicker, ribbon-like
 * translucent bands instead, so this replaces that helper with a
 * `THREE.TubeGeometry` built along the same point arrays: a `Mesh` extruded
 * along a `THREE.CatmullRomCurve3` through `points`, with a small,
 * deliberately-uniform radius (`STRUCTURE_TUBE_RADIUS_PC`) and a translucent
 * `MeshBasicMaterial`, mirroring `createLocalBubbleLayer`'s own
 * translucent-structure-mesh conventions (`transparent: true`, `depthWrite:
 * false`) below it in this same file. Not exported - both call sites
 * (`createGouldBeltLayer`/`createRadcliffeWaveLayer`) are in this module.
 */
function tubeFromPoints(
  points: ReadonlyArray<readonly [number, number, number]>,
  color: number,
  closed: boolean,
): Mesh {
  const curvePoints = points.map(([x, y, z]) => new Vector3(x, y, z));
  const curve = new CatmullRomCurve3(curvePoints, closed);
  // Both structures' point arrays are already a dense, pre-fitted curve
  // (`gouldBeltEllipsePoints`'s own docstring; the Radcliffe Wave's 1500
  // `structures.radcliffe_wave.points` from the Python pipeline) - sampling
  // one tube segment per source point (up to 1500 for the Radcliffe Wave)
  // would multiply the tube's vertex count for no visible smoothness gain
  // over a coarser resampling of that same already-smooth curve, so this
  // caps `tubularSegments` well below the raw point count.
  const tubularSegments = Math.max(2, Math.min(curvePoints.length - 1, MAX_TUBULAR_SEGMENTS));
  const geometry = new TubeGeometry(
    curve,
    tubularSegments,
    STRUCTURE_TUBE_RADIUS_PC,
    STRUCTURE_TUBE_RADIAL_SEGMENTS,
    closed,
  );
  // Issue #115's opacity-tier convention for extended/diffuse structures
  // (`scene/objects.ts`'s `EXTENDED_STRUCTURE_OPACITY`, 0.35) is the
  // reference point for "translucent but still visible" in this app's
  // existing visual language - reused verbatim here (own constant, since
  // this is a different file/material instance) rather than picking a new
  // number, so both structure overlays and this file's own
  // `createLocalBubbleLayer` (opacity 0.35 below) agree on what
  // "translucent structure" looks like. `depthWrite: false` matches
  // `createLocalBubbleLayer`'s own choice, for the same reason: a solid
  // translucent mesh that writes depth would incorrectly occlude whatever
  // is behind it along the ribbon, rather than blending with it.
  const material = new MeshBasicMaterial({
    color,
    transparent: true,
    opacity: STRUCTURE_TUBE_OPACITY,
    depthWrite: false,
  });
  return new Mesh(geometry, material);
}

/** Tube radius (pc) for the Gould Belt / Radcliffe Wave translucent bands
 * (issue #124) - deliberately small relative to each structure's own extent
 * (Gould Belt: ~373pc major radius; Radcliffe Wave: ~3000pc long, per
 * `s_pc`), so both read as a visibly thicker band than the pre-#124
 * hairline `THREE.Line` without visually overpowering the catalog object
 * markers (2-45pc radius, `scene/objects.ts`'s `markerRadiusPc` tiers) or
 * the Local Bubble ellipsoid (60/60/162pc semi-axes) they share the scene
 * with. Judgment call (the issue's own words), not a scientific value (spec
 * §19) - tuned to be clearly visible as a band at the app's default
 * "Perspective" camera pose without reading as a solid pipe. */
const STRUCTURE_TUBE_RADIUS_PC = 8;

/** Radial segments (the tube's own cross-section resolution) - 8 is the
 * `TubeGeometry` default and is already enough for a soft, round-looking
 * translucent band at this radius; no visual benefit to more at this scale. */
const STRUCTURE_TUBE_RADIAL_SEGMENTS = 8;

/** Cap on `tubeFromPoints`'s `tubularSegments` - see that function's
 * docstring for why sampling one segment per raw source point is wasteful. */
const MAX_TUBULAR_SEGMENTS = 300;

/** Shared translucency for both structure-overlay tubes - see
 * `tubeFromPoints`'s docstring for why this reuses issue #115's
 * `EXTENDED_STRUCTURE_OPACITY` value (0.35) as its reference point. */
const STRUCTURE_TUBE_OPACITY = 0.35;

/** Issue #137: dim factor for this file's three structure-layer overlays
 * (Gould Belt / Radcliffe Wave tubes, Local Bubble ellipsoid) once the
 * camera is inside the RECONS dense batch's collection sphere - own
 * constant, not imported from `objects.ts`, matching this file's existing
 * convention (see `STRUCTURE_TUBE_OPACITY`'s own docstring) of duplicating a
 * shared tuning value per-file rather than creating a cross-file import for
 * what is conceptually the same choice. Kept numerically equal to
 * `objects.ts`'s `BACKGROUND_DIM_FACTOR` so every dimmed thing (catalog
 * buckets and structure overlays alike) recedes by the same proportion. */
const STRUCTURE_DIM_FACTOR = 0.4;

/**
 * Issue #124 (optional per the acceptance criteria): a small, unobtrusive
 * `CSS2DObject` label for a structure overlay, positioned at one
 * distinctive point along its curve. Deliberately its OWN CSS class
 * (`structure-label`, see `style.css`) rather than reusing `.object-label`/
 * `.object-label.selected` - those are catalog-object labels getting a
 * larger font in the parallel issue #123, and this label is meant to stay
 * smaller/lower-contrast than an object label, not track that change.
 *
 * Deliberately NOT added as a child inside `createGouldBeltLayer`/
 * `createRadcliffeWaveLayer` themselves - `document.createElement` isn't
 * available under this repo's `vitest.config.ts` (`environment: "node"`),
 * so folding DOM construction into those two functions would make them
 * untestable the same way `scene/labels.ts`'s `createSunLabel` already
 * isn't unit-tested for its own `document.createElement` call (see that
 * function's docstring). Instead `main.ts` calls `createGouldBeltLabel`/
 * `createRadcliffeWaveLabel` (below) itself and adds the result as a child
 * of the already-built layer group - mirroring exactly how it already
 * parents `createSunLabel()`'s result under `sunMarker.group` - so the
 * label still inherits that group's `visible` flag (already driven by the
 * existing "gould-belt"/"radcliffe-wave" `structureLayerItems` checkboxes
 * via `applyStructureVisibility`) without a new toggle, while keeping the
 * pure tube-geometry construction itself DOM-free and unit-testable.
 */
function structureLabel(text: string, position: readonly [number, number, number]): CSS2DObject {
  const element = document.createElement("div");
  element.className = "structure-label";
  element.textContent = text;

  const css2dObject = new CSS2DObject(element);
  css2dObject.position.set(position[0], position[1], position[2]);
  return css2dObject;
}

/** The point along the Gould Belt's own ellipse used to place its optional
 * label (issue #124) - the ellipse's apex (`t=0` in
 * `gouldBeltEllipsePoints`'s parametrization, i.e. `points[0]`), a
 * distinctive (major-axis) point on the ring rather than an arbitrary one.
 * Pure/no-DOM, split out from `createGouldBeltLabel` below specifically so
 * the position math stays unit-testable even though the label's own
 * `document.createElement` call isn't (see `structureLabel`'s docstring). */
export function gouldBeltLabelPosition(model: GouldBeltStructure): [number, number, number] {
  return gouldBeltEllipsePoints(model)[0]!;
}

/** The point along the Radcliffe Wave's own spine used to place its
 * optional label (issue #124) - the spine's midpoint by point-array index
 * (a reasonable proxy for the curve's midpoint given `s_pc` is monotonic
 * along `points`), rather than either end, so it doesn't compete with
 * either endpoint's own visual territory. Pure/no-DOM - see
 * `gouldBeltLabelPosition`'s docstring for why this is split out. */
export function radcliffeWaveLabelPosition(
  model: RadcliffeWaveStructure,
): [number, number, number] {
  const midpoint = model.points[Math.floor((model.points.length - 1) / 2)]!;
  return [midpoint.x_pc, midpoint.y_pc, midpoint.z_pc];
}

/** Builds the Gould Belt's optional label (issue #124) - `main.ts` calls
 * this itself (only when `createGouldBeltLayer` returned a non-null group
 * for the same `model`) and parents the result under that group; see
 * `structureLabel`'s docstring for why this isn't done inside
 * `createGouldBeltLayer` itself. */
export function createGouldBeltLabel(model: GouldBeltStructure): CSS2DObject {
  return structureLabel("Gould Belt", gouldBeltLabelPosition(model));
}

/** Builds the Radcliffe Wave's optional label (issue #124) - same calling
 * convention as `createGouldBeltLabel` above. */
export function createRadcliffeWaveLabel(model: RadcliffeWaveStructure): CSS2DObject {
  return structureLabel("Radcliffe Wave", radcliffeWaveLabelPosition(model));
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

/** Local Bubble wireframe opacity - pulled out to a named constant (issue
 * #137) so `setLocalBubbleDimmed` below and `createLocalBubbleLayer`'s own
 * material construction share one source of truth instead of a second
 * `0.35` literal that could silently drift from the first. Matches
 * `STRUCTURE_TUBE_OPACITY`'s own value (see that constant's docstring). */
const LOCAL_BUBBLE_OPACITY = 0.35;

/**
 * Build the Gould Belt ring as a translucent `THREE.TubeGeometry` band
 * (issue #124; pre-#124 this was a hairline `THREE.Line` - see
 * `tubeFromPoints`). Returns `null` if `model` is missing or structurally
 * incomplete (spec §38: "missing optional layers do not break the
 * application") rather than throwing.
 *
 * Deliberately does not build the optional label itself - see
 * `structureLabel`'s docstring for why that's a separate, DOM-touching call
 * `main.ts` makes on top of this function's result.
 */
export function createGouldBeltLayer(model: GouldBeltStructure | undefined): Group | null {
  if (!model || !model.center || !Number.isFinite(model.major_radius_pc)) {
    return null;
  }
  const group = new Group();
  group.name = "gould-belt";
  const points = gouldBeltEllipsePoints(model);
  // `gouldBeltEllipsePoints`'s `t` runs 0..2*pi INCLUSIVE (see its own
  // docstring), so the first and last returned points coincide - that
  // duplicate closing point existed to make the old, non-loop `THREE.Line`
  // render as a closed ring. `CatmullRomCurve3`'s own `closed: true` (passed
  // via `tubeFromPoints`) already wraps the curve from its last point back
  // to its first, so keeping the duplicate would produce a zero-length
  // closing segment - dropped here instead.
  const openPoints = points.slice(0, -1);
  group.add(tubeFromPoints(openPoints, GOULD_BELT_COLOR, true));
  return group;
}

/**
 * Build the Radcliffe Wave spine as a translucent `THREE.TubeGeometry` band
 * directly through `structures.radcliffe_wave.points` (spec §17: already a
 * literal list of `{s_pc, x_pc, y_pc, z_pc}` - no fitting/interpolation
 * needed client-side, the Python pipeline already produced the fitted
 * curve). Pre-#124 this was a hairline `THREE.Line` - see `tubeFromPoints`.
 * Unlike the Gould Belt's ellipse, this is an open (non-looping) spline -
 * `structures.radcliffe_wave.points`' first and last points are genuinely
 * distinct (verified against `web/public/data/scene.json`, 2026-08-19) -
 * so `closed: false` throughout.
 *
 * Deliberately does not build the optional label itself - see
 * `structureLabel`'s docstring for why that's a separate, DOM-touching call
 * `main.ts` makes on top of this function's result.
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
  group.add(tubeFromPoints(points, RADCLIFFE_WAVE_COLOR, false));
  return group;
}

/**
 * Rotation matrix for the Local Bubble ellipsoid's fitted orientation
 * (Alves et al. 2018, A&A 611, L5, arXiv:1803.05251 - `source.reference`
 * in `models/local_bubble.yaml`). Sec. 2/3 + Table 1 state only, in prose:
 * "the standard Euler angles, theta_ell (nutation), psi_ell (precession),
 * and phi_ell (intrinsic)" - no explicit matrix equation - so this
 * implements the textbook (Goldstein) definition of those three names:
 *
 *   R = Rz(psi_ell) . Ry(theta_ell) . Rz(phi_ell)
 *
 * (precession about the fixed Z axis, then nutation about the
 * once-rotated line-of-nodes axis, then an intrinsic spin about the
 * twice-rotated Z axis), applied to the ellipsoid's own local axes, where
 * local +Z is the long (c) axis before rotation - matching
 * `createLocalBubbleLayer`'s `scale.set(a_pc, b_pc, c_pc)` convention
 * (c_pc scales local Z). The classic "proper Euler angle" definition
 * uses a repeated axis for the line of nodes (Z-X-Z or Z-Y-Z; Goldstein
 * uses Z-X-Z) - X vs Y cannot be distinguished from the paper's numbers
 * alone, but it doesn't matter here: `phi_ell_deg` (the only place the
 * X-vs-Y choice would show up) is fixed to 0 by the fit for this
 * axisymmetric (a_pc == b_pc) spheroid, so both choices give the
 * identical rotation. `phi_ell` is still applied below for
 * correctness/completeness in case a future, non-axisymmetric model ever
 * sets it.
 *
 * Cross-checked, not guessed: with the fitted `theta_ell_deg = 30`,
 * `psi_ell_deg = 216`, this rotates local +Z to exactly (l, b) = (216 deg,
 * 60 deg) - the paper's own INDEPENDENTLY-stated long-axis pointing
 * direction ("long axis points towards (l,b) = (216 deg, 60 deg)",
 * `long_axis_l_deg`/`long_axis_b_deg`) - because under this rotation
 * local +Z always lands at (l, b) = (psi_ell, 90 - theta_ell): a
 * b=90-theta identity plus an l=psi identity. Verified numerically by
 * `localBubbleLongAxisDirection`'s test in `structures.test.ts` against
 * that ground truth. Pure/no-WebGL-context-needed (spec §38) even though
 * it uses `THREE.Matrix4`, which is plain math under Node - see
 * `objects.test.ts` for existing precedent of testing `THREE.Matrix4`
 * this way.
 */
export function localBubbleOrientationMatrix(orientation: LocalBubbleOrientation): Matrix4 {
  const psiRad = (orientation.psi_ell_deg * Math.PI) / 180;
  const thetaRad = (orientation.theta_ell_deg * Math.PI) / 180;
  const phiRad = (orientation.phi_ell_deg * Math.PI) / 180;

  const matrix = new Matrix4().makeRotationZ(psiRad);
  matrix.multiply(new Matrix4().makeRotationY(thetaRad));
  matrix.multiply(new Matrix4().makeRotationZ(phiRad));
  return matrix;
}

/**
 * The direction (unit XYZ, heliocentric Galactic Cartesian) the
 * ellipsoid's long (c) axis points after `localBubbleOrientationMatrix` is
 * applied - i.e. that rotation applied to the local +Z axis (0,0,1).
 * Exported for the orientation sanity-check test (issue #102's
 * acceptance criterion: "the ellipsoid's long (c) axis direction in the
 * scene must numerically match the paper's independently-stated pointing
 * direction"); not used by the renderer itself, which applies the
 * rotation matrix directly to the mesh.
 */
export function localBubbleLongAxisDirection(
  orientation: LocalBubbleOrientation,
): [number, number, number] {
  const axis = new Vector3(0, 0, 1).applyMatrix4(localBubbleOrientationMatrix(orientation));
  return [axis.x, axis.y, axis.z];
}

function isFiniteOrientation(
  orientation: LocalBubbleOrientation | undefined,
): orientation is LocalBubbleOrientation {
  return (
    !!orientation &&
    Number.isFinite(orientation.theta_ell_deg) &&
    Number.isFinite(orientation.psi_ell_deg) &&
    Number.isFinite(orientation.phi_ell_deg)
  );
}

/**
 * Build the Local Bubble as a coarse translucent wireframe ellipsoid (spec
 * §18: "For MVP, a simplified volume is acceptable if backed by a
 * source... sphere / ellipsoid / mesh / point cloud boundary").
 *
 * Implementation (Story #65's `THREE.SphereGeometry` shortcut, plus Story
 * #102's orientation fix): a `THREE.SphereGeometry` non-uniformly scaled
 * by `semi_axes_pc.{a_pc,b_pc,c_pc}` along the mesh's own local X/Y/Z,
 * then rotated per `localBubbleOrientationMatrix` (the fitted Euler
 * angles - Story #65 explicitly deferred this, matching the notebook's
 * own documented "diagnostic approximation" shortcut; #102 now applies
 * it), then positioned at `center_pc`. `Object3D.updateMatrix` composes
 * position/quaternion/scale as `T . R . S`, i.e. exactly scale-then-rotate
 * -then-translate, so setting `mesh.scale`, `mesh.quaternion` and
 * `mesh.position` independently (as below) gets that order for free with
 * no extra matrix plumbing. If `orientation` is absent or has
 * non-finite fields, the rotation is skipped and the ellipsoid renders
 * axis-aligned as before (spec §38: missing optional data doesn't break
 * the layer).
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
    opacity: LOCAL_BUBBLE_OPACITY,
    depthWrite: false,
  });
  const mesh = new Mesh(geometry, material);
  mesh.scale.set(a_pc, b_pc, c_pc);
  if (isFiniteOrientation(model.orientation)) {
    mesh.quaternion.setFromRotationMatrix(localBubbleOrientationMatrix(model.orientation));
  }
  mesh.position.set(model.center_pc.x_pc, model.center_pc.y_pc, model.center_pc.z_pc);
  group.add(mesh);

  return group;
}

/**
 * Issue #137: finds the one true geometry `Mesh` inside a structure-layer
 * group (as opposed to the optional `CSS2DObject` label `main.ts` may have
 * parented alongside it, see `structureLabel`'s docstring on why the label
 * is added as a separate child rather than built inside these layer
 * functions). Returns `null` for a `null` group (a structure that failed to
 * build from missing/malformed data, spec §38) so `set*Dimmed` below can
 * treat "layer doesn't exist" as a harmless no-op rather than a crash.
 */
function structureLayerMesh(group: Group | null): Mesh | null {
  if (!group) {
    return null;
  }
  return group.children.find((child): child is Mesh => child instanceof Mesh) ?? null;
}

/**
 * Issue #137: dims (or restores) a structure-layer overlay's own mesh
 * opacity in place. Unlike `objects.ts`'s `updateBackgroundDimming` (which
 * swaps `InstancedMesh.material` between cached instances rather than
 * mutating one in place, because that cache is a module-level singleton
 * shared across independent `createCatalogObjectGroup` calls), each call to
 * `createGouldBeltLayer`/`createRadcliffeWaveLayer`/`createLocalBubbleLayer`
 * builds a brand-new, NOT-cached `MeshBasicMaterial` (see `tubeFromPoints`/
 * `createLocalBubbleLayer` above - no `materialFor`-style cache in this
 * file) - so there is no other owner of this exact material instance to
 * leak a mutation into, and in-place `.opacity` mutation is both simpler and
 * safe here. Restoring always resets to the same known `baseOpacity`
 * constant (never derived from the current, possibly-dimmed value), so
 * repeated dim/restore cycles can never drift.
 */
function setStructureLayerDimmed(group: Group | null, baseOpacity: number, dimmed: boolean): void {
  const mesh = structureLayerMesh(group);
  if (!mesh) {
    return;
  }
  const material = mesh.material as MeshBasicMaterial;
  material.opacity = dimmed ? baseOpacity * STRUCTURE_DIM_FACTOR : baseOpacity;
}

/** Dims/restores the Gould Belt tube overlay (issue #137). No-op if the
 * layer wasn't built (`createGouldBeltLayer` returned `null`). */
export function setGouldBeltDimmed(group: Group | null, dimmed: boolean): void {
  setStructureLayerDimmed(group, STRUCTURE_TUBE_OPACITY, dimmed);
}

/** Dims/restores the Radcliffe Wave tube overlay (issue #137). No-op if the
 * layer wasn't built (`createRadcliffeWaveLayer` returned `null`). */
export function setRadcliffeWaveDimmed(group: Group | null, dimmed: boolean): void {
  setStructureLayerDimmed(group, STRUCTURE_TUBE_OPACITY, dimmed);
}

/** Dims/restores the Local Bubble wireframe ellipsoid overlay (issue #137).
 * No-op if the layer wasn't built (`createLocalBubbleLayer` returned
 * `null`). */
export function setLocalBubbleDimmed(group: Group | null, dimmed: boolean): void {
  setStructureLayerDimmed(group, LOCAL_BUBBLE_OPACITY, dimmed);
}
