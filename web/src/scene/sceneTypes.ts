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
 * layers). Story #64 does not render these - out of scope, see issue #64's
 * "Out of scope" list ("layer toggles" is a later Story) - but the field is
 * kept typed as an opaque record so loading/validating the scene doesn't
 * require knowing the internal shape of layers this Story doesn't draw.
 */
export type SceneStructures = Record<string, Record<string, unknown>>;

export interface Scene {
  metadata: SceneMetadata;
  objects: SceneObject[];
  structures: SceneStructures;
}
