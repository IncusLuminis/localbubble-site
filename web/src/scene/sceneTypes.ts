/**
 * TypeScript mirror of the renderer-independent scene JSON produced by the
 * Python pipeline's `export_scene` (see
 * `src/local_galactic_structures/scene.py`, spec Idea.md §21/§45).
 *
 * This file intentionally contains no Three.js imports and no rendering
 * concerns - it exists so the web layer has a typed view of exactly what
 * the scene export actually emits, with nothing added and nothing
 * hard-coded (spec §3: the renderer must never contain scientific
 * coordinates hard-coded into visualization code; everything here is a
 * shape description, not a value).
 */

export interface SceneObjectSource {
  reference: string;
  url: string | null;
  catalog: string | null;
}

export interface SceneObjectGroup {
  primary: string | null;
  secondary: string[];
}

/** One entry of `scene.json`'s `objects` array. */
export interface SceneObject {
  id: string;
  name: string;
  aliases: string[];
  object_type: string;
  /** Heliocentric Galactic Cartesian [x_pc, y_pc, z_pc] (spec §6). */
  position_pc: [number, number, number];
  distance_pc: number;
  distance_error_pc: number | null;
  size_pc: number | null;
  color_class: string | null;
  group: SceneObjectGroup;
  source: SceneObjectSource;
  notes: string | null;
}

export interface SceneMetadata {
  coordinate_system: string;
  distance_unit: string;
}

/**
 * The `structures` block (Gould Belt / Radcliffe Wave / Local Bubble model
 * layers, spec §21). Story #64 left this untyped/unrendered ("layer
 * toggles" was explicitly deferred to a later Story). Story #65 renders
 * these for the first time, so the three known shapes are typed below,
 * matching exactly what `src/local_galactic_structures/models.py` /
 * `scene.py` actually emit (verified against the regenerated
 * `web/public/data/scene.json`) - not invented ahead of the data.
 *
 * Every field here is read defensively by `scene/structures.ts` (optional
 * chaining / explicit shape checks) rather than assumed present, per spec
 * §38 ("missing optional layers do not break the application") - a
 * catalog/model file could in principle omit a structure entirely.
 */

export interface GouldBeltCenter {
  x_pc: number;
  y_pc: number;
  z_pc: number;
}

/** `structures.gould_belt` (spec §16/§21): a tilted-annulus model,
 * parametrized exactly as `notebooks/local_neighborhood.ipynb`'s
 * `gould_belt_ellipse_points` consumes it. */
export interface GouldBeltStructure {
  model: string;
  representation: string;
  center: GouldBeltCenter;
  major_radius_pc: number;
  minor_radius_pc: number;
  inclination_deg: number;
  orientation_deg: number;
  thickness_pc: number;
  source?: unknown;
}

export interface RadcliffeWavePoint {
  s_pc: number;
  x_pc: number;
  y_pc: number;
  z_pc: number;
}

/** `structures.radcliffe_wave` (spec §17/§21): a literal fitted-spine
 * polyline/spline, already in XYZ - no geometry construction needed, only
 * a direct `THREE.Line` through `points`. */
export interface RadcliffeWaveStructure {
  model: string;
  representation: string;
  enabled?: boolean;
  curve_type?: string;
  points: RadcliffeWavePoint[];
  source?: unknown;
  notes?: string | null;
}

export interface LocalBubbleCenter {
  x_pc: number;
  y_pc: number;
  z_pc: number;
}

export interface LocalBubbleSemiAxes {
  a_pc: number;
  b_pc: number;
  c_pc: number;
}

/** `structures.local_bubble` (spec §18/§21): an off-centred ellipsoid.
 * `orientation` (Euler angles) is present in the data but deliberately not
 * applied by the MVP renderer - see `scene/structures.ts`'s
 * `createLocalBubbleLayer` docstring for why, mirroring the notebook's own
 * documented "diagnostic approximation" shortcut. */
export interface LocalBubbleStructure {
  representation: string;
  enabled?: boolean;
  center_pc: LocalBubbleCenter;
  semi_axes_pc: LocalBubbleSemiAxes;
  orientation?: unknown;
  source?: unknown;
  notes?: string | null;
  data_classification?: string;
  uncertainty?: unknown;
}

export interface SceneStructures {
  gould_belt?: GouldBeltStructure;
  radcliffe_wave?: RadcliffeWaveStructure;
  local_bubble?: LocalBubbleStructure;
  [key: string]: unknown;
}

export interface Scene {
  metadata: SceneMetadata;
  objects: SceneObject[];
  structures: SceneStructures;
}
