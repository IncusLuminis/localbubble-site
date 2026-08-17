/**
 * Heliocentric Galactic Cartesian XYZ (pc) -> Galactic longitude/latitude
 * (deg), for the inspector panel (spec Idea.md §24: "Galactic coordinates:
 * l = ... b = ...").
 *
 * `scene.json`'s `objects` array carries `position_pc` (XYZ) but not
 * `l_deg`/`b_deg` directly (see `sceneTypes.ts` - the Python export only
 * emits the fields the scene schema in spec §21 lists). Rather than
 * regenerating the Python export to also carry l/b (out of this Story's
 * file scope - no Python files may be touched, and this would be a
 * redundant derived value anyway), this inverts the same forward transform
 * `src/local_galactic_structures/coordinates.py` uses (astropy's Galactic
 * frame, which is a standard right-handed spherical -> Cartesian mapping):
 *
 *   x = d * cos(b) * cos(l)
 *   y = d * cos(b) * sin(l)
 *   z = d * sin(b)
 *
 * so:
 *
 *   l = atan2(y, x)              (normalized to [0, 360))
 *   b = asin(z / sqrt(x^2+y^2+z^2))
 *
 * This is a pure geometric inversion of already-derived data, not a new
 * scientific claim - spec §19 classifies "Orion XYZ coordinates" as
 * "derived data"; l/b recovered from that same XYZ is the same
 * classification, just a different coordinate representation of it.
 */

export interface GalacticLB {
  l_deg: number;
  b_deg: number;
}

export function cartesianToGalacticLB(x: number, y: number, z: number): GalacticLB {
  const r = Math.sqrt(x * x + y * y + z * z);
  if (r === 0) {
    // The Sun itself (origin) has no well-defined direction; report 0/0
    // rather than NaN so the inspector never shows "NaN" for the Sun.
    return { l_deg: 0, b_deg: 0 };
  }
  let l_deg = (Math.atan2(y, x) * 180) / Math.PI;
  if (l_deg < 0) {
    l_deg += 360;
  }
  const clampedSinB = Math.min(1, Math.max(-1, z / r));
  const b_deg = (Math.asin(clampedSinB) * 180) / Math.PI;
  return { l_deg, b_deg };
}
