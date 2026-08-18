import type { SceneObject } from "./sceneTypes";
import { SUN_OBJECT_ID } from "./objects";

/**
 * Name/alias search matching (issue #106, spec §2.6). Spec §22's required
 * web-visualizer capabilities list has no search - a reasonable omission at
 * the original ~20-object catalog, a real gap once Story #88 grew it to
 * 834 objects. This gives "type a name, jump to the matching object" a
 * pure, DOM/THREE-free matching function that the search UI component
 * (`ui/search.ts`) and its tests can both call directly.
 *
 * Case-insensitive substring match against `SceneObject.name` and each of
 * its `aliases` entries - the acceptance criteria's stated minimum (fuzzy/
 * typo-tolerant matching is explicitly out of scope for this issue).
 *
 * The Sun's own dedicated-marker catalog entry (`SUN_OBJECT_ID`, see
 * `scene/objects.ts`) is excluded from results: it isn't part of the
 * generic catalog `InstancedMesh` buckets or the labels layer (both built
 * from `excludeDedicatedMarkerObjects`), so `objectCenteredPose`/
 * `selectObject` would otherwise be asked to frame/select an object with no
 * corresponding on-screen marker or label. The existing "Sun-centered"
 * camera preset already covers navigating to the Sun.
 */
export function searchObjects(objects: readonly SceneObject[], query: string): SceneObject[] {
  const trimmed = query.trim().toLowerCase();
  if (trimmed.length === 0) {
    return [];
  }
  return objects.filter((obj) => obj.id !== SUN_OBJECT_ID && matchesQuery(obj, trimmed));
}

function matchesQuery(obj: SceneObject, trimmedLowerQuery: string): boolean {
  if (obj.name.toLowerCase().includes(trimmedLowerQuery)) {
    return true;
  }
  return obj.aliases.some((alias) => alias.toLowerCase().includes(trimmedLowerQuery));
}
