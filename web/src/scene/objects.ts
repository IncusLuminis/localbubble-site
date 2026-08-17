import { Group, Mesh, MeshBasicMaterial, SphereGeometry } from "three";
import type { SceneObject } from "./sceneTypes";
import { positionToVector3 } from "./sceneData";

/**
 * Catalog object rendering (spec Idea.md §22/§45, issue #64: "Catalog
 * objects loaded from the scene export and rendered in their correct
 * positions"). Basic per-`object_type` color/size distinction only - a
 * full styling system, labels, and picking are explicitly out of scope
 * for this Story (see issue #64's "Out of scope" list; spec §41 defers
 * heavy visual refinement to Phase 7).
 *
 * Only 17-20 objects in the current catalog (spec §44: "do not
 * prematurely optimize for millions of stars"), so plain `Mesh` instances
 * in a `Group` are used rather than `InstancedMesh` - simple, and cheap
 * enough not to need instancing yet. `SphereGeometry`/`MeshBasicMaterial`
 * are shared per object_type to keep the geometry/material count small.
 *
 * The Sun is itself present in `scene.json`'s `objects` array (`id: "sun"`,
 * `object_type: "reference_point"`, `position_pc: [0, 0, 0]`) - it's a real
 * catalog entry from the Python pipeline's point of view. It already gets
 * its own dedicated, distinctly-styled marker (`scene/sun.ts`), so this
 * generic catalog loop must exclude it - otherwise it draws a second,
 * generic-grey sphere on top of the dedicated marker, both at the exact
 * origin (found in PR #79 review; see `SUN_OBJECT_ID`).
 */

/** `scene.json`'s stable id for the Sun's own catalog entry (see
 * `src/local_galactic_structures/initial_catalog.py`/the checked-in
 * initial-catalog records). Filtered out of the generic catalog-object
 * render loop below because the Sun already has a dedicated marker
 * (`scene/sun.ts`). Matched on `id` rather than `object_type ===
 * "reference_point"` so a future, non-Sun `reference_point` object (the
 * type is not currently Sun-exclusive per spec §8) would still render
 * normally through this loop instead of being silently dropped. */
export const SUN_OBJECT_ID = "sun";

/** `scene.json` objects that should NOT be drawn by the generic catalog
 * loop because they already have their own dedicated marker. Exported so
 * `main.ts` can derive an accurate "N objects" count from the same
 * definition used to build the render group. */
export function excludeDedicatedMarkerObjects(objects: SceneObject[]): SceneObject[] {
  return objects.filter((obj) => obj.id !== SUN_OBJECT_ID);
}

const OBJECT_TYPE_COLORS: Record<string, number> = {
  star: 0xffffff,
  star_cluster: 0xffd27f,
  stellar_association: 0xff9f6b,
  molecular_cloud: 0x7fb8ff,
  star_forming_region: 0xff7fb0,
  hii_region: 0xb07fff,
  supernova_remnant: 0xff5f5f,
  bubble: 0x5fffe0,
  reference_point: 0x9aa7bd,
};

const DEFAULT_COLOR = 0xaab4c8;

/** Visual-only marker radius floor (pc), so point-like objects with no
 * `size_pc` (e.g. stars, clusters) stay visible against an 800pc-scale
 * scene. This is display convenience, not a scientific value (spec §19
 * distinguishes measured/derived/model data from visual decoration). */
const MIN_MARKER_RADIUS_PC = 4;
const MAX_MARKER_RADIUS_PC = 45;

function markerRadiusPc(sizePc: number | null): number {
  if (sizePc === null || !Number.isFinite(sizePc) || sizePc <= 0) {
    return MIN_MARKER_RADIUS_PC;
  }
  // Extended structures (molecular clouds etc.) carry a physical size;
  // clamp only so a very large cloud doesn't dwarf the whole scene.
  return Math.min(Math.max(sizePc / 4, MIN_MARKER_RADIUS_PC), MAX_MARKER_RADIUS_PC);
}

const materialCache = new Map<number, MeshBasicMaterial>();
function materialFor(color: number): MeshBasicMaterial {
  let material = materialCache.get(color);
  if (!material) {
    material = new MeshBasicMaterial({ color, transparent: true, opacity: 0.85 });
    materialCache.set(color, material);
  }
  return material;
}

export function createCatalogObjectGroup(objects: SceneObject[]): Group {
  const group = new Group();
  group.name = "catalog-objects";

  for (const obj of excludeDedicatedMarkerObjects(objects)) {
    const color = OBJECT_TYPE_COLORS[obj.object_type] ?? DEFAULT_COLOR;
    const radius = markerRadiusPc(obj.size_pc);
    const geometry = new SphereGeometry(radius, 16, 12);
    const mesh = new Mesh(geometry, materialFor(color));
    mesh.name = obj.id;
    mesh.position.copy(positionToVector3(obj.position_pc));
    mesh.userData.sceneObject = obj;
    group.add(mesh);
  }

  return group;
}
